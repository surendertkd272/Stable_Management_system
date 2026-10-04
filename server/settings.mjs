// Site settings — stored on the server (one record), so what the Settings page
// shows is what the server actually does.
//
// Alert-type switches decide what is SENT (webhook: WhatsApp gateway, Slack…),
// never what the app shows: a muted fever still appears on the Alerts page.
// Sensitivity only tunes the prototype "activity unusual" watch note — no
// clinical threshold moves with a slider.

export const DEFAULTS = {
  id: "site",
  delivery: {
    instant: true,              // each new alert, once, through the webhook
    digest: false,              // a morning summary
    digestHour: 7,              // local time
    escalation: false,          // unacknowledged alerts go up the chain
    escalateAfterMin: 15,
    recipients: { manager: "", onCall: "", vet: "" },   // numbers / addresses the gateway sends to
    // The call chain (server/notify.mjs): a new alert goes to the first
    // person; unacknowledged, to the next after escalateAfterMin, then the
    // third. Each by call, SMS or WhatsApp; a number is called at most once
    // per callAtMostEveryMin (texted instead).
    chain: [
      { role: "Stall staff", name: "", phone: "", channel: "call" },
      { role: "Duty vet", name: "", phone: "", channel: "call" },
      { role: "Officer in charge", name: "", phone: "", channel: "call" },
    ],
    callAtMostEveryMin: 60,
    warnToStaff: true,          // watch-level alerts (e.g. a person at night) go to the first person, no further
  },
  // Security: people at the stall in the quiet hours (cameras whose
  // people-detection is trusted).
  security: { nightVisitors: true, quietFrom: 22, quietTo: 5 },
  // A PDF report for each horse every morning, of the night before.
  reports: { daily: false, hour: 7 },
  send: {                       // which alert groups are sent
    temperature: true, breathing: true, colic: true, casting: true, activity: true,
    vices: true, sleep: true, elimination: true, lameness: true, water: true, monitoring: true,
    foaling: true, security: true, heat: true,
  },
  sensitivity: 50,              // 0 calm … 50 balanced … 100 sensitive
  privacy: { consentAt: null, consentBy: null },
};

// Alert type -> send group. Types not listed are sent (fail open: an unknown
// new alert must not be silently muted).
const GROUPS = [
  ["temperature", /temperature/i],
  ["breathing", /respirat|breathing/i],
  ["casting", /cast/i],
  ["colic", /colic|lying down and getting up|rolling|flat on the side|manure/i],
  ["activity", /activity unusual/i],
  ["vices", /vice|weaving|box walking|head tossing/i],
  ["sleep", /lying-down time|lying down at night/i],
  ["elimination", /urination/i],
  ["lameness", /lameness/i],
  ["water", /water/i],
  ["foaling", /foaling/i],
  ["security", /person at the stall/i],
  ["heat", /heat in the stall|hot, humid/i],
  ["monitoring", /monitoring|device|camera not aimed|not reporting|edge box/i],
];

export function groupOf(type) {
  return GROUPS.find(([, re]) => re.test(type || ""))?.[0] ?? null;
}

const clampInt = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : dflt);
const str = (v) => (typeof v === "string" ? v.trim().slice(0, 120) : "");
const PHONE = /^\+[1-9]\d{7,14}$/;

/** Merge a PATCH into the current settings, validating every field. */
export function mergeSettings(cur, body, who) {
  const s = structuredClone(cur);
  const d = body?.delivery;
  if (d && typeof d === "object") {
    for (const k of ["instant", "digest", "escalation"]) if (typeof d[k] === "boolean") s.delivery[k] = d[k];
    if (d.digestHour !== undefined) s.delivery.digestHour = clampInt(d.digestHour, 0, 23, s.delivery.digestHour);
    if (d.escalateAfterMin !== undefined) s.delivery.escalateAfterMin = clampInt(d.escalateAfterMin, 5, 240, s.delivery.escalateAfterMin);
    if (d.recipients && typeof d.recipients === "object")
      for (const k of ["manager", "onCall", "vet"]) if (d.recipients[k] !== undefined) s.delivery.recipients[k] = str(d.recipients[k]);
    if (Array.isArray(d.chain))
      s.delivery.chain = d.chain.slice(0, 3).map((p, i) => ({
        role: str(p?.role) || DEFAULTS.delivery.chain[i]?.role || `Step ${i + 1}`,
        name: str(p?.name),
        // international form (+91…) or empty — anything else is not a number a phone network accepts
        phone: PHONE.test(String(p?.phone ?? "").replace(/[\s-]/g, "")) ? String(p.phone).replace(/[\s-]/g, "") : "",
        channel: ["call", "sms", "whatsapp"].includes(p?.channel) ? p.channel : "call",
      }));
    if (d.callAtMostEveryMin !== undefined) s.delivery.callAtMostEveryMin = clampInt(d.callAtMostEveryMin, 10, 720, s.delivery.callAtMostEveryMin);
    if (typeof d.warnToStaff === "boolean") s.delivery.warnToStaff = d.warnToStaff;
  }
  const sec = body?.security;
  if (sec && typeof sec === "object") {
    if (typeof sec.nightVisitors === "boolean") s.security.nightVisitors = sec.nightVisitors;
    if (sec.quietFrom !== undefined) s.security.quietFrom = clampInt(sec.quietFrom, 0, 23, s.security.quietFrom);
    if (sec.quietTo !== undefined) s.security.quietTo = clampInt(sec.quietTo, 0, 23, s.security.quietTo);
  }
  const rep = body?.reports;
  if (rep && typeof rep === "object") {
    if (typeof rep.daily === "boolean") s.reports.daily = rep.daily;
    if (rep.hour !== undefined) s.reports.hour = clampInt(rep.hour, 0, 23, s.reports.hour);
  }
  if (body?.send && typeof body.send === "object")
    for (const k of Object.keys(DEFAULTS.send)) if (typeof body.send[k] === "boolean") s.send[k] = body.send[k];
  if (body?.sensitivity !== undefined) s.sensitivity = clampInt(body.sensitivity, 0, 100, s.sensitivity);
  if (body?.privacy?.confirmConsent === true) s.privacy = { consentAt: new Date().toISOString(), consentBy: who || "admin" };
  if (body?.privacy?.clearConsent === true) s.privacy = { consentAt: null, consentBy: null };
  return s;
}

/** Stored settings with any newer defaults filled in. */
export function currentSettings(store) {
  const row = store.list("settings").find((r) => r.id === "site");
  if (!row) return structuredClone(DEFAULTS);
  return {
    ...structuredClone(DEFAULTS), ...row,
    delivery: { ...DEFAULTS.delivery, ...row.delivery, recipients: { ...DEFAULTS.delivery.recipients, ...row.delivery?.recipients },
      chain: DEFAULTS.delivery.chain.map((d, i) => ({ ...d, ...(row.delivery?.chain?.[i] ?? {}) })) },
    security: { ...DEFAULTS.security, ...row.security },
    reports: { ...DEFAULTS.reports, ...row.reports },
    send: { ...DEFAULTS.send, ...row.send },
    privacy: { ...DEFAULTS.privacy, ...row.privacy },
  };
}

export function saveSettings(store, s) {
  if (store.list("settings").some((r) => r.id === "site")) store.update("settings", "site", s);
  else store.create("settings", s);
  return currentSettings(store);
}

/** Activity-unusual multipliers from the sensitivity (50 = the tested default 2.0 / 0.4). */
export function activityBands(sensitivity) {
  const s = Math.max(0, Math.min(100, sensitivity ?? 50)) / 100;
  const hi = s <= 0.5 ? 3.0 - 2.0 * s : 2.0 - 1.0 * (s - 0.5);        // 3.0 … 2.0 … 1.5
  const lo = s <= 0.5 ? 0.25 + 0.3 * s : 0.4 + 0.3 * (s - 0.5);      // 0.25 … 0.4 … 0.55
  return { hi: Math.round(hi * 100) / 100, lo: Math.round(lo * 100) / 100 };
}
