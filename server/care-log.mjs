// The stable's care log: changes the research ties to illness, entered by
// staff (CLINICAL_RESEARCH.md, parts A, D, H). They open "risk windows" in
// which the colic rule needs one strong sign instead of two, they mark the
// nights a horse is settling (left out of its normal), and they start the
// checks a new arrival or a long journey needs.
//
//   hay_change       new batch of hay             colic OR 4.9–9.8 for 14 days
//   diet_change      change of feed or ration     colic OR 2.2–5.0 for 14 days
//   exercise_change  change in work               colic OR 9.3 for 14 days
//   moved            new stall / into a stable    colic OR 2.3–3.9 for 14 days; gut slowest days 1–5
//   arrived          a new arrival                isolate 3 weeks, temperature daily
//   transport        a journey (hours)            colic OR 17.5 for 24–48 h; ≥ 20 h: 7-day watch
//   weather_change   a big change in the weather  colic OR 3.2 for 3 days
const DAY = 24 * 3600 * 1000, H = 3600 * 1000;

export const KINDS = {
  hay_change:      { label: "New batch of hay", riskDays: 14 },
  diet_change:     { label: "Change of feed or ration", riskDays: 14 },
  exercise_change: { label: "Change in work or exercise", riskDays: 14 },
  moved:           { label: "Moved stall or brought in from pasture", riskDays: 14, settles: true },
  arrived:         { label: "Arrived at the stable", riskDays: 14, settles: true },
  transport:       { label: "Journey", riskDays: 2 },
  weather_change:  { label: "Big change in the weather", riskDays: 3 },
};
export const ISOLATION_DAYS = 21;           // strangles consensus: isolate new arrivals ≥ 3 weeks
export const LONG_JOURNEY_H = 20;           // shipping fever rises after ~20 h
export const POST_JOURNEY_DAYS = 7;

let EVENTS = [];
let HORSES = new Map();                     // id -> horse record (flags, arrival)
export function configureCareLog({ events, horses } = {}) {
  if (events) EVENTS = [...events].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  if (horses) HORSES = new Map(horses.map((h) => [h.id, h]));
}
const forHorse = (id) => EVENTS.filter((e) => e.horseId === id || e.horseId === "*");

/** When the horse moved or arrived — the nights after are left out of its normal. */
export function settlingTimes(horseId) {
  const h = HORSES.get(horseId);
  const t = forHorse(horseId).filter((e) => KINDS[e.kind]?.settles).map((e) => Date.parse(e.at));
  const arr = Date.parse(h?.arrivedAt ?? "");
  if (Number.isFinite(arr)) t.push(arr);
  return t.filter(Number.isFinite);
}

/** The risk windows open for this horse now: [{ kind, text, until }]. Standing
 *  risks (crib-biting, colic before, dental disease) never close. */
export function colicRisks(horseId, now = Date.now()) {
  const out = [];
  for (const e of forHorse(horseId)) {
    const k = KINDS[e.kind], at = Date.parse(e.at);
    if (!k || !Number.isFinite(at) || at > now) continue;
    const long = e.kind === "transport" && Number(e.hours) >= LONG_JOURNEY_H;
    const until = at + (long ? POST_JOURNEY_DAYS * DAY : k.riskDays * DAY);
    if (now <= until) out.push({ kind: e.kind, until, text: e.kind === "transport"
      ? `a ${e.hours ? `${e.hours}-hour ` : ""}journey ${Math.round((now - at) / H)} h ago`
      : `${k.label.toLowerCase()} ${Math.max(0, Math.round((now - at) / DAY))} days ago` });
  }
  const h = HORSES.get(horseId) ?? {};
  if (h.cribBiter) out.push({ kind: "crib_biter", until: Infinity, text: "a crib-biter" });
  if (h.previousColic) out.push({ kind: "previous_colic", until: Infinity, text: "colic before" });
  if (h.dentalIssue) out.push({ kind: "dental", until: Infinity, text: "known dental problem" });
  return out;
}

/** Long journeys within the post-journey watch: [{ at, hours, day }]. */
export function recentLongJourneys(horseId, now = Date.now()) {
  return forHorse(horseId).filter((e) => e.kind === "transport" && Number(e.hours) >= LONG_JOURNEY_H)
    .map((e) => ({ at: Date.parse(e.at), hours: Number(e.hours) }))
    .filter((j) => Number.isFinite(j.at) && now >= j.at && now - j.at <= POST_JOURNEY_DAYS * DAY)
    .map((j) => ({ ...j, day: Math.floor((now - j.at) / DAY) + 1 }));
}

/** A new arrival still in isolation: { since, day } or null. */
export function isolation(horseId, now = Date.now()) {
  const h = HORSES.get(horseId);
  const at = [Date.parse(h?.arrivedAt ?? ""), ...forHorse(horseId).filter((e) => e.kind === "arrived").map((e) => Date.parse(e.at))]
    .filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (at === undefined || now < at || now - at > ISOLATION_DAYS * DAY) return null;
  return { since: new Date(at).toISOString(), day: Math.floor((now - at) / DAY) + 1 };
}

/** Check a care-log entry from the page. Returns { event } or { errors }. */
export function validateEvent(body, { horses = [] } = {}) {
  const errors = [];
  const kind = String(body?.kind ?? "");
  if (!KINDS[kind]) errors.push(`what changed: one of ${Object.keys(KINDS).join(", ")}`);
  const horseId = String(body?.horseId ?? "");
  if (horseId !== "*" && !horses.some((h) => h.id === horseId)) errors.push("choose a horse, or all horses");
  const at = Date.parse(body?.at ?? "") || Date.now();
  if (at > Date.now() + 5 * 60000) errors.push("the time cannot be in the future");
  let hours = null;
  if (kind === "transport") {
    hours = Number(body?.hours);
    if (!(hours > 0 && hours <= 200)) errors.push("journey length in hours (up to 200)");
  }
  if (errors.length) return { errors };
  return { event: { kind, horseId, at: new Date(at).toISOString(), hours, note: String(body?.note ?? "").trim().slice(0, 200) } };
}
