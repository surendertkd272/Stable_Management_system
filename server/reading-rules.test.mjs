// One set of rules: the session report (and the Reports page, which shows it),
// the client PDF and the horse's normal count the same readings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionReport } from "./session.mjs";
import { clientReport } from "./client_report.mjs";
import { dailyValues } from "./baseline.mjs";
import { splitEye, setAsideNote } from "./reading-rules.mjs";

const T0 = Date.parse("2026-10-01T16:00:00Z");
const at = (min) => new Date(T0 + min * 60000).toISOString();
const R = (metric, value, min, meta = {}) => ({ horseId: "h", metric, value, ts: at(min), source: "camera", meta });
const readings = [
  R("body_temp_c", 36.5, 10), R("body_temp_c", 36.9, 20), R("body_temp_c", 36.7, 30),
  R("body_temp_c", 40.3, 40),                                   // people beside the camera
  R("body_temp_c", 37.4, 50), R("people_in_view_s", 30, 50),    // a person at the stall that minute
  R("body_temp_c", 31.0, 60),                                   // the coat, not the eye
  // four 'droppings' in two minutes as he lay down, and two real ones
  R("excretion_event", 1, 100), R("excretion_event", 1, 100.5), R("excretion_event", 1, 101), R("excretion_event", 1, 102),
  R("excretion_event", 1, 200), R("excretion_event", 1, 300),
  ...[...Array(400)].map((_, i) => R("activity_index", 0.1, i)),
];
const from = T0, to = T0 + 400 * 60000;

test("the eye: 33–39.5 °C and no person at the stall; the rest set aside, and said so", () => {
  const { used, setAside } = splitEye(readings);
  assert.deepEqual(used.map((r) => r.value), [36.5, 36.9, 36.7]);
  assert.match(setAsideNote(setAside), /^3 readings set aside: 40\.3 °C — too hot for an eye; 37\.4 °C — a person at the stall; 31\.0 °C — too cool for an eye\.$/);
});

test("session report, client PDF and the normal agree on the same window", async () => {
  const s = sessionReport({ readings, from, to, floorWatched: true });
  const p1 = s.points.find((p) => p.n === 1), p8 = s.points.find((p) => p.n === 8);
  assert.equal(p1.stats.median, 36.7);
  assert.equal(p1.stats.n, 3);
  assert.ok(p1.notes.some((n) => /3 readings set aside/.test(n)));
  assert.match(p8.summary, /^2 seen/);
  assert.ok(p8.notes.some((n) => /4 more floor changes set aside/.test(n)));

  const c = await clientReport({ horse: { id: "h", name: "Test", stall: "1" }, readings, from, to, floorWatched: true, tz: "UTC" });
  assert.equal(c.summary.eye.n, 3);
  assert.equal(c.summary.eye.median, 36.7);
  assert.equal(c.summary.floor.excretion, 2);

  const day = dailyValues(readings, "UTC").find((d) => d.eye !== null);
  assert.equal(day.eye, 36.7);
});
