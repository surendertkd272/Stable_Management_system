// BSV EquiCare backend — Node HTTP service (JSON store default; Postgres via DATABASE_URL).
//   ingest:  POST /ingest/readings         (edge agent -> cloud; device token)
//   query :  GET  /api/horses | /api/horses/:id | /api/alerts | /api/series
//            GET  /api/coverage             (which of the 12 points are live yet)
//            POST /api/alerts/:id/ack
//
// Auth (opt-in via env; unset => open, for the local demo):
//   AUTH_INGEST_TOKEN   required as `Authorization: Bearer <token>` on /ingest/*
//   AUTH_API_TOKEN      required as `Authorization: Bearer <token>` on /api/*
//
// Run:  node index.mjs        (PORT env optional, default 8080)
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isKnownMetric, coverage } from "./contract.mjs";
import { createStore } from "./store.mjs";
import { dispatch, notifyStatus } from "./notify.mjs";
import { ensureAdmin, createSession, getSession, destroySession, sessionCount,
         verifyPassword, hashPassword, publicUser, ROLES } from "./auth.mjs";
import {
  summarizeHorse, buildAlerts, buildSeries, vitalsForHorse, metricSeries,
} from "./rollup.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_ROSTER = JSON.parse(readFileSync(join(HERE, "roster.json"), "utf8"));
const PORT = Number(process.env.PORT) || 8080;
const INGEST_TOKEN = process.env.AUTH_INGEST_TOKEN || "";
const API_TOKEN = process.env.AUTH_API_TOKEN || "";

const store = await createStore();

// The roster is DATA, not a frozen file: seeded from roster.json on first boot,
// then owned by the store. This is what makes a horse added in the UI actually
// get monitored — previously the rollup only ever saw the seed file.
store.seed("horses", SEED_ROSTER);
ensureAdmin(store);   // first boot only; prints a generated password once
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
const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Content-Length": Buffer.byteLength(s),
  });
  res.end(s);
};
const readBody = (req) => new Promise((resolve) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => resolve(b));
});
const bearer = (req) => (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
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
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  if (method === "OPTIONS") return json(res, 204, {});

  try {
    if (path === "/health") return json(res, 200, { ok: true, ...store.statsSummary(), sessions: sessionCount(), authRequired: authRequired() });
    if (path === "/api/coverage") return json(res, 200, coverage());

    // ---- ingest (edge -> cloud) ------------------------------------------ //
    if (path === "/ingest/readings" && method === "POST") {
      if (!authed(req, INGEST_TOKEN)) return json(res, 401, { error: "unauthorized" });
      let body;
      try {
        body = JSON.parse((await readBody(req)) || "{}");
      } catch (e) {
        return json(res, 400, { error: "malformed JSON", detail: String(e.message) });
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
      const accepted = store.appendReadings(clean);
      const resBody = { accepted, dropped: batch.length - known.length };
      if (unattributed.length) {
        resBody.unattributed = unattributed.length;
        resBody.unknownStalls = [...new Set(unattributed)];
        console.warn(`[ingest] ${unattributed.length} reading(s) with no horse for stall(s): ${resBody.unknownStalls.join(", ")}`);
      }
      return json(res, 200, resBody);
    }

    // ---- authentication ------------------------------------------------- //
    if (path === "/auth/login" && method === "POST") {
      let body;
      try { body = JSON.parse((await readBody(req)) || "{}"); }
      catch { return json(res, 400, { error: "malformed JSON" }); }
      const u = store.list("users").find((x) => x.username === body.username);
      // Verify even when the user is unknown, so response time does not reveal
      // whether a username exists.
      const ok = verifyPassword(body.password || "", u?.password || "scrypt$0$0");
      if (!u || !ok) return json(res, 401, { error: "invalid username or password" });
      const s = createSession(u);
      return json(res, 200, { ...s, user: publicUser(u) });
    }

    if (path === "/auth/logout" && method === "POST") {
      destroySession(bearer(req));
      return json(res, 200, { ok: true });
    }

    if (path === "/auth/me" && method === "GET") {
      const p = principal(req);
      return p ? json(res, 200, { user: p, authRequired: authRequired() })
               : json(res, 401, { error: "not signed in", authRequired: authRequired() });
    }

    // ---- query (SPA -> cloud) -------------------------------------------- //
    const who = principal(req);
    if (path.startsWith("/api/") && authRequired() && !who)
      return json(res, 401, { error: "unauthorized" });

    // Owners get a read-only view; only admins may touch user accounts.
    if (path.startsWith("/api/") && who) {
      if (who.role === "owner" && method !== "GET")
        return json(res, 403, { error: "read-only account" });
      if (path.startsWith("/api/users") && who.role !== "admin")
        return json(res, 403, { error: "admin only" });
    }

    // An owner account sees only its own horses. The SPA also hides other
    // owners, but that is presentation — this is the actual access control.
    const visibleRoster = () =>
      who?.role === "owner" ? roster().filter((h) => h.owner === who.owner) : roster();

    if (path === "/api/horses" && method === "GET") {
      const all = store.allReadings();
      return json(res, 200, visibleRoster().map((bio) => summarizeHorse(bio, all)));
    }

    const detail = path.match(/^\/api\/horses\/([^/]+)$/);
    if (detail && method === "GET") {
      const bio = bioById(detail[1]);
      if (!bio) return json(res, 404, { error: "unknown horse" });
      // 404 rather than 403: do not confirm the existence of another owner's horse
      if (who?.role === "owner" && bio.owner !== who.owner)
        return json(res, 404, { error: "unknown horse" });
      const rd = store.readingsForHorse(bio.id);
      return json(res, 200, {
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
      return json(res, 200, alerts);
    }

    const ack = path.match(/^\/api\/alerts\/(.+)\/ack$/);
    if (ack && method === "POST") { store.ackAlert(decodeURIComponent(ack[1])); return json(res, 200, { ok: true }); }

    if (path === "/api/series" && method === "GET") {
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7));
      return json(res, 200, buildSeries(roster(), store.allReadings(), days));
    }

    if (path === "/api/notify/status" && method === "GET")
      return json(res, 200, notifyStatus());

    // ---- CSV export ------------------------------------------------------ //
    // GET /api/export/readings.csv?horse=<id>&days=N&metric=<m>
    if (path === "/api/export/readings.csv" && method === "GET") {
      const horseId = url.searchParams.get("horse");
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30));
      const metric = url.searchParams.get("metric");
      const cutoff = Date.now() - days * 24 * 3600 * 1000;

      const allowed = new Set(visibleRoster().map((h) => h.id));
      if (horseId && !allowed.has(horseId))
        return json(res, 404, { error: "unknown horse" });

      const rows = store.allReadings().filter((r) =>
        Date.parse(r.ts) >= cutoff &&
        (horseId ? r.horseId === horseId : allowed.has(r.horseId)) &&
        (!metric || r.metric === metric));

      const csv = toCsv(
        ["ts", "horseId", "stallId", "metric", "value", "unit", "source", "confidence"],
        rows);
      const name = `equicare-${horseId || "all"}-${days}d.csv`;
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Access-Control-Allow-Origin": "*",
        "Content-Length": Buffer.byteLength(csv),
      });
      return res.end(csv);
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
        if (kind === "users") return json(res, 200, store.list(kind).map(publicUser));
        let rows = store.list(kind);
        if (who?.role === "owner") {
          const mine = new Set(visibleRoster().map((h) => h.name));
          rows = rows.filter((r) =>
            r.owner !== undefined ? r.owner === who.owner
            : r.horse !== undefined ? mine.has(r.horse)
            : false);      // collections with neither field are not owner-scoped
        }
        return json(res, 200, rows);
      }

      if (method === "POST" && !id) {
        let body;
        try { body = JSON.parse((await readBody(req)) || "{}"); }
        catch (e) { return json(res, 400, { error: "malformed JSON", detail: e.message }); }
        const missing = spec.required.filter((f) => body[f] === undefined || body[f] === "");
        if (missing.length) return json(res, 400, { error: "missing required fields", missing });
        let seedRow = kind === "horses"
          ? { ...HORSE_DEFAULTS, ...body, id: body.id ?? slugId(body.name, kind) }
          : body;
        if (kind === "users") {
          if (!body.password) return json(res, 400, { error: "password required" });
          if (!ROLES.includes(body.role)) return json(res, 400, { error: "invalid role", roles: ROLES });
          if (store.list("users").some((u) => u.username === body.username))
            return json(res, 409, { error: "username already exists" });
          seedRow = { ...body, password: hashPassword(body.password) };
        }
        const created = store.create(kind, seedRow);
        return json(res, 201, kind === "users" ? publicUser(created) : created);
      }

      if (method === "PATCH" && id) {
        let body;
        try { body = JSON.parse((await readBody(req)) || "{}"); }
        catch (e) { return json(res, 400, { error: "malformed JSON", detail: e.message }); }
        const patch = kind === "users" && body.password
          ? { ...body, password: hashPassword(body.password) }
          : body;
        const row = store.update(kind, id, patch);
        if (!row) return json(res, 404, { error: "not found", kind, id });
        return json(res, 200, kind === "users" ? publicUser(row) : row);
      }

      if (method === "DELETE" && id)
        return store.remove(kind, id)
          ? json(res, 200, { ok: true })
          : json(res, 404, { error: "not found", kind, id });
    }

    return json(res, 404, { error: "not found", path });
  } catch (e) {
    return json(res, 500, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const s = store.statsSummary();
  console.log(`[equicare-server] http://127.0.0.1:${PORT}  store=${s.backend}  auth=${API_TOKEN ? "on" : "open"}`);
  console.log(`  roster: ${roster().length} horses · ${JSON.stringify(s)}`);
});
