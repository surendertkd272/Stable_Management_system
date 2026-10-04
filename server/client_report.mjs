// Client session report: a designed, printable A4 report (five pages) for a
// horse's owner or vet, for any horse and any window. Every sentence, figure
// and photo is chosen from what was measured — nothing is written by hand
// except the stable's own notes, shown as theirs. What was not captured is
// said plainly, with the reason.
//
//   clientReport({ horse, readings, from, to, grab, ... }) -> HTML string
//
// grab(ms, width) returns a JPEG Buffer of the colour recording at that moment
// (footage.frameGrabber), or null. Photos are picked where the eye was in view
// and the horse was calm (sharpest of three nearby frames), spread in time,
// shown whole — the camera's view is narrow and the head is often at its edge.

import { isDiagnostic } from "./contract.mjs";
import { peopleMinutes, floorAlone, eyeSetAside } from "./reading-rules.mjs";
import { cameraBodyTemp, isFever, normalFor, RISING_C } from "./core-temp.mjs";
import { LIMB_NAME, leftOf, mealsOf, offCamera, stepsTotal } from "./rollup.mjs";

const LEVELS = [["none", "No activity", 0, 0.05], ["low", "Low", 0.05, 0.2], ["moderate", "Moderate", 0.2, 0.6], ["high", "High", 0.6, 1.01]];
const NICE = [1, 2, 5, 10, 15, 30, 60, 120, 240, 480];
const MAX_NOTES = 1400;

/** width / height of a JPEG, from its frame header (null if not found). */
function jpegAspect(buf) {
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const mk = buf[i + 1];
    if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) return buf.readUInt16BE(i + 7) / buf.readUInt16BE(i + 5);
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : null; };
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f1 = (v) => (v === null || v === undefined ? "—" : (Math.round(v * 10) / 10).toFixed(1));
const f2 = (v) => (v === null || v === undefined ? "—" : v.toFixed(2));
const levelOf = (v) => LEVELS.find(([, , lo, hi]) => v >= lo && v < hi)?.[0] ?? "high";
const LEVEL_WORD = { none: "still", low: "low activity", moderate: "moderate activity", high: "high activity" };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A valid IANA time zone, or the server's own. */
export function safeTimeZone(tz) {
  try { if (tz) { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return tz; } } catch { /* fall through */ }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Box walking counts only as the edge agent now reports it: laps in
 *  consecutive windows. Older single-window flags were a horse turning round. */
const countsAsVice = (r) => r.meta?.kind !== "box_walking" || /consecutive/.test(r.meta?.method || "") || (r.meta?.windowMin ?? 0) >= 2;

// paused: [[fromMs, toMs], …] — stretches of the session that were paused
// (e.g. to adjust the camera). Their readings are left out, and coverage and
// duration count only the monitored minutes; the timeline marks them.
// grabThermal: like grab, for the thermal picture at the same second — each
// photo then shows colour and thermal side by side. previous: { summary } of
// an earlier session (its report's `summary`), for a page comparing the horse
// across the two sessions.
export async function clientReport({ horse, readings, from, to, floorWatched = null, notes = "", away = [], paused = [], tz, grab = null,
  grabThermal = null, grabFull = null, mapCrop = [0, 0.09, 1, 0.91], previous = null, clipCount = 0, client = "", review = [], marks = [], lastLive = null, autoVisits = true, boxes = null, trough = null, baseline = null, thermal = null, now = Date.now() }) {
  tz = safeTimeZone(tz);
  from = Math.floor(from / 60000) * 60000;                        // minutes on the clock: 23:24 reads 23:24, not 23:23
  const minutes = Math.max(1, Math.round((to - from) / 60000));
  const T = (o) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...o });
  const tClock = T({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const clock = (ms) => tClock.format(ms);
  // "IST", "BST", "EDT"… — each locale knows the short names of its own zones.
  const zoneIn = (loc) => new Intl.DateTimeFormat(loc, { timeZone: tz, timeZoneName: "short" }).formatToParts(from).find((p) => p.type === "timeZoneName")?.value;
  const tzName = ["en-IN", "en-GB", "en-US"].map(zoneIn).find((v) => v && !/^GMT[+-]/.test(v)) || zoneIn("en-GB") || tz;
  const hourOf = (ms) => Number(T({ hour: "2-digit", hourCycle: "h23" }).format(ms));
  const name = horse.name || horse.id;

  // ---- readings, minute by minute -------------------------------------------- //
  const inPause = (ms) => paused.some(([a, b]) => ms >= a && ms < b);
  const rd = readings.filter((r) => { const t = Date.parse(r.ts); return t >= from && t <= to && !inPause(t); }).sort((a, b) => a.ts.localeCompare(b.ts));
  const pausedMin = Array.from({ length: minutes }, (_, m) => inPause(from + m * 60000 + 30000)).filter(Boolean).length;
  const liveMin = Math.max(1, minutes - pausedMin);        // the minutes actually monitored
  const of = (m) => rd.filter((r) => r.metric === m);
  const minuteOf = (r) => Math.max(0, Math.min(minutes - 1, Math.floor((Date.parse(r.ts) - from) / 60000)));
  const inAway = (ms) => away.some(([a, b]) => ms >= a && ms <= b);
  // the same rules as every report (server/reading-rules.mjs): an eye 33–39.5 °C, no person at the stall
  const people = peopleMinutes(rd);
  const eye = of("body_temp_c").filter((r) => !eyeSetAside(r, people) && !inAway(Date.parse(r.ts)));
  const eyeV = eye.map((r) => r.value);
  // Body temperature from the cameras (server/core-temp.mjs): the horse's
  // normal body temperature plus how far its eye was from its own normal for
  // that time of day — at the session's last eye reading.
  const lastEyeMs = eye.length ? Math.max(...eye.map((r) => Date.parse(r.ts))) : null;
  const bodyT = lastEyeMs === null ? null : cameraBodyTemp(horse, readings, lastEyeMs);
  const bodyV = bodyT?.value ?? null;
  const bodyState = bodyV === null ? null : isFever(bodyT) ? "high" : bodyT.rise >= Math.max(RISING_C, bodyT.within) ? "raised" : "normal";
  // Minutes reviewed afterwards from recorded footage (edge/replay.py) hold no
  // temperatures: the eye there was not "out of view", it was not measurable.
  // A session may be all review (a night recorded at the stable) or a review
  // plus a live check (the morning, with the eye read) — each minute says
  // which it was.
  const recMin = new Array(minutes).fill(false);
  for (const r of rd) if (r.meta?.fromRecording) recMin[minuteOf(r)] = true;
  const anyRec = recMin.some(Boolean);
  const fromRec = anyRec && !eye.length;                           // all review: no eye at all
  const dayOf = (ms) => T({ year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  const overnight = minutes >= 240 && dayOf(from) !== dayOf(to);
  // "21:40–06:10": from the first to the last minute with data of one kind.
  const span = (pred) => {
    const ms = Array.from({ length: minutes }, (_, m) => m).filter((m) => anyMin.has(m) && pred(m));
    return ms.length ? `${clock(from + ms[0] * 60000)}–${clock(from + (ms.at(-1) + 1) * 60000)}` : "";
  };
  const reviewed = (m) => recMin[m], checkedLive = (m) => !recMin[m];
  const REVIEW = `This ${overnight ? "overnight " : ""}session was recorded at the stable and reviewed minute by minute afterwards. Eye temperature is taken during live monitoring, so it is not part of this review.`;
  const act = new Array(minutes).fill(null), still = new Array(minutes).fill(null), eyeMin = new Array(minutes).fill(null);
  for (const r of of("activity_index")) if (!offCamera(r)) act[minuteOf(r)] = r.value;   // camera activity only
  for (const r of of("inactive_minutes")) still[minuteOf(r)] = Math.min(1, r.value / (r.meta?.windowMin || 1));
  const eyeTs = new Array(minutes).fill(null);                     // when the eye was read: photos are taken then
  const eyeSure = new Array(minutes).fill(false);                  // passed the eye-shape check (readings from 28 Sep 2026 on)
  // meta.readAt (s): the moment the eye was read; older readings only carry the
  // window's end, a few seconds after the eye scan.
  for (const r of eye) {
    const m = minuteOf(r);
    eyeMin[m] = r.value;
    eyeTs[m] = typeof r.meta?.readAt === "number" ? r.meta.readAt * 1000 : Date.parse(r.ts) - 3000;
    eyeSure[m] = /eye-shaped/.test(r.meta?.method || "");
  }
  // People at the stall (seconds per minute, from the colour picture): visits
  // and checks — context, and left out of the horse's own activity.
  const peopleSec = new Array(minutes).fill(0);
  for (const r of of("people_in_view_s")) peopleSec[minuteOf(r)] = Math.max(peopleSec[minuteOf(r)], r.value);
  // autoVisits false: the detector's people are not trusted for this view
  // (2 Oct's night: the horse's dark hindquarters taken for a person) — only
  // visits seen on the recording are given, as such.
  const revVisits = review.filter((x) => x.kind === "visit" && x.to > x.from)
    .map((x) => ({ start: Math.max(0, Math.floor((x.from - from) / 60000)), end: Math.min(minutes - 1, Math.ceil((x.to - from) / 60000) - 1), reviewed: true }));   // to 23:29 = the minute 23:28 last
  const peopleSeen = autoVisits ? of("people_in_view_s").length > 0 : revVisits.length > 0;
  if (!autoVisits) {
    peopleSec.fill(0);
    for (const v of revVisits) for (let m = v.start; m <= v.end; m++) peopleSec[m] = 60;
  }
  const visits = autoVisits ? [] : revVisits;
  if (autoVisits) for (let m = 0; m < minutes; m++) {
    if (peopleSec[m] < 5) continue;
    const last = visits.at(-1);
    if (last && m - last.end <= 2) last.end = m; else visits.push({ start: m, end: m });
  }
  // Camera coverage: the wearable and the stall sensors are not the camera.
  const anyMin = new Set(rd.filter((r) => !offCamera(r)).map(minuteOf));
  const actV = act.filter((v) => v !== null);
  const bands = Object.fromEntries(LEVELS.map(([k, , lo, hi]) => [k, actV.filter((v) => v >= lo && v < hi).length]));
  const stillMin = Math.round(still.filter((v) => v !== null).reduce((a, v) => a + v, 0));
  const resp = of("respiratory_rate_bpm");
  const respV = resp.map((r) => r.value);
  // Why breathing was not captured: the most common reason, minute by minute.
  const missed = of("breathing_check").filter((r) => !r.value);
  const topWhy = Object.entries(missed.reduce((a, r) => { const k = r.meta?.nostril; if (k) a[k] = (a[k] || 0) + 1; return a; }, {}))
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const RESP_WHY = {
    head_off_boxes: "In most minutes the head was not in position for breathing to be read at the nostril.",
    head_moving: "In most minutes the head was moving; breathing needs the nostril still in view for 30 seconds.",
    head_out_of_view: "In most minutes the head was out of view.",
    no_rhythm: "The nostril was in view, but no clear breathing rhythm was found.",
    count_disagrees: "The nostril was in view, but no clear breathing rhythm was found.",
    no_thermal_video: "Monitoring was interrupted.",
    too_little_video: "Monitoring was interrupted.",
  };
  const respNote = RESP_WHY[topWhy] || "Requires the nostril or flank still in view for 30 seconds.";
  const nReadings = rd.filter((r) => !isDiagnostic(r.metric)).length;
  const regs = resp.map((r) => r.meta?.regularity).filter((v) => typeof v === "number");
  const lyingMin = Math.round(of("lying_minutes").reduce((a, r) => a + r.value, 0));
  const lyingMeasured = of("lying_minutes").length > 0;
  const posture = of("posture_event");
  const vices = of("vice_event").filter(countsAsVice);
  const viceKinds = {};
  for (const r of vices) { const k = (r.meta?.kind || "weaving").replace("_", " "); (viceKinds[k] ||= []).push(Date.parse(r.ts)); }
  // A urination or a dropping leaves one patch on the bedding. Patches that
  // come within 10 minutes of another are the bedding being moved — the horse
  // lying down, getting up or turning in the straw (2 Oct's night: four
  // 'droppings' in two minutes as he lay down). Left out, not counted.
  const alone = floorAlone(rd);
  const floorEv = { urination: of("urination_event").filter(alone), excretion: of("excretion_event").filter(alone) };
  const floorOk = floorWatched !== false && actV.length > 0;

  // Buckets: one bar per minute for an hour, wider for a night.
  const bucket = NICE.find((b) => minutes / b <= 90) ?? 480;
  const nb = Math.ceil(minutes / bucket);
  const bIdx = (i) => [i * bucket, Math.min(minutes, (i + 1) * bucket)];
  const actB = Array.from({ length: nb }, (_, i) => { const [a, b] = bIdx(i); const v = act.slice(a, b).filter((x) => x !== null); return v.length ? avg(v) : null; });
  const stillB = Array.from({ length: nb }, (_, i) => { const [a, b] = bIdx(i); const v = still.slice(a, b).filter((x) => x !== null); return v.length ? avg(v) : null; });
  const eyeB = Array.from({ length: nb }, (_, i) => { const [a, b] = bIdx(i); return eyeMin.slice(a, b).some((x) => x !== null); });
  const peopleB = Array.from({ length: nb }, (_, i) => { const [a, b] = bIdx(i); return peopleSec.slice(a, b).some((v) => v >= 5); });
  const recB = Array.from({ length: nb }, (_, i) => { const [a, b] = bIdx(i); return recMin.slice(a, b).some(Boolean); });
  const anyB = Array.from({ length: nb }, (_, i) => { const [a, b] = bIdx(i); for (let m = a; m < b; m++) if (anyMin.has(m)) return true; return false; });
  const rollSpan = 2;
  const roll = actB.map((_, i) => { const w = actB.slice(Math.max(0, i - rollSpan), i + rollSpan + 1).filter((v) => v !== null); return w.length ? avg(w) : null; });
  const avgLabel = `${(2 * rollSpan + 1) * bucket}-minute average`;
  const tick = NICE.find((b) => b >= 5 && minutes / b <= 8) ?? 480;
  const block = NICE.find((b) => b >= 10 && minutes / b <= 10) ?? 480;
  const dur = liveMin < 120 ? plural(liveMin, "minute") : `${Math.floor(liveMin / 60)} h${liveMin % 60 ? ` ${liveMin % 60} min` : ""}`;
  const pauseText = paused.map(([a, b]) => `${clock(a)}–${clock(b)}`).join(", ");

  // Temperature trend: first half against second half of the readings.
  let trend = null;
  if (eye.length >= 6) {
    const half = Math.floor(eye.length / 2);
    trend = med(eyeV.slice(half)) - med(eyeV.slice(0, half));
  }
  const eyeMed = med(eyeV), eyeLo = eyeV.length ? Math.min(...eyeV) : null, eyeHi = eyeV.length ? Math.max(...eyeV) : null;
  const eyeMinutes = eyeMin.filter((v) => v !== null).length;

  // Rest spells: 30 %+ standing still, gaps of up to 2 minutes joined.
  const spells = [];
  for (let m = 0; m < minutes; m++) {
    if ((still[m] ?? 0) >= 0.3) {
      const last = spells.at(-1);
      if (last && m - last.end <= 2) last.end = m; else spells.push({ start: m, end: m });
    }
  }
  const spellText = (list) => list.map((sp) => `${clock(from + sp.start * 60000)}–${clock(from + (sp.end + 1) * 60000)}`).join(", ");
  const blocks = Array.from({ length: Math.ceil(minutes / block) }, (_, b) => {
    const lo = b * block, hi = Math.min(minutes, lo + block);
    const a = act.slice(lo, hi).filter((v) => v !== null);
    const s = still.slice(lo, hi).filter((v) => v !== null).reduce((x, v) => x + v, 0);
    const t = eyeMin.slice(lo, hi).filter((v) => v !== null);
    const ms0 = from + lo * 60000, ms1 = from + hi * 60000;
    return { label: `${clock(ms0)}–${clock(ms1)}`, act: avg(a), peak: a.length ? Math.max(...a) : null, still: Math.round(s),
      temp: avg(t), n: t.length, eyeShare: t.length / Math.max(1, hi - lo), data: a.length > 0,
      flags: vices.filter((r) => { const x = Date.parse(r.ts); return x >= ms0 && x < ms1; }).length };
  });
  const busiest = blocks.filter((b) => b.act !== null).sort((a, b) => b.act - a.act)[0];
  const dominant = actV.length ? LEVELS.map(([k]) => k).sort((a, b) => bands[b] - bands[a])[0] : null;

  // ---- how the time was spent: each second of the colour picture -------------- //
  const TB = [["lying", "Lying down", "tb-lie"], ["eating", "Eating at the hay", "tb-eat"], ["resting", "Standing at rest", "tb-rest"],
    ["moving", "Moving about", "tb-move"], ["unseen", "Out of view", "tb-out"]];
  const tbR = of("time_budget");
  const hayKnown = tbR.some((r) => r.meta?.hay);
  // Seen on the recording by a person (lying down where the stall's view
  // does not let the system tell lying from standing): said as reviewed.
  const lyingRev = review.filter((x) => x.kind === "lying" && x.to > x.from);
  const lyingRevMin = Math.round(lyingRev.reduce((x, r) => x + (r.to - r.from), 0) / 60000);
  const lyingRevText = lyingRev.map((r) => `${clock(r.from)}–${clock(r.to)}`).join(" and ");
  const lyingRevNote = lyingRev.map((r) => r.text).filter(Boolean).join("; ");
  const inLyingRev = (ms) => lyingRev.some((x) => ms >= x.from && ms <= x.to);
  // Seconds per minute in each state. Minutes seen lying on the recording are
  // lying, whatever the picture alone suggested: lying on the hay with small
  // movements read as 'eating' (2 Oct), lying still as 'at rest'.
  const perMin = Object.fromEntries(TB.map(([k]) => [k, new Array(minutes).fill(0)]));
  for (const r of tbR) for (const [k] of TB) perMin[k][minuteOf(r)] += r.meta?.[`${k}S`] || 0;
  for (let m = 0; m < minutes; m++) {
    if (!inLyingRev(from + m * 60000 + 30000)) continue;
    perMin.lying[m] = 60;                                          // the whole minute, as seen
    perMin.eating[m] = perMin.resting[m] = perMin.moving[m] = perMin.unseen[m] = 0;
  }
  // Lying is told apart once the stall's posture model has learned it (or a
  // person saw it on the recording); eating only where the hay was marked.
  const lyingKnown = lyingMeasured || lyingRev.length > 0;
  const tbShown = TB.filter(([k]) => (k !== "lying" || lyingKnown) && (k !== "eating" || hayKnown));
  const tbTot = Object.fromEntries(TB.map(([k]) => [k, perMin[k].reduce((x, v) => x + v, 0)]));
  const tbAll = TB.reduce((x, [k]) => x + tbTot[k], 0);
  const budgetOk = tbAll >= 600;                                   // ten minutes or more
  const stateOf = Array.from({ length: minutes }, (_, m) => {
    const best = TB.filter(([k]) => k !== "unseen").map(([k]) => [k, perMin[k][m]]).sort((x, y) => y[1] - x[1])[0];
    return best && best[1] > 0 ? best[0] : null;
  });
  const [GX, GY] = (tbR.find((r) => r.meta?.grid)?.meta.grid || "12x8").split("x").map(Number);
  const cells = new Array(GX * GY).fill(0);
  for (const r of tbR) for (const [c, v] of r.meta?.where || []) if (c >= 0 && c < cells.length) cells[c] += v;
  const hmText = (sec) => (sec >= 3600 ? `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min` : `${Math.round(sec / 60)} min`);
  const STATE_WORD = { lying: "Lying down", eating: "Eating at the hay", resting: "Standing at rest", moving: "Moving about" };

  // ---- patterns through the session: bouts, phases, hour by hour ---------------- //
  // Bouts: minutes mostly in one state, joined over short breaks.
  const bouts = (k, minS, gap) => {
    const out = [];
    for (let m = 0; m < minutes; m++) {
      if (perMin[k][m] < minS) continue;
      const l = out.at(-1);
      if (l && m - l.end <= gap) l.end = m; else out.push({ start: m, end: m });
    }
    return out.map((b) => ({ ...b, min: b.end - b.start + 1 }));
  };
  const restBouts = bouts("resting", 40, 1), eatBouts = bouts("eating", 30, 2);
  const longest = (list) => list.slice().sort((x, y) => y.min - x.min)[0] || null;
  const span2 = (b) => `${clock(from + b.start * 60000)}–${clock(from + (b.end + 1) * 60000)}`;
  // Clock hours: shares of each state, average activity, visits.
  const hours = [];
  for (let m = 0; m < minutes; m++) {
    const label = T({ hour: "2-digit", hourCycle: "h23" }).format(from + m * 60000);
    let h = hours.at(-1);
    if (!h || h.label !== label) { h = { label, start: m, end: m, s: Object.fromEntries(TB.map(([k]) => [k, 0])), act: [], people: 0 }; hours.push(h); }
    h.end = m;
    for (const [k] of TB) h.s[k] += perMin[k][m];
    if (act[m] !== null) h.act.push(act[m]);
    if (peopleSec[m] >= 10) h.people += 1;
    if (inLyingRev(from + m * 60000 + 30000)) h.lyingRev = (h.lyingRev || 0) + 1;
  }
  for (const h of hours) {
    h.seen = TB.reduce((x, [k]) => x + (k === "unseen" ? 0 : h.s[k]), 0);
    h.share = (k) => (h.seen ? h.s[k] / h.seen : 0);
    h.avg = avg(h.act);
    h.from = clock(from + h.start * 60000);
  }
  const fullHours = hours.filter((h) => h.end - h.start >= 29 && h.seen >= 600);
  const dominantOf = (h) => (h.share("lying") >= 0.4 ? "lying" : h.share("resting") >= 0.5 ? "rest" : h.share("eating") >= 0.4 ? "eating"
    : h.share("eating") + h.share("resting") + h.share("lying") >= 0.6 ? "both" : "busy");
  // Phases: consecutive hours with the same character, in words.
  const phases = [];
  for (const h of fullHours) {
    const d = dominantOf(h), l = phases.at(-1);
    if (l && l.kind === d && l.hours.at(-1).end + 1 >= h.start) l.hours.push(h); else phases.push({ kind: d, hours: [h] });
  }
  const PHASE = { lying: "lying down for most of it", rest: "mostly at rest", eating: "mostly eating at the hay", both: "eating and resting in turns", busy: "more active, moving and eating" };
  const phaseText = phases.map((ph) => {
    const a = ph.hours[0].start, b = ph.hours.at(-1).end + 1;
    const sh = (k) => Math.round((ph.hours.reduce((x, h) => x + h.s[k], 0) / Math.max(1, ph.hours.reduce((x, h) => x + h.seen, 0))) * 100);
    const detail = ph.kind === "lying" ? `${sh("lying")}% lying, ${sh("resting")}% standing at rest` : ph.kind === "rest" ? `${sh("resting")}% at rest`
      : ph.kind === "eating" ? `${sh("eating")}% eating` : `${sh("eating")}% eating, ${sh("resting") + sh("lying")}% resting`;
    return { when: `${clock(from + a * 60000)}–${clock(from + b * 60000)}`, text: `${PHASE[ph.kind]} (${detail})` };
  });
  const byAct = fullHours.filter((h) => h.avg !== null).slice().sort((x, y) => x.avg - y.avg);
  const quietest = byAct[0], busiestHour = byAct.at(-1);
  const respTimes = resp.map((r) => ({ at: clock(Date.parse(r.ts)), v: r.value, what: inLyingRev(Date.parse(r.ts)) ? "lying" : stateOf[minuteOf(r)] }));
  const patternsOk = budgetOk && minutes >= 120 && fullHours.length >= 2;

  // ---- rest, sleep and health indicators, against healthy horses ------------- //
  // Lying bouts, flat-out spells and getting up as seen on the recording (the
  // view does not separate them by itself); the norms are the knowledge base's
  // (server/knowledge.mjs), each with its sources.
  const lateralRev = review.filter((x) => x.kind === "lateral" && x.to > x.from);
  const lateralMin = Math.round(lateralRev.reduce((x, r) => x + (r.to - r.from), 0) / 60000);
  const getups = review.filter((x) => x.kind === "getup");
  let gapBest = null;
  for (let m = 0, start = null; m <= minutes; m++) {             // the longest stretch without eating
    const eating = m < minutes && perMin.eating[m] >= 10;
    if (!eating && start === null && m < minutes) start = m;
    if ((eating || m === minutes) && start !== null) { if (!gapBest || m - start > gapBest.len) gapBest = { start, len: m - start }; start = null; }
  }
  const rangeText = (v) => { const lo = f1(Math.min(...v)), hi = f1(Math.max(...v)); return lo === hi ? lo : `${lo}–${hi}`; };
  const breathBy = {};
  for (const x of respTimes) (breathBy[x.what || "other"] ||= []).push(x.v);
  const standRestS = tbTot.resting;
  const standShare = standRestS + lyingRevMin * 60 > 0 ? Math.round((standRestS / (standRestS + lyingRevMin * 60)) * 100) : null;
  // Where he went: his box every few seconds, when it was given (a separate pass).
  const bx = (boxes || []).filter((r) => r.length > 4 && r[0] * 1000 >= from && r[0] * 1000 <= to);
  let moves = 0, settled = null;
  if (bx.length > 60) {
    const cx = bx.map((r) => [r[0], (r[1] + r[3]) / 2, r[4]]);
    const smooth = cx.map((_, i) => { const w = cx.slice(Math.max(0, i - 7), i + 8); const xs = w.map((v) => v[1]).sort((a, b) => a - b), ys = w.map((v) => v[2]).sort((a, b) => a - b);
      return [cx[i][0], xs[Math.floor(xs.length / 2)], ys[Math.floor(ys.length / 2)]]; });
    let anchor = smooth[0], since = smooth[0][0], cand = null;
    for (const p of smooth) {
      const far = Math.hypot(p[1] - anchor[1], p[2] - anchor[2]) > 0.2;
      if (!far) { cand = null; continue; }
      if (!cand) cand = p;
      else if (p[0] - cand[0] >= 180) {                             // a new place, kept 3 minutes or more
        if (!settled || cand[0] - since > settled.len) settled = { from: since, len: cand[0] - since };
        moves += 1; anchor = p; since = cand[0]; cand = null;
      }
    }
    const end = smooth.at(-1)[0];
    if (!settled || end - since > settled.len) settled = { from: since, len: end - since };
  }
  const troughVisits = [];
  if (trough && bx.length) {
    const at = (r) => r[2] < trough[3] && r[1] < trough[2] && r[3] > trough[0] && r[4] < 0.7;   // standing at the back wall, by the trough
    for (const r of bx) {
      if (!at(r)) continue;
      const l = troughVisits.at(-1);
      if (l && r[0] - l.to <= 30) l.to = r[0]; else troughVisits.push({ from: r[0], to: r[0] });
    }
  }
  const troughReal = troughVisits.filter((v) => v.to - v.from >= 20);
  const healthOk = lyingRev.length > 0 || respTimes.length > 0 || budgetOk;

  // ---- photos: eye in view and calm, spread through the session -------------- //
  const score = (m) => (act[m] === null ? -1 : (eyeMin[m] !== null ? 2 : 0) + (1 - Math.min(1, act[m])) - (inAway(from + m * 60000 + 30000) ? 3 : 0));
  // A photo for an eye reading comes from the second the eye was read.
  async function sharpest(m, width) {
    if (!grab) return null;
    const at0 = eyeTs[m] !== null ? [-1, 0, 1].map((s) => eyeTs[m] + s * 1000) : [15, 30, 45].map((s) => from + m * 60000 + s * 1000);
    const tries = await Promise.all(at0.map(async (at) => ({ at, jpg: await grab(at, width) })));
    const ok = tries.filter((t) => t.jpg);
    return ok.length ? ok.sort((a, b) => b.jpg.length - a.jpg.length)[0] : null;   // more detail compresses larger
  }
  const caption = (m) => {
    if (inLyingRev(from + m * 60000 + 30000)) return "Lying down · seen on the recording";
    const a = act[m] === null ? "no reading" : LEVEL_WORD[levelOf(act[m])];
    if (recMin[m] && eyeMin[m] === null) return a[0].toUpperCase() + a.slice(1);   // reviewed: no eye to speak of
    return `${eyeMin[m] === null ? "eye not in view" : eyeSure[m] ? `eye in view, ${f1(eyeMin[m])} °C` : `temperature ${f1(eyeMin[m])} °C`} · ${a}`;
  };
  const ranked = Array.from({ length: minutes }, (_, m) => m).filter((m) => act[m] !== null).sort((a, b) => score(b) - score(a));
  const coverMin = [];
  for (const m of ranked) { if (coverMin.every((c) => Math.abs(c - m) >= Math.max(5, minutes / 8))) coverMin.push(m); if (coverMin.length === 3) break; }
  coverMin.sort((a, b) => a - b);
  const toUri = (jpg) => `data:image/jpeg;base64,${jpg.toString("base64")}`;
  // Heat views: the moments where the horse fills the heat picture best. A
  // view of empty floor has little detail and compresses small; the horse's
  // outline compresses large — so many moments are taken and the most
  // detailed kept, spread through the session (2 Oct: the first picks
  // included blank floor). A breathing minute is preferred when its picture
  // is as good.
  const respMin = new Map(resp.map((r) => [minuteOf(r), r]));
  const heatCands = [];
  const stepH = Math.max(1, Math.floor(minutes / 48));
  for (let m = 0; m < minutes; m += stepH) if (act[m] !== null) heatCands.push(m);
  for (const m of respMin.keys()) if (!heatCands.includes(m)) heatCands.push(m);
  const heatShots = [];
  if (grabThermal) {
    for (let i = 0; i < heatCands.length; i += 6) {               // a few ffmpeg at a time
      heatShots.push(...(await Promise.all(heatCands.slice(i, i + 6).map(async (m) => {
        const at = from + m * 60000 + 30000, jpg = await grabThermal(at, 640);
        return jpg ? { m, at, jpg } : null;
      }))).filter(Boolean));
    }
  }
  const hsizes = heatShots.map((x) => x.jpg.length).sort((x, y) => x - y);
  const hq = (p) => (hsizes.length ? hsizes[Math.floor(p * (hsizes.length - 1))] : 0);
  const heatChosen = [];
  for (const x of heatShots.filter((x) => x.jpg.length >= hq(0.5))
    .sort((x, y) => y.jpg.length * (respMin.has(y.m) ? 1.15 : 1) - x.jpg.length * (respMin.has(x.m) ? 1.15 : 1))) {
    if (heatChosen.length < 6 && heatChosen.every((c) => Math.abs(c.m - x.m) >= minutes / 16)) heatChosen.push(x);
  }
  const withThermal = async (f, width) => {
    const t = grabThermal ? await grabThermal(f.at, width) : null;
    if (t && hsizes.length && t.length < hq(0.75)) return {};     // not among the clearest heat frames: colour alone
    return t ? { thermal: toUri(t), tAspect: jpegAspect(t) } : {};
  };
  const covers = (await Promise.all(coverMin.map(async (m) => {
    const f = await sharpest(m, 1100);
    // Colour alone on the cover when the heat views have a section of their own.
    return f && { m, at: f.at, img: toUri(f.jpg), aspect: jpegAspect(f.jpg), ...(heatChosen.length ? {} : await withThermal(f, 640)) };
  }))).filter(Boolean);

  // Two photo sections, each chosen for what it shows. Colour: one moment of
  // each thing he did (the middle of its longest run), a visit, then calm
  // moments through the session. Heat: minutes whose breathing was read, then
  // minutes at rest, then calm moments — spread in time.
  const runsOf = (pred) => {
    const out = [];
    for (let m = 0; m < minutes; m++) if (pred(m)) { const l = out.at(-1); if (l && l.end === m - 1) l.end = m; else out.push({ start: m, end: m }); }
    return out.sort((x, y) => (y.end - y.start) - (x.end - x.start));
  };
  const spread = minutes / 12;
  const pickInto = (list, m, n) => { if (m !== undefined && list.length < n && act[m] !== null && list.every((x) => Math.abs(x - m) >= spread)) list.push(m); };
  const colourMin = [];
  const markOf = new Map(marks.map((mk) => [Math.max(0, Math.min(minutes - 1, Math.floor((mk.at - from) / 60000))), mk.text]));
  for (const m of markOf.keys()) if (colourMin.length < 6) colourMin.push(m);
  for (const k of ["lying", "eating", "resting", "moving"]) { const r = runsOf((m) => stateOf[m] === k)[0]; if (r) pickInto(colourMin, Math.floor((r.start + r.end) / 2), 6); }
  const visitRun = runsOf((m) => peopleSec[m] >= 10)[0];
  if (visitRun) pickInto(colourMin, Math.floor((visitRun.start + visitRun.end) / 2), 6);
  for (const m of ranked) pickInto(colourMin, m, 6);
  colourMin.sort((x, y) => x - y);
  async function shot(g, m, width) {
    if (!g) return null;
    const at0 = eyeTs[m] !== null ? [-1, 0, 1].map((x) => eyeTs[m] + x * 1000) : [15, 30, 45].map((x) => from + m * 60000 + x * 1000);
    const tries = (await Promise.all(at0.map(async (at) => ({ at, jpg: await g(at, width) })))).filter((t) => t.jpg);
    return tries.length ? tries.sort((x, y) => y.jpg.length - x.jpg.length)[0] : null;
  }
  const shots = async (g, mins, width) => {
    const out = [];
    for (let i = 0; i < mins.length; i += 4) {                          // a few ffmpeg at a time
      out.push(...(await Promise.all(mins.slice(i, i + 4).map(async (m) => {
        const f = await shot(g, m, width);
        return f && { m, at: f.at, img: toUri(f.jpg), aspect: jpegAspect(f.jpg) };
      }))).filter(Boolean));
    }
    return out;
  };
  const colourViews = await shots(grab, colourMin, 560);
  const heatViews = heatChosen.sort((x, y) => x.m - y.m).map((x) => ({ m: x.m, at: x.at, img: toUri(x.jpg), aspect: jpegAspect(x.jpg) }));

  const gallery = colourViews;                                     // (photo count, comparison)
  // The stall map's photo: the whole picture (its grid is the whole picture),
  // from a moment he stood still away from the squares he used most, all of
  // him in the photo — so the shading lies on the floor, not on him (2 Oct:
  // a photo of him lying on the most-used square read as a red blotch on the
  // horse). No such moment: the middle of the session.
  const [vx0, vy0, vx1, vy1] = mapCrop.map((v, i) => v * (i % 2 ? GY : GX));
  const inPhoto = (c) => {
    const x = c % GX, y = Math.floor(c / GX);
    return Math.max(0, Math.min(x + 1, vx1) - Math.max(x, vx0)) * Math.max(0, Math.min(y + 1, vy1) - Math.max(y, vy0)) >= 0.5;
  };
  const whereAt = new Array(minutes).fill(null);
  for (const r of tbR) if (r.meta?.where?.length) whereAt[minuteOf(r)] = r.meta.where;
  const cellsMax = Math.max(1, ...cells);
  const heatUnder = (m) => { const w = whereAt[m], n = w.reduce((x, [, v]) => x + v, 0); return w.reduce((x, [c, v]) => x + v * (cells[c] || 0), 0) / Math.max(1, n) / cellsMax; };
  const awayMins = Array.from({ length: minutes }, (_, m) => m).filter((m) => whereAt[m] && whereAt[m].every(([c]) => inPhoto(c))
    && ["resting", "eating"].includes(stateOf[m]) && !inLyingRev(from + m * 60000 + 30000) && perMin.unseen[m] <= 5 && peopleSec[m] < 5);
  const mapMin = awayMins.sort((x, y) => heatUnder(x) - heatUnder(y))[0] ?? colourMin[Math.floor(colourMin.length / 2)] ?? Math.floor(minutes / 2);
  const mapShot = budgetOk && grabFull ? await shot(grabFull, mapMin, 900) : null;
  // Where he spent most time, in words: the stall in thirds, as seen from the door.
  const cellsTot = cells.reduce((x, v) => x + v, 0);
  const thirds = {};
  cells.forEach((v, c) => {
    const row = Math.floor(c / GX), col = c % GX;
    const k = `${row < GY / 3 ? "back" : row < (2 * GY) / 3 ? "middle" : "front"} ${col < GX / 3 ? "left" : col < (2 * GX) / 3 ? "centre" : "right"}`;
    thirds[k] = (thirds[k] || 0) + v;
  });
  const topThird = Object.entries(thirds).sort((x, y) => y[1] - x[1])[0];
  const whereText = topThird && cellsTot
    ? `${name} spent most of the time at the ${topThird[0].replace("middle centre", "centre")} of the stall (${Math.round((topThird[1] / cellsTot) * 100)}% of the time seen).`
    : "";
  const colourCaption = (m) => {
    if (markOf.has(m)) return `${markOf.get(m)} · seen on the recording`;
    if (inLyingRev(from + m * 60000 + 30000)) return "Lying down · seen on the recording";
    const what = stateOf[m] ? STATE_WORD[stateOf[m]] : caption(m).replace(/^./, (c) => c.toUpperCase());
    return `${what}${peopleSec[m] >= 10 ? " · people at the stall" : ""}${stateOf[m] && act[m] !== null ? ` · ${LEVEL_WORD[levelOf(act[m])]}` : ""}`;
  };
  const heatCaption = (m) => {
    const r = respMin.get(m);
    const parts = [r ? `breathing ${Math.round(r.value)} /min, read in this minute` : null,
      eyeMin[m] !== null ? `eye ${f1(eyeMin[m])} °C` : null, stateOf[m] ? STATE_WORD[stateOf[m]].toLowerCase() : null].filter(Boolean);
    return (parts.join(" · ") || (act[m] !== null ? LEVEL_WORD[levelOf(act[m])] : "")).replace(/^./, (c) => c.toUpperCase());
  };

  // ---- words, from the numbers only ------------------------------------------ //
  const bodyLead = bodyV !== null
    ? `Body temperature was about ${f1(bodyV)} °C at ${clock(lastEyeMs)} — ${bodyState === "normal" ? `within ${name}'s usual range` : bodyState === "raised" ? `above ${name}'s usual range` : `a possible fever, well above ${name}'s usual range`}. `
    : bodyT?.learning ? `Body temperature will be given once ${name}'s own normal eye temperature is learned (${bodyT.days} of 3 days so far). ` : "";
  const tempShort = bodyLead + (eye.length >= 3
    ? (trend !== null && trend >= 0.5 ? `Eye-surface temperature rose by ${f1(trend)} °C during the session (median ${f1(eyeMed)} °C) — worth rechecking.`
      : `Eye-surface temperature was stable at around ${f1(eyeMed)} °C.`)
    : eye.length ? `Only ${plural(eye.length, "eye-temperature reading")} ${eye.length === 1 ? "was" : "were"} taken — the eye was mostly out of view.`
      : fromRec && lastLive ? `${REVIEW.split(". Eye temperature")[0]}. Temperature is measured during live monitoring${lastLive.date ? ` (${lastLive.date})` : ""}: ${lastLive.where} read ${f1(lastLive.median)} °C.`
      : fromRec ? REVIEW
        : "Eye temperature was not captured — the eye was not in view.");
  const tempLead = eye.length && anyRec
    ? `${tempShort} Eye temperature was taken during the live check (${span(checkedLive)}); the ${overnight ? "overnight " : ""}part (${span(reviewed)}) was recorded at the stable and reviewed minute by minute afterwards.`
    : tempShort;
  const actShort = actV.length ? `Activity was mostly ${dominant === "none" ? "very low, with long spells standing still" : LEVEL_WORD[dominant].replace(" activity", "")} (median index ${f2(med(actV))}).` : "Activity was not captured.";
  const viceNames = Object.keys(viceKinds);
  const viceShort = !actV.length ? "" : viceNames.length ? `${viceNames.map((k) => k[0].toUpperCase() + k.slice(1)).join(" and ")} ${viceNames.length > 1 ? "were" : "was"} flagged for review on the recording.`
    : "No stereotypic behaviour was detected.";
  const lead = `${name} was monitored for ${dur}${pausedMin ? ` (the session was paused ${pauseText}; that time is not counted)` : ""}, with data in ${Math.round((anyMin.size / liveMin) * 100)}% of the session. ${tempLead} ${actShort} ${viceShort}`.trim();

  const findings = [
    ["thermo", bodyV !== null ? `Body temperature ${f1(bodyV)} °C${bodyState === "normal" ? "" : bodyState === "raised" ? " · raised" : " · high"}`
      : eye.length >= 3 ? (trend !== null && trend >= 0.5 ? "Temperature rising" : "Temperature stable") : lastLive ? `Body temperature ${f1(lastLive.median)} °C` : fromRec ? "Eye temperature: live monitoring only" : thermal === false ? "Temperature: not on this camera" : "Temperature not captured",
      eye.length ? `${bodyV !== null ? `${name}'s usual range at that hour is ±${bodyT.within} °C. ` : ""}Eye-surface temperature ${f1(eyeMed)} °C median (range ${f1(eyeLo)}–${f1(eyeHi)} °C) across ${plural(eye.length, "reading")}, eye in view for ${eyeMinutes} of ${anyRec ? `${[...anyMin].filter(checkedLive).length} live` : minutes} minutes.`
        : lastLive ? `Measured during live monitoring at ${lastLive.where} (median of ${plural(lastLive.n, "reading")}).`
        : fromRec ? "Taken during live monitoring; not part of this review." : "The eye was not in view long enough to read."],
    ["move", actV.length ? `${dominant === "high" ? "Active" : dominant === "none" ? "Mostly resting" : "Settled"} behaviour` : "Activity not captured",
      actV.length ? `${bands.high} min high, ${bands.moderate} min moderate and ${bands.low} min low activity; ${stillMin} min ${lyingKnown ? "still (standing or lying)" : "standing still"}.` : "No movement data in this session."],
    ...(budgetOk ? [["check", "How the time was spent", tbShown.filter(([k]) => k !== "unseen" && tbTot[k] > 0)
      .map(([k, l]) => `${l.toLowerCase()} ${hmText(tbTot[k])}`).join(", ").replace(/^./, (c) => c.toUpperCase()) + "."]] : []),
    ["check", viceNames.length ? "Behaviour flagged for review" : "No stereotypic behaviour",
      viceNames.length ? viceNames.map((k) => `${k} at ${viceKinds[k].map(clock).join(", ")}`).join("; ") + " — check these moments on the recording."
        : actV.length ? "No weaving, box walking or rhythmic head tossing identified." : "Not assessed without movement data."],
  ];
  const observed = [
    eye.length && ["Temperature", eye.length >= 3
      ? `Eye-surface temperature stayed within ${f1(eyeLo)}–${f1(eyeHi)} °C (median ${f1(eyeMed)} °C)${trend === null ? "" : trend >= 0.5 ? `, rising by ${f1(trend)} °C from the first half of the session to the second` : trend <= -0.5 ? `, easing by ${f1(-trend)} °C through the session` : " with no upward trend"}.`
      : `${plural(eye.length, "reading")} (${eyeV.map(f1).join(", ")} °C) — too few to judge a trend.`],
    actV.length && ["Activity", `${plural(bands.high, "minute")} of high and ${bands.moderate} of moderate activity${busiest ? `; the most active period was ${busiest.label} (average ${f2(busiest.act)})` : ""}.`],
    actV.length && lyingRev.length && !lyingMeasured && ["Rest", `Lay down ${lyingRevText} (${hmText(lyingRevMin * 60)}, seen on the recording${lyingRevNote ? `; ${lyingRevNote}` : ""}); stood at rest for ${hmText(budgetOk ? tbTot.resting : stillMin * 60)}.`],
    actV.length && !(lyingRev.length && !lyingMeasured) && ["Rest", lyingMeasured ? `Lay down for ${lyingMin} min${posture.filter((r) => r.meta?.kind === "lie_down").length ? ` (${plural(posture.filter((r) => r.meta?.kind === "lie_down").length, "lie-down")})` : ""}; stood still for ${stillMin} min.`
      : spells.length ? `Standing rest in ${plural(spells.length, "spell")} (${spellText(spells.slice(0, 6))}${spells.length > 6 ? ", …" : ""}), ${stillMin} minutes in total.` : `${stillMin} minutes standing still, in short moments.`],
    resp.length && ["Breathing", `${f1(med(respV))} breaths per minute (median of ${plural(resp.length, "reading")})${regs.length ? `, ${med(regs) >= 0.75 ? "regular" : med(regs) >= 0.5 ? "slightly irregular" : "irregular"} rhythm` : ""}.`],
    actV.length && ["Stall behaviour", viceNames.length ? `${viceNames.join(" and ")} flagged (${vices.map((r) => clock(Date.parse(r.ts))).join(", ")}). A flag is a movement pattern, not a diagnosis — confirm it on the recording.`
      : "No rhythmic weaving, box walking or head tossing."],
    (floorEv.urination.length || floorEv.excretion.length) && ["Urination and manure", [floorEv.urination.length && `urination at ${floorEv.urination.map((r) => clock(Date.parse(r.ts))).join(", ")}`, floorEv.excretion.length && `manure at ${floorEv.excretion.map((r) => clock(Date.parse(r.ts))).join(", ")}`].filter(Boolean).join("; ").replace(/^./, (c) => c.toUpperCase()) + "."],
  ].filter(Boolean).slice(0, 5);
  const h0 = hourOf(from), h1 = hourOf(to);
  const night = (h) => h >= 20 || h < 7;
  const context = [
    ["Time of day", night(h0) && night(h1) ? "A night session: horses do most of their lying down and deep rest at night."
      : !night(h0) && !night(h1) ? "A daytime session: horses are usually more active by day and do most of their lying down at night."
        : "The session spans day and night; horses rest more after dark."],
    peopleSeen && ["Visits", visits.length
      ? `${autoVisits ? "People came to the stall" : "Seen on the recording: someone in the stall"} ${visits.length === 1 ? "once" : `${visits.length} times`} (${visits.slice(0, 5).map((v) => `${clock(from + v.start * 60000)}–${clock(from + (v.end + 1) * 60000)}`).join(", ")}${visits.length > 5 ? ", …" : ""}).${autoVisits ? ` Their movement is left out of ${name}'s activity.` : ""}`
      : "No one came to the stall during the session."],
    ["Individual baseline", `Horses vary; after about three days of monitoring, ${name}'s readings are compared with ${name}'s own normal rather than a general range.`],
  ].filter(Boolean);
  const notesText = String(notes || "").trim().slice(0, MAX_NOTES);
  const notSeen = [
    !eye.length && !lastLive && "temperature",
    !resp.length && "respiration",
    !lyingMeasured && !lyingRev.length && "lying pattern",
    !(floorOk && floorWatched === true) && "urination and excretion",
  ].filter(Boolean);

  // ---- points 9–12: the wearable and the stall's water / feed sensors ---------- //
  // "Not captured" + what it needs when the sensor never reported; "None" only
  // where it is known to be working (it reported within the 48 h before).
  const seenNear = (ms) => readings.some((r) => ms.includes(r.metric) && Date.parse(r.ts) <= to && Date.parse(r.ts) >= from - 48 * 3600000);
  const total = (rows) => rows.reduce((a, r) => a + r.value, 0);
  const kg = (g) => `${f1(g / 1000)} kg`;
  const nSteps = stepsTotal(of("steps")), exMin = Math.round(total(of("exercise_session")));
  const trots = of("lameness_result"), trot = trots.at(-1), gaitV = of("gait_asymmetry").map((r) => r.value);
  // A trot-up checked elsewhere (RealHorse, Sleip, a vet) and entered by hand:
  // the latest within 30 days before the session's end.
  const gaitCheck = readings.filter((r) => r.metric === "gait_check" && Date.parse(r.ts) <= to && to - Date.parse(r.ts) <= 30 * 86400000)
    .sort((a, b) => a.ts.localeCompare(b.ts)).at(-1) || null;
  const limb = LIMB_NAME[trot?.meta?.limb];
  const drinks = of("water_visit").length, waterIn = of("water_ml").length > 0 || drinks > 0;
  const waterSeen = seenNear(["water_ml", "water_visit", "water_refill"]);
  const meals = mealsOf(readings).filter((m) => { const t = Date.parse(m.at); return t >= from && t <= to; });
  const hayIn = of("hay_intake_g").length > 0, hayG = total(of("hay_intake_g"));
  const ateKnown = meals.some((m) => m.eatenG !== null) || hayIn;
  const offered = meals.reduce((a, m) => a + (m.offeredG ?? 0), 0), left = meals.reduce((a, m) => a + (leftOf(m) ?? 0), 0);
  const feederSeen = seenNear(["feed_offered_g", "feed_intake_g", "feed_refusal_g", "hay_intake_g", "feeder_fault"]);

  // ---- the 12 points ----------------------------------------------------------- //
  const S = { ok: ["ok", "✓", "Measured"], part: ["part", "◐", "Partly captured"], no: ["cam", "◌", "Not captured"],
    rev: ["ok", "✓", "Reviewed"], live: ["part", "◐", "Live only"], last: ["ok", "✓", "Measured"] };                             // a real reading; the note says it is the last live check
  const floorNote = floorWatched === false ? "The stall floor was not in view." : "Needs the stall floor in view.";
  const pointsAll = [
    !eye.length && lastLive
      ? [1, "Body temperature", S.last, `${f1(lastLive.median)} °C`, `Last live check${lastLive.date ? `, ${lastLive.date}` : ""}: median of ${plural(lastLive.n, "reading")} at ${lastLive.where}. This ${overnight ? "overnight " : ""}session was reviewed from video; temperature is read during live monitoring.`]
      : [1, "Body temperature", eye.length ? S.ok : fromRec ? S.live : S.no, bodyV !== null ? `${f1(bodyV)} °C` : eye.length ? `Eye ${f1(eyeMed)} °C` : fromRec ? "Live check" : "—", eye.length ? `${bodyV !== null ? `At ${clock(lastEyeMs)}, from the eye against ${name}'s own normal for that time of day (±${bodyT.within} °C). ` : bodyT?.learning ? `Learning ${name}'s normal (${bodyT.days} of 3 days). ` : ""}Eye surface ${f1(eyeMed)} °C median, ${plural(eye.length, "reading")} (${f1(eyeLo)}–${f1(eyeHi)} °C).${anyRec ? " Taken during the live check." : ""}` : fromRec ? "Taken during live monitoring; not part of this review." : thermal === false ? "This stall's camera has no thermal sensor." : "Needs the eye in view."],
    [2, "Respiration pattern", resp.length ? S.ok : S.no, resp.length ? (regs.length ? (med(regs) >= 0.75 ? "Regular" : "Irregular") : "Captured") : "—", resp.length ? `Rhythm from ${plural(resp.length, "reading")}.` : respNote],
    [3, "Respiratory rate", resp.length ? S.ok : S.no, resp.length ? `${f1(med(respV))} /min` : "—", resp.length ? `Range ${f1(Math.min(...respV))}–${f1(Math.max(...respV))} breaths per minute.` : "Same requirement as respiration pattern."],
    [4, "Activity", actV.length ? S.ok : S.no, actV.length ? f2(med(actV)) : "—", actV.length ? `Median activity index (0–1), measured in ${actV.length} of ${liveMin} minutes; ${plural(bands.high, "minute")} of high activity.` : "No movement data in this session."],
    !lyingMeasured && lyingRev.length
      ? [5, "Resting pattern", S.rev, `${hmText(lyingRevMin * 60)} lying`, `Seen lying down on the recording ${lyingRevText}${lyingRevNote ? ` (${lyingRevNote})` : ""}; standing rest ${hmText(budgetOk ? tbTot.resting : stillMin * 60)}.`]
      : [5, "Resting pattern", lyingMeasured ? S.ok : actV.length ? S.part : S.no, lyingMeasured ? `${lyingMin} min lying` : actV.length ? `${stillMin} min` : "—", lyingMeasured ? `Lying down ${lyingMin} min; standing still ${stillMin} min.` : actV.length ? "Standing rest. Lying down is measured when the horse's whole body is in view." : "No movement data in this session."],
    [6, "Stable vices", actV.length ? S.ok : S.no, actV.length ? (viceNames.length ? "Flagged" : "None") : "—", actV.length ? (viceNames.length ? `${viceNames.join(", ")} flagged for review on the recording.` : "No weaving, box walking or head tossing identified.") + " Crib-biting is not assessed." : "No movement data in this session."],
    [7, "Urination", floorOk && floorWatched === true ? S.ok : S.no, floorOk && floorWatched === true ? (floorEv.urination.length ? `${floorEv.urination.length} seen` : "None seen") : "—", floorOk && floorWatched === true ? "Wet patches on the bedding after the horse moved away." : floorNote],
    [8, "Excretion", floorOk && floorWatched === true ? S.ok : S.no, floorOk && floorWatched === true ? (floorEv.excretion.length ? `${floorEv.excretion.length} seen` : "None seen") : "—", floorOk && floorWatched === true ? "New manure on the bedding after the horse moved away." : floorNote],
    nSteps === null && !exMin && budgetOk
      ? [9, "Steps / locomotion", S.part, `${hmText(tbTot.moving)} moving`, `Time walking about the stall, from the video${moves ? `; changed place ${plural(moves, "time")}` : ""}. Steps are not counted.`]
      : [9, "Steps / locomotion", nSteps !== null || exMin ? S.ok : S.no, nSteps !== null ? nSteps.toLocaleString("en-GB") : exMin ? `${exMin} min` : "—",
      nSteps !== null ? `One leg's hoof strikes × 4${exMin ? `; exercise ${exMin} min` : ""}.` : exMin ? "Exercise time; no step counts." : "Not monitored in this session."],
    !trot && !gaitV.length && gaitCheck
      ? [10, "Lameness (trot)", S.ok, String(gaitCheck.meta?.grade ?? "checked").replace(/^./, (c) => c.toUpperCase()),
        `Trot-up checked with ${gaitCheck.meta?.tool ?? "a handheld tool"} on ${T({ day: "numeric", month: "short" }).format(Date.parse(gaitCheck.ts))}`
        + `${gaitCheck.meta?.limb ? `, ${LIMB_NAME[gaitCheck.meta.limb] ?? gaitCheck.meta.limb}` : ""}${gaitCheck.meta?.asymmetryMm !== null && gaitCheck.meta?.asymmetryMm !== undefined ? `, ${f1(gaitCheck.meta.asymmetryMm)} mm asymmetry` : ""}. Entered by the stable; a vet should confirm any lameness.`]
      : [10, "Lameness (trot)", trot || gaitV.length ? S.ok : S.no, trot ? `${f1(trot.value)} mm` : gaitV.length ? `${Math.round(med(gaitV) * 100)}%` : "—",
      trot ? `${limb ? `${limb[0].toUpperCase()}${limb.slice(1)} favoured` : "No limb singled out"} (${plural(trots.length, "trot")}). A screening measure; a vet should confirm.`
        : gaitV.length ? "Gait asymmetry index; a vet should confirm." : "Not monitored in this session."],
    [11, "Watering", waterIn || waterSeen ? S.ok : S.no, waterIn ? `${f1(total(of("water_ml")) / 1000)} L` : waterSeen ? "None" : "—",
      waterIn ? `${drinks ? plural(drinks, "drink") : "Drinking measured"}${of("water_refill").length ? "; refills not counted" : ""}.` : waterSeen ? "No drinking during the session." : "Not monitored in this session."],
    !(meals.length || hayIn || feederSeen) && budgetOk && hayKnown
      ? [12, "Feeding", S.part, hmText(tbTot.eating), "Time spent eating at the hay through the session. The amount eaten is not measured."]
      : [12, "Feeding", meals.length || hayIn || feederSeen ? S.ok : S.no,
      ateKnown ? `${kg(meals.reduce((a, m) => a + (m.eatenG ?? 0), 0) + hayG)}` : meals.length ? plural(meals.length, "meal") : feederSeen ? "None" : "—",
      meals.length ? `${plural(meals.length, "meal")}: offered ${kg(offered)}, left ${kg(left)}${hayIn ? `; hay ${kg(hayG)}` : ""}.`
        : hayIn ? `Hay ${kg(hayG)} eaten.` : feederSeen ? "No meal during the session." : "Not monitored in this session."],
  ];
  // A review of recorded video covers the camera's points (1–8) and what the
  // video adds to the others; a sensor point with nothing is left out of it.
  const points = anyRec ? pointsAll.filter((x) => x[0] <= 8 || x[2] !== S.no) : pointsAll;
  // Against the horse's own normal (server/baseline.mjs) — when there is one
  // and this session is not inside it.
  const baseRows = baseline && !baseline.learning && !baseline.sameAsBaseline
    ? baseline.rows.filter((r) => r.baseline !== null && r.recent !== null) : [];
  const dmy = (iso) => T({ day: "numeric", month: "short" }).format(Date.parse(iso));
  const baseWin = baseline?.window ? `${dmy(baseline.window.from)} – ${dmy(baseline.window.to)}${baseline.baselineDays ? ` (${plural(baseline.baselineDays, "day")})` : ""}${baseline.window.set ? ", chosen by the stable's vet" : ", its first days monitored"}` : "";
  const fmtBase = (r, v) => (v === null ? "—" : r.unit.startsWith("%") ? `${Math.round(v)}%` : r.key === "activity" ? v.toFixed(2)
    : r.key === "eye" ? `${v.toFixed(1)} °C` : r.key === "breathing" ? `${v.toFixed(1)} /min` : `${Math.round(v)} ${r.unit}`);
  const changeText = (r) => (r.change === null ? "—" : r.change === 0 ? "same"
    : `${r.change > 0 ? "▲" : "▼"} ${r.unit.startsWith("%") ? `${Math.abs(Math.round(r.change))} points` : r.key === "activity" ? Math.abs(r.change).toFixed(2) : `${Math.abs(r.change).toFixed(1)}${r.key === "eye" ? " °C" : r.key === "breathing" ? " /min" : ""}`}${r.pct !== null && !r.unit.startsWith("%") && r.key !== "eye" ? ` (${r.pct > 0 ? "+" : ""}${r.pct}%)` : ""}`);
  // For the owner: what to do for the horse. Setting up the equipment is not
  // the reader's business and is left out.
  const recs = [
    minutes >= 360
      ? `<b>Continue monitoring over several nights</b> to establish ${esc(name)}'s personal baseline; changes in temperature, breathing and activity are then flagged automatically.`
      : `<b>Run longer sessions, such as overnight,</b> to establish ${esc(name)}'s personal baseline; changes in temperature and activity are then flagged automatically.`,
    !eye.length && thermal !== false && `<b>Include a live monitoring period</b> to add eye temperature to ${esc(name)}'s record.`,
    !lyingMeasured && !lyingRev.length && actV.length && `<b>Continue overnight monitoring</b> so lying down can be reported: it is shown once ${esc(name)} has been seen both lying and standing in this stall.`,
  ].filter(Boolean).slice(0, 4);

  // ---- charts ------------------------------------------------------------------ //
  const W = 920, L = 52, R = 18;
  const X = (m) => L + (m / minutes) * (W - L - R);
  const tickMins = Array.from({ length: Math.floor(minutes / tick) + 1 }, (_, i) => i * tick);
  const ticks = (h, top = 0) => tickMins.map((m) => `<line x1="${X(m)}" x2="${X(m)}" y1="${top}" y2="${h}" class="grid"/><text x="${X(m)}" y="${h + 17}" class="tick" text-anchor="middle">${clock(from + m * 60000)}</text>`).join("");
  const markTimes = [
    ...vices.map((r) => [Date.parse(r.ts), `${(r.meta?.kind || "weaving").replace("_", " ")} flagged`]),
    ...posture.map((r) => [Date.parse(r.ts), { lie_down: "Lay down", get_up: "Got up", possible_roll: "Possible roll", possible_cast: "Possibly cast" }[r.meta?.kind] || "Posture change"]),
    ...floorEv.urination.map((r) => [Date.parse(r.ts), "Urination"]), ...floorEv.excretion.map((r) => [Date.parse(r.ts), "Manure"]),
  ];

  function timeline() {
    const lanes = [
      ["Monitored", (i) => anyB[i], "on"],
      ...(fromRec ? [] : [["Eye in view", (i) => eyeB[i], "on"]]),
      ...(anyRec && !fromRec ? [["Reviewed afterwards", (i) => recB[i], "on"]] : []),
      ...(peopleSeen ? [["People at the stall", (i) => peopleB[i], "hot"]] : []),
      ["Standing still", (i) => (stillB[i] ?? 0) >= 0.5, "on"],
      ["High activity", (i) => (actB[i] ?? 0) >= 0.6, "hot"],
    ];
    const lh = 46, H = lanes.length * lh, x0 = 150;
    const cw = (W - x0 - R) / nb;
    const body = lanes.map(([lname, fn, cls], li) => {
      const y = li * lh;
      const cells = Array.from({ length: nb }, (_, i) => fn(i)
        ? `<rect x="${x0 + i * cw}" y="${y + 10}" width="${cw + 0.6}" height="${lh - 20}" class="lane-${cls}" data-tip="${esc(lname)} · ${clock(from + i * bucket * 60000)}"/>` : "").join("");
      return `<text x="140" y="${y + lh / 2 + 4}" class="tick strong" text-anchor="end">${esc(lname)}</text><rect x="${x0}" y="${y + 10}" width="${W - x0 - R}" height="${lh - 20}" rx="4" class="lane-bg"/>${cells}`;
    }).join("");
    const xm = (ms) => x0 + ((ms - from) / 60000 / minutes) * (W - x0 - R);
    const tk = tickMins.map((m) => `<text x="${xm(from + m * 60000)}" y="${H + 16}" class="tick" text-anchor="middle">${clock(from + m * 60000)}</text>`).join("");
    const tm = markTimes.map(([t, what]) => `<g data-tip="${esc(what)} · ${clock(t)}"><path d="M${xm(t) - 6},-2 h12 l-6,10 z" class="turn"/></g>`).join("");
    const pz = paused.map(([a, b]) => { const xa = xm(Math.max(from, a)), xb = xm(Math.min(to, b));
      return `<rect x="${xa}" y="4" width="${Math.max(2, xb - xa)}" height="${H - 8}" class="paused"/><text x="${(xa + xb) / 2}" y="${H / 2 + 4}" class="tick strong" text-anchor="middle">paused</text>`; }).join("");
    return `<svg viewBox="0 -14 ${W} ${H + 36}" role="img" aria-label="Session timeline">${body}${pz}${tk}${tm}</svg>`;
  }

  function activityChart() {
    const H = 230, RG = 78, Wp = W - RG;
    const Xa = (i) => L + (i / nb) * (Wp - L);
    const bw = Math.max(1, (Wp - L) / nb - (nb > 60 ? 2 : 3)), y = (v) => H - v * H;
    const lvlName = Object.fromEntries(LEVELS.map(([k, n]) => [k, n]));
    const bandsSvg = [["high", 0.6, 1], ["moderate", 0.2, 0.6], ["low", 0.05, 0.2]].map(([k, lo, hi]) =>
      `<text x="${Wp + 12}" y="${(y(lo) + y(hi)) / 2 + 4}" class="lvl lvl-${k}">${lvlName[k]}</text>`).join("") +
      `<text x="${Wp + 12}" y="${H - 2}" class="lvl lvl-none">None</text>` +
      [0.2, 0.6].map((v) => `<line x1="${L}" x2="${Wp}" y1="${y(v)}" y2="${y(v)}" class="thr"/>`).join("");
    const grid = [0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => `<line x1="${L}" x2="${Wp}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 10}" y="${y(v) + 4}" class="tick" text-anchor="end">${v.toFixed(1)}</text>`).join("");
    const tk = tickMins.map((m) => `<text x="${L + (m / minutes) * (Wp - L)}" y="${H + 20}" class="tick" text-anchor="middle">${clock(from + m * 60000)}</text>`).join("");
    const bars = actB.map((v, i) => {
      const x0 = Xa(i) + 1.5, tip = `${clock(from + i * bucket * 60000)} · `;
      if (v === null) return `<rect x="${x0}" y="${H - 10}" width="${bw}" height="10" rx="2" class="nodata" data-tip="${tip}no reading"/>`;
      const k = levelOf(v);
      if (k === "none") return `<rect x="${x0}" y="${H - 4}" width="${bw}" height="4" rx="2" class="b-none" data-tip="${tip}no activity (${f2(v)})"/>`;
      const top = y(v), r = Math.min(5, bw / 2);
      return `<path d="M${x0},${H} V${top + r} q0,-${r} ${r},-${r} h${bw - 2 * r} q${r},0 ${r},${r} V${H} Z" class="b-${k}" data-tip="${tip}${lvlName[k].toLowerCase()} activity (${f2(v)})"/>`;
    }).join("");
    const pts = roll.map((v, i) => (v === null ? null : [Xa(i) + bw / 2 + 1.5, y(v), i, v])).filter(Boolean);
    let line = "";
    if (pts.length > 1) {
      let d = `M${pts[0][0]},${pts[0][1]}`;
      for (let i = 0; i < pts.length - 1; i++) {                            // Catmull-Rom as Bézier: a smooth average
        const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += ` C${c1[0].toFixed(1)},${Math.min(H, c1[1]).toFixed(1)} ${c2[0].toFixed(1)},${Math.min(H, c2[1]).toFixed(1)} ${p2[0]},${p2[1]}`;
      }
      const every = Math.max(1, Math.round(nb / 12));
      const markers = pts.filter((p) => p[2] % every === Math.floor(every / 2)).map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="5" class="avg-dot" data-tip="${clock(from + p[2] * bucket * 60000)} · ${avgLabel} ${f2(p[3])}"/>`).join("");
      line = `<path d="${d} L${pts.at(-1)[0]},${H} L${pts[0][0]},${H} Z" fill="url(#avgfill)"/><path d="${d}" class="avg-line"/>${markers}`;
    }
    return `<svg viewBox="0 -10 ${W} ${H + 36}" role="img" aria-label="Activity by level, with the ${avgLabel}">
<defs><linearGradient id="avgfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--avg)" stop-opacity=".28"/><stop offset="1" stop-color="var(--avg)" stop-opacity="0"/></linearGradient></defs>
${grid}${bandsSvg}${tk}${bars}${line}
<line x1="${L}" x2="${Wp}" y1="${H}" y2="${H}" class="axis"/></svg>`;
  }

  function tempChart() {
    const H = 250;
    if (!eye.length) return `<svg viewBox="0 -8 ${W} ${H + 34}" role="img" aria-label="No eye temperature"><rect x="${L}" y="0" width="${W - L - R}" height="${H}" rx="8" class="away"/><text x="${W / 2}" y="${H / 2}" class="lbl" text-anchor="middle">${fromRec ? "Eye temperature is taken during live monitoring — not part of this review" : thermal === false ? "No thermal camera on this stall" : "No eye-temperature readings in this session"}</text>${ticks(H)}</svg>`;
    const lo = Math.floor(eyeLo - 0.5), hi = Math.max(lo + 3, Math.ceil(eyeHi + 0.5));
    const y = (v) => H - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * H;
    const m = eyeMed, q1 = q(eyeV, 0.25), q3 = q(eyeV, 0.75);
    const steps = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    const grid = steps.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" class="tick" text-anchor="end">${v} °C</text>`).join("");
    const band = `<rect x="${L}" y="${y(q3)}" width="${W - L - R}" height="${Math.max(2, y(q1) - y(q3))}" class="iqr"/><line x1="${L}" x2="${W - R}" y1="${y(m)}" y2="${y(m)}" class="median"/><text x="${X(minutes * 0.78)}" y="${y(m) - 8}" class="lbl halo" text-anchor="middle">median ${f1(m)} °C</text>`;
    const dots = eye.map((r) => `<circle cx="${X((Date.parse(r.ts) - from) / 60000)}" cy="${y(r.value)}" r="5.5" class="dot" data-tip="${clock(Date.parse(r.ts))} · ${f1(r.value)} °C"/>`).join("");
    return `<svg viewBox="0 -8 ${W} ${H + 34}" role="img" aria-label="Eye temperature readings">${grid}${band}${ticks(H)}${dots}</svg>`;
  }

  function budgetBar() {
    const shown = tbShown.filter(([k]) => tbTot[k] > 0);
    const segs = shown.map(([k, label, cls]) => `<div class="tbs ${cls}" style="width:${((tbTot[k] / tbAll) * 100).toFixed(2)}%" data-tip="${esc(label)} · ${hmText(tbTot[k])}"><span>${Math.round((tbTot[k] / tbAll) * 100) >= 7 ? `${Math.round((tbTot[k] / tbAll) * 100)}%` : ""}</span></div>`).join("");
    return `<div class="tbbar">${segs}</div>`;
  }

  function budgetHours() {
    const binMin = minutes >= 180 ? 60 : 10;
    const nbins = Math.ceil(minutes / binMin);
    const bins = Array.from({ length: nbins }, () => Object.fromEntries(TB.map(([k]) => [k, 0])));
    for (let m = 0; m < minutes; m++) {
      const b = Math.min(nbins - 1, Math.floor(m / binMin));
      for (const [k] of TB) bins[b][k] += perMin[k][m];
    }
    const H = 150, bw = (W - L - R) / nbins;
    const bars = bins.map((b, i) => {
      const tot = TB.reduce((x, [k]) => x + b[k], 0);
      if (!tot) return `<rect x="${L + i * bw + 2}" y="${H - 6}" width="${Math.max(1, bw - 4)}" height="6" rx="2" class="nodata"/>`;
      let y = H;
      return TB.filter(([k]) => b[k] > 0).map(([k, label, cls]) => {
        const h = (b[k] / tot) * H;
        y -= h;
        return `<rect x="${L + i * bw + 2}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 4).toFixed(1)}" height="${h.toFixed(1)}" class="${cls}" data-tip="${clock(from + i * binMin * 60000)} · ${esc(label)} ${Math.round((b[k] / tot) * 100)}%"/>`;
      }).join("");
    }).join("");
    const every = nbins > 14 ? 2 : 1;
    const ticks = bins.map((_, i) => (i % every ? "" : `<text x="${L + i * bw + bw / 2}" y="${H + 16}" class="tick" text-anchor="middle">${clock(from + i * binMin * 60000)}</text>`)).join("");
    return `<svg viewBox="0 -6 ${W} ${H + 26}" role="img" aria-label="How the time was spent, ${binMin === 60 ? "hour by hour" : "every 10 minutes"}">${bars}${ticks}</svg>`;
  }

  function stallMap() {
    // Only squares mostly inside the photo are drawn (inPhoto): a square at
    // the very edge shows as a thin bright sliver that reads as a lamp (2 Oct:
    // the front row, where he lay down, is mostly below the photo's edge).
    // Light enough at the most-used square for the floor to show through.
    const max = Math.max(1, ...cells.filter((v, c) => inPhoto(c)));
    const rects = cells.map((v, c) => (v > 0 && inPhoto(c)
      ? `<rect x="${c % GX}" y="${Math.floor(c / GX)}" width="1" height="1" class="heatcell" fill-opacity="${(0.06 + 0.3 * (v / max)).toFixed(2)}" data-tip="${Math.round((v / Math.max(1, cellsTot)) * 100)}% of the time"/>` : "")).join("");
    const img = mapShot ? `<img src="${toUri(mapShot.jpg)}" alt="${esc(name)}'s stall">` : `<div class="nophoto">No photo of the stall in this session.</div>`;
    const [cx0, cy0, cx1, cy1] = mapCrop;                          // the photo is this part of the picture
    const vb = `${(cx0 * GX).toFixed(3)} ${(cy0 * GY).toFixed(3)} ${((cx1 - cx0) * GX).toFixed(3)} ${((cy1 - cy0) * GY).toFixed(3)}`;
    return `<div class="map">${img}<svg viewBox="${vb}" preserveAspectRatio="none" aria-label="Where ${esc(name)} stood">${rects}</svg></div>`
      + (mapShot ? `<div class="mapkey"><span>A little time</span><i></i><span>Most time</span><em>Photo: ${esc(clock(mapShot.at))}</em></div>` : "");
  }

  function distribution() {
    const tot = actV.length || 1;
    const seg = [["High", bands.high, "lv-high"], ["Moderate", bands.moderate, "lv-moderate"], ["Low", bands.low, "lv-low"], ["No activity", bands.none, "lv-none"]];
    const rects = seg.filter(([, v]) => v > 0).map(([n, v, c]) => `<div class="dseg ${c}" style="width:${(v / tot) * 100}%" data-tip="${n} · ${v} min (${Math.round((v / tot) * 100)}%)"></div>`).join("");
    return `<div class="dbar">${rects}</div><div class="dlegend">${seg.map(([n, v, c]) => `<span><i class="${c}"></i>${n} <b>${v} min</b> <em>${Math.round((v / tot) * 100)}%</em></span>`).join("")}</div>`;
  }

  // ---- page --------------------------------------------------------------------- //
  const icon = {
    thermo: '<path d="M10 3a2 2 0 0 1 4 0v10.3a4 4 0 1 1-4 0z"/><path d="M12 14v-5"/>',
    move: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5v.5"/>',
    note: '<path d="M4 4h16v12H8l-4 4z"/>',
  };
  const svgIcon = (k) => `<svg viewBox="0 0 24 24" class="ico" aria-hidden="true">${icon[k]}</svg>`;
  const day = T({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(from);
  const ymd = T({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(from)
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  const ref = `EQ-${String(horse.id).toUpperCase().replace(/[^A-Z0-9]/g, "")}-${ymd.year}${ymd.month}${ymd.day}${ymd.hour}${ymd.minute}`;
  const foot = (n) => `<div class="pfoot"><span>EquiCare · ${esc(name)} · Ref. ${ref}</span><span>Page ${n} of ${pages}</span></div>`;
  const rangeEnd = to > now ? now : to;
  // ---- this session in numbers (for a later session's comparison) ------------- //
  const summary = {
    date: T({ day: "numeric", month: "short", year: "numeric" }).format(from), times: `${clock(from)}–${clock(to)}`,
    minutes: liveMin, pausedMin, pauseText, coverage: anyMin.size,
    eye: { n: eye.length, median: eye.length ? eyeMed : null, lo: eyeLo, hi: eyeHi, minutes: eyeMinutes },
    resp: { n: resp.length, median: respV.length ? med(respV) : null },
    activity: actV.length ? { median: med(actV), ...bands } : null, still: stillMin, spells: spells.length,
    vices: viceNames, floor: floorOk && floorWatched === true ? { urination: floorEv.urination.length, excretion: floorEv.excretion.length } : null,
    points: points.slice(0, 8).filter((x) => x[2] !== S.no).map((x) => x[0]),
    pointNames: Object.fromEntries(points.slice(0, 8).map((x) => [x[0], x[1]])),
  };
  const pages = 5 + (heatViews.length ? 1 : 0) + (budgetOk ? 1 : 0) + (patternsOk ? 1 : 0) + (healthOk ? 1 : 0) + (previous ? 1 : 0);
  // Sections and pages are numbered as they are laid out: some appear only
  // when there is something to show.
  let secN = 0, pgN = 0;
  const sn = () => `<span class="n">${String(++secN).padStart(2, "0")}</span>`;
  const pg = () => foot(++pgN);
  const pic = (x, alt) => (x.thermal
    ? `<div class="pair"><img src="${x.img}" alt="${alt}, colour" style="flex:${(x.aspect || 1.33).toFixed(3)} 1 0"><img src="${x.thermal}" alt="${alt}, thermal" style="flex:${(x.tAspect || 1.25).toFixed(3)} 1 0"></div>`
    : `<img src="${x.img}" alt="${alt}">`);
  const paired = covers.some((c) => c.thermal) || gallery.some((g) => g.thermal);

  // ---- comparison with the previous session: the horse, not the equipment ------- //
  // For the owner or a prospective client: how the horse was in each session,
  // from each one's own measurements, with shares of the time (the sessions
  // can differ in length) and the time of day as context.
  function comparison() {
    const a = previous.summary, b = summary;
    const share = (n, of) => Math.round((n / Math.max(1, of)) * 100);
    const measured = (x) => (x.activity ? x.activity.high + x.activity.moderate + x.activity.low + x.activity.none : 0);
    const mix = (x) => (x.activity ? `${share(x.activity.high, measured(x))}% high · ${share(x.activity.moderate, measured(x))}% moderate · ${share(x.activity.low, measured(x))}% low · ${share(x.activity.none, measured(x))}% none` : "—");
    const eyeT = (x) => (x.eye.n ? `${f1(x.eye.median)} °C median (${f1(x.eye.lo)}–${f1(x.eye.hi)} °C)` : "Not captured");
    const floorT = (x) => (x.floor ? (x.floor.urination || x.floor.excretion ? `${x.floor.urination} urination, ${x.floor.excretion} manure` : "None seen") : "Not assessed");
    const rows = [
      ["Session", `${a.date} · ${a.times}`, `${b.date} · ${b.times}`],
      ["Monitored", plural(a.minutes, "minute"), plural(b.minutes, "minute")],
      ["Eye-surface temperature", eyeT(a), eyeT(b)],
      ["Respiratory rate", a.resp.n ? `${f1(a.resp.median)} /min` : "Not captured", b.resp.n ? `${f1(b.resp.median)} /min` : "Not captured"],
      ["Activity (median, 0–1)", a.activity ? f2(a.activity.median) : "—", b.activity ? f2(b.activity.median) : "—"],
      ["Time by activity level", mix(a), mix(b)],
      ["Standing rest", `${share(a.still, a.minutes)}% of the time (${a.still} min, ${plural(a.spells, "spell")})`, `${share(b.still, b.minutes)}% of the time (${b.still} min, ${plural(b.spells, "spell")})`],
      ["Stable vices", a.activity ? (a.vices.length ? a.vices.join(", ") : "None") : "—", b.activity ? (b.vices.length ? b.vices.join(", ") : "None") : "—"],
      ["Urination / manure", floorT(a), floorT(b)],
    ];
    const seen = [];
    if (a.activity && b.activity) {
      const d = b.activity.median - a.activity.median;
      const hiA = share(a.activity.high, measured(a)), hiB = share(b.activity.high, measured(b));
      seen.push(Math.abs(d) < 0.05
        ? `<b>Activity</b> was much the same as on ${esc(a.date)} (median ${f2(b.activity.median)} against ${f2(a.activity.median)}).`
        : `<b>${esc(name)} was ${d < 0 ? "calmer" : "more active"}</b> than on ${esc(a.date)}: median activity ${f2(b.activity.median)} against ${f2(a.activity.median)}, with high activity ${hiB}% of the time against ${hiA}%.`);
    }
    seen.push(`<b>Standing rest</b> took ${share(b.still, b.minutes)}% of the session against ${share(a.still, a.minutes)}% last time (${plural(b.spells, "spell")} against ${a.spells}).`);
    const vA = a.vices.length, vB = b.vices.length;
    seen.push(!vA && !vB ? "<b>No stereotypic behaviour</b> in either session: no weaving, box walking or head tossing."
      : `<b>Stable vices</b>: ${vA ? esc(a.vices.join(", ")) : "none"} on ${esc(a.date)}, ${vB ? esc(b.vices.join(", ")) : "none"} this session.`);
    if (a.eye.n && b.eye.n) {
      const d = b.eye.median - a.eye.median;
      seen.push(`<b>Eye-surface temperature</b> was ${Math.abs(d) < 0.3 ? "steady" : d > 0 ? `${f1(d)} °C higher` : `${f1(-d)} °C lower`} (median ${f1(b.eye.median)} °C against ${f1(a.eye.median)} °C).`);
    } else if (a.eye.n || b.eye.n) {
      const had = a.eye.n ? a : b, not = a.eye.n ? b : a;
      seen.push(`<b>Eye-surface temperature</b> was read on ${esc(had.date)} (${f1(had.eye.median)} °C median) but not on ${esc(not.date)}, so it cannot be compared this time.`);
    }
    if (b.floor && !a.floor) seen.push(`<b>Urination and manure</b>: ${b.floor.urination || b.floor.excretion ? `${b.floor.urination} urination and ${b.floor.excretion} manure seen` : "none seen"} this session; not assessed on ${esc(a.date)}.`);
    const context = `The sessions were at different times of day (${esc(a.times.split("–")[0])} and ${esc(b.times.split("–")[0])}) and of different length (${a.minutes} and ${b.minutes} minutes). Horses' activity and rest change through the day, so a difference between two short sessions describes those sessions rather than a trend; a trend needs a few days of monitoring.`;
    return `<div class="page">
<section class="card"><div class="sh">${sn()}<h2>${esc(name)} across sessions</h2></div><p class="sub">This session compared with ${esc(a.date)}, each from its own measurements. Shares are of the monitored time, as the sessions differ in length.</p>
<table class="cmp" style="margin-top:10px"><thead><tr><th>Measure</th><th>${esc(a.date)}</th><th>${esc(b.date)} · this session</th></tr></thead><tbody>
${rows.map(([k, x, y]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(x)}</td><td>${esc(y)}</td></tr>`).join("")}
</tbody></table></section>
<section class="card"><div class="sh">${sn()}<h2>What the comparison shows</h2></div>
<ul class="clist">${seen.map((x) => `<li>${x}</li>`).join("")}</ul>
<div class="note" style="margin-top:12px"><b>Context</b>${context}</div></section>
${pg()}</div>`;
  }

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} — Monitoring Session Report</title>
<style>
:root{color-scheme:light;--page:#eef0f3;--surface:#ffffff;--ink:#0f1720;--ink2:#46505c;--muted:#8a929c;--grid:#e7eaee;--ring:rgba(15,23,32,.08);
--lv-high:#184f95;--lv-mod:#3987e5;--lv-low:#9ec5f4;--lv-none:#c9cdd3;--avg:#e0822f;--navy:#0f2a47;--navy2:#1c4a78;--accent:#2a78d6;--accentSoft:rgba(42,120,214,.12);--alt:#9aa3ad;--hot:#e0822f;--ok:#0ca30c;--part:#d59a0d;--cam:#9aa3ad;--lanebg:#f0f2f5;}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;--page:#0b0d10;--surface:#15181c;--ink:#f3f5f7;--ink2:#c0c6cd;--grid:#262b31;--ring:rgba(255,255,255,.08);--accent:#3987e5;--accentSoft:rgba(57,135,229,.18);--lanebg:#1f2328;}}
:root[data-theme="dark"]{color-scheme:dark;--page:#0b0d10;--surface:#15181c;--ink:#f3f5f7;--ink2:#c0c6cd;--grid:#262b31;--ring:rgba(255,255,255,.08);--accent:#3987e5;--accentSoft:rgba(57,135,229,.18);--lanebg:#1f2328;}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:none;margin:0 auto;padding:24px 0 40px}
.cover{background:linear-gradient(135deg,var(--navy) 0%,var(--navy2) 100%);color:#fff;border-radius:22px;padding:30px 34px 88px;position:relative;overflow:hidden}
.cover:after{content:"";position:absolute;right:-80px;top:-80px;width:320px;height:320px;border-radius:50%;background:rgba(255,255,255,.06)}
.cover .top{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;letter-spacing:.12em;text-transform:uppercase;opacity:.85}
.logo{display:inline-flex;align-items:center;gap:10px;font-weight:700;letter-spacing:.06em}.logo i{width:26px;height:26px;border-radius:8px;background:#fff;display:inline-grid;place-items:center;color:var(--navy);font-style:normal;font-size:14px}
.cover h1{font-size:40px;line-height:1.1;margin:26px 0 6px;letter-spacing:-.02em;font-weight:700}.cover h1 span{font-weight:400;opacity:.7}
.cover .meta{display:flex;flex-wrap:wrap;gap:8px 26px;font-size:14px;opacity:.9;margin-top:10px}.cover .meta b{font-weight:600}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:-60px 20px 0;position:relative;z-index:1}
.kpi{background:var(--surface);border-radius:16px;padding:16px 18px;box-shadow:0 10px 30px rgba(15,23,32,.10);border:1px solid var(--ring)}
.kpi b{display:block;font-size:28px;line-height:1.15;letter-spacing:-.01em}.kpi span{font-size:12.5px;color:var(--ink2)}.kpi small{display:block;font-size:11.5px;color:var(--muted);margin-top:2px}
section.card{background:var(--surface);border:1px solid var(--ring);border-radius:18px;padding:26px 28px;margin-top:18px}
.sh{display:flex;align-items:baseline;gap:12px;margin-bottom:4px}.sh .n{font-size:12px;font-weight:700;color:var(--accent);letter-spacing:.08em}.sh h2{font-size:20px;margin:0;letter-spacing:-.01em}
.sub{color:var(--ink2);margin:4px 0 0;font-size:14px}
.exec{display:grid;grid-template-columns:1.15fr 1fr;gap:26px;align-items:start}
.exec p.lead{font-size:16px;margin:10px 0 18px}
.find{display:flex;gap:14px;padding:12px 0;border-top:1px solid var(--grid)}.find:first-of-type{border-top:0}
.ico{width:22px;height:22px;flex:none;stroke:var(--accent);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;margin-top:2px}
.find b{display:block}.find span{color:var(--ink2);font-size:14px}
.gal{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-top:14px}.gal figure{margin:0}.gal img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;display:block}
.gal figcaption{font-size:12px;color:var(--ink2);margin-top:6px;line-height:1.35}
.pair{display:flex;gap:4px;align-items:flex-start}.pair img{min-width:0;width:100%;height:auto;aspect-ratio:auto!important;object-fit:contain!important;border-radius:10px}
.gal.pairs,.page .gal.pairs{grid-template-columns:repeat(2,1fr)}
table.cmp td{vertical-align:top}table.cmp td:first-child{white-space:nowrap}
.clist{margin:6px 0 0;padding-left:18px;font-size:12px;line-height:1.45;color:var(--ink2)}.clist li{margin:5px 0}.clist b{color:var(--ink)}.gal figcaption b{display:block;color:var(--ink);font-variant-numeric:tabular-nums}
.obs{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:10px}.obs h3{font-size:13px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:6px 0 4px}
.note{margin-top:14px;background:var(--lanebg);border-radius:12px;padding:12px 14px;font-size:13.5px;color:var(--ink2)}.note b{display:block;color:var(--ink);margin-bottom:2px}
.photo{margin:0;border-radius:14px;overflow:hidden;position:relative;display:flex;flex-direction:column}.photo img{width:100%;display:block;aspect-ratio:4/3;object-fit:cover}
.photos{display:flex;flex-direction:column;gap:10px}.photo figcaption{font-size:11px;margin-top:5px}.photo img{border-radius:12px}
.details{margin-top:10px;background:var(--lanebg);border-radius:12px;padding:10px 14px}.details h3{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:0 0 6px}
.details dl{display:grid;grid-template-columns:auto 1fr;gap:5px 16px;margin:0;font-size:11.5px}.details dt{color:var(--muted)}.details dd{margin:0;font-weight:600}
.photo figcaption{font-size:12.5px;color:var(--muted);margin-top:8px}
table{border-collapse:collapse;width:100%;font-size:14px}th{font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:600;text-align:left;padding:10px 12px;border-bottom:1px solid var(--grid)}
td{padding:13px 12px;border-bottom:1px solid var(--grid);vertical-align:top}td.num{font-variant-numeric:tabular-nums;white-space:nowrap}tbody tr:last-child td{border-bottom:0}
.pt-name{font-weight:600;white-space:nowrap}.pt-name small{display:block;color:var(--muted);font-weight:500;font-size:11.5px}.pt-note{color:var(--ink2);font-size:13.5px}.pt-val{font-size:18px;font-weight:650;white-space:nowrap}
.st{display:inline-flex;gap:7px;align-items:center;font-size:12px;font-weight:600;white-space:nowrap;padding:4px 10px;border-radius:999px;background:var(--lanebg)}
.st i{font-style:normal;display:inline-grid;place-items:center;width:17px;height:17px;border-radius:50%;color:#fff;font-size:11px}
.st.ok i{background:var(--ok)}.st.part i{background:var(--part)}.st.cam i{background:var(--cam)}
svg{width:100%;height:auto;display:block;overflow:visible}.grid{stroke:var(--grid)}.tick{fill:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}.tick.strong{fill:var(--ink2);font-size:12.5px}
.lbl{fill:var(--ink2);font-size:12px}.zlabel{fill:var(--muted);font-size:11px}.halo{paint-order:stroke;stroke:var(--surface);stroke-width:4px;stroke-linejoin:round}
.bar{fill:var(--accent)}.trend{fill:none;stroke:var(--ink);stroke-width:2;stroke-linejoin:round;opacity:.7}.zone-hi{fill:var(--accentSoft);opacity:.6}
.dot{fill:var(--accent);stroke:var(--surface);stroke-width:2}.iqr{fill:var(--accentSoft)}.median{stroke:var(--ink2);stroke-width:1.5;stroke-dasharray:5 4}.away{fill:var(--lanebg)}.paused{fill:var(--surface);stroke:var(--grid);stroke-dasharray:4 3;opacity:.92}
.lane-bg{fill:var(--lanebg)}.lane-on{fill:var(--accent)}.lane-alt{fill:var(--alt);opacity:.55}.lane-hot{fill:var(--hot)}.turn{fill:var(--hot);stroke:var(--surface);stroke-width:1.5}
.legend{display:flex;flex-wrap:wrap;gap:18px;font-size:12.5px;color:var(--ink2);margin-top:12px}.legend span{display:inline-flex;align-items:center;gap:7px}
.sw{display:inline-block;width:12px;height:12px;border-radius:3px}.sw.bar{background:var(--accent)}.sw.line{height:2px;width:18px;background:var(--ink);opacity:.7;border-radius:0}.sw.dot{border-radius:50%;background:var(--accent)}.sw.iqr{background:var(--accentSoft)}.sw.hot{background:var(--hot)}.sw.alt{background:var(--alt);opacity:.55}
.dbar{display:flex;height:24px;border-radius:8px;overflow:hidden;gap:2px;margin-top:12px}.dseg{height:100%}
.lv-high{background:var(--lv-high)}.lv-moderate{background:var(--lv-mod)}.lv-low{background:var(--lv-low)}.lv-none{background:var(--lv-none)}
.b-high{fill:var(--lv-high);opacity:.9}.b-moderate{fill:var(--lv-mod);opacity:.85}.b-low{fill:var(--lv-low);opacity:.95}.b-none{fill:var(--lv-none)}
.nodata{fill:none;stroke:var(--lv-none);stroke-dasharray:2 2}.thr{stroke:var(--muted);stroke-width:1;stroke-dasharray:4 4;opacity:.6}.axis{stroke:var(--grid);stroke-width:1.5}
.lvl{font-size:11.5px;font-weight:600}.lvl-high{fill:var(--lv-high)}.lvl-moderate{fill:var(--lv-mod)}.lvl-low{fill:#6b9fd8}.lvl-none{fill:var(--muted)}
.avg-line{fill:none;stroke:var(--avg);stroke-width:2.5;stroke-linecap:round}.avg-dot{fill:var(--surface);stroke:var(--avg);stroke-width:2.5}
.sw.avgkey{width:22px;height:10px;background:linear-gradient(var(--avg),var(--avg)) center/100% 2.5px no-repeat;position:relative}.sw.avgkey:after{content:"";position:absolute;left:7px;top:1px;width:8px;height:8px;border-radius:50%;border:2.5px solid var(--avg);background:var(--surface);box-sizing:border-box}
.dlegend{display:flex;flex-wrap:wrap;gap:20px;margin-top:10px;font-size:13px;color:var(--ink2)}.dlegend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}.dlegend em{color:var(--muted);font-style:normal;margin-left:4px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px}.stat{background:var(--lanebg);border-radius:12px;padding:12px 14px}.stat b{display:block;font-size:21px;letter-spacing:-.01em}.stat span{font-size:12px;color:var(--ink2)}
.fig{font-size:11.5px;color:var(--muted);margin-top:10px;letter-spacing:.02em}
.rec{counter-reset:r;list-style:none;padding:0;margin:12px 0 0}.rec li{counter-increment:r;display:flex;gap:14px;padding:12px 0;border-top:1px solid var(--grid)}.rec li:first-child{border-top:0}
.rec li:before{content:counter(r);flex:none;width:26px;height:26px;border-radius:50%;background:var(--accentSoft);color:var(--accent);font-weight:700;font-size:13px;display:grid;place-items:center}
.page{width:210mm;min-height:297mm;margin:0 auto 18px;padding:9mm 9mm 7mm;background:var(--page);display:flex;flex-direction:column;box-shadow:0 8px 30px rgba(15,23,32,.12);border-radius:4px}
.page>section.card:last-of-type{flex:1}.page>section.card{margin-top:4.5mm}.page.p1>section.card{margin-top:5mm}
.pfoot{display:flex;justify-content:space-between;font-size:10px;color:var(--muted);padding:3.5mm 1mm 0;letter-spacing:.02em}
.about{display:grid;grid-template-columns:1fr 1fr;gap:10px 22px;margin-top:10px}.about div{border-top:1px solid var(--grid);padding-top:8px}.about b{display:block;font-size:12.5px}.about span{font-size:11.5px;color:var(--ink2)}
.foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;color:var(--muted);font-size:12px;margin-top:22px;padding:0 6px}
#tip{position:fixed;pointer-events:none;background:var(--surface);color:var(--ink);border:1px solid var(--ring);box-shadow:0 6px 20px rgba(0,0,0,.15);border-radius:8px;padding:6px 10px;font-size:12.5px;display:none;z-index:9}
tr.dim td{color:var(--muted)}
@page{size:A4;margin:0}
.page{font-size:12px;line-height:1.5}.page .cover{padding:20px 24px 64px;border-radius:14px}.page .cover h1{font-size:30px;margin-top:16px}.page .cover .meta{font-size:11.5px}
.page .kpis{grid-template-columns:repeat(4,1fr);margin:-46px 14px 0;gap:10px}.page .kpi{padding:10px 12px}.page .kpi b{font-size:21px}.page .kpi span{font-size:11px}.page .kpi small{font-size:10px}
.page section.card{padding:14px 16px;border-radius:12px}.page .sh h2{font-size:15.5px}.page .sub{font-size:11.5px}
.page .exec,.page .obs{grid-template-columns:1.15fr 1fr;gap:16px}.page .exec p.lead{font-size:12.5px;margin:6px 0 8px}.page .find{padding:6px 0}.page .find b{font-size:12px}.page .find span{font-size:11px}
.page .stats{grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}.page .stat{padding:8px 10px}.page .stat b{font-size:15px}.page .stat span{font-size:10.5px}
.page table{font-size:11px}.page td{padding:6px 8px}.page table.pts td{padding:5px 8px}.page .pts .pt-name small{font-size:10px;line-height:1.25}.page th{padding:5px 8px;font-size:10px}.page .pt-val{font-size:13px}.page .pt-note{font-size:10.5px}
.page .legend,.page .dlegend{font-size:10.5px;gap:12px}.page .rec li{padding:6px 0;font-size:11.5px}.page .gal{grid-template-columns:repeat(5,1fr);gap:8px;margin-top:10px}.page .gal figcaption{font-size:9.5px}.page .fig{font-size:10px;margin-top:6px}
.page .note{font-size:11px;padding:9px 11px}.page .obs h3{font-size:11px}
@media (max-width:820px){.gal{grid-template-columns:repeat(2,1fr)}.exec,.obs{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr);margin:-56px 10px 0}.stats{grid-template-columns:repeat(2,1fr)}.cover h1{font-size:30px}.cover{padding:24px 22px 80px}}
@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}html,body{background:var(--page)}main{padding:0}#tip{display:none!important}
.page{margin:0;box-shadow:none;border-radius:0;height:297mm;min-height:0;overflow:hidden;break-after:page}.page:last-child{break-after:auto}}
.toolbar{position:sticky;top:0;z-index:5;display:flex;gap:12px;align-items:center;justify-content:center;padding:10px 16px;background:var(--page);font-size:13px;color:var(--ink2)}
.toolbar button{font:inherit;font-weight:600;background:var(--accent);color:#fff;border:0;border-radius:10px;padding:8px 16px;cursor:pointer}
.nophoto{display:grid;place-items:center;aspect-ratio:4/3;border-radius:12px;background:var(--lanebg);color:var(--muted);font-size:12px;text-align:center;padding:12px}
.notes p{margin:0 0 6px;color:var(--ink2);font-size:14px;white-space:pre-line}.page .notes p{font-size:11px}
.photo img,.gal img{aspect-ratio:auto;object-fit:contain}.gal,.page .gal{grid-template-columns:repeat(3,1fr)}.page .gal figcaption{font-size:10px}
@media print{.no-print{display:none!important}}
.tb-lie{fill:#7c5cff;background:#7c5cff}.tb-eat{fill:#2f9e44;background:#2f9e44}.tb-rest{fill:#4dabf7;background:#4dabf7}.tb-move{fill:#f08c00;background:#f08c00}.tb-out{fill:#ced4da;background:#ced4da}
.tbbar{display:flex;height:34px;border-radius:9px;overflow:hidden;margin-top:12px}.tbs{display:flex;align-items:center;justify-content:center;color:#fff;font-size:11.5px;font-weight:600}.tbs.tb-out{color:var(--ink2)}
.map{position:relative;margin-top:10px;overflow:hidden;border-radius:10px}.map img{width:100%;display:block}.map svg{position:absolute;inset:0;width:100%;height:100%;overflow:hidden}.heatcell{fill:#ff3d00}
.mapkey{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11px;color:var(--ink2)}.mapkey i{width:120px;height:9px;border-radius:5px;background:linear-gradient(90deg,rgba(255,61,0,.06),rgba(255,61,0,.36));border:1px solid var(--grid)}.mapkey em{margin-left:auto;font-style:normal;color:var(--muted)}
.gal.heat,.page .gal.heat{grid-template-columns:repeat(2,1fr);gap:12px}.gal.heat figcaption{font-size:10.5px}
</style></head><body><main>
<div class="toolbar no-print"><button type="button" onclick="window.print()">Save as PDF</button><span>In the print window choose “Save as PDF”.</span></div>
<div class="page p1">
<header class="cover">
<div class="top"><span class="logo"><i>E</i>EquiCare</span><span>Monitoring session report</span></div>
<h1>${esc(name)} <span>· Stall ${esc(horse.stall || "—")}</span></h1>
<div class="meta"><span><b>Date</b> ${day}</span><span><b>Session</b> ${clock(from)}–${clock(rangeEnd)} ${esc(tzName)} (${dur})</span><span><b>Ref.</b> ${ref}</span>${client ? `<span><b>Prepared for</b> ${esc(client)}</span>` : ""}</div>
</header>
<div class="kpis">
<div class="kpi"><b>${bodyV !== null ? `${f1(bodyV)} °C` : eye.length ? `${f1(eyeMed)} °C` : lastLive ? `${f1(lastLive.median)} °C` : "—"}</b><span>${bodyV !== null ? "Body temperature" : eye.length ? "Eye temperature" : lastLive ? "Temperature" : "Eye temperature"}</span><small>${bodyV !== null ? `eye ${f1(eyeMed)} °C · ${plural(eye.length, "reading")}` : eye.length ? `median · ${plural(eye.length, "reading")}` : lastLive ? `measured${lastLive.date ? `, ${lastLive.date}` : ""}` : fromRec ? "live monitoring only" : "eye not in view"}</small></div>
<div class="kpi"><b>${f2(med(actV))}</b><span>Activity index</span><small>median · scale 0–1</small></div>
<div class="kpi"><b>${lyingMeasured ? `${lyingMin} min` : lyingRev.length ? hmText(lyingRevMin * 60) : `${stillMin} min`}</b><span>${lyingMeasured || lyingRev.length ? "Lying down" : "Standing rest"}</span><small>${!lyingMeasured && lyingRev.length ? "seen on the recording" : `of ${dur}`}</small></div>
<div class="kpi"><b>${Math.round((anyMin.size / liveMin) * 100)}%</b><span>Monitoring coverage</span><small>${anyMin.size} of ${liveMin} minutes</small></div>
</div>

<section class="card"><div class="exec"><div>
<div class="sh">${sn()}<h2>Executive summary</h2></div>
<p class="lead">${esc(lead)}</p>
${findings.map(([k, t, d]) => `<div class="find">${svgIcon(k)}<div><b>${esc(t)}</b><span>${esc(d)}</span></div></div>`).join("")}
<div class="details"><h3>Session details</h3><dl>
${client ? `<dt>Prepared for</dt><dd>${esc(client)}</dd>` : ""}<dt>Horse</dt><dd>${esc(name)}</dd><dt>Stall</dt><dd>${esc(horse.stall || "—")}</dd>
<dt>Date</dt><dd>${T({ day: "numeric", month: "short", year: "numeric" }).format(from)}</dd><dt>Session</dt><dd>${clock(from)}–${clock(rangeEnd)} ${esc(tzName)}</dd>
<dt>Coverage</dt><dd>${anyMin.size} of ${liveMin} min${pausedMin ? ` (paused ${pauseText})` : ""}</dd>
<dt>Readings</dt><dd>${nReadings}</dd><dt>Video recorded</dt><dd>${clipCount ? plural(clipCount, "clip") : "none"}</dd>
</dl></div>
</div>
<div class="photos">${covers.length ? covers.map((c) => `<figure class="photo">${pic(c, `${esc(name)} at ${clock(c.at)}`)}<figcaption>${clock(c.at)} · ${esc(caption(c.m))}</figcaption></figure>`).join("")
  : `<div class="nophoto">No video was recorded in this session.</div>`}</div>
</div></section>
${pg()}</div>
<div class="page">
<section class="card"><div class="sh">${sn()}<h2>Behaviour and wellbeing observations</h2></div><p class="sub">What was measured during the session${notesText ? ", and notes from the stable" : ""}.</p>
<div class="obs">
<div><h3>Observed</h3>${observed.length ? observed.map(([t, d]) => `<div class="find">${svgIcon("check")}<div><b>${esc(t)}</b><span>${esc(d)}</span></div></div>`).join("") : `<p class="sub">Nothing was measured in this window.</p>`}</div>
<div>${notesText ? `<h3>Notes from the stable</h3><div class="find">${svgIcon("note")}<div class="notes">${notesText.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join("")}</div></div>` : ""}
<h3>Context</h3>${context.slice(0, notesText ? 1 : 2).map(([t, d]) => `<div class="find">${svgIcon("info")}<div><b>${esc(t)}</b><span>${esc(d)}</span></div></div>`).join("")}
${notSeen.length ? `<div class="note"><b>Not captured this session</b>${esc(notSeen.join(", ").replace(/^./, (c) => c.toUpperCase()))} — see the monitoring points and recommendations.</div>` : ""}</div>
</div></section>

<section class="card"><div class="sh">${sn()}<h2>Colour views</h2></div><p class="sub">${colourViews.length ? `${plural(colourViews.length, "moment")} from the session, chosen to show what ${esc(name)} was doing, in time order.` : "No video was recorded in this session."}</p>
<div class="gal">${colourViews.map((g) => `<figure><img src="${g.img}" alt="${esc(name)} at ${clock(g.at)}"><figcaption><b>${clock(g.at)}</b>${esc(colourCaption(g.m))}</figcaption></figure>`).join("")}</div></section>
${pg()}</div>
${heatViews.length ? `<div class="page">
<section class="card"><div class="sh">${sn()}<h2>Heat views</h2></div><p class="sub">Warmer areas show brighter: the heat image shows where ${esc(name)}'s warm body is${eye.length ? " and where the eye was read" : ""}. Breathing is read from the rise and fall of warmth at the nostril and from the movement of the flank. ${plural(heatViews.length, "moment")}, chosen for what they show.</p>
<div class="gal heat">${heatViews.map((g) => `<figure><img src="${g.img}" alt="Heat image of ${esc(name)} at ${clock(g.at)}"><figcaption><b>${clock(g.at)}</b>${esc(heatCaption(g.m))}</figcaption></figure>`).join("")}</div></section>
${pg()}</div>` : ""}
<div class="page">
<section class="card"><div class="sh">${sn()}<h2>Monitoring points</h2></div><p class="sub">Results for the ${points.length === 12 ? "twelve " : ""}monitoring points.</p>
<table class="pts" style="margin-top:10px"><thead><tr><th>Monitoring point</th><th>Result</th><th>Status</th><th>Notes</th></tr></thead><tbody>
${points.map(([n, pname, st, val, note]) => `<tr><td class="pt-name">${esc(pname)}<small>Point ${n}</small></td><td class="pt-val">${esc(val)}</td><td><span class="st ${st[0]}"><i>${st[1]}</i>${st[2]}</span></td><td class="pt-note">${esc(note)}</td></tr>`).join("")}
</tbody></table></section>

<section class="card"><div class="sh">${sn()}<h2>Session timeline</h2></div><p class="sub">${bucket === 1 ? "Minute-by-minute" : `${bucket}-minute`} view of monitoring, ${fromRec ? "" : "eye in view, "}rest and activity.${markTimes.length ? " ▼ marks an event to review on the recording." : ""}</p>
<div style="margin-top:14px">${timeline()}</div>
<div class="legend"><span><i class="sw bar"></i>present</span><span><i class="sw hot"></i>high activity${markTimes.length ? " / event" : ""}</span></div>
<p class="fig">Figure 1 · Session timeline</p></section>
${pg()}</div>
<div class="page">
<section class="card"><div class="sh">${sn()}<h2>Activity</h2></div><p class="sub">Each bar is ${bucket === 1 ? "one minute" : `${bucket} minutes`}, coloured by activity level (activity index 0 = still, 1 = very active); the line is the ${avgLabel}.</p>
<div style="margin-top:14px">${activityChart()}</div>
<div class="legend"><span><i class="sw lv-high"></i>High (0.6+)</span><span><i class="sw lv-moderate"></i>Moderate (0.2–0.6)</span><span><i class="sw lv-low"></i>Low (0.05–0.2)</span><span><i class="sw lv-none"></i>No activity</span><span><i class="sw avgkey"></i>${avgLabel.replace(/^./, (c) => c.toUpperCase())}</span></div>
<p class="fig">Figure 2 · Activity${bucket === 1 ? " per minute" : ""}</p>
<h3 style="margin:22px 0 0;font-size:15px">Time by activity level</h3>${distribution()}
<div class="stats"><div class="stat"><b>${bands.high} min</b><span>high activity</span></div><div class="stat"><b>${bands.moderate} min</b><span>moderate activity</span></div><div class="stat"><b>${bands.low + bands.none} min</b><span>low or no activity</span></div><div class="stat"><b>${lyingMeasured ? `${lyingMin} min` : `${stillMin} min`}</b><span>${lyingMeasured ? "lying down" : lyingKnown ? "still, standing or lying" : "standing still"}</span></div></div>
<p class="sub" style="margin-top:14px">${esc((spells.length ? `Rest came in ${plural(spells.length, "spell")}${spells.length <= 6 ? `: ${spellText(spells)}` : ""}. ` : actV.length ? "No sustained rest spells. " : "") + (busiest ? `The most active period was ${busiest.label} (average ${f2(busiest.act)}).` : ""))}</p></section>

${fromRec ? "" : `<section class="card"><div class="sh">${sn()}<h2>Eye temperature</h2></div><p class="sub">Readings taken with the eye in view. Each reading is compared with ${esc(name)}'s own normal eye temperature for that time of day; the body temperature in this report comes from that difference.</p>
<div style="margin-top:14px">${tempChart()}</div>
<div class="legend"><span><i class="sw dot"></i>reading</span><span><i class="sw iqr"></i>middle 50% of readings</span><span>— — median</span></div>
<p class="fig">Figure 3 · Eye temperature</p>
<div class="stats"><div class="stat"><b>${eye.length ? `${f1(eyeMed)} °C` : "—"}</b><span>median</span></div><div class="stat"><b>${eye.length ? `${f1(eyeLo)}–${f1(eyeHi)} °C` : "—"}</b><span>range</span></div><div class="stat"><b>${eye.length}</b><span>readings</span></div><div class="stat"><b>${eyeMinutes} min</b><span>eye in view</span></div></div></section>`}
${pg()}</div>
${budgetOk ? `<div class="page">
<section class="card"><div class="sh">${sn()}<h2>How the time was spent</h2></div><p class="sub">Each second of the session, from the video: ${tbShown.filter(([kk]) => kk !== "unseen").map(([, l]) => l.toLowerCase()).join(", ")}.${lyingMeasured ? "" : lyingRev.length ? ` Lying down as seen on the recording (${esc(lyingRevText)}).` : ` Lying down is shown once ${esc(name)} has been seen both lying and standing in this stall; until then, time lying counts as rest.`}</p>
${budgetBar()}
<div class="stats">${tbShown.filter(([kk]) => kk !== "unseen").slice(0, 4).map(([kk, l]) => `<div class="stat"><b>${hmText(tbTot[kk])}</b><span>${esc(l.toLowerCase())}</span></div>`).join("")}</div>
<h3 style="margin:18px 0 0;font-size:14px">${minutes >= 180 ? "Hour by hour" : "Every 10 minutes"}</h3>${budgetHours()}
<div class="legend">${tbShown.map(([, l, c]) => `<span><i class="sw ${c}"></i>${esc(l)}</span>`).join("")}</div></section>
<section class="card"><div class="sh">${sn()}<h2>Where ${esc(name)} spent the time</h2></div><p class="sub">${esc(whereText)} Darker squares: where ${esc(name)}'s hooves were for longer, seen from the stall door.</p>
${stallMap()}</section>
${pg()}</div>` : ""}
${patternsOk ? `<div class="page">
<section class="card"><div class="sh">${sn()}<h2>Patterns through the ${overnight ? "night" : "session"}</h2></div><p class="sub">How ${esc(name)}'s ${overnight ? "night" : "session"} went, from the measurements, in time order.</p>
<div class="obs"><div><h3>${overnight ? "The night" : "The session"} at a glance</h3>
${phaseText.map((x) => `<div class="find">${svgIcon("info")}<div><b>${esc(x.when)}</b><span>${esc(x.text.replace(/^./, (c) => c.toUpperCase()))}.</span></div></div>`).join("")}
${quietest && busiestHour && quietest !== busiestHour ? `<div class="find">${svgIcon("check")}<div><b>Quietest and busiest hours</b><span>Quietest from ${esc(quietest.from)} (average activity ${f2(quietest.avg)}); most active from ${esc(busiestHour.from)} (${f2(busiestHour.avg)}).</span></div></div>` : ""}
</div><div><h3>Rest, eating and breathing</h3>
<div class="find">${svgIcon("check")}<div><b>Rest</b><span>${lyingRev.length && !lyingMeasured ? `Lay down ${esc(lyingRevText)} (${hmText(lyingRevMin * 60)}, seen on the recording). ` : ""}${restBouts.filter((x) => x.min >= 10).length ? `${plural(restBouts.filter((x) => x.min >= 10).length, "spell")} of 10 minutes or more standing at rest; the longest ${esc(span2(longest(restBouts)))} (${hmText(longest(restBouts).min * 60)}).` : `Rest came in short spells${longest(restBouts) ? `, the longest ${hmText(longest(restBouts).min * 60)} (${esc(span2(longest(restBouts)))})` : ""}.`}</span></div></div>
${hayKnown ? `<div class="find">${svgIcon("check")}<div><b>Eating</b><span>${eatBouts.filter((x) => x.min >= 5).length ? `${plural(eatBouts.filter((x) => x.min >= 5).length, "bout")} of 5 minutes or more at the hay, ${hmText(tbTot.eating)} in all; the longest ${esc(span2(longest(eatBouts)))} (${hmText(longest(eatBouts).min * 60)}).` : `${hmText(tbTot.eating)} at the hay, in short visits.`}</span></div></div>` : ""}
<div class="find">${svgIcon("check")}<div><b>Breathing</b><span>${respTimes.length === 1 ? `1 reading at ${respTimes[0].at}, ${f1(respTimes[0].v)} breaths per minute.` : respTimes.length ? `${plural(respTimes.length, "reading")} between ${respTimes[0].at} and ${respTimes.at(-1).at}, ${rangeText(respTimes.map((x) => x.v))} breaths per minute (median ${f1(med(respTimes.map((x) => x.v)))}).` : "Not read in this session: it needs the flank or the nostril still in view for 30 seconds."}</span></div></div>
</div></div></section>
<section class="card"><div class="sh">${sn()}<h2>Hour by hour</h2></div><p class="sub">Shares of the time ${esc(name)} was seen in each hour.</p>
<table style="margin-top:10px"><thead><tr><th>Hour</th>${hayKnown ? "<th>Eating</th>" : ""}<th>At rest</th>${lyingKnown ? "<th>Lying</th>" : ""}<th>Moving</th><th>Avg activity</th>${peopleSeen ? "<th>Visits</th>" : ""}</tr></thead><tbody>
${hours.filter((h) => h.seen > 0).map((h) => `<tr><td class="num">${esc(h.from)}</td>${hayKnown ? `<td class="num">${Math.round(h.share("eating") * 100)}%</td>` : ""}<td class="num">${Math.round(h.share("resting") * 100)}%</td>${lyingKnown ? `<td class="num">${h.s.lying ? `${Math.round(h.share("lying") * 100)}%` : "—"}</td>` : ""}<td class="num">${Math.round(h.share("moving") * 100)}%</td><td class="num">${f2(h.avg)}</td>${peopleSeen ? `<td class="num">${h.people ? `${h.people} min` : "—"}</td>` : ""}</tr>`).join("")}
</tbody></table></section>
${pg()}</div>` : ""}
${baseRows.length ? `<div class="page">
<section class="card"><div class="sh">${sn()}<h2>Compared with ${esc(name)}'s normal</h2></div><p class="sub">${esc(name)}'s own normal: ${esc(baseWin)}. Horses differ far more from each other than one horse does from night to night, so a change against its own normal matters more than a textbook range.</p>
<table style="margin-top:10px"><thead><tr><th>Measure</th><th>${esc(name)}'s normal</th><th>This ${overnight ? "night" : "session"}</th><th>Change</th></tr></thead><tbody>
${baseRows.map((r) => `<tr><td><b>${esc(r.label)}</b></td><td class="num">${esc(fmtBase(r, r.baseline))}</td><td class="num">${esc(fmtBase(r, r.recent))}</td><td>${r.notable ? `<span class="st part"><i>◐</i>${esc(changeText(r))}</span>` : esc(changeText(r))}</td></tr>`).join("")}
</tbody></table>
<p class="note" style="font-size:11px;color:var(--muted);margin-top:8px">Marked changes are at EquiCare's own thresholds (no published ones exist for most of these) — a reason to look at the horse, not a diagnosis.</p></section>
${pg()}</div>` : ""}
${healthOk ? `<div class="page">
<section class="card"><div class="sh">${sn()}<h2>Rest, sleep and health indicators</h2></div><p class="sub">${esc(name)}'s ${overnight ? "night" : "session"} beside what is typical for a healthy adult horse.</p>
<table style="margin-top:10px"><thead><tr><th>Measure</th><th>${esc(name)}</th><th>Typical healthy adult</th><th>Sources</th></tr></thead><tbody>
${[
  lyingRev.length && ["Lying down", `${hmText(lyingRevMin * 60)} in ${plural(lyingRev.length, "bout")} (${esc(lyingRevText)})`, "Varies widely between horses: about 25 min to 2 h 25 min a day in published studies (0–5 h 19 min), 1 h 30 min in stalled cavalry horses; mostly 21:00–06:00, in 1–7 bouts of 10–40 min", "Kelemen et al. 2021; Gobbo et al. 2025; Kjellberg et al. 2022; Raabymagle & Ladewig 2006; Ogilvie-Graham 1994"],
  lateralRev.length && ["Deep sleep, flat on the side", `${hmText(lateralMin * 60)} in ${plural(lateralRev.length, "spell")} (${esc(lateralRev.map((x) => clock(x.from)).join(", "))}), still`, "About 30 min a night (22–37) of deep (REM) sleep, lying still — flat out, or on the chest with the head on the ground — mostly after midnight", "Zimmer et al. 2026; Burla et al. 2017; Aleman et al. 2008"],
  standShare !== null && ["Rest taken standing", `${standShare}% of rest (${hmText(standRestS)} standing still)`, "Most rest is taken standing, often dozing with a hind leg resting (about 4 h 30 min a day in stalled cavalry horses)", "Auer et al. 2021; Ogilvie-Graham 1994; Torcivia & McDonnell 2021"],
  hayKnown && ["Eating", `${hmText(tbTot.eating)} at the hay${gapBest ? `; longest stretch without eating ${esc(span2({ start: gapBest.start, end: gapBest.start + gapBest.len - 1 }))} (${hmText(gapBest.len * 60)})` : ""}`, "Set by the ration (about 33 min per kg of hay): 3–4 h a day on set rations, about 8 h 45 min in stalled cavalry horses, 8–14 h grazing; a drop against the horse's own level matters most", "Scheurer et al. 2017; Ogilvie-Graham 1994; Griffin 2019; Nowak et al. 2024"],
  respTimes.length && ["Breathing", `${f1(med(respTimes.map((x) => x.v)))} /min${Object.entries(breathBy).length > 1 ? ` (${Object.entries(breathBy).map(([k, v]) => `${k === "other" ? "other" : STATE_WORD[k].toLowerCase()} ${f1(med(v))}`).join("; ")})` : ""}`, "10–14 /min (Merck); 8–12 /min by other sources", "Merck Vet Manual; Penn State Extension"],
  getups.length && ["Getting up", esc(getups.map((g) => `${clock(g.from)}: ${g.text}`).join("; ")), "About 4 get-ups a night, each at the first attempt; repeatedly lying down and getting up within minutes is the commonest sign of colic", "Raabymagle & Ladewig 2006; Curtis et al. 2015; Merck Vet Manual"],
  actV.length && ["Stable vices", viceNames.length ? esc(viceNames.join(", ")) : "None seen", "Weaving, box walking and head tossing are repetitive behaviours linked to confinement, restricted forage and little contact with other horses", "Hausberger et al. 2009; Sarrafchi & Blokhuis 2013"],
].filter(Boolean).map(([k, v, n, src]) => `<tr><td><b>${esc(k)}</b></td><td>${v}</td><td>${esc(n)}</td><td class="pt-note">${esc(src)}</td></tr>`).join("")}
</tbody></table>
<p class="fig">Typical values are averages from published studies of healthy horses; each horse has its own normal, which ${esc(name)}'s further sessions will establish.</p></section>
<section class="card"><div class="sh">${sn()}<h2>Through the ${overnight ? "night" : "session"}: rest and movement</h2></div>
<div class="obs"><div>
${lyingRev.length ? `<div class="find">${svgIcon("check")}<div><b>Lying bout</b><span>${esc(lyingRev.map((r) => `Lay down at ${clock(r.from)} and got up at ${clock(r.to)} (${hmText((r.to - r.from) / 1000)})`).join("; "))}${lateralRev.length ? `, lying flat on the side ${esc(lateralRev.map((x) => `${clock(x.from)}–${clock(x.to)}`).join(", "))} and on the chest the rest of the time` : ""} — seen on the recording.</span></div></div>` : ""}
${getups.length ? `<div class="find">${svgIcon("check")}<div><b>Getting up</b><span>${esc(getups.map((g) => `${clock(g.from)}: ${g.text}`).join("; "))}. No repeated lying down and getting up.</span></div></div>` : ""}
${gapBest && hayKnown ? `<div class="find">${svgIcon("info")}<div><b>Longest stretch without eating</b><span>${esc(span2({ start: gapBest.start, end: gapBest.start + gapBest.len - 1 }))} (${hmText(gapBest.len * 60)})${lyingRev.some((r) => r.from < from + (gapBest.start + gapBest.len) * 60000 && r.to > from + gapBest.start * 60000) ? ", including the lying bout" : ""}.</span></div></div>` : ""}
</div><div>
${bx.length > 60 ? `<div class="find">${svgIcon("check")}<div><b>Moving about the stall</b><span>Changed place ${plural(moves, "time")}; the most settled stretch in one place ${esc(clock(settled.from * 1000))}–${esc(clock((settled.from + settled.len) * 1000))} (${hmText(settled.len)}).</span></div></div>` : ""}
${troughReal.length && false ? `<div class="find">${svgIcon("info")}<div><b>At the trough on the back wall</b><span>${plural(troughReal.length, "visit")}, ${hmText(troughReal.reduce((x, v) => x + v.to - v.from, 0))} in all (${esc(troughReal.slice(0, 6).map((v) => clock(v.from * 1000)).join(", "))}${troughReal.length > 6 ? ", …" : ""}).</span></div></div>` : ""}
${Object.keys(breathBy).length ? `<div class="find">${svgIcon("check")}<div><b>Breathing by what ${esc(name)} was doing</b><span>${esc(Object.entries(breathBy).map(([k, v]) => `${k === "other" ? "other" : STATE_WORD[k].toLowerCase()}: ${plural(v.length, "reading")}, ${rangeText(v)} /min`).join("; "))}.</span></div></div>` : ""}
</div></div></section>
${pg()}</div>` : ""}
<div class="page">
<section class="card"><div class="sh">${sn()}<h2>${block < 60 ? `${block}-minute` : `${block / 60}-hour`} breakdown</h2></div>
<table style="margin-top:10px"><thead><tr><th>Period</th><th>Avg activity</th><th>Peak</th><th>Standing rest</th>${fromRec ? "" : "<th>Eye temp.</th><th>Eye in view</th>"}<th>Flags</th></tr></thead><tbody>
${blocks.map((b) => `<tr class="${b.data ? "" : "dim"}"><td class="num">${b.label}</td><td class="num">${f2(b.act)}</td><td class="num">${f2(b.peak)}</td><td class="num">${b.still} min</td>${fromRec ? "" : `<td class="num">${b.n ? `${f1(b.temp)} °C` : "—"}</td><td class="num">${Math.round(b.eyeShare * 100)}%</td>`}<td class="num">${b.flags || "—"}</td></tr>`).join("")}
</tbody></table></section>

<section class="card"><div class="sh">${sn()}<h2>Recommendations</h2></div>
<ol class="rec">${recs.map((r) => `<li><div>${r}</div></li>`).join("")}</ol></section>

<section class="card"><div class="sh">${sn()}<h2>About this report</h2></div>
<div class="about">
<div><b>Eye and body temperature</b><span>Read at the eye whenever the eye is in view — only from a small hot spot with cooler skin around it, so a warm coat is not mistaken for the eye. The eye's surface is cooler than the body by an amount that differs between horses, so each horse's own normal eye temperature is learned for every time of day, allowing for the warmth of the stall. Body temperature is a resting ${esc(horse.species || "horse")}'s normal ${normalFor(horse)} °C plus how far the eye is from that normal; a rise well beyond the horse's everyday range is reported as a possible fever.</span></div>
<div><b>Activity index</b><span>The share of the horse moving: 0 = still, 1 = very active. Levels: no activity below 0.05, low 0.05–0.2, moderate 0.2–0.6, high 0.6 and above.</span></div>
<div><b>Rest</b><span>Minutes in which the horse stood still; lying down is reported when the horse's whole body is in view.</span></div>
<div><b>Stable vices</b><span>Weaving, box walking and head tossing are identified from sustained rhythmic movement; a flagged moment can be checked on the recording.</span></div>
<div><b>Monitoring coverage</b><span>${anyMin.size} of ${liveMin} minutes with data${pausedMin ? ` (paused ${pauseText}, not counted)` : ""}; ${nReadings} readings${clipCount ? ` and ${plural(clipCount, "video clip")}` : ""} recorded for this session.</span></div>
${anyRec ? `<div><b>${overnight ? "Overnight review" : "Review after recording"}</b><span>${fromRec ? "This session was" : `The ${overnight ? "overnight " : ""}part (${span(reviewed)}) was`} recorded at the stable and reviewed afterwards, minute by minute, with the same methods as live monitoring. Eye temperature is taken during live monitoring only${fromRec ? "" : ` — in this session, during the live check (${span(checkedLive)})`}.</span></div>
` : ""}<div><b>Screening</b><span>Measurements support daily care and early attention; clinical decisions should be confirmed by a veterinarian.</span></div>
</div></section>
${pg()}</div>
${previous ? comparison() : ""}
</main><div id="tip"></div>
<script>const tip=document.getElementById("tip");document.addEventListener("pointermove",(e)=>{const t=e.target.closest&&e.target.closest("[data-tip]");if(!t){tip.style.display="none";return;}tip.textContent=t.getAttribute("data-tip");tip.style.display="block";const r=tip.getBoundingClientRect();let x=e.clientX+14,y=e.clientY+14;if(x+r.width>innerWidth-8)x=e.clientX-r.width-14;if(y+r.height>innerHeight-8)y=e.clientY-r.height-14;tip.style.left=x+"px";tip.style.top=y+"px";});</script>
</body></html>`;
  return { html, ref, photos: covers.length + gallery.length + covers.filter((c) => c.thermal).length + gallery.filter((g) => g.thermal).length, summary };
}
