// Rule-engine regression tests.  Run:  node --test server/    (or: node rollup.test.mjs)
//
// These pin the CLINICAL behaviour of the rollup engine. If a vet retunes a
// threshold in rollup.mjs, these tests tell you exactly which clinical
// conclusions changed. Every test builds its own synthetic reading set with
// explicit timestamps, so nothing depends on the simulator or a database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeHorse, buildAlerts, buildSeries, vitalsForHorse, metricSeries } from "./rollup.mjs";

const BIO = { id: "test", name: "Testy", stall: "T-01" };
const H = 3600 * 1000;

/** Reading helper: `ago` = hours before now. */
const R = (metric, value, agoHours = 0, extra = {}) => ({
  horseId: BIO.id, stallId: BIO.stall, metric, value,
  unit: null, source: "test", confidence: 1,
  ts: new Date(Date.now() - agoHours * H).toISOString(),
  ...extra,
});

/** A baseline "healthy, freshly-monitored" horse. */
function healthy() {
  const rd = [];
  for (let h = 0; h < 24; h++) {
    rd.push(R("body_temp_c", 37.6, h));
    rd.push(R("respiratory_rate_bpm", 12, h));
    rd.push(R("activity_index", h < 8 ? 0.1 : 0.25, h));
    rd.push(R("rest_minutes", h < 8 ? 45 : 10, h));   // ~7h lying
  }
  for (let d = 0; d < 7; d++) rd.push(R("water_ml", 24000, d * 24 + 1));  // stable baseline
  return rd;
}
const statusOf = (rd) => summarizeHorse(BIO, rd).status;
const types = (rd) => buildAlerts([BIO], rd, () => false).map((a) => a.type);

// --------------------------------------------------------------------------- //
test("healthy horse with fresh data is calm and raises no alerts", () => {
  const s = summarizeHorse(BIO, healthy());
  assert.equal(s.status, "calm");
  assert.equal(s.monitoring, "live");
  assert.equal(s.statusNote, "Within learned baseline");
  assert.deepEqual(types(healthy()), []);
});

// ---- monitoring gap: the safety net that stale data must not read as calm -- //
test("no data at all -> warn, never calm", () => {
  const s = summarizeHorse(BIO, []);
  assert.equal(s.status, "watch");
  assert.equal(s.monitoring, "no-data");
  assert.deepEqual(types([]), ["No monitoring data"]);
});

test("data 3h old -> stale warning, other rules still evaluated", () => {
  const rd = healthy().map((r) => ({ ...r, ts: new Date(Date.parse(r.ts) - 3 * H).toISOString() }));
  const s = summarizeHorse(BIO, rd);
  assert.equal(s.monitoring, "stale");
  assert.equal(s.status, "watch");
  assert.ok(types(rd).includes("Monitoring gap"));
});

test("data 8h old -> ALERT (horse is not being monitored) and downstream rules suppressed", () => {
  const rd = [R("body_temp_c", 39.5, 8)];        // a fever, but 8h stale
  const s = summarizeHorse(BIO, rd);
  assert.equal(s.monitoring, "offline");
  assert.equal(s.status, "urgent");
  const t = types(rd);
  assert.deepEqual(t, ["Monitoring offline"],
    "stale data must not produce clinical conclusions — only the offline alert");
});

// ---- point 2: body temperature -------------------------------------------- //
test("fever >= 38.6 C -> urgent alert", () => {
  const rd = [...healthy(), R("body_temp_c", 38.9, 0)];
  assert.equal(statusOf(rd), "urgent");
  assert.ok(types(rd).includes("Elevated body temperature"));
});

test("38.4 C -> watch (rising), not urgent", () => {
  const rd = [...healthy(), R("body_temp_c", 38.4, 0)];
  assert.equal(statusOf(rd), "watch");
  assert.ok(types(rd).includes("Body temperature rising"));
});

test("hypothermia <= 37.0 C -> urgent alert", () => {
  const rd = [...healthy(), R("body_temp_c", 36.8, 0)];
  assert.equal(statusOf(rd), "urgent");
  assert.ok(types(rd).includes("Low body temperature"));
});

test("37.6 C sits inside the normal band", () => {
  assert.equal(statusOf([...healthy(), R("body_temp_c", 37.6, 0)]), "calm");
});

// ---- point 4: respiratory rate -------------------------------------------- //
test("resting resp >= 24 bpm -> urgent", () => {
  const rd = [...healthy(), R("respiratory_rate_bpm", 26, 0)];
  assert.equal(statusOf(rd), "urgent");
  assert.ok(types(rd).includes("High respiratory rate"));
});

test("resting resp 21 bpm -> watch", () => {
  const rd = [...healthy(), R("respiratory_rate_bpm", 21, 0)];
  assert.equal(statusOf(rd), "watch");
  assert.ok(types(rd).includes("Respiratory pattern"));
});

// ---- point 5/6: colic pattern (high activity + not lying) ----------------- //
test("restless + not lying -> colic alert", () => {
  const rd = [];
  for (let h = 0; h < 24; h++) rd.push(R("body_temp_c", 37.6, h));
  for (let h = 0; h < 4; h++) { rd.push(R("activity_index", 0.85, h)); rd.push(R("rest_minutes", 2, h)); }
  assert.equal(statusOf(rd), "urgent");
  assert.ok(types(rd).includes("Abnormal activity — colic pattern"));
});

test("low lying time alone -> watch, not colic", () => {
  const rd = [];
  for (let h = 0; h < 24; h++) {
    rd.push(R("body_temp_c", 37.6, h));
    rd.push(R("activity_index", 0.2, h));       // calm
    rd.push(R("rest_minutes", 4, h));           // ~1.6h lying — below floor
  }
  const t = types(rd);
  assert.ok(t.includes("Low lying-down time"));
  assert.ok(!t.includes("Abnormal activity — colic pattern"));
  assert.equal(statusOf(rd), "watch");
});

// ---- point 7: lameness ---------------------------------------------------- //
test("gait asymmetry >= 0.35 -> lameness watch", () => {
  const rd = [...healthy(), R("gait_asymmetry", 0.42, 0)];
  assert.ok(types(rd).includes("Possible lameness"));
  assert.equal(statusOf(rd), "watch");
});

// ---- point 9: water vs the horse's OWN learned baseline ------------------- //
test("water far below own baseline -> watch", () => {
  const rd = [];
  for (let h = 0; h < 24; h++) { rd.push(R("body_temp_c", 37.6, h)); rd.push(R("rest_minutes", 25, h)); }
  // baseline days sit clearly OUTSIDE the last-24h window (+3h offset), so the
  // "today" sum can't accidentally include one of them.
  for (let d = 1; d < 7; d++) rd.push(R("water_ml", 30000, d * 24 + 3)); // baseline ~30 L/day
  rd.push(R("water_ml", 6000, 1));                                      // today only 6 L
  const t = types(rd);
  assert.ok(t.includes("Low water intake"), `got ${JSON.stringify(t)}`);
});

test("water at baseline -> no water alert", () => {
  assert.ok(!types(healthy()).includes("Low water intake"));
});

// ---- point 8: vices are informational, not a status downgrade ------------- //
test("vice event is an 'ok' note and keeps the horse calm", () => {
  const rd = [...healthy(), R("vice_event", 1, 1, { meta: { kind: "crib_biting" } })];
  const alerts = buildAlerts([BIO], rd, () => false);
  const vice = alerts.find((a) => a.type === "Stable vice");
  assert.ok(vice);
  assert.equal(vice.severity, "ok");
  assert.match(vice.detail, /crib-biting/);
  assert.equal(statusOf(rd), "calm", "an informational note must not change status");
});

// ---- severity precedence + summary fields -------------------------------- //
test("alert outranks warn for status and statusNote", () => {
  const rd = [...healthy(), R("body_temp_c", 39.0, 0), R("gait_asymmetry", 0.5, 0)];
  const s = summarizeHorse(BIO, rd);
  assert.equal(s.status, "urgent");
  assert.match(s.statusNote, /temperature/i);
});

test("alerts are ordered alert > warn > ok", () => {
  const rd = [...healthy(), R("body_temp_c", 39.0, 0), R("gait_asymmetry", 0.5, 0),
              R("vice_event", 1, 1, { meta: { kind: "weaving" } })];
  const sev = buildAlerts([BIO], rd, () => false).map((a) => a.severity);
  assert.deepEqual(sev, [...sev].sort((a, b) => ({ alert: 0, warn: 1, ok: 2 }[a] - { alert: 0, warn: 1, ok: 2 }[b])));
});

test("acknowledgement is reflected via the isAcked callback", () => {
  const rd = [...healthy(), R("body_temp_c", 39.0, 0)];
  const all = buildAlerts([BIO], rd, () => true);
  assert.ok(all.length > 0);
  assert.ok(all.every((a) => a.acknowledged));
});

// ---- SPA contract: shapes must not drift --------------------------------- //
test("summarizeHorse emits every field the SPA Horse type requires", () => {
  const s = summarizeHorse({ ...BIO, breed: "b", age: "1 yr", sex: "Mare", owner: "o", photo: "p" }, healthy());
  for (const f of ["id", "name", "breed", "age", "sex", "stall", "owner", "photo",
                   "status", "statusNote", "rest", "water", "outside", "stress", "baselineProgress"])
    assert.ok(f in s, `missing field: ${f}`);
  assert.match(s.rest, /^\d+h \d{2}m$/);
  assert.ok(["Low", "Medium", "High"].includes(s.stress));
  assert.ok(["calm", "watch", "urgent"].includes(s.status));
});

test("buildAlerts emits every field the SPA Alert type requires", () => {
  const a = buildAlerts([BIO], [...healthy(), R("body_temp_c", 39, 0)], () => false)[0];
  for (const f of ["id", "horse", "type", "severity", "time", "detail", "acknowledged"])
    assert.ok(f in a, `missing field: ${f}`);
  assert.ok(["alert", "warn", "ok"].includes(a.severity));
  assert.equal(a.horse, BIO.name);
});

test("buildSeries returns exactly 7 points per series", () => {
  const s = buildSeries([BIO], healthy());
  for (const k of ["monitored", "rest", "water", "outside", "alerts"]) {
    assert.equal(s[k].length, 7, `${k} must have 7 points`);
    // null is legal and means "no sensor for this"; anything present must be
    // a real finite number — never NaN or undefined.
    assert.ok(s[k].every((n) => n === null || Number.isFinite(n)), `${k} must be numbers or null`);
  }
});

test("un-sensed metrics report null, not zero (camera-only install)", () => {
  // Only camera metrics arrive — the case for the live demo, where no IMU,
  // flow meter or feeder exists. Reporting 0 rest and 0 water would describe a
  // horse that never lay down and drank nothing: an animal in crisis. It must
  // read as "not measured" instead.
  const cameraOnly = [R("body_temp_c", 37.6, 0), R("respiratory_rate_bpm", 12, 0)];
  const h = summarizeHorse(BIO, cameraOnly);
  assert.equal(h.rest, null, "rest must be null when nothing measures it");
  assert.equal(h.water, null, "water must be null when nothing measures it");
  assert.equal(h.outside, null, "outside must be null when nothing measures it");
  assert.ok(h.uninstrumented.includes("rest_minutes"));
  assert.ok(h.uninstrumented.includes("water_ml"));
  // the camera metrics we DO have must not be listed as missing
  assert.ok(!h.uninstrumented.includes("body_temp_c"));
  assert.equal(h.monitoring, "live", "camera data is live even though other points are absent");

  const s = buildSeries([BIO], cameraOnly);
  assert.ok(s.rest.every((v) => v === null), "rest sparkline must be a gap, not a zero line");
  assert.ok(s.water.every((v) => v === null), "water sparkline must be a gap, not a zero line");
});

test("a real measured zero still reports as zero, not as unmeasured", () => {
  // The mirror case: if a sensor IS present and genuinely reports no rest and
  // no water, that is a finding we must show, not hide behind "not measured".
  const withSensors = [R("body_temp_c", 37.6, 0), R("rest_minutes", 0, 1),
                       R("water_ml", 0, 1), R("outside_minutes", 0, 1)];
  const h = summarizeHorse(BIO, withSensors);
  assert.notEqual(h.rest, null, "measured zero rest must not be hidden");
  assert.notEqual(h.outside, null);
  assert.ok(!h.uninstrumented.includes("rest_minutes"));
});

test("baselineProgress scales with days of data and caps at 100", () => {
  const oneDay = [R("body_temp_c", 37.6, 0)];
  assert.ok(summarizeHorse(BIO, oneDay).baselineProgress <= 100 / 14 + 1);
  const many = [];
  for (let d = 0; d < 30; d++) many.push(R("body_temp_c", 37.6, d * 24));
  assert.equal(summarizeHorse(BIO, many).baselineProgress, 100);
});

// ---- helpers -------------------------------------------------------------- //
test("vitalsForHorse keeps the newest sample per metric", () => {
  const v = vitalsForHorse([R("body_temp_c", 37.0, 5), R("body_temp_c", 38.2, 0), R("steps", 100, 1)]);
  assert.equal(v.body_temp_c.value, 38.2);
  assert.equal(v.steps.value, 100);
});

test("metricSeries averages per day and leaves un-measured days null", () => {
  const s = metricSeries([R("body_temp_c", 37.0, 0), R("body_temp_c", 39.0, 0)], "body_temp_c", 7, "avg");
  assert.equal(s.length, 7);
  assert.equal(s[6], 38);                       // today = mean(37,39)
  // A day with no reading must not become 0. Padded zeros drew a horse's
  // 7-day temperature as a plunge to 0 °C on the panel a vet reads.
  assert.equal(s[0], null);                     // 6 days ago = not measured
  assert.ok(!s.slice(0, 6).some((v) => v === 0), "must never pad with zero");
});

test("metricSeries sums when asked", () => {
  const s = metricSeries([R("rest_minutes", 30, 0), R("rest_minutes", 45, 0)], "rest_minutes", 7, "sum");
  assert.equal(s[6], 75);
});
