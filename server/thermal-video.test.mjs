// Breathing check from thermal video: the job, the trace and the verdict,
// with frames supplied by a stand-in for ffmpeg.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startBreathingCheck, breathingJob, jobView, boxMean } from "./thermal-video.mjs";

const W = 176, H = 144, FPS = 10;
const nostril = { x0: 4000, y0: 5000, x1: 5000, y1: 6000 };

/** Fake video: `seconds` of frames at 10 fps, the nostril box's brightness
 *  following `level(t)`. Delivered fast — the check paces by frame count. */
function fakeRun(level, totalFrames) {
  return async (_dev, _pw, onFrame) => {
    for (let i = 0; i < totalFrames; i++) {
      const f = Buffer.alloc(W * H, 60);
      const v = Math.round(level(i / FPS));
      for (let y = Math.round(0.5 * H); y <= Math.round(0.6 * H); y++)
        for (let x = Math.round(0.4 * W); x <= Math.round(0.5 * W); x++) f[y * W + x] = v;
      onFrame(f);
    }
  };
}
const waitDone = async (job) => { for (let i = 0; i < 100 && breathingJob(job.id).state === "running"; i++) await new Promise((r) => setTimeout(r, 20)); return breathingJob(job.id); };

test("box brightness is read from the right place", () => {
  const f = Buffer.alloc(W * H, 10);
  for (let y = 72; y <= 86; y++) for (let x = 70; x <= 88; x++) f[y * W + x] = 200;
  assert.ok(boxMean(f, nostril) > 150);
  assert.ok(boxMean(f, { x0: 0, y0: 0, x1: 1000, y1: 1000 }) < 20);
});

test("a 15 bpm brightness rhythm in the nostril box reads as ~15 bpm", async () => {
  const job = await startBreathingCheck({ id: "cam1" }, "pw", nostril, {
    seconds: 60, run: fakeRun((t) => 150 + 12 * Math.sin((2 * Math.PI * 15 * t) / 60), 600) });
  const done = await waitDone(job);
  assert.equal(done.state, "done", done.error);
  assert.ok(Math.abs(done.result.bpm - 15) < 1, JSON.stringify(done.result));
  const v = jobView(done);
  assert.ok(v.trace.length <= 120 && v.trace.length > 50, "thinned trace for the sparkline");
});

test("no rhythm: the check says so rather than inventing a rate", async () => {
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const job = await startBreathingCheck({ id: "cam2" }, "pw", nostril, { seconds: 60, run: fakeRun(() => 150 + 6 * rnd(), 600) });
  const done = await waitDone(job);
  assert.equal(done.state, "done");
  assert.equal(done.result.bpm, null);
});

test("a camera that sends no video: the job fails with the reason", async () => {
  const job = await startBreathingCheck({ id: "cam3" }, "pw", nostril, { run: async () => { throw new Error("the thermal video stopped: 404"); } });
  const done = await waitDone(job);
  assert.equal(done.state, "failed");
  assert.match(done.error, /thermal video stopped/);
});
