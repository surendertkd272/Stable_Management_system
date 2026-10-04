// Which readings count — one set of rules for every report (the session report,
// the Reports page, the client PDF, the horse's normal), so the same window
// gives the same answer wherever it is read. Each rule is EquiCare's own.
//
//   eye temperature  33–39.5 °C, and no person at the stall that minute:
//                    below is coat or wall; above, no eye in a stall reads it —
//                    people beside the camera, sun or a lamp (1 Oct, RVC:
//                    40.3 and 40.5 °C with people at the camera)
//   floor events     a urination or dropping leaves one patch; patches within
//                    10 minutes of another are the bedding being moved (2 Oct:
//                    four "droppings" in two minutes as he lay down)
export const EYE_MIN_C = 33;
export const EYE_MAX_C = 39.5;
export const FLOOR_ALONE_MS = 10 * 60000;
const PEOPLE_MIN_S = 5;

const minuteKey = (ts) => String(ts).slice(0, 16);

/** The minutes (UTC "YYYY-MM-DDTHH:MM") with a person at the stall. */
export const peopleMinutes = (readings) =>
  new Set(readings.filter((r) => r.metric === "people_in_view_s" && r.value >= PEOPLE_MIN_S).map((r) => minuteKey(r.ts)));

/** Why an eye reading does not count, or null when it does. */
export function eyeSetAside(r, people) {
  if (r.value < EYE_MIN_C) return "too cool for an eye";
  if (r.value > EYE_MAX_C) return "too hot for an eye";
  if (people?.has(minuteKey(r.ts))) return "a person at the stall";
  return null;
}

/** { used, setAside: [{ r, why }] } for the body_temp_c readings among `readings`. */
export function splitEye(readings, people = peopleMinutes(readings)) {
  const used = [], setAside = [];
  for (const r of readings) {
    if (r.metric !== "body_temp_c") continue;
    const why = eyeSetAside(r, people);
    if (why) setAside.push({ r, why }); else used.push(r);
  }
  return { used, setAside };
}

/** A predicate: this floor event is alone (no other within 10 min), so it counts. */
export function floorAlone(readings) {
  const patches = readings.filter((r) => r.metric === "urination_event" || r.metric === "excretion_event").map((r) => Date.parse(r.ts));
  return (r) => patches.filter((t) => Math.abs(t - Date.parse(r.ts)) <= FLOOR_ALONE_MS).length === 1;
}

/** "2 readings set aside: 40.3, 40.5 °C — too hot for an eye" */
export function setAsideNote(setAside) {
  if (!setAside.length) return null;
  const by = new Map();
  for (const { r, why } of setAside) (by.get(why) ?? by.set(why, []).get(why)).push(r.value.toFixed(1));
  return `${setAside.length} reading${setAside.length === 1 ? "" : "s"} set aside: ` +
    [...by].map(([why, v]) => `${v.join(", ")} °C — ${why}`).join("; ") + ".";
}
