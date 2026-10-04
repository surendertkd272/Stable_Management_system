// Body temperature from the cameras alone (server/core-temp.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cameraBodyTemp, bodyTemperature, eyeNormal, isFever, temperatureAlerts, normalFor, FEVER_C } from "./core-temp.mjs";

const H = 3600e3, DAY = 24 * H;
const NOW = Date.parse("2026-10-04T18:00:00");      // local time
const iso = (ms) => new Date(ms).toISOString();
const EYE = (v, ms, meta = {}) => ({ horseId: "h1", metric: "body_temp_c", source: "thermal_camera", value: v, ts: iso(ms), meta: { calibrated: true, ...meta } });
const bio = { id: "h1", name: "Badal" };

/** A fortnight of eye readings every 20 min: cooler before dawn, warmer in the evening. */
function fortnight({ days = 14, base = 35.0, swing = 0.4, bg = null } = {}) {
  const rd = [];
  for (let t = NOW - days * DAY; t <= NOW - 7 * H; t += 20 * 60000) {
    const hr = new Date(t).getHours() + new Date(t).getMinutes() / 60;
    const tod = swing * Math.sin(((hr - 12) / 24) * 2 * Math.PI);        // lowest ~06:00, highest ~18:00
    const b = bg === null ? undefined : bg(t);
    rd.push(EYE(+(base + tod + (b === undefined ? 0 : 0.3 * (b - 25))).toFixed(2), t, b === undefined ? {} : { bgC: b }));
  }
  return rd;
}
const now30 = (v, extra = {}) => [0, 10, 20].map((m) => EYE(v, NOW - m * 60000, extra));

test("species normals", () => {
  assert.equal(normalFor({}), 37.8);
  assert.equal(normalFor({ species: "Donkey" }), 37.1);
  assert.equal(normalFor({ species: "mule" }), 37.6);
});

test("learning until 3 days of eye readings; no body temperature is invented meanwhile", () => {
  const rd = [...fortnight({ days: 1.2 }), ...now30(35.4)];
  const c = cameraBodyTemp(bio, rd, NOW);
  assert.equal(c.learning, true);
  assert.equal(c.value, null);
  assert.equal(bodyTemperature(bio, rd, NOW).current, null);
  assert.equal(cameraBodyTemp(bio, fortnight(), NOW), null, "no eye in the last 30 min: nothing to report now");
});

test("a usual eye reads as a usual body temperature, at this time of day", () => {
  const rd = [...fortnight(), ...now30(35.4)];          // 18:00 is the evening high: 35.0 + 0.4
  const c = cameraBodyTemp(bio, rd, NOW);
  assert.equal(c.value, 37.8);
  assert.equal(c.rise, 0);
  assert.equal(c.settled, true);
  assert.ok(!isFever(c));
  assert.deepEqual(temperatureAlerts(bio, rd, NOW), []);
  // the same 35.4 °C at dawn is 0.8 above that hour's normal
  const dawn = Date.parse("2026-10-05T06:00:00");
  const atDawn = cameraBodyTemp(bio, [...fortnight(), ...[0, 10].map((m) => EYE(35.4, dawn - m * 60000))], dawn);
  assert.ok(atDawn.rise >= 0.7, `rise ${atDawn.rise}`);
});

test("a fever: the eye well above its own normal", () => {
  const rd = [...fortnight(), ...now30(36.6)];
  const c = cameraBodyTemp(bio, rd, NOW);
  assert.equal(c.value, 39.0);
  assert.ok(isFever(c));
  const a = temperatureAlerts(bio, rd, NOW);
  assert.deepEqual(a.map((x) => [x.type, x.severity]), [["Possible fever", "alert"]]);
  assert.match(a[0].detail, /about 39\.0 °C by the thermal camera/);
});

test("rising: past the everyday range but short of fever", () => {
  const rd = [...fortnight(), ...now30(36.0)];
  const a = temperatureAlerts(bio, rd, NOW);
  assert.deepEqual(a.map((x) => [x.type, x.severity]), [["Body temperature rising", "warn"]]);
});

test("a horse whose eye wanders a lot needs a bigger rise", () => {
  // ±0.6 °C of everyday noise: the ± grows, so +0.8 is no longer past it
  let k = 0;
  const noisy = fortnight({ swing: 0 }).map((r) => ({ ...r, value: r.value + [0.6, -0.6, 0.3, -0.3][k++ % 4] }));
  const n = eyeNormal(noisy, NOW);
  assert.ok(n.spread >= 0.8, `spread ${n.spread}`);
  const c = cameraBodyTemp(bio, [...noisy, ...now30(35.85)], NOW);
  assert.ok(!isFever(c), "within this horse's everyday range");
});

test("a warmer stall warms the eye: allowed for, not called a fever", () => {
  // stall background 20–32 °C over the fortnight; the eye follows it at 0.3 °C per °C
  const bg = (t) => 26 + 6 * Math.sin(t / (3 * DAY));
  const rd = fortnight({ swing: 0, bg });
  const n = eyeNormal(rd, NOW);
  assert.ok(n.slope > 0.2 && n.slope < 0.4, `slope ${n.slope}`);
  // a hot afternoon: stall 34 °C, eye 35.0 + 0.3 × 9 = 37.7 — the stall, not a fever
  const hot = [...rd, ...now30(37.7, { bgC: 34 })];
  const c = cameraBodyTemp(bio, hot, NOW);
  assert.ok(Math.abs(c.rise) <= 0.3, `rise ${c.rise}`);
  assert.ok(!isFever(c));
});

test("readings with a person at the stall, or from an un-aimed camera, are not used", () => {
  const people = [0, 10, 20].map((m) => ({ horseId: "h1", metric: "people_in_view_s", value: 30, ts: iso(NOW - m * 60000), meta: {} }));
  const c = cameraBodyTemp(bio, [...fortnight(), ...now30(37.0), ...people], NOW);
  assert.equal(c, null, "a groom's hand near the eye is not the horse");
  const unaimed = now30(37.0).map((r) => ({ ...r, meta: { calibrated: false } }));
  assert.equal(cameraBodyTemp(bio, [...fortnight(), ...unaimed], NOW), null);
});

test("before the normal is learned: an eye at the fever line is still a fever", () => {
  const a = temperatureAlerts(bio, now30(38.8), NOW);
  assert.deepEqual(a.map((x) => x.type), ["Possible fever"]);
  assert.match(a[0].detail, /eye alone reads 38\.8 °C/);
  assert.deepEqual(temperatureAlerts(bio, now30(36.5), NOW), [], "while learning, below the line, nothing is judged");
});

test("two days with fever add the scheduled-disease note", () => {
  const rd = [...fortnight({ days: 16 }).filter((r) => Date.parse(r.ts) < NOW - 30 * H)];
  for (let t = NOW - 26 * H; t <= NOW; t += 20 * 60000) rd.push(EYE(36.6, t));
  const a = temperatureAlerts(bio, rd, NOW, { scheduledNote: "NOTE-2009-ACT" });
  assert.match(a[0].detail, /High on two days\. NOTE-2009-ACT/);
});

test("an older set-up's body sensor is shown as measured; the camera's body temperature comes first", () => {
  const sensor = { horseId: "h1", metric: "body_temp_c", value: 37.9, source: "wearable", ts: iso(NOW - H), meta: {} };
  assert.equal(bodyTemperature(bio, [sensor], NOW).current.value, 37.9);
  assert.equal(bodyTemperature(bio, [sensor], NOW).current.source, "sensor");
  assert.equal(bodyTemperature(bio, [...fortnight(), ...now30(35.4), sensor], NOW).current.source, "camera");
  assert.deepEqual(temperatureAlerts(bio, [{ ...sensor, value: 39.2 }], NOW), [], "its own fever rule is in rollup.mjs, not repeated here");
  assert.ok(FEVER_C === 38.6);
});
