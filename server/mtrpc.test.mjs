// The JSON-RPC driver for the demo unit's firmware, against an imitation built
// from the camera's own web app. What can only be checked on the real unit is
// marked TODO(verify) in server/mtrpc.mjs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MtrpcClient, loginResponse, toCam, fromCam, rectRule, eyeRule, nostrilRule, ruleBox, placeRules, RULE_NAMES } from "./mtrpc.mjs";
import { startFakeMtrpc } from "./testing/fake-mtrpc.mjs";

const cam = await startFakeMtrpc({ password: "s3cret" });
after(() => cam.close());
const client = (password = "s3cret") => new MtrpcClient({ host: "127.0.0.1", httpPort: cam.port, username: "admin", password });

test("the login response is the web app's formula", () => {
  const md5 = (s) => createHash("md5").update(s).digest("hex");
  const r = loginResponse({ username: "admin", password: "p", realm: "A9FNF", nonce: "n", qop: "auth", cnonce: "c" });
  assert.equal(r, md5(`${md5("admin:A9FNF:p")}:n:00000001:c:auth:${md5("POST:/mtrpc")}`));
});

test("logs in with the right password and refuses a wrong one", async () => {
  const c = client();
  const r = await c.login();
  assert.equal(r.ok, true, r.error);
  assert.equal(c.loggedIn, true);
  assert.ok(c.sessionId);
  const bad = await client("wrong").login();
  assert.equal(bad.ok, false);
  assert.match(bad.error, /password/);
  await c.logout();
  assert.equal(c.loggedIn, false);
});

test("an expired session logs in again once and the call succeeds", async () => {
  const c = client();
  await c.login();
  const gen = c.generation, logins = cam.st.logins;
  cam.expireSessions();
  const cfg = await c.getConfig("Thermal.thermal_global_config");
  assert.equal(cfg.target_radiation_coefficient, 0.95);
  assert.equal(cam.st.logins, logins + 1);
  assert.equal(c.generation, gen + 1, "identity must be re-checked after a re-login");
});

test("a failed re-login is reported, not retried in a loop", async () => {
  const c = client();
  await c.login();
  c.password = "changed-on-the-camera";
  cam.expireSessions();
  const failed = cam.st.failedLogins;
  await assert.rejects(c.getConfig("Thermal.thermal_global_config"), /re-login failed/);
  assert.equal(cam.st.failedLogins, failed + 1, "one attempt only — the camera locks accounts");
});

test("coordinates: 0–10000 <-> 0–8192 at the driver boundary only", () => {
  assert.equal(toCam(0), 0);
  assert.equal(toCam(10000), 8192);
  assert.equal(toCam(5000), 4096);
  for (const v of [0, 1234, 3050, 5000, 9999, 10000]) assert.ok(Math.abs(fromCam(toCam(v)) - v) <= 1);
});

test("eye and nostril rules round-trip through the camera, leaving other rules alone", async () => {
  const c = client();
  await c.login();
  const eye = { x0: 3050, y0: 3150, x1: 3550, y1: 3650 }, nos = { x0: 2050, y0: 6300, x1: 2950, y1: 6900 };
  const cur = await c.getConfig("Thermal.thermometry_rule_all");
  const rules = placeRules(cur.thermometry_rules, eyeRule(eye), nostrilRule(nos));
  await c.setConfig("Thermal.thermometry_rule_all", { ...cur, thermometry_rules: rules });

  const back = (await c.getConfig("Thermal.thermometry_rule_all")).thermometry_rules;
  assert.equal(back.find((r) => r.name === "vendor-default").enable, true, "someone else's rule is untouched");
  const e = back.find((r) => r.name === RULE_NAMES.eye), n = back.find((r) => r.name === RULE_NAMES.nostril);
  assert.equal(e.type, "kRectangle");
  assert.equal(e.alarm_output.output_result, "kHighestTemperature", "the eye reports its hottest pixel");
  assert.equal(n.alarm_output.output_result, "kAverageTemperature", "the nostril reports its average");
  assert.equal(e.alarm_output.enable, false, "the camera's own alarm stays off");
  assert.equal(e.local_setting.enable, false, "uses the camera's global emissivity/distance unless asked");
  for (const [got, want] of [[ruleBox(e), eye], [ruleBox(n), nos]])
    for (const k of ["x0", "y0", "x1", "y1"]) assert.ok(Math.abs(got[k] - want[k]) <= 1, `${k}: ${got[k]} vs ${want[k]}`);
  assert.equal(back.length, 3, "the free slot was reused, one rule appended");
  assert.deepEqual(back.map((r) => r.rule_id).sort(), [0, 1, 2], "every rule has its own slot id");

  // Re-aiming reuses our own slots instead of adding more.
  const again = placeRules(back, eyeRule(eye), nostrilRule(nos));
  assert.equal(again.length, 3);
  assert.deepEqual(again.map((r) => r.rule_id), back.map((r) => r.rule_id), "re-aiming keeps the slot ids");
});

test("a full rule table is refused with a clear message", () => {
  const full = Array.from({ length: 12 }, (_, i) => ({ enable: true, name: `r${i}`, rule_id: i, points: [] }));
  assert.throws(() => placeRules(full, { name: RULE_NAMES.eye }, { name: RULE_NAMES.nostril }), /12 measurement rules/);
});

test("per-rule emissivity and distance only when asked", () => {
  const r = eyeRule({ x0: 0, y0: 0, x1: 100, y1: 100 }, { local: { emissivity: 0.98, distanceM: 3.5 } });
  assert.deepEqual(r.local_setting, { enable: true, target_radiation_coefficient: 0.98, target_distance: 3.5, target_reflection_temperature: 25 });
});

test("a malformed rule is what crashed the real camera — the imitation does the same", async () => {
  const c = client();
  await c.login();
  await assert.rejects(c.setConfig("Thermal.thermometry_rule_all", { thermometry_rules: [{ enable: true, type: "kRectangle", name: "x", points: [] }] }));
  assert.equal(cam.st.crashes, 1);
});

test("on an empty camera the two rules get slots 0 and 1", () => {
  const r = placeRules([], eyeRule({ x0: 0, y0: 0, x1: 100, y1: 100 }), nostrilRule({ x0: 0, y0: 0, x1: 100, y1: 100 }));
  assert.deepEqual(r.map((x) => [x.name, x.rule_id]), [[RULE_NAMES.eye, 0], [RULE_NAMES.nostril, 1]]);
});
