// Named alerts that stall-monitoring competitors sell (research 4 Oct 2026,
// COMPETITOR_RESEARCH.md), built from what EquiCare already measures:
//
//   Possible colic        two or more colic signs together (one sign alone
//                         stays a watch note — the commonest early picture is
//                         eating less + fewer droppings, Curtis 2015; REACT)
//   Foaling may be starting  a mare in her foaling window with signs of labour
//   Mare and foal         after foaling: two animals in view, single-horse
//                         behaviour notes paused (see suppressed())
//   Person at the stall at night   people seen in quiet hours (a trusted camera)
//   Hot, humid stall      the vets' heat index (°F + % humidity): 130 watch, 150 danger
//   How unusual tonight   0–10 against the horse's own normal (server/baseline.mjs)
//
// Every threshold here is EquiCare's own (none is published for camera signs);
// each alert says what it saw.
import { compare, MEASURES } from "./baseline.mjs";

const H = 3600e3, DAY = 24 * H;
// tz: the stable's time zone (EQUICARE_TZ, else the server's own).
const LOCAL_TZ = process.env.EQUICARE_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
let CFG = { nightVisitors: true, quietFrom: 22, quietTo: 5, untrusted: new Set(), tz: LOCAL_TZ };
export function configureNamedAlerts(c = {}) {
  CFG = { ...CFG, ...c, untrusted: new Set(c.untrusted ?? CFG.untrusted), tz: c.tz || CFG.tz };
}

const hourOf = (ms) => (CFG.tz
  ? Number(new Intl.DateTimeFormat("en-GB", { timeZone: CFG.tz, hour: "2-digit", hourCycle: "h23" }).format(ms))
  : new Date(ms).getHours());
const inQuiet = (ms) => {
  const h = hourOf(ms), { quietFrom: a, quietTo: b } = CFG;
  return a <= b ? h >= a && h < b : h >= a || h < b;
};
const mean = (v) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : null);
const median = (v) => { if (!v.length) return null; const s = [...v].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** The mare is in her foaling window (30 days before the due date until she foals, up to 30 days after it). */
export function foalingWindow(bio, now = Date.now()) {
  const due = Date.parse(bio?.foalingDue ?? "");
  if (!Number.isFinite(due) || bio?.foaledAt) return false;
  return now >= due - 30 * DAY && now <= due + 30 * DAY;
}
/** Mare and foal together: the 90 days after foaling (as smart-halter makers advise). */
export function mareAndFoal(bio, now = Date.now()) {
  const at = Date.parse(bio?.foaledAt ?? "");
  return Number.isFinite(at) && now >= at && now - at <= 90 * DAY;
}
/** Single-horse camera notes that mean nothing with two animals in view. */
export const suppressed = (bio, now = Date.now()) => mareAndFoal(bio, now);

/** The colic / labour signs seen recently, each with what it was. */
export function colicSigns(rd, b, now = Date.now()) {
  const signs = [];
  const recent = (ms) => (r) => now - Date.parse(r.ts) <= ms && Date.parse(r.ts) <= now;
  const rs = b?.resting;
  if (rs) {
    const downs = rs.downTimes.map((t) => Date.parse(t)).filter((t) => now - t <= 2 * H);
    if (downs.some((t) => downs.filter((u) => u >= t && u - t <= H).length >= 3)) signs.push({ key: "down_up", text: `${downs.length} lie-downs in 2 h` });
    if (rs.lastRoll && now - Date.parse(rs.lastRoll) <= 2 * H) signs.push({ key: "rolling", text: "rolling" });
    if ((rs.lateralLast90Min ?? 0) >= 30) signs.push({ key: "flat", text: `${rs.lateralLast90Min} min flat on the side` });
  }
  // eating: the last 6 h at the hay against the same hours on earlier days
  const tb = rd.filter((r) => r.metric === "time_budget");
  if (tb.length) {
    const eatIn = (from, to) => tb.filter((r) => { const t = Date.parse(r.ts); return t >= from && t < to; });
    const last = eatIn(now - 6 * H, now);
    const seen = last.reduce((x, r) => x + (r.value || 0), 0);
    if (seen >= 2 * H / 1000) {
      const share = (rows) => { const s = rows.reduce((x, r) => x + (r.value || 0), 0); return s ? rows.reduce((x, r) => x + (Number(r.meta?.eatingS) || 0), 0) / s : null; };
      const before = [1, 2, 3, 4, 5, 6, 7].map((d) => share(eatIn(now - d * DAY - 6 * H, now - d * DAY))).filter((v) => v !== null);
      const usual = median(before), nowShare = share(last);
      if (before.length >= 3 && usual >= 0.1 && nowShare < usual * 0.5)
        signs.push({ key: "eating", text: `eating ${Math.round(nowShare * 100)}% of the time vs usual ${Math.round(usual * 100)}%` });
    }
  }
  // droppings: none for 8 h from a horse that usually passes 4+ a day
  const drop = rd.filter((r) => r.metric === "excretion_event").map((r) => Date.parse(r.ts)).sort((x, y) => x - y);
  if (drop.length) {
    const perDay = drop.filter((t) => now - t <= 7 * DAY).length / 7;
    const last = drop.filter((t) => t <= now).at(-1);
    if (perDay >= 4 && now - last >= 8 * H) signs.push({ key: "no_droppings", text: `no droppings for ${Math.round((now - last) / H)} h` });
  }
  // restless: the last hour's activity at twice its usual level
  const act = rd.filter((r) => r.metric === "activity_index");
  const lastHour = act.filter(recent(H)).map((r) => r.value);
  const usualAct = median(act.filter((r) => now - Date.parse(r.ts) <= 7 * DAY && now - Date.parse(r.ts) > H).map((r) => r.value));
  if (lastHour.length >= 20 && usualAct && mean(lastHour) >= 2 * usualAct && mean(lastHour) >= 0.1)
    signs.push({ key: "restless", text: `activity ${mean(lastHour).toFixed(2)} vs usual ${usualAct.toFixed(2)}` });
  return signs;
}

/** The named alerts for one horse: [{ type, severity, detail, ts }]. */
export function namedAlerts(bio, rd, b, now = Date.now()) {
  const out = [];
  const push = (type, severity, detail, ts) => out.push({ type, severity, detail, ts: ts || new Date(now).toISOString() });
  const signs = suppressed(bio, now) ? [] : colicSigns(rd, b, now);
  const list = signs.map((s) => s.text).join(", ");
  if (foalingWindow(bio, now)) {
    if (signs.some((s) => ["down_up", "rolling", "restless", "eating"].includes(s.key)))
      push("Foaling may be starting — check the mare now", "alert",
        `${bio.name} is in her foaling window (due ${String(bio.foalingDue).slice(0, 10)}) and shows ${list} — from the camera. ` +
        "Labour and colic look alike: watch from outside the box (disturbing the mare lengthens delivery) and call the vet if the foal is not out 20–30 min after the waters break.");
  } else if (signs.length >= 2) {
    push("Possible colic — look at the horse now", "alert",
      `${signs.length} colic signs together: ${list} — from the camera. Why: one sign alone is common, two together is how colic usually starts. ` +
      "Look at the horse; call the vet with sweating, repeated lying down, rolling or no droppings.");
  }
  // people in the quiet hours
  if (CFG.nightVisitors) {
    const ppl = rd.filter((r) => r.metric === "people_in_view_s" && r.value >= 10 && now - Date.parse(r.ts) <= H
      && !CFG.untrusted.has(r.meta?.deviceId) && inQuiet(Date.parse(r.ts)));
    if (ppl.length) push("Person at the stall at night", "warn",
      `Someone was at the stall at ${new Date(Date.parse(ppl.at(-1).ts)).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...(CFG.tz ? { timeZone: CFG.tz } : {}) })}, in the quiet hours (${CFG.quietFrom}:00–${CFG.quietTo}:00) — from the camera. Check it was a planned visit.`, ppl.at(-1).ts);
  }
  // the vets' heat index for the stall air
  const t = rd.filter((r) => r.metric === "stall_temp_c" && now - Date.parse(r.ts) <= 30 * 60000).at(-1);
  const hum = rd.filter((r) => r.metric === "stall_humidity_pct" && now - Date.parse(r.ts) <= 30 * 60000).at(-1);
  if (t && hum) {
    const idx = Math.round(t.value * 9 / 5 + 32 + hum.value);
    if (idx >= 150) push("Dangerous heat in the stall", "alert",
      `Heat index ${idx} (${t.value.toFixed(1)} °C, ${Math.round(hum.value)}% humidity): 150+ is critical. Cool the stall and the horse (shade, fans, water on the legs and neck), offer water, and watch for fast breathing and a dry coat.`, t.ts);
    else if (idx >= 130) push("Hot, humid stall", "warn",
      `Heat index ${idx} (${t.value.toFixed(1)} °C, ${Math.round(hum.value)}% humidity): 130–150 means watch for heat stress — fast breathing, standing by the water, sweating or not sweating.`, t.ts);
  }
  return out;
}

/** 0–10: how far the latest day is from the horse's own normal. Each measure
 *  adds up to 3 points by how far past its notable line it is. Ours. */
export function unusualScore(bio, rd, { tz = CFG.tz } = {}) {
  const c = compare(bio, rd, { tz });
  if (c.learning || !c.comparedDays) return { score: null, learning: c.learning, reasons: [] };
  const lines = Object.fromEntries(MEASURES.map((m) => [m.key, m.notable.abs]));
  const parts = c.rows.filter((r) => r.change !== null && r.baseline !== null)
    .map((r) => ({ r, d: Math.abs(r.change) / (lines[r.key] || 1) })).filter((x) => x.d >= 0.5);
  const score = Math.min(10, Math.round(parts.reduce((x, p) => x + Math.min(3, p.d), 0)));
  const reasons = parts.sort((a, b) => b.d - a.d).slice(0, 3)
    .map(({ r }) => `${r.label.toLowerCase()} ${r.direction === "up" ? "up" : "down"}`);
  return { score, learning: false, reasons };
}
