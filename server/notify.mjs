// Alert notification dispatch — what the Settings page's "Alert delivery"
// switches actually do.
//
//   instant     each new alert, once, through the webhook, to the manager
//   escalation  an alert still unacknowledged after N minutes is sent again to
//               the on-call person, after 2N to the vet
//   digest      once a day at the chosen hour: every horse's status and the
//               alerts of the last 12 h
// Send switches per alert group decide what is sent; the app always shows
// everything. Delivery is a webhook (NOTIFY_WEBHOOK_URL) — point it at a
// WhatsApp Business gateway, Slack, n8n… with the recipients in the payload.
// A hardcoded WhatsApp integration needs an account, a verified sender and
// templates, which is a commercial decision, so none is baked in.
//
//   NOTIFY_WEBHOOK_URL   POST JSON here
//   NOTIFY_MIN_SEVERITY  "alert" (default) | "warn" | "ok" — for instant alerts
//   NOTIFY_DISABLED=1    log only

import { groupOf } from "./settings.mjs";

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
});

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
export function configureNotify({ send, clock } = {}) {
  S.send = send ?? null;
  S.clock = clock ?? null;
}
export function resetNotify() {
  S.sent.clear();
  S.lastDigestDay = null;
  S.failed = S.notified = S.escalated = S.digests = 0;
}
const now = () => (S.clock ? S.clock() : Date.now());
async function send(payload) {
  const outcome = await (S.send ?? webhook)(payload);
  if (outcome !== "delivered" && outcome !== "logged") S.failed++;
  console.log(`[notify] ${payload.kind} ${payload.horse ?? ""} ${payload.type ?? ""} -> ${outcome}`);
  return outcome;
}

const allowed = (a, settings) => {
  const g = groupOf(a.type);
  return g === null || settings?.send?.[g] !== false;
};
const payloadOf = (a) => ({ id: a.id, horse: a.horse, severity: a.severity, type: a.type, detail: a.detail, time: a.time });

/** Instant delivery of alerts not seen before. Safe to call on every alert build. */
export async function dispatch(alerts, settings = null) {
  const { min } = env();
  const d = settings?.delivery ?? { instant: true };
  const fresh = alerts.filter((a) => !a.acknowledged && !S.sent.has(a.id) && RANK[a.severity] <= RANK[min]);
  for (const a of fresh) {
    S.sent.set(a.id, { at: now(), level: 1 });
    if (d.instant === false || !allowed(a, settings)) continue;
    await send({ kind: "alert", level: 1, to: d.recipients?.manager || null, ...payloadOf(a) });
    S.notified++;
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
  // Escalation: urgent alerts nobody acknowledged.
  if (d.escalation) {
    const open = new Map(alerts.filter((a) => !a.acknowledged).map((a) => [a.id, a]));
    for (const [id, rec] of S.sent) {
      const a = open.get(id);
      if (!a) continue;                                    // acknowledged or gone
      if (a.severity !== "alert" || !allowed(a, settings)) continue;
      const step = (d.escalateAfterMin || 15) * 60000;
      const due = rec.level === 1 ? rec.at + step : rec.level === 2 ? rec.at + 2 * step : Infinity;
      if (t >= due) {
        rec.level += 1;
        const to = rec.level === 2 ? d.recipients?.onCall : d.recipients?.vet;
        await send({ kind: "escalation", level: rec.level, to: to || null,
          note: `not acknowledged for ${Math.round((t - rec.at) / 60000)} min`, ...payloadOf(a) });
        S.escalated++;
      }
    }
  }
  // Digest: once a day, at or after the chosen local hour.
  if (d.digest) {
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
    notified: S.notified, escalated: S.escalated, digests: S.digests, failed: S.failed };
};
