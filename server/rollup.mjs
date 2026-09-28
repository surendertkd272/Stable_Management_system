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

/** Evaluate all rule checks for one horse -> list of {type, severity, detail, ts}. */
function evaluate(bio, rd) {
  const out = [];
  const push = (type, severity, detail, ts) => out.push({ type, severity, detail, ts: ts || new Date().toISOString() });

  // ---- monitoring gap (checked FIRST; stale data must never read as calm) -- //
  const seen = lastSeenMs(rd);
  if (seen === null) {
    push("No monitoring data", "warn",
      `No sensor data has ever been received for ${bio.name} — check the stall's devices and the edge agent.`);
    return out; // nothing else is meaningful without data
  }
  const gap = Date.now() - seen;
  if (gap >= STALE_ALERT_MS) {
    push("Monitoring offline", "alert",
      `No sensor data for ${gapText(gap)} — this horse is NOT being monitored. Check camera/edge box/network.`);
    return out; // suppress downstream rules: they'd be judging stale data
  }
  if (gap >= STALE_WARN_MS) {
    push("Monitoring gap", "warn",
      `No sensor data for ${gapText(gap)} — readings below may be out of date.`);
    // fall through: recent-ish data is still worth evaluating
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
      if (temp.value >= TEMP_FEVER || (d !== null && d >= EYE_RISE_ALERT)) push("Elevated body temperature", "alert",
        `Eye temperature ${temp.value.toFixed(1)} C${vs} — well above normal.${confirm}`, temp.ts);
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
    `Only ${fmtHM(restToday)} lying in the last 24h — below the ~3h comfort floor.`, now);

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
    `7-day level (${b.activity.avg4h.toFixed(2)} vs ${b.activity.baseline.toFixed(2)}) — prototype camera measure; worth a look. ` +
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

function relTime(ts) {
  const diff = Date.now() - Date.parse(ts);
  const hm = new Date(ts).toISOString().slice(11, 16);
  if (diff < 2 * 60 * 1000) return `${hm} · just now`;
  if (diff < 3600 * 1000) return `${hm} · ${Math.round(diff / 60000)} min ago`;
  if (diff < DAY_MS) return `Today · ${hm}`;
  if (diff < 2 * DAY_MS) return `Yesterday · ${hm}`;
  return `${Math.floor(diff / DAY_MS)} days ago · ${hm}`;
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

/** Latest value per metric for a horse — for the HorseDetail live vitals panel. */
export function vitalsForHorse(rd) {
  const out = {};
  for (const r of rd) {
    // >= for the same last-write-wins reason as latest()
    if (!out[r.metric] || r.ts >= out[r.metric].ts)
      out[r.metric] = { value: r.value, unit: r.unit, ts: r.ts, source: r.source, confidence: r.confidence,
                        calibrated: !uncalibrated(r), ...(r.metric === "breathing_check" ? { detail: r.meta?.detail ?? null } : {}) };
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
        time: relTime(c.ts),
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
    alerts:    per((d) => onDay("vice_event", d).length + onDay("urination_event", d).length), // placeholder proxy
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
