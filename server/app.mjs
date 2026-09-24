// BSV EquiCare backend — a Web-standard request handler (JSON store default;
// Postgres via DATABASE_URL). Served by the Next.js route handlers under
// src/app/{api,auth,ingest}; `handle(request) -> Response` is the whole API.
//   ingest:  POST /ingest/readings         (edge agent -> cloud; device token)
//   query :  GET  /api/horses | /api/horses/:id | /api/alerts | /api/series
//            GET  /api/coverage             (which of the 12 points are live yet)
//            POST /api/alerts/:id/ack
//
// Auth (opt-in via env; unset => open, for the local demo):
//   AUTH_INGEST_TOKEN   required as `Authorization: Bearer <token>` on /ingest/*
//   AUTH_API_TOKEN      required as `Authorization: Bearer <token>` on /api/*
//
// Run:  npm run dev   /   npm run build && npm start   (port 8080)

import { isKnownMetric, coverage } from "./contract.mjs";
import { createStore } from "./store.mjs";
import { dispatch, notifyStatus } from "./notify.mjs";
import { ensureAdmin, createSession, getSession, destroySession, sessionCount,
         verifyPassword, hashPassword, publicUser, ROLES } from "./auth.mjs";
import {
  summarizeHorse, buildAlerts, buildSeries, vitalsForHorse, metricSeries,
} from "./rollup.mjs";
import { CameraClient, checkHost, modbusReadTemps, rtspOptions } from "./camera.mjs";
import { SC_IT6420_HB_V2, validateCameraModel } from "./hardware-spec.mjs";
import { seal, open } from "./secrets.mjs";

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
  health:    { path: "health",    required: ["horse", "type"] },
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
// Cameras (hardware integration)
// --------------------------------------------------------------------------- //
// ROI slots on the camera. The datasheet allows 10 points and 10 areas; we use
// point 0 for the eye and area 1 for the nostril — the same slots the edge
// agent reads, so a calibration made here is what the agent measures.
const EYE_IDX = 0, NOSTRIL_IDX = 1;

/** What the browser may see: never the password, not even encrypted. */
const publicCamera = (c) => {
  const { passwordEnc, ...rest } = c;
  return { ...rest, hasPassword: Boolean(passwordEnc) };
};

/** Owners see that a camera watches their horse and whether it works — not
 *  where it is on the network or how to log into it. */
const ownerCamera = (c) => ({
  id: c.id, name: c.name, stall: c.stall,
  online: c.lastProbe ? c.lastProbe.ok : null,
  checkedAt: c.lastProbe?.at ?? null,
  calibrated: Boolean(c.rois),
});

function cameraFields(body, existing = {}) {
  const num = (v, d) => (v === undefined || v === "" ? d : Number(v));
  const out = {
    name: String(body.name ?? existing.name ?? "").trim(),
    stall: String(body.stall ?? existing.stall ?? "").trim(),
    host: String(body.host ?? existing.host ?? "").trim(),
    httpPort: num(body.httpPort, existing.httpPort ?? 80),
    https: body.https !== undefined ? Boolean(body.https) : Boolean(existing.https),
    rtspPort: num(body.rtspPort, existing.rtspPort ?? 554),
    modbusPort: num(body.modbusPort, existing.modbusPort ?? 502),
    username: String(body.username ?? existing.username ?? "admin").trim(),
    variant: String(body.variant ?? existing.variant ?? "640"),
    thermalLens: String(body.thermalLens ?? existing.thermalLens ?? "13"),
    visibleLens: String(body.visibleLens ?? existing.visibleLens ?? "4"),
    distanceM: num(body.distanceM, existing.distanceM ?? 3.5),
    emissivity: num(body.emissivity, existing.emissivity ?? 0.98),
  };
  const errs = validateCameraModel(out);
  if (!out.name) errs.push("name is required");
  if (!out.host) errs.push("host (IP address) is required");
  for (const k of ["httpPort", "rtspPort", "modbusPort"])
    if (!(Number.isInteger(out[k]) && out[k] > 0 && out[k] < 65536)) errs.push(`${k} must be a port number`);
  return { out, errs };
}

/** Open an authenticated session to a stored camera, or explain why not. */
async function connectCamera(cam) {
  const host = await checkHost(cam.host);
  if (!host.ok) return { error: host.error };
  const client = new CameraClient({
    host: cam.host, httpPort: cam.httpPort, https: cam.https,
    username: cam.username, password: open(cam.passwordEnc) ?? "",
  });
  try {
    const login = await client.login();
    return login.ok ? { client, login } : { error: login.error };
  } catch (e) {
    return { error: `cannot reach ${cam.host}:${cam.httpPort} — ${e.message}` };
  }
}

/** Step-by-step connection test, the same checks as sparsh_camera_smoketest.py. */
async function probeCamera(cam) {
  const steps = [];
  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      steps.push({ name, ok: true, detail, ms: Date.now() - t0 });
      return true;
    } catch (e) {
      steps.push({ name, ok: false, detail: e.message, ms: Date.now() - t0 });
      return false;
    }
  };
  let client, device = null;
  const reach = await step("Address allowed", async () => {
    const h = await checkHost(cam.host);
    if (!h.ok) throw new Error(h.error);
    return h.addrs.join(", ");
  });
  const authed = reach && await step("ISAPI login", async () => {
    const c = await connectCamera(cam);
    if (c.error) throw new Error(c.error);
    client = c.client;
    return `authenticated (${c.login.method})`;
  });
  if (authed) {
    await step("Device information", async () => {
      device = await client.deviceInfo();
      return [device.Model || device.DeviceName, device.DeviceSN && `S/N ${device.DeviceSN}`, device.FWVersion && `FW ${device.FWVersion}`]
        .filter(Boolean).join(" · ");
    });
    await step("Capabilities", async () => {
      const c = await client.capabilities();
      const flags = [
        c.WithCCD === "Yes" ? "visible channel" : "NO visible channel",
        c.WithMetaRaw === "Yes" ? "per-frame temperature stream" : "no meta stream",
        c.WithBlackBody === "Yes" ? "blackbody reference" : "no blackbody (±2 °C, screening-grade)",
      ];
      return flags.join(" · ");
    });
    await step("Thermometry", async () => {
      const b = await client.basicParam();
      return `emissivity ${(b.FPara100 ?? 0) / 100} · distance ${(b.AimDistance ?? 0) / 100} m`;
    });
    await step("Live temperatures", async () => {
      const temps = await client.queryTemps();
      if (!temps.length) return "no ROIs configured yet — calibrate to start measuring";
      return temps.map((x) => x.type === "Point" ? `point ${x.id}: ${x.pointC?.toFixed(1)} °C`
        : `${x.type.toLowerCase()} ${x.id}: avg ${x.avgC?.toFixed(1)} °C`).join(" · ");
    });
  }
  if (reach) {
    await step(`Modbus/TCP :${cam.modbusPort}`, async () => {
      const m = await modbusReadTemps(cam.host, cam.modbusPort);
      return `point 1 = ${m.pointC.toFixed(1)} °C (cross-check against ISAPI)`;
    });
    await step(`RTSP :${cam.rtspPort}`, async () => rtspOptions(cam.host, cam.rtspPort));
  }
  // Online = the camera answered ISAPI. Modbus and RTSP are reported, but a
  // closed Modbus port alone does not make a working camera "offline".
  const ok = Boolean(authed) && steps.filter((s) => s.name.startsWith("ISAPI") || s.name === "Device information").every((s) => s.ok);
  return { at: new Date().toISOString(), ok, steps, device };
}

const inRange = (v) => Number.isInteger(v) && v >= 0 && v <= 10000;

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
    if (path === "/api/health") return json(200, { ok: true, ...store.statsSummary(), sessions: sessionCount(), authRequired: authRequired() });
    if (path === "/api/coverage") return json(200, coverage());

    // ---- ingest (edge -> cloud) ------------------------------------------ //
    if (path === "/ingest/readings" && method === "POST") {
      if (!authed(req, INGEST_TOKEN)) return json(401, { error: "unauthorized" });
      let body;
      try {
        body = JSON.parse((await req.text()) || "{}");
      } catch (e) {
        return json(400, { error: "malformed JSON", detail: String(e.message) });
      }
      const batch = Array.isArray(body) ? body : body.readings || [];
      const known = batch.filter((r) => r && isKnownMetric(r.metric));

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
      const camByStall = new Map(store.list("cameras").map((c) => [c.stall, c]));
      for (const r of clean) {
        if (r.source !== "thermal_camera" || !r.stallId) continue;
        const cam = camByStall.get(r.stallId);
        if (cam && (!cam.rois || cam.rois.stale)) r.meta = { ...(r.meta || {}), calibrated: false };
      }
      const accepted = store.appendReadings(clean);
      const resBody = { accepted, dropped: batch.length - known.length };
      if (unattributed.length) {
        resBody.unattributed = unattributed.length;
        resBody.unknownStalls = [...new Set(unattributed)];
        console.warn(`[ingest] ${unattributed.length} reading(s) with no horse for stall(s): ${resBody.unknownStalls.join(", ")}`);
      }
      return json(200, resBody);
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
      const camRead = method === "GET" && (path === "/api/cameras" || /^\/api\/cameras\/[^/]+\/temps$/.test(path));
      if (path.startsWith("/api/cameras") && who.role === "staff" && !camRead)
        return json(403, { error: "admin only" });
      // Owners get the list (status for their own horses' stalls) and nothing
      // else — "GET" alone would have let them pull any camera's snapshot.
      if (path.startsWith("/api/cameras/") && who.role === "owner")
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
      return json(200, {
        ...summarizeHorse(bio, store.allReadings()),
        vitals: vitalsForHorse(rd),
        charts: {
          body_temp_c: metricSeries(rd, "body_temp_c", 7, "avg"),
          respiratory_rate_bpm: metricSeries(rd, "respiratory_rate_bpm", 7, "avg"),
          rest_hours: metricSeries(rd, "rest_minutes", 7, "sum").map((m) => +(m / 60).toFixed(1)),
          activity_index: metricSeries(rd, "activity_index", 7, "avg"),
          feed_intake_g: metricSeries(rd, "feed_intake_g", 7, "sum"),
          feed_refusal_g: metricSeries(rd, "feed_refusal_g", 7, "sum"),
          water_ml: metricSeries(rd, "water_ml", 7, "sum"),
        },
      });
    }

    if (path === "/api/alerts" && method === "GET") {
      const alerts = buildAlerts(visibleRoster(), store.allReadings(), store.isAcked);
      dispatch(alerts).catch((e) => console.error("[notify]", e.message));
      return json(200, alerts);
    }

    const ack = path.match(/^\/api\/alerts\/(.+)\/ack$/);
    if (ack && method === "POST") { store.ackAlert(decodeURIComponent(ack[1])); return json(200, { ok: true }); }

    if (path === "/api/series" && method === "GET") {
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7));
      return json(200, buildSeries(roster(), store.allReadings(), days));
    }

    if (path === "/api/notify/status" && method === "GET")
      return json(200, notifyStatus());

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

    // ---- cameras (hardware integration) ---------------------------------- //
    if (path === "/api/hardware/spec" && method === "GET")
      return json(200, SC_IT6420_HB_V2);

    if (path === "/api/cameras" && method === "GET") {
      const cams = store.list("cameras");
      if (who?.role === "owner") {
        const stalls = new Set(visibleRoster().map((h) => h.stall));
        return json(200, cams.filter((c) => stalls.has(c.stall)).map(ownerCamera));
      }
      return json(200, cams.map(publicCamera));
    }

    if (path === "/api/cameras" && method === "POST") {
      let body;
      try { body = JSON.parse((await req.text()) || "{}"); }
      catch { return json(400, { error: "malformed JSON" }); }
      const { out, errs } = cameraFields(body);
      if (errs.length) return json(400, { error: "invalid camera", details: errs });
      const created = store.create("cameras", {
        ...out, passwordEnc: seal(body.password), rois: null, lastProbe: null,
        createdAt: new Date().toISOString(),
      });
      return json(201, publicCamera(created));
    }

    const camMatch = path.match(/^\/api\/cameras\/([^/]+)(?:\/(probe|snapshot|rois|temps))?$/);
    if (camMatch) {
      const cam = store.list("cameras").find((c) => c.id === decodeURIComponent(camMatch[1]));
      if (!cam) return json(404, { error: "unknown camera" });
      const action = camMatch[2];

      if (!action && method === "PATCH") {
        let body;
        try { body = JSON.parse((await req.text()) || "{}"); }
        catch { return json(400, { error: "malformed JSON" }); }
        const { out, errs } = cameraFields(body, cam);
        if (errs.length) return json(400, { error: "invalid camera", details: errs });
        // Empty or absent password = keep the stored one (the form never
        // receives it, so it cannot send it back).
        const patch = { ...out };
        if (body.password) patch.passwordEnc = seal(body.password);
        // Moving the camera or changing its optics invalidates the aim.
        const reaimed = ["host", "stall", "variant", "thermalLens", "distanceM"].some((k) => String(out[k]) !== String(cam[k]));
        if (reaimed && cam.rois) patch.rois = { ...cam.rois, stale: true };
        return json(200, publicCamera(store.update("cameras", cam.id, patch)));
      }

      if (!action && method === "DELETE")
        return store.remove("cameras", cam.id) ? json(200, { ok: true }) : json(404, { error: "unknown camera" });

      if (action === "probe" && method === "POST") {
        const result = await probeCamera(cam);
        store.update("cameras", cam.id, { lastProbe: result });
        return json(200, result);
      }

      if (action === "snapshot" && method === "GET") {
        const dev = url.searchParams.get("dev") === "1" ? 1 : 0;
        const c = await connectCamera(cam);
        if (c.error) return json(502, { error: c.error });
        try {
          const snap = await c.client.snapshot(dev);
          return new Response(snap.bytes, {
            status: 200,
            headers: { "Content-Type": snap.contentType, "Cache-Control": "no-store", ...CORS },
          });
        } catch (e) {
          return json(502, { error: e.message });
        }
      }

      if (action === "rois" && method === "PUT") {
        let body;
        try { body = JSON.parse((await req.text()) || "{}"); }
        catch { return json(400, { error: "malformed JSON" }); }
        const eye = body.eye, n = body.nostril;
        if (!eye || !inRange(eye.x) || !inRange(eye.y))
          return json(400, { error: "eye must be {x, y} in 0–10000" });
        if (!n || ![n.x0, n.y0, n.x1, n.y1].every(inRange) || n.x1 <= n.x0 || n.y1 <= n.y0)
          return json(400, { error: "nostril must be {x0, y0, x1, y1} in 0–10000 with x1>x0, y1>y0" });
        const c = await connectCamera(cam);
        if (c.error) return json(502, { error: c.error });
        const opts = { emissivity: cam.emissivity, distanceM: cam.distanceM };
        try {
          const basic = await c.client.setBasicParam(opts);
          const point = await c.client.setPoint(EYE_IDX, eye.x, eye.y, { ...opts, name: "equicare-eye" });
          const area = await c.client.setArea(NOSTRIL_IDX,
            [[n.x0, n.y0], [n.x1, n.y0], [n.x1, n.y1], [n.x0, n.y1]], { ...opts, name: "equicare-nostril" });
          const results = { basic: basic.ok, eye: point.ok, nostril: area.ok };
          if (!point.ok || !area.ok)
            return json(502, { error: "the camera rejected the ROI update", results, camera: { eye: point.body, nostril: area.body } });
          const rois = { eye: { x: eye.x, y: eye.y }, nostril: { x0: n.x0, y0: n.y0, x1: n.x1, y1: n.y1 }, pushedAt: new Date().toISOString() };
          store.update("cameras", cam.id, { rois });
          return json(200, { ok: true, results, rois });
        } catch (e) {
          return json(502, { error: e.message });
        }
      }

      if (action === "temps" && method === "GET") {
        const c = await connectCamera(cam);
        if (c.error) return json(502, { error: c.error });
        try {
          const temps = await c.client.queryTemps();
          const eyeT = temps.find((x) => x.type === "Point" && x.id === EYE_IDX);
          const nosT = temps.find((x) => x.type !== "Point" && x.id === NOSTRIL_IDX);
          return json(200, {
            at: new Date().toISOString(),
            eye: eyeT ? { c: eyeT.pointC } : null,
            nostril: nosT ? { avgC: nosT.avgC, minC: nosT.minC, maxC: nosT.maxC } : null,
            all: temps,
          });
        } catch (e) {
          return json(502, { error: e.message });
        }
      }

      return json(405, { error: "method not allowed" });
    }

    // ---- generic CRUD over record collections --------------------------- //
    // GET    /api/<kind>            list
    // POST   /api/<kind>            create
    // PATCH  /api/<kind>/:id        partial update
    // DELETE /api/<kind>/:id        delete
    const crud = path.match(/^\/api\/([a-z]+)(?:\/(.+))?$/);
    if (crud && KINDS[crud[1]]) {
      const kind = crud[1], id = crud[2] ? decodeURIComponent(crud[2]) : null;
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
