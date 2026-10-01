// The wearable set — leg tag, halter hub (head), pelvis sensor: the horse
// page's `motion` block, the wearable and trot-lameness watch notes (worded as
// prototype observations), and points 9–10 of the session and client reports.
// Everything is synthetic; nothing here has been validated on a horse.
//
// The clock is pinned to 14:00 local today: "today" is the stable's calendar
// day, so a test must not depend on the hour it happens to run at.
import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildAlerts, motionForHorse, summarizeHorse } from "./rollup.mjs";
import { sessionReport } from "./session.mjs";
import { clientReport } from "./client_report.mjs";

const BIO = { id: "test", name: "Testy", stall: "T-01" };
const H = 3600 * 1000, MIN = 60000;
let NOW;
beforeEach(() => {
  const d = new Date(); d.setHours(14, 0, 0, 0); NOW = d.getTime();
  mock.timers.enable({ apis: ["Date"], now: NOW });
});
afterEach(() => mock.timers.reset());

const ago = (hours) => new Date(NOW - hours * H).toISOString();
const dayAt = (daysAgo, h, m = 0) => { const d = new Date(NOW); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d.toISOString(); };
const R = (metric, value, ts, meta = {}, source = "imu") => ({ horseId: BIO.id, stallId: BIO.stall, metric, value, unit: null, source, confidence: 1, ts, meta });
const camera = () => Array.from({ length: 12 }, (_, i) => R("body_temp_c", 37.6, ago(i / 6), {}, "test"));
const status = (sensor, pct, ts, meta = {}) => R("device_status", pct, ts, { sensor, hardwareId: `${sensor.toUpperCase()}-1`, signalDbm: -80, attached: true, ...meta });
const trot = (mm, ts, limb = "LF", extra = {}) => R("lameness_result", mm, ts,
  { limb, head: { minDiffMm: mm, maxDiffMm: mm / 2 }, pelvis: null, strides: 24, durationS: 20, prototype: true, ...extra });
const steps = (n, ts, meta = {}) => R("steps", n, ts, { sensor: "leg", periodMin: 60, prototype: true, ...meta });
const alerts = (rd) => buildAlerts([BIO], rd, () => false);
const find = (rd, re) => alerts(rd).find((a) => re.test(a.type));

// ---- the horse page: motion ------------------------------------------------ //
test("motion is null without any wearable data", () => {
  assert.equal(motionForHorse(camera()), null);
  assert.notEqual(motionForHorse([status("leg", 90, ago(0.1))]), null, "a status alone is wearable data");
});

test("steps: today and 7 days from the leg tag's live counts; raw-session counts never double them", () => {
  const rd = [...camera()];
  for (let h = 0; h < 14; h++) rd.push(steps(100, dayAt(0, h, 30)));
  rd.push(steps(900, dayAt(0, 10), { rawSessionIds: ["s1"], sensor: undefined }));    // same strides, from the upload
  rd.push(steps(2000, dayAt(2, 11), { rawSessionIds: ["s0"], sensor: undefined }));    // a day with only an upload
  rd.push(steps(0, dayAt(4, 3)));                                                       // a counted zero stays zero
  const m = motionForHorse(rd);
  assert.equal(m.stepsToday, 1400);
  assert.deepEqual(m.steps7d, [null, null, 0, null, 2000, null, 1400]);
  const noneToday = motionForHorse([...camera(), steps(500, dayAt(1, 9))]);
  assert.equal(noneToday.stepsToday, null, "no count today is not 0 steps");
});

test("lameness: the latest trot against the horse's own normal, with head/pelvis detail", () => {
  const rd = [trot(6, dayAt(5, 9)), trot(8, dayAt(4, 9)), trot(7, dayAt(3, 9)), trot(15, ago(2), "LF", { pelvis: { minDiffMm: 2, maxDiffMm: 1 } })];
  const m = motionForHorse(rd);
  assert.deepEqual(m.lameness, { at: ago(2), limb: "LF", valueMm: 15, headMinDiffMm: 15, headMaxDiffMm: 7.5,
    pelvisMinDiffMm: 2, pelvisMaxDiffMm: 1, strides: 24, baselineMm: 7, flagged: true });
  assert.deepEqual(m.lamenessRecent.map((x) => x.valueMm), [15, 7, 8, 6], "newest first");
  assert.equal(motionForHorse([...rd.slice(0, 3), trot(10, ago(2))]).lameness.flagged, false, "+3 mm is within its normal");
  const first = motionForHorse([trot(12.5, ago(2), null)]).lameness;
  assert.equal(first.baselineMm, null, "no normal yet");
  assert.equal(first.flagged, true, "12 mm without a normal");
  assert.equal(first.limb, null);
});

test("exercise: live while the session is open and the leg tag or GPS reported in the last 5 min", () => {
  const start = new Date(NOW - 20 * MIN).toISOString();
  const rd = [R("exercise_session", 12, new Date(NOW - 8 * MIN).toISOString(), { start, end: null, steps: 1500, distanceM: null, trotMin: 4, prototype: true }),
    R("gps_fix", 3.456, new Date(NOW - 2 * MIN).toISOString(), { lat: 28.6, lon: 77.2, accuracyM: 5 }),
    steps(1200, new Date(NOW - 15 * MIN).toISOString(), { periodMin: 5 }), steps(900, new Date(NOW - 5 * MIN).toISOString(), { periodMin: 5 }),
    steps(300, new Date(NOW - 40 * MIN).toISOString(), { periodMin: 5 })];                 // before the session
  const e = motionForHorse(rd).exercise;
  assert.deepEqual(e, { at: start, minutes: 20, steps: 2100, distanceM: null, live: true, speedMps: 3.46 });
  mock.timers.setTime(NOW + 10 * MIN);                                                     // the hub went quiet
  assert.equal(motionForHorse(rd).exercise.live, false);
  assert.equal(motionForHorse(rd).exercise.speedMps, null);
});

test("exercise: a finished session reports its own figures, not live", () => {
  const e = motionForHorse([R("exercise_session", 35, ago(3), { start: ago(3.6), end: ago(3), steps: 4200, distanceM: 5100, trotMin: 12, prototype: true })]).exercise;
  assert.deepEqual(e, { at: ago(3.6), minutes: 35, steps: 4200, distanceM: 5100, live: false, speedMps: null });
});

test("wearable: one row per sensor (leg, head, pelvis), the newest status each; 'came off' overrides attached", () => {
  const rd = [status("pelvis", 55, ago(0.2), { hardwareId: "P-L" }), status("pelvis", 61, ago(0.2), { hardwareId: "P-R" }),
    status("head", 30, ago(1)), status("head", 28, ago(0.1), { signalDbm: -95 }), status("leg", 90, ago(0.5)),
    R("device_detached", 1, ago(0.3), { sensor: "leg" })];
  const w = motionForHorse(rd).wearable;
  assert.equal(w.lastSeen, ago(0.1));
  assert.deepEqual(w.sensors.map((s) => [s.sensor, s.batteryPct, s.signalDbm, s.attached]),
    [["leg", 90, -80, false], ["head", 28, -95, true], ["pelvis", 55, -80, true], ["pelvis", 61, -80, true]]);
  assert.equal(motionForHorse([steps(10, ago(1))]).wearable, null, "no status: nothing known about the sensors");
});

test("motion has exactly the fields the horse page expects", () => {
  const m = motionForHorse([steps(10, ago(1))]);
  assert.deepEqual(Object.keys(m).sort(), ["exercise", "lameness", "lamenessRecent", "steps7d", "stepsToday", "wearable"]);
  assert.equal(m.steps7d.length, 7);
  assert.equal(m.lameness, null);
  assert.equal(m.exercise, null);
});

// ---- wearable watch notes ------------------------------------------------------ //
test("battery under 20 % in the last hour -> an 'ok' reminder that keeps the horse calm", () => {
  const rd = [...camera(), status("leg", 15, ago(0.2)), status("head", 80, ago(0.2))];
  const a = find(rd, /^Charge the/);
  assert.equal(a.type, "Charge the leg sensor");
  assert.equal(a.severity, "ok");
  assert.match(a.detail, /^Battery 15% \(LEG-1\) on the leg sensor/);
  assert.equal(summarizeHorse(BIO, rd).status, "calm");
  assert.equal(find([...camera(), status("leg", 15, ago(1.5)), status("head", 80, ago(0.1))], /^Charge the/), undefined, "status 90 min old");
  assert.equal(find([...camera(), status("leg", 15, ago(0.5)), status("leg", 95, ago(0.1))], /^Charge the/), undefined, "charged since");
});

test("a sensor that came off in the last 2 h -> watch, unless it reports being back on", () => {
  const rd = [...camera(), status("pelvis", 70, ago(1.5)), R("device_detached", 1, ago(1), { sensor: "pelvis" }), status("leg", 80, ago(0.1))];
  const a = find(rd, /^Wearable came off$/);
  assert.equal(a.severity, "warn");
  assert.match(a.detail, /^The pelvis sensor reported coming off at 13:00 — refit it/);
  assert.equal(find([...rd, status("pelvis", 70, ago(0.5), { attached: true })], /^Wearable came off$/), undefined);
});

test("wearable silent 20 min while the stall reports -> watch; a whole-site silence is the gap rule's", () => {
  const rd = [...camera(), status("leg", 80, ago(1)), status("leg", 80, ago(0.5))];
  const a = find(rd, /^Wearable not reporting$/);
  assert.equal(a.severity, "warn");
  assert.match(a.detail, /^Nothing from Testy's wearable for 30m while the stall's other sensors are reporting/);
  assert.equal(find([...rd, status("leg", 80, ago(0.1))], /^Wearable not reporting$/), undefined);
  assert.equal(find([...rd, steps(40, ago(0.05))], /^Wearable not reporting$/), undefined, "steps from the leg tag are the wearable reporting");
  assert.equal(find([status("leg", 80, ago(1))], /^Wearable not reporting$/), undefined, "nothing else reporting either");
});

test("trot lameness vs own normal: +6 mm, or 12 mm with no normal -> a prototype watch note", () => {
  const history = [trot(6, dayAt(5, 9)), trot(8, dayAt(4, 9)), trot(7, dayAt(3, 9))];
  const a = find([...camera(), ...history, trot(14, ago(1))], /^Possible lameness — /);
  assert.equal(a.type, "Possible lameness — left fore");
  assert.equal(a.severity, "warn");
  assert.match(a.detail, /^Prototype trot measure: 14\.0 mm asymmetry \(left fore\), \+7\.0 mm on its usual 7\.0 mm — from the wearable, not yet validated/);
  assert.equal(find([...camera(), ...history, trot(11, ago(1))], /^Possible lameness — /), undefined, "+4 mm");
  assert.match(find([...camera(), trot(13, ago(1), "RH")], /^Possible lameness — /).detail, /no earlier trots to compare with/);
  assert.equal(find([...camera(), trot(10, ago(1))], /^Possible lameness — /), undefined, "10 mm without a normal");
  assert.equal(find([...camera(), trot(20, dayAt(4, 9))], /^Possible lameness — /), undefined, "a 4-day-old trot is not news");
  assert.equal(find([...camera(), trot(13, ago(1), null)], /^Possible lameness — /).type, "Possible lameness — limb unclear");
});

test("the legacy gait-asymmetry rule still stands beside the trot rule", () => {
  const rd = [...camera(), R("gait_asymmetry", 0.42, ago(0.5), {}, "test"), trot(14, ago(1))];
  const types = alerts(rd).map((a) => a.type);
  assert.ok(types.includes("Possible lameness"));
  assert.ok(types.includes("Possible lameness — left fore"));
});

test("wearable lying and activity are prototype: worded so, and never a colic alarm", () => {
  const rd = [...camera()];
  for (let h = 0; h < 4; h++) rd.push(R("activity_index", 0.85, ago(h), { sensor: "leg", prototype: true }), R("rest_minutes", 2, ago(h), { sensor: "leg", prototype: true }));
  const types = alerts(rd).map((a) => a.type);
  assert.ok(!types.includes("Abnormal activity — colic pattern"), "prototype activity must not raise the colic alarm");
  assert.match(find(rd, /^Low lying-down time$/).detail, /Prototype wearable measure, not yet validated/);
});

// ---- points 9–10 in the session report ------------------------------------------ //
const from = Date.parse("2026-09-27T11:00:00Z"), to = from + H;
const inWin = (min) => new Date(from + min * 60000).toISOString();

test("session: steps and trot results summarised as prototype, against the horse's own normal", () => {
  const rd = [];
  for (let m = 0; m < 60; m += 10) rd.push(steps(140, inWin(m), { periodMin: 10 }));
  rd.push(steps(700, inWin(20), { rawSessionIds: ["s1"], sensor: undefined }));          // not added to the live counts
  rd.push(R("exercise_session", 25, inWin(30), { start: inWin(5), end: inWin(30), steps: 3000, distanceM: 2400, trotMin: 12, prototype: true }));
  for (const d of [3, 2, 1]) rd.push(trot(7, new Date(from - d * 24 * H).toISOString()));
  rd.push(trot(18.4, inWin(28)));
  const rep = sessionReport({ readings: rd, from, to });
  const p = (n) => rep.points.find((x) => x.n === n);
  assert.equal(p(9).status, "prototype");
  assert.match(p(9).summary, /^840 steps in 6 counts covering ~60 of 60 min; 1 exercise session, 25 min in all\.$/);
  assert.match(p(9).notes.join(" "), /hoof strikes × 4/);
  assert.equal(p(10).status, "prototype");
  assert.match(p(10).summary, /^1 straight trot analysed; latest 18\.4 mm asymmetry at .* \(left fore favoured\), \+11\.4 mm on this horse's usual 7 mm\. Flagged for a trot-up\.$/);
  assert.equal(p(10).flagged, true);
});

test("session: no wearable -> not measured; wearable readings are not camera coverage", () => {
  const p = (rep, n) => rep.points.find((x) => x.n === n);
  const none = sessionReport({ readings: [], from, to });
  assert.equal(p(none, 9).status, "not measured");
  assert.equal(p(none, 10).status, "not measured");
  const rd = [];
  for (let m = 0; m < 60; m++) rd.push(status("leg", 80, inWin(m)), steps(2, inWin(m), { periodMin: 1 }));
  const rep = sessionReport({ readings: rd, from, to });
  assert.equal(rep.coverage.minutesWithData, 0, "a hub reporting every minute does not make the camera live");
  assert.deepEqual(rep.coverage.gaps.map((g) => g.minutes), [60]);
  assert.equal(rep.coverage.readings, 60, "device status is a diagnostic, not a reading");
});

// ---- rows 9–10 in the client report --------------------------------------------- //
const cell = (html, name) => html.match(new RegExp(`${name.replace(/[()]/g, "\\$&")}<small>Point \\d+</small></td><td class="pt-val">([^<]*)</td><td><span class="st (\\w+)">.*?</span></td><td class="pt-note">([^<]*)</td>`));
const horse = { id: "tara", name: "Tara", stall: "07" };

test("client report: steps and trot rows from the wearable; camera coverage excludes it", async () => {
  const rd = [];
  for (let m = 0; m < 60; m += 10) rd.push(steps(140, inWin(m), { periodMin: 10 }), status("leg", 80, inWin(m)));
  rd.push(trot(18.4, inWin(28)));
  const { html } = await clientReport({ horse, readings: rd, from, to, tz: "UTC" });
  assert.deepEqual(cell(html, "Steps / locomotion").slice(1), ["840", "ok", "One leg's hoof strikes × 4."]);
  const [, val, st, note] = cell(html, "Lameness (trot)");
  assert.deepEqual([val, st], ["18.4 mm", "ok"]);
  assert.match(note, /^Left fore favoured \(1 trot\)\. A screening measure being validated; a vet should confirm\.$/);
  assert.match(html, /with data in 0% of the session/, "the wearable is not the camera");
  assert.equal((html.match(/Page \d of 5/g) || []).length, 5);
});

test("client report: no wearable -> Not captured, with what it needs", async () => {
  const { html } = await clientReport({ horse, readings: [], from, to, tz: "UTC" });
  assert.deepEqual(cell(html, "Steps / locomotion").slice(1), ["—", "cam", "Not monitored in this session."]);
  assert.deepEqual(cell(html, "Lameness (trot)").slice(1), ["—", "cam", "Not monitored in this session."]);
});
