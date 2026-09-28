// Daily series: per horse for the Reports page, with behaviour flags.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeries } from "./rollup.mjs";

const day = (d, h = 12) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10) + `T${String(h).padStart(2, "0")}:00:00Z`;
const R = (metric, value, d, meta = {}) => ({ metric, value, ts: day(d), meta, horseId: "tara", source: "visible_video" });

test("flags count vices and possible rolls / casts only, per day; activity says which days were watched", () => {
  const rd = [
    R("activity_index", 0.3, 1), R("activity_index", 0.5, 1),
    R("vice_event", 1, 1, { kind: "weaving" }),
    R("posture_event", 1, 1, { kind: "possible_roll" }),
    R("posture_event", 1, 1, { kind: "lie_down" }),              // a normal lie-down is not a flag
    R("urination_event", 1, 1),                                   // nor is urinating
    R("posture_event", 1, 0, { kind: "possible_cast" }),
  ];
  const s = buildSeries([{ id: "tara", name: "Tara" }], rd, 7);
  assert.equal(s.flags.length, 7);
  assert.equal(s.flags.at(-2), 2, "yesterday: weaving + possible roll");
  assert.equal(s.flags.at(-1), 1, "today: possibly cast");
  assert.equal(s.activity.at(-2), 0.4);
  assert.equal(s.activity.at(-1), null, "no activity reading today: null, not 0");
  assert.equal(s.activity[0], null);
});
