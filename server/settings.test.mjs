// Site settings and alert delivery: the Settings page's switches must do what
// they say — and muting a group stops SENDING it, never showing it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULTS, groupOf, mergeSettings, activityBands } from "./settings.mjs";
import { dispatch, tick, configureNotify, resetNotify } from "./notify.mjs";

const A = (id, type, severity = "alert", extra = {}) => ({ id, horse: "Zarina", severity, type, detail: "", time: "now", acknowledged: false, ...extra });

test("alert types map to the Settings groups; unknown types are sent (fail open)", () => {
  assert.equal(groupOf("Elevated body temperature"), "temperature");
  assert.equal(groupOf("High respiratory rate"), "breathing");
  assert.equal(groupOf("Possibly cast — check the horse now"), "casting");
  assert.equal(groupOf("Lying down and getting up repeatedly"), "colic");
  assert.equal(groupOf("New stable vice: weaving"), "vices");
  assert.equal(groupOf("Monitoring offline"), "monitoring");
  assert.equal(groupOf("Something new"), null);
});

test("settings are validated: hours, minutes and sensitivity clamp; junk is ignored", () => {
  const s = mergeSettings(DEFAULTS, { delivery: { digestHour: 99, escalateAfterMin: 1, instant: "yes", recipients: { vet: " +91 98 " } },
    send: { vices: false, bogus: false }, sensitivity: 250 });
  assert.equal(s.delivery.digestHour, 23);
  assert.equal(s.delivery.escalateAfterMin, 5);
  assert.equal(s.delivery.instant, true, "a non-boolean does not flip a switch");
  assert.equal(s.delivery.recipients.vet, "+91 98");
  assert.equal(s.send.vices, false);
  assert.equal(s.send.bogus, undefined);
  assert.equal(s.sensitivity, 100);
  const c = mergeSettings(DEFAULTS, { privacy: { confirmConsent: true } }, "Anita");
  assert.equal(c.privacy.consentBy, "Anita");
  assert.ok(c.privacy.consentAt);
});

test("sensitivity only moves the activity watch note; 50 is the tested default", () => {
  assert.deepEqual(activityBands(50), { hi: 2, lo: 0.4 });
  assert.deepEqual(activityBands(0), { hi: 3, lo: 0.25 });
  assert.deepEqual(activityBands(100), { hi: 1.5, lo: 0.55 });
});

test("instant alerts: off sends nothing; a muted group is not sent; others are, once", async () => {
  resetNotify();
  const sent = [];
  configureNotify({ send: async (p) => { sent.push(p); return "delivered"; } });
  const s = mergeSettings(DEFAULTS, { send: { vices: false }, delivery: { recipients: { manager: "+91 1" } } });
  await dispatch([A("t1", "Elevated body temperature"), A("v1", "New stable vice: weaving")], s);
  assert.deepEqual(sent.map((p) => p.id), ["t1"]);
  assert.equal(sent[0].to, "+91 1");
  await dispatch([A("t1", "Elevated body temperature")], s);
  assert.equal(sent.length, 1, "never twice");
  const off = mergeSettings(DEFAULTS, { delivery: { instant: false } });
  await dispatch([A("t2", "Elevated body temperature")], off);
  assert.equal(sent.length, 1);
  configureNotify({});
});

test("escalation: unacknowledged urgent alerts go to on-call, then the vet; acknowledging stops it", async () => {
  resetNotify();
  let t = Date.parse("2026-09-27T10:00:00");
  const sent = [];
  configureNotify({ send: async (p) => { sent.push(p); return "delivered"; }, clock: () => t });
  const s = mergeSettings(DEFAULTS, { delivery: { escalation: true, escalateAfterMin: 15, recipients: { manager: "m", onCall: "o", vet: "v" } } });
  const alerts = [A("f1", "Elevated body temperature"), A("w1", "Activity unusual for this horse", "warn")];
  await tick({ alerts, settings: s });
  assert.deepEqual(sent.map((p) => [p.kind, p.to]), [["alert", "m"]]);
  t += 14 * 60000; await tick({ alerts, settings: s });
  assert.equal(sent.length, 1, "not yet");
  t += 2 * 60000; await tick({ alerts, settings: s });
  assert.deepEqual(sent.at(-1), { ...sent.at(-1), kind: "escalation", level: 2, to: "o" });
  t += 15 * 60000; await tick({ alerts, settings: s });
  assert.deepEqual([sent.at(-1).level, sent.at(-1).to], [3, "v"]);
  t += 60 * 60000; await tick({ alerts, settings: s });
  assert.equal(sent.length, 3, "the chain ends at the vet");
  assert.ok(!sent.some((p) => p.id === "w1" && p.kind === "escalation"), "watch notes are not escalated");
  resetNotify(); sent.length = 0;
  await tick({ alerts, settings: s });
  t += 20 * 60000;
  await tick({ alerts: alerts.map((a) => ({ ...a, acknowledged: true })), settings: s });
  assert.ok(!sent.some((p) => p.kind === "escalation"), "acknowledged: no escalation");
  configureNotify({});
});

test("digest: once a day, at or after the chosen hour", async () => {
  resetNotify();
  let t = Date.parse("2026-09-27T06:30:00");
  const sent = [];
  configureNotify({ send: async (p) => { sent.push(p); return "delivered"; }, clock: () => t });
  const s = mergeSettings(DEFAULTS, { delivery: { digest: true, digestHour: 7, instant: false } });
  const horses = [{ name: "Zarina", status: "watch", statusNote: "x" }, { name: "Sultan", status: "calm", statusNote: "" }];
  await tick({ alerts: [], horses, settings: s });
  assert.equal(sent.length, 0, "before 07:00");
  t += 60 * 60000; await tick({ alerts: [], horses, settings: s });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "digest");
  assert.match(sent[0].summary, /1 to watch/);
  t += 60 * 60000; await tick({ alerts: [], horses, settings: s });
  assert.equal(sent.length, 1, "once a day");
  configureNotify({});
});

// ---- the API ------------------------------------------------------------------ //
const DATA = mkdtempSync(join(tmpdir(), "equicare-settings-"));
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
  process.env.ADMIN_PASSWORD = "test-admin-pw";
  process.env.EQUICARE_NOTIFY_TICK_MS = "0";
  delete process.env.DATABASE_URL;
  ({ handle } = await import("./app.mjs"));
  tokens.admin = (await call("POST", "/auth/login", { body: { username: "admin", password: "test-admin-pw" } })).body.token;
  for (const role of ["staff", "owner"]) {
    await call("POST", "/api/users", { token: tokens.admin, body: { username: role, password: "pw-" + role, role, name: role, ...(role === "owner" ? { owner: "o1" } : {}) } });
    tokens[role] = (await call("POST", "/auth/login", { body: { username: role, password: "pw-" + role } })).body.token;
  }
});
after(() => rmSync(DATA, { recursive: true, force: true }));

test("settings persist on the server; staff read them, only admins change them, owners never see them", async () => {
  const g = await call("GET", "/api/settings", { token: tokens.staff });
  assert.equal(g.status, 200);
  assert.equal(g.body.sensitivity, 50);
  assert.equal((await call("PATCH", "/api/settings", { token: tokens.staff, body: { sensitivity: 90 } })).status, 403);
  assert.equal((await call("GET", "/api/settings", { token: tokens.owner })).status, 404);
  const p = await call("PATCH", "/api/settings", { token: tokens.admin, body: { sensitivity: 90, send: { vices: false }, delivery: { digest: true } } });
  assert.equal(p.status, 200);
  const again = await call("GET", "/api/settings", { token: tokens.admin });
  assert.equal(again.body.sensitivity, 90);
  assert.equal(again.body.send.vices, false);
  assert.equal(again.body.delivery.digest, true);
  assert.equal(again.body.send.temperature, true, "untouched groups keep their value");
});
