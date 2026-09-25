// The JSON-RPC driver for the demo unit's firmware, against an imitation built
// from the camera's own web app. What can only be checked on the real unit is
// marked TODO(verify) in server/mtrpc.mjs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MtrpcClient, loginResponse, toCam, fromCam, rectRule, ruleBox, placeRules, RULE_NAMES } from "./mtrpc.mjs";
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
  assert.equal(cfg.emissivity, 0.95);
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
  const opts = { emissivity: 0.98, distanceM: 3.5 };
  const cur = await c.getConfig("Thermal.thermometry_rule_all");
  const rules = placeRules(cur.thermometry_rules,
    rectRule(eye, { ...opts, name: RULE_NAMES.eye }), rectRule(nos, { ...opts, name: RULE_NAMES.nostril }));
  await c.setConfig("Thermal.thermometry_rule_all", { ...cur, thermometry_rules: rules });

  const back = (await c.getConfig("Thermal.thermometry_rule_all")).thermometry_rules;
  assert.equal(back.find((r) => r.name === "vendor-default").enable, true, "someone else's rule is untouched");
  const e = back.find((r) => r.name === RULE_NAMES.eye), n = back.find((r) => r.name === RULE_NAMES.nostril);
  assert.equal(e.type, "kRectangle");
  assert.equal(e.target_radiation_coefficient, 0.98);
  for (const [got, want] of [[ruleBox(e), eye], [ruleBox(n), nos]])
    for (const k of ["x0", "y0", "x1", "y1"]) assert.ok(Math.abs(got[k] - want[k]) <= 1, `${k}: ${got[k]} vs ${want[k]}`);
  assert.equal(back.length, 3, "the free slot was reused, one rule appended");

  // Re-aiming reuses our own slots instead of adding more.
  const again = placeRules(back, rectRule(eye, { ...opts, name: RULE_NAMES.eye }), rectRule(nos, { ...opts, name: RULE_NAMES.nostril }));
  assert.equal(again.length, 3);
});

test("a full rule table is refused with a clear message", () => {
  const full = Array.from({ length: 12 }, (_, i) => ({ enable: true, name: `r${i}`, points: [] }));
  assert.throws(() => placeRules(full, { name: RULE_NAMES.eye }, { name: RULE_NAMES.nostril }), /12 measurement rules/);
});
