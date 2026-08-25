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
const authed = (req, token) => !token || bearer(req) === token;   // no token configured => open
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
    if (path === "/health") return json(res, 200, { ok: true, ...store.statsSummary() });
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
      const clean = batch.filter((r) => r && isKnownMetric(r.metric));
      const accepted = store.appendReadings(clean);
      return json(res, 200, { accepted, dropped: batch.length - clean.length });
    }

    // ---- query (SPA -> cloud) — all /api/* require the API token if set --- //
    if (path.startsWith("/api/") && !authed(req, API_TOKEN))
      return json(res, 401, { error: "unauthorized" });

    if (path === "/api/horses" && method === "GET") {
      const all = store.allReadings();
      return json(res, 200, roster().map((bio) => summarizeHorse(bio, all)));
    }

    const detail = path.match(/^\/api\/horses\/([^/]+)$/);
    if (detail && method === "GET") {
      const bio = bioById(detail[1]);
      if (!bio) return json(res, 404, { error: "unknown horse" });
      const rd = store.readingsForHorse(bio.id);
      return json(res, 200, {
        ...summarizeHorse(bio, store.allReadings()),
        vitals: vitalsForHorse(rd),
        charts: {
          body_temp_c: metricSeries(rd, "body_temp_c", 7, "avg"),
          respiratory_rate_bpm: metricSeries(rd, "respiratory_rate_bpm", 7, "avg"),
          rest_hours: metricSeries(rd, "rest_minutes", 7, "sum").map((m) => +(m / 60).toFixed(1)),
          activity_index: metricSeries(rd, "activity_index", 7, "avg"),
        },
      });
    }

    if (path === "/api/alerts" && method === "GET") {
      const alerts = buildAlerts(roster(), store.allReadings(), store.isAcked);
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

    // ---- generic CRUD over record collections --------------------------- //
    // GET    /api/<kind>            list
    // POST   /api/<kind>            create
    // PATCH  /api/<kind>/:id        partial update
    // DELETE /api/<kind>/:id        delete
    const crud = path.match(/^\/api\/([a-z]+)(?:\/(.+))?$/);
    if (crud && KINDS[crud[1]]) {
      const kind = crud[1], id = crud[2] ? decodeURIComponent(crud[2]) : null;
      const spec = KINDS[kind];

      if (method === "GET" && !id) return json(res, 200, store.list(kind));

      if (method === "POST" && !id) {
        let body;
        try { body = JSON.parse((await readBody(req)) || "{}"); }
        catch (e) { return json(res, 400, { error: "malformed JSON", detail: e.message }); }
        const missing = spec.required.filter((f) => body[f] === undefined || body[f] === "");
        if (missing.length) return json(res, 400, { error: "missing required fields", missing });
        const seedRow = kind === "horses"
          ? { ...HORSE_DEFAULTS, ...body, id: body.id ?? slugId(body.name, kind) }
          : body;
        return json(res, 201, store.create(kind, seedRow));
      }

      if (method === "PATCH" && id) {
        let body;
        try { body = JSON.parse((await readBody(req)) || "{}"); }
        catch (e) { return json(res, 400, { error: "malformed JSON", detail: e.message }); }
        const row = store.update(kind, id, body);
        return row ? json(res, 200, row) : json(res, 404, { error: "not found", kind, id });
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
