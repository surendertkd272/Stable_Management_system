// Named alerts (colic, foaling, night visitor, heat) and the call chain that
// carries them to people's phones.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.CAMERA_SECRET_KEY ??= "test-only-key";   // sign() must not write a key file
const { namedAlerts, colicSigns, foalingWindow, mareAndFoal, configureNamedAlerts, unusualScore } = await import("./named-alerts.mjs");
const { tick, configureNotify, resetNotify, messageOf, ackLink, ackValid } = await import("./notify.mjs");
const { DEFAULTS, mergeSettings } = await import("./settings.mjs");

const H = 3600e3, DAY = 24 * H;
const NOW = Date.parse("2026-10-04T23:30:00Z");
const iso = (ms) => new Date(ms).toISOString();
const r = (metric, value, ms, meta = {}) => ({ horseId: "h1", metric, value, ts: iso(ms), meta });
const bio = { id: "h1", name: "Zarina" };

test("colic: one sign is not an alert, two together are", () => {
  const rolling = { resting: { downTimes: [], lastRoll: iso(NOW - 30 * 60000), lateralLast90Min: 0 } };
  assert.deepEqual(colicSigns([], rolling, NOW).map((s) => s.key), ["rolling"]);
  assert.equal(namedAlerts(bio, [], rolling, NOW).length, 0, "rolling alone stays a watch note elsewhere");
  // Usual: 30 droppings a week; the last one 9 h ago.
  const drops = [...Array(30)].map((_, i) => r("excretion_event", 1, NOW - 9 * H - i * 5 * H));
  const two = namedAlerts(bio, drops, rolling, NOW);
  assert.equal(two.length, 1);
  assert.equal(two[0].type, "Possible colic — look at the horse now");
  assert.equal(two[0].severity, "alert");
  assert.match(two[0].detail, /rolling, no droppings for 9 h/);
});

test("colic: eating half the usual share of the same hours", () => {
  const rows = [];
  for (let d = 0; d <= 4; d++)
    for (let h = 0; h < 6; h++) {
      const t = NOW - d * DAY - (h + 0.5) * H;
      rows.push(r("time_budget", 3600, t, { eatingS: d === 0 ? 300 : 1500 }));
    }
  const keys = colicSigns(rows, null, NOW).map((s) => s.key);
  assert.deepEqual(keys, ["eating"]);
});

test("foaling window, mare and foal", () => {
  const mare = { ...bio, foalingDue: "2026-10-10" };
  assert.equal(foalingWindow(mare, NOW), true);
  assert.equal(foalingWindow({ ...mare, foalingDue: "2027-02-01" }, NOW), false, "four months out");
  const signs = { resting: { downTimes: [NOW - 50 * 60000, NOW - 30 * 60000, NOW - 10 * 60000].map(iso), lastRoll: null, lateralLast90Min: 0 } };
  const a = namedAlerts(mare, [], signs, NOW);
  assert.equal(a.length, 1);
  assert.equal(a[0].type, "Foaling may be starting — check the mare now");
  assert.match(a[0].detail, /due 2026-10-10/);
  const foaled = { ...mare, foaledAt: "2026-10-01" };
  assert.equal(foalingWindow(foaled, NOW), false);
  assert.equal(mareAndFoal(foaled, NOW), true);
  assert.equal(namedAlerts(foaled, [], signs, NOW).length, 0, "two animals in view: single-horse signs paused");
  assert.equal(mareAndFoal({ ...mare, foaledAt: "2026-05-01" }, NOW), false, "after 90 days");
});

test("night visitor: quiet hours only, trusted cameras only", () => {
  configureNamedAlerts({ tz: "UTC", quietFrom: 22, quietTo: 5, nightVisitors: true, untrusted: ["cam-13mm"] });
  const night = [r("people_in_view_s", 40, NOW - 10 * 60000, { deviceId: "cam-a" })];
  const a = namedAlerts(bio, night, null, NOW);
  assert.deepEqual(a.map((x) => [x.type, x.severity]), [["Person at the stall at night", "warn"]]);
  assert.match(a[0].detail, /23:20/);
  assert.equal(namedAlerts(bio, [r("people_in_view_s", 40, NOW - 10 * 60000, { deviceId: "cam-13mm" })], null, NOW).length, 0, "untrusted camera");
  const day = Date.parse("2026-10-04T14:00:00Z");
  assert.equal(namedAlerts(bio, [r("people_in_view_s", 40, day - 60000, { deviceId: "cam-a" })], null, day).length, 0, "daytime");
  configureNamedAlerts({ nightVisitors: false });
  assert.equal(namedAlerts(bio, night, null, NOW).length, 0, "switched off");
  configureNamedAlerts({ nightVisitors: true, untrusted: [] });
});

test("heat index: °F + %RH, 130 watch, 150 danger", () => {
  const at = (c, rh) => namedAlerts(bio, [r("stall_temp_c", c, NOW - 60000), r("stall_humidity_pct", rh, NOW - 60000)], null, NOW);
  assert.equal(at(25, 40).length, 0);                       // 77 + 40 = 117
  assert.equal(at(30, 45)[0].type, "Hot, humid stall");     // 86 + 45 = 131
  assert.equal(at(35, 60)[0].type, "Dangerous heat in the stall"); // 95 + 60 = 155
  assert.equal(at(35, 60)[0].severity, "alert");
});

test("how unusual: learning until there is a normal", () => {
  const u = unusualScore(bio, [], { tz: "UTC" });
  assert.equal(u.score, null);
});

// ---- the call chain --------------------------------------------------------- //
const A = (id, type, severity = "alert") => ({ id, horse: "Zarina", severity, type, detail: "Two signs together. More text.", time: "now", acknowledged: false });
const chain = (extra = {}) => mergeSettings(DEFAULTS, { delivery: { escalation: true, escalateAfterMin: 10, callAtMostEveryMin: 60, warnToStaff: true,
  chain: [{ name: "Ram", phone: "+919800000001", channel: "call" }, { name: "Dr Rao", phone: "+919800000002", channel: "whatsapp" },
    { name: "Maj Singh", phone: "+919800000003", channel: "call" }], ...extra } });

test("an urgent alert calls the stall staff, then the vet, then the officer — each with a text to acknowledge", async () => {
  resetNotify();
  let t = NOW;
  const rang = [];
  configureNotify({ send: async () => "delivered", clock: () => t, phone: async (m) => { rang.push([m.channel, m.phone]); return "delivered"; } });
  const s = chain();
  const alerts = [A("h1:Possible colic — look at the horse now:2026-10-04", "Possible colic — look at the horse now")];
  await tick({ alerts, settings: s });
  assert.deepEqual(rang, [["call", "+919800000001"], ["sms", "+919800000001"]], "a call, and the text with the link");
  t += 10 * 60000; await tick({ alerts, settings: s });
  assert.deepEqual(rang.slice(2), [["whatsapp", "+919800000002"]]);
  t += 10 * 60000; await tick({ alerts, settings: s });
  assert.deepEqual(rang.slice(3), [["call", "+919800000003"], ["sms", "+919800000003"]]);
  t += 60 * 60000; await tick({ alerts, settings: s });
  assert.equal(rang.length, 5, "the chain ends with the officer");
  configureNotify({});
});

test("a number is called at most once an hour (texted instead); watch notes are texts to staff only", async () => {
  resetNotify();
  let t = NOW;
  const rang = [];
  configureNotify({ send: async () => "delivered", clock: () => t, phone: async (m) => { rang.push([m.channel, m.phone]); return "delivered"; } });
  const s = chain();
  await tick({ alerts: [A("a1", "Possibly cast — check the horse now")], settings: s });
  t += 5 * 60000;
  await tick({ alerts: [A("a1", "Possibly cast — check the horse now"), A("a2", "Dangerous heat in the stall")], settings: s });
  assert.deepEqual(rang.map((x) => x[0]), ["call", "sms", "sms"], "second alert within the hour: a text");
  rang.length = 0;
  await tick({ alerts: [A("w1", "Person at the stall at night", "warn")], settings: s });
  assert.deepEqual(rang, [["sms", "+919800000001"]]);
  t += 60 * 60000;
  rang.length = 0;
  await tick({ alerts: [A("w1", "Person at the stall at night", "warn")], settings: s });
  assert.equal(rang.length, 0, "watch notes are not escalated");
  resetNotify(); rang.length = 0;
  await tick({ alerts: [A("w2", "Hot, humid stall", "warn")], settings: chain({ warnToStaff: false }) });
  assert.equal(rang.length, 0, "switched off");
  configureNotify({});
});

test("no telephony account: nothing dialled, the chain still runs on the webhook", async () => {
  resetNotify();
  const sent = [];
  configureNotify({ send: async (p) => { sent.push(p); return "delivered"; } });
  await tick({ alerts: [A("n1", "Possible colic — look at the horse now")], settings: chain() });
  assert.deepEqual([sent[0].to, sent[0].role], ["+919800000001", "Stall staff"]);
  configureNotify({});
});

test("the message: horse first, a signed link to acknowledge", () => {
  process.env.EQUICARE_PUBLIC_URL = "https://stable.example/";
  const a = A("h1:Possible colic — look at the horse now:2026-10-04", "Possible colic — look at the horse now");
  const { text, voice } = messageOf(a, { level: 2, minutes: 10 });
  assert.match(text, /^EquiCare \(not acknowledged for 10 min\): Zarina — Possible colic/);
  assert.match(text, /Two signs together\.\n/);
  const link = ackLink(a.id);
  assert.ok(text.includes(link));
  assert.match(link, /^https:\/\/stable\.example\/api\/ack\/h1%3A/);
  const sig = new URL(link).searchParams.get("s");
  assert.equal(ackValid(a.id, sig), true);
  assert.equal(ackValid("h1:other:2026-10-04", sig), false, "a link acknowledges only its own alert");
  assert.match(voice, /Zarina: Possible colic, look at the horse now/);
  delete process.env.EQUICARE_PUBLIC_URL;
});
