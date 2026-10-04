// Alert notification dispatch — what the Settings page's "Alert delivery"
// switches actually do.
//
//   instant     each new alert, once, through the webhook, to the manager —
//               and, when the call chain has numbers, to its first person by
//               phone call, SMS or WhatsApp (server/telephony.mjs)
//   escalation  an alert still unacknowledged after N minutes is sent again to
//               the on-call person (the chain's second), after 2N to the vet
//               (its third). A text carries a signed "acknowledge" link that
//               works without signing in (/api/ack/<id>?s=…), which stops it.
//   watch notes with warnToStaff, a text (never a call) to the first person
//   digest      once a day at the chosen hour: every horse's status and the
//               alerts of the last 12 h
// Send switches per alert group decide what is sent; the app always shows
// everything. Delivery is a webhook (NOTIFY_WEBHOOK_URL) — point it at a
// WhatsApp Business gateway, Slack, n8n… with the recipients in the payload.
// A hardcoded WhatsApp integration needs an account, a verified sender and
// templates, which is a commercial decision, so none is baked in.
//
// A silent trial (delivery.trialUntil): until that date nothing is sent — the
// alerts show in the app as always, and staff mark each one right or wrong on
// the Events page, so the stable knows how often each kind is right before
// anyone's phone rings for it.
//
//   NOTIFY_WEBHOOK_URL   POST JSON here
//   NOTIFY_MIN_SEVERITY  "alert" (default) | "warn" | "ok" — for instant alerts
//   NOTIFY_DISABLED=1    log only
//   EQUICARE_PUBLIC_URL  the address staff phones open (acknowledge / events links)

import { groupOf } from "./settings.mjs";
import { sendTo, provider } from "./telephony.mjs";
import { sign } from "./secrets.mjs";

const RANK = { alert: 0, warn: 1, ok: 2 };
const env = () => ({
  min: process.env.NOTIFY_MIN_SEVERITY || "alert",
  webhook: process.env.NOTIFY_WEBHOOK_URL || "",
  disabled: process.env.NOTIFY_DISABLED === "1",
});

const S = (globalThis.__equicareNotify ??= {
  sent: new Map(),          // alert id -> { at, level }
  lastDigestDay: null,
  failed: 0, notified: 0, escalated: 0, digests: 0,
  send: null, clock: null,
  phone: null, lastCall: new Map(),   // number -> time of the last call
  calls: 0, texts: 0, phoneFailed: 0, trialHeld: 0,
});
S.trialHeld ??= 0;
S.lastCall ??= new Map();

async function webhook(payload) {
  const { webhook: url, disabled } = env();
  if (disabled || !url) return "logged";
  try {
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, source: "bsv-equicare" }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? "delivered" : `http ${res.status}`;
  } catch (e) {
    return `failed: ${e.message}`;
  }
}

/** Tests inject a transport and a clock. */
export function configureNotify({ send, clock, phone } = {}) {
  S.send = send ?? null;
  S.clock = clock ?? null;
  S.phone = phone ?? null;
}
export function resetNotify() {
  S.sent.clear();
  S.lastCall.clear();
  S.lastDigestDay = null;
  S.failed = S.notified = S.escalated = S.digests = 0;
  S.calls = S.texts = S.phoneFailed = S.trialHeld = 0;
}
const now = () => (S.clock ? S.clock() : Date.now());
async function send(payload) {
  const outcome = await (S.send ?? webhook)(payload);
  if (outcome !== "delivered" && outcome !== "logged") S.failed++;
  console.log(`[notify] ${payload.kind} ${payload.horse ?? ""} ${payload.type ?? ""} -> ${outcome}`);
  return outcome;
}

/** In the silent trial: alerts are shown and reviewed, not sent. */
export const inTrial = (settings, t = now()) => { const u = Date.parse(settings?.delivery?.trialUntil ?? ""); return Number.isFinite(u) && t < u; };
const allowed = (a, settings) => {
  const g = groupOf(a.type);
  return g === null || settings?.send?.[g] !== false;
};
const payloadOf = (a) => ({ id: a.id, horse: a.horse, severity: a.severity, type: a.type, detail: a.detail, time: a.time });

// ---- the call chain ------------------------------------------------------ //
const LEGACY = { 1: "manager", 2: "onCall", 3: "vet" };
/** The person at a level (1–3): the chain's entry when it has a number. */
const personAt = (d, level) => {
  const p = d?.chain?.[level - 1];
  return p?.phone ? p : null;
};
const toAt = (d, level) => personAt(d, level)?.phone || d?.recipients?.[LEGACY[level]] || null;

const publicUrl = () => (process.env.EQUICARE_PUBLIC_URL || "").replace(/\/+$/, "");
export const ackLink = (id) => (publicUrl() ? `${publicUrl()}/api/ack/${encodeURIComponent(id)}?s=${sign(id)}` : null);
export const ackValid = (id, s) => typeof s === "string" && s.length > 0 && s === sign(id);
const firstSentence = (t) => String(t ?? "").split(/(?<=\.)\s/)[0].slice(0, 200);

/** The words a phone gets: short, the horse first, a link to say "seen". */
export function messageOf(a, { level = 1, minutes = 0 } = {}) {
  const ack = ackLink(a.id), base = publicUrl();
  const text = [
    `EquiCare${level > 1 ? ` (not acknowledged for ${minutes} min)` : ""}: ${a.horse ?? "Stable"} — ${a.type}.`,
    firstSentence(a.detail),
    ack ? `Seen it? ${ack}` : "Acknowledge it in EquiCare.",
    base ? `Events: ${base}/events` : "",
  ].filter(Boolean).join("\n");
  const voice = `This is EquiCare. ${a.horse ?? "A horse"}: ${a.type.replace(/\s*—\s*/g, ", ")}. ` +
    (level > 1 ? `Nobody has acknowledged it for ${minutes} minutes. ` : "") +
    "Please check the horse now, and acknowledge it from the text message.";
  return { text, voice };
}

async function phoneSend(d, person, a, { level, minutes, textOnly = false }) {
  if (!person) return null;
  let channel = person.channel || "call";
  if (textOnly && channel === "call") channel = "sms";
  const every = (d.callAtMostEveryMin ?? 60) * 60000;
  // A phone that rang a minute ago gets a text: one person is not called again and again.
  if (channel === "call" && now() - (S.lastCall.get(person.phone) ?? -Infinity) < every) channel = "sms";
  const { text, voice } = messageOf(a, { level, minutes });
  const go = (ch) => (S.phone ?? sendTo)({ phone: person.phone, channel: ch, text, voice, role: person.role, alertId: a.id });
  let outcome = await go(channel);
  // A call needs a text too: the link to acknowledge is in the text.
  if (channel === "call" && outcome === "delivered") {
    S.lastCall.set(person.phone, now());
    S.calls++;
    await go("sms");
  } else if (outcome === "unsupported" && channel !== "sms") outcome = await go((channel = "sms"));
  if (outcome === "delivered" && channel !== "call") S.texts++;
  if (outcome !== "delivered" && outcome !== "unsupported") S.phoneFailed++;
  console.log(`[notify] ${channel} ${person.role || ""} ${a.horse ?? ""} ${a.type} -> ${outcome}`);
  return outcome;
}

/** Instant delivery of alerts not seen before. Safe to call on every alert build. */
export async function dispatch(alerts, settings = null) {
  const { min } = env();
  const d = settings?.delivery ?? { instant: true };
  const trial = inTrial(settings);
  const fresh = alerts.filter((a) => !a.acknowledged && !S.sent.has(a.id) && RANK[a.severity] <= RANK[min]);
  for (const a of fresh) {
    S.sent.set(a.id, { at: now(), level: 1 });
    if (d.instant === false || !allowed(a, settings)) continue;
    if (trial) { S.trialHeld++; console.log(`[notify] trial, not sent: ${a.horse ?? ""} ${a.type}`); continue; }
    await send({ kind: "alert", level: 1, to: toAt(d, 1), ...(personAt(d, 1) ? { role: personAt(d, 1).role } : {}), ...payloadOf(a) });
    await phoneSend(d, personAt(d, 1), a, { level: 1 });
    S.notified++;
  }
  // Watch notes (a person at night, a hot stall): a text to the first person.
  if (d.warnToStaff && d.instant !== false && personAt(d, 1)) {
    const notes = alerts.filter((a) => !a.acknowledged && !a.device && a.severity === "warn" && !S.sent.has(a.id) && RANK.warn > RANK[min]);
    for (const a of notes) {
      S.sent.set(a.id, { at: now(), level: 1, note: true });
      if (!allowed(a, settings)) continue;
      if (trial) { S.trialHeld++; continue; }
      await phoneSend(d, personAt(d, 1), a, { level: 1, textOnly: true });
    }
  }
  if (S.sent.size > 5000) S.sent.clear();
  return fresh.length;
}

/**
 * The server's once-a-minute tick: instant alerts, escalation, digest.
 * alerts: current alert list (with acknowledged flags); horses: summaries
 * [{ name, status, statusNote }].
 */
export async function tick({ alerts, horses = [], settings }) {
  await dispatch(alerts, settings);
  const d = settings?.delivery ?? {};
  const t = now();
  const trial = inTrial(settings, t);
  // Escalation: urgent alerts nobody acknowledged.
  if (d.escalation && !trial) {
    const open = new Map(alerts.filter((a) => !a.acknowledged).map((a) => [a.id, a]));
    for (const [id, rec] of S.sent) {
      const a = open.get(id);
      if (!a) continue;                                    // acknowledged or gone
      if (a.severity !== "alert" || !allowed(a, settings)) continue;
      const step = (d.escalateAfterMin || 15) * 60000;
      const due = rec.level === 1 ? rec.at + step : rec.level === 2 ? rec.at + 2 * step : Infinity;
      if (t >= due) {
        rec.level += 1;
        const minutes = Math.round((t - rec.at) / 60000);
        const person = personAt(d, rec.level);
        await send({ kind: "escalation", level: rec.level, to: toAt(d, rec.level), ...(person ? { role: person.role } : {}),
          note: `not acknowledged for ${minutes} min`, ...payloadOf(a) });
        await phoneSend(d, person, a, { level: rec.level, minutes });
        S.escalated++;
      }
    }
  }
  // Digest: once a day, at or after the chosen local hour.
  if (d.digest && !trial) {
    const local = new Date(t);
    const day = `${local.getFullYear()}-${local.getMonth() + 1}-${local.getDate()}`;
    if (local.getHours() >= (d.digestHour ?? 7) && S.lastDigestDay !== day) {
      S.lastDigestDay = day;
      const recent = alerts.filter((a) => !a.device);
      await send({
        kind: "digest", to: d.recipients?.manager || null, day,
        horses: horses.map((h) => ({ name: h.name, status: h.status, note: h.statusNote })),
        alerts: recent.map((a) => ({ horse: a.horse, severity: a.severity, type: a.type, acknowledged: !!a.acknowledged })),
        summary: `${horses.filter((h) => h.status === "urgent").length} urgent, ${horses.filter((h) => h.status === "watch").length} to watch, ` +
          `${recent.filter((a) => !a.acknowledged).length} open alerts`,
      });
      S.digests++;
    }
  }
}

export const notifyStatus = () => {
  const { webhook: url, min, disabled } = env();
  return { transport: url ? "webhook" : "log-only", minSeverity: min, disabled,
    phones: provider() ?? "not connected", publicUrl: publicUrl() || null,
    notified: S.notified, escalated: S.escalated, digests: S.digests, failed: S.failed,
    calls: S.calls, texts: S.texts, phoneFailed: S.phoneFailed, trialHeld: S.trialHeld };
};
