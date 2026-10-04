// Body temperature from the cameras alone — no thermometer.
//
// The thermal camera reads the eye's surface (the warm inner corner), which is
// about 2 °C below the body and, across horses and seasons, does not track it
// one-for-one (CLINICAL_RESEARCH.md, part C). What it does track well is the
// same horse against itself, at the same time of day, in the same stall
// warmth. So each horse's normal eye temperature is learned while it is well:
//
//   1. its eye readings of the last 14 days (not the last 6 h, so a fever
//      building now does not raise its own normal), only good ones — an
//      eye-shaped hot spot, nobody at the stall (the colour camera), not
//      during the thermal camera's recalibration;
//   2. allowing for the stall's warmth, which the thermal camera sees in the
//      walls and floor (a warmer stall warms the eye surface);
//   3. at this time of day (the body is coolest before dawn, warmest in the
//      evening).
//
// Body temperature = a normal resting body temperature (horse 37.8, donkey
// 37.1, mule 37.6 °C) + how far the eye is now from this horse's normal. The
// ± is how much this horse's eye wanders on ordinary days. A fever shows as
// the eye rising well past that. No thermometer is needed or asked for.
import { eyeSetAside, peopleMinutes } from "./reading-rules.mjs";

const MIN = 60000, H = 60 * MIN, DAY = 24 * H;
export const NORMAL_C = { horse: 37.8, donkey: 37.1, mule: 37.6 };   // resting means (Equine Guelph; donkeys lower)
export const FEVER_C = 38.6;                // AAEP's fever line
export const BASE_DAYS = 14, LEARN_DAYS = 3, SETTLED_DAYS = 7;
export const RISE_MIN_C = 0.8;              // a fever must also be this far above the horse's own normal
export const RISING_C = 0.5;                // "rising": this far above, and past the horse's everyday range
const NOW_WINDOW_MS = 30 * MIN;
const EXCLUDE_RECENT_MS = 6 * H;
const TOD_HOURS = 2;                        // "this time of day": ±2 h

const median = (v) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const hourOf = (ms) => { const d = new Date(ms); return d.getHours() + d.getMinutes() / 60; };
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

export const normalFor = (bio) => NORMAL_C[String(bio?.species || "horse").toLowerCase()] ?? NORMAL_C.horse;

/** Good eye readings: aimed, eye-like, nobody at the stall. */
function eyeRows(rd) {
  const people = peopleMinutes(rd);
  return rd.filter((r) => r.metric === "body_temp_c" && r.source === "thermal_camera" && r.meta?.calibrated !== false && !eyeSetAside(r, people))
    .map((r) => ({ v: r.value, t: Date.parse(r.ts), bg: typeof r.meta?.bgC === "number" ? r.meta.bgC : null, ts: r.ts }))
    .filter((r) => Number.isFinite(r.t));
}

/** This horse's normal eye temperature, learned from its own readings:
 *  { slope, bg0, days, spread, at(hour, bg) } or { days } while learning. */
export function eyeNormal(rd, now = Date.now()) {
  const rows = eyeRows(rd).filter((r) => r.t <= now - EXCLUDE_RECENT_MS && now - r.t <= BASE_DAYS * DAY);
  const days = new Set(rows.map((r) => dayOf(r.t))).size;
  if (days < LEARN_DAYS) return { days, ready: false };
  // the stall's warmth: how much this horse's eye moves with it (only when
  // the stall has varied enough to tell; a warmer stall warms the eye)
  const withBg = rows.filter((r) => r.bg !== null);
  let slope = 0, bg0 = null;
  if (withBg.length >= 20 && withBg.length >= 0.8 * rows.length) {
    const bgs = withBg.map((r) => r.bg);
    if (Math.max(...bgs) - Math.min(...bgs) >= 3) {
      bg0 = bgs.reduce((a, b) => a + b, 0) / bgs.length;
      const v0 = withBg.reduce((a, r) => a + r.v, 0) / withBg.length;
      let sxy = 0, sxx = 0;
      for (const r of withBg) { sxy += (r.bg - bg0) * (r.v - v0); sxx += (r.bg - bg0) ** 2; }
      slope = Math.max(0, Math.min(0.6, sxx ? sxy / sxx : 0));
    }
  }
  const adj = (r) => r.v - (slope && r.bg !== null ? slope * (r.bg - bg0) : 0);
  // the time-of-day normal, per half hour (cached: a fortnight of minute readings is ~20,000)
  const hours = rows.map((r) => hourOf(r.t)), adjusted = rows.map(adj), dayKeys = rows.map((r) => dayOf(r.t));
  const overall = median(adjusted);
  const memo = new Map();
  const typical = (h) => {
    const k = Math.round(h * 2) / 2;
    if (!memo.has(k)) {
      const vals = [], ds = new Set();
      for (let i = 0; i < rows.length; i++) {
        const dh = Math.abs(hours[i] - k);
        if (Math.min(dh, 24 - dh) <= TOD_HOURS) { vals.push(adjusted[i]); ds.add(dayKeys[i]); }
      }
      memo.set(k, ds.size >= LEARN_DAYS ? median(vals) : overall);
    }
    return memo.get(k);
  };
  // how far this horse's eye wanders on ordinary days, against its own time-of-day normal
  const dev = rows.map((r, i) => adjusted[i] - typical(hours[i]));
  const sd = Math.sqrt(dev.reduce((a, b) => a + b * b, 0) / Math.max(1, dev.length - 1));
  return {
    ready: true, settled: days >= SETTLED_DAYS, days, slope: round(slope, 2), bg0: round(bg0, 1),
    spread: round(Math.max(0.2, 1.96 * sd), 1),
    adjust: (v, bg) => v - (slope && typeof bg === "number" ? slope * (bg - bg0) : 0),
    at: typical,
  };
}

/** The camera's body temperature now: { value, rise, within, at, readings, learning, settled } or null. */
export function cameraBodyTemp(bio, rd, now = Date.now()) {
  const recent = eyeRows(rd).filter((r) => r.t <= now && now - r.t <= NOW_WINDOW_MS);
  if (!recent.length) return null;
  const norm = eyeNormal(rd, now);
  // while learning there is no body temperature yet — only the eye itself
  if (!norm.ready) return { value: null, learning: true, days: norm.days, needed: LEARN_DAYS, eye: round(median(recent.map((r) => r.v)), 1) };
  const eye = median(recent.map((r) => norm.adjust(r.v, r.bg)));
  const rise = eye - norm.at(hourOf(now));
  const latest = recent.reduce((a, r) => (r.t > a.t ? r : a), recent[0]);
  return { value: round(normalFor(bio) + rise, 1), rise: round(rise, 1), within: norm.spread, at: latest.ts,
    readings: recent.length, learning: false, settled: norm.settled, days: norm.days, source: "camera" };
}

/** Body temperature for the pages and reports: the camera's — or, from older
 *  set-ups that sent one, a body sensor's reading of the last 6 h. */
const MEASURED = (r) => r.metric === "body_temp_c" && r.source !== "thermal_camera";
export function bodyTemperature(bio, rd, now = Date.now()) {
  const camera = cameraBodyTemp(bio, rd, now);
  const ref = rd.filter((r) => MEASURED(r) && now - Date.parse(r.ts) <= 6 * H && Date.parse(r.ts) <= now)
    .sort((a, b) => b.ts.localeCompare(a.ts))[0];
  const measured = ref ? { value: round(ref.value, 1), at: ref.ts, source: "sensor" } : null;
  return { current: camera && camera.value !== null ? camera : measured, camera, measured };
}

/** A fever by the camera: the body temperature at or past the line AND the eye
 *  clearly above this horse's own normal (beyond its everyday wandering). */
export const isFever = (c) => Boolean(c && c.value !== null && c.value >= FEVER_C && c.rise >= Math.max(RISE_MIN_C, c.within));

/** Days with a camera fever in the last `days` (for "two days running"). */
export function feverDays(bio, rd, now = Date.now(), days = 3) {
  const out = new Set();
  for (let k = 0; k < days * 8; k++) {           // every 3 h
    const t = now - k * 3 * H;
    if (isFever(cameraBodyTemp(bio, rd, t))) out.add(dayOf(t));
  }
  return out.size;
}

/** Temperature alerts: [{ type, severity, detail, ts }]. */
export function temperatureAlerts(bio, rd, now = Date.now(), { scheduledNote = "" } = {}) {
  const out = [];
  const push = (type, severity, detail, ts) => out.push({ type, severity, detail, ts });
  const name = bio?.name ?? "The horse";
  const t = bodyTemperature(bio, rd, now);
  const c = t.camera;
  if (c?.learning && c.eye !== null && c.eye >= FEVER_C) {
    // before this horse's normal is learned: the eye's surface is cooler than
    // the body, so an eye this warm means the body is at least this warm
    push("Possible fever", "alert",
      `${name}: the eye alone reads ${c.eye.toFixed(1)} °C by the thermal camera — the eye is cooler than the body, so the body is ` +
      `at or above the ${FEVER_C} °C fever line (this horse's own normal is still being learned). Keep it apart from others and call the vet.`,
      latestEye(rd, now));
  } else if (isFever(c)) {
    const twoDays = feverDays(bio, rd, now) >= 2;
    push("Possible fever", "alert",
      `${name}: body temperature about ${c.value.toFixed(1)} °C by the thermal camera — ${c.rise.toFixed(1)} °C above its normal at this time of day ` +
      `(its everyday range ±${c.within} °C${c.settled ? "" : `; learned from ${c.days} days so far`}). ` +
      (twoDays ? `High on two days. ${scheduledNote}` : "Fever is the first sign of influenza, EHV and strangles: keep the horse apart from others, check it is eating and breathing normally, and call the vet."),
      c.at);
  } else if (c && c.value !== null && c.rise >= Math.max(RISING_C, c.within)) {
    push("Body temperature rising", "warn",
      `${name}: body temperature about ${c.value.toFixed(1)} °C by the thermal camera — ${c.rise.toFixed(1)} °C above its normal at this time ` +
      `of day, beyond its everyday ±${c.within} °C. Look at the horse: is it eating, is its breathing normal? The camera keeps watching.`, c.at);
  }
  return out;
}

function latestEye(rd, now) {
  const r = eyeRows(rd).filter((x) => x.t <= now).reduce((a, x) => (!a || x.t > a.t ? x : a), null);
  return r ? r.ts : new Date(now).toISOString();
}
