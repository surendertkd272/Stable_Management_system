// Session report: the 12 points over a window, honest about coverage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionReport } from "./session.mjs";
import { coverage, BREATHING_WHY } from "./contract.mjs";

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
  assert.equal(rep.points.length, 12, "1–8 from the camera, 9–12 from the wearable and stall sensors");
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

test("no floor area marked: urination and manure say not measured, not 'none seen'", () => {
  const rd = [];
  for (let m = 0; m < 30; m++) rd.push(R("activity_index", 0.4, m, { source: "visible_video" }));
  const p = (rep, n) => rep.points.find((x) => x.n === n);
  const unwatched = sessionReport({ readings: rd, from, to, floorWatched: false });
  for (const n of [7, 8]) {
    assert.equal(p(unwatched, n).status, "not measured");
    assert.match(p(unwatched, n).summary, /no floor area is marked/);
  }
  const watched = sessionReport({ readings: rd, from, to, floorWatched: true });
  for (const n of [7, 8]) assert.equal(p(watched, n).status, "none seen");
});

test("why breathing was missed: a breakdown by minute, and the check is not counted as a reading", () => {
  const rd = [];
  for (let m = 0; m < 30; m++) {
    rd.push(R("activity_index", 0.3, m, { source: "visible_video" }));
    const nostril = m < 18 ? "head_off_boxes" : m < 26 ? "head_moving" : "no_rhythm";
    rd.push(R("breathing_check", 0, m, { source: "thermal_video", meta: { nostril, flank: "no_flank_region" } }));
  }
  const rep = sessionReport({ readings: rd, from, to });
  const p3 = rep.points.find((x) => x.n === 3);
  assert.equal(p3.status, "not measured");
  assert.deepEqual(p3.why.nostril, { head_off_boxes: 18, head_moving: 8, no_rhythm: 4 });
  assert.match(p3.summary, new RegExp(`${BREATHING_WHY.head_off_boxes} 18, ${BREATHING_WHY.head_moving.replace(/[()]/g, "\\$&")} 8`));
  assert.equal(rep.coverage.readings, 30, "diagnostics are not readings");
  assert.ok(!coverage().some((c) => c.metric === "breathing_check"), "not a monitoring point");
});
