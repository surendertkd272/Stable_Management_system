// Rollup engine: raw sensor readings  ->  the exact Horse/Alert/series shapes
// the React SPA already renders. This is where the 12 raw streams become the
// health/behaviour summaries and alerts. Clinical thresholds are resting-horse
// screening-grade (the camera is +-2 C), tune with vet input + learned baselines.

import { METRICS, SOURCE_STATUS } from "./contract.mjs";

const DAY_MS = 24 * 3600 * 1000;
const BASELINE_TARGET_DAYS = 14;

// ---- resting-horse reference ranges (screening) --------------------------- //
const TEMP_FEVER = 38.6, TEMP_WATCH_HI = 38.3, TEMP_LOW = 37.0;
const RESP_ALERT = 24, RESP_WATCH = 20;             // bpm, at rest
const GAIT_WATCH = 0.35;                            // asymmetry 0..1
const REST_MIN_LOW = 180;                           // < 3h lying/day
const WATER_LOW_FRAC = 0.55;                        // < 55% of own baseline

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
  if (temp) {
    if (temp.value >= TEMP_FEVER) push("Elevated body temperature", "alert",
      `Eye-region temperature ${temp.value.toFixed(1)} C — above fever threshold (${TEMP_FEVER} C). Screening-grade; confirm with a contact thermometer.`, temp.ts);
    else if (temp.value <= TEMP_LOW) push("Low body temperature", "alert",
      `Eye-region temperature ${temp.value.toFixed(1)} C — below ${TEMP_LOW} C.`, temp.ts);
    else if (temp.value >= TEMP_WATCH_HI) push("Body temperature rising", "warn",
      `Eye-region temperature ${temp.value.toFixed(1)} C — upper end of normal; watching trend.`, temp.ts);
  }

  const resp = latest(rd, "respiratory_rate_bpm");
  if (resp) {
    if (resp.value >= RESP_ALERT) push("High respiratory rate", "alert",
      `Resting respiratory rate ${Math.round(resp.value)} bpm (nostril thermal) — well above normal.`, resp.ts);
    else if (resp.value >= RESP_WATCH) push("Respiratory pattern", "warn",
      `Resting respiratory rate ${Math.round(resp.value)} bpm — slightly elevated.`, resp.ts);
  }

  const now = new Date().toISOString();
  const restToday = sumToday(rd, "rest_minutes");
  const WIN = 4 * 3600 * 1000;
  const recentActs = rd.filter((r) => r.metric === "activity_index" && within(r, WIN)).map((r) => r.value);
  const recentRest = rd.filter((r) => r.metric === "rest_minutes" && within(r, WIN)).reduce((a, r) => a + r.value, 0);
  const actAvg = recentActs.length ? recentActs.reduce((a, b) => a + b, 0) / recentActs.length : 0;
  if (actAvg > 0.55 && recentRest < 60) push("Abnormal activity — colic pattern", "alert",
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
    `${(vice.meta?.kind || "vice").replace("_", "-")} episodes detected — enrichment / routine review suggested.`, vice.ts);

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
    if (SOURCE_STATUS[m.source] !== "available" && !seen.has(key)) out.add(key);
  return out;
}

function stressLevel(rd) {
  const act = rd.filter((r) => r.metric === "activity_index" && within(r, DAY_MS)).map((r) => r.value);
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
    stress: gaps.has("activity_index") && gaps.has("vice_event") ? null : stressLevel(rd),
    // The two vitals the camera measures directly. These belong on the summary,
    // not only in the per-horse detail: they are what this system can actually
    // tell you today, and a dashboard that headlines rest and water — neither
    // of which has a sensor yet — leads with its weakest claim.
    vitals: {
      bodyTempC: latest(rd, "body_temp_c")?.value ?? null,
      respRateBpm: latest(rd, "respiratory_rate_bpm")?.value ?? null,
      respConfidence: latest(rd, "respiratory_rate_bpm")?.confidence ?? null,
    },
    // what the UI should render as "not measured" rather than as a value
    uninstrumented: [...gaps].sort(),
    baselineProgress: Math.min(100, Math.round((distinctDays(rd) / BASELINE_TARGET_DAYS) * 100)),
    // data-freshness (extra fields; the SPA's Horse type ignores unknown keys)
    lastSeen: seen === null ? null : new Date(seen).toISOString(),
    monitoring: seen === null ? "no-data"
      : Date.now() - seen >= STALE_ALERT_MS ? "offline"
      : Date.now() - seen >= STALE_WARN_MS ? "stale" : "live",
  };
}

/** Latest value per metric for a horse — for the HorseDetail live vitals panel. */
export function vitalsForHorse(rd) {
  const out = {};
  for (const r of rd) {
    // >= for the same last-write-wins reason as latest()
    if (!out[r.metric] || r.ts >= out[r.metric].ts)
      out[r.metric] = { value: r.value, unit: r.unit, ts: r.ts, source: r.source, confidence: r.confidence };
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
  const onDay = (metric, d) => allReadings.filter((r) => r.metric === metric && dayKey(r.ts) === d);
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
    const vals = rd.filter((r) => r.metric === metric && dayKey(r.ts) === d).map((r) => r.value);
    if (!vals.length) return 0;
    if (agg === "sum") return +vals.reduce((a, b) => a + b, 0).toFixed(1);
    return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
  });
}
