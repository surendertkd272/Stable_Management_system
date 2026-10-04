// Alert rules staff set themselves: judged on what the camera measured, never
// on a camera that was off; only adding alerts; staff change their own rules.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judgeRule, validateRule, ruleText, backtest, staffRuleAlerts, configureStaffRules } from "./staff-rules.mjs";
import { groupOf } from "./settings.mjs";

const MIN = 60000;
const NOW = Date.parse("2026-10-04T23:30:00Z");
const at = (min) => new Date(NOW - min * MIN).toISOString();
const R = (metric, value, min, meta = {}) => ({ horseId: "h1", metric, value, ts: at(min), meta });
/** the once-a-minute time budget, `n` minutes back from now: lying/eating seconds per minute */
const budget = (n, { lyingS = 0, eatingS = 0, unseenS = 0 } = {}) =>
  [...Array(n)].map((_, i) => R("time_budget", 60, i, { lyingS, eatingS, unseenS, restingS: 60 - lyingS - eatingS - unseenS, movingS: 0 }));
const rule = (o) => validateRule({ horse: "h1", op: "more", level: "urgent", windowMin: 420, ...o }, { horses: [{ id: "h1" }] }).rule;

test("more than 4 lie-downs in 7 h: counts, fires, says so", () => {
  const r = rule({ measure: "lie_downs", value: 4, note: "box rest after colic surgery" });
  assert.equal(r.name, "Lie-downs over 4");
  assert.equal(ruleText(r), "more than 4 lie-downs in 7 h");
  const downs = [30, 90, 150, 210, 270, 330].map((m) => R("posture_event", 1, m, { kind: "lie_down" }));
  const j = judgeRule(r, downs, NOW);
  assert.deepEqual([j.judged, j.fires, j.value], [true, true, 6]);
  assert.equal(judgeRule(r, downs.slice(0, 4), NOW).fires, false, "4 is not more than 4");
  configureStaffRules([{ ...r, id: "r1", createdBy: "ram" }]);
  const [a] = staffRuleAlerts({ id: "h1", name: "Toofan" }, downs, NOW);
  assert.equal(a.type, "Staff rule: Lie-downs over 4");
  assert.equal(a.severity, "alert");
  assert.match(a.detail, /^6 lie-downs in 7 h — this rule: more than 4 lie-downs in 7 h\. Set by ram: box rest after colic surgery\. From the camera\.$/);
  assert.equal(staffRuleAlerts({ id: "h2", name: "Other" }, downs, NOW).length, 0, "another horse");
  configureStaffRules([]);
});

test("less than: judged only when the horse was seen at least half the time", () => {
  const r = rule({ measure: "eating_min", op: "less", value: 60, windowMin: 480, level: "watch" });
  assert.equal(ruleText(r), "less than 60 min of time eating at the hay in 8 h");
  const seen = budget(480, { eatingS: 5 });                   // 40 min eating in 8 h
  assert.deepEqual(Object.values((({ judged, fires, value }) => ({ judged, fires, value }))(judgeRule(r, seen, NOW))), [true, true, 40]);
  const camOff = budget(120, { eatingS: 5 });                 // camera ran 2 of 8 h
  const j = judgeRule(r, camOff, NOW);
  assert.equal(j.judged, false);
  assert.match(j.why, /less than half/);
  const outOfView = budget(480, { eatingS: 5, unseenS: 50 });  // camera on, horse seen 10 s a minute
  assert.equal(judgeRule(r, outOfView, NOW).judged, false, "not seen: not judged");
});

test("between hours: judged only then, and only on readings since the hours began", () => {
  const r = { ...rule({ measure: "lie_downs", value: 2, windowMin: 1440, hours: { from: 22, to: 5 } }) };
  configureStaffRules([], { tz: "UTC" });
  // 23:30 now; the night began 22:00. Two lie-downs before 22:00 do not count.
  const rd = [R("posture_event", 1, 30, { kind: "lie_down" }), R("posture_event", 1, 60, { kind: "lie_down" }),
    R("posture_event", 1, 120, { kind: "lie_down" }), R("posture_event", 1, 200, { kind: "lie_down" })];
  const j = judgeRule(r, rd, NOW);
  assert.equal(j.value, 2);
  assert.equal(j.fires, false);
  assert.equal(new Date(j.from).toISOString(), "2026-10-04T22:00:00.000Z");
  const noon = Date.parse("2026-10-04T12:00:00Z");
  assert.equal(judgeRule(r, rd, noon).why, "outside its hours");
});

test("readings: eye temperature uses the counted readings only", () => {
  const r = rule({ measure: "eye_temp", value: 38.5, windowMin: 60 });
  assert.equal(ruleText(r), "eye temperature (highest) above 38.5 °C in 1 h");
  const rd = [R("body_temp_c", 37.0, 10), R("body_temp_c", 40.4, 20)];   // 40.4: not an eye
  const j = judgeRule(r, rd, NOW);
  assert.deepEqual([j.value, j.fires], [37, false]);
  assert.equal(judgeRule(r, [], NOW).judged, false, "nothing measured");
});

test("checks on a rule", () => {
  const v = (o) => validateRule({ horse: "h1", measure: "lie_downs", op: "more", value: 4, windowMin: 60, level: "watch", ...o }, { horses: [{ id: "h1" }] });
  assert.ok(v({}).rule);
  assert.ok(v({ horse: "*" }).rule);
  assert.match(v({ horse: "nobody" }).errors[0], /choose a horse/);
  assert.match(v({ windowMin: 5 }).errors[0], /15 minutes/);
  assert.match(v({ value: 999 }).errors[0], /0 to 50/);
  assert.match(v({ op: "less", value: 0 }).errors[0], /never happen/);
  assert.match(v({ hours: { from: 3, to: 3 } }).errors[0], /not the same/);
});

test("the week's test run counts hours and days it would have fired", () => {
  const r = rule({ measure: "rolls", value: 0, windowMin: 60 });
  const rd = [R("posture_event", 1, 30, { kind: "possible_roll" }), R("posture_event", 1, 3 * 1440 + 30, { kind: "possible_roll" })];
  const b = backtest(r, rd, { now: NOW });
  assert.equal(b.checks, 169);
  assert.equal(b.fired, 2);
  assert.equal(b.days, 2);
});

test("a rule's alerts are their own group in Settings, whatever the name says", () => {
  assert.equal(groupOf("Staff rule: colic watch for Toofan"), "staff");
  assert.equal(groupOf("Staff rule: temperature after surgery"), "staff");
});

// ---- the API ------------------------------------------------------------------ //
const DATA = mkdtempSync(join(tmpdir(), "equicare-rules-"));
let handle;
const tokens = {};
async function call(method, path, { token, body } = {}) {
  const res = await handle(new Request(`http://local${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }));
  return { status: res.status, body: await res.json().catch(() => null) };
}
before(async () => {
  process.env.EQUICARE_DATA_DIR = DATA;
  process.env.EQUICARE_SAMPLE_HORSES = "1";
  process.env.ADMIN_PASSWORD = "test-admin-pw";
  process.env.EQUICARE_NOTIFY_TICK_MS = "0";
  delete process.env.DATABASE_URL;
  ({ handle } = await import("./app.mjs"));
  tokens.admin = (await call("POST", "/auth/login", { body: { username: "admin", password: "test-admin-pw" } })).body.token;
  for (const [u, role] of [["ram", "staff"], ["sita", "staff"], ["own", "owner"]]) {
    await call("POST", "/api/users", { token: tokens.admin, body: { username: u, password: "pw-" + u, role, name: u, ...(role === "owner" ? { owner: "o1" } : {}) } });
    tokens[u] = (await call("POST", "/auth/login", { body: { username: u, password: "pw-" + u } })).body.token;
  }
});
after(() => { configureStaffRules([]); rmSync(DATA, { recursive: true, force: true }); });

test("staff make rules, change their own; admins any; owners never see them; a firing rule is an alert", async () => {
  const body = { horse: "zarina", measure: "rolls", op: "more", value: 0, windowMin: 60, level: "urgent", note: "after colic" };
  const t = await call("POST", "/api/rules/test", { token: tokens.ram, body });
  assert.equal(t.status, 200);
  assert.equal(t.body.horses[0].horse, "Zarina");
  assert.equal(t.body.horses[0].week.checks, 169);
  const c = await call("POST", "/api/rules", { token: tokens.ram, body });
  assert.equal(c.status, 201);
  assert.equal(c.body.createdBy, "ram");
  assert.equal(c.body.text, "more than 0 rolls in 1 h");
  assert.equal((await call("PATCH", `/api/rules/${c.body.id}`, { token: tokens.sita, body: { value: 2 } })).status, 403);
  assert.equal((await call("PATCH", `/api/rules/${c.body.id}`, { token: tokens.ram, body: { value: 1 } })).body.value, 1);
  assert.equal((await call("PATCH", `/api/rules/${c.body.id}`, { token: tokens.admin, body: { value: 0 } })).body.value, 0);
  assert.equal((await call("GET", "/api/rules", { token: tokens.own })).status, 404);
  assert.equal((await call("POST", "/api/rules", { token: tokens.ram, body: { ...body, windowMin: 1 } })).status, 400);

  // a roll now → the rule's alert
  await call("POST", "/ingest/readings", { body: [{ ts: new Date().toISOString(), horseId: "zarina", metric: "posture_event", value: 1, unit: "event", source: "visible_video", meta: { kind: "possible_roll" } }] });
  const alerts = (await call("GET", "/api/alerts", { token: tokens.admin })).body;
  const mine = alerts.find((a) => a.type === "Staff rule: Rolls over 0");
  assert.ok(mine, JSON.stringify(alerts.map((a) => a.type)));
  assert.equal(mine.severity, "alert");
  const list = (await call("GET", "/api/rules", { token: tokens.sita })).body;
  assert.deepEqual(list.rules[0].firingNow, ["Zarina"]);
  assert.ok(list.measures.some((m) => m.key === "lie_downs"));

  assert.equal((await call("DELETE", `/api/rules/${c.body.id}`, { token: tokens.sita })).status, 403);
  assert.equal((await call("DELETE", `/api/rules/${c.body.id}`, { token: tokens.ram })).status, 200);
  assert.ok(!(await call("GET", "/api/alerts", { token: tokens.admin })).body.some((a) => a.type.startsWith("Staff rule")), "gone with the rule");
});
