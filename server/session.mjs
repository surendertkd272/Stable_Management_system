// Session report: what the camera measured on the 8 points over a window
// (a practice demo, a night). Built from the stored readings, the recorded
// clips and the alerts — every figure says how much of the window it covers,
// and a point with nothing measured says so instead of showing zero.

const MIN = 60000;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
const hhmm = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function stats(rows) {
  const v = rows.map((r) => r.value);
  if (!v.length) return null;
  return { n: v.length, min: r1(Math.min(...v)), median: r1(median(v)), max: r1(Math.max(...v)), last: r1(rows.at(-1).value), lastAt: rows.at(-1).ts };
}
const minutesCovered = (rows) => new Set(rows.map((r) => Math.floor(Date.parse(r.ts) / MIN))).size;
const countBy = (rows, f) => rows.reduce((a, r) => { const k = f(r) ?? "—"; a[k] = (a[k] || 0) + 1; return a; }, {});

/**
 * readings: this horse's readings (any time); from/to: ms; clips: listClips()
 * rows for the camera(s); alerts: current alert list for this horse.
 */
export function sessionReport({ readings, from, to, clips = [], alerts = [], horse = null }) {
  const win = readings.filter((r) => { const t = Date.parse(r.ts); return t >= from && t <= to; })
    .sort((a, b) => a.ts.localeCompare(b.ts));
  const of = (m) => win.filter((r) => r.metric === m);
  const windowMin = Math.round((to - from) / MIN);
  const pct = (m) => (windowMin ? Math.round((100 * m) / windowMin) : 0);

  // Coverage and gaps (5+ minutes with nothing from the camera at all).
  const gaps = [];
  let prev = from;
  for (const r of win) {
    const t = Date.parse(r.ts);
    if (t - prev >= 5 * MIN) gaps.push({ from: new Date(prev).toISOString(), to: r.ts, minutes: Math.round((t - prev) / MIN) });
    prev = Math.max(prev, t);
  }
  if (to - prev >= 5 * MIN) gaps.push({ from: new Date(prev).toISOString(), to: new Date(to).toISOString(), minutes: Math.round((to - prev) / MIN) });
  const covered = minutesCovered(win);

  const points = [];
  const add = (n, label, status, summary, extra = {}) => points.push({ n, label, status, summary, ...extra });

  // 1 · body temperature
  const temp = of("body_temp_c");
  const ts = stats(temp);
  if (ts) {
    const uncal = temp.filter((r) => r.meta?.calibrated === false).length;
    const methods = countBy(temp, (r) => (String(r.meta?.method || "").startsWith("eye box") ? "eye box" : r.meta?.method ? "head found elsewhere in view" : "—"));
    add(1, "Body temperature", uncal === temp.length ? "uncalibrated" : "measured",
      `Eye surface ${ts.median} °C median (${ts.min}–${ts.max}), ${ts.n} readings over ${minutesCovered(temp)} of ${windowMin} min (${pct(minutesCovered(temp))} %).`,
      { stats: ts, methods, notes: [
        "Eye infrared reads ~2 °C below rectal and is a trend for this horse, not a core temperature.",
        ...(uncal ? [`${uncal} readings were taken before the camera was aimed — shown, never used for alerts.`] : []),
        "Temperature alerts compare with the horse's own 7-day baseline, which needs ~3 days of readings.",
      ] });
  } else add(1, "Body temperature", "not measured", "No eye temperature in this window — the head was never in the thermal view (or the camera was not aimed).");

  // 2 · respiration pattern, 3 · respiratory rate
  const resp = of("respiratory_rate_bpm");
  const rs = stats(resp);
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
      { stats: rs, methods: countBy(resp, (r) => r.meta?.method), notes: [
        "A rate is only reported over 30 s+ with the head still and when it matches a count of breaths — minutes without one are not failures, they are honesty.",
      ] });
  } else {
    add(2, "Respiration pattern", "not measured", "No breathing rhythm found in this window.");
    add(3, "Respiratory rate", "not measured", "No breathing rate: the head was not still in the nostril box for 30 s, and the flank was not still in the colour picture.");
  }

  // 4 · activity
  const act = of("activity_index");
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

  // 7 · urination, 8 · excretion
  for (const [n, metric, label] of [[7, "urination_event", "Urination"], [8, "excretion_event", "Excretion"]]) {
    const ev = of(metric);
    add(n, label, ev.length ? "prototype" : "none seen",
      ev.length ? `${ev.length} seen: ` + ev.map((r) => `${hhmm(r.ts)} (${r.meta?.tier ?? "?"}, confidence ${Math.round((r.confidence ?? 0) * 100)} %)`).join(", ") + "."
        : "None seen. The floor is learned in the first ~5 minutes; events are only counted after the horse has moved away.",
      { events: ev.map((r) => ({ at: r.ts, tier: r.meta?.tier ?? null, confidence: r.confidence, source: r.source })),
        notes: ["Urine shows well on shavings, poorly on straw. Deposits outside the colour picture are missed."] });
  }

  // Timeline of everything worth looking at, and the footage to check it on.
  const timeline = [
    ...pev.map((r) => ({ at: r.ts, what: { lie_down: "Lay down", get_up: "Got up", possible_roll: "Possible roll", possible_cast: "Possibly cast" }[r.meta?.kind] || r.meta?.kind })),
    ...vices.map((r) => ({ at: r.ts, what: `${(r.meta?.kind || "weaving").replace("_", " ")} (1 min window)` })),
    ...of("urination_event").map((r) => ({ at: r.ts, what: "Urination (floor)" })),
    ...of("excretion_event").map((r) => ({ at: r.ts, what: "Manure (floor)" })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const inWin = clips.filter((c) => Date.parse(c.end) >= from && Date.parse(c.at) <= to);
  const bytes = inWin.reduce((a, c) => a + (c.thermal?.bytes || 0) + (c.visible?.bytes || 0), 0);

  const measured = points.filter((p) => ["measured", "prototype", "none seen", "learning", "uncalibrated"].includes(p.status)).length;
  return {
    horse, window: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), minutes: windowMin },
    coverage: { minutesWithData: covered, percent: pct(covered), readings: win.length, gaps },
    points, measured,
    timeline,
    alerts: alerts.map((a) => ({ type: a.type, severity: a.severity, detail: a.detail, time: a.time })),
    footage: { clips: inWin.length, megabytes: Math.round(bytes / 1e6), first: inWin.at(-1)?.at ?? null, last: inWin[0]?.end ?? null },
    verify: [
      ...(timeline.length ? [`Check the ${timeline.length} timeline moments against the recorded video (Footage & labels → To label).`] : []),
      "Compare with what the person at the stall wrote down (lying, manure, urination, weaving, breaths counted).",
      "Label what you see on the footage — that is how these prototype detectors become validated ones.",
    ],
  };
}
