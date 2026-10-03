// Rollup engine: raw sensor readings  ->  the exact Horse/Alert/series shapes
// the React SPA already renders. This is where the 12 raw streams become the
// health/behaviour summaries and alerts. Clinical thresholds are resting-horse
// screening-grade (the camera is +-2 C), tune with vet input + learned baselines.

import { METRICS, SOURCE_STATUS } from "./contract.mjs";

const DAY_MS = 24 * 3600 * 1000;
const BASELINE_TARGET_DAYS = 14;

// ---- resting-horse reference ranges (screening) --------------------------- //
// Contact (rectal) thermometer. Normal adult 37.2–38.6 C (Merck Vet Manual).
const TEMP_FEVER = 38.6, TEMP_WATCH_HI = 38.3, TEMP_LOW = 37.0;
// Eye surface (thermal camera). Infrared eye temperature averages ~35 C, about
// 2 C below rectal, and one study found no significant correlation with rectal
// temperature — so the rectal band would call a healthy horse hypothermic all
// day. An eye reading is judged against the horse's OWN baseline. The deltas
// are our operational choice (no published threshold exists); tune with a vet.
// Without a baseline only a fever can be called: the eye surface is cooler than
// the core, so an eye at >= TEMP_FEVER means the core is at least that hot.
const EYE_RISE_WARN = 1.0, EYE_RISE_ALERT = 1.5, EYE_DROP_WARN = 1.5;   // C vs own baseline
const EYE_BASELINE_DAYS = 3;                        // distinct days before judging
const RESP_ALERT = 24, RESP_WATCH = 20;             // bpm, at rest
const GAIT_WATCH = 0.35;                            // asymmetry 0..1
const REST_MIN_LOW = 180;                           // < 3h lying/day
const WATER_LOW_FRAC = 0.55;                        // < 55% of own baseline
// Camera-behaviour watch notes (prototype detectors). Starting points for a
// vet to confirm — they raise "watch" notes, never alarms.
const NO_URINE_H = 8, NO_MANURE_H = 12;             // hours without an event
let ACT_UNUSUAL_HI = 2.0, ACT_UNUSUAL_LO = 0.4;     // x the horse's own 7-day activity (Settings sensitivity moves these)

/** Site settings that tune prototype watch notes (never clinical thresholds). */
export function configureRollup({ activity } = {}) {
  if (activity?.hi) ACT_UNUSUAL_HI = activity.hi;
  if (activity?.lo) ACT_UNUSUAL_LO = activity.lo;
}
const ACT_BASELINE_DAYS = 3;                        // days of activity needed before judging
// Posture and vices from the camera (prototype). No published thresholds
// exist for any of these (research 27 Sep): each is our rule, stated as such.
const DOWN_UP_COUNT = 3, DOWN_UP_WINDOW_MIN = 60;   // 3+ lie-downs within an hour
const LATERAL_LONG_MIN = 60;                        // normal single bouts stayed <= ~57 min (Kelemen 2021)
const LOW_LYING_NIGHT_MIN = 10, LOW_LYING_NIGHTS = 3; // REM needs >= 30 min lying/day; deprived horses lay ~8
const NIGHT_COVERAGE_MIN = 360;                     // a night counts only with 6 h of camera posture data
const VICE_PHASE_GAP_MIN = 10;                      // bouts <= 10 min apart are one phase (Sambraus 1989)
const VICE_RISE = 1.5;                              // x own 7-day minutes/day
const MANURE_LOW_FRAC = 0.5;                        // < 50 % of own daily count
// Stall sensors (water meter / weighed bucket, weigh-back feeder, hay scale)
// and the wearable set (leg tag, halter hub, pelvis sensor). None of this
// hardware has been run on our horses yet and no published threshold exists
// for any of these rules: every number below is OUR starting point, stated as
// such in the alert, to be tuned with a vet. All raise watch notes, never alarms.
const LEFT_FEED_FRAC = 0.3, LEFT_FEED_OVER_USUAL = 0.15; // left 30 %+ of a meal AND 15 points over own 7-day median
const NO_DRINK_H = 10, WATER_SEEN_H = 48;           // no drink for 10 h, where the meter reported in the last 48 h
const HAY_LOW_FRAC = 0.6;                           // < 60 % of own 7-day daily average, pro rata
const HAY_MIN_DAY_H = 6, HAY_BASELINE_DAYS = 3;     // judge after 6 h of the day, with 3+ earlier days of hay
const FEEDER_FAULT_H = 2;                           // a fault in the last 2 h
const BATTERY_LOW_PCT = 20, BATTERY_WINDOW_H = 1;   // battery < 20 % on a status from the last hour
const DETACHED_H = 2, WEARABLE_SILENT_MIN = 20;     // came off in the last 2 h; silent 20 min while the stall reports
const LAME_RISE_MM = 6, LAME_ABS_MM = 12;           // +6 mm on own normal; 12 mm when there is no normal yet
const LAME_HISTORY_DAYS = 14, LAME_HISTORY_MIN = 3; // own normal = median of 3+ earlier trots in 14 days
const LAME_FRESH_H = 72;                            // a trot older than 3 days is not news

// Monitoring-gap thresholds. A 24/7 monitor that goes blind must SAY so —
// otherwise stale data reads as "calm" and the barn is silently unwatched.
const STALE_WARN_MS = 2 * 3600 * 1000;              // no data 2h  -> warn
const STALE_ALERT_MS = 6 * 3600 * 1000;             // no data 6h  -> alert

const fmtHM = (mins) => `${Math.floor(mins / 60)}h ${String(Math.round(mins % 60)).padStart(2, "0")}m`;

function dayKey(ts) { return new Date(ts).toISOString().slice(0, 10); }
function within(r, ms) { return Date.now() - Date.parse(r.ts) <= ms; }

// Newest reading for a metric. Uses >= (last-write-wins) deliberately: edge
// timestamps are only second/minute precision, so same-timestamp collisions are
// routine. With strict > the FIRST reading in array order would win and a later
// ingested value — e.g. a fever — could be silently ignored.
function latest(readings, metric) {
  let best = null;
  for (const r of readings) if (r.metric === metric && (!best || r.ts >= best.ts)) best = r;
  return best;
}
function sumToday(readings, metric) {
  return readings.filter((r) => r.metric === metric && within(r, DAY_MS))
    .reduce((a, r) => a + r.value, 0);
}
function countToday(readings, metric) {
  return readings.filter((r) => r.metric === metric && within(r, DAY_MS)).length;
}
function baselineDailyAvg(readings, metric, days = 7) {
  const byDay = {};
  for (const r of readings) {
    if (r.metric !== metric) continue;
    if (!within(r, days * DAY_MS)) continue;
    (byDay[dayKey(r.ts)] ||= []).push(r.value);
  }
  const totals = Object.values(byDay).map((v) => v.reduce((a, b) => a + b, 0));
  return totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
}

/** Newest reading timestamp for a horse (ms since epoch), or null if none. */
function lastSeenMs(rd) {
  let newest = null;
  for (const r of rd) {
    const t = Date.parse(r.ts);
    if (newest === null || t > newest) newest = t;
  }
  return newest;
}

/** Human-friendly gap, e.g. "3h 20m". */
function gapText(ms) {
  const mins = Math.floor(ms / 60000);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : `${mins}m`;
}

/** A reading taken through a camera whose ROIs were never aimed (or were aimed
 *  and then the camera moved). It proves the camera is alive, but the number is
 *  whatever sat under a frame-centre ROI — coat, stall wall — not the horse's
 *  eye or nostril. Against the mock that read 31.4 °C: a hypothermia alarm
 *  taken off the coat. Such readings are kept and shown, flagged, and never
 *  judged against clinical thresholds or folded into baselines. */
export const uncalibrated = (r) => r?.meta?.calibrated === false;

/** A reading produced by a heuristic not yet validated on real horses (camera
 *  behaviour: activity, stillness, weaving, floor events). Shown, and used for
 *  "watch" notes, but never for a clinical alarm — the same principle as
 *  uncalibrated readings. Moving in front of the camera read activity 0.55,
 *  which was enough to raise "colic pattern" before this rule. */
export const prototype = (r) => r?.meta?.prototype === true || SOURCE_STATUS[r?.source] === "prototype";

/** This horse's usual eye temperature: the mean of calibrated camera readings
 *  from the last 7 days, excluding the last 6 h (so a fever building now does
 *  not raise its own baseline). Null until the readings span ~EYE_BASELINE_DAYS days. */
export function eyeBaseline(rd, cur) {
  const cutoff = Date.parse(cur.ts) - 6 * 3600 * 1000;
  const rows = rd.filter((r) => r.metric === "body_temp_c" && r.source === cur.source && !uncalibrated(r)
    && Date.parse(r.ts) < cutoff && within(r, 7 * DAY_MS));
  // Span in hours, not calendar dates: 41 h of data can touch 3 dates.
  const ts = rows.map((r) => Date.parse(r.ts));
  if (!rows.length || Math.max(...ts) - Math.min(...ts) < (EYE_BASELINE_DAYS - 0.5) * DAY_MS) return null;
  return rows.reduce((a, r) => a + r.value, 0) / rows.length;
}

// ---- stall sensors and the wearable: shared helpers ---------------------- //
const H_MS = 3600 * 1000;
const sumV = (rows) => rows.reduce((a, r) => a + r.value, 0);
const newestMs = (rows) => rows.reduce((m, r) => Math.max(m, Date.parse(r.ts)), -Infinity);   // no spread: 100k+ rows
function medianOf(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const fmtG = (g) => (g >= 1000 ? `${(g / 1000).toFixed(1)} kg` : `${Math.round(g)} g`);
// "Today" for meals, hay, water and steps is the stable's calendar day (the
// site server's clock), as the staff mean it — not the last 24 h. Days are
// compared as [start, end) ms, not as date strings: a leg tag reporting every
// minute gives tens of thousands of readings, too many to format one by one.
/** The last `n` calendar days, oldest first, as [start, end) ms. */
function lastDays(n) {
  return [...Array(n)].map((_, i) => {
    const d = new Date(Date.now()); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (n - 1 - i));
    const e = new Date(d.getTime()); e.setDate(e.getDate() + 1);
    return [d.getTime(), e.getTime()];
  });
}
const isToday = (ts) => { const [a, b] = lastDays(1)[0], t = Date.parse(ts); return t >= a && t < b; };
/** Per-day totals over `days`, null for a day without rows (not measured). */
function perDay(rows, days, total = (xs) => Math.round(sumV(xs))) {
  const buckets = days.map(() => []);
  for (const r of rows) {
    const t = Date.parse(r.ts), i = days.findIndex(([a, b]) => t >= a && t < b);
    if (i >= 0) buckets[i].push(r);
  }
  return buckets.map((xs) => (xs.length ? total(xs) : null));
}

export const LIMB_NAME = { LF: "left fore", RF: "right fore", LH: "left hind", RH: "right hind" };
const SENSOR_ORDER = ["leg", "head", "pelvis"];
const FAULT_TEXT = { empty: "empty hopper", jam: "jam", motor_stall: "motor stalled", under_run: "less feed dispensed than set",
  over_run: "more feed dispensed than set", sensor: "sensor fault" };
const MEAL_TEXT = { morning: "morning feed", midday: "midday feed", evening: "evening feed" };

/** A reading from the wearable set (leg tag, halter hub, pelvis sensor). */
const fromWearable = (r) => METRICS[r.metric]?.source === "imu" || r.meta?.sensor != null;
/** A reading from the wearable or the stall's water / feed sensors rather than
 *  the camera. Kept out of "camera data" coverage: a hub reporting every minute
 *  must not make a camera that has gone blind look live. */
// Not from the camera: the metric is a wearable / stall-sensor one, or this
// reading came from one (a wearable's activity_index carries source "imu").
const OFF_CAMERA = new Set(["imu", "flow_meter", "feeder"]);
export const offCamera = (r) => OFF_CAMERA.has(METRICS[r.metric]?.source) || OFF_CAMERA.has(r.source) || r.meta?.sensor != null;

/** Meals from the weigh-back feeder, oldest first — { at, meal, offeredG,
 *  eatenG, refusedG }, each null when that weight was not reported. Grouped by
 *  meta.mealId; a reading without one (an older feeder) pairs with the others
 *  stamped at the same second. at = when the meal was served. */
export function mealsOf(rd) {
  const KEY = { feed_offered_g: "offeredG", feed_intake_g: "eatenG", feed_refusal_g: "refusedG" };
  const by = new Map();
  for (const r of rd.filter((x) => KEY[x.metric]).sort((a, b) => a.ts.localeCompare(b.ts))) {
    const id = r.meta?.mealId ?? `at:${r.ts}`;
    const m = by.get(id) ?? { at: r.ts, meal: null, offeredG: null, eatenG: null, refusedG: null };
    m[KEY[r.metric]] = r.value;                      // newest wins (a re-sent weigh-back)
    if (r.metric === "feed_offered_g") m.at = r.ts;
    m.meal = r.meta?.meal ?? m.meal;
    by.set(id, m);
  }
  return [...by.values()].sort((a, b) => a.at.localeCompare(b.at));
}

/** Grams left of a meal (the weigh-back, or offered − eaten), or null. */
export const leftOf = (m) => m.refusedG ?? (m.offeredG !== null && m.eatenG !== null ? Math.max(0, m.offeredG - m.eatenG) : null);
/** Share of a meal left (0..1); null unless the meal was weighed both ways. */
const leftShare = (m) => (m.offeredG > 0 && leftOf(m) !== null ? Math.min(1, leftOf(m) / m.offeredG) : null);

/** Steps over some rows. Counts derived from an uploaded raw session
 *  (meta.rawSessionIds) cover strides the leg tag already counted live, so they
 *  stand in only where there are no live counts — never added to them. null =
 *  no count at all (not measured), distinct from a counted 0. */
export function stepsTotal(rows) {
  const live = rows.filter((r) => !r.meta?.rawSessionIds);
  const use = live.length ? live : rows;
  return use.length ? Math.round(sumV(use)) : null;
}

/** A trot result against this horse's own normal: the median of its earlier
 *  results in the 14 days before it (3+ of them). flagged = our watch rule:
 *  +LAME_RISE_MM on the normal, or LAME_ABS_MM with no normal yet. */
export function lamenessVsNormal(rd, cur) {
  const t = Date.parse(cur.ts);
  const prev = rd.filter((r) => r.metric === "lameness_result" && r !== cur && Date.parse(r.ts) < t
    && t - Date.parse(r.ts) <= LAME_HISTORY_DAYS * DAY_MS).map((r) => r.value);
  const baselineMm = prev.length >= LAME_HISTORY_MIN ? medianOf(prev) : null;
  return { baselineMm, earlier: prev.length,
    flagged: baselineMm === null ? cur.value >= LAME_ABS_MM : cur.value - baselineMm >= LAME_RISE_MM };
}

/** Evaluate all rule checks for one horse -> list of {type, severity, detail, ts}. */
function evaluate(bio, rd) {
  const out = [];
  // since: when the condition began, for the alert's time ("since yesterday
  // 17:57"); null = never (no data ever received). The key still uses ts.
  const push = (type, severity, detail, ts, since) =>
    out.push({ type, severity, detail, ts: ts || new Date().toISOString(), ...(since !== undefined ? { since } : {}) });

  // ---- monitoring gap (checked FIRST; stale data must never read as calm) -- //
  const seen = lastSeenMs(rd);
  if (seen === null) {
    push("No monitoring data", "warn",
      `No sensor data has ever been received for ${bio.name} — check the stall's devices and the edge agent.`, undefined, null);
    return out; // nothing else is meaningful without data
  }
  const gap = Date.now() - seen;
  if (gap >= STALE_ALERT_MS) {
    push("Monitoring offline", "alert",
      `No sensor data for ${gapText(gap)} — this horse is NOT being monitored. Check camera/edge box/network.`,
      undefined, new Date(seen).toISOString());
    return out; // suppress downstream rules: they'd be judging stale data
  }
  if (gap >= STALE_WARN_MS) {
    push("Monitoring gap", "warn",
      `No sensor data for ${gapText(gap)} — readings below may be out of date.`, undefined, new Date(seen).toISOString());
    // fall through: recent-ish data is still worth evaluating
  }

  // ---- is it this horse? (edge/identity.py) -------------------------------- //
  // Three looks in a row within the hour, all clearly another enrolled horse:
  // the readings under this name may belong to that horse (stalls swapped).
  const ids = rd.filter((r) => r.metric === "horse_identity").sort((a, b) => a.ts.localeCompare(b.ts)).slice(-3);
  if (ids.length === 3 && ids.every((r) => r.meta?.verdict === "other" && r.meta?.best === ids[0].meta?.best)
      && Date.now() - Date.parse(ids[0].ts) <= 3600000) {
    const other = ids[2].meta?.bestName || ids[2].meta?.best;
    push("Different horse in the stall?", "warn",
      `The camera's last ${ids.length} looks at the horse in ${bio.name}'s stall match ${other}, not ${bio.name}. Check which horse is in the stall and update the Horses page — until then these readings may be ${other}'s.`,
      ids[2].ts, ids[0].ts);
  }

  const temp = latest(rd, "body_temp_c");
  const resp = latest(rd, "respiratory_rate_bpm");
  if (uncalibrated(temp) || uncalibrated(resp)) {
    const cur = [temp && `${temp.value.toFixed(1)} °C`, resp && `${Math.round(resp.value)} bpm`].filter(Boolean).join(", ");
    // The part before " — " becomes the horse card's status line, so it must
    // stand on its own.
    push("Camera not aimed", "warn",
      `Camera on stall ${bio.stall || "?"} not aimed — its readings (${cur}) may be of coat or stall wall rather ` +
      `than the eye and nostril, so they are shown but not used for alerts. Aim it from the Hardware page.`,
      (temp || resp).ts);
  }
  if (temp && !uncalibrated(temp)) {
    if (temp.source === "thermal_camera") {
      const base = eyeBaseline(rd, temp);
      const d = base === null ? null : temp.value - base;
      const vs = base === null ? "" : ` (${d >= 0 ? "+" : ""}${d.toFixed(1)} C vs this horse's usual ${base.toFixed(1)} C)`;
      const confirm = " Eye surface, screening-grade; confirm with a rectal thermometer.";
      if (temp.value >= TEMP_FEVER || (d !== null && d >= EYE_RISE_ALERT)) {
        // Say which line was crossed: a horse whose usual reading is itself
        // high must not read "+0.0 C … well above normal".
        const why = d !== null && d >= EYE_RISE_ALERT ? "well above normal"
          : `above the ${TEMP_FEVER} C fever line${base !== null && base >= TEMP_FEVER - 0.3 ? ", and this horse's usual reading is high too" : ""}`;
        push("Elevated body temperature", "alert", `Eye temperature ${temp.value.toFixed(1)} C${vs} — ${why}.${confirm}`, temp.ts);
      }
      else if (d !== null && d >= EYE_RISE_WARN) push("Body temperature rising", "warn",
        `Eye temperature ${temp.value.toFixed(1)} C${vs} — watching the trend.${confirm}`, temp.ts);
      else if (d !== null && d <= -EYE_DROP_WARN) push("Eye temperature below usual", "warn",
        `Eye temperature ${temp.value.toFixed(1)} C${vs} — a cold stall, wet coat or a camera that has moved can do this; ` +
        `check the horse and the camera aim.`, temp.ts);
    } else {
      if (temp.value >= TEMP_FEVER) push("Elevated body temperature", "alert",
        `Body temperature ${temp.value.toFixed(1)} C — above fever threshold (${TEMP_FEVER} C).`, temp.ts);
      else if (temp.value <= TEMP_LOW) push("Low body temperature", "alert",
        `Body temperature ${temp.value.toFixed(1)} C — below ${TEMP_LOW} C.`, temp.ts);
      else if (temp.value >= TEMP_WATCH_HI) push("Body temperature rising", "warn",
        `Body temperature ${temp.value.toFixed(1)} C — upper end of normal; watching trend.`, temp.ts);
    }
  }

  if (resp && !uncalibrated(resp)) {
    if (resp.value >= RESP_ALERT) push("High respiratory rate", "alert",
      `Resting respiratory rate ${Math.round(resp.value)} bpm (nostril thermal) — well above normal.`, resp.ts);
    else if (resp.value >= RESP_WATCH) push("Respiratory pattern", "warn",
      `Resting respiratory rate ${Math.round(resp.value)} bpm — slightly elevated.`, resp.ts);
  }

  const now = new Date().toISOString();
  const restToday = sumToday(rd, "rest_minutes");
  const WIN = 4 * 3600 * 1000;
  // Validated activity only (an IMU): the camera's motion heuristic is a
  // prototype and must not raise a colic alarm.
  const recentActs = rd.filter((r) => r.metric === "activity_index" && within(r, WIN) && !prototype(r)).map((r) => r.value);
  const restRows = rd.filter((r) => r.metric === "rest_minutes" && within(r, WIN));
  const recentRest = restRows.reduce((a, r) => a + r.value, 0);
  const actAvg = recentActs.length ? recentActs.reduce((a, b) => a + b, 0) / recentActs.length : 0;
  // "Little lying" can only be judged where lying is measured: with no
  // rest_minutes at all, 0 minutes means "not measured", not "never lay down".
  if (actAvg > 0.55 && restRows.length > 0 && recentRest < 60) push("Abnormal activity — colic pattern", "alert",
    "Restlessness well above baseline with little lying in the last few hours — possible colic.", now);
  else if (countToday(rd, "rest_minutes") > 0 && restToday < REST_MIN_LOW) push("Low lying-down time", "warn",
    `Only ${fmtHM(restToday)} lying in the last 24h — below the ~3h comfort floor.` +
    (rd.filter((r) => r.metric === "rest_minutes" && within(r, DAY_MS)).every(prototype)
      ? " Prototype wearable measure, not yet validated — worth a look." : ""), now);

  const gait = latest(rd, "gait_asymmetry");
  if (gait && gait.value >= GAIT_WATCH) push("Possible lameness", "warn",
    `Gait asymmetry ${(gait.value * 100).toFixed(0)}% — limb-favouring pattern; review.`, gait.ts);

  const waterToday = sumToday(rd, "water_ml");
  const waterBase = baselineDailyAvg(rd, "water_ml", 7);
  if (waterBase && waterToday < waterBase * WATER_LOW_FRAC && countToday(rd, "water_ml") > 0)
    push("Low water intake", "warn",
      `Water intake ~${Math.round((1 - waterToday / waterBase) * 100)}% below this horse's learned baseline over 24h.`, new Date().toISOString());

  const vice = rd.filter((r) => r.metric === "vice_event" && within(r, DAY_MS)).slice(-1)[0];
  if (vice) push("Stable vice", "ok",
    `${(vice.meta?.kind || "vice").replace("_", "-")} episodes detected${prototype(vice) ? " (prototype detector)" : ""} — enrichment / routine review suggested.`, vice.ts);

  // ---- camera behaviour: watch notes, never alarms ---------------------- //
  const b = behaviourForHorse(rd);
  if (b.activity?.unusual) push("Activity unusual for this horse", "warn",
    `Activity over the last 4 h is ${b.activity.unusual === "high" ? "well above" : "well below"} this horse's own ` +
    `7-day level (${b.activity.avg4h.toFixed(2)} vs ${b.activity.baseline.toFixed(2)}) — prototype ${b.stream === "imu" ? "wearable" : "camera"} measure; worth a look. ` +
    (b.activity.unusual === "high"
      ? "Why: restlessness is a colic sign when seen with rolling, flank watching or kicking at the belly; alone it is often feed anticipation."
      : "Why: a dull horse, head low at the back of the box, can be in pain — or simply dozing."), now);
  // Absence of an event only means something where the detector is known to
  // see this stall: it must have reported events here in the last 3 days.
  for (const [metric, hours, what] of [["urination_event", NO_URINE_H, "urination"], ["excretion_event", NO_MANURE_H, "manure"]]) {
    const ev = rd.filter((r) => r.metric === metric);
    const last = ev.length ? Math.max(...ev.map((r) => Date.parse(r.ts))) : null;
    const seesStall = ev.some((r) => within(r, 3 * DAY_MS));
    if (seesStall && last !== null && Date.now() - last >= hours * 3600 * 1000)
      push(what === "manure" ? "No manure seen" : "No urination seen", "warn",
        `No ${what} seen for ${gapText(Date.now() - last)} (watch threshold ${hours} h) — prototype floor detector; ` +
        `check the horse and the stall. ` + (what === "manure"
          ? "Why: horses pass manure 4–13 times a day; fewer droppings is a colic sign."
          : "Why: stretching as if to urinate without a stream is a colic sign; straining or dribbling points to the bladder."), now);
  }

  // Less manure than this horse usually passes (baseline-relative: no
  // published "X hours" threshold exists; fasting alone cuts output 55–63 %).
  const ex = b.excretion;
  if (ex?.baselinePerDay && ex.baselinePerDay >= 3 && ex.count24h < ex.baselinePerDay * MANURE_LOW_FRAC)
    push("Less manure than usual", "warn",
      `${ex.count24h} manure events seen in 24 h vs this horse's usual ~${ex.baselinePerDay}/day — prototype floor detector; ` +
      "check the stall and when the horse last ate. Why: fewer droppings is an early colic sign, but not eating also lowers output.", now);

  // Posture (prototype camera): watch notes, never alarms.
  const rs = b.resting;
  if (rs) {
    const downs = rs.downTimes.map((t) => Date.parse(t)).filter((t) => Date.now() - t <= 2 * 3600 * 1000);
    const cluster = downs.some((t) => downs.filter((u) => u >= t && u - t <= DOWN_UP_WINDOW_MIN * 60000).length >= DOWN_UP_COUNT);
    if (cluster) push("Lying down and getting up repeatedly", "warn",
      `${downs.length} lie-downs in the last 2 h — prototype camera posture; look at the horse. ` +
      "Why: going down and up again and again is a strong colic sign (normal lying bouts last 15–40 min). Our rule: 3+ within an hour.", now);
    if (rs.lastCast && Date.now() - Date.parse(rs.lastCast) <= 3600 * 1000) push("Possibly cast — check the horse now", "warn",
      "Lying 10+ minutes with repeated bursts of struggling and no getting up — prototype camera rule. " +
      "Why: a horse stuck against the wall cannot rise and can injure itself.", rs.lastCast);
    if (rs.lastRoll && Date.now() - Date.parse(rs.lastRoll) <= 3600 * 1000 && rs.rolls24h >= 2) push("Possible rolling", "warn",
      `${rs.rolls24h} possible rolls in 24 h — prototype camera rule. Why: rolling (other than a single dust-bath) is the ` +
      "highest score on the equine abdominal pain scale.", rs.lastRoll);
    if (rs.lateralLast90Min >= LATERAL_LONG_MIN) push("Lying flat on the side a long time", "warn",
      `About ${rs.lateralLast90Min} min possibly flat on the side in the last 90 min — prototype camera posture. ` +
      "Why: normal single lying bouts stay under ~1 h; flat out while awake is a pain sign. Our rule: 60 min.", now);
    if (rs.lowNights >= LOW_LYING_NIGHTS) push("Little lying down at night", "warn",
      `Under ${LOW_LYING_NIGHT_MIN} min lying on ${rs.lowNights} recent nights — prototype camera posture. ` +
      "Why: horses need 30+ min lying a day for REM sleep; persistent lack shows as buckling while dozing. " +
      "Normal for the first 1–4 nights in a new stall.", now);
  }
  // Vices: a new one is worth a look; a rise is information.
  for (const [k, label] of [["weaving", "Weaving"], ["boxWalking", "Box walking"], ["headTossing", "Head tossing"]]) {
    const v = b[k];
    if (!v) continue;
    if (v.isNew) push(`New stable vice: ${label.toLowerCase()}`, "warn",
      `${label} seen (${v.minutes24h} min in 24 h) with none in the previous week — prototype camera detector. ` +
      (k === "headTossing" ? "Why: head shaking has medical causes (ears, eyes, airway, pain) — worth a vet's look." :
        "Why: a new stereotypy follows stress, isolation or a diet change; stable staff miss most of them."), v.last);
    else if (v.baselineMinPerDay && v.minutes24h >= 10 && v.minutes24h >= v.baselineMinPerDay * VICE_RISE)
      push(`${label} increased`, "ok",
        `${v.minutes24h} min in 24 h vs usual ~${v.baselineMinPerDay} min/day — prototype camera detector. ` +
        "Why: more stereotypy time suggests more stress or a routine/feeding change; it peaks around feeds.", v.last);
  }

  // ---- stall sensors: feed, water, hay (watch notes; thresholds are ours) -- //
  // Left feed: the latest meal today that was weighed both ways, against the
  // share this horse usually leaves (median of its meals in the 7 days before).
  const meals = mealsOf(rd).filter((m) => leftShare(m) !== null);
  const meal = meals.filter((m) => isToday(m.at)).at(-1);
  if (meal) {
    const share = leftShare(meal);
    const usual = medianOf(meals.filter((m) => m.at < meal.at && Date.parse(meal.at) - Date.parse(m.at) <= 7 * DAY_MS).map(leftShare));
    if (share >= LEFT_FEED_FRAC && (usual === null || share >= usual + LEFT_FEED_OVER_USUAL)) push("Left feed", "warn",
      `Refused ${Math.round(share * 100)}% of the ${MEAL_TEXT[meal.meal] || "feed"} at ${localHm(Date.parse(meal.at))} ` +
      `(${fmtG(leftOf(meal))} of ${fmtG(meal.offeredG)}) — ` +
      (usual === null ? "no earlier meals to compare with yet. " : `this horse usually leaves ~${Math.round(usual * 100)}%. `) +
      "Our watch rule: 30 %+ left and 15 points over its usual. Why: going off feed is often an early sign of pain or " +
      "illness (colic, fever, teeth); a change of feed or a hot day can do it too.", meal.at);
  }

  // No drinking: only where the water meter is known to work here (it
  // reported in the last 48 h) — otherwise silence is "not measured".
  const water = rd.filter((r) => r.metric === "water_ml");
  if (water.some((r) => within(r, WATER_SEEN_H * H_MS))) {
    const drank = newestMs(water.filter((r) => r.value > 0));
    const last = drank === -Infinity ? null : drank;
    if (last === null || Date.now() - last >= NO_DRINK_H * H_MS) push("No drinking recorded", "warn",
      `${last === null ? "No drinking recorded since the water meter started reporting" : `No drinking recorded for ${gapText(Date.now() - last)}`} — ` +
      "check the water (tap, bowl or bucket) and the horse; a blocked or disconnected meter reads the same. Our watch rule: 10 h. " +
      "Why: horses drink several times a day; going without raises the risk of impaction colic.",
      now, last === null ? undefined : new Date(last).toISOString());
  }

  // Low hay: eaten so far today against this horse's 7-day daily average,
  // pro rata for the hours gone. Not judged early in the day (a few hourly
  // totals say little), without 3 earlier days, or when the scale is silent.
  const hay = rd.filter((r) => r.metric === "hay_intake_g");
  if (hay.length) {
    const days = lastDays(8), totals = perDay(hay, days, sumV);
    const daily = totals.slice(0, -1).filter((v) => v !== null);
    const avg = daily.length >= HAY_BASELINE_DAYS ? daily.reduce((a, b) => a + b, 0) / daily.length : null;
    const dayH = (Date.now() - days.at(-1)[0]) / H_MS;
    if (avg > 0 && dayH >= HAY_MIN_DAY_H && hay.some((r) => within(r, 2 * H_MS))) {
      const sofar = totals.at(-1) ?? 0, expected = (avg * dayH) / 24;
      if (sofar < expected * HAY_LOW_FRAC) push("Low hay intake", "warn",
        `${fmtG(sofar)} of hay eaten so far today vs ~${fmtG(expected)} expected by now from this horse's 7-day average ` +
        `of ${fmtG(avg)} a day — check the hay net or rack is full and within reach, then the horse. Our watch rule: under ` +
        "60 % of its usual, pro rata. Why: eating less forage is an early sign of pain, dental trouble or colic.", now);
    }
  }

  const faults = rd.filter((r) => r.metric === "feeder_fault" && within(r, FEEDER_FAULT_H * H_MS)).sort((a, b) => a.ts.localeCompare(b.ts));
  if (faults.length) {
    const kinds = {};
    for (const r of faults) (kinds[r.meta?.kind || "unknown"] ||= []).push(r.ts);
    push("Feeder fault", "warn",
      `Feeder reported ${Object.entries(kinds).map(([k, ts]) => `${FAULT_TEXT[k] || k.replace(/_/g, " ")} ` +
        (ts.length > 1 ? `(${ts.length} times, last at ${localHm(Date.parse(ts.at(-1)))})` : `at ${localHm(Date.parse(ts[0]))}`)).join("; ")} — ` +
      "check the feeder; a meal may not have been served as set.", faults.at(-1).ts);
  }

  // ---- the wearable: charge it, refit it, it went quiet ------------------- //
  const statusRows = rd.filter((r) => r.metric === "device_status");
  const newestStatus = new Map();                   // one per physical sensor (two pelvis sensors are two)
  const hourAgo = new Date(Date.now() - BATTERY_WINDOW_H * H_MS).toISOString();
  for (const r of statusRows) {
    if (r.ts < hourAgo) continue;                   // ISO strings compare in time order (cheap on 100k rows)
    const k = `${r.meta?.sensor ?? ""}|${r.meta?.hardwareId ?? ""}`;
    if (!newestStatus.has(k) || r.ts >= newestStatus.get(k).ts) newestStatus.set(k, r);
  }
  const low = {};
  for (const r of newestStatus.values())
    if (Number.isFinite(r.value) && r.value < BATTERY_LOW_PCT) (low[r.meta?.sensor || "wearable"] ||= []).push(r);
  for (const [sensor, rows] of Object.entries(low)) push(`Charge the ${sensor} sensor`, "ok",
    `Battery ${rows.map((r) => `${Math.round(r.value)}%${r.meta?.hardwareId ? ` (${r.meta.hardwareId})` : ""}`).join(", ")} on the ` +
    `${sensor} sensor — charge or swap it before it stops recording. Our reminder line: 20 %.`, rows.at(-1).ts);

  // Came off: unless a later status from that sensor says it is back on.
  const off = rd.filter((r) => r.metric === "device_detached" && within(r, DETACHED_H * H_MS)
    && !statusRows.some((s) => s.meta?.sensor === r.meta?.sensor && s.ts > r.ts && s.meta?.attached === true
      && (r.meta?.hardwareId == null || s.meta?.hardwareId === r.meta.hardwareId)))
    .sort((a, b) => a.ts.localeCompare(b.ts));
  if (off.length) {
    const which = [...new Set(off.map((r) => r.meta?.sensor || "wearable"))];
    push("Wearable came off", "warn",
      `The ${which.join(" and ")} sensor${which.length > 1 ? "s" : ""} reported coming off at ${localHm(Date.parse(off.at(-1).ts))} — ` +
      `refit ${which.length > 1 ? "them" : "it"}; nothing from ${which.length > 1 ? "them" : "it"} is recorded until then.`, off.at(-1).ts);
  }

  // Gone quiet: the horse has a wearable, nothing from it for 20 min, while
  // the stall's other sensors still report (a whole-site outage is the
  // monitoring-gap rule's job, above).
  if (statusRows.length) {
    let newest = "";
    for (const r of rd) if (r.ts > newest && fromWearable(r)) newest = r.ts;
    const lastW = Date.parse(newest);
    const others = rd.some((r) => !fromWearable(r) && within(r, WEARABLE_SILENT_MIN * 60000));
    if (others && Date.now() - lastW >= WEARABLE_SILENT_MIN * 60000) push("Wearable not reporting", "warn",
      `Nothing from ${bio.name}'s wearable for ${gapText(Date.now() - lastW)} while the stall's other sensors are reporting — ` +
      "check the halter hub is on the horse and charged, and the mobile signal. Our watch rule: 20 min.",
      now, new Date(lastW).toISOString());
  }

  // ---- trot lameness vs the horse's own normal (prototype wearable) ------- //
  // Beside, not instead of, the legacy gait_asymmetry rule above.
  const trot = latest(rd, "lameness_result");
  if (trot && within(trot, LAME_FRESH_H * H_MS)) {
    const vs = lamenessVsNormal(rd, trot);
    const limb = LIMB_NAME[trot.meta?.limb] || null;
    // The part before " — " is the horse card's status line: it says prototype.
    if (vs.flagged) push(`Possible lameness — ${limb || "limb unclear"}`, "warn",
      `Prototype trot measure: ${trot.value.toFixed(1)} mm asymmetry (${limb || "limb unclear"}), ` +
      (vs.baselineMm === null ? "no earlier trots to compare with"
        : `+${(trot.value - vs.baselineMm).toFixed(1)} mm on its usual ${vs.baselineMm.toFixed(1)} mm`) +
      " — from the wearable, not yet validated on horses; trot the horse up in hand and ask the vet if it looks uneven. " +
      `Our watch line: ${vs.baselineMm === null ? "12 mm while there is no normal yet" : "+6 mm on the median of its earlier trots (14 days)"}. ` +
      `Trot at ${relTime(trot.ts)}. Why: a lame horse moves its head (forelimb) or pelvis (hindlimb) unevenly at the trot; ` +
      "a rise on its own normal matters more than the number.", trot.ts);
  }

  return out;
}

function statusFromChecks(checks) {
  if (checks.some((c) => c.severity === "alert")) return "urgent";
  if (checks.some((c) => c.severity === "warn")) return "watch";
  return "calm";
}

/** Metrics this horse has no sensor for at all.
 *
 *  A metric counts as uninstrumented when the hardware for its source is still
 *  pending AND nothing has ever arrived for this horse. The second half matters:
 *  the simulator emits all 12 points, so simulated horses keep their real
 *  values — only a genuinely un-sensed metric goes null.
 *
 *  Why this exists: on a camera-only install nothing feeds rest, water or time
 *  outside, and reporting those as 0 renders a horse that never lay down and
 *  drank nothing — an animal in crisis, or software that looks broken. Neither
 *  is true, and a vet acting on it would be acting on a number we invented.
 *  Same rule as the monitoring-gap net: absence of measurement must never be
 *  displayed as a measurement.
 */
function uninstrumented(rd) {
  const seen = new Set(rd.map((r) => r.metric));
  const out = new Set();
  for (const [key, m] of Object.entries(METRICS))
    if (m.kind !== "diagnostic" && SOURCE_STATUS[m.source] !== "available" && !seen.has(key)) out.add(key);
  return out;
}

function stressLevel(rd) {
  const act = rd.filter((r) => r.metric === "activity_index" && within(r, DAY_MS) && !prototype(r)).map((r) => r.value);
  const vices = countToday(rd, "vice_event");
  const mean = act.length ? act.reduce((a, b) => a + b, 0) / act.length : 0;
  const score = mean + vices * 0.15;
  return score > 0.55 ? "High" : score > 0.3 ? "Medium" : "Low";
}

function distinctDays(rd) {
  return new Set(rd.map((r) => dayKey(r.ts))).size;
}

// The site server's clock and calendar (it runs at the stable). The time
// used to be UTC ("08:11" at 13:41 in India), and "Today" meant "within 24 h".
const localHm = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const localDay = (ms) => new Date(ms).toLocaleDateString("en-CA");
export function relTime(ts, now = Date.now()) {
  const t = Date.parse(ts), diff = now - t, hm = localHm(t);
  if (diff < 2 * 60 * 1000) return `${hm} · just now`;
  if (diff < 3600 * 1000) return `${hm} · ${Math.round(diff / 60000)} min ago`;
  if (localDay(t) === localDay(now)) return `Today · ${hm}`;
  if (localDay(t) === localDay(now - DAY_MS)) return `Yesterday · ${hm}`;
  const days = Math.round((Date.parse(localDay(now)) - Date.parse(localDay(t))) / DAY_MS);
  return `${days} days ago · ${hm}`;
}

/** Build one Horse summary object (matches src/data/mock.ts `Horse`). */
export function summarizeHorse(bio, allReadings) {
  const rd = allReadings.filter((r) => r.horseId === bio.id);
  const checks = evaluate(bio, rd);
  const status = statusFromChecks(checks);
  const top = checks.find((c) => c.severity === "alert") || checks.find((c) => c.severity === "warn");
  const seen = lastSeenMs(rd);
  const gaps = uninstrumented(rd);

  return {
    ...bio,
    status,
    statusNote: top ? top.detail.split(" — ")[0].slice(0, 80) : "Within learned baseline",
    // null = we do not measure this here, distinct from 0 = measured, none.
    rest: gaps.has("rest_minutes") ? null : fmtHM(sumToday(rd, "rest_minutes")),
    water: gaps.has("water_ml") && gaps.has("water_visit") ? null
      : countToday(rd, "water_visit") || Math.round(sumToday(rd, "water_ml") / 4000) || 0,
    outside: gaps.has("outside_minutes") ? null : fmtHM(sumToday(rd, "outside_minutes")),
    // The stress estimate needs a validated activity source; camera motion
    // (prototype) alone would present a heuristic as a welfare score.
    stress: rd.some((r) => r.metric === "activity_index" && !prototype(r)) || rd.some((r) => r.metric === "vice_event" && !prototype(r))
      ? stressLevel(rd) : null,
    // The two vitals the camera measures directly. These belong on the summary,
    // not only in the per-horse detail: they are what this system can actually
    // tell you today, and a dashboard that headlines rest and water — neither
    // of which has a sensor yet — leads with its weakest claim.
    vitals: {
      bodyTempC: latest(rd, "body_temp_c")?.value ?? null,
      respRateBpm: latest(rd, "respiratory_rate_bpm")?.value ?? null,
      respConfidence: latest(rd, "respiratory_rate_bpm")?.confidence ?? null,
      // false when the latest camera reading came through un-aimed ROIs
      calibrated: !(uncalibrated(latest(rd, "body_temp_c")) || uncalibrated(latest(rd, "respiratory_rate_bpm"))),
    },
    // what the UI should render as "not measured" rather than as a value
    uninstrumented: [...gaps].sort(),
    baselineProgress: Math.min(100, Math.round((distinctDays(rd.filter((r) => !uncalibrated(r))) / BASELINE_TARGET_DAYS) * 100)),
    // data-freshness (extra fields; the SPA's Horse type ignores unknown keys)
    lastSeen: seen === null ? null : new Date(seen).toISOString(),
    monitoring: seen === null ? "no-data"
      : Date.now() - seen >= STALE_ALERT_MS ? "offline"
      : Date.now() - seen >= STALE_WARN_MS ? "stale" : "live",
  };
}

/** What the camera tells us about behaviour and intake/output, for the horse
 *  page. Everything here is from prototype heuristics and says so. null parts
 *  mean "not measured here" (no readings), never zero. */
export function behaviourForHorse(rd) {
  const of = (m) => rd.filter((r) => r.metric === m).sort((a, b) => a.ts.localeCompare(b.ts));
  const day = (rows) => rows.filter((r) => within(r, DAY_MS));
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  const act = of("activity_index");
  let activity = null;
  if (act.length) {
    const avg4h = mean(act.filter((r) => within(r, 4 * 3600 * 1000)).map((r) => r.value));
    const older = act.filter((r) => within(r, 7 * DAY_MS) && !within(r, 4 * 3600 * 1000));
    const baseline = new Set(older.map((r) => dayKey(r.ts))).size >= ACT_BASELINE_DAYS ? mean(older.map((r) => r.value)) : null;
    const unusual = avg4h === null || baseline === null || baseline <= 0.01 ? null
      : avg4h >= baseline * ACT_UNUSUAL_HI ? "high" : avg4h <= baseline * ACT_UNUSUAL_LO ? "low" : null;
    activity = { now: act.at(-1).value, at: act.at(-1).ts, avg4h, baseline, unusual };
  }

  // Rest periods: runs of consecutive windows that were (almost) entirely still.
  const ina = day(of("inactive_minutes"));
  let inactive = null;
  if (ina.length) {
    const bouts = [];
    let cur = null;
    for (const r of ina) {
      const windowMin = r.meta?.windowMin ?? 1;
      const still = r.value >= 0.75 * windowMin;
      const t = Date.parse(r.ts);
      if (still && cur && t - cur.endMs <= (windowMin * 60 + 90) * 1000) { cur.endMs = t; cur.minutes += r.value; }
      else if (still) { cur = { startMs: t - windowMin * 60000, endMs: t, minutes: r.value }; bouts.push(cur); }
      else cur = null;
    }
    const periods = bouts.filter((x) => x.minutes >= 10)
      .map((x) => ({ start: new Date(x.startMs).toISOString(), end: new Date(x.endMs).toISOString(), minutes: Math.round(x.minutes) }));
    inactive = {
      todayMin: Math.round(ina.reduce((a, r) => a + r.value, 0)),
      periods: periods.slice(-12),
      longestMin: periods.length ? Math.max(...periods.map((x) => x.minutes)) : 0,
    };
  }

  const events = (m) => {
    const all = of(m);
    if (!all.length) return null;
    const today = day(all);
    return { count24h: today.length, last: all.at(-1).ts, times: today.map((r) => r.ts).slice(-12) };
  };

  // Camera days: how many distinct days of behaviour data exist (for "new"
  // and "less than usual" judgements, which need a history).
  const camDays = new Set(act.filter((r) => within(r, 8 * DAY_MS)).map((r) => dayKey(r.ts))).size;

  // Floor events with how sure the detector was.
  const floorEvents = (m) => {
    const e = events(m);
    if (!e) return null;
    const all = of(m), last = all.at(-1);
    const older = all.filter((r) => within(r, 8 * DAY_MS) && !within(r, DAY_MS));
    const perDay = camDays >= ACT_BASELINE_DAYS + 1 ? older.length / Math.max(1, camDays - 1) : null;
    return { ...e, lastConfidence: last.confidence ?? null, lastHalfLifeMin: last.meta?.halfLifeMin ?? null,
      tier: last.meta?.tier ?? null, baselinePerDay: perDay === null ? null : Math.round(perDay * 10) / 10 };
  };

  // Vices: minutes per day (each event is one analysis window), grouped into
  // phases, against the horse's own 7-day level.
  const vice = (kind) => {
    const e = of("vice_event").filter((r) => (r.meta?.kind || "weaving") === kind);
    if (!e.length) return null;
    const today = day(e);
    const mins = (rows) => rows.reduce((a, r) => a + (r.meta?.windowMin ?? 1), 0);
    let phases = 0, lastT = null;
    for (const r of today) {
      const t = Date.parse(r.ts);
      if (lastT === null || t - lastT > VICE_PHASE_GAP_MIN * 60000) phases++;
      lastT = t;
    }
    const prev = e.filter((r) => within(r, 8 * DAY_MS) && !within(r, DAY_MS));
    const baseline = camDays >= ACT_BASELINE_DAYS + 1 ? mins(prev) / Math.max(1, camDays - 1) : null;
    return { count24h: today.length, last: e.at(-1).ts, minutes24h: Math.round(mins(today)), phases24h: phases,
      baselineMinPerDay: baseline === null ? null : Math.round(baseline), isNew: today.length > 0 && !prev.length && camDays >= ACT_BASELINE_DAYS + 1 };
  };

  // Resting pattern from the camera's posture (lying minutes + lie-down /
  // get-up events). Stillness above is NOT lying; this is.
  const lyingRows = of("lying_minutes"), pev = of("posture_event");
  let resting = null;
  if (lyingRows.length || pev.length) {
    const today = day(lyingRows);
    const kind = (k) => day(pev).filter((r) => r.meta?.kind === k);
    const downs = kind("lie_down"), ups = kind("get_up");
    const bouts = downs.map((d) => {
      const up = pev.find((r) => r.meta?.kind === "get_up" && r.ts > d.ts);
      const end = up ? Date.parse(up.ts) : Date.now();
      return { start: d.ts, end: up ? up.ts : null, minutes: Math.round((end - Date.parse(d.ts)) / 60000) };
    });
    // Nights (18:00–06:00 local), newest first; only nights the camera saw.
    const nights = {};
    for (const r of lyingRows.filter((x) => within(x, 4 * DAY_MS))) {
      const d = new Date(Date.parse(r.ts) - 6 * 3600 * 1000);          // 06:00 → night rolls over at 06:00
      const h = new Date(r.ts).getHours();
      if (h >= 6 && h < 18) continue;
      const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      (nights[k] ||= { lying: 0, covered: 0 });
      nights[k].lying += r.value;
      nights[k].covered += r.meta?.observedMin ?? r.meta?.windowMin ?? 1;
    }
    const seen = Object.values(nights).filter((x) => x.covered >= NIGHT_COVERAGE_MIN);
    const recentLateral = lyingRows.filter((r) => within(r, 90 * 60000)).reduce((a, r) => a + (r.meta?.lateralMin ?? 0), 0);
    resting = {
      lyingTodayMin: Math.round(today.reduce((a, r) => a + r.value, 0)),
      lateralTodayMin: Math.round(today.reduce((a, r) => a + (r.meta?.lateralMin ?? 0), 0)),
      lateralLast90Min: Math.round(recentLateral),
      nightLyingMin: Math.round(today.filter((r) => { const h = new Date(r.ts).getHours(); return h < 4; }).reduce((a, r) => a + r.value, 0)),
      bouts24h: downs.length, getUps24h: ups.length,
      bouts: bouts.slice(-8),
      longestBoutMin: bouts.length ? Math.max(...bouts.map((b) => b.minutes)) : null,
      nightsSeen: seen.length,
      lowNights: seen.filter((x) => x.lying < LOW_LYING_NIGHT_MIN).length,
      rolls24h: kind("possible_roll").length,
      lastRoll: kind("possible_roll").at(-1)?.ts ?? null,
      lastCast: kind("possible_cast").at(-1)?.ts ?? null,
      downTimes: downs.map((r) => r.ts),
    };
  }

  const resp = of("respiratory_rate_bpm").at(-1);
  const stream = act.at(-1)?.source ?? null;
  return {
    activity, inactive, resting, stream,
    urination: floorEvents("urination_event"),
    excretion: floorEvents("excretion_event"),
    weaving: vice("weaving"),
    boxWalking: vice("box_walking"),
    headTossing: vice("head_tossing"),
    breathing: resp ? { regularity: resp.meta?.regularity ?? resp.confidence ?? null, method: resp.meta?.method ?? null,
      band: resp.meta?.band ?? null, intervalCv: resp.meta?.intervalCv ?? null, at: resp.ts } : null,
  };
}

/** Steps, trot lameness, exercise and the wearable's own state, for the horse
 *  page. null when the horse has no wearable data at all. Everything here is a
 *  prototype wearable measure (the readings carry meta.prototype). null parts
 *  mean "not measured", never zero. steps7d: oldest first, the last is today;
 *  lamenessRecent: newest first. */
export function motionForHorse(rd) {
  const of = (m) => rd.filter((r) => r.metric === m).sort((a, b) => a.ts.localeCompare(b.ts));
  const steps = of("steps"), trots = of("lameness_result"), status = of("device_status");
  const sessions = of("exercise_session"), fixes = of("gps_fix"), detached = of("device_detached");
  if (!steps.length && !trots.length && !status.length && !sessions.length && !fixes.length && !detached.length) return null;
  const nowMs = Date.now(), LIVE_MS = 5 * 60000;

  const steps7d = perDay(steps, lastDays(7), stepsTotal);

  let lameness = null;
  const trot = trots.at(-1);
  if (trot) {
    const m = trot.meta || {}, vs = lamenessVsNormal(rd, trot);
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
    lameness = { at: trot.ts, limb: LIMB_NAME[m.limb] ? m.limb : null, valueMm: num(trot.value),
      headMinDiffMm: num(m.head?.minDiffMm), headMaxDiffMm: num(m.head?.maxDiffMm),
      pelvisMinDiffMm: num(m.pelvis?.minDiffMm), pelvisMaxDiffMm: num(m.pelvis?.maxDiffMm),
      strides: num(m.strides), baselineMm: num(vs.baselineMm), flagged: vs.flagged };
  }
  const lamenessRecent = trots.slice(-10).reverse().map((r) => ({ at: r.ts, valueMm: Math.round(r.value * 10) / 10, limb: r.meta?.limb ?? null }));

  // Exercise: the newest session. It is live while it is open (no end yet)
  // and the leg tag's live steps or a GPS fix arrived in the last 5 min.
  let exercise = null;
  const ses = sessions.at(-1);
  if (ses) {
    const m = ses.meta || {};
    const startMs = Number.isFinite(Date.parse(m.start)) ? Date.parse(m.start) : Date.parse(ses.ts);
    const open = m.end == null || Date.parse(m.end) > nowMs;
    const liveSteps = steps.filter((r) => r.meta?.sensor && !r.meta?.rawSessionIds);
    const fix = fixes.at(-1);
    const live = open && nowMs - newestMs([...liveSteps, ...fixes]) < LIVE_MS;
    const since = liveSteps.filter((r) => Date.parse(r.ts) >= startMs);
    exercise = {
      at: new Date(startMs).toISOString(),
      minutes: Math.round(live ? Math.max(ses.value, (nowMs - startMs) / 60000) : ses.value),
      steps: live && since.length ? Math.round(sumV(since)) : m.steps ?? null,
      distanceM: m.distanceM ?? null,
      live,
      speedMps: live && fix && nowMs - Date.parse(fix.ts) < LIVE_MS ? Math.round(fix.value * 100) / 100 : null,
    };
  }

  // The wearable itself: the newest status of each physical sensor; a later
  // "came off" overrides what the status said about being attached.
  let wearable = null;
  if (status.length) {
    const bySensor = new Map();
    for (const r of status) {
      if (!SENSOR_ORDER.includes(r.meta?.sensor)) continue;
      const k = `${r.meta.sensor}|${r.meta.hardwareId ?? ""}`;
      if (!bySensor.has(k) || r.ts >= bySensor.get(k).ts) bySensor.set(k, r);
    }
    const sensors = [...bySensor.values()]
      .sort((a, b) => SENSOR_ORDER.indexOf(a.meta.sensor) - SENSOR_ORDER.indexOf(b.meta.sensor))
      .map((r) => {
        const cameOff = detached.some((d) => d.meta?.sensor === r.meta.sensor && d.ts > r.ts
          && (d.meta?.hardwareId == null || d.meta.hardwareId === r.meta.hardwareId));
        return { sensor: r.meta.sensor, batteryPct: Number.isFinite(r.value) ? Math.round(r.value) : null,
          signalDbm: r.meta.signalDbm ?? null, attached: cameOff ? false : r.meta.attached ?? null, lastSeen: r.ts };
      });
    wearable = { lastSeen: new Date(newestMs(rd.filter(fromWearable))).toISOString(), sensors };
  }

  return { stepsToday: steps7d.at(-1), steps7d, lameness, lamenessRecent, exercise, wearable };
}

const INTAKE_METRICS = new Set(["water_ml", "water_visit", "water_refill", "feed_offered_g", "feed_intake_g",
  "feed_refusal_g", "hay_intake_g", "feeder_fault"]);

/** Water, meals, hay and feeder faults, for the horse page. null when no stall
 *  sensor has reported for this horse. Series are oldest first, the last is
 *  today; faults newest first (7 days). null = not measured, never zero:
 *  today's water is 0 only where the meter is known to work (it reported in
 *  the last 48 h) — drinking comes as bouts, so no bout today IS a measurement
 *  there. drinksToday likewise, and null where the meter reports no bouts. */
export function intakeForHorse(rd) {
  if (!rd.some((r) => INTAKE_METRICS.has(r.metric))) return null;
  const of = (m) => rd.filter((r) => r.metric === m).sort((a, b) => a.ts.localeCompare(b.ts));
  const water = of("water_ml"), visits = of("water_visit"), refills = of("water_refill");
  const hay = of("hay_intake_g");
  const days = lastDays(7);

  const meterKnown = [...water, ...visits, ...refills].some((r) => within(r, WATER_SEEN_H * H_MS));
  const water7dMl = perDay(water, days);
  if (water7dMl[6] === null && meterKnown) water7dMl[6] = 0;
  const visitsToday = visits.filter((r) => isToday(r.ts)).length;
  const lastDrink = newestMs([...visits, ...water.filter((r) => r.value > 0)]);

  const hay7dG = perDay(hay, days);
  const g = (v) => (v === null ? null : Math.round(v));
  return {
    waterTodayMl: water7dMl[6], water7dMl,
    // A meter that reports only volumes (no bouts) cannot count drinks.
    drinksToday: visits.length && meterKnown ? visitsToday : null,
    lastDrinkAt: lastDrink === -Infinity ? null : new Date(lastDrink).toISOString(),
    mealsToday: mealsOf(rd).filter((m) => isToday(m.at))
      .map((m) => ({ at: m.at, meal: m.meal, offeredG: g(m.offeredG), eatenG: g(m.eatenG), refusedG: g(m.refusedG) })),
    hayTodayG: hay7dG[6], hay7dG,
    faults: of("feeder_fault").filter((r) => within(r, 7 * DAY_MS)).reverse().slice(0, 10)
      .map((r) => ({ at: r.ts, kind: r.meta?.kind ?? "unknown" })),
  };
}

/** Latest value per metric for a horse — for the HorseDetail live vitals panel. */
export function vitalsForHorse(rd) {
  const out = {};
  for (const r of rd) {
    // >= for the same last-write-wins reason as latest()
    if (!out[r.metric] || r.ts >= out[r.metric].ts)
      out[r.metric] = { value: r.value, unit: r.unit, ts: r.ts, source: r.source, confidence: r.confidence,
                        calibrated: !uncalibrated(r),
                        ...(r.metric === "breathing_check" || r.metric === "eye_check" ? { detail: r.meta?.detail ?? null } : {}),
                        // Where in the thermal view (0–10000) the eye / the breathing was found, for the Live view.
                        ...(r.meta?.where ? { where: r.meta.where } : {}), ...(r.meta?.box ? { box: r.meta.box } : {}),
                        ...(r.meta?.method ? { method: r.meta.method } : {}),
                        ...(r.metric === "horse_identity" ? { identity: { verdict: r.meta?.verdict ?? null, samples: r.meta?.samples ?? 0,
                          best: r.meta?.bestName ?? r.meta?.best ?? null, bestScore: r.meta?.bestScore ?? null } } : {}) };
  }
  return out;
}

/** All active (unacked) alerts across the roster (matches `Alert`). */
export function buildAlerts(roster, allReadings, isAcked) {
  const alerts = [];
  for (const bio of roster) {
    const rd = allReadings.filter((r) => r.horseId === bio.id);
    for (const c of evaluate(bio, rd)) {
      const key = `${bio.id}:${c.type}:${dayKey(c.ts)}`;
      alerts.push({
        id: key,
        horse: bio.name,
        type: c.type,
        severity: c.severity,
        time: c.since === null ? "no data yet" : c.since ? `since ${relTime(c.since)}` : relTime(c.ts),
        detail: c.detail,
        acknowledged: isAcked(key),
        _ts: c.ts,
      });
    }
  }
  const rank = { alert: 0, warn: 1, ok: 2 };
  alerts.sort((a, b) => (rank[a.severity] - rank[b.severity]) || (b._ts.localeCompare(a._ts)));
  return alerts.map(({ _ts, ...a }) => a);
}

const avgOrNull = (rows) =>
  rows.length ? +(rows.reduce((a, r) => a + r.value, 0) / rows.length).toFixed(2) : null;

/** Global dashboard sparklines (matches `series` in mock.ts). `span` days. */
export function buildSeries(roster, allReadings, span = 7) {
  const days = [...Array(span)].map((_, i) => dayKey(Date.now() - (span - 1 - i) * DAY_MS));
  const per = (fn) => days.map((d) => fn(d));
  const onDay = (metric, d) => allReadings.filter((r) => r.metric === metric && dayKey(r.ts) === d && !uncalibrated(r));
  const nHorses = roster.length || 1;
  // Same rule as the horse cards: a line nobody measures is a gap in the
  // chart, not a flat zero — a zero line reads as a real, alarming trend.
  const gaps = uninstrumented(allReadings);
  const orNull = (metric, fn) => (gaps.has(metric) ? days.map(() => null) : per(fn));

  return {
    monitored: per((d) => new Set(allReadings.filter((r) => dayKey(r.ts) === d).map((r) => r.horseId)).size),
    rest:      orNull("rest_minutes", (d) => +(onDay("rest_minutes", d).reduce((a, r) => a + r.value, 0) / 60 / nHorses).toFixed(1)),
    water:     orNull("water_visit", (d) => Math.round(onDay("water_visit", d).length / nHorses)),
    outside:   orNull("outside_minutes", (d) => +(onDay("outside_minutes", d).reduce((a, r) => a + r.value, 0) / 60 / nHorses).toFixed(1)),
    alerts:    per((d) => onDay("vice_event", d).length + onDay("urination_event", d).length), // old placeholder proxy — use flags
    // Behaviour flags a person should check on the recording: vices, and
    // possible rolls / possibly cast. Only meaningful on days with activity.
    flags:     per((d) => onDay("vice_event", d).length +
      onDay("posture_event", d).filter((r) => ["possible_roll", "possible_cast"].includes(r.meta?.kind)).length),
    activity:  per((d) => avgOrNull(onDay("activity_index", d))),
    // Camera-derived vitals as yard-wide daily averages. null on a day with no
    // readings — a gap in the line, not a zero, for the same reason as above.
    bodyTemp:  per((d) => avgOrNull(onDay("body_temp_c", d))),
    respRate:  per((d) => avgOrNull(onDay("respiratory_rate_bpm", d))),
  };
}

/** Per-horse daily series for a metric (for HorseDetail charts). */
export function metricSeries(rd, metric, days = 7, agg = "avg") {
  const keys = [...Array(days)].map((_, i) => dayKey(Date.now() - (days - 1 - i) * DAY_MS));
  return keys.map((d) => {
    const vals = rd.filter((r) => r.metric === metric && dayKey(r.ts) === d && !uncalibrated(r)).map((r) => r.value);
    // null, not 0: a day with no reading is a day we did not measure. Zero here
    // drew a 7-day temperature chart as [0,0,0,0,0,0,37.6] — a plunge to 0 °C
    // that never happened, on the panel a vet is most likely to read.
    if (!vals.length) return null;
    if (agg === "sum") return +vals.reduce((a, b) => a + b, 0).toFixed(1);
    return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
  });
}
