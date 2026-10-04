// Session report: what was measured on the 12 points over a window (a
// practice demo, a night) — 1–8 from the camera, 9–12 from the wearable and
// the stall's water / feed sensors. Built from the stored readings, the
// recorded clips and the alerts — every figure says how much of the window it
// covers, and a point with nothing measured says so instead of showing zero.

import { BREATHING_WHY, isDiagnostic } from "./contract.mjs";
import { splitEye, floorAlone, setAsideNote } from "./reading-rules.mjs";
import { cameraBodyTemp, normalFor } from "./core-temp.mjs";
import { LIMB_NAME, lamenessVsNormal, leftOf, mealsOf, offCamera, stepsTotal } from "./rollup.mjs";

const MIN = 60000;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
const hhmm = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const grams = (g) => (g >= 1000 ? `${(g / 1000).toFixed(1)} kg` : `${Math.round(g)} g`);
const sum = (rows) => rows.reduce((a, r) => a + r.value, 0);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function stats(rows) {
  const v = rows.map((r) => r.value);
  if (!v.length) return null;
  return { n: v.length, min: r1(Math.min(...v)), median: r1(median(v)), max: r1(Math.max(...v)), last: r1(rows.at(-1).value), lastAt: rows.at(-1).ts };
}
const minutesCovered = (rows) => new Set(rows.map((r) => Math.floor(Date.parse(r.ts) / MIN))).size;
const countBy = (rows, f) => rows.reduce((a, r) => { const k = f(r) ?? "—"; a[k] = (a[k] || 0) + 1; return a; }, {});
const whyText = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${BREATHING_WHY[k] || k} ${n}`).join(", ");

/**
 * readings: this horse's readings (any time); from/to: ms; clips: listClips()
 * rows for the camera(s); alerts: current alert list for this horse;
 * floorWatched: whether the camera has a floor box (thermal or colour) — no
 * box means urination and manure were never looked for (null: not known).
 */
export function sessionReport({ readings, from, to, clips = [], alerts = [], horse = null, floorWatched = null, thermal = null }) {
  const win = readings.filter((r) => { const t = Date.parse(r.ts); return t >= from && t <= to; })
    .sort((a, b) => a.ts.localeCompare(b.ts));
  const of = (m) => win.filter((r) => r.metric === m);
  const windowMin = Math.round((to - from) / MIN);
  const pct = (m) => (windowMin ? Math.round((100 * m) / windowMin) : 0);

  // Coverage and gaps (5+ minutes with nothing from the camera at all). The
  // wearable and the stall sensors are not the camera: a hub reporting every
  // minute must not hide a camera gap.
  const cam = win.filter((r) => !offCamera(r));
  const gaps = [];
  let prev = from;
  for (const r of cam) {
    const t = Date.parse(r.ts);
    if (t - prev >= 5 * MIN) gaps.push({ from: new Date(prev).toISOString(), to: r.ts, minutes: Math.round((t - prev) / MIN) });
    prev = Math.max(prev, t);
  }
  if (to - prev >= 5 * MIN) gaps.push({ from: new Date(prev).toISOString(), to: new Date(to).toISOString(), minutes: Math.round((to - prev) / MIN) });
  const covered = minutesCovered(cam);

  const points = [];
  const add = (n, label, status, summary, extra = {}) => points.push({ n, label, status, summary, ...extra });

  // 1 · body temperature
  // the same rules as every report (server/reading-rules.mjs)
  const { used: temp, setAside: eyeAside } = splitEye(win);
  const ts = stats(temp);
  const asideNote = setAsideNote(eyeAside);
  if (ts) {
    const uncal = temp.filter((r) => r.meta?.calibrated === false).length;
    const methods = countBy(temp, (r) => (String(r.meta?.method || "").startsWith("eye box") ? "eye box" : r.meta?.method ? "head found elsewhere in view" : "—"));
    // body temperature by the cameras, at the window's last good eye reading (server/core-temp.mjs)
    const lastEye = Math.max(...temp.filter((r) => r.meta?.calibrated !== false).map((r) => Date.parse(r.ts)));
    const body = horse && Number.isFinite(lastEye) ? cameraBodyTemp(horse, readings, lastEye) : null;
    const eyeLine = `Eye surface ${ts.n === 1 ? `${ts.median} °C, 1 reading` : `${ts.median} °C median (${ts.min}–${ts.max}), ${ts.n} readings`} over ${minutesCovered(temp)} of ${windowMin} min (${pct(minutesCovered(temp))} %).`;
    const bodyLine = body?.value != null
      ? `Body temperature about ${body.value.toFixed(1)} °C (±${body.within}) at ${new Date(lastEye).toTimeString().slice(0, 5)} — the eye ${body.rise >= 0 ? "+" : ""}${body.rise.toFixed(1)} °C against this horse's own normal for that time of day. `
      : body?.learning ? `Body temperature: learning this horse's normal (day ${body.days} of 3). ` : "";
    add(1, "Body temperature", uncal === temp.length ? "uncalibrated" : "measured", bodyLine + eyeLine,
      { stats: ts, methods, bodyTemp: body, notes: [
        `Body temperature by camera = a resting ${horse?.species || "horse"}'s normal ${normalFor(horse)} °C + how far the eye is from this horse's own normal at that time of day, allowing for the stall's warmth. The ± is how much its eye wanders on ordinary days.`,
        ...(uncal ? [`${uncal} readings were taken before the camera was aimed — shown, never used for alerts.`] : []),
        ...(asideNote ? [asideNote] : []),
        "The horse's own normal comes from its last 14 days of eye readings (3 days to start, settled at 7).",
      ] });
  } else add(1, "Body temperature", "not measured", thermal === false
    ? "Not measured on this stall — its camera has no thermal sensor (eye temperature needs one)."
    : eyeAside.length ? "No eye temperature that counts in this window."
    : "No eye temperature in this window — the head was never in the thermal view (or the camera was not aimed).",
    asideNote ? { notes: [asideNote] } : {});

  // 2 · respiration pattern, 3 · respiratory rate
  const resp = of("respiratory_rate_bpm");
  const rs = stats(resp);
  // Why not, minute by minute (breathing_check, from 28 Sep 2026): which cause
  // dominates says what would help — e.g. following the nostril when the head
  // is in view but not where the boxes were drawn.
  const checks = of("breathing_check");
  const missed = checks.filter((r) => !r.value);
  const why = checks.length ? {
    checked: checks.length, measured: checks.length - missed.length,
    nostril: countBy(missed, (r) => r.meta?.nostril), flank: countBy(missed, (r) => r.meta?.flank),
  } : null;
  const whyNote = why && missed.length
    ? [`Minutes without a rate (${missed.length} of ${checks.length} checked) — nostril: ${whyText(why.nostril)}; flank: ${whyText(why.flank)}.`] : [];
  const regs = resp.map((r) => r.meta?.regularity).filter((v) => typeof v === "number");
  const fast = resp.filter((r) => r.meta?.band === "fast").length;
  if (rs) {
    const regMed = median(regs);
    add(2, "Respiration pattern", "measured",
      regMed === null ? "Rate found, but no breath-to-breath regularity was computed." :
        `Rhythm ${regMed >= 0.75 ? "regular" : regMed >= 0.5 ? "somewhat irregular" : "irregular"} (median regularity ${regMed.toFixed(2)} over ${regs.length} readings)` +
        (fast ? `; fast breathing in ${fast} readings.` : "."),
      { notes: ["Regular / irregular only — breathing disease (heaves) is not detected from the nostril."] });
    add(3, "Respiratory rate", resp.every((r) => r.meta?.calibrated === false) ? "uncalibrated" : "measured",
      `${rs.median} breaths/min median (${rs.min}–${rs.max}), ${rs.n} readings over ${minutesCovered(resp)} min (${pct(minutesCovered(resp))} %).`,
      { stats: rs, methods: countBy(resp, (r) => r.meta?.method), why, notes: [
        "A rate is only reported over 30 s+ with the head still and when it matches a count of breaths — minutes without one are not failures, they are honesty.",
        ...whyNote,
      ] });
  } else {
    add(2, "Respiration pattern", "not measured", "No breathing rhythm found in this window.");
    add(3, "Respiratory rate", "not measured",
      why ? `No breathing rate in the ${why.checked} minutes checked. Why, by minute — nostril: ${whyText(why.nostril)}; flank: ${whyText(why.flank)}.`
        : thermal === false ? "No breathing rate: on this stall it comes from the flank only (no thermal camera), when the horse stands still side-on in view."
        : "No breathing rate: the head was not still in the nostril box for 30 s, and the flank was not still in the colour picture.",
      { why, notes: why ? [] : ["Minute-by-minute reasons are recorded from 28 Sep 2026 on."] });
  }

  // 4 · activity
  const act = of("activity_index").filter((r) => !offCamera(r));     // camera point 4 — the wearable's own activity is not the camera's
  const as = stats(act);
  if (as) {
    const buckets = [];
    for (let t = from; t < to; t += 5 * MIN) {
      const v = act.filter((r) => { const x = Date.parse(r.ts); return x >= t && x < t + 5 * MIN; }).map((r) => r.value);
      buckets.push({ at: new Date(t).toISOString(), avg: v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null });
    }
    const busiest = [...buckets].filter((b) => b.avg !== null).sort((a, b) => b.avg - a.avg)[0];
    add(4, "Activity", "prototype",
      `Median ${as.median} (0 = still, 1 = very active), range ${as.min}–${as.max}; busiest 5 minutes from ${busiest ? hhmm(busiest.at) : "—"}.`,
      { stats: as, series: buckets, source: act.at(-1).source, notes: ["'Unusual for this horse' needs 3 days of this horse's own activity — not judged in a first session."] });
  } else add(4, "Activity", "not measured", "No activity — the behaviour video was not running or no horse was in view.");

  // 5 · resting pattern
  const still = of("inactive_minutes"), lying = of("lying_minutes"), pev = of("posture_event");
  const stillMin = Math.round(still.reduce((a, r) => a + r.value, 0));
  const lyingMin = Math.round(lying.reduce((a, r) => a + r.value, 0));
  const lateralMin = Math.round(lying.reduce((a, r) => a + (r.meta?.lateralMin ?? 0), 0));
  const kinds = countBy(pev, (r) => r.meta?.kind);
  if (lying.length || pev.length) {
    add(5, "Resting pattern", "prototype",
      `Lying ${lyingMin} min (${kinds.lie_down || 0} lie-downs, ${kinds.get_up || 0} get-ups${lateralMin ? `, ~${lateralMin} min possibly flat on the side` : ""}); still ${stillMin} min.`,
      { notes: ["Lying comes from the horse's box over time, learned for this stall."] });
  } else if (still.length) {
    add(5, "Resting pattern", "learning",
      `Still (not moving) ${stillMin} of ${windowMin} min. Lying not reported yet: the camera learns this stall's standing and lying shapes once it has seen the horse do both (needs the lying detector).`,
      { notes: ["Stillness is not lying — a horse dozes standing up."] });
  } else add(5, "Resting pattern", "not measured", "No stillness or lying data in this window.");

  // 6 · stable vices
  const vices = of("vice_event");
  const byKind = {};
  for (const r of vices) {
    const k = r.meta?.kind || "weaving";
    (byKind[k] ||= { minutes: 0, events: 0, first: r.ts, last: r.ts });
    byKind[k].minutes += r.meta?.windowMin ?? 1;
    byKind[k].events++;
    byKind[k].last = r.ts;
  }
  add(6, "Stable vices", vices.length ? "prototype" : as ? "none seen" : "not measured",
    vices.length ? Object.entries(byKind).map(([k, v]) => `${k.replace("_", " ")} ~${Math.round(v.minutes)} min (${hhmm(v.first)}–${hhmm(v.last)})`).join("; ") + "."
      : as ? "No weaving, box walking or rhythmic head tossing detected." : "Not measured (no behaviour video).",
    { byKind, notes: ["Crib-biting is not detected yet."] });

  // 7 · urination, 8 · excretion — "none seen" only if the floor was watched.
  const alone = floorAlone(win);
  for (const [n, metric, label] of [[7, "urination_event", "Urination"], [8, "excretion_event", "Excretion"]]) {
    const all = of(metric), ev = all.filter(alone);
    const moved = all.length - ev.length;
    const watched = as && floorWatched !== false;
    add(n, label, ev.length ? "prototype" : watched ? "none seen" : "not measured",
      ev.length ? `${ev.length} seen: ` + ev.map((r) => `${hhmm(r.ts)} (${r.meta?.tier ?? "?"}, confidence ${Math.round((r.confidence ?? 0) * 100)} %)`).join(", ") + "."
        : watched ? "None seen. The floor is learned in the first ~5 minutes; events are only counted after the horse has moved away."
          : floorWatched === false ? "Not measured — no floor area is marked on this camera (calibrator: Floor), so the bedding was not watched."
            : "Not measured — the floor is watched in the video, which was not running.",
      { events: ev.map((r) => ({ at: r.ts, tier: r.meta?.tier ?? null, confidence: r.confidence, source: r.source })),
        notes: [
          ...(moved ? [`${moved} more floor change${moved === 1 ? "" : "s"} set aside: within 10 minutes of another, the bedding being moved (lying down, getting up, turning).`] : []),
          "Urine shows well on shavings, poorly on straw. Deposits outside the colour picture are missed."] });
  }

  // 9–12 · the wearable and the stall sensors. A sensor that never reported
  // is "not measured"; "none seen" only where it is known to be working here
  // (it reported in the window or the 48 h before it).
  const seenNear = (metrics) => readings.some((r) => metrics.includes(r.metric)
    && Date.parse(r.ts) <= to && Date.parse(r.ts) >= from - 48 * 60 * MIN);

  // 9 · steps / locomotion (leg tag)
  const steps = of("steps"), sessions = of("exercise_session");
  const nSteps = stepsTotal(steps);
  if (nSteps !== null || sessions.length) {
    const live = steps.filter((r) => !r.meta?.rawSessionIds), used = live.length ? live : steps;
    // How much of the window the counts cover — only where each says its period.
    const span = used.length && used.every((r) => Number.isFinite(r.meta?.periodMin))
      ? ` covering ~${Math.min(windowMin, Math.round(used.reduce((a, r) => a + r.meta.periodMin, 0)))} of ${windowMin} min` : "";
    const exMin = Math.round(sum(sessions));
    add(9, "Steps / locomotion", "prototype",
      [nSteps !== null && `${nSteps} steps in ${plural(used.length, "count")}${span}`,
        sessions.length && `${plural(sessions.length, "exercise session")}, ${exMin} min in all`].filter(Boolean).join("; ") + ".",
      { steps: nSteps, exercise: sessions.map((r) => ({ at: r.meta?.start ?? r.ts, minutes: Math.round(r.value), steps: r.meta?.steps ?? null,
        distanceM: r.meta?.distanceM ?? null })),
        notes: ["Steps are the tagged leg's hoof strikes × 4 (all four legs), from the wearable."] });
  } else add(9, "Steps / locomotion", "not measured", "No step counts in this window — no leg sensor (wearable) reporting.");

  // 10 · lameness / limb-favouring (leg tag + head and/or pelvis sensor at the trot)
  const trots = of("lameness_result"), gait = of("gait_asymmetry");
  if (trots.length) {
    const last = trots.at(-1), vs = lamenessVsNormal(readings, last);
    const limb = LIMB_NAME[last.meta?.limb];
    add(10, "Lameness / limb-favouring", "prototype",
      `${plural(trots.length, "straight trot")} analysed; latest ${r1(last.value)} mm asymmetry at ${hhmm(last.ts)} ` +
      `(${limb ? `${limb} favoured` : "no limb singled out"})` +
      (vs.baselineMm === null ? "." : `, ${last.value >= vs.baselineMm ? "+" : ""}${r1(last.value - vs.baselineMm)} mm on this horse's usual ${r1(vs.baselineMm)} mm.`) +
      (vs.flagged ? " Flagged for a trot-up." : ""),
      { trots: trots.map((r) => ({ at: r.ts, valueMm: r1(r.value), limb: r.meta?.limb ?? null, strides: r.meta?.strides ?? null })),
        baselineMm: r1(vs.baselineMm), flagged: vs.flagged, notes: [
          "Head and pelvis movement at the trot, from the wearable; confirm with a trot-up and a vet.",
          ...(vs.baselineMm === null ? ["Compared with this horse's own normal once it has 3 trots in 14 days."] : []),
        ] });
  } else if (gait.length) {
    add(10, "Lameness / limb-favouring", "prototype",
      `Gait asymmetry index ${r1(median(gait.map((r) => r.value)) * 100)} % (median of ${plural(gait.length, "reading")}).`,
      { notes: ["An older asymmetry index (0–1), not a trot analysis."] });
  } else add(10, "Lameness / limb-favouring", "not measured",
    "No trot analysed in this window — needs the leg sensor plus the head or pelvis sensor during a straight trot.");

  // 11 · watering (water meter or weighed bucket)
  const water = of("water_ml"), visits = of("water_visit"), refills = of("water_refill");
  const refillNote = refills.length ? `; bucket refilled ${plural(refills.length, "time")} (${grams(sum(refills))} added, not counted as drinking)` : "";
  if (water.length || visits.length) {
    const drinks = [...visits, ...water.filter((r) => r.value > 0)].map((r) => r.ts).sort();
    add(11, "Watering", "measured",
      `${(sum(water) / 1000).toFixed(1)} L drunk${visits.length ? ` in ${plural(visits.length, "drink")}` : ""}` +
      `${drinks.length ? `, last at ${hhmm(drinks.at(-1))}` : ""}${refillNote}.`,
      { ml: Math.round(sum(water)), drinks: visits.length, refills: refills.length });
  } else if (seenNear(["water_ml", "water_visit", "water_refill"])) {
    add(11, "Watering", "none seen", `No drinking in this window${refillNote}; the water meter was reporting.`);
  } else add(11, "Watering", "not measured", "No water meter or weighed bucket reporting for this horse.");

  // 12 · feeding (weigh-back feeder, hay scale)
  const meals = mealsOf(readings).filter((m) => { const t = Date.parse(m.at); return t >= from && t <= to; });
  const hay = of("hay_intake_g"), faults = of("feeder_fault");
  const faultNote = faults.length ? `; feeder fault${faults.length > 1 ? "s" : ""}: ${faults.map((r) => `${(r.meta?.kind || "unknown").replace(/_/g, " ")} ${hhmm(r.ts)}`).join(", ")}` : "";
  if (meals.length || hay.length) {
    const mealText = (m) => [m.meal ?? "meal", hhmm(m.at), m.offeredG !== null && `offered ${grams(m.offeredG)}`,
      m.eatenG !== null && `ate ${grams(m.eatenG)}`, leftOf(m) !== null && `left ${grams(leftOf(m))}`].filter(Boolean).join(" ");
    add(12, "Feeding", "measured",
      [meals.length && `${plural(meals.length, "meal")}: ${meals.map(mealText).join("; ")}`,
        hay.length && `hay ${grams(sum(hay))} eaten`].filter(Boolean).join("; ") + `${faultNote}.`,
      { meals, hayG: hay.length ? Math.round(sum(hay)) : null, faults: faults.map((r) => ({ at: r.ts, kind: r.meta?.kind ?? "unknown" })) });
  } else if (seenNear(["feed_offered_g", "feed_intake_g", "feed_refusal_g", "hay_intake_g", "feeder_fault"])) {
    add(12, "Feeding", "none seen", `No meal and no hay eaten in this window${faultNote}; the feeder was reporting.`);
  } else add(12, "Feeding", "not measured", "No weigh-back feeder or hay scale reporting for this horse.");

  // Timeline of everything worth looking at, and the footage to check it on.
  const timeline = [
    ...pev.map((r) => ({ at: r.ts, what: { lie_down: "Lay down", get_up: "Got up", possible_roll: "Possible roll", possible_cast: "Possibly cast" }[r.meta?.kind] || r.meta?.kind })),
    ...vices.map((r) => ({ at: r.ts, what: `${(r.meta?.kind || "weaving").replace("_", " ")} (1 min window)` })),
    ...of("urination_event").filter(alone).map((r) => ({ at: r.ts, what: "Urination (floor)" })),
    ...of("excretion_event").filter(alone).map((r) => ({ at: r.ts, what: "Manure (floor)" })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const inWin = clips.filter((c) => Date.parse(c.end) >= from && Date.parse(c.at) <= to);
  const bytes = inWin.reduce((a, c) => a + (c.thermal?.bytes || 0) + (c.visible?.bytes || 0), 0);

  const measured = points.filter((p) => ["measured", "prototype", "none seen", "learning", "uncalibrated"].includes(p.status)).length;
  return {
    horse, window: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), minutes: windowMin },
    coverage: { minutesWithData: covered, percent: pct(covered), readings: win.filter((r) => !isDiagnostic(r.metric)).length, gaps },
    points, measured,
    timeline,
    alerts: alerts.map((a) => ({ type: a.type, severity: a.severity, detail: a.detail, time: a.time })),
    footage: { clips: inWin.length, megabytes: Math.round(bytes / 1e6), first: inWin.at(-1)?.at ?? null, last: inWin[0]?.end ?? null },
    verify: [
      ...(timeline.length ? [`Check the ${timeline.length} timeline moments against the recorded video (Footage & labels → To label).`] : []),
      "Compare with what the person at the stall wrote down (lying, manure, urination, weaving, breaths counted).",
      "Label what you see on the footage — it teaches the detectors.",
    ],
  };
}
