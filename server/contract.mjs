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
  body_temp_c:          { point: 2,  label: "Body temperature",     unit: "°C",    source: "thermal_camera", kind: "sample" },
  nostril_temp_c:       { point: 3,  label: "Respiration (raw)",    unit: "°C",    source: "thermal_camera", kind: "sample" },
  respiratory_rate_bpm: { point: 4,  label: "Respiratory rate",     unit: "bpm",   source: "thermal_camera", kind: "sample" },
  activity_index:       { point: 5,  label: "Activity",             unit: "0..1",  source: "imu_optical",    kind: "sample" },
  rest_minutes:         { point: 6,  label: "Rest / lying",         unit: "min",   source: "imu_optical",    kind: "sample" },
  outside_minutes:      { point: 6,  label: "Time outside box",     unit: "min",   source: "optical",        kind: "sample" },
  gait_asymmetry:       { point: 7,  label: "Lameness / gait",      unit: "0..1",  source: "imu_optical",    kind: "sample" },
  vice_event:           { point: 8,  label: "Stable vice",          unit: "event", source: "optical_audio",  kind: "event" }, // meta.kind: weaving|crib_biting|wind_sucking
  water_ml:             { point: 9,  label: "Water intake",         unit: "ml",    source: "flow_meter",     kind: "sample" },
  water_visit:          { point: 9,  label: "Water visit",          unit: "event", source: "flow_meter",     kind: "event" },
  feed_intake_g:        { point: 10, label: "Feed intake",          unit: "g",     source: "feeder",         kind: "sample" },
  feed_refusal_g:       { point: 10, label: "Feed refusal",         unit: "g",     source: "feeder",         kind: "sample" },
  urination_event:      { point: 11, label: "Urination",            unit: "event", source: "optical",        kind: "event" },
  excretion_event:      { point: 12, label: "Excretion",            unit: "event", source: "optical",        kind: "event" },
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
export const SOURCE_STATUS = {
  thermal_camera: "available",   // camera in hand — points 2,3,4 measured directly off thermometry
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

export function coverage() {
  return Object.entries(METRICS).map(([key, m]) => ({
    point: m.point, metric: key, label: m.label, source: m.source,
    status: SOURCE_STATUS[m.source] || "pending",
  })).sort((a, b) => a.point - b.point);
}
