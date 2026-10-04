// Phone calls, SMS and WhatsApp for the alert chain (server/notify.mjs).
//
//   TELEPHONY=twilio   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
//                      (a voice/SMS number), TWILIO_WHATSAPP_FROM (optional)
//   TELEPHONY=exotel   EXOTEL_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN,
//                      EXOTEL_SUBDOMAIN (api.exotel.com), EXOTEL_SENDER (SMS),
//                      EXOTEL_CALLER_ID + EXOTEL_FLOW_URL (voice; else SMS)
//   none set           the webhook (NOTIFY_WEBHOOK_URL) or the server log
//
// An account and a verified sender are a commercial step (Twilio worldwide,
// Exotel in India); until then nothing is dialled and the log says what
// would have been sent.
const E = () => process.env;

export function provider() {
  const e = E();
  if (e.TELEPHONY === "none") return null;
  if ((e.TELEPHONY === "twilio" || !e.TELEPHONY) && e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && e.TWILIO_FROM) return "twilio";
  if ((e.TELEPHONY === "exotel" || !e.TELEPHONY) && e.EXOTEL_SID && e.EXOTEL_API_KEY && e.EXOTEL_API_TOKEN) return "exotel";
  return null;
}

const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));
const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function post(url, auth, body) {
  try {
    const res = await fetch(url, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
      body, signal: AbortSignal.timeout(10000) });
    return res.ok ? "delivered" : `http ${res.status}`;
  } catch (e) {
    return `failed: ${e.message}`;
  }
}

/** channel: call | sms | whatsapp. Resolves to "delivered", "unsupported", "http …" or "failed: …". */
export async function sendTo({ phone, channel, text, voice }) {
  const p = provider(), e = E();
  if (p === "twilio") {
    const base = `https://api.twilio.com/2010-04-01/Accounts/${e.TWILIO_ACCOUNT_SID}`;
    const auth = basic(e.TWILIO_ACCOUNT_SID, e.TWILIO_AUTH_TOKEN);
    if (channel === "call")
      return post(`${base}/Calls.json`, auth, form({ To: phone, From: e.TWILIO_FROM,
        Twiml: `<Response><Say>${xml(voice || text)}</Say><Pause length="1"/><Say>${xml(voice || text)}</Say></Response>` }));
    if (channel === "whatsapp") {
      if (!e.TWILIO_WHATSAPP_FROM) return "unsupported";
      return post(`${base}/Messages.json`, auth, form({ To: `whatsapp:${phone}`, From: `whatsapp:${e.TWILIO_WHATSAPP_FROM}`, Body: text }));
    }
    return post(`${base}/Messages.json`, auth, form({ To: phone, From: e.TWILIO_FROM, Body: text }));
  }
  if (p === "exotel") {
    const host = e.EXOTEL_SUBDOMAIN || "api.exotel.com";
    const base = `https://${host}/v1/Accounts/${e.EXOTEL_SID}`;
    const auth = basic(e.EXOTEL_API_KEY, e.EXOTEL_API_TOKEN);
    if (channel === "call") {
      if (!e.EXOTEL_FLOW_URL || !e.EXOTEL_CALLER_ID) return "unsupported";
      return post(`${base}/Calls/connect`, auth, form({ From: phone, CallerId: e.EXOTEL_CALLER_ID, Url: e.EXOTEL_FLOW_URL }));
    }
    if (channel === "whatsapp") return "unsupported";
    return post(`${base}/Sms/send`, auth, form({ From: e.EXOTEL_SENDER, To: phone, Body: text }));
  }
  return "unsupported";
}
