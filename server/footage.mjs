// Recorded camera footage and the labels people put on it — the training data
// for real behaviour models (the detectors today are hand-made heuristics).
//
// The edge agent records into <dir>/<camera id>/<thermal|visible>/<start>.mp4
// (edge/recorder.py). On the demo setup the site server and the edge agent run
// on the same machine and share that folder; a separate edge box would need
// its clips synced here first.
//
// Clips of the two streams are paired when their start times are within a few
// seconds (each is cut on the next keyframe after the clock boundary, so they
// rarely start on the same second). Labels are stored with ABSOLUTE times, so
// they stay true whichever clip or stream they were made on.
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export const LABELS = [
  // interval labels: something that lasts
  { key: "lying", name: "Lying down", kind: "interval", shortcut: "l" },
  { key: "standing_still", name: "Standing still / dozing", kind: "interval", shortcut: "s" },
  { key: "eating", name: "Eating", kind: "interval", shortcut: "e" },
  { key: "drinking", name: "Drinking", kind: "interval", shortcut: "d" },
  { key: "weaving", name: "Weaving", kind: "interval", shortcut: "w" },
  { key: "pawing", name: "Pawing", kind: "interval", shortcut: "p" },
  { key: "rolling", name: "Rolling", kind: "interval", shortcut: "r" },
  { key: "crib_biting", name: "Crib-biting / wind-sucking", kind: "interval", shortcut: "c" },
  { key: "nursing", name: "Nursing / suckling (foal)", kind: "interval", shortcut: "n" },
  { key: "out_of_view", name: "Horse out of view", kind: "interval", shortcut: "o" },
  // moment labels: something that happens
  { key: "lies_down", name: "Lies down (moment)", kind: "moment", shortcut: "1" },
  { key: "gets_up", name: "Gets up (moment)", kind: "moment", shortcut: "2" },
  { key: "urinating", name: "Urinating", kind: "moment", shortcut: "u" },
  { key: "defecating", name: "Defecating", kind: "moment", shortcut: "m" },
  { key: "other", name: "Other (add a note)", kind: "moment", shortcut: "x" },
];
const LABEL_KEYS = new Set(LABELS.map((l) => l.key));
const STREAMS = ["thermal", "visible"];
const PAIR_WITHIN_S = 8;
const IN_PROGRESS_S = 60;                     // written in the last minute: still recording

export const recordingsDir = () => process.env.EQUICARE_RECORDINGS_DIR || join(homedir(), "EquiCare-demo", "recordings");

const SAFE_ID = /^[A-Za-z0-9._-]{1,80}$/;
const SAFE_START = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;

/** "2026-09-26T16-46-00" (edge box local time) -> Date. */
const startDate = (s) => new Date(s.replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3"));

function scanStream(camDir, stream) {
  const dir = join(camDir, stream);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".mp4") && SAFE_START.test(f.slice(0, -4))).map((f) => {
    const st = statSync(join(dir, f));
    const start = f.slice(0, -4);
    return { stream, start, at: startDate(start), bytes: st.size, mtimeMs: st.mtimeMs };
  }).sort((a, b) => a.at - b.at);
}

/** All clips, newest first: [{ id, camera, start, at, end, thermal, visible, recording }]. */
export function listClips(root = recordingsDir()) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const cam of readdirSync(root)) {
    if (!SAFE_ID.test(cam) || cam.startsWith(".")) continue;
    const camDir = join(root, cam);
    const [th, vi] = STREAMS.map((s) => scanStream(camDir, s));
    const usedV = new Set();
    const pairs = [];
    for (const t of th) {
      const v = vi.find((x) => !usedV.has(x) && Math.abs(x.at - t.at) <= PAIR_WITHIN_S * 1000);
      if (v) usedV.add(v);
      pairs.push({ t, v: v || null });
    }
    for (const v of vi) if (!usedV.has(v)) pairs.push({ t: null, v });
    pairs.sort((a, b) => (a.t || a.v).at - (b.t || b.v).at);
    pairs.forEach((p, i) => {
      const first = p.t || p.v;
      const next = pairs[i + 1] ? (pairs[i + 1].t || pairs[i + 1].v).at : null;
      const newest = Math.max(p.t?.mtimeMs ?? 0, p.v?.mtimeMs ?? 0);
      const recording = Date.now() - newest < IN_PROGRESS_S * 1000 && !next;
      const endAt = next || new Date(newest);
      out.push({
        id: `${cam}:${first.start}`, camera: cam, start: first.start, at: first.at.toISOString(), end: endAt.toISOString(),
        recording,
        thermal: p.t ? { start: p.t.start, at: p.t.at.toISOString(), bytes: p.t.bytes } : null,
        visible: p.v ? { start: p.v.start, at: p.v.at.toISOString(), bytes: p.v.bytes } : null,
      });
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** Absolute path of a clip file, or null if the request is not a real clip. */
export function clipPath(camera, stream, start, root = recordingsDir()) {
  if (!SAFE_ID.test(camera) || !STREAMS.includes(stream) || !SAFE_START.test(start)) return null;
  const p = join(root, camera, stream, `${start}.mp4`);
  return existsSync(p) ? p : null;
}

/** Serve a file with HTTP Range support (video seeking needs it). */
export function serveFile(req, path, contentType, CORS = {}) {
  const size = statSync(path).size;
  const range = req.headers.get("range");
  const common = { "Content-Type": contentType, "Accept-Ranges": "bytes", "Cache-Control": "no-store", ...CORS };
  const body = (start, end) => new ReadableStream({
    start(ctl) {
      const s = createReadStream(path, { start, end });
      s.on("data", (c) => ctl.enqueue(new Uint8Array(c)));
      s.on("end", () => ctl.close());
      s.on("error", (e) => ctl.error(e));
    },
  });
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m) {
    let start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
    let end = m[1] !== "" && m[2] !== "" ? Number(m[2]) : size - 1;
    if (!(start >= 0 && start < size && end >= start)) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, ...CORS } });
    end = Math.min(end, size - 1);
    return new Response(body(start, end), { status: 206, headers: { ...common, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` } });
  }
  return new Response(body(0, size - 1), { status: 200, headers: { ...common, "Content-Length": String(size) } });
}

const transcoding = new Map();
/** H.264 copy of a clip for browsers without HEVC, made once and cached. */
export async function h264Copy(src, root = recordingsDir()) {
  const cacheDir = join(root, ".h264");
  mkdirSync(cacheDir, { recursive: true });
  const out = join(cacheDir, src.slice(root.length + 1).replace(/[\\/]/g, "__"));
  // A clip still being recorded keeps growing; a video player seeks with many
  // range requests. Re-convert a growing clip at most once a minute, not on
  // every request.
  if (existsSync(out) && statSync(out).size > 0 && statSync(src).mtimeMs - statSync(out).mtimeMs < 60_000) return out;
  if (!transcoding.has(out)) {
    // Convert to a temporary name and swap it in: a request reading the old
    // copy must never see a half-written file.
    const tmp = `${out}.part-${process.pid}-${Date.now()}.mp4`;
    transcoding.set(out, new Promise((resolve, reject) => {
      const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-c:v", "libx264", "-preset", "veryfast",
        "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", tmp]);
      let err = "";
      ff.stderr.on("data", (d) => (err += d));
      ff.on("error", (e) => reject(e.code === "ENOENT" ? new Error("ffmpeg is not installed on the site server") : e));
      ff.on("exit", (code) => {
        if (code === 0) { renameSync(tmp, out); resolve(out); return; }
        try { unlinkSync(tmp); } catch { /* nothing to clean */ }
        reject(new Error(`conversion failed: ${err.slice(-200)}`));
      });
    }).finally(() => transcoding.delete(out)));
  }
  return transcoding.get(out);
}

/** Validate a label from the client. Returns { label, errs }. */
export function validateLabel(body) {
  const errs = [];
  const iso = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  const label = {
    camera: String(body.camera || ""), clip: String(body.clip || ""), label: String(body.label || ""),
    startAt: iso(body.startAt), endAt: body.endAt ? iso(body.endAt) : null,
    note: String(body.note || "").slice(0, 500), horse: body.horse ? String(body.horse).slice(0, 80) : null,
  };
  if (!SAFE_ID.test(label.camera)) errs.push("camera is required");
  if (!LABEL_KEYS.has(label.label)) errs.push(`unknown label "${label.label}"`);
  if (!label.startAt) errs.push("startAt must be a time");
  if (body.endAt && !label.endAt) errs.push("endAt must be a time");
  if (label.endAt && label.startAt && label.endAt < label.startAt) errs.push("endAt is before startAt");
  if (label.endAt && label.startAt && Date.parse(label.endAt) - Date.parse(label.startAt) > 12 * 3600 * 1000) errs.push("a label cannot span more than 12 hours");
  const def = LABELS.find((l) => l.key === label.label);
  if (def?.kind === "moment") label.endAt = null;
  if (label.label === "other" && !label.note) errs.push("add a note to say what the 'other' event is");
  return { label, errs };
}

/** Labels as CSV for a training pipeline. */
export function labelsCsv(labels) {
  const esc = (v) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const cols = ["id", "camera", "horse", "label", "start_at", "end_at", "duration_s", "clip", "note", "by", "created_at"];
  const rows = labels.map((l) => [l.id, l.camera, l.horse, l.label, l.startAt, l.endAt,
    l.endAt ? Math.round((Date.parse(l.endAt) - Date.parse(l.startAt)) / 1000) : "", l.clip, l.note, l.by, l.createdAt].map(esc).join(","));
  return [cols.join(","), ...rows].join("\n") + "\n";
}
