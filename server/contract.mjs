// Canonical metric taxonomy for BSV EquiCare — one row per monitoring point.
// The whole system is data-driven off this: the edge emits readings keyed by
// `metric`, the backend stores them generically, and adding a new sensor is
// just a new metric here (no schema/endpoint changes).
//
// A Reading (the wire + storage shape):
//   { id, horseId, stallId, metric, value:number, unit, ts:ISO,
//     source, confidence:0..1, meta?:object }

export const METRICS = {
  // pt  point label                         key                    unit     source          kind
  steps:                { point: 1,  label: "Steps / locomotion",   unit: "count", source: "imu",           kind: "sample" },
  // The eye's surface, by the thermal camera: about 2 °C below the body and
  // not tracking it one-for-one across horses (CLINICAL_RESEARCH.md, part C).
  // The body temperature is worked out from how far it is from the horse's
  // own normal (server/core-temp.mjs). (The metric keeps its old name: stored
  // readings use it.)
  body_temp_c:          { point: 2,  label: "Eye temperature",      unit: "°C",    source: "thermal_camera", kind: "sample" },
  nostril_temp_c:       { point: 3,  label: "Respiration (raw)",    unit: "°C",    source: "thermal_camera", kind: "sample" },
  respiratory_rate_bpm: { point: 4,  label: "Respiratory rate",     unit: "bpm",   source: "thermal_camera", kind: "sample" },
  activity_index:       { point: 5,  label: "Activity",             unit: "0..1",  source: "thermal_video",  kind: "sample" },
  rest_minutes:         { point: 6,  label: "Rest / lying",         unit: "min",   source: "imu_optical",    kind: "sample" },
  outside_minutes:      { point: 6,  label: "Time outside box",     unit: "min",   source: "optical",        kind: "sample" },
  // Stillness measured from video. NOT lying-down time (rest_minutes, which
  // the "low lying-down time" alert uses) — a horse can stand still, dozing.
  inactive_minutes:     { point: 6,  label: "Inactive (still)",     unit: "min",   source: "thermal_video",  kind: "sample" },
  lying_minutes:        { point: 6,  label: "Lying (camera)",       unit: "min",   source: "visible_video",  kind: "sample" }, // meta.lateralMin: possibly flat on the side
  posture_event:        { point: 6,  label: "Lies down / gets up",  unit: "event", source: "visible_video",  kind: "event" },  // meta.kind: lie_down|get_up|possible_roll|possible_cast
  gait_asymmetry:       { point: 7,  label: "Lameness / gait",      unit: "0..1",  source: "imu_optical",    kind: "sample" },
  vice_event:           { point: 8,  label: "Stable vice",          unit: "event", source: "visible_video", kind: "event" }, // meta.kind: weaving|box_walking|head_tossing (video); crib_biting needs a model / microphone
  // Drinking: one water_visit (value 1) plus one water_ml per bout, both
  // stamped at the bout start with meta { ml, durationS, boutId }.
  water_ml:             { point: 9,  label: "Water intake",         unit: "ml",    source: "flow_meter",     kind: "sample" },
  water_visit:          { point: 9,  label: "Water visit",          unit: "event", source: "flow_meter",     kind: "event" },
  // A bucket refilled by staff — water added, NOT drunk. value = ml added.
  water_refill:         { point: 9,  label: "Water refill",         unit: "ml",    source: "flow_meter",     kind: "event" },
  // Per meal (meta.meal morning|midday|evening|other, meta.mealId): what was
  // put in the bowl, what was eaten, what was left.
  feed_offered_g:       { point: 10, label: "Feed offered",         unit: "g",     source: "feeder",         kind: "sample" },
  feed_intake_g:        { point: 10, label: "Feed intake",          unit: "g",     source: "feeder",         kind: "sample" },
  feed_refusal_g:       { point: 10, label: "Feed refusal",         unit: "g",     source: "feeder",         kind: "sample" },
  hay_intake_g:         { point: 10, label: "Hay eaten",            unit: "g",     source: "feeder",         kind: "sample" },  // meta.periodMin
  feeder_fault:         { point: 10, label: "Feeder fault",         unit: "event", source: "feeder",         kind: "event" },   // meta.kind: FEEDER_FAULTS

  // ---- the wearable set (leg tag + halter hub + pelvis sensor) ----------- //
  // Everything a wearable derives carries meta.prototype = true until it is
  // validated on real horses, and meta.sensor = leg|head|pelvis where it applies.
  // One per analysed straight trot: value = the largest absolute asymmetry
  // (mm); meta { limb LF|RF|LH|RH|null, head/pelvis { minDiffMm, maxDiffMm }|null,
  // strides, durationS, prototype }.
  lameness_result:      { point: 7,  label: "Lameness (trot)",      unit: "mm",    source: "imu",            kind: "event" },
  // A gait check done elsewhere and entered by hand: a phone app (RealHorse,
  // Sleip) or a vet's trot-up. value 0 sound, 1 mild, 2 moderate, 3 severe;
  // meta.tool, meta.limb, meta.asymmetryMm.
  gait_check:           { point: 7,  label: "Gait check (trot-up)", unit: "grade", source: "manual",         kind: "event" },
  // The stall's air, from a temperature/humidity sensor (Modbus or push): the
  // vets' heat index (°F + % humidity) — 130 watch, 150 danger.
  stall_temp_c:         { point: 0,  label: "Stall temperature",    unit: "°C",    source: "sensor",         kind: "sample" },
  stall_humidity_pct:   { point: 0,  label: "Stall humidity",       unit: "%",     source: "sensor",         kind: "sample" },
  // value = minutes; meta { start, end, steps, distanceM|null, trotMin, prototype }.
  exercise_session:     { point: 5,  label: "Exercise session",     unit: "min",   source: "imu",            kind: "event" },
  // value = battery %; meta { sensor, hardwareId, signalDbm|null, attached|null, firmware|null }.
  device_status:        { point: 1,  label: "Wearable status",      unit: "%",     source: "imu",            kind: "diagnostic" },
  device_detached:      { point: 1,  label: "Wearable came off",    unit: "event", source: "imu",            kind: "event" },   // meta.sensor
  // value = speed m/s; meta { lat, lon, accuracyM }. Where the horse is is
  // not a health measure — a diagnostic, like device_status.
  gps_fix:              { point: 5,  label: "Position (exercise)",  unit: "m/s",   source: "imu",            kind: "diagnostic" },
  // Why breathing was or was not measured in each minute's window: value 1 a
  // rate was found, 0 not; meta.nostril / meta.flank say why (BREATHING_WHY).
  // A diagnostic — never a vital sign, never in coverage or alerts.
  breathing_check:      { point: 4,  label: "Breathing check",      unit: "0/1",   source: "thermal_video",  kind: "diagnostic" },
  // The same for the eye temperature: value 1 an eye was read, 0 not;
  // meta.detail says how or why not, meta.where (0–10000) where it was found.
  eye_check:            { point: 2,  label: "Eye check",            unit: "0/1",   source: "thermal_camera", kind: "diagnostic" },
  // The Live view's breathing: the last 35 s, every 10 s (meta.rolling). A
  // diagnostic — the minute's respiratory_rate_bpm stays the record, so
  // reports, trends and alerts count each minute once.
  // Seconds of the minute with people at the stall (the colour picture's
  // detector, once a second): visits and checks, for the report; the horse's
  // activity leaves their movement out.
  people_in_view_s:     { point: 5,  label: "People at the stall",  unit: "s",     source: "visible_video",  kind: "diagnostic" },
  // How the minute was spent, once a second from the colour picture (value:
  // seconds observed): meta lyingS / eatingS (at the hay, moving a little) /
  // restingS / movingS / unseenS, and where he stood (meta.where, cells of
  // meta.grid over the picture). For the report's time budget and stall map.
  time_budget:          { point: 5,  label: "Time budget",          unit: "s",     source: "visible_video",  kind: "diagnostic" },
  respiratory_rate_live_bpm: { point: 4, label: "Breathing (last 35 s)", unit: "bpm", source: "thermal_video", kind: "diagnostic" },
  // Is the horse in the stall the one the roster puts there? (edge/identity.py,
  // every few minutes from the colour picture). value: how alike it is to that
  // horse's gallery (0–1); meta.verdict match / other / unsure / learning,
  // meta.best(Name) the most alike enrolled horse.
  horse_identity:       { point: 5,  label: "Horse recognition",    unit: "score", source: "visible_video",  kind: "diagnostic" },
  // Weight shifts while standing, per window (meta.standingS): a front or
  // hind foot lifted and put down with the body still — the commonest early
  // sign of laminitis (OR 17.7) and of limb pain. From the colour picture.
  weight_shift_count:   { point: 7,  label: "Weight shifts (camera)", unit: "count", source: "visible_video", kind: "sample" },
  urination_event:      { point: 11, label: "Urination",            unit: "event", source: "thermal_video",  kind: "event" },
  excretion_event:      { point: 12, label: "Excretion",            unit: "event", source: "thermal_video",  kind: "event" },
};

// Which of the 12 points can we actually source *today* (camera only) vs. need
// hardware still being procured. Surfaced via /api/coverage so the UI/roadmap
// can show honest "live | simulated | manual" state per point.
// Three states, because "we own the sensor" and "we can produce this number"
// are not the same claim and collapsing them overstates what is ready:
//   available     — sensor in hand AND we can derive the metric today
//   model-pending — sensor in hand, but the CV model that turns pixels into
//                   this metric does not exist yet (needs labelled footage)
//   pending       — the sensor itself is not procured
// Anything other than "available" means no data will arrive, so the rollup
// reports those metrics as "not measured" rather than as zero.
//   prototype     — sensor in hand and the metric is produced today by a
//                   heuristic whose thresholds are not yet validated on real
//                   horses (readings carry meta.method)
export const SOURCE_STATUS = {
  thermal_camera: "available",   // camera in hand — points 2,3,4 measured directly off thermometry
  thermal_video:  "prototype",   // same camera's thermal video: breathing rhythm, urination/excretion (floor), behaviour if chosen
  visible_video:  "prototype",   // same camera's colour video: activity, stillness, vices, lying (with the detector)
  optical:        "model-pending", // same camera's visible stream, but points 6/11/12 need our CV models
  optical_audio:  "pending",     // microphone RFI not yet placed
  imu:            "pending",     // IMU leg tag RFI not yet placed
  imu_optical:    "pending",     // fused IMU+optical
  flow_meter:     "pending",     // water sensor RFI not yet placed
  feeder:         "pending",     // feeder RFI not yet placed
};

export function isKnownMetric(m) {
  return Object.prototype.hasOwnProperty.call(METRICS, m);
}

/** Why a minute had no breathing rate (edge_agent.BREATHING_WHY, same keys). */
export const BREATHING_WHY = {
  measured: "breathing rate found",
  no_thermal_video: "thermal video not running",
  head_out_of_view: "head not in the thermal view",
  head_off_boxes: "head in view but not where the boxes were drawn",
  head_moving: "head moving (no 30 s still stretch)",
  no_rhythm: "no clear breathing rhythm",
  count_disagrees: "rate and breath count disagree",
  too_little_video: "too little thermal video",
  no_colour_video: "colour video not running",
  no_flank_region: "no flank to watch",
};

export const isDiagnostic = (metric) => METRICS[metric]?.kind === "diagnostic";

/** A reading's identity for de-duplication: a device re-sending the same
 *  reading (a retry, the relay after a lost ack) produces the same key. Only
 *  readings from a known device get one (meta.deviceId). */
export function dedupKey(r) {
  const dev = r?.meta?.deviceId;
  if (!dev) return null;
  const t = Date.parse(r.ts);
  const ts = Number.isFinite(t) ? new Date(t).toISOString() : String(r.ts ?? "");
  const m = r.meta;
  // A camera watching several stalls sends each horse's reading of the same
  // second: the stall keeps them apart (only those carry meta.stall, so other
  // devices' keys are as they always were).
  return `${dev}|${r.metric}|${ts}|${m.sensor ?? ""}|${m.kind ?? ""}|${m.seq ?? ""}${m.stall ? `|${m.stall}` : ""}`;
}

/** Where a wearable sensor sits: the leg tag (left front cannon), the halter
 *  hub (head) and the pelvis sensor. Readings carry it as meta.sensor. */
export const WEARABLE_SENSORS = ["leg", "head", "pelvis"];
/** feeder_fault meta.kind values. */
export const FEEDER_FAULTS = ["empty", "jam", "motor_stall", "under_run", "over_run", "sensor"];
/** feed_* meta.meal values (from the time of day at the feeder). */
export const MEALS = ["morning", "midday", "evening", "other"];

export function coverage() {
  return Object.entries(METRICS).filter(([, m]) => m.kind !== "diagnostic").map(([key, m]) => ({
    point: m.point, metric: key, label: m.label, source: m.source,
    status: SOURCE_STATUS[m.source] || "pending",
  })).sort((a, b) => a.point - b.point);
}
