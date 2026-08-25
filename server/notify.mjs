// Alert notification dispatch.
//
// The SPA's Settings page offers WhatsApp / digest / escalation toggles, but
// nothing was ever delivered. This closes that loop: newly-raised alerts are
// dispatched once each, through a pluggable transport.
//
// Transports are chosen by env so no vendor is baked in:
//   NOTIFY_WEBHOOK_URL   POST the alert as JSON (Slack, n8n, WhatsApp gateway…)
//   NOTIFY_MIN_SEVERITY  "alert" (default) | "warn" | "ok"
//   NOTIFY_DISABLED=1    log only
//
// Deliberately NOT included: a hardcoded WhatsApp Business or SMS integration.
// Those need an account, a verified sender and a message template, which is a
// commercial decision — the webhook lets you point at whatever you procure.

const RANK = { alert: 0, warn: 1, ok: 2 };
const MIN = process.env.NOTIFY_MIN_SEVERITY || "alert";
const WEBHOOK = process.env.NOTIFY_WEBHOOK_URL || "";
const DISABLED = process.env.NOTIFY_DISABLED === "1";

// Alert ids are stable and already day-scoped (`horse:type:YYYY-MM-DD`), so
// remembering what we sent prevents re-notifying the same condition every poll.
const sent = new Set();
let dropped = 0;

async function deliver(alert) {
  if (!WEBHOOK) return "logged";
  try {
    const res = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: alert.id, horse: alert.horse, severity: alert.severity,
        type: alert.type, detail: alert.detail, time: alert.time,
        source: "bsv-equicare",
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? "delivered" : `http ${res.status}`;
  } catch (e) {
    return `failed: ${e.message}`;
  }
}

/** Dispatch any alert not seen before. Safe to call on every alert build. */
export async function dispatch(alerts) {
  const fresh = alerts.filter(
    (a) => !a.acknowledged && !sent.has(a.id) && RANK[a.severity] <= RANK[MIN]
  );
  for (const a of fresh) {
    sent.add(a.id);
    if (DISABLED) { console.log(`[notify] (disabled) ${a.severity} ${a.horse}: ${a.type}`); continue; }
    const outcome = await deliver(a);
    console.log(`[notify] ${a.severity} ${a.horse}: ${a.type} -> ${outcome}`);
    if (outcome !== "delivered" && outcome !== "logged") dropped++;
  }
  // Bound the memo so a long-running process cannot grow without limit.
  if (sent.size > 5000) sent.clear();
  return fresh.length;
}

export const notifyStatus = () => ({
  transport: WEBHOOK ? "webhook" : "log-only",
  minSeverity: MIN,
  disabled: DISABLED,
  notified: sent.size,
  failed: dropped,
});
