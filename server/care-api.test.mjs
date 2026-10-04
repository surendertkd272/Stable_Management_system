// The Health checks page's API: the care log, outbreak mode, and staff marking
// alerts right or wrong (the silent trial's hit rates).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ageYears, dueChecks } from "./care-api.mjs";
import { configureCareLog } from "./care-log.mjs";

const DATA = mkdtempSync(join(tmpdir(), "equicare-care-"));
let handle;
const tok = {};
const call = async (method, path, { token, body } = {}) => {
  const res = await handle(new Request(`http://local${path}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
};
const admin = (m, p, body) => call(m, p, { token: tok.admin, body });
const staff = (m, p, body) => call(m, p, { token: tok.staff, body });
before(async () => {
  process.env.EQUICARE_DATA_DIR = DATA;
  process.env.EQUICARE_SAMPLE_HORSES = "1";
  process.env.ADMIN_PASSWORD = "test-admin-pw";
  process.env.EQUICARE_NOTIFY_TICK_MS = "0";
  process.env.EQUICARE_SENSOR_TICK_MS = "0";
  delete process.env.DATABASE_URL;
  ({ handle } = await import("./app.mjs"));
  tok.admin = (await call("POST", "/auth/login", { body: { username: "admin", password: "test-admin-pw" } })).body.token;
  await admin("POST", "/api/users", { username: "ram", password: "ram-pw-123456", role: "staff", name: "Ram" });
  tok.staff = (await call("POST", "/auth/login", { body: { username: "ram", password: "ram-pw-123456" } })).body.token;
});
after(() => rmSync(DATA, { recursive: true, force: true }));

test("ages, and the 6-monthly check from 15", () => {
  assert.equal(ageYears({ age: "16 yr" }), 16);
  assert.equal(ageYears({ age: "—" }), null);
  assert.equal(ageYears({ born: 2010 }, Date.parse("2026-10-04")), 16);
  configureCareLog({ horses: [], events: [] });
  const now = Date.parse("2026-10-04T12:00:00Z");
  assert.deepEqual(dueChecks({ id: "x", age: "16 yr" }, [], now).map((c) => c.kind), ["senior"]);
  assert.deepEqual(dueChecks({ id: "x", age: "16 yr", seniorCheckAt: "2026-08-01" }, [], now), []);
  assert.deepEqual(dueChecks({ id: "x", age: "9 yr" }, [], now), []);
});

test("logging a change; an arrival starts isolation; only its author or an admin removes it", async () => {
  const page = await staff("GET", "/api/care");
  assert.equal(page.status, 200);
  const horse = page.body.horses[0];
  assert.ok(horse && "temperature" in horse);
  assert.equal(horse.temperature.value, null, "no thermal readings: no temperature is shown");
  const bad = await staff("POST", "/api/care/events", { kind: "transport", horseId: horse.id });
  assert.equal(bad.status, 400);
  const ev = await staff("POST", "/api/care/events", { kind: "arrived", horseId: horse.id, note: "from Meerut" });
  assert.equal(ev.status, 201, JSON.stringify(ev.body));
  const after1 = await staff("GET", "/api/care");
  const checks = after1.body.horses.find((h) => h.id === horse.id).checks.map((c) => c.kind);
  assert.ok(checks.includes("isolation"), JSON.stringify(checks));
  assert.equal(after1.body.events[0].label, "Arrived at the stable");
  const hay = await admin("POST", "/api/care/events", { kind: "hay_change", horseId: "*" });
  assert.equal((await staff("DELETE", `/api/care/events/${hay.body.id}`)).status, 403);
  assert.equal((await staff("DELETE", `/api/care/events/${ev.body.id}`)).status, 200);
});

test("outbreak mode: staff start it and log cases, an admin ends it; it shows as a stable alert", async () => {
  const on = await staff("POST", "/api/care/outbreak", { action: "start", disease: "Strangles", quarantineDays: 28 });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal(on.body.outbreak.active, true);
  const alerts = (await admin("GET", "/api/alerts")).body;
  const ob = alerts.find((a) => a.type === "Outbreak mode");
  assert.ok(ob, "the countdown is on the Alerts page");
  assert.equal(ob.horse, "Stable");
  assert.match(ob.detail, /Strangles: day 1\./);
  assert.equal((await staff("POST", "/api/care/outbreak", { action: "case" })).status, 200);
  assert.equal((await staff("POST", "/api/care/outbreak", { action: "end" })).status, 403);
  const off = await admin("POST", "/api/care/outbreak", { action: "end" });
  assert.equal(off.body.outbreak.active, false);
  assert.ok(!(await admin("GET", "/api/alerts")).body.some((a) => a.type === "Outbreak mode"));
});

test("alerts marked right or wrong add up per kind of alert", async () => {
  for (const [id, v] of [["a:Possible fever:1", "right"], ["b:Possible fever:1", "wrong"], ["c:Possible fever:2", "right"], ["a:Hardly lying down:1", "unsure"]])
    assert.equal((await staff("POST", `/api/alerts/${encodeURIComponent(id)}/verdict`, { verdict: v, type: id.split(":")[1], horse: "Badal" })).status, 200);
  assert.equal((await staff("POST", "/api/alerts/x/verdict", { verdict: "maybe" })).status, 400);
  const r = (await admin("GET", "/api/alerts/hit-rates")).body;
  const fever = r.types.find((t) => t.type === "Possible fever");
  assert.deepEqual([fever.right, fever.wrong, fever.judged, fever.rate], [2, 1, 3, 67]);
  assert.equal(r.types.find((t) => t.type === "Hardly lying down").rate, null, "unsure is not counted either way");
});

test("the silent trial: a date up to 120 days ahead, or none", async () => {
  const d = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const s = await admin("PATCH", "/api/settings", { delivery: { trialUntil: d } });
  assert.ok(s.body.delivery.trialUntil.startsWith(d.slice(0, 7)));
  const far = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);
  assert.equal((await admin("PATCH", "/api/settings", { delivery: { trialUntil: far } })).body.delivery.trialUntil, null);
});
