// Each horse's own normal, and how a day compares with it.
//
// Horses differ far more from each other than one horse differs from night to
// night (lying 0–319 min a day between horses; Kelemen 2021; Helmerich 2025),
// so a vet reads "+40% lying for this horse" better than "62 min". The
// baseline is a window of the horse's own days — by default its first three
// days with at least 4 hours seen — which a vet can move ("set baseline").
//
// A day runs noon to noon in the stable's time zone, so a night is never cut
// in two. Shares (lying, eating, standing at rest, moving) are of the time the
// horse was SEEN, so a day watched for 9 hours compares with one watched for 24.
//
// What counts as a notable change is OUR threshold (no published one exists
// for most of these), marked so in the result.
import { peopleMinutes, floorAlone, eyeSetAside } from "./reading-rules.mjs";
import { settlingTimes } from "./care-log.mjs";

const DAY_MS = 24 * 3600 * 1000;
const MIN_SEEN_S = 4 * 3600;            // a day with less seen time is not used for the baseline
// The normal is the 14 settled days before the day compared (a rolling
// window): judging from 3, provisional until 7. Horses differ a lot from day
// to day and take several nights to settle in a new stall (part E of
// CLINICAL_RESEARCH.md), so the first two nights after a move or arrival
// are left out.
export const MIN_BASE_DAYS = 3, PROVISIONAL_DAYS = 7, MAX_BASE_DAYS = 14;
const SETTLE_MS = 2 * DAY_MS;

/** The measures compared, how to read them from a day, and what change is notable (ours). */
export const MEASURES = [
  { key: "lying", label: "Lying down", unit: "% of time seen", share: "lyingS", notable: { rel: 0.4, abs: 3 }, pattern: "normal_lying" },
  { key: "eating", label: "Eating at the hay", unit: "% of time seen", share: "eatingS", notable: { rel: 0.3, abs: 4 }, pattern: "eating_time" },
  { key: "resting", label: "Standing at rest", unit: "% of time seen", share: "restingS", notable: { rel: 0.3, abs: 5 }, pattern: "standing_rest" },
  { key: "moving", label: "Moving about", unit: "% of time seen", share: "movingS", notable: { rel: 0.5, abs: 2 }, pattern: "restless" },
  { key: "activity", label: "Activity", unit: "index 0–1", metric: "activity_index", notable: { rel: 0.4, abs: 0.03 }, pattern: "restless" },
  { key: "breathing", label: "Breathing", unit: "/min", metric: "respiratory_rate_bpm", notable: { rel: 0.2, abs: 3 }, pattern: "resp_rate" },
  { key: "eye", label: "Eye temperature", unit: "°C", metric: "body_temp_c", notable: { rel: 0, abs: 1.0 }, pattern: "eye_temperature" },
  { key: "manure", label: "Droppings", unit: "per day", count: "excretion_event", notable: { rel: 0.5, abs: 3 }, pattern: "manure_frequency" },
];

const median = (v) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (v, d = 1) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);

/** Noon (local) on or before ms, in time zone tz. */
export function dayStart(ms, tz = "UTC") {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(ms).map((x) => [x.type, Number(x.value)]));
  const localNow = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset = localNow - Math.floor(ms / 1000) * 1000;            // local - UTC
  let noon = Date.UTC(p.year, p.month - 1, p.day, 12) - offset;
  if (noon > ms) noon -= DAY_MS;
  return noon;
}

/** One row per day with data: { start, end, seenS, lying, eating, …, activity, breathing, eye, manure } */
export function dailyValues(readings, tz = "UTC") {
  const days = new Map();
  // the same rules as every report (server/reading-rules.mjs)
  const people = peopleMinutes(readings);
  const alone = floorAlone(readings);
  const day = (ms) => { const s = dayStart(ms, tz); if (!days.has(s)) days.set(s, { start: s, end: s + DAY_MS, tb: {}, seenS: 0, vals: {}, counts: {} }); return days.get(s); };
  for (const r of readings) {
    const t = Date.parse(r.ts);
    if (!Number.isFinite(t)) continue;
    const d = day(t);
    if (r.metric === "time_budget") {
      for (const k of ["lyingS", "eatingS", "restingS", "movingS", "unseenS"]) d.tb[k] = (d.tb[k] || 0) + (Number(r.meta?.[k]) || 0);
      d.seenS += ["lyingS", "eatingS", "restingS", "movingS"].reduce((x, k) => x + (Number(r.meta?.[k]) || 0), 0);
    } else if (r.metric === "body_temp_c" && (r.meta?.calibrated === false || eyeSetAside(r, people))) {
      continue;                                                       // unaimed, not an eye, or people at the camera
    } else if ((r.metric === "urination_event" || r.metric === "excretion_event") && !alone(r)) {
      continue;                                                       // one of a cluster: bedding moved, not an event
    } else {
      (d.vals[r.metric] ||= []).push(Number(r.value));
      d.counts[r.metric] = (d.counts[r.metric] || 0) + 1;
    }
  }
  const out = [];
  for (const d of [...days.values()].sort((a, b) => a.start - b.start)) {
    const row = { start: new Date(d.start).toISOString(), end: new Date(d.end).toISOString(), seenS: Math.round(d.seenS) };
    for (const m of MEASURES) {
      if (m.share) row[m.key] = d.seenS >= 600 ? round((100 * (d.tb[m.share] || 0)) / d.seenS) : null;
      else if (m.metric) row[m.key] = round(median(d.vals[m.metric] || []), m.key === "activity" ? 3 : 1);
      else if (m.count) row[m.key] = d.seenS >= 600 ? d.counts[m.count] || 0 : null;
    }
    out.push(row);
  }
  return out;
}

/** Days the horse was settling after a move or arrival (ISO day starts). */
function settlingDays(days, moves) {
  return new Set(days.filter((d) => {
    const a = Date.parse(d.start), e = Date.parse(d.end);
    return moves.some((t) => (t >= a && t < e) || (a >= t && a < t + SETTLE_MS));
  }).map((d) => d.start));
}

/** The baseline window: the one set on the horse (a vet's choice), else the
 *  up to 14 settled days with enough seen before the day compared (`before`,
 *  ISO; default: before the newest day). */
export function baselineWindow(horse, days, { before = null, moves = null } = {}) {
  const set = horse?.baseline;
  if (set?.from && set?.to) return { from: set.from, to: set.to, set: true, by: set.setBy ?? null, at: set.setAt ?? null };
  const settling = settlingDays(days, moves ?? (horse?.id ? settlingTimes(horse.id) : []));
  const usable = days.filter((d) => !settling.has(d.start) && (d.seenS >= MIN_SEEN_S || ["breathing", "eye", "activity"].some((k) => d[k] !== null)));
  const cut = before ?? days.at(-1)?.start;
  const earlier = cut ? usable.filter((d) => d.end <= cut) : usable;
  const base = earlier.slice(-MAX_BASE_DAYS);
  if (!base.length) return null;
  return { from: base[0].start, to: base.at(-1).end, set: false, days: base.length, rolling: true,
    provisional: base.length < PROVISIONAL_DAYS, settlingLeftOut: settling.size };
}

const sd = (v) => { if (v.length < 3) return null; const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)); };

/** Compare one day (or a window's days) with the baseline. */
export function compare(horse, readings, { tz = "UTC", from = null, to = null, moves = null } = {}) {
  const days = dailyValues(readings, tz);
  // what is compared: the days in [from, to), else the newest day
  const recent = from !== null && to !== null
    ? days.filter((d) => Date.parse(d.end) > from && Date.parse(d.start) < to)
    : days.slice(-1);
  const win = baselineWindow(horse, days, { before: recent[0]?.start ?? null, moves });
  const inWin = (d) => win && d.start >= win.from && d.end <= win.to;
  const base = days.filter(inWin);
  const learning = !win || (!win.set && base.length < MIN_BASE_DAYS) || !base.length;
  const rows = MEASURES.map((m) => {
    const bv = base.map((d) => d[m.key]).filter((v) => v !== null && v !== undefined);
    const b = median(bv);
    const r = median(recent.map((d) => d[m.key]).filter((v) => v !== null && v !== undefined));
    const change = b !== null && r !== null ? r - b : null;
    const pct = change !== null && b ? (100 * change) / Math.abs(b) : null;
    const notable = change !== null && Math.abs(change) >= m.notable.abs && (m.notable.rel === 0 || Math.abs(change) >= Math.abs(b) * m.notable.rel);
    return { key: m.key, label: m.label, unit: m.unit, baseline: b, spread: round(sd(bv), m.key === "activity" ? 3 : 1), recent: r, change: round(change, m.key === "activity" ? 3 : 1),
      pct: round(pct, 0), notable, direction: change === null ? null : change > 0 ? "up" : change < 0 ? "down" : "same", pattern: m.pattern };
  });
  const inside = recent.length && recent.every(inWin);
  return {
    window: win, learning, provisional: Boolean(win && !win.set && base.length < PROVISIONAL_DAYS), comparedDays: recent.length, baselineDays: base.length,
    sameAsBaseline: Boolean(inside),
    rows, days,
    note: "A change is marked notable at EquiCare's own thresholds (no published ones for most of these) — a reason to look, not a diagnosis.",
  };
}

/** Checks a vet's baseline choice: { from, to } within the data, 1–30 days. */
export function validateBaseline(body, now = Date.now()) {
  if (body?.reset) return { baseline: null, errs: [] };
  const from = Date.parse(body?.from ?? ""), to = Date.parse(body?.to ?? "");
  const errs = [];
  if (!Number.isFinite(from) || !Number.isFinite(to)) errs.push("from and to must be dates");
  else if (to <= from) errs.push("to must be after from");
  else if (to - from < 12 * 3600 * 1000) errs.push("a baseline needs at least 12 hours");
  else if (to - from > 30 * DAY_MS) errs.push("a baseline is at most 30 days");
  else if (from > now) errs.push("a baseline cannot start in the future");
  return { baseline: errs.length ? null : { from: new Date(from).toISOString(), to: new Date(to).toISOString() }, errs };
}
