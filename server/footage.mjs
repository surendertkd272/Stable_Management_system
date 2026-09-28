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
import { patternForLabel } from "./knowledge.mjs";
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

// `def` is the annotator's rule: what to mark and what not to. Definitions
// follow the published ethograms cited in knowledge.mjs (via `pattern`).
export const LABELS = [
  // interval labels: something that lasts
  { key: "lying", name: "Lying down", kind: "interval", shortcut: "l",
    def: "Body on the ground, on the chest (legs folded) or flat on the side. From the moment the body touches down until it is up." },
  { key: "lying_lateral", name: "Lying flat on side", kind: "interval", shortcut: "3",
    def: "Flat on the side, head down. Mark it inside a 'Lying down' span. Note if the horse is awake and moving (a pain sign) or still (normal deep sleep)." },
  { key: "standing_still", name: "Standing still / dozing", kind: "interval", shortcut: "s",
    def: "Standing, not moving the legs, head often lowered, a hind leg may rest on the toe. Not eating or drinking." },
  { key: "eating", name: "Eating", kind: "interval", shortcut: "e",
    def: "Head at the hay, manger or floor feed, taking and chewing food." },
  { key: "drinking", name: "Drinking", kind: "interval", shortcut: "d",
    def: "Muzzle in the water bowl or bucket, swallowing." },
  { key: "weaving", name: "Weaving", kind: "interval", shortcut: "w",
    def: "Obvious side-to-side swaying of head, neck and forequarters in one spot, often at the stall front. Mark once it has swung 3+ times in a row (our rule)." },
  { key: "box_walking", name: "Box walking", kind: "interval", shortcut: "a",
    def: "Walking the stall perimeter again and again. Note whether slow and silent, or fast with neighing (distress)." },
  { key: "pawing", name: "Pawing", kind: "interval", shortcut: "p",
    def: "Scraping the floor repeatedly with a front hoof. Note if a feed is due — pawing before meals is normal." },
  { key: "rolling", name: "Rolling", kind: "interval", shortcut: "r",
    def: "Down and rolling onto the back or side. Note if it is a single dust-bathing roll ending with a shake, or repeated." },
  { key: "crib_biting", name: "Crib-biting / wind-sucking", kind: "interval", shortcut: "c",
    def: "Grips a fixed edge with the front teeth (or not, for wind-sucking), arches the neck, pulls back and gulps air. Plain chewing of wood is not crib-biting." },
  { key: "head_tossing", name: "Head nodding / tossing", kind: "interval", shortcut: "h",
    def: "Repetitive up-and-down bobbing, or sudden bouts of tossing. Not a single toss at a fly." },
  { key: "nursing", name: "Nursing / suckling (foal)", kind: "interval", shortcut: "n",
    def: "Foal's muzzle at the udder, suckling. Nuzzling without drinking: add a note." },
  { key: "out_of_view", name: "Horse out of view", kind: "interval", shortcut: "o",
    def: "The horse is not visible, or only a small part of it is." },
  // moment labels: something that happens
  { key: "lies_down", name: "Lies down (moment)", kind: "moment", shortcut: "1",
    def: "The moment the body reaches the ground." },
  { key: "gets_up", name: "Gets up (moment)", kind: "moment", shortcut: "2",
    def: "The moment the horse is standing on all four legs." },
  { key: "flank_watching", name: "Flank watching", kind: "moment", shortcut: "f",
    def: "Turns the head back to the flank or belly and holds it. Not a quick scratch or fly bite (mouth on the coat)." },
  { key: "kick_at_belly", name: "Kicks at belly", kind: "moment", shortcut: "k",
    def: "Lifts a hind leg and kicks forward, towards the belly. Stamping down at flies is not this." },
  { key: "stretch_as_if_to_urinate", name: "Stretches as if to urinate", kind: "moment", shortcut: "t",
    def: "Takes the urination stance (hind legs back, body stretched) with no stream or only a little. With a full stream, mark 'Urinating'." },
  { key: "urinating", name: "Urinating", kind: "moment", shortcut: "u",
    def: "Stretched stance with a stream of urine." },
  { key: "defecating", name: "Defecating", kind: "moment", shortcut: "m",
    def: "Tail lifted, droppings passed. Note straining." },
  { key: "other", name: "Other (add a note)", kind: "moment", shortcut: "x",
    def: "Anything else worth a vet's eye — e.g. rocking-back stance, sweating, buckling while asleep standing. Say what in the note." },
].map((l) => ({ ...l, pattern: patternForLabel(l.key)?.id || null }));
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

/**
 * Still frames from one camera's recordings, for reports: returns
 * grab(atMs, width) -> JPEG Buffer, or null when no clip covers that moment
 * (or ffmpeg is missing). Colour frames are shown as the 16:9 picture the
 * camera sees — its 704x576 sub-stream is that picture squeezed — with the
 * camera's own text (clock, channel name) trimmed off the top and bottom.
 */
export function frameGrabber(camera, stream = "visible", root = recordingsDir()) {
  const clips = listClips(root).filter((c) => c.camera === camera && c[stream])
    .map((c) => ({ at: Date.parse(c[stream].at), end: Date.parse(c.end), path: clipPath(camera, stream, c[stream].start, root) }))
    .filter((c) => c.path);
  return (atMs, width = 640) => {
    const c = clips.find((x) => x.at <= atMs && atMs < x.end);
    if (!c) return Promise.resolve(null);
    const w = Math.max(64, Math.min(1920, Math.round(width / 2) * 2));
    const vf = stream === "visible" ? `scale=${w}:${Math.round((w * 9) / 32) * 2},crop=iw:ih*0.82:0:ih*0.09` : `scale=${w}:-2`;
    return new Promise((resolve) => {
      const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", ((atMs - c.at) / 1000).toFixed(2), "-i", c.path,
        "-frames:v", "1", "-vf", vf, "-q:v", "3", "-f", "image2", "-c:v", "mjpeg", "pipe:1"]);
      const out = [];
      ff.stdout.on("data", (d) => out.push(d));
      ff.on("error", () => resolve(null));
      ff.on("exit", (code) => resolve(code === 0 && out.length ? Buffer.concat(out) : null));
    });
  };
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

// --------------------------------------------------------------------------- //
// Boxes around the horse — what a detector learns from ("where is the horse
// in this frame"). A posture model trained on zebras failed on a stall camera
// largely because KABR's frames were centred on one animal while a stall
// camera sees the whole pen; the plan is detect-then-classify, and the
// detector needs these.
// --------------------------------------------------------------------------- //
export const BOX_LABELS = ["horse", "foal", "person", "other"];

export function validateBox(body) {
  const errs = [];
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  const box = {
    camera: String(body.camera || ""), clip: String(body.clip || ""),
    stream: body.stream === "visible" ? "visible" : body.stream === "thermal" ? "thermal" : "",
    at: typeof body.at === "string" && !Number.isNaN(Date.parse(body.at)) ? new Date(body.at).toISOString() : null,
    // fractions of the frame, 0–1, so they survive any resolution
    x0: n(body.x0), y0: n(body.y0), x1: n(body.x1), y1: n(body.y1),
    label: String(body.label || "horse"),
    horse: body.horse ? String(body.horse).slice(0, 80) : null,
  };
  if (!SAFE_ID.test(box.camera)) errs.push("camera is required");
  if (!box.stream) errs.push("stream must be thermal or visible");
  if (!box.at) errs.push("at must be the frame's time");
  if (![box.x0, box.y0, box.x1, box.y1].every((v) => v >= 0 && v <= 1)) errs.push("box corners must be fractions 0–1");
  else if (box.x1 - box.x0 < 0.01 || box.y1 - box.y0 < 0.01) errs.push("the box is too small");
  if (!BOX_LABELS.includes(box.label)) errs.push(`label must be one of ${BOX_LABELS.join(", ")}`);
  for (const k of ["x0", "y0", "x1", "y1"]) if (Number.isFinite(box[k])) box[k] = Math.round(box[k] * 10000) / 10000;
  return { box, errs };
}

/** Boxes for training: per frame, which clip file and how many seconds in —
 *  enough to cut the frame out with ffmpeg and pair it with its boxes. */
export function boxesExport(boxes, clips) {
  const frames = new Map();
  for (const b of boxes) {
    const clip = clips.find((c) => c.camera === b.camera && b.at >= c.at && b.at < c.end && c[b.stream]);
    const file = clip ? `${b.camera}/${b.stream}/${clip[b.stream].start}.mp4` : null;
    const key = `${b.camera}|${b.stream}|${b.at}`;
    if (!frames.has(key)) frames.set(key, {
      camera: b.camera, stream: b.stream, at: b.at, file,
      offsetSeconds: clip ? Math.round((Date.parse(b.at) - Date.parse(clip[b.stream].at)) / 10) / 100 : null,
      boxes: [],
    });
    frames.get(key).boxes.push({ label: b.label, horse: b.horse, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, by: b.by });
  }
  return { format: "equicare-boxes-v1", coordinates: "fractions of the frame, origin top-left", labels: BOX_LABELS,
    frames: [...frames.values()].sort((a, b) => a.at.localeCompare(b.at)) };
}

// --------------------------------------------------------------------------- //
// Moments worth labelling. Nobody can watch 100+ hours; the edge agent's own
// measurements point at the moments most likely to hold the behaviours we
// need, and a random sample keeps the set honest (a model trained only on
// "interesting" moments learns a skewed picture, and needs unbiased test data).
// --------------------------------------------------------------------------- //
const QUEUE_KINDS = {
  activity_burst: "Burst of movement — rolling, pawing, restlessness?",
  still_start: "Long stillness begins — lying down? dozing?",
  still_end: "Long stillness ends — getting up?",
  floor_urination: "Warm patch on the floor, cooled fast — urination?",
  floor_excretion: "Warm patch on the floor, stayed warm — defecation?",
  weaving: "Side-to-side sway detected — weaving?",
  random: "Random sample (for an unbiased training and test set)",
};

/** readings: this camera's readings (any order). clips: listClips() for the camera. */
export function labellingQueue(readings, clips, { randomPerHour = 1 } = {}) {
  const items = [];
  const push = (kind, atMs, detail = "") => items.push({ kind, at: new Date(atMs).toISOString(), reason: QUEUE_KINDS[kind], detail });
  const of = (m) => readings.filter((r) => r.metric === m).sort((a, b) => a.ts.localeCompare(b.ts));

  // Bursts: activity ≥ 0.5, merged when within 5 minutes.
  let lastBurst = -Infinity;
  for (const r of of("activity_index")) {
    const t = Date.parse(r.ts);
    if (r.value >= 0.5 && t - lastBurst > 5 * 60000) push("activity_burst", t - 60000, `activity ${r.value.toFixed(2)}`);
    if (r.value >= 0.5) lastBurst = t;
  }
  // Stillness runs of 10+ minutes: their start and end.
  let run = null;
  const closeRun = () => {
    if (run && run.minutes >= 10) {
      push("still_start", run.startMs, `${Math.round(run.minutes)} min still`);
      push("still_end", run.endMs, `after ${Math.round(run.minutes)} min still`);
    }
    run = null;
  };
  for (const r of of("inactive_minutes")) {
    const w = r.meta?.windowMin ?? 1, t = Date.parse(r.ts);
    if (r.value >= 0.75 * w) {
      if (run && t - run.endMs <= (w * 60 + 90) * 1000) { run.endMs = t; run.minutes += r.value; }
      else { closeRun(); run = { startMs: t - w * 60000, endMs: t, minutes: r.value }; }
    } else closeRun();
  }
  closeRun();
  // Floor events are reported when the patch fades; the act was minutes_warm earlier.
  for (const [m, kind] of [["urination_event", "floor_urination"], ["excretion_event", "floor_excretion"]])
    for (const r of of(m)) push(kind, Date.parse(r.ts) - (r.meta?.minutes_warm ?? 0) * 60000, `${r.meta?.peak_c ?? "?"} °C patch`);
  for (const r of of("vice_event")) if ((r.meta?.kind || "weaving") === "weaving") push("weaving", Date.parse(r.ts) - 60000);

  // Random sample: a fixed point per hour of footage (deterministic, so the
  // list does not reshuffle between visits).
  for (const c of clips) {
    const a = Date.parse(c.at), b = Date.parse(c.end);
    for (let h = Math.floor(a / 3600000); h * 3600000 < b; h++) {
      for (let k = 0; k < randomPerHour; k++) {
        const t = h * 3600000 + ((h * 7919 + k * 104729) % 3600) * 1000;
        if (t >= a && t < b) push("random", t);
      }
    }
  }
  // Only moments we have footage of; attach the clip.
  const out = [];
  for (const it of items) {
    const t = it.at;
    const clip = clips.find((c) => t >= c.at && t < c.end);
    if (!clip) continue;
    out.push({ ...it, id: `${clip.camera}:${it.kind}:${t}`, camera: clip.camera, clip: clip.id });
  }
  const seen = new Set();
  return out.filter((x) => (seen.has(x.id) ? false : seen.add(x.id))).sort((a, b) => b.at.localeCompare(a.at));
}
