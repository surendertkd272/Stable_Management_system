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
import {
  summarizeHorse, buildAlerts, buildSeries, vitalsForHorse, metricSeries,
} from "./rollup.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROSTER = JSON.parse(readFileSync(join(HERE, "roster.json"), "utf8"));
const PORT = Number(process.env.PORT) || 8080;
const INGEST_TOKEN = process.env.AUTH_INGEST_TOKEN || "";
const API_TOKEN = process.env.AUTH_API_TOKEN || "";

const store = await createStore();

// --------------------------------------------------------------------------- //
const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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
const bioById = (id) => ROSTER.find((h) => h.id === id);

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
      return json(res, 200, ROSTER.map((bio) => summarizeHorse(bio, all)));
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

    if (path === "/api/alerts" && method === "GET")
      return json(res, 200, buildAlerts(ROSTER, store.allReadings(), store.isAcked));

    const ack = path.match(/^\/api\/alerts\/(.+)\/ack$/);
    if (ack && method === "POST") { store.ackAlert(decodeURIComponent(ack[1])); return json(res, 200, { ok: true }); }

    if (path === "/api/series" && method === "GET")
      return json(res, 200, buildSeries(ROSTER, store.allReadings()));

    return json(res, 404, { error: "not found", path });
  } catch (e) {
    return json(res, 500, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const s = store.statsSummary();
  console.log(`[equicare-server] http://127.0.0.1:${PORT}  store=${s.backend}  auth=${API_TOKEN ? "on" : "open"}`);
  console.log(`  roster: ${ROSTER.length} horses · ${JSON.stringify(s)}`);
});
