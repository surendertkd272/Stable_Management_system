// Named alerts, built from what EquiCare measures and shaped by the clinical
// research (CLINICAL_RESEARCH.md; the letters below are its parts):
//
//   Possible colic        two signs together; or one strong sign (≥5 lie-downs
//                         in an hour, ≥3 rolls in 30 min); or one sign inside a
//                         risk window (new hay, transport, a move… — care-log.mjs)
//                         [A]. Includes the "quiet" colic: dull, eating less,
//                         fewer droppings — how impactions often look.
//   Foaling may be starting  a mare in her foaling watch with two signs of
//                         labour (restless, down-and-up, rolling) [F]
//   Foal / placenta checks   the first hours after foaling [F]
//   Person at the stall at night
//   Heat                  the "°F + humidity" rule of thumb, tied to signs from
//                         the horse itself [C]
//   Drinking / eating less, hardly lying down, shifting weight [B, E, H]
//   Isolation and post-journey watches [D, H]
//   Stable-wide: several horses with fever, outbreak mode [D]
//
// Every threshold here is EquiCare's own unless a source is named; each alert
// says what it saw.
import { compare, MEASURES } from "./baseline.mjs";
import { floorAlone } from "./reading-rules.mjs";
import { colicRisks, isolation, recentLongJourneys } from "./care-log.mjs";
import { cameraBodyTemp, isFever } from "./core-temp.mjs";

const MIN = 60000, H = 60 * MIN, DAY = 24 * H;
// tz: the stable's time zone (EQUICARE_TZ, else the server's own).
const LOCAL_TZ = process.env.EQUICARE_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
let CFG = { nightVisitors: true, quietFrom: 22, quietTo: 5, untrusted: new Set(), tz: LOCAL_TZ, outbreak: null };
export function configureNamedAlerts(c = {}) {
  CFG = { ...CFG, ...c, untrusted: new Set(c.untrusted ?? CFG.untrusted), tz: c.tz || CFG.tz };
}

/** What a stable must do on suspicion of a scheduled disease (Act 27 of 2009, ss. 4–5). */
export const SCHEDULED_NOTE = "Fever on two days can mean a scheduled (reportable) disease under the Prevention and Control of " +
  "Infectious and Contagious Diseases in Animals Act, 2009 — glanders, surra, equine influenza, EHV and others. Keep the horse " +
  "apart from other horses and from shared water, call the vet, and report through the Army veterinary chain (glanders testing: " +
  "Central Military Veterinary Laboratory, Meerut).";

const hourOf = (ms) => (CFG.tz
  ? Number(new Intl.DateTimeFormat("en-GB", { timeZone: CFG.tz, hour: "2-digit", hourCycle: "h23" }).format(ms))
  : new Date(ms).getHours());
const inQuiet = (ms) => {
  const h = hourOf(ms), { quietFrom: a, quietTo: b } = CFG;
  return a <= b ? h >= a && h < b : h >= a || h < b;
};
const clock = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...(CFG.tz ? { timeZone: CFG.tz } : {}) });
const mean = (v) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : null);
const median = (v) => { if (!v.length) return null; const s = [...v].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const between = (rows, a, b) => rows.filter((r) => { const t = Date.parse(r.ts); return t >= a && t < b; });

// ---- foaling --------------------------------------------------------------- //
// Gestation runs 315–388 days (UK Thoroughbreds), 296–429 (NZ); the mare's own
// past lengths are the best guide [F]. The watch starts at about day 315 of
// pregnancy and stays on until she foals.
export const WATCH_FROM_DAY = 315, USUAL_GESTATION = 342;

/** The mare's expected gestation (her own past lengths, else 342 days) and when her watch starts. */
export function foalingPlan(bio) {
  const past = (Array.isArray(bio?.pastGestationDays) ? bio.pastGestationDays : []).map(Number).filter((d) => d >= 290 && d <= 440);
  const expected = past.length ? median(past) : USUAL_GESTATION;
  const covered = Date.parse(bio?.coveredAt ?? "");
  const due = Number.isFinite(covered) ? covered + expected * DAY : Date.parse(bio?.foalingDue ?? "");
  if (!Number.isFinite(due)) return null;
  const conceived = Number.isFinite(covered) ? covered : due - expected * DAY;
  const from = conceived + Math.min(WATCH_FROM_DAY, expected - 25) * DAY;
  return { due, from, expected: Math.round(expected), fromOwnHistory: past.length > 0, gestationDay: (now) => Math.floor((now - conceived) / DAY) };
}
/** The mare is in her foaling watch: from about day 315 until she foals. */
export function foalingWindow(bio, now = Date.now()) {
  if (bio?.foaledAt) return false;
  const p = foalingPlan(bio);
  return Boolean(p && now >= p.from);
}
/** Mare and foal together: the 90 days after foaling (as smart-halter makers advise). */
export function mareAndFoal(bio, now = Date.now()) {
  const at = Date.parse(bio?.foaledAt ?? "");
  return Number.isFinite(at) && now >= at && now - at <= 90 * DAY;
}
/** Single-horse camera notes that mean nothing with two animals in view. */
export const suppressed = (bio, now = Date.now()) => mareAndFoal(bio, now);

// ---- colic signs ------------------------------------------------------------ //
/** The colic / labour signs seen recently, each with what it was. strong: enough on its own. */
export function colicSigns(rd, b, now = Date.now()) {
  const signs = [];
  const recent = (ms) => (r) => now - Date.parse(r.ts) <= ms && Date.parse(r.ts) <= now;
  const rs = b?.resting;
  // lying down and getting up again and again: continuous attempts had OR 12 for a critical case [A]
  const downs = (rs?.downTimes ?? rd.filter((r) => r.metric === "posture_event" && r.meta?.kind === "lie_down").map((r) => r.ts))
    .map((t) => Date.parse(t)).filter((t) => now - t <= 2 * H && t <= now);
  const perHour = Math.max(0, ...downs.map((t) => downs.filter((u) => u >= t && u - t <= H).length));
  if (perHour >= 3) signs.push({ key: "down_up", strong: perHour >= 5, text: `${perHour} lie-downs within an hour` });
  // rolling
  const rolls = rd.filter((r) => r.metric === "posture_event" && r.meta?.kind === "possible_roll").map((r) => Date.parse(r.ts))
    .filter((t) => now - t <= 2 * H && t <= now);
  const rollsIn30 = Math.max(0, ...rolls.map((t) => rolls.filter((u) => u >= t && u - t <= 30 * MIN).length));
  if (rolls.length || (rs?.lastRoll && now - Date.parse(rs.lastRoll) <= 2 * H))
    signs.push({ key: "rolling", strong: rollsIn30 >= 3, text: rollsIn30 >= 2 ? `${rollsIn30} rolls within 30 minutes` : "rolling" });
  if ((rs?.lateralLast90Min ?? 0) >= 30) signs.push({ key: "flat", text: `${rs.lateralLast90Min} min flat on the side` });
  // eating: the last 6 h at the hay against the same hours on earlier days
  const tb = rd.filter((r) => r.metric === "time_budget");
  const share = (rows, key = "eatingS") => { const s = rows.reduce((x, r) => x + (r.value || 0), 0); return s ? rows.reduce((x, r) => x + (Number(r.meta?.[key]) || 0), 0) / s : null; };
  if (tb.length) {
    const last = between(tb, now - 6 * H, now);
    if (last.reduce((x, r) => x + (r.value || 0), 0) >= 2 * H / 1000) {
      const before = [1, 2, 3, 4, 5, 6, 7].map((d) => share(between(tb, now - d * DAY - 6 * H, now - d * DAY))).filter((v) => v !== null);
      const usual = median(before), nowShare = share(last);
      if (before.length >= 3 && usual >= 0.1 && nowShare < usual * 0.5)
        signs.push({ key: "eating", text: `eating ${Math.round(nowShare * 100)}% of the time against usual ${Math.round(usual * 100)}%` });
    }
  }
  // droppings, judged against this horse's own normal gaps [A]
  const d = droppingsNow(rd, now);
  if (d?.sign) signs.push({ key: "droppings", text: d.sign });
  // restless: the last hour's activity at twice its usual level
  const act = rd.filter((r) => r.metric === "activity_index");
  const lastHour = act.filter(recent(H)).map((r) => r.value);
  const usualAct = median(act.filter((r) => now - Date.parse(r.ts) <= 7 * DAY && now - Date.parse(r.ts) > H).map((r) => r.value));
  if (lastHour.length >= 20 && usualAct && mean(lastHour) >= 2 * usualAct && mean(lastHour) >= 0.1)
    signs.push({ key: "restless", text: `activity ${mean(lastHour).toFixed(2)} against usual ${usualAct.toFixed(2)}` });
  // quiet: the last 4 h at half its usual activity for those hours — dull, low-headed horses had OR 5.7 for a critical colic [A]
  const last4 = between(act, now - 4 * H, now).map((r) => r.value);
  const same4 = [1, 2, 3, 4, 5, 6, 7].map((k) => mean(between(act, now - k * DAY - 4 * H, now - k * DAY).map((r) => r.value))).filter((v) => v !== null);
  const usual4 = median(same4);
  if (last4.length >= 60 && same4.length >= 3 && usual4 >= 0.05 && mean(last4) <= usual4 * 0.5)
    signs.push({ key: "quiet", text: `unusually still: activity ${mean(last4).toFixed(2)} against ${usual4.toFixed(2)} at these hours` });
  return signs;
}

/** Droppings now against this horse's normal: { sign, perDay, threshold } or null. */
export function droppingsNow(rd, now = Date.now()) {
  const all = rd.filter((r) => r.metric === "excretion_event" && Date.parse(r.ts) <= now && now - Date.parse(r.ts) <= 14 * DAY);
  if (!all.length) return null;
  const alone = floorAlone(rd.filter((r) => r.metric === "excretion_event" || r.metric === "urination_event"));
  const times = all.filter(alone).map((r) => Date.parse(r.ts)).sort((a, b) => a - b);
  const week = times.filter((t) => now - t <= 7 * DAY);
  const perDay = week.length / 7;
  // A horse that seems to pass fewer than 4 a day is more likely out of the
  // camera's view than constipated: not judged.
  if (perDay < 4 || !times.length) return { sign: null, perDay };
  const gaps = times.slice(1).map((t, i) => t - times[i]).filter((g) => g < DAY);
  // 6 h for a horse that passes 8+ a day (Curtis 2015); otherwise its own
  // longest normal gap (95th percentile over 14 days), between 6 and 12 h
  const threshold = perDay >= 8 ? 6 * H : Math.min(12 * H, Math.max(6 * H, gaps.length >= 10 ? pct(gaps, 0.95) : 8 * H));
  const since = now - times.at(-1);
  if (since >= threshold)
    return { sign: `no droppings for ${Math.round(since / H)} h (this horse usually passes about ${Math.round(perDay)} a day)`, perDay, threshold };
  const last12 = times.filter((t) => now - t <= 12 * H).length, expected = perDay / 2;
  if (expected >= 3 && last12 < expected * 0.5)
    return { sign: `only ${last12} droppings in 12 h against about ${Math.round(expected)} usually`, perDay, threshold };
  return { sign: null, perDay, threshold };
}

// ---- helpers for the horse's own signs ------------------------------------ //
/** Breathing well above this horse's usual (not for mules: they may not breathe faster in heat [C]). */
function breathingUp(bio, rd, now) {
  if (["mule", "donkey"].includes(String(bio?.species || "").toLowerCase())) return null;
  const rr = rd.filter((r) => r.metric === "respiratory_rate_bpm" && r.meta?.calibrated !== false);
  const recent = rr.filter((r) => now - Date.parse(r.ts) <= 30 * MIN && Date.parse(r.ts) <= now).map((r) => r.value);
  const usual = median(rr.filter((r) => { const t = Date.parse(r.ts); return now - t > 6 * H && now - t <= 7 * DAY; }).map((r) => r.value));
  if (!recent.length || !usual) return null;
  const v = median(recent);
  return v >= Math.max(24, usual * 1.5) ? `breathing ${Math.round(v)}/min against usual ${Math.round(usual)}` : null;
}
/** Daily totals of a metric over local calendar days, newest last: [{ start, total, n }]. */
function dailyTotals(rows, days, now) {
  const out = [];
  for (let k = days; k >= 1; k--) {
    const end = new Date(now); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() - (k - 1));
    const start = end.getTime() - DAY;
    const r = between(rows, start, end.getTime());
    out.push({ start, total: r.reduce((a, x) => a + (x.value || 0), 0), n: r.length });
  }
  return out;
}
/** Noon-to-noon days of the time budget, newest last: [{ end, seenS, lyingS, eatingS }]. */
function budgetDays(rd, days, now) {
  const tb = rd.filter((r) => r.metric === "time_budget");
  const noon = new Date(now); noon.setHours(12, 0, 0, 0);
  const lastEnd = noon.getTime() <= now ? noon.getTime() : noon.getTime() - DAY;
  const out = [];
  for (let k = days; k >= 1; k--) {
    const end = lastEnd - (k - 1) * DAY, rows = between(tb, end - DAY, end);
    const sum = (key) => rows.reduce((a, r) => a + (Number(r.meta?.[key]) || 0), 0);
    out.push({ end, seenS: sum("lyingS") + sum("eatingS") + sum("restingS") + sum("movingS"), lyingS: sum("lyingS"), eatingS: sum("eatingS") });
  }
  return out;
}

/** The named alerts for one horse: [{ type, severity, detail, ts }]. */
export function namedAlerts(bio, rd, b, now = Date.now()) {
  const out = [];
  const push = (type, severity, detail, ts) => out.push({ type, severity, detail, ts: ts || new Date(now).toISOString() });
  const signs = suppressed(bio, now) ? [] : colicSigns(rd, b, now);
  const list = signs.map((s) => s.text).join(", ");
  if (foalingWindow(bio, now)) {
    // eating less is NOT a foaling sign (Shaw 1988: unchanged on the night) [F]
    const labour = signs.filter((s) => ["down_up", "rolling", "restless"].includes(s.key));
    if (labour.length >= 2) {
      const p = foalingPlan(bio);
      push("Foaling may be starting — check the mare now", "alert",
        `${bio.name}, day ${p.gestationDay(now)} of pregnancy, shows ${labour.map((s) => s.text).join(", ")} — from the camera. ` +
        "Restlessness, lying down and getting up and rolling usually come 1.5–3 hours before the foal. Watch from outside the box " +
        "(disturbing the mare lengthens delivery). Call the vet if the foal is not out 20–30 min after the waters break, or at once for a red bag.");
    }
  } else {
    const strong = signs.find((s) => s.strong);
    const risks = colicRisks(bio?.id, now);
    const quiet = signs.some((s) => s.key === "quiet");
    const why = quiet && signs.some((s) => s.key === "eating") ? " This is the quiet pattern — dull, eating less — that impactions often show." : "";
    if (strong || signs.length >= 2 || (signs.length === 1 && risks.length && signs[0].key !== "droppings")) {
      const reason = strong && signs.length < 2 ? `${strong.text} — on its own enough to look`
        : signs.length >= 2 ? `${signs.length} colic signs together: ${list}`
          : `${list}, in a risk period (${risks.map((r) => r.text).join("; ")})`;
      push("Possible colic — look at the horse now", "alert",
        `${reason} — from the camera.${why} Look at the horse; call the vet with sweating, repeated lying down, rolling or no droppings.` +
        (risks.length && signs.length >= 2 ? ` Risk period: ${risks.map((r) => r.text).join("; ")}.` : ""));
    }
  }
  // the first hours after foaling (times entered by staff) [F]
  const foaled = Date.parse(bio?.foaledAt ?? "");
  if (bio?.foaledTimeKnown && Number.isFinite(foaled) && now - foaled >= 0 && now - foaled <= 12 * H) {
    const after = (now - foaled) / H, hrs = `${Math.round(after * 10) / 10} h`;
    if (!bio.foalStoodAt && after >= 2) push("Foal not standing yet", "alert", `${hrs} since the foal was born and it has not been recorded standing — most stand within an hour. Call the vet.`);
    if (!bio.foalNursedAt && after >= 3) push("Foal not nursing yet", "alert", `${hrs} since birth with no nursing recorded — most nurse within 2 hours, and colostrum in the first hours matters. Call the vet.`);
    if (!bio.placentaAt && after >= 3) push("Placenta not passed", "alert", `${hrs} since foaling and the placenta is not recorded as passed — retained placenta leads to other disease in about 4 mares in 10 (laminitis in 14%). Call the vet.`);
  }
  // people in the quiet hours
  if (CFG.nightVisitors) {
    const ppl = rd.filter((r) => r.metric === "people_in_view_s" && r.value >= 10 && now - Date.parse(r.ts) <= H
      && !CFG.untrusted.has(r.meta?.deviceId) && inQuiet(Date.parse(r.ts)));
    if (ppl.length) push("Person at the stall at night", "warn",
      `Someone was at the stall at ${clock(Date.parse(ppl.at(-1).ts))}, in the quiet hours (${CFG.quietFrom}:00–${CFG.quietTo}:00) — from the camera. Check it was a planned visit.`, ppl.at(-1).ts);
  }
  // heat: the "°F + humidity" rule of thumb (no published validation; resting,
  // acclimatised horses cope with far more than working ones) — the urgent
  // level needs a sign from the horse itself [C]
  const t = rd.filter((r) => r.metric === "stall_temp_c" && now - Date.parse(r.ts) <= 30 * MIN).at(-1);
  const hum = rd.filter((r) => r.metric === "stall_humidity_pct" && now - Date.parse(r.ts) <= 30 * MIN).at(-1);
  if (t && hum) {
    const idx = Math.round(t.value * 9 / 5 + 32 + hum.value);
    const cam = cameraBodyTemp(bio, rd, now);
    const horseSigns = [breathingUp(bio, rd, now), isFever(cam) ? `body temperature about ${cam.value.toFixed(1)} °C by the camera`
      : cam?.rise >= 0.5 ? `eye ${cam.rise.toFixed(1)} °C above its normal` : null].filter(Boolean);
    const mule = ["mule", "donkey"].includes(String(bio?.species || "").toLowerCase());
    const air = `heat index ${idx} (${t.value.toFixed(1)} °C, ${Math.round(hum.value)}% humidity)`;
    if (idx >= 150 && horseSigns.length) push("Dangerous heat in the stall", "alert",
      `${air}, and the horse shows it: ${horseSigns.join(", ")}. Cool the horse (shade, fans, water on the legs and neck), offer water, and call the vet if it does not settle.`, t.ts);
    else if (idx >= 150) push("Very hot, humid stall", "warn",
      `${air} — the horse looks to be coping so far (breathing and eye temperature at its usual levels${mule ? "; mules and donkeys can hide heat strain, so check by hand" : ""}). ` +
      "Keep water in front of it, shade and air moving; the camera keeps watching.", t.ts);
    else if (idx >= 130) push("Hot, humid stall", "warn",
      `${air}: watch for heat stress — fast breathing, standing by the water, sweating heavily or not at all.`, t.ts);
  }
  // drinking less: two days under 70% of its own usual (needs the water meter) [H]
  const water = rd.filter((r) => r.metric === "water_ml");
  if (water.length) {
    const daysW = dailyTotals(water, 9, now);
    const prev = daysW.slice(0, 7).filter((d) => d.n > 0).map((d) => d.total), usual = median(prev);
    const [d1, d2] = daysW.slice(-2);
    if (prev.length >= 4 && usual > 0 && d1.n && d2.n && d1.total < usual * 0.7 && d2.total < usual * 0.7)
      push("Drinking less than usual", "warn",
        `${Math.round(d1.total / 1000)} L and ${Math.round(d2.total / 1000)} L on the last two days against about ${Math.round(usual / 1000)} L usually. ` +
        "Drinking less raises colic risk (OR 5); check the water supply, the horse's mouth and its appetite. A hot day needs more, not less.");
  }
  // eating less over a whole day: check mouth, teeth and health — never "dental disease" [H]
  const bd = budgetDays(rd, 8, now);
  const full = bd.filter((d) => d.seenS >= 12 * 3600);
  const lastDay = bd.at(-1);
  if (lastDay.seenS >= 12 * 3600 && full.length >= 4) {
    const usualEat = median(full.slice(0, -1).map((d) => d.eatingS / d.seenS)), eatNow = lastDay.eatingS / lastDay.seenS;
    if (usualEat >= 0.1 && eatNow < usualEat * 0.6)
      push("Eating less than usual", "warn",
        `At the hay ${Math.round(eatNow * 100)}% of the time watched yesterday, against about ${Math.round(usualEat * 100)}% usually — from the camera. ` +
        "Check the mouth and teeth (quidding, food balls), the hay itself, and the horse's temperature and droppings.");
  }
  // hardly lying down for three days: sleep deprivation (owners' "never seen lying": OR 28; collapses) [E]
  const last3 = bd.slice(-3);
  if (last3.every((d) => d.seenS >= 12 * 3600 && d.lyingS < 30 * 60))
    push("Hardly lying down", "warn",
      `Under 30 minutes lying down on each of the last 3 days (${last3.map((d) => Math.round(d.lyingS / 60)).join(", ")} min) — from the camera. ` +
      "Horses need some lying-down sleep; without it they can buckle or fall while dozing standing. Check the night video, the bedding, " +
      "the stall size, pain (feet, back) and anything new in the barn.");
  // shifting weight far more than usual: the commonest early sign of laminitis (OR 17.7) and of limb pain [B]
  const ws = rd.filter((r) => r.metric === "weight_shift_count");
  if (ws.length) {
    const rate = (rows) => { const s = rows.reduce((a, r) => a + (Number(r.meta?.standingS) || 0), 0); return s >= 1800 ? rows.reduce((a, r) => a + r.value, 0) / (s / 3600) : null; };
    const recentRate = rate(between(ws, now - 2 * H, now));
    const usualRates = [1, 2, 3, 4, 5, 6, 7].map((k) => rate(between(ws, now - k * DAY - 12 * H, now - k * DAY + 12 * H))).filter((v) => v !== null);
    const usualWs = median(usualRates);
    if (recentRate !== null && usualRates.length >= 3 && recentRate >= 6 && recentRate >= 2 * Math.max(usualWs, 1))
      push("Shifting weight more than usual", "warn",
        `About ${Math.round(recentRate)} weight shifts an hour while standing in the last 2 h, against about ${Math.round(usualWs)} usually — from the camera. ` +
        "Shifting weight between the feet is the commonest early sign of laminitis: feel for stronger pulses at the feet and watch the horse turn. " +
        "More likely after diarrhoea or fever, in overweight or older horses, and on box rest.");
  }
  // a new arrival in isolation: the camera should be reading its temperature daily [D]
  const iso = isolation(bio?.id, now);
  if (iso) {
    const today = rd.some((r) => r.metric === "body_temp_c" && new Date(r.ts).toDateString() === new Date(now).toDateString());
    if (!today && hourOf(now) >= 12)
      push("Isolation: no temperature today", "warn",
        `${bio.name} is a new arrival (day ${iso.day} of 21 in isolation) and the thermal camera has not caught its eye today. ` +
        "Strangles and flu show as fever first: make sure the horse's head can face the camera (hay and water in its view).");
  }
  // after a long journey: shipping fever peaks 20–49 h after departure; a vet check at 24 h [D, H]
  for (const j of recentLongJourneys(bio?.id, now)) {
    const since = (now - j.at) / H;
    if (since >= 24 && since <= 48)
      push("Vet check due after a long journey", "warn",
        `${bio.name} arrived from a ${j.hours}-hour journey ${Math.round(since)} h ago. Shipping fever (pneumonia) shows 1–2 days after long journeys, ` +
        "and a temperature check alone misses most early cases — a vet check (with a blood test for inflammation if possible) is advised now. " +
        "The camera watches temperature, breathing, eating and droppings for 7 days.");
  }
  return out;
}

/** Alerts for the whole stable: [{ type, severity, detail, ts }] — horse "Stable". */
export function stableAlerts(roster, allReadings, now = Date.now()) {
  const out = [];
  const push = (type, severity, detail, ts) => out.push({ type, severity, detail, ts: ts || new Date(now).toISOString() });
  // several horses with fever at once: a possible outbreak [D]
  const feverish = roster.filter((h) => {
    const rd = allReadings.filter((r) => r.horseId === h.id && (r.metric === "body_temp_c" || r.metric === "people_in_view_s"));
    if (!rd.some((r) => r.metric === "body_temp_c" && now - Date.parse(r.ts) <= 2 * DAY)) return false;
    return [0, 6, 12, 24, 36].some((k) => isFever(cameraBodyTemp(h, rd, now - k * H)));
  });
  if (feverish.length >= 2)
    push("Several horses with fever", "alert",
      `${feverish.map((h) => h.name).join(", ")} have shown a fever by the thermal camera in the last 2 days. Several at once suggests an infection ` +
      `spreading. Stop horses moving in or out, keep the feverish ones apart, and call the vet. ${SCHEDULED_NOTE} Outbreak mode (Health checks) tracks the quarantine.`);
  // outbreak mode: the countdown [D]
  const ob = CFG.outbreak;
  if (ob?.active) {
    const start = Date.parse(ob.startedAt), last = Date.parse(ob.lastCaseAt || ob.startedAt);
    const plan = Number(ob.quarantineDays) || 28;
    const left = Math.ceil((last + plan * DAY - now) / DAY);
    push("Outbreak mode", "warn",
      `${ob.disease ? `${ob.disease}: ` : ""}day ${Math.max(1, Math.ceil((now - start) / DAY))}. No horse moves in or out. ` +
      (left > 0 ? `Quarantine can be lifted in ${left} day${left === 1 ? "" : "s"} (${plan} days after the last new case) if no new case appears.`
        : `${plan} days have passed since the last new case — the vet can lift the quarantine.`) +
      " The thermal camera reads every horse's temperature through the day; check the Health checks page morning and evening.");
  }
  return out;
}

/** 0–10: how far the latest day is from the horse's own normal. Each measure
 *  adds up to 3 points by how far past its notable line — or past twice this
 *  horse's own day-to-day spread, whichever is larger — it is. Ours. */
export function unusualScore(bio, rd, { tz = CFG.tz } = {}) {
  const c = compare(bio, rd, { tz });
  if (c.learning || !c.comparedDays) return { score: null, learning: c.learning, provisional: c.provisional, reasons: [] };
  const lines = Object.fromEntries(MEASURES.map((m) => [m.key, m.notable.abs]));
  const parts = c.rows.filter((r) => r.change !== null && r.baseline !== null)
    .map((r) => ({ r, d: Math.abs(r.change) / Math.max(lines[r.key] || 1, 2 * (r.spread || 0)) })).filter((x) => x.d >= 0.5);
  const score = Math.min(10, Math.round(parts.reduce((x, p) => x + Math.min(3, p.d), 0)));
  const reasons = parts.sort((a, b) => b.d - a.d).slice(0, 3)
    .map(({ r }) => `${r.label.toLowerCase()} ${r.direction === "up" ? "up" : "down"}`);
  return { score, learning: false, provisional: c.provisional, reasons };
}
