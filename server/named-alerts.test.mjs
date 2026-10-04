// Named alerts (colic, foaling, night visitor, heat) and the call chain that
// carries them to people's phones.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.CAMERA_SECRET_KEY ??= "test-only-key";   // sign() must not write a key file
const { namedAlerts, colicSigns, foalingWindow, mareAndFoal, configureNamedAlerts, unusualScore, droppingsNow, stableAlerts, foalingPlan } = await import("./named-alerts.mjs");
const { configureCareLog } = await import("./care-log.mjs");
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
  const downs = [NOW - 50 * 60000, NOW - 30 * 60000, NOW - 10 * 60000].map(iso);
  const one = { resting: { downTimes: downs, lastRoll: null, lateralLast90Min: 0 } };
  assert.equal(namedAlerts(mare, [], one, NOW).length, 0, "one labour sign is not enough");
  const signs = { resting: { downTimes: downs, lastRoll: iso(NOW - 20 * 60000), lateralLast90Min: 0 } };
  const a = namedAlerts(mare, [], signs, NOW);
  assert.equal(a.length, 1);
  assert.equal(a[0].type, "Foaling may be starting — check the mare now");
  assert.match(a[0].detail, /day \d+ of pregnancy/);
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
  // 95 + 60 = 155: urgent only when the horse shows it
  assert.deepEqual(at(35, 60).map((x) => [x.type, x.severity]), [["Very hot, humid stall", "warn"]]);
  const panting = [r("respiratory_rate_bpm", 12, NOW - 10 * H), r("respiratory_rate_bpm", 12, NOW - 9 * H), r("respiratory_rate_bpm", 34, NOW - 5 * 60000)];
  const hot = namedAlerts(bio, [...panting, r("stall_temp_c", 35, NOW - 60000), r("stall_humidity_pct", 60, NOW - 60000)], null, NOW);
  assert.deepEqual(hot.map((x) => [x.type, x.severity]), [["Dangerous heat in the stall", "alert"]]);
  assert.match(hot[0].detail, /breathing 34\/min against usual 12/);
  const mule = namedAlerts({ ...bio, species: "mule" }, [...panting, r("stall_temp_c", 35, NOW - 60000), r("stall_humidity_pct", 60, NOW - 60000)], null, NOW);
  assert.equal(mule[0].type, "Very hot, humid stall", "mules may not breathe faster in heat");
  assert.match(mule[0].detail, /check by hand/);
});

test("droppings: judged against the horse's own normal, not judged when the camera misses most", () => {
  const every = (gapH, n, lastAgoH) => [...Array(n)].map((_, i) => r("excretion_event", 1, NOW - lastAgoH * H - i * gapH * H));
  assert.equal(droppingsNow(every(3, 60, 7), NOW).sign.startsWith("no droppings for 7 h"), true, "8 a day: 6 h is long");
  assert.equal(droppingsNow(every(3, 60, 5), NOW).sign, null);
  // about 5 a day, gaps of 2 and 8 h: its own longest normal gap (8 h, not 6 h) sets the line
  const uneven = (lastAgoH) => { const out = []; let t = NOW - lastAgoH * H; for (let i = 0; i < 66; i++) { out.push(r("excretion_event", 1, t)); t -= (i % 2 ? 8 : 2) * H; } return out; };
  assert.equal(droppingsNow(uneven(7), NOW).sign, null, "7 h is within this horse's normal gaps");
  assert.match(droppingsNow(uneven(9), NOW).sign, /no droppings for 9 h/);
  // fewer than 4 a day seen: more likely out of view
  assert.equal(droppingsNow(every(8, 40, 20), NOW).sign, null);
});

test("colic: one sign in a risk period is enough; droppings alone never are", () => {
  const rolling = { resting: { downTimes: [], lastRoll: iso(NOW - 30 * 60000), lateralLast90Min: 0 } };
  configureCareLog({ horses: [{ id: "h1" }], events: [{ kind: "hay_change", horseId: "*", at: iso(NOW - 2 * DAY) }] });
  const a = namedAlerts(bio, [], rolling, NOW);
  assert.equal(a[0]?.type, "Possible colic — look at the horse now");
  assert.match(a[0].detail, /in a risk period \(new batch of hay 2 days ago\)/);
  const drops = [...Array(60)].map((_, i) => r("excretion_event", 1, NOW - 9 * H - i * 3 * H));
  assert.equal(namedAlerts(bio, drops, null, NOW).length, 0, "no droppings alone: more often the camera than the horse");
  // five lie-downs in an hour is enough on its own
  configureCareLog({ horses: [{ id: "h1" }], events: [] });
  const five = { resting: { downTimes: [55, 45, 35, 20, 5].map((m) => iso(NOW - m * 60000)), lastRoll: null, lateralLast90Min: 0 } };
  assert.match(namedAlerts(bio, [], five, NOW)[0].detail, /5 lie-downs within an hour — on its own enough to look/);
});

test("foaling: from the covering date and the mare's own past pregnancies", () => {
  const p = foalingPlan({ coveredAt: "2025-11-01", pastGestationDays: [350, 356, 352] });
  assert.equal(p.expected, 352);
  assert.equal(p.fromOwnHistory, true);
  assert.equal(foalingWindow({ coveredAt: "2025-11-01", pastGestationDays: [350, 356, 352] }, NOW), true, "day 337: watching");
});

test("foal checks: standing, nursing, placenta — from staff entries", () => {
  const mare = { ...bio, foaledAt: iso(NOW - 3.5 * H), foaledTimeKnown: true };
  assert.deepEqual(namedAlerts(mare, [], null, NOW).map((a) => a.type), ["Foal not standing yet", "Foal not nursing yet", "Placenta not passed"]);
  const ok = { ...mare, foalStoodAt: iso(NOW - 3 * H), foalNursedAt: iso(NOW - 2 * H), placentaAt: iso(NOW - 2.5 * H) };
  assert.deepEqual(namedAlerts(ok, [], null, NOW), []);
  assert.deepEqual(namedAlerts({ ...mare, foaledTimeKnown: false }, [], null, NOW), [], "a date alone is not a time to count from");
});

test("hardly lying down three days running", () => {
  const rows = [];
  for (let t = NOW - 4 * DAY; t < NOW; t += H) rows.push(r("time_budget", 3600, t, { lyingS: 60, restingS: 1800, eatingS: 1200, movingS: 540 }));
  assert.deepEqual(namedAlerts(bio, rows, null, NOW).map((a) => a.type), ["Hardly lying down"]);
  const lies = rows.map((x, i) => (i % 6 ? x : { ...x, meta: { ...x.meta, lyingS: 1200 } }));
  assert.deepEqual(namedAlerts(bio, lies, null, NOW), []);
});

test("a new arrival in isolation: the camera must catch its temperature daily", () => {
  configureCareLog({ horses: [{ id: "h1", arrivedAt: iso(NOW - 3 * DAY) }], events: [] });
  const noon = Date.parse("2026-10-04T20:00:00");      // after 12:00 in the stable's time zone and in UTC
  assert.deepEqual(namedAlerts(bio, [], null, noon).map((a) => a.type), ["Isolation: no temperature today"]);
  const eye = [{ horseId: "h1", metric: "body_temp_c", source: "thermal_camera", value: 35, ts: iso(noon - H), meta: {} }];
  assert.deepEqual(namedAlerts(bio, eye, null, noon), []);
  configureCareLog({ horses: [{ id: "h1" }], events: [{ kind: "transport", horseId: "h1", at: iso(noon - 30 * H), hours: 22 }] });
  assert.deepEqual(namedAlerts(bio, [], null, noon).map((a) => a.type), ["Vet check due after a long journey"]);
  configureCareLog({ horses: [], events: [] });
});

test("several horses with fever, and outbreak mode", () => {
  const T = Date.parse("2026-10-04T18:00:00");
  const eyes = (id, now) => {
    const rd = [];
    for (let t = T - 10 * DAY; t <= T - 7 * H; t += H) rd.push({ horseId: id, metric: "body_temp_c", source: "thermal_camera", value: 35, ts: iso(t), meta: {} });
    for (const m of [0, 10, 20]) rd.push({ horseId: id, metric: "body_temp_c", source: "thermal_camera", value: now, ts: iso(T - m * 60000), meta: {} });
    return rd;
  };
  const roster = [{ id: "a", name: "Badal" }, { id: "b", name: "Toofan" }, { id: "c", name: "Chetak" }];
  const one = [...eyes("a", 36.3), ...eyes("b", 35.0), ...eyes("c", 35.1)];
  assert.deepEqual(stableAlerts(roster, one, T), []);
  const two = [...eyes("a", 36.3), ...eyes("b", 36.4), ...eyes("c", 35.1)];
  const s = stableAlerts(roster, two, T);
  assert.deepEqual(s.map((x) => [x.type, x.severity]), [["Several horses with fever", "alert"]]);
  assert.match(s[0].detail, /Badal, Toofan/);
  configureNamedAlerts({ outbreak: { active: true, disease: "Strangles", startedAt: iso(T - 10 * DAY), lastCaseAt: iso(T - 5 * DAY), quarantineDays: 28 } });
  const ob = stableAlerts(roster, one, T).find((x) => x.type === "Outbreak mode");
  assert.match(ob.detail, /Strangles: day 10\..*lifted in 23 days/);
  configureNamedAlerts({ outbreak: null });
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
