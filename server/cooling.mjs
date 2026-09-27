// Floor cooling test — measures how a warm deposit cools on THIS stable's
// bedding, which is what tells urine from manure on the floor camera.
//
// No published data exists for horse urine or manure cooling on straw,
// shavings or rubber matting (research, 27 Sep). So at the stable: press
// Start with the floor box empty, pour 1–3 L of ~38 °C water (urine) or place
// ~2 kg of fresh manure inside the box, and let it run. The job reads the
// floor grid every 2 s and follows the patch's mean rise above the floor
// until it has cooled. Saved results set the camera's urine/manure split.
//
// Jobs live in memory, one per camera at a time, like the breathing check.
import { randomUUID } from "node:crypto";
import { toCam, CAM_MAX } from "./mtrpc.mjs";

const G = (globalThis.__equicareCoolingJobs ??= new Map());
export const COLS = 16, ROWS = 10;
const SCAN_EVERY_MS = 2000;
const BASELINE_S = 8;                // the first seconds, before anything is poured
const WARM_C = 1.0;                  // a cell counts as part of the patch 1 °C above its baseline

/** The same cell centres the edge agent's FloorTracker scans (0–10000 box). */
export function floorGrid(box) {
  const pts = [];
  for (let j = 0; j < ROWS; j++)
    for (let i = 0; i < COLS; i++) {
      const x = box.x0 + ((box.x1 - box.x0) * (i + 0.5)) / COLS;
      const y = box.y0 + ((box.y1 - box.y0) * (j + 0.5)) / ROWS;
      pts.push({ x: Math.max(0, Math.min(CAM_MAX, Math.round(toCam(x)))), y: Math.max(0, Math.min(CAM_MAX, Math.round(toCam(y)))) });
    }
  return pts;
}

const median = (a) => { const s = a.filter((v) => v !== null).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };

/**
 * scans: [{ t: seconds since start, temps: [°C | null] }]. Pure — tested
 * directly. Returns what the calibrator draws and what "Save" stores.
 */
export function analyseCooling(scans) {
  const base = scans.filter((s) => s.t < BASELINE_S);
  if (base.length < 2 || !scans.some((s) => s.t >= BASELINE_S))
    return { state: "baseline", note: "measuring the empty floor — pour after a few seconds" };
  const n = base[0].temps.length;
  const b = Array.from({ length: n }, (_, i) => median(base.map((s) => s.temps[i])));
  const after = scans.filter((s) => s.t >= BASELINE_S);
  const rise = (s, i) => (s.temps[i] === null || b[i] === null ? null : s.temps[i] - b[i]);
  // Footprint: the cells warm at the scan with the largest total warmth.
  let best = null, bestSum = 0;
  for (const s of after) {
    let sum = 0;
    for (let i = 0; i < n; i++) { const r = rise(s, i); if (r !== null && r >= WARM_C) sum += r; }
    if (sum > bestSum) { bestSum = sum; best = s; }
  }
  if (!best) return { state: "waiting", note: "no warm patch yet — pour or place it inside the floor box", series: [] };
  const cells = [];
  for (let i = 0; i < n; i++) { const r = rise(best, i); if (r !== null && r >= WARM_C) cells.push(i); }
  const series = after.map((s) => {
    const rs = cells.map((i) => rise(s, i)).filter((v) => v !== null);
    const warm = Array.from({ length: n }, (_, i) => rise(s, i)).filter((r) => r !== null && r >= WARM_C).length;
    return { t: s.t, meanRiseC: rs.length ? rs.reduce((a, v) => a + v, 0) / rs.length : null, warmArea: warm / n };
  }).filter((p) => p.meanRiseC !== null);
  let peak = series[0];
  for (const p of series) if (p.meanRiseC > peak.meanRiseC) peak = p;
  let halfAt = null;
  for (let k = series.indexOf(peak) + 1; k < series.length; k++) {
    if (series[k].meanRiseC <= peak.meanRiseC / 2) {
      const a = series[k - 1], c = series[k];
      const f = (a.meanRiseC - peak.meanRiseC / 2) / (a.meanRiseC - c.meanRiseC || 1);
      halfAt = a.t + f * (c.t - a.t);
      break;
    }
  }
  const xs = cells.map((i) => i % COLS), ys = cells.map((i) => Math.floor(i / COLS));
  const fill = cells.length / ((Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1));
  return {
    state: halfAt === null ? "cooling" : "measured",
    note: halfAt === null ? "cooling — keep going until it has lost half its warmth" : "measured",
    peakRiseC: Math.round(peak.meanRiseC * 10) / 10,
    halfLifeMin: halfAt === null ? null : Math.round(((halfAt - peak.t) / 60) * 10) / 10,
    areaFrac: Math.round((cells.length / n) * 1000) / 1000,
    fill: Math.round(fill * 100) / 100,
    series: series.map((p) => ({ t: Math.round(p.t), meanRiseC: Math.round(p.meanRiseC * 100) / 100, warmArea: Math.round(p.warmArea * 1000) / 1000 })),
  };
}

/** The urine/manure split the edge agent uses, from saved calibrations. */
export function splitFromCalib(calib) {
  const u = calib?.urine?.halfLifeMin, m = calib?.manure?.halfLifeMin;
  if (u && m) return Math.round(Math.sqrt(u * m) * 10) / 10;       // halfway on a log scale
  if (u) return Math.round(u * 2 * 10) / 10;
  if (m) return Math.round((m / 2) * 10) / 10;
  return null;
}

/**
 * Start a test. read(points) -> temps (through the camera pool). `sleep` and
 * `clock` are injectable for tests.
 */
export function startCoolingTest(dev, read, { minutes = 20, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), clock = Date.now } = {}) {
  for (const j of G.values()) if (j.deviceId === dev.id && j.state === "running") return j;
  const job = { id: randomUUID(), deviceId: dev.id, state: "running", startedAt: clock(), minutes, scans: [], error: null, stop: false };
  G.set(job.id, job);
  for (const [k, j] of G) if (j.state !== "running" && clock() - j.startedAt > 3_600_000) G.delete(k);
  const pts = floorGrid(dev.rois.floor);
  job.done = (async () => {
    try {
      while (!job.stop && clock() - job.startedAt < minutes * 60_000) {
        const t0 = clock();
        const temps = await read(pts);
        job.scans.push({ t: (t0 - job.startedAt) / 1000, temps });
        const a = analyseCooling(job.scans);
        if (a.state === "measured" && a.series.at(-1).meanRiseC <= a.peakRiseC * 0.2) break;   // fully cooled
        await sleep(Math.max(0, SCAN_EVERY_MS - (clock() - t0)));
      }
      job.state = "done";
    } catch (e) {
      job.state = "error";
      job.error = e.message;
    }
  })();
  return job;
}

export const coolingJob = (id) => G.get(id) || null;

export function coolingView(job) {
  return { id: job.id, state: job.state, error: job.error, minutes: job.minutes,
    elapsedS: Math.round(((job.scans.at(-1)?.t) ?? 0)), result: analyseCooling(job.scans) };
}
