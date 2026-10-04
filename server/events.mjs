// What happened to a horse, as events a person can check: each with a short
// video clip, a verdict (normal / watch / call the vet), what to do next and
// the behaviour-guide entry that explains it — and buttons for a vet to say
// "right" or "not right", which become training data.
//
// Also the accuracy kit: staff count breaths (or say lying / eating / standing)
// on clips the system measured, and the agreement is reported the way method
// studies do (bias and limits of agreement, per reading and per night).
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { listClips, clipPath, LABELS } from "./footage.mjs";

const H = 3600 * 1000;
const id = (...parts) => createHash("sha256").update(parts.join("|")).digest("base64url").slice(0, 16);

/** What each kind of event means and what to do — from the behaviour guide (server/knowledge.mjs). */
export const EVENT_KINDS = {
  lie_down: { title: "Lay down", verdict: "normal", pattern: "normal_lying", label: "lies_down",
    next: "Nothing to do — normal rest. Repeated lying down and getting up within minutes is different: check for colic." },
  get_up: { title: "Got up", verdict: "normal", pattern: "getting_up", label: "gets_up",
    next: "Nothing to do. Several attempts to rise, or rolling to get up, is worth a look at the legs and back." },
  down_up: { title: "Lying down and getting up again and again", verdict: "vet", pattern: "down_up",
    next: "Look at the horse now: repeated lying down and getting up is the commonest colic sign. Call the vet if it continues, or with sweating, pawing or rolling." },
  weaving: { title: "Weaving", verdict: "watch", pattern: "weaving", label: "weaving",
    next: "Not an emergency. Note when it happens (before feeds, before turnout); more forage, sight and touch of a neighbour, or turnout reduce it. Do not fit an anti-weave grille." },
  box_walking: { title: "Box walking", verdict: "watch", pattern: "box_walking", label: "box_walking",
    next: "Note whether it follows a neighbour leaving. More turnout and company help; check the horse is not distressed." },
  head_tossing: { title: "Head tossing", verdict: "watch", pattern: "head_tossing", label: "head_tossing",
    next: "If it is worse in sunlight or with nose rubbing, ask the vet about headshaking (nerve pain). Otherwise note when it happens." },
  urination: { title: "Urination", verdict: "normal", pattern: "urination", label: "urinating",
    next: "Normal. Frequent small amounts, straining, or red or brown urine need the vet." },
  excretion: { title: "Droppings", verdict: "normal", pattern: "manure_frequency", label: "defecating",
    next: "Normal. Fewer droppings than usual together with eating less is an early colic sign." },
  fast_breathing: { title: "Fast breathing", verdict: "watch", pattern: "resp_rate",
    next: "Count the breaths yourself for 30 s. Fast breathing at rest in the shade, or with dullness, flared nostrils or no sweat in heat, needs the vet." },
  eye_odd: { title: "Eye reading too hot to be an eye", verdict: "watch", pattern: "eye_temperature",
    next: "Check the thermal picture at this moment: people beside the camera, sun or a lamp read hotter than any eye. Take a rectal temperature if the horse seems unwell." },
  eye_rise: { title: "Eye temperature up", verdict: "watch", pattern: "fever_first",
    next: "Take a rectal temperature (fever is 38.6 °C or more). If raised: isolate the horse and call the vet — fever comes before other signs of strangles and influenza." },
  other_horse: { title: "Looks like a different horse", verdict: "watch", pattern: null,
    next: "Check which horse is in the stall, and update the Horses page if they were moved — until then its readings may be filed under the wrong horse." },
  visit: { title: "Someone at the stall", verdict: "normal", pattern: "pain_hidden",
    next: "Nothing to do. Horses hide discomfort while people are with them, so behaviour is not judged during visits." },
  alert: { title: "Alert", verdict: "watch", pattern: null, next: "See the alert's detail." },
};
const VERDICT_RANK = { vet: 0, watch: 1, normal: 2 };

/** The events in [from, to) from a horse's readings (and its current alerts). */
export function buildEvents(horse, readings, { from, to, alerts = [], eyeBaseline = null, peopleTrusted = () => true } = {}) {
  const inWin = readings.filter((r) => { const t = Date.parse(r.ts); return t >= from && t < to; })
    .sort((a, b) => a.ts.localeCompare(b.ts));
  const out = [];
  const push = (kind, r, extra = {}) => {
    const def = EVENT_KINDS[kind];
    const at = r.ts;
    out.push({
      id: id(horse.id, kind, at, r.meta?.deviceId ?? ""), horse: horse.id, horseName: horse.name, kind, title: def.title,
      at, verdict: extra.verdict ?? def.verdict, next: extra.next ?? def.next, pattern: def.pattern, label: def.label ?? null,
      camera: r.meta?.deviceId ?? null, stall: r.stallId ?? null, stream: extra.stream ?? "visible",
      where: r.meta?.where ?? null, box: r.meta?.box ?? null, detail: extra.detail ?? null,
      source: r.source ?? null, prototype: Boolean(r.meta?.prototype), view: r.meta?.view ?? null,
    });
  };
  const lieDowns = [];
  // Floor patches within 10 minutes of another are bedding being moved (the
  // horse lying down, turning in the straw) — not events, as in the report.
  const patches = inWin.filter((r) => r.metric === "urination_event" || r.metric === "excretion_event").map((r) => Date.parse(r.ts));
  const alone = (r) => patches.filter((t) => Math.abs(t - Date.parse(r.ts)) <= 10 * 60000).length === 1;
  for (const r of inWin) {
    const m = r.metric, k = r.meta?.kind;
    if (m === "posture_event" && (k === "lie_down" || k === "get_up")) {
      push(k, r);
      if (k === "lie_down") lieDowns.push(Date.parse(r.ts));
    } else if (m === "vice_event" && EVENT_KINDS[k]) push(k, r, { detail: r.meta?.windowMin ? `${r.meta.windowMin} min in the window` : null });
    else if ((m === "urination_event" || m === "excretion_event") && alone(r)) push(m.replace("_event", ""), r, { detail: r.meta?.tier ?? null });
    else if (m === "respiratory_rate_bpm" && r.value >= 20)
      push("fast_breathing", r, { stream: r.source === "visible_video" ? "visible" : "thermal", verdict: r.value >= 24 ? "vet" : "watch", detail: `${Math.round(r.value)} breaths a minute` });
    else if (m === "body_temp_c" && r.value > 39.5)                // no eye in a stall reads this: people, sun, a lamp
      push("eye_odd", r, { stream: "thermal", detail: `${r.value.toFixed(1)} °C` });
    else if (m === "body_temp_c" && eyeBaseline !== null && r.meta?.calibrated !== false && r.value - eyeBaseline >= 1.0)
      push("eye_rise", r, { stream: "thermal", verdict: r.value - eyeBaseline >= 1.5 ? "vet" : "watch",
        detail: `${r.value.toFixed(1)} °C, ${(r.value - eyeBaseline).toFixed(1)} °C above this horse's normal` });
    else if (m === "horse_identity" && r.meta?.verdict === "other")
      push("other_horse", r, { detail: `looks like ${r.meta?.bestName ?? r.meta?.best ?? "another horse"} (${r.meta?.bestScore ?? "?"})` });
    else if (m === "people_in_view_s" && r.value >= 20 && peopleTrusted(r.meta?.deviceId)) {
      const last = out.findLast((e) => e.kind === "visit");
      if (!last || Date.parse(r.ts) - Date.parse(last.at) > 10 * 60000) push("visit", r);
    }
  }
  // Repeated lying down: 3 or more lie-downs within an hour (our watch rule — no published count).
  for (let i = 0; i + 2 < lieDowns.length; i++) {
    if (lieDowns[i + 2] - lieDowns[i] <= H) {
      const r = inWin.find((x) => Date.parse(x.ts) === lieDowns[i + 2] && x.metric === "posture_event");
      if (r && !out.some((e) => e.kind === "down_up" && Math.abs(Date.parse(e.at) - lieDowns[i + 2]) < H))
        push("down_up", r, { detail: "3 lie-downs within an hour (EquiCare's watch rule)" });
    }
  }
  for (const a of alerts) {
    out.push({ id: id(horse.id, "alert", a.id), horse: horse.id, horseName: horse.name, kind: "alert", title: a.type,
      // the system's own trouble (no data, a camera off) is for whoever runs it, not the vet
      at: a.ts ?? new Date(to).toISOString(), verdict: /monitoring|offline|no .*data|camera|device/i.test(a.type) ? "watch" : a.severity === "alert" ? "vet" : a.severity === "warn" ? "watch" : "normal",
      next: a.detail, pattern: null, label: null, camera: null, stall: horse.stall ?? null, stream: "visible", where: null, box: null,
      detail: a.time ?? null, source: "alert", prototype: false, view: null });
  }
  return out.sort((a, b) => (VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]) || b.at.localeCompare(a.at));
}

// --------------------------------------------------------------------------- //
// Clips
// --------------------------------------------------------------------------- //
export const clipsDir = () => process.env.EQUICARE_CLIPS_DIR || join(homedir(), "EquiCare-demo", "clips");
const making = new Map();

/** The recorded clip file covering `atMs` on a camera's stream, with its start. */
export function recordingAt(camera, stream, atMs, root) {
  const c = listClips(root).find((x) => x.camera === camera && x[stream] && Date.parse(x[stream].at) <= atMs && atMs < Date.parse(x.end));
  if (!c) return null;
  const path = clipPath(camera, stream, c[stream].start, root);
  return path ? { path, startMs: Date.parse(c[stream].at), endMs: Date.parse(c.end) } : null;
}

/** ffmpeg filters: the horse's stall (crop, 0..1), a box at what was measured, slow motion. */
export function clipFilters({ crop = null, mark = null, slow = false, width = 640 }) {
  const vf = [];
  if (crop) {
    const [x0, y0, x1, y1] = crop;
    vf.push(`crop=iw*${(x1 - x0).toFixed(4)}:ih*${(y1 - y0).toFixed(4)}:iw*${x0.toFixed(4)}:ih*${y0.toFixed(4)}`);
  }
  vf.push(`scale=${Math.round(width / 2) * 2}:-2`);
  if (mark) {
    // mark: {x0,y0,x1,y1} 0–10000 of the (cropped) picture, or a point {x,y}
    const b = "x0" in mark ? mark : { x0: mark.x - 250, y0: mark.y - 250, x1: mark.x + 250, y1: mark.y + 250 };
    const f = (v) => Math.max(0, Math.min(1, v / 10000)).toFixed(4);
    vf.push(`drawbox=x=iw*${f(b.x0)}:y=ih*${f(b.y0)}:w=iw*${(Math.max(0.01, (b.x1 - b.x0) / 10000)).toFixed(4)}:h=ih*${(Math.max(0.01, (b.y1 - b.y0) / 10000)).toFixed(4)}:color=orange@0.9:t=3`);
  }
  if (slow) vf.push("setpts=2.0*PTS");
  return vf.join(",");
}

/** A short browser-playable clip around a moment (cached). Resolves to a file
 *  path, or null when nothing was recorded then. */
export async function cutClip({ camera, stream = "visible", atMs, beforeS = 10, afterS = 20, crop = null, mark = null, slow = false, root }) {
  const rec = recordingAt(camera, stream, atMs, root);
  if (!rec) return null;
  const startS = Math.max(0, (atMs - rec.startMs) / 1000 - beforeS);
  const durS = Math.min(beforeS + afterS, Math.max(1, (rec.endMs - rec.startMs) / 1000 - startS));
  const vf = clipFilters({ crop, mark, slow });
  const dir = clipsDir();
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${id(rec.path, startS.toFixed(1), durS.toFixed(1), vf)}.mp4`);
  if (existsSync(out) && statSync(out).size > 0) return out;
  if (!making.has(out)) {
    const tmp = `${out}.part-${process.pid}.mp4`;
    making.set(out, new Promise((resolve, reject) => {
      const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", startS.toFixed(2), "-t", durS.toFixed(2), "-i", rec.path,
        "-vf", vf, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp]);
      let err = "";
      ff.stderr.on("data", (d) => (err += d));
      ff.on("error", (e) => reject(e.code === "ENOENT" ? new Error("ffmpeg is not installed on the site server") : e));
      ff.on("exit", (code) => {
        if (code === 0) { renameSync(tmp, out); resolve(out); return; }
        try { unlinkSync(tmp); } catch { /* nothing */ }
        reject(new Error(`clip failed: ${err.slice(-200)}`));
      });
    }).finally(() => making.delete(out)));
  }
  return making.get(out);
}

// --------------------------------------------------------------------------- //
// Reviews: a person says whether the event was right
// --------------------------------------------------------------------------- //
const LABEL_KEYS = new Set(LABELS.map((l) => l.key));
export function validateReview(body) {
  const errs = [];
  const verdict = String(body?.verdict ?? "");
  if (!["confirmed", "wrong"].includes(verdict)) errs.push('verdict must be "confirmed" or "wrong"');
  const note = String(body?.note ?? "").slice(0, 500);
  if (verdict === "wrong" && !note) errs.push("say what it really was (a note), so the system can learn from it");
  return { review: { verdict, note }, errs };
}
/** The footage label a confirmed event becomes (training data), or null. */
export function labelFor(event, review, by) {
  if (review.verdict !== "confirmed" || !event.label || !LABEL_KEYS.has(event.label) || !event.camera) return null;
  return { camera: event.camera, clip: "", label: event.label, startAt: new Date(Date.parse(event.at)).toISOString(), endAt: null,
    note: `confirmed from an event${review.note ? `: ${review.note}` : ""}`, horse: event.horseName, stall: event.stall, by, createdAt: new Date().toISOString() };
}

// --------------------------------------------------------------------------- //
// Accuracy kit
// --------------------------------------------------------------------------- //
const STATES = ["lying", "eating", "resting", "moving"];
/** Minutes to check: ones the system measured, with video, spread over the
 *  window (random but repeatable for a seed). kind: breathing | state. */
export function sampleMoments(readings, clips, { kind = "breathing", n = 10, seed = 1, done = new Set() } = {}) {
  const has = (r) => clips.some((c) => c.camera === r.meta?.deviceId && c.visible && Date.parse(c.at) <= Date.parse(r.ts) && Date.parse(r.ts) < Date.parse(c.end));
  const pool = readings.filter((r) => (kind === "breathing" ? r.metric === "respiratory_rate_bpm" : r.metric === "time_budget" && r.value >= 50))
    .filter((r) => !done.has(`${r.meta?.deviceId}|${r.ts}`) && has(r));
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const picked = [];
  const copy = [...pool];
  while (picked.length < n && copy.length) picked.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
  return picked.sort((a, b) => a.ts.localeCompare(b.ts)).map((r) => ({
    at: r.ts, camera: r.meta?.deviceId, stall: r.stallId ?? null, kind,
    // for breathing, the clip is the 30 s the rate was measured over: the minute's start
    stream: kind === "breathing" ? (r.source === "visible_video" || /flank/.test(r.meta?.method ?? "") ? "visible" : "thermal") : "visible",
  }));
}

export function validateCheck(body) {
  const errs = [];
  const kind = String(body?.kind ?? "");
  if (!["breathing", "state"].includes(kind)) errs.push("kind must be breathing or state");
  const at = Date.parse(body?.at ?? "");
  if (!Number.isFinite(at)) errs.push("at must be the moment checked");
  const camera = String(body?.camera ?? "");
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(camera)) errs.push("camera is required");
  let value = null;
  if (kind === "breathing") {
    const breaths = Number(body?.breaths), seconds = Number(body?.seconds ?? 30);
    if (!(Number.isInteger(breaths) && breaths >= 0 && breaths <= 100)) errs.push("breaths must be a count, 0–100");
    if (!(seconds >= 10 && seconds <= 120)) errs.push("seconds counted must be 10–120");
    value = errs.length ? null : Math.round((breaths * 60 / seconds) * 10) / 10;
  } else if (kind === "state") {
    value = String(body?.state ?? "");
    if (!STATES.includes(value)) errs.push(`state must be one of ${STATES.join(", ")}`);
  }
  return { check: { kind, at: Number.isFinite(at) ? new Date(at).toISOString() : null, camera, value, horse: body?.horse ? String(body.horse) : null }, errs };
}

/** The system's own value at a checked moment. */
export function systemValue(readings, check) {
  const t = Date.parse(check.at);
  const near = readings.filter((r) => r.meta?.deviceId === check.camera && Math.abs(Date.parse(r.ts) - t) <= 30000);
  if (check.kind === "breathing") return near.find((r) => r.metric === "respiratory_rate_bpm")?.value ?? null;
  const tb = near.find((r) => r.metric === "time_budget");
  if (!tb) return null;
  return STATES.map((k) => [k, Number(tb.meta?.[`${k}S`]) || 0]).sort((a, b) => b[1] - a[1])[0][0];
}

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v) => { const m = mean(v); return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length - 1)); };
const r1 = (v) => Math.round(v * 10) / 10;

/** Agreement between people and the system. Breathing: Bland–Altman (bias,
 *  95% limits of agreement), mean absolute error, share within ±2 /min, and
 *  the same for each night's median. State: agreement and a confusion table. */
export function agreement(checks) {
  const b = checks.filter((c) => c.kind === "breathing" && typeof c.system === "number" && typeof c.value === "number");
  const s = checks.filter((c) => c.kind === "state" && c.system && c.value);
  const out = { breathing: null, state: null };
  if (b.length) {
    const d = b.map((c) => c.system - c.value);
    const bias = mean(d), spread = b.length > 1 ? sd(d) : 0;
    const nights = new Map();
    for (const c of b) { const k = c.at.slice(0, 10); (nights.get(k) || nights.set(k, { sys: [], man: [] }).get(k)).sys.push(c.system); nights.get(k).man.push(c.value); }
    const med = (v) => { const x = [...v].sort((p, q) => p - q), m = x.length >> 1; return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2; };
    const nd = [...nights.values()].map((n) => med(n.sys) - med(n.man));
    out.breathing = {
      n: b.length, bias: r1(bias), sd: r1(spread), limits: [r1(bias - 1.96 * spread), r1(bias + 1.96 * spread)],
      mae: r1(mean(d.map(Math.abs))), within2: Math.round((100 * d.filter((x) => Math.abs(x) <= 2).length) / d.length),
      nights: nd.length, nightMae: nd.length ? r1(mean(nd.map(Math.abs))) : null,
      enough: b.length >= 30,
    };
  }
  if (s.length) {
    const table = Object.fromEntries(STATES.map((k) => [k, Object.fromEntries(STATES.map((j) => [j, 0]))]));
    for (const c of s) if (table[c.value] && table[c.value][c.system] !== undefined) table[c.value][c.system] += 1;
    out.state = { n: s.length, agree: Math.round((100 * s.filter((c) => c.system === c.value).length) / s.length), table, enough: s.length >= 50 };
  }
  return out;
}
