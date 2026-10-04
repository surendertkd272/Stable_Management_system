// Cameras a stable already owns — any IP / CCTV camera (or NVR channel) with
// an RTSP stream. EquiCare reads its colour picture the same way it reads the
// colour side of its own camera (edge_agent.RtspCameraWorker): activity, lying
// and eating time, rolling, vices, droppings and urine on the bedding,
// breathing from the flank, people at the stall, recognition, recordings. It
// has no thermal sensor, so no eye temperature and no nostril breathing.
//
// The stream's address: the make's usual one (below), found over ONVIF, or
// pasted. Two streams where the camera has them: the sub stream to analyse
// (small is enough, and cheap), the main stream for full-detail stills.
import { spawn } from "node:child_process";
import { OnvifPtz, tags, text, attr } from "./onvif-ptz.mjs";

export const MAKES = {
  hikvision: { label: "Hikvision, Prama, HiLook", path: (ch, sub) => `/Streaming/Channels/${ch}0${sub ? 2 : 1}` },
  dahua:     { label: "Dahua, CP Plus, Amcrest, Lorex", path: (ch, sub) => `/cam/realmonitor?channel=${ch}&subtype=${sub ? 1 : 0}` },
  uniview:   { label: "Uniview (UNV)", path: (ch, sub) => `/unicast/c${ch}/s${sub ? 1 : 0}/live` },
  axis:      { label: "Axis", path: (ch, sub) => `/axis-media/media.amp?camera=${ch}${sub ? "&resolution=640x360" : ""}` },
  tapo:      { label: "TP-Link Tapo, VIGI", path: (_ch, sub) => `/stream${sub ? 2 : 1}` },
  reolink:   { label: "Reolink", path: (ch, sub) => `/h264Preview_${String(ch).padStart(2, "0")}_${sub ? "sub" : "main"}` },
  onvif:     { label: "Another make — find the stream automatically (ONVIF)", path: null },
  custom:    { label: "Another make — paste its RTSP address", path: null },
};

/** The analysis (sub) and still (main) stream paths for a make and channel. */
export function pathsFor(make, channel = 1) {
  const m = MAKES[make];
  if (!m?.path) return null;
  return { rtspPath: m.path(channel, true), rtspPathMain: m.path(channel, false) };
}

/** "rtsp://user:pass@host:554/path?x" → { host, port, path, username, password } or { error } */
export function parseRtspUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return { error: "that is not an RTSP address — it starts rtsp://" }; }
  if (u.protocol !== "rtsp:") return { error: "the address must start rtsp://" };
  if (!u.hostname) return { error: "the address has no camera address in it" };
  return {
    host: u.hostname.replace(/^\[|\]$/g, ""), port: u.port ? Number(u.port) : 554,
    path: `${u.pathname || "/"}${u.search}`,
    username: u.username ? decodeURIComponent(u.username) : null, password: u.password ? decodeURIComponent(u.password) : null,
  };
}

const hostPart = (h) => (h.includes(":") ? `[${h}]` : h);
/** The URL ffmpeg opens. Never stored, never logged: it carries the password. */
export const rtspUrl = (dev, password, path) =>
  `rtsp://${encodeURIComponent(dev.username || "admin")}:${encodeURIComponent(password || "")}@${hostPart(dev.host)}:${dev.rtspPort || 554}${path}`;
/** For messages: the address without the password. */
export const safeAddress = (dev, path) => `rtsp://${hostPart(dev.host)}:${dev.rtspPort || 554}${path}`;

function run(cmd, args, { timeoutMs = 20000, binary = false } = {}) {
  return new Promise((resolve) => {
    let p;
    try { p = spawn(cmd, args); } catch (e) { resolve({ code: -1, out: binary ? Buffer.alloc(0) : "", err: e.message }); return; }
    const out = [], err = [];
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out: binary ? Buffer.alloc(0) : "", err: e.code === "ENOENT" ? `${cmd} is not installed on the site server` : e.message }); });
    p.on("close", (code) => {
      clearTimeout(timer);
      const o = Buffer.concat(out);
      resolve({ code, out: binary ? o : o.toString(), err: Buffer.concat(err).toString() });
    });
  });
}
// ffmpeg's error, without the address (which holds the password)
const cleanErr = (s) => String(s).replace(/rtsp:\/\/[^\s'"]+/g, "rtsp://…").split("\n").map((l) => l.trim()).filter(Boolean).slice(-2).join(" — ").slice(0, 240);

/** One stream: { codec, width, height, fps } or { error } */
export async function probeStream(dev, password, path) {
  const r = await run("ffprobe", ["-v", "error", "-rtsp_transport", "tcp", "-timeout", "8000000", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,avg_frame_rate,r_frame_rate", "-of", "json", rtspUrl(dev, password, path)]);
  if (r.code !== 0) {
    const e = cleanErr(r.err);
    return { error: /401|Unauthorized/i.test(e) ? "the camera refused the username or password"
      : /404|Not Found/i.test(e) ? "no stream at that address — check the make and channel"
        : /timed out|Connection refused|No route/i.test(e) ? "the camera did not answer on its RTSP port" : e || "could not open the stream" };
  }
  let s;
  try { s = JSON.parse(r.out).streams?.[0]; } catch { s = null; }
  if (!s) return { error: "the stream has no video" };
  const rate = (f) => { const [a, b] = String(f || "0/1").split("/").map(Number); return b ? a / b : 0; };
  const fps = Math.round((rate(s.avg_frame_rate) || rate(s.r_frame_rate)) * 10) / 10;
  return { codec: s.codec_name, width: s.width, height: s.height, fps };
}

/** What EquiCare can do with this picture — our own thresholds. */
export function judgeStreams(sub, main) {
  const lines = [], s = sub && !sub.error ? sub : main && !main.error ? main : null;
  if (!s) return { ok: false, lines: [sub?.error || main?.error || "no stream"] };
  const ok = s.width >= 320 && (s.fps || 0) >= 4;
  lines.push(`${sub && !sub.error ? "Analysis stream" : "Stream"}: ${s.width}×${s.height}, ${s.fps || "?"} frames a second, ${String(s.codec).toUpperCase()}.`);
  if (s.width < 320) lines.push("Too small to judge lying, eating or the floor — choose a larger sub stream in the camera (at least 640×360).");
  if ((s.fps || 0) < 4) lines.push("Too few frames a second for movement and breathing — set the sub stream to 8–15 fps in the camera.");
  if (s.width > 1280) lines.push("A large picture to analyse every second — a sub stream of 640–960 wide is enough and lighter for the edge box.");
  if (main && !main.error && sub && !sub.error && main.width > sub.width) lines.push(`Full-detail stream: ${main.width}×${main.height} — used for recognition stills and recordings.`);
  if (["mjpeg"].includes(s.codec)) lines.push("MJPEG: it works, but recordings will be large.");
  return { ok, lines };
}

/** Test the camera: both streams, and the verdict. */
export async function probeIpCamera(dev, password) {
  const sub = await probeStream(dev, password, dev.rtspPath);
  const main = dev.rtspPathMain && dev.rtspPathMain !== dev.rtspPath ? await probeStream(dev, password, dev.rtspPathMain) : null;
  const v = judgeStreams(sub, main);
  return { ok: v.ok, at: new Date().toISOString(), sub, main, lines: v.lines, address: safeAddress(dev, dev.rtspPath) };
}

/** One JPEG from the camera (the main stream when there is one). */
export async function snapshotIpCamera(dev, password, { width = 1280 } = {}) {
  const path = dev.rtspPathMain || dev.rtspPath;
  const r = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-timeout", "8000000",
    "-i", rtspUrl(dev, password, path), "-map", "0:v:0", "-an", "-frames:v", "1", "-vf", `scale='min(${width},iw)':-2`,
    "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "4", "pipe:1"], { binary: true });
  if (r.code !== 0 || !r.out.length) throw new Error(cleanErr(r.err) || "no picture from the camera");
  return { bytes: r.out, contentType: "image/jpeg" };
}

/** ONVIF: the camera's streams, largest first — [{ token, width, height, encoding, path, port }]. */
export async function onvifStreams({ host, port = 80, username = "admin", password = "", post } = {}) {
  const o = new OnvifPtz({ host, port, username, password, post });
  try { await o._services(); } catch (e) { if (!o.mediaPath) throw e; }      // no PTZ is fine here
  const raw = await o.call(o.mediaPath, "<trt:GetProfiles/>");
  const out = [];
  for (const p of tags(raw, "Profiles")) {
    const token = attr(p.attrs, "token");
    const enc = tags(p.body, "VideoEncoderConfiguration")[0]?.body ?? "";
    const res = tags(enc, "Resolution")[0]?.body ?? "";
    const uriRaw = await o.call(o.mediaPath, `<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup><trt:ProfileToken>${token}</trt:ProfileToken></trt:GetStreamUri>`);
    const uri = parseRtspUrl(text(uriRaw, "Uri") || "");
    if (uri.error) continue;
    out.push({ token, width: Number(text(res, "Width")) || 0, height: Number(text(res, "Height")) || 0,
      encoding: text(enc, "Encoding"), path: uri.path, port: uri.port });
  }
  if (!out.length) throw new Error("the camera listed no RTSP streams over ONVIF");
  return out.sort((a, b) => b.width * b.height - a.width * a.height);
}

/** From ONVIF's list: the main (largest) and an analysis stream (the smallest at least 640 wide, else the smallest). */
export function chooseStreams(list) {
  const main = list[0];
  const small = [...list].reverse();
  const sub = small.find((s) => s.width >= 640) ?? small[0];
  return { rtspPath: sub.path, rtspPathMain: main.path, rtspPort: main.port };
}
