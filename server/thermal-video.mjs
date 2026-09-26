// Breathing check from a JSON-RPC camera's thermal video, for the calibrator.
//
// The demo unit's pixel-temperature API refreshes ~1×/s — too slow to see a
// breath — while its thermal video runs at 25 fps (RTSP /media/live/202, found
// via ONVIF). The site server decodes the stream small with ffmpeg and follows
// the nostril box's brightness (white-hot palette: brighter = warmer), then
// judges the rhythm with the same computeRespRate the edge agent uses.
//
// A check is a short background job the calibrator polls, so its trace can
// draw while it runs. Jobs live in memory; one per camera at a time.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { computeRespRate } from "./respiration.mjs";

const W = 176, H = 144, FPS = 10;
export const THERMAL_STREAM_PATH = "/media/live/202";
const G = (globalThis.__equicareBreathingJobs ??= new Map());

/** Mean brightness of an EquiCare box (0–10000) in a W×H gray frame. */
export function boxMean(frame, box) {
  const fx = (v) => Math.max(0, Math.min(W - 1, Math.round((v / 10000) * W)));
  const fy = (v) => Math.max(0, Math.min(H - 1, Math.round((v / 10000) * H)));
  const x0 = fx(box.x0), x1 = fx(box.x1), y0 = fy(box.y0), y1 = fy(box.y1);
  let s = 0, n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { s += frame[y * W + x]; n++; }
  return n ? s / n : null;
}

/** A local TCP relay, because ffmpeg cannot use an IPv6 zone (fe80::…%en8). */
function relayTo(host, port) {
  const srv = net.createServer((sock) => {
    const up = net.connect({ host, port });
    sock.pipe(up).pipe(sock);
    up.on("error", () => sock.destroy());
    sock.on("error", () => up.destroy());
  });
  return new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

/**
 * Start a check. dev: the camera record; password: decrypted. Returns the job.
 * `run` is injectable for tests (defaults to ffmpeg).
 */
export async function startBreathingCheck(dev, password, nostril, { seconds = 60, run = runFfmpeg } = {}) {
  for (const j of G.values()) if (j.deviceId === dev.id && j.state === "running") return j;
  const job = {
    id: randomUUID(), deviceId: dev.id, state: "running", startedAt: Date.now(), seconds,
    series: [], result: null, error: null,
  };
  G.set(job.id, job);
  // Old finished jobs go after 10 minutes.
  for (const [k, j] of G) if (j.state !== "running" && Date.now() - j.startedAt > 600_000) G.delete(k);

  let firstFrameAt = null;
  const onFrame = (frame) => {
    if (firstFrameAt === null) firstFrameAt = Date.now();
    const v = boxMean(frame, nostril);
    if (v !== null) job.series.push(v);
    return (Date.now() - firstFrameAt) / 1000 >= seconds;           // true = stop
  };
  run(dev, password, onFrame).then(() => {
    const elapsed = firstFrameAt ? (Date.now() - firstFrameAt) / 1000 : 0;
    if (!job.series.length) {
      job.state = "failed";
      job.error = job.error || "no frames arrived from the camera's thermal video";
      return;
    }
    // ffmpeg's fps filter paces output by stream time, so FPS is the true
    // sampling rate even when frames reach us in bursts.
    const rr = computeRespRate(job.series, FPS);
    job.result = {
      bpm: rr.bpm, periodicity: rr.periodicity, samples: job.series.length, seconds: elapsed,
      swing: Math.max(...job.series) - Math.min(...job.series), method: "thermal video, nostril box",
    };
    job.state = "done";
  }).catch((e) => {
    job.state = "failed";
    job.error = e.message;
  });
  return job;
}

export const breathingJob = (id) => G.get(id) || null;

/** Public view of a job: a thinned trace (≤ 120 points) and the result. */
export function jobView(job) {
  const step = Math.max(1, Math.ceil(job.series.length / 120));
  return {
    id: job.id, state: job.state, error: job.error, result: job.result,
    elapsed: Math.min(job.seconds, (Date.now() - job.startedAt) / 1000), seconds: job.seconds,
    samples: job.series.length,
    trace: job.series.filter((_, i) => i % step === 0).map((v) => +v.toFixed(2)),
  };
}

/** ffmpeg on the camera's thermal sub-stream, W×H gray frames at FPS. */
async function runFfmpeg(dev, password, onFrame) {
  const relay = await relayTo(dev.host, dev.rtspPort || 554);
  const url = `rtsp://${encodeURIComponent(dev.username || "admin")}:${encodeURIComponent(password)}@127.0.0.1:${relay.address().port}${THERMAL_STREAM_PATH}`;
  try {
    await new Promise((resolve, reject) => {
      const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-timeout", "8000000",
        "-i", url, "-vf", `fps=${FPS},scale=${W}:${H},format=gray`, "-f", "rawvideo", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
      let buf = Buffer.alloc(0), err = "", stopped = false;
      const guard = setTimeout(() => { if (!stopped) ff.kill("SIGKILL"); }, 30_000 + 1000 * 120);
      ff.on("error", (e) => reject(e.code === "ENOENT" ? new Error("ffmpeg is not installed on the site server — install it for the breathing check") : e));
      ff.stderr.on("data", (d) => { err += d; });
      ff.stdout.on("data", (d) => {
        buf = Buffer.concat([buf, d]);
        while (buf.length >= W * H && !stopped) {
          const frame = buf.subarray(0, W * H);
          buf = buf.subarray(W * H);
          if (onFrame(frame)) { stopped = true; ff.kill("SIGKILL"); }
        }
      });
      ff.on("exit", () => {
        clearTimeout(guard);
        if (stopped) resolve();
        else reject(new Error(`the thermal video stopped: ${err.trim().slice(-200) || "stream ended"}`));
      });
    });
  } finally {
    relay.close();
  }
}
