// Floor cooling test: the analysis that turns a warm-water or manure test at
// the stable into this camera's urine/manure split.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseCooling, splitFromCalib, startCoolingTest, floorGrid, COLS, ROWS } from "./cooling.mjs";

const N = COLS * ROWS;
/** Scans every 2 s: floor at 22 °C, a patch placed at 20 s cooling with a half-life. */
function scans(cells, halfLifeMin, minutes, peak = 12) {
  const out = [];
  for (let t = 0; t <= minutes * 60; t += 2) {
    const temps = Array.from({ length: N }, () => 22 + (Math.random() - 0.5) * 0.2);
    if (t >= 20) for (const c of cells) temps[c] = 22 + peak * 0.5 ** ((t - 20) / 60 / halfLifeMin);
    out.push({ t, temps });
  }
  return out;
}
const WIDE = Array.from({ length: 30 }, (_, k) => 3 * COLS + 2 + (k % 10) + Math.floor(k / 10) * COLS);
const PILE = [5 * COLS + 7, 5 * COLS + 8, 6 * COLS + 7, 6 * COLS + 8];

test("warm water cooling with a 2-minute half-life is measured as ~2 min", () => {
  const r = analyseCooling(scans(WIDE, 2, 8));
  assert.equal(r.state, "measured");
  assert.ok(Math.abs(r.halfLifeMin - 2) < 0.2, JSON.stringify({ ...r, series: undefined }));
  assert.ok(r.peakRiseC > 10);
  assert.ok(Math.abs(r.areaFrac - 30 / N) < 0.01);
});

test("a compact pile cooling slowly: half-life ~15 min, small and filled", () => {
  const r = analyseCooling(scans(PILE, 15, 25));
  assert.ok(Math.abs(r.halfLifeMin - 15) < 0.5, r.halfLifeMin);
  assert.equal(r.fill, 1);
});

test("before anything is poured it says so, and while still warm it says cooling", () => {
  assert.equal(analyseCooling(scans([], 2, 0.1)).state, "baseline");
  assert.equal(analyseCooling(scans([], 2, 1)).state, "waiting");
  const r = analyseCooling(scans(PILE, 15, 5));
  assert.equal(r.state, "cooling");
  assert.equal(r.halfLifeMin, null);
});

test("the urine/manure split sits between the two measured half-lives", () => {
  assert.equal(splitFromCalib({ urine: { halfLifeMin: 2 }, manure: { halfLifeMin: 18 } }), 6);
  assert.equal(splitFromCalib({ urine: { halfLifeMin: 2 } }), 4);
  assert.equal(splitFromCalib({ manure: { halfLifeMin: 18 } }), 9);
  assert.equal(splitFromCalib(null), null);
});

test("the job scans until the patch has cooled, with an injectable clock", async () => {
  let now = 0;
  const data = scans(WIDE, 1, 10);
  let k = 0;
  const job = startCoolingTest({ id: "cam-x", rois: { floor: { x0: 1000, y0: 7000, x1: 9000, y1: 9800 } } },
    async (pts) => { assert.equal(pts.length, N); return data[Math.min(k++, data.length - 1)].temps; },
    { minutes: 30, sleep: async (ms) => { now += ms; }, clock: () => now });
  await job.done;
  assert.equal(job.state, "done");
  assert.ok(job.scans.length < data.length, "stopped once fully cooled, not after 30 minutes");
});

test("grid cells are the ones the edge agent scans (16 x 10 centres, camera coordinates)", () => {
  const g = floorGrid({ x0: 0, y0: 0, x1: 10000, y1: 10000 });
  assert.equal(g.length, N);
  assert.ok(g.every((p) => p.x >= 0 && p.x <= 8191 && p.y >= 0 && p.y <= 8191));
});
