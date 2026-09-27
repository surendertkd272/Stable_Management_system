// Session report: the 8 points over a window, honest about coverage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionReport } from "./session.mjs";

const to = Date.parse("2026-09-27T12:00:00Z"), from = to - 3600000;
const at = (min) => new Date(from + min * 60000).toISOString();
const R = (metric, value, min, extra = {}) => ({ metric, value, ts: at(min), source: "thermal_camera", confidence: 0.8, meta: {}, ...extra });

test("an hour with readings: every point summarised, coverage and gaps reported", () => {
  const rd = [];
  for (let m = 0; m < 40; m++) {
    rd.push(R("body_temp_c", 35 + (m % 3) * 0.1, m, { meta: { method: "eye box, hottest pixel" } }));
    rd.push(R("activity_index", m < 20 ? 0.1 : 0.4, m, { source: "visible_video" }));
    rd.push(R("inactive_minutes", m < 20 ? 1 : 0, m, { source: "visible_video", meta: { windowMin: 1 } }));
  }
  for (const m of [5, 15, 25]) rd.push(R("respiratory_rate_bpm", 12 + m / 10, m, { meta: { regularity: 0.8, method: "thermal video, nostril box" } }));
  rd.push(R("vice_event", 1, 30, { source: "visible_video", meta: { kind: "weaving", windowMin: 1 } }));
  rd.push(R("excretion_event", 1, 33, { source: "visible_video", confidence: 0.45, meta: { tier: "colour only" } }));
  rd.push(R("body_temp_c", 99, -30));                                           // before the window: ignored
  const rep = sessionReport({ readings: rd, from, to });
  assert.equal(rep.points.length, 8);
  const p = (n) => rep.points.find((x) => x.n === n);
  assert.equal(p(1).stats.n, 40, "only this window");
  assert.match(p(1).summary, /40 of 60 min/);
  assert.equal(p(3).stats.median, 13.5);
  assert.match(p(2).summary, /regular/);
  assert.equal(p(4).status, "prototype");
  assert.equal(p(5).status, "learning", "stillness but no lying yet: says learning, not 'no lying'");
  assert.match(p(5).summary, /Still \(not moving\) 20 of 60 min/);
  assert.match(p(6).summary, /weaving ~1 min/);
  assert.equal(p(7).status, "none seen");
  assert.match(p(8).summary, /1 seen/);
  assert.deepEqual(rep.coverage.gaps.map((g) => g.minutes), [21], "nothing after minute 39");
  assert.equal(rep.timeline.length, 2);
});

test("an hour with nothing: says not measured, never zero", () => {
  const rep = sessionReport({ readings: [], from, to });
  assert.equal(rep.coverage.readings, 0);
  for (const n of [1, 3, 4, 5, 7, 8]) assert.equal(rep.points.find((x) => x.n === n).status, "not measured");
  assert.deepEqual(rep.coverage.gaps.map((g) => g.minutes), [60]);
});
