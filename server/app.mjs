// BSV EquiCare backend — a Web-standard request handler (JSON store default;
// Postgres via DATABASE_URL). Served by the Next.js route handlers under
// src/app/{api,auth,ingest}; `handle(request) -> Response` is the whole API.
//   ingest:  POST /ingest/readings         (edge agent / devices -> cloud; device token)
//            POST /ingest/raw              (a wearable hub's raw motion recording)
//   query :  GET  /api/horses | /api/horses/:id | /api/alerts | /api/series
//            GET  /api/coverage             (which of the 12 points are live yet)
//            POST /api/alerts/:id/ack
//
// Auth (opt-in via env; unset => open, for the local demo):
//   AUTH_INGEST_TOKEN   required as `Authorization: Bearer <token>` on /ingest/*
//   AUTH_API_TOKEN      required as `Authorization: Bearer <token>` on /api/*
//
// The SIM hubs reach the site through a relay (server/relay.mjs, DEPLOY_CLOUD.md):
//   EQUICARE_RELAY_URL + EQUICARE_RELAY_KEY   pull from it every 15 s
//   EQUICARE_SENSOR_TICK_MS                   that tick (default 15000; 0 = off)
//   EQUICARE_RAW_DAYS                         raw recordings kept (default 30)
//
// Run:  npm run dev   /   npm run build && npm start   (port 8080)

import { isKnownMetric, coverage, dedupKey } from "./contract.mjs";
import { createStore, dataDir } from "./store.mjs";
import { dispatch, notifyStatus, tick } from "./notify.mjs";
import { currentSettings, mergeSettings, saveSettings, activityBands } from "./settings.mjs";
import { sessionReport } from "./session.mjs";
import { clientReport, safeTimeZone } from "./client_report.mjs";
import { insightsApi } from "./insights-api.mjs";
import { htmlToPdf } from "./pdf.mjs";
import { compare as baselineCompare } from "./baseline.mjs";
import { ensureAdmin, createSession, getSession, destroySession, sessionCount,
         verifyPassword, hashPassword, publicUser, ROLES } from "./auth.mjs";
import {
  summarizeHorse, buildAlerts, buildSeries, vitalsForHorse, metricSeries, behaviourForHorse, configureRollup,
} from "./rollup.mjs";
// The wearable / stall-sensor summaries (motionForHorse, intakeForHorse) are
// looked up on the module, so a rollup without them yet still serves.
import * as rollupModule from "./rollup.mjs";
import { LABELS, listClips, clipPath, serveFile, h264Copy, validateLabel, labelsCsv, frameGrabber,
  BOX_LABELS, validateBox, boxesExport, labellingQueue } from "./footage.mjs";
import { randomBytes as footageRandom } from "node:crypto";
import { SC_IT6420_HB_V2 } from "./hardware-spec.mjs";
import { knowledge } from "./knowledge.mjs";
import { deviceApi } from "./devices.mjs";
import { adapt, AdapterError, DEFAULT_FORMAT, isKnownFormat, knownFormats } from "./adapters.mjs";
import { rawStore, RawError, MAX_RAW_BYTES } from "./raw.mjs";
import { gunzipSync } from "node:zlib";

import SEED_ROSTER from "./roster.mjs";

const INGEST_TOKEN = process.env.AUTH_INGEST_TOKEN || "";
const API_TOKEN = process.env.AUTH_API_TOKEN || "";

// One store per process, created on the first request — not at import time.
// Two reasons. Next.js may evaluate this module more than once (per route
// bundle, and again on every dev reload); keeping the instance on globalThis
// means they all share it rather than racing writes into the same state file.
// And a process that never serves a request (a second `next start` that failed
// to bind) never touches the state at all — the property the old
// bind-before-seed ordering existed to protect.
const G = (globalThis.__equicare ??= {});
let store;
async function ready() {
  G.ready ??= (async () => {
    const s = await createStore();
    s.seed("horses", SEED_ROSTER);
    ensureAdmin(s);   // first boot only; prints a generated password once
    G.devices = deviceApi({ store: s, json, CORS });
    G.insights = insightsApi({ store: s, json, CORS, roster: () => s.list("horses") });
    G.devices.migrate();           // camera-only records from the first hardware version
    // A leg recording waits for the hub's own (head) recording, and the
    // pelvis sensor's when the hub has one paired.
    G.raw = rawStore({ store: s, dataDir: dataDir(), expectedSensors: (sess) => {
      const hub = s.list("devices").find((d) => d.id === sess.deviceId);
      return ["head", ...(hub?.sensors?.pelvis?.length ? ["pelvis"] : [])];
    } });
    configureRollup({ activity: activityBands(currentSettings(s).sensitivity) });
    // Escalation and the daily digest must run with nobody's browser open:
    // a server tick, once a minute (EQUICARE_NOTIFY_TICK_MS=0 turns it off).
    const every = Number(process.env.EQUICARE_NOTIFY_TICK_MS ?? 60000);
    if (every > 0 && !G.notifyTimer) {
      G.notifyTimer = setInterval(() => {
        const all = s.allReadings(), horses = s.list("horses");
        const alerts = buildAlerts(horses, all, s.isAcked);
        if (G.devices?.deviceAlerts) alerts.push(...G.devices.deviceAlerts(s.isAcked));
        tick({ alerts, horses: horses.map((h) => ({ name: h.name, ...summarizeHorse(h, all) })), settings: currentSettings(s) })
          .catch((e) => console.error("[notify]", e.message));
      }, every);
      G.notifyTimer.unref?.();
    }
    // The wearable side: pull the relay, analyse raw recordings, prune them.
    const sensorEvery = Number(process.env.EQUICARE_SENSOR_TICK_MS ?? 15000);
    if (sensorEvery > 0 && !G.sensorTimer) {
      G.sensorTimer = setInterval(() => sensorTick().catch((e) => console.error("[sensors]", e.message)), sensorEvery);
      G.sensorTimer.unref?.();
    }
    const st = s.statsSummary();
    console.log(`[equicare] store=${st.backend} auth=${API_TOKEN ? "token+sessions" : "sessions"} roster=${s.list("horses").length}`);
    return s;
  })();
  store = await G.ready;
  return store;
}

// The roster is DATA, not a frozen file: seeded from roster.json on first boot,
// then owned by the store. This is what makes a horse added in the UI actually
// get monitored — previously the rollup only ever saw the seed file.
const roster = () => store.list("horses");

// Record kinds the SPA can create/update/delete. Each is a plain collection;
// adding one here is the only change needed to expose a new record type.
const KINDS = {
  horses:    { path: "horses",    required: ["name"] },
  diary:     { path: "diary",     required: ["horse", "note"] },
  // Not "/api/health": that is the server's status check, which answered
  // every request there — health tasks were never saved.
  health:    { path: "health-tasks", required: ["horse", "type"] },
  feed:      { path: "feed",      required: ["horse", "feed"] },
  invoices:  { path: "invoices",  required: ["owner", "amount"] },
  coverings: { path: "coverings", required: ["mare", "stallion"] },
  stallions: { path: "stallions", required: ["name"] },
  users:     { path: "users",     required: ["username"], adminOnly: true },
};

// Defaults so a horse created from the UI satisfies the SPA's Horse type even
// before any sensor reading exists for it.
const HORSE_DEFAULTS = {
  breed: "—", age: "—", sex: "Mare", stall: "—", owner: "—",
  photo: "https://images.unsplash.com/photo-1598974357801-cbca100e65d3?auto=format&fit=crop&w=600&q=70",
};

// --------------------------------------------------------------------------- //
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};
const json = (code, body) =>
  code === 204
    ? new Response(null, { status: 204, headers: CORS })
    : new Response(JSON.stringify(body), {
        status: code,
        headers: { "Content-Type": "application/json", ...CORS },
      });
const bearer = (req) => (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
const authed = (req, token) => !token || bearer(req) === token;   // machine tokens (edge ingest)

// Browser auth: a bearer token is a session token issued by /auth/login.
// AUTH_API_TOKEN remains accepted for machine/server-to-server access.
function principal(req) {
  const tok = bearer(req);
  if (!tok) return null;
  if (API_TOKEN && tok === API_TOKEN) return { role: "admin", name: "service", service: true };
  return getSession(tok);
}

// When no users exist and no API token is set, the API stays open — that is the
// local-demo posture. As soon as either is configured, /api/* requires a caller.
const authRequired = () => Boolean(API_TOKEN) || store.list("users").length > 0;
// RFC-4180 quoting, plus a leading apostrophe on anything a spreadsheet would
// treat as a formula. Without it a crafted value like =HYPERLINK(...) in a
// horse name or note becomes executable when the vet opens the file in Excel.
function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns, rows) {
  const head = columns.join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(","));
  return [head, ...body].join("\r\n") + "\r\n";
}

const slugId = (name, kind) => {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return base || `${kind}-${Date.now()}`;
};
const bioById = (id) => roster().find((h) => h.id === id);

// --------------------------------------------------------------------------- //
// Ingest — one path for everything a device sends, whether it arrives here
// directly or through the relay (which hands over the sender's token hash).
// --------------------------------------------------------------------------- //
const MAX_READINGS_BODY = 16 * 1024 * 1024;       // a 2000-reading edge flush is ~600 kB
const MAX_UNZIPPED = 64 * 1024 * 1024;

/** A request body, refusing to hold more than `max` bytes of it. */
async function readLimited(req, max) {
  const len = Number(req.headers.get("content-length"));
  if (Number.isFinite(len) && len > max) throw Object.assign(new Error("too large"), { status: 413 });
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { reader.cancel().catch(() => {}); throw Object.assign(new Error("too large"), { status: 413 }); }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks);
}

/** Text of a readings body; `Content-Encoding: gzip` saves a SIM hub data. */
function bodyText(bytes, headers) {
  const gz = /gzip/i.test(headers.get("content-encoding") || "") && bytes[0] === 0x1f && bytes[1] === 0x8b;
  return (gz ? gunzipSync(bytes, { maxOutputLength: MAX_UNZIPPED }) : bytes).toString("utf8");
}

/**
 * Readings from `sender` (a device principal, or null on the legacy ingest
 * path): decoded by format, attributed by the registry, de-duplicated,
 * stored. Returns { status, body }.
 */
function ingestReadings({ headers, bytes, sender }) {
  const devices = G.devices;
  const format = headers.get("x-equicare-format") || DEFAULT_FORMAT;
  if (!isKnownFormat(format))
    return { status: 400, body: { error: `unknown payload format "${format.slice(0, 60)}"`, formats: knownFormats() } };
  let batch;
  try {
    batch = adapt(format, bodyText(bytes, headers));
  } catch (e) {
    if (e instanceof AdapterError) return { status: 400, body: { error: e.message, ...(e.detail ? { detail: e.detail } : {}) } };
    return { status: 400, body: { error: "the body could not be read", detail: String(e.message) } };
  }
  // The registry decides whose readings they are: a device token's horseId
  // claims are removed here (devices.attribute), only the legacy path keeps them.
  const { clean: known, rejected } = devices.attribute(batch.filter((r) => r && isKnownMetric(r.metric)), sender);

  // A camera knows its STALL, not which horse is standing in it, and horses
  // change stalls routinely. Resolve stall -> horse here, against the
  // current roster, so the edge never has to hardcode that mapping.
  const byStall = new Map(roster().filter((h) => h.stall).map((h) => [h.stall, h.id]));
  const unattributed = [];
  const clean = [];
  for (const r of known) {
    if (r.horseId) { clean.push(r); continue; }
    const horseId = r.stallId ? byStall.get(r.stallId) : undefined;
    if (horseId) clean.push({ ...r, horseId });
    // Previously a stall-only reading was counted as accepted and then
    // silently never reached any horse — a fever could vanish. Report it.
    else unattributed.push(r.stallId ?? null);
  }
  // Calibration cross-check. The edge agent tags readings taken through
  // default ROIs, but it cannot know the camera was moved after it was
  // aimed — the Hardware page does (rois.stale). Either source saying
  // "uncalibrated" wins: the cost of wrongly flagging is a warning, the
  // cost of wrongly trusting is a false clinical alarm.
  const camByStall = new Map(store.list("devices").filter((d) => d.kind === "thermal_camera").map((c) => [c.stall, c]));
  for (const r of clean) {
    // A reading from a known device was already judged by THAT device's
    // calibration; the stall lookup is only for senders that don't say
    // which camera they are (the command-line edge agent).
    if (r.deviceId || r.source !== "thermal_camera" || !r.stallId) continue;
    const cam = camByStall.get(r.stallId);
    if (cam && (!cam.rois || cam.rois.stale)) r.meta = { ...(r.meta || {}), calibrated: false };
  }
  // A device re-sending what it already sent (a retry after a timeout, the
  // relay after a lost ack) is recognised by the key and stored once.
  for (const r of clean) {
    r.ts ??= new Date().toISOString();
    r.meta = { ...(r.meta || {}) };
    const k = dedupKey(r);
    if (k) r.meta.dedupKey = k; else delete r.meta.dedupKey;
  }
  const stats = {};
  const accepted = store.appendReadings(clean, stats);
  const resBody = { accepted, dropped: batch.length - known.length - rejected.length, duplicates: stats.duplicates || 0 };
  if (rejected.length) { resBody.rejected = rejected.length; resBody.rejections = rejected.slice(0, 20); }
  if (unattributed.length) {
    resBody.unattributed = unattributed.length;
    resBody.unknownStalls = [...new Set(unattributed)];
    console.warn(`[ingest] ${unattributed.length} reading(s) with no horse for stall(s): ${resBody.unknownStalls.join(", ")}`);
  }
  return { status: 200, body: resBody };
}

/** A raw motion recording from a wearable hub (server/raw.mjs). */
function ingestRaw({ headers, bytes, sender }) {
  if (sender?.kind !== "wearable_hub")
    return { status: 403, body: { error: "only a wearable hub uploads raw motion recordings" } };
  const horse = bioById(sender.horseId);
  if (!horse) return { status: 409, body: { error: "this wearable's horse is no longer in the roster — edit the wearable" } };
  let out;
  try {
    out = G.raw.upload({ horseId: horse.id, deviceId: sender.id, headers, bytes });
  } catch (e) {
    if (e instanceof RawError) return { status: e.status, body: { error: e.message } };
    throw e;
  }
  store.update("devices", sender.id, { lastSeen: new Date().toISOString() });
  // Analysed in the background (and on the tick): the upload is answered now.
  if (out.status === 201) setImmediate(() => G.raw.processPending().catch((e) => console.error("[raw]", e.message)));
  return out;
}

// ---- the relay (SIM hubs -> relay in India -> this server) ----------------- //
const relayConf = () => {
  const url = process.env.EQUICARE_RELAY_URL, key = process.env.EQUICARE_RELAY_KEY;
  return url && key ? { url: url.replace(/\/+$/, ""), key } : null;
};
G.relay ??= { lastPullAt: null, lastOkAt: null, lastError: null, received: 0, rejected: 0, busy: null };

/** One item the relay held: through the same ingest path as a direct send,
 *  as the device whose token it came with. "retry" leaves it on the relay. */
function relayItem(it) {
  const sender = G.devices.deviceByTokenHash(it.tokenHash);
  const tag = `[relay] item ${String(it.id).slice(0, 40)}`;
  if (!sender) { console.warn(`${tag} rejected: unknown or revoked device token`); return "rejected"; }
  let headers;
  try { headers = new Headers(Object.entries(it.headers || {}).filter(([, v]) => typeof v === "string")); }
  catch { console.warn(`${tag} rejected: unusable headers`); return "rejected"; }
  const bytes = Buffer.from(String(it.body ?? ""), it.encoding === "base64" ? "base64" : "utf8");
  let res;
  try {
    res = it.kind === "raw" ? ingestRaw({ headers, bytes, sender }) : ingestReadings({ headers, bytes, sender });
  } catch (e) {
    console.error(`${tag} failed, will retry: ${e.message}`);
    return "retry";
  }
  if (res.status >= 500) return "retry";
  if (res.status >= 400) { console.warn(`${tag} from "${sender.name}" rejected: ${res.body?.error}`); return "rejected"; }
  return "ok";
}

/** Pull everything waiting on the relay, ingest it, ack it. */
export async function pullRelay() {
  const conf = relayConf();
  if (!conf) return null;
  await ready();
  G.relay.busy ??= (async () => {
    const st = G.relay;
    const auth = { Authorization: `Bearer ${conf.key}` };
    let got = 0, rejected = 0;
    try {
      for (let round = 0; round < 10; round++) {
        st.lastPullAt = new Date().toISOString();
        const res = await fetch(`${conf.url}/relay/pull?max=500`, { headers: auth, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`the relay answered HTTP ${res.status}`);
        const { items = [] } = await res.json();
        const ack = [];
        for (const it of items) {
          const outcome = relayItem(it);
          if (outcome === "retry") continue;
          ack.push(it.id);
          if (outcome === "rejected") rejected++; else got++;
        }
        if (ack.length) {
          const a = await fetch(`${conf.url}/relay/ack`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" },
            body: JSON.stringify({ ids: ack }), signal: AbortSignal.timeout(30_000) });
          if (!a.ok) throw new Error(`the relay refused the ack (HTTP ${a.status})`);
        }
        if (items.length < 500 || ack.length < items.length) break;
      }
      st.lastOkAt = new Date().toISOString(); st.lastError = null;
    } catch (e) {
      st.lastError = String(e.message || e).slice(0, 200);
      console.error("[relay] pull failed:", st.lastError);
    } finally {
      st.received += got; st.rejected += rejected; st.busy = null;
    }
    return { received: got, rejected };
  })();
  return G.relay.busy;
}

async function sensorTick() {
  await ready();
  if (relayConf()) await pullRelay();
  await G.raw.processPending();
  if (Date.now() - (G.rawPrunedAt ?? 0) > 3600_000) { G.raw.prune(); G.rawPrunedAt = Date.now(); }
}

// --------------------------------------------------------------------------- //
export async function handle(req) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (method === "OPTIONS") return json(204, {});

  // Serverless (Vercel) cannot host this backend: readings and sessions live in
  // one long-running process, and cameras sit on the barn LAN. Say so plainly
  // rather than half-work — the browser treats 503 as "no backend" and runs the
  // mock-data demo. The real deployment is `next start` on the site server.
  if (process.env.VERCEL && !process.env.EQUICARE_ALLOW_SERVERLESS)
    return json(503, {
      error: "backend not available on serverless hosting",
      detail: "Run the app with `next start` on the site's own server.",
      authRequired: false,
    });

  try {
    await ready();
    // /health is now a page (Health Scheduling) on the same origin, so the
    // service health check moved under /api. It is answered before the auth
    // gate on purpose: monitoring must be able to poll it without a session.
    // storage: how full the reading store is, and advice when it is dropping
    // readings (the Hardware page shows it). relay: only when one is set up.
    if (path === "/api/health") {
      const { busy, ...relay } = G.relay;
      return json(200, { ok: true, ...store.statsSummary(), sessions: sessionCount(), authRequired: authRequired(),
        storage: store.storage?.() ?? null, ...(relayConf() ? { relay } : {}) });
    }
    if (path === "/api/coverage") return json(200, coverage());
    if (path === "/api/knowledge" && method === "GET") return json(200, knowledge());
    const devices = G.devices;
    if (!devices) return json(503, { error: "server initialising, retry in a moment" });

    // ---- edge boxes (their own token) ------------------------------------ //
    if (path.startsWith("/edge/")) return devices.handleEdge(req, url);

    // ---- ingest (edge -> cloud) ------------------------------------------ //
    if (path === "/ingest/readings" && method === "POST") {
      // Who is sending? An edge box or push device (its own token), or the
      // legacy shared AUTH_INGEST_TOKEN. Ingest is open only on a bare dev
      // setup — no shared token AND no device tokens issued yet.
      const sender = devices.deviceByToken(bearer(req));
      const legacyOk = INGEST_TOKEN ? bearer(req) === INGEST_TOKEN : !devices.anyDeviceTokens();
      if (!sender && !legacyOk) return json(401, { error: "unauthorized" });
      let bytes;
      try { bytes = await readLimited(req, MAX_READINGS_BODY); }
      catch (e) { if (e.status === 413) return json(413, { error: `a readings batch is at most ${MAX_READINGS_BODY / 1048576} MB — send smaller batches` }); throw e; }
      const r = ingestReadings({ headers: req.headers, bytes, sender });
      return json(r.status, r.body);
    }

    // ---- raw motion recordings (a wearable hub's own token) --------------- //
    if (path === "/ingest/raw" && method === "POST") {
      const sender = devices.deviceByToken(bearer(req));
      if (!sender) return json(401, { error: "unauthorized — a wearable hub's device token is required" });
      let bytes;
      try { bytes = await readLimited(req, MAX_RAW_BYTES); }
      catch (e) { if (e.status === 413) return json(413, { error: `an upload is at most ${MAX_RAW_BYTES / 1048576} MB` }); throw e; }
      const r = ingestRaw({ headers: req.headers, bytes, sender });
      return json(r.status, r.body);
    }

    // ---- authentication ------------------------------------------------- //
    if (path === "/auth/login" && method === "POST") {
      let body;
      try { body = JSON.parse((await req.text()) || "{}"); }
      catch { return json(400, { error: "malformed JSON" }); }
      const u = store.list("users").find((x) => x.username === body.username);
      // Verify even when the user is unknown, so response time does not reveal
      // whether a username exists.
      const ok = verifyPassword(body.password || "", u?.password || "scrypt$0$0");
      if (!u || !ok) return json(401, { error: "invalid username or password" });
      const s = createSession(u);
      return json(200, { ...s, user: publicUser(u) });
    }

    if (path === "/auth/logout" && method === "POST") {
      destroySession(bearer(req));
      return json(200, { ok: true });
    }

    if (path === "/auth/me" && method === "GET") {
      const p = principal(req);
      return p ? json(200, { user: p, authRequired: authRequired() })
               : json(401, { error: "not signed in", authRequired: authRequired() });
    }

    // ---- recorded footage: the video files themselves --------------------- //
    // A <video> element cannot send an Authorization header, and seeking needs
    // direct range requests, so clips are played with a short-lived ticket
    // issued to a logged-in admin or staff user (GET /api/footage/ticket).
    const fv = path.match(/^\/api\/footage\/video\/([^/]+)\/(thermal|visible)\/([^/]+)$/);
    if (fv && method === "GET") {
      const t = G.videoTickets?.get(url.searchParams.get("vt") || "");
      if (!t || t.exp < Date.now()) return json(401, { error: "video ticket missing or expired — reopen the footage page" });
      const file = clipPath(decodeURIComponent(fv[1]), fv[2], decodeURIComponent(fv[3]));
      if (!file) return json(404, { error: "no such clip" });
      try {
        const served = url.searchParams.get("format") === "h264" ? await h264Copy(file) : file;
        return serveFile(req, served, "video/mp4", CORS);
      } catch (e) {
        return json(502, { error: e.message });
      }
    }

    // A short clip around a moment (events, accuracy checks): <video> again, so a ticket.
    if (path === "/api/clip" && method === "GET") return G.insights.clip(req, url, G.videoTickets);

    // ---- query (SPA -> cloud) -------------------------------------------- //
    const who = principal(req);
    if (path.startsWith("/api/") && authRequired() && !who)
      return json(401, { error: "unauthorized" });

    // Owners get a read-only view; only admins may touch user accounts.
    if (path.startsWith("/api/") && who) {
      if (who.role === "owner" && method !== "GET")
        return json(403, { error: "read-only account" });
      if (path.startsWith("/api/users") && who.role !== "admin")
        return json(403, { error: "admin only" });
      // Camera credentials, network addresses and snapshots are infrastructure.
      // Staff may see the list and live readings; everything else is admin.
      const devRead = method === "GET" && (path === "/api/devices" || /^\/api\/devices\/[^/]+\/(temps|events)$/.test(path));
      if (path.startsWith("/api/devices") && who.role === "staff" && !devRead)
        return json(403, { error: "admin only" });
      // Owners get the list (status for their own horses' stalls) and nothing
      // else — "GET" alone would have let them pull any camera's snapshot.
      if (path.startsWith("/api/devices/") && who.role === "owner")
        return json(404, { error: "not found" });
      // Stall footage is for the yard's own people, not owners.
      if (path.startsWith("/api/footage") && who.role === "owner")
        return json(404, { error: "not found" });
    }

    // An owner account sees only its own horses. The SPA also hides other
    // owners, but that is presentation — this is the actual access control.
    const visibleRoster = () =>
      who?.role === "owner" ? roster().filter((h) => h.owner === who.owner) : roster();

    if (path === "/api/horses" && method === "GET") {
      const all = store.allReadings();
      return json(200, visibleRoster().map((bio) => summarizeHorse(bio, all)));
    }

    const detail = path.match(/^\/api\/horses\/([^/]+)$/);
    if (detail && method === "GET") {
      const bio = bioById(detail[1]);
      if (!bio) return json(404, { error: "unknown horse" });
      // 404 rather than 403: do not confirm the existence of another owner's horse
      if (who?.role === "owner" && bio.owner !== who.owner)
        return json(404, { error: "unknown horse" });
      const rd = store.readingsForHorse(bio.id);
      const helper = (name) => (typeof rollupModule[name] === "function" ? rollupModule[name] : () => null);
      return json(200, {
        ...summarizeHorse(bio, store.allReadings()),
        vitals: vitalsForHorse(rd),
        behaviour: behaviourForHorse(rd),
        // Wearable (steps, lameness, exercise) and stall sensors (water, feed,
        // hay); null when the horse has none of those readings.
        motion: helper("motionForHorse")(rd),
        intake: helper("intakeForHorse")(rd),
        charts: {
          body_temp_c: metricSeries(rd, "body_temp_c", 7, "avg"),
          respiratory_rate_bpm: metricSeries(rd, "respiratory_rate_bpm", 7, "avg"),
          // null stays null: a day without data is not 0 hours of rest.
          rest_hours: metricSeries(rd, "rest_minutes", 7, "sum").map((m) => (m === null ? null : +(m / 60).toFixed(1))),
          inactive_hours: metricSeries(rd, "inactive_minutes", 7, "sum").map((m) => (m === null ? null : +(m / 60).toFixed(1))),
          lying_hours: metricSeries(rd, "lying_minutes", 7, "sum").map((m) => (m === null ? null : +(m / 60).toFixed(1))),
          activity_index: metricSeries(rd, "activity_index", 7, "avg"),
          feed_intake_g: metricSeries(rd, "feed_intake_g", 7, "sum"),
          feed_refusal_g: metricSeries(rd, "feed_refusal_g", 7, "sum"),
          water_ml: metricSeries(rd, "water_ml", 7, "sum"),
        },
      });
    }

    if (path === "/api/alerts" && method === "GET") {
      const alerts = buildAlerts(visibleRoster(), store.allReadings(), store.isAcked);
      // Hardware that stopped working, for the people who can fix it.
      if (who?.role !== "owner" && devices?.deviceAlerts)
        alerts.push(...devices.deviceAlerts(store.isAcked));
      dispatch(alerts, currentSettings(store)).catch((e) => console.error("[notify]", e.message));
      return json(200, alerts);
    }

    const ack = path.match(/^\/api\/alerts\/(.+)\/ack$/);
    if (ack && method === "POST") { store.ackAlert(decodeURIComponent(ack[1])); return json(200, { ok: true }); }

    if (path === "/api/series" && method === "GET") {
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7));
      // ?horse=<id>: one horse's own series (the Reports page), not the yard's.
      const horseId = url.searchParams.get("horse");
      if (horseId) {
        const bio = bioById(horseId);
        if (!bio || (who?.role === "owner" && bio.owner !== who.owner)) return json(404, { error: "unknown horse" });
        return json(200, buildSeries([bio], store.readingsForHorse(bio.id), days));
      }
      return json(200, buildSeries(roster(), store.allReadings(), days));
    }

    if (path === "/api/notify/status" && method === "GET")
      return json(200, notifyStatus());

    // ---- session report: the 8 points over a window (a practice demo, a night) --- //
    if (path === "/api/session" && method === "GET") {
      if (who?.role === "owner") return json(404, { error: "not found" });
      const bio = roster().find((h) => h.id === url.searchParams.get("horse"));
      if (!bio) return json(400, { error: "choose a horse" });
      const to = Date.parse(url.searchParams.get("to") || "") || Date.now();
      const from = Date.parse(url.searchParams.get("from") || "") || to - 60 * 60000;
      if (!(from < to) || to - from > 7 * 24 * 3600 * 1000) return json(400, { error: "the window must be between a minute and 7 days" });
      const rd = store.readingsForHorse(bio.id);
      const cams = new Set(rd.map((r) => r.meta?.deviceId).filter(Boolean));
      const clips = listClips().filter((c) => cams.has(c.camera));
      const alerts = buildAlerts([bio], store.allReadings(), store.isAcked);
      const camDevs = store.list("devices").filter((d) => cams.has(d.id));
      const floorWatched = camDevs.length ? camDevs.some((d) => d.rois?.floor || d.rois?.colourFloor) : null;
      return json(200, sessionReport({ readings: rd, from, to, clips, alerts, floorWatched,
        horse: { id: bio.id, name: bio.name, stall: bio.stall } }));
    }

    // ---- client report: the designed A4 report for a horse's owner or vet --- //
    // POST { horse, from, to, notes, tz } -> text/html (print it to save a PDF).
    if (path === "/api/session/report" && method === "POST") {
      if (who?.role === "owner") return json(404, { error: "not found" });
      let body;
      try { body = JSON.parse((await req.text()) || "{}"); } catch { return json(400, { error: "malformed JSON" }); }
      const bio = roster().find((h) => h.id === body.horse);
      if (!bio) return json(400, { error: "choose a horse" });
      const to = Math.min(Date.parse(body.to || "") || Date.now(), Date.now());
      const from = Date.parse(body.from || "") || to - 60 * 60000;
      if (!(from < to) || to - from > 7 * 24 * 3600 * 1000) return json(400, { error: "the window must be between a minute and 7 days" });
      const rd = store.readingsForHorse(bio.id);
      const cams = new Set(rd.filter((r) => { const t = Date.parse(r.ts); return t >= from && t <= to; }).map((r) => r.meta?.deviceId).filter(Boolean));
      const camDevs = store.list("devices").filter((d) => cams.has(d.id));
      const cam = camDevs[0] || store.list("devices").find((d) => d.kind === "thermal_camera" && d.stall === bio.stall) || null;
      const clips = cam ? listClips().filter((c) => c.camera === cam.id && Date.parse(c.end) >= from && Date.parse(c.at) <= to) : [];
      const { html } = await clientReport({
        horse: { id: bio.id, name: bio.name, stall: bio.stall }, readings: rd, from, to,
        floorWatched: camDevs.length ? camDevs.some((d) => d.rois?.floor || d.rois?.colourFloor) : cam ? Boolean(cam.rois?.floor || cam.rois?.colourFloor) : null,
        notes: typeof body.notes === "string" ? body.notes : "", tz: body.tz,
        grab: cam && clips.length ? frameGrabber(cam.id, "visible") : null,
        clipCount: clips.reduce((n, c) => n + (c.thermal ? 1 : 0) + (c.visible ? 1 : 0), 0),
        baseline: baselineCompare(bio, rd, { tz: safeTimeZone(body.tz), from, to }),
        autoVisits: camDevs.every((d) => d.peopleTrusted !== false),
      });
      if (url.searchParams.get("format") === "pdf") {
        try {
          const pdf = await htmlToPdf(html);
          const name = `${bio.name.replace(/[^A-Za-z0-9 _-]/g, "")} - EquiCare report ${new Date(from).toISOString().slice(0, 10)}.pdf`;
          return new Response(pdf, { status: 200, headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store",
            "Content-Disposition": `attachment; filename="${name}"`, ...CORS } });
        } catch (e) {
          return json(501, { error: e.message });
        }
      }
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...CORS } });
    }

    // ---- site settings (what the Settings page switches really do) -------- //
    if (path === "/api/settings") {
      // Recipients' numbers are staff business, not owners'.
      if (who?.role === "owner") return json(404, { error: "not found" });
      if (method === "GET") return json(200, { ...currentSettings(store), notify: notifyStatus() });
      if (method === "PATCH") {
        if (who && who.role !== "admin") return json(403, { error: "admin only" });
        let body;
        try { body = JSON.parse((await req.text()) || "{}"); } catch { return json(400, { error: "malformed JSON" }); }
        const next = saveSettings(store, mergeSettings(currentSettings(store), body, who?.name || who?.username));
        configureRollup({ activity: activityBands(next.sensitivity) });
        return json(200, { ...next, notify: notifyStatus() });
      }
      return json(405, { error: "method not allowed" });
    }

    // ---- CSV export ------------------------------------------------------ //
    // GET /api/export/readings.csv?horse=<id>&days=N&metric=<m>
    if (path === "/api/export/readings.csv" && method === "GET") {
      const horseId = url.searchParams.get("horse");
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30));
      const metric = url.searchParams.get("metric");
      const cutoff = Date.now() - days * 24 * 3600 * 1000;

      const allowed = new Set(visibleRoster().map((h) => h.id));
      if (horseId && !allowed.has(horseId))
        return json(404, { error: "unknown horse" });

      const rows = store.allReadings().filter((r) =>
        Date.parse(r.ts) >= cutoff &&
        (horseId ? r.horseId === horseId : allowed.has(r.horseId)) &&
        (!metric || r.metric === metric));

      const csv = toCsv(
        ["ts", "horseId", "stallId", "metric", "value", "unit", "source", "confidence"],
        rows);
      const name = `equicare-${horseId || "all"}-${days}d.csv`;
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}"`,
          ...CORS,
        },
      });
    }

    // ---- raw motion recordings (wearable hubs) ----------------------------- //
    // GET /api/raw?horse=<id>: what was uploaded and what the analysis made
    // of it. The yard's people only, like footage.
    if (path === "/api/raw" && method === "GET") {
      if (who?.role === "owner") return json(404, { error: "not found" });
      const horseId = url.searchParams.get("horse") || null;
      if (horseId && !bioById(horseId)) return json(404, { error: "unknown horse" });
      return json(200, G.raw.list({ horseId }));
    }

    // ---- hardware (device registry) ---------------------------------------- //
    if (path === "/api/hardware/spec" && method === "GET") return json(200, SC_IT6420_HB_V2);
    if (path === "/api/devices" || path.startsWith("/api/devices/")) {
      const res = await devices.handleDevices(req, url, who, visibleRoster);
      if (res) return res;
    }

    // ---- baseline, events, accuracy checks, gait checks ------------------- //
    // Before the generic record routes: /api/horses/:id/baseline is not a horse.
    if (/^\/api\/(horses\/[^/]+\/(baseline|gait)|events|validation)(\/|$)/.test(path)) {
      const res = await G.insights.handle(req, url, who);
      if (res) return res;
    }

    // ---- footage & labels (training data) --------------------------------- //
    if (path.startsWith("/api/footage")) {
      const actor = who?.name || who?.username || who?.role || "admin";
      if (path === "/api/footage/ticket" && method === "GET") {
        G.videoTickets ??= new Map();
        for (const [k, v] of G.videoTickets) if (v.exp < Date.now()) G.videoTickets.delete(k);
        const vt = footageRandom(18).toString("base64url");
        G.videoTickets.set(vt, { user: actor, exp: Date.now() + 2 * 3600 * 1000 });
        return json(200, { ticket: vt, expiresInS: 7200 });
      }
      if (path === "/api/footage/labels/meta" && method === "GET") return json(200, LABELS);
      if (path === "/api/footage" && method === "GET") {
        const cams = new Map(store.list("devices").filter((d) => d.kind === "thermal_camera").map((d) => [d.id, d]));
        const labels = store.list("footage_labels");
        const clips = listClips().map((c) => ({
          ...c,
          cameraName: cams.get(c.camera)?.name ?? c.camera, stall: cams.get(c.camera)?.stall ?? null,
          labels: labels.filter((l) => l.camera === c.camera && l.startAt >= c.at && l.startAt < c.end).length,
        }));
        return json(200, { clips, cameras: [...new Set(clips.map((c) => c.camera))].map((id) => ({ id, name: cams.get(id)?.name ?? id, stall: cams.get(id)?.stall ?? null })) });
      }
      if (path === "/api/footage/labels" && method === "GET") {
        const cam = url.searchParams.get("camera"), from = url.searchParams.get("from"), to = url.searchParams.get("to");
        const rows = store.list("footage_labels").filter((l) => (!cam || l.camera === cam) && (!from || l.startAt >= from) && (!to || l.startAt < to));
        return json(200, rows.sort((a, b) => a.startAt.localeCompare(b.startAt)));
      }
      if (path === "/api/footage/labels/export" && method === "GET") {
        const rows = store.list("footage_labels").sort((a, b) => a.startAt.localeCompare(b.startAt));
        if (url.searchParams.get("format") === "json") return json(200, { labels: rows, vocabulary: LABELS });
        return new Response(labelsCsv(rows), { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="equicare-labels-${new Date().toISOString().slice(0, 10)}.csv"`, ...CORS } });
      }
      if (path === "/api/footage/labels" && method === "POST") {
        let body;
        try { body = JSON.parse((await req.text()) || "{}"); } catch { return json(400, { error: "malformed JSON" }); }
        const { label, errs } = validateLabel(body);
        if (errs.length) return json(400, { error: "invalid label", details: errs });
        const cam = store.list("devices").find((d) => d.id === label.camera);
        const horse = label.horse || roster().find((h) => cam?.stall && h.stall === cam.stall)?.name || null;
        return json(201, store.create("footage_labels", { ...label, horse, stall: cam?.stall ?? null, by: actor, createdAt: new Date().toISOString() }));
      }
      // ---- boxes around the horse (detector training) ----
      if (path === "/api/footage/boxes" && method === "GET") {
        const cam = url.searchParams.get("camera"), from = url.searchParams.get("from"), to = url.searchParams.get("to");
        return json(200, store.list("footage_boxes").filter((b) => (!cam || b.camera === cam) && (!from || b.at >= from) && (!to || b.at < to))
          .sort((a, b) => a.at.localeCompare(b.at)));
      }
      if (path === "/api/footage/boxes/export" && method === "GET")
        return json(200, boxesExport(store.list("footage_boxes"), listClips()));
      if (path === "/api/footage/boxes" && method === "POST") {
        let body;
        try { body = JSON.parse((await req.text()) || "{}"); } catch { return json(400, { error: "malformed JSON" }); }
        const { box, errs } = validateBox(body);
        if (errs.length) return json(400, { error: "invalid box", details: errs });
        return json(201, store.create("footage_boxes", { ...box, by: actor, createdAt: new Date().toISOString() }));
      }
      const delBox = path.match(/^\/api\/footage\/boxes\/([^/]+)$/);
      if (delBox && method === "DELETE") {
        const id = decodeURIComponent(delBox[1]);
        if (!store.list("footage_boxes").some((b) => b.id === id)) return json(404, { error: "unknown box" });
        store.remove("footage_boxes", id);
        return json(200, { ok: true });
      }
      if (path === "/api/footage/boxes/meta" && method === "GET") return json(200, BOX_LABELS);

      // ---- moments worth labelling ----
      if (path === "/api/footage/queue" && method === "GET") {
        const cam = url.searchParams.get("camera");
        if (!cam) return json(400, { error: "camera is required" });
        const clips = listClips().filter((c) => c.camera === cam);
        const readings = store.allReadings().filter((r) => r.meta?.deviceId === cam);
        const status = new Map(store.list("footage_queue").map((q) => [q.itemId, q]));
        const want = url.searchParams.get("status") || "pending";
        const items = labellingQueue(readings, clips).map((it) => ({ ...it, status: status.get(it.id)?.status ?? "pending", by: status.get(it.id)?.by ?? null }));
        const counts = items.reduce((a, it) => ((a[it.status] = (a[it.status] || 0) + 1), a), {});
        return json(200, { items: want === "all" ? items : items.filter((it) => it.status === want), counts });
      }
      const qi = path.match(/^\/api\/footage\/queue\/(.+)$/);
      if (qi && method === "POST") {
        let body;
        try { body = JSON.parse((await req.text()) || "{}"); } catch { return json(400, { error: "malformed JSON" }); }
        if (!["done", "skipped", "pending"].includes(body.status)) return json(400, { error: "status must be done, skipped or pending" });
        const itemId = decodeURIComponent(qi[1]);
        const cur = store.list("footage_queue").find((q) => q.itemId === itemId);
        const row = cur ? store.update("footage_queue", cur.id, { status: body.status, by: actor, at: new Date().toISOString() })
          : store.create("footage_queue", { itemId, status: body.status, by: actor, at: new Date().toISOString() });
        return json(200, row);
      }

      const del = path.match(/^\/api\/footage\/labels\/([^/]+)$/);
      if (del && method === "DELETE") {
        const id = decodeURIComponent(del[1]);
        if (!store.list("footage_labels").some((l) => l.id === id)) return json(404, { error: "unknown label" });
        store.remove("footage_labels", id);
        return json(200, { ok: true });
      }
      return json(404, { error: "not found" });
    }

    // ---- generic CRUD over record collections --------------------------- //
    // GET    /api/<kind>            list
    // POST   /api/<kind>            create
    // PATCH  /api/<kind>/:id        partial update
    // DELETE /api/<kind>/:id        delete
    const crud = path.match(/^\/api\/([a-z-]+)(?:\/(.+))?$/);
    const crudKind = crud && Object.keys(KINDS).find((k) => KINDS[k].path === crud[1]);
    if (crudKind) {
      const kind = crudKind, id = crud[2] ? decodeURIComponent(crud[2]) : null;
      const spec = KINDS[kind];

      if (method === "GET" && !id) {
        if (kind === "users") return json(200, store.list(kind).map(publicUser));
        let rows = store.list(kind);
        if (who?.role === "owner") {
          const mine = new Set(visibleRoster().map((h) => h.name));
          rows = rows.filter((r) =>
            r.owner !== undefined ? r.owner === who.owner
            : r.horse !== undefined ? mine.has(r.horse)
            : false);      // collections with neither field are not owner-scoped
        }
        return json(200, rows);
      }

      if (method === "POST" && !id) {
        let body;
        try { body = JSON.parse((await req.text()) || "{}"); }
        catch (e) { return json(400, { error: "malformed JSON", detail: e.message }); }
        const missing = spec.required.filter((f) => body[f] === undefined || body[f] === "");
        if (missing.length) return json(400, { error: "missing required fields", missing });
        let seedRow = kind === "horses"
          ? { ...HORSE_DEFAULTS, ...body, id: body.id ?? slugId(body.name, kind) }
          : body;
        if (kind === "users") {
          if (!body.password) return json(400, { error: "password required" });
          if (!ROLES.includes(body.role)) return json(400, { error: "invalid role", roles: ROLES });
          if (store.list("users").some((u) => u.username === body.username))
            return json(409, { error: "username already exists" });
          seedRow = { ...body, password: hashPassword(body.password) };
        }
        const created = store.create(kind, seedRow);
        return json(201, kind === "users" ? publicUser(created) : created);
      }

      if (method === "PATCH" && id) {
        let body;
        try { body = JSON.parse((await req.text()) || "{}"); }
        catch (e) { return json(400, { error: "malformed JSON", detail: e.message }); }
        const patch = kind === "users" && body.password
          ? { ...body, password: hashPassword(body.password) }
          : body;
        const row = store.update(kind, id, patch);
        if (!row) return json(404, { error: "not found", kind, id });
        return json(200, kind === "users" ? publicUser(row) : row);
      }

      if (method === "DELETE" && id)
        return store.remove(kind, id)
          ? json(200, { ok: true })
          : json(404, { error: "not found", kind, id });
    }

    return json(404, { error: "not found", path });
  } catch (e) {
    console.error("[equicare]", e);
    return json(500, { error: String((e && e.message) || e) });
  }
}
