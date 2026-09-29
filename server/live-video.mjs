// Live video for the Live page. Browsers cannot play RTSP, and snapshots are
// seconds apart, so the site server decodes the camera's sub-streams with
// ffmpeg into JPEG frames and streams them: the picture is well under a
// second behind, at the camera's own frame rate.
//
// One ffmpeg per camera and stream, shared by every viewer, and stopped a few
// seconds after the last viewer leaves: the camera allows only a few video
// sessions at a time, and the edge agent needs its own.
//
// Wire format (application/octet-stream): per frame a 4-byte big-endian
// length, then the JPEG. A viewer that falls behind is sent the newest frame
// and skips the rest, so the delay does not grow.
import { spawn } from "node:child_process";
import { relayTo } from "./thermal-video.mjs";

export const LIVE_PATHS = { thermal: "/media/live/202", colour: "/media/live/102" };
const LINGER_MS = 5000;          // keep the stream a little after the last viewer
const STALL_MS = 15000;          // no frame for this long: restart
const G = (globalThis.__equicareLiveFeeds ??= new Map());
const SOI = Buffer.from([0xff, 0xd8]), EOI = Buffer.from([0xff, 0xd9]);

/** Splits a byte stream of back-to-back JPEGs into frames. */
export function jpegSplitter(onFrame) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      const s = buf.indexOf(SOI);
      // No start marker yet; keep a trailing 0xFF, which may be its first half.
      if (s < 0) { buf = buf.length && buf[buf.length - 1] === 0xff ? buf.subarray(buf.length - 1) : Buffer.alloc(0); return; }
      const e = buf.indexOf(EOI, s + 2);
      if (e < 0) { buf = buf.subarray(s); return; }
      onFrame(Buffer.from(buf.subarray(s, e + 2)));
      buf = buf.subarray(e + 2);
    }
  };
}

/** ffmpeg on the camera's stream, JPEG frames on stdout. Returns { stop }. */
async function runFfmpeg(dev, password, which, onFrame, onEnd) {
  const relay = await relayTo(dev.host, dev.rtspPort || 554);
  const url = `rtsp://${encodeURIComponent(dev.username || "admin")}:${encodeURIComponent(password)}@127.0.0.1:${relay.address().port}${LIVE_PATHS[which]}`;
  // The colour sub-stream is a 16:9 picture squeezed into 704×576.
  const scale = which === "colour" ? ["-vf", "scale=1024:576"] : [];
  const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-timeout", "8000000",
    "-fflags", "nobuffer", "-flags", "low_delay", "-probesize", "1000000", "-analyzeduration", "1000000",
    "-i", url, "-map", "0:v:0", "-an", ...scale, "-c:v", "mjpeg", "-q:v", "6", "-f", "mjpeg", "pipe:1"],
  { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  ff.stdout.on("data", jpegSplitter(onFrame));
  ff.stderr.on("data", (d) => { err = (err + d).slice(-400); });
  ff.on("error", (e) => { relay.close(); onEnd(e.code === "ENOENT" ? "ffmpeg is not installed on the site server" : e.message); });
  ff.on("close", () => {
    relay.close();
    onEnd(err.split(encodeURIComponent(password)).join("***").split(password).join("***").trim() || "the video stream ended");
  });
  return { stop: () => ff.kill("SIGKILL") };
}

function feedFor(dev, password, which, run) {
  const key = `${dev.id}:${which}`;
  let f = G.get(key);
  if (f) return f;
  f = { key, viewers: new Set(), last: null, lastAt: 0, proc: null, linger: null, ended: false, error: null };
  G.set(key, f);
  const end = (why) => {
    if (f.ended) return;
    f.ended = true; f.error = why;
    clearInterval(f.watch); clearTimeout(f.linger);
    if (G.get(key) === f) G.delete(key);
    f.proc?.stop();
    for (const v of f.viewers) v.close();
    f.viewers.clear();
  };
  f.end = end;
  f.startedAt = Date.now();
  f.watch = setInterval(() => { if (Date.now() - (f.lastAt || f.startedAt) > STALL_MS) end("no picture from the camera"); }, 2000);
  f.watch.unref?.();
  run(dev, password, which, (frame) => {
    f.last = frame; f.lastAt = Date.now();
    for (const v of f.viewers) v.send(frame);
  }, end).then((p) => { if (f.ended) p.stop(); else f.proc = p; }, (e) => end(e.message));
  return f;
}

/** A streaming Response of the camera's live video (see the wire format). */
export function liveResponse(dev, password, which, signal, headers = {}, { run = runFfmpeg, lingerMs = LINGER_MS } = {}) {
  const f = feedFor(dev, password, which, run);
  clearTimeout(f.linger);
  let viewer;
  const body = new ReadableStream({
    start(ctrl) {
      let blockedSince = 0;
      viewer = {
        send(frame) {
          if (ctrl.desiredSize > 0) {
            blockedSince = 0;
            const hdr = Buffer.alloc(4);
            hdr.writeUInt32BE(frame.length);
            ctrl.enqueue(new Uint8Array(Buffer.concat([hdr, frame])));
          } else if (!blockedSince) blockedSince = Date.now();
          else if (Date.now() - blockedSince > 30000) leave();   // a viewer that is gone without saying so
        },
        close() { try { ctrl.close(); } catch { /* already closed */ } },
      };
      f.viewers.add(viewer);
      if (f.last) viewer.send(f.last);
    },
    cancel() { leave(); },
  }, { highWaterMark: 2 });
  function leave() {
    if (!f.viewers.delete(viewer)) return;
    viewer.close();
    if (!f.viewers.size && !f.ended) f.linger = setTimeout(() => { if (!f.viewers.size) f.end("no viewers"); }, lingerMs);
  }
  signal?.addEventListener("abort", leave, { once: true });
  return new Response(body, { status: 200, headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no", ...headers } });
}

/** For tests and status: the feeds running now. */
export const liveFeeds = () => [...G.values()].map((f) => ({ key: f.key, viewers: f.viewers.size, frames: Boolean(f.last) }));
