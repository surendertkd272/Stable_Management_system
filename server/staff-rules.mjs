// Alert rules the stable's own staff set — for one horse or all of them:
//
//   "Toofan is on box rest: urgent if he lies down more than 4 times in 7 hours,
//    between 22:00 and 05:00."
//   "All horses: a watch note if a horse eats at the hay less than 60 minutes
//    in 8 hours."
//
// A rule only ADDS alerts: the built-in ones stay as they are and cannot be
// loosened from here. Each rule is judged on what the camera measured; when
// too little was seen to say "less than", it is not judged (a camera that was
// off is not a horse that ate nothing). One alert per rule, horse and day.
import { splitEye, floorAlone } from "./reading-rules.mjs";

const MIN = 60000, H = 60 * MIN;
const LOCAL_TZ = process.env.EQUICARE_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const countsAsVice = (r) => r.meta?.kind !== "box_walking" || /consecutive/.test(r.meta?.method || "") || (r.meta?.windowMin ?? 0) >= 2;
const sum = (v) => v.reduce((a, b) => a + b, 0);
const median = (v) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const seenS = (r) => ["lyingS", "eatingS", "restingS", "movingS"].reduce((a, k) => a + (Number(r.meta?.[k]) || 0), 0);

// What a rule can watch. kind: "budget" — from the once-a-second time budget
// (needs the camera running); "count" — events the camera saw; "reading" —
// a measured value. max: the largest value a rule may use.
export const MEASURES = {
  lie_downs:  { label: "Lie-downs", unit: "times", kind: "count", max: 50, of: (w) => w.posture("lie_down").length },
  rolls:      { label: "Rolls", unit: "times", kind: "count", max: 20, of: (w) => w.posture("possible_roll").length },
  lying_min:  { label: "Time lying down", unit: "min", kind: "budget", max: 1440, of: (w) => w.budget("lyingS") },
  eating_min: { label: "Time eating at the hay", unit: "min", kind: "budget", max: 1440, of: (w) => w.budget("eatingS") },
  moving_min: { label: "Time moving about", unit: "min", kind: "budget", max: 1440, of: (w) => w.budget("movingS") },
  unseen_min: { label: "Time out of view (not in the stall picture)", unit: "min", kind: "budget", max: 1440, of: (w) => w.budget("unseenS") },
  droppings:  { label: "Droppings", unit: "times", kind: "count", max: 30, of: (w) => w.floor("excretion_event") },
  urination:  { label: "Urinations", unit: "times", kind: "count", max: 30, of: (w) => w.floor("urination_event") },
  vices_min:  { label: "Weaving, box walking or head tossing", unit: "min", kind: "count", max: 1440,
    of: (w) => Math.round(sum(w.of("vice_event").filter(countsAsVice).map((r) => Number(r.meta?.windowMin) || 1))) },
  people_min: { label: "Time with a person at the stall", unit: "min", kind: "count", max: 1440,
    of: (w) => Math.round(sum(w.of("people_in_view_s").map((r) => r.value)) / 60) },
  activity:   { label: "Activity (0 still – 1 very active)", unit: "", kind: "reading", max: 1, decimals: 2,
    of: (w) => { const v = w.of("activity_index").map((r) => r.value); return v.length ? sum(v) / v.length : null; } },
  eye_temp:   { label: "Eye temperature (highest)", unit: "°C", kind: "reading", max: 45, decimals: 1,
    of: (w) => { const v = splitEye(w.rows).used.map((r) => r.value); return v.length ? Math.max(...v) : null; } },
  breathing:  { label: "Breathing rate (median)", unit: "/min", kind: "reading", max: 120, decimals: 1,
    of: (w) => median(w.of("respiratory_rate_bpm").map((r) => r.value)) },
  stall_temp: { label: "Stall temperature (highest)", unit: "°C", kind: "reading", max: 60, decimals: 1,
    of: (w) => { const v = w.of("stall_temp_c").map((r) => r.value); return v.length ? Math.max(...v) : null; } },
};

let RULES = [];
let TZ = LOCAL_TZ;
export function configureStaffRules(list = [], { tz } = {}) {
  RULES = Array.isArray(list) ? list : [];
  if (tz) TZ = tz;
}

const localParts = (ms) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" })
  .formatToParts(ms).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
const inHours = (ms, { from, to }) => { const h = localParts(ms).hour; return from <= to ? h >= from && h < to : h >= from || h < to; };
/** The start of the current "between" period: the latest local hh:00 = from, at or before now. */
function periodStart(now, from) {
  const p = localParts(now);
  let t = now - ((p.minute * 60 + p.second) * 1000 + (now % 1000));
  for (let i = 0; i < 25 && localParts(t).hour !== from; i++) t -= H;
  return t;
}
const two = (n) => String(n).padStart(2, "0");
const span = (min) => (min % 60 ? `${min} min` : `${min / 60} h`);

/** The rule in words: "more than 4 lie-downs in 7 h, between 22:00 and 05:00". */
export function ruleText(rule) {
  const m = MEASURES[rule.measure];
  const v = m.unit === "times" ? `${rule.value} ${m.label.toLowerCase()}` : `${rule.value}${m.unit ? ` ${m.unit}` : ""} of ${m.label.toLowerCase()}`;
  const what = m.kind === "reading" ? `${m.label.toLowerCase()} ${rule.op === "more" ? "above" : "below"} ${rule.value}${m.unit ? ` ${m.unit}` : ""}`
    : `${rule.op === "more" ? "more than" : "less than"} ${v}`;
  return `${what} in ${span(rule.windowMin)}${rule.hours ? `, between ${two(rule.hours.from)}:00 and ${two(rule.hours.to)}:00` : ""}`;
}

/** Judge one rule for one horse's readings at `now`: { judged, fires, value, from, to, why? } */
export function judgeRule(rule, rd, now = Date.now()) {
  const m = MEASURES[rule.measure];
  if (!m) return { judged: false, fires: false, value: null, why: "unknown measure" };
  if (rule.hours && !inHours(now, rule.hours)) return { judged: false, fires: false, value: null, why: "outside its hours" };
  const from = Math.max(now - rule.windowMin * MIN, rule.hours ? periodStart(now, rule.hours.from) : -Infinity);
  const rows = rd.filter((r) => { const t = Date.parse(r.ts); return t > from && t <= now; });
  const of = (metric) => rows.filter((r) => r.metric === metric);
  const tb = of("time_budget");
  const alone = floorAlone(rd.filter((r) => { const t = Date.parse(r.ts); return t > from - 10 * MIN && t <= now + 10 * MIN; }));
  const w = {
    rows, of,
    posture: (kind) => of("posture_event").filter((r) => r.meta?.kind === kind),
    budget: (k) => Math.round(sum(tb.map((r) => Number(r.meta?.[k]) || 0)) / 60),
    floor: (metric) => of(metric).filter(alone).length,
  };
  const windowS = (now - from) / 1000;
  const seen = sum(tb.map(seenS)), watched = sum(tb.map((r) => Number(r.value) || 0));
  let value = m.of(w);
  if (value !== null && m.decimals !== undefined) value = Number(value.toFixed(m.decimals));
  // Enough seen to judge?
  if (m.kind === "reading" && value === null) return { judged: false, fires: false, value, from, to: now, why: "nothing measured" };
  if (m.kind === "budget" && watched < 0.5 * windowS) return { judged: false, fires: false, value, from, to: now, why: "the camera watched less than half the time" };
  if (rule.op === "less" && m.kind === "count" && seen < 0.5 * windowS)
    return { judged: false, fires: false, value, from, to: now, why: "the horse was seen less than half the time" };
  if (rule.op === "less" && m.kind === "budget" && rule.measure !== "unseen_min" && seen < 0.5 * windowS)
    return { judged: false, fires: false, value, from, to: now, why: "the horse was seen less than half the time" };
  if (rule.op === "less" && rule.measure === "activity" && of("activity_index").length < 0.5 * windowS / 60)
    return { judged: false, fires: false, value, from, to: now, why: "activity measured less than half the time" };
  const fires = rule.op === "more" ? value > rule.value : value < rule.value;
  // when it happened: the latest reading that counts, or now for "less than"
  const last = rows.at(-1)?.ts;
  return { judged: true, fires, value, from, to: now, at: rule.op === "more" && last ? last : new Date(Math.floor(now / (5 * MIN)) * 5 * MIN).toISOString() };
}

const valueText = (rule, v) => {
  const m = MEASURES[rule.measure];
  return m.unit === "times" ? `${v} ${v === 1 ? m.label.toLowerCase().replace(/s$/, "") : m.label.toLowerCase()}`
    : `${m.label}: ${v}${m.unit ? ` ${m.unit}` : ""}`;
};

/** The staff-rule alerts for one horse now: [{ type, severity, detail, ts }] */
export function staffRuleAlerts(bio, rd, now = Date.now()) {
  const out = [];
  for (const rule of RULES) {
    if (!rule.enabled || (rule.horse !== "*" && rule.horse !== bio.id)) continue;
    const j = judgeRule(rule, rd, now);
    if (!j.fires) continue;
    out.push({
      type: `Staff rule: ${rule.name}`,
      severity: rule.level === "urgent" ? "alert" : "warn",
      detail: `${valueText(rule, j.value)} in ${span(Math.round((j.to - j.from) / MIN))} — this rule: ${ruleText(rule)}. ` +
        `Set by ${rule.createdBy || "the stable"}${rule.note ? `: ${rule.note.replace(/[.!?]?$/, ".")}` : "."} From the camera.`,
      ts: j.at,
    });
  }
  return out;
}

/** How often the rule would have fired: judged once an hour over the last `days`. */
export function backtest(rule, rd, { days = 7, now = Date.now() } = {}) {
  const fired = [], fireDays = new Set();
  let judged = 0;
  for (let t = now - days * 24 * H; t <= now; t += H) {
    const j = judgeRule(rule, rd, t);
    if (j.judged) judged++;
    if (j.fires) {
      fired.push({ at: new Date(t).toISOString(), value: j.value });
      fireDays.add(new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(t));
    }
  }
  return { checks: days * 24 + 1, judged, fired: fired.length, days: fireDays.size, last: fired.at(-1) ?? null };
}

/** Check and tidy a rule from the page. Returns { rule } or { errors }. */
export function validateRule(body, { horses = [], existing = null } = {}) {
  const b = { ...(existing ?? {}), ...(body ?? {}) };
  const errors = [];
  const m = MEASURES[b.measure];
  if (!m) errors.push("choose what to watch");
  if (b.horse !== "*" && !horses.some((h) => h.id === b.horse)) errors.push("choose a horse, or all horses");
  if (!["more", "less"].includes(b.op)) errors.push('"more than" or "less than"');
  const value = Number(b.value);
  if (!Number.isFinite(value) || value < 0 || (m && value > m.max)) errors.push(m ? `a number from 0 to ${m.max}` : "a number");
  if (b.op === "less" && value === 0) errors.push('"less than 0" can never happen');
  const windowMin = Math.round(Number(b.windowMin));
  if (!Number.isFinite(windowMin) || windowMin < 15 || windowMin > 1440) errors.push("a time from 15 minutes to 24 hours");
  let hours = null;
  if (b.hours) {
    const f = Number(b.hours.from), t = Number(b.hours.to);
    if (![f, t].every((x) => Number.isInteger(x) && x >= 0 && x <= 23) || f === t) errors.push("hours from 0 to 23, and not the same");
    else hours = { from: f, to: t };
  }
  if (!["watch", "urgent"].includes(b.level)) errors.push("a watch note or urgent");
  if (errors.length) return { errors };
  const rule = {
    measure: b.measure, horse: b.horse, op: b.op, value, windowMin, hours, level: b.level,
    note: String(b.note ?? "").trim().slice(0, 200),
    enabled: b.enabled !== false,
  };
  rule.name = String(b.name ?? "").trim().slice(0, 60) || `${m.label} ${b.op === "more" ? "over" : "under"} ${value}${m.unit && m.unit !== "times" ? ` ${m.unit}` : ""}`;
  return { rule };
}
