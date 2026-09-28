#!/usr/bin/env node
// EquiCare relay — store-and-forward for the wearable hubs' SIM data.
//
// The hubs send over the mobile network, but the site server stays on the
// stable's own network with no port open to the internet. This small service
// runs on an internet-facing machine in India (DEPLOY_CLOUD.md), accepts what
// the hubs send, and holds it until the site server — which only ever calls
// OUT — pulls it:
//
//   hub ──LTE──▶ POST /ingest/readings | /ingest/raw   (the hub's own device token)
//   site server ──▶ GET  /relay/pull?max=500            (Authorization: Bearer RELAY_KEY)
//               ──▶ POST /relay/ack {ids}               (after ingesting them)
//
// The relay cannot tell a good device token from a bad one — only the site's
// registry can. It keeps sha256(token), never the token itself, and the site
// server looks the device up by that hash. What it keeps per item:
// { id, kind, tokenHash, headers (X-* and Content-*), body, receivedAt }.
// Limits: 1 MB per readings request, 50 MB per raw upload; items older than 7
// days, and the oldest beyond 2 GB in all, are dropped (and logged).
//
//   RELAY_KEY=... node server/relay.mjs --port 8787 --data /var/lib/equicare-relay
//
// No dependencies: node:http + node:fs only, so it can be copied on its own.
import http from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const LIMITS = { readings: 1024 * 1024, raw: 50 * 1024 * 1024 };
const MAX_AGE_MS = 7 * 24 * 3600_000;
const MAX_BYTES = 2 * 1024 ** 3;
const PULL_MAX_ITEMS = 500;
const PULL_MAX_BYTES = 64 * 1024 * 1024;       // one pull's bodies (always at least one item)
const ACK_MAX_BYTES = 1024 * 1024;
const DEVICE_TOKEN = /^eqd_[A-Za-z0-9_-]{16,200}$/;
// Headers that carry what the site server needs to read the body.
const KEEP_HEADER = /^(x-|content-)/;
const DROP_HEADER = /^(x-forwarded-|x-real-ip$|content-length$)/;   // the hub's IP is not ours to keep

const sha = (s) => createHash("sha256").update(s).digest();
const sameKey = (a, b) => timingSafeEqual(sha(a), sha(b));

export function createRelay({ dataDir, key, maxAgeMs = MAX_AGE_MS, maxBytes = MAX_BYTES, now = () => Date.now(), log = console } = {}) {
  if (!key || String(key).length < 16) throw new Error("RELAY_KEY must be set (at least 16 characters)");
  if (!dataDir) throw new Error("--data <dir> is required");
  const qdir = join(dataDir, "queue");
  mkdirSync(qdir, { recursive: true });

  // In-memory index of what is on disk, oldest first: { id, kind, bytes, receivedAt }.
  // Each item is two files: <id>.body (as received) and <id>.json (the rest),
  // the .json written last, so a crash mid-write leaves no half item.
  let index = [];
  let seq = 0;
  {
    const files = new Set(readdirSync(qdir));
    for (const f of files) {
      if (f.endsWith(".tmp")) { rmSync(join(qdir, f), { force: true }); continue; }
      if (!f.endsWith(".json")) continue;
      const id = f.slice(0, -5);
      if (!files.has(`${id}.body`)) { rmSync(join(qdir, f), { force: true }); continue; }
      try {
        const m = JSON.parse(readFileSync(join(qdir, f), "utf8"));
        index.push({ id, kind: m.kind, bytes: m.bytes, receivedAt: m.receivedAt });
      } catch { log.warn?.(`[relay] unreadable item ${id} removed`); remove(id); }
    }
    for (const f of files) if (f.endsWith(".body") && !files.has(`${f.slice(0, -5)}.json`)) rmSync(join(qdir, f), { force: true });
    index.sort((a, b) => a.id.localeCompare(b.id));
  }
  const total = () => index.reduce((n, x) => n + x.bytes, 0);

  function remove(id) {
    rmSync(join(qdir, `${id}.json`), { force: true });
    rmSync(join(qdir, `${id}.body`), { force: true });
  }

  /** Oldest out first: past the age cap, then while over the size cap. */
  function enforceCaps() {
    const cutoff = now() - maxAgeMs;
    const drop = (why, test) => {
      let n = 0;
      while (index.length && test(index[0])) { remove(index.shift().id); n++; }
      if (n) log.warn?.(`[relay] dropped ${n} item(s) ${why} — the site server has not pulled them`);
    };
    drop(`older than ${Math.round(maxAgeMs / 3600_000)} h`, (x) => Date.parse(x.receivedAt) < cutoff);
    let bytes = total();
    drop(`to stay under ${maxBytes} bytes`, (x) => (bytes > maxBytes ? ((bytes -= x.bytes), true) : false));
  }

  function put(kind, tokenHash, headers, body) {
    // Sortable: arrival order is id order.
    const id = `${String(now()).padStart(15, "0")}-${String(++seq).padStart(6, "0")}-${randomBytes(4).toString("hex")}`;
    const receivedAt = new Date(now()).toISOString();
    writeFileSync(join(qdir, `${id}.body.tmp`), body);
    renameSync(join(qdir, `${id}.body.tmp`), join(qdir, `${id}.body`));
    const meta = { id, kind, tokenHash, headers, receivedAt, bytes: body.length };
    writeFileSync(join(qdir, `${id}.json.tmp`), JSON.stringify(meta));
    renameSync(join(qdir, `${id}.json.tmp`), join(qdir, `${id}.json`));
    index.push({ id, kind, bytes: body.length, receivedAt });
    enforceCaps();
    return id;
  }

  function pull(max) {
    const items = [];
    let bytes = 0;
    for (const x of index) {
      if (items.length >= max || (items.length && bytes + x.bytes > PULL_MAX_BYTES)) break;
      let meta, body;
      try {
        meta = JSON.parse(readFileSync(join(qdir, `${x.id}.json`), "utf8"));
        body = readFileSync(join(qdir, `${x.id}.body`));
      } catch { continue; }
      // Readings travel as text; a raw upload, or anything compressed, as base64.
      const binary = meta.kind === "raw" || meta.headers["content-encoding"];
      items.push({ ...meta, body: binary ? body.toString("base64") : body.toString("utf8"), encoding: binary ? "base64" : "utf8" });
      bytes += x.bytes;
    }
    return items;
  }

  function ack(ids) {
    const want = new Set(ids.map(String));
    const before = index.length;
    index = index.filter((x) => (want.has(x.id) ? (remove(x.id), false) : true));
    return before - index.length;
  }

  const send = (res, code, body) => {
    const text = JSON.stringify(body);
    res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), "Cache-Control": "no-store" });
    res.end(text);
  };

  /** The body, or null once it passes `max` (the request is then answered 413). */
  function readBody(req, max) {
    return new Promise((resolve, reject) => {
      const len = Number(req.headers["content-length"]);
      if (Number.isFinite(len) && len > max) { resolve(null); req.resume(); return; }
      const chunks = [];
      let n = 0, over = false;
      req.on("data", (c) => {
        if (over) return;
        n += c.length;
        if (n > max) { over = true; chunks.length = 0; return; }
        chunks.push(c);
      });
      req.on("end", () => resolve(over ? null : Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  async function handler(req, res) {
    const url = new URL(req.url, "http://relay");
    const auth = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    try {
      // ---- from the hubs ----
      const kind = url.pathname === "/ingest/readings" ? "readings" : url.pathname === "/ingest/raw" ? "raw" : null;
      if (kind && req.method === "POST") {
        if (!DEVICE_TOKEN.test(auth)) { req.resume(); return send(res, 401, { error: "a device token is required (Authorization: Bearer eqd_…)" }); }
        const body = await readBody(req, LIMITS[kind]);
        if (body === null) return send(res, 413, { error: `at most ${LIMITS[kind] / 1048576} MB per ${kind === "raw" ? "upload" : "request"}` });
        if (!body.length) return send(res, 400, { error: "empty body" });
        const headers = {};
        for (const [k, v] of Object.entries(req.headers))
          if (KEEP_HEADER.test(k) && !DROP_HEADER.test(k) && typeof v === "string") headers[k] = v.slice(0, 500);
        const id = put(kind, createHash("sha256").update(auth).digest("hex"), headers, body);
        return send(res, 202, { queued: id });
      }

      if (url.pathname === "/relay/health" && req.method === "GET")
        return send(res, 200, { ok: true, items: index.length, bytes: total(), oldest: index[0]?.receivedAt ?? null });

      // ---- from the site server ----
      if (url.pathname === "/relay/pull" || url.pathname === "/relay/ack") {
        if (!auth || !sameKey(auth, String(key))) { req.resume(); return send(res, 401, { error: "unauthorized" }); }
        if (url.pathname === "/relay/pull" && req.method === "GET") {
          const max = Math.max(1, Math.min(PULL_MAX_ITEMS, Math.floor(Number(url.searchParams.get("max")) || PULL_MAX_ITEMS)));
          const items = pull(max);
          return send(res, 200, { items, remaining: index.length - items.length });
        }
        if (url.pathname === "/relay/ack" && req.method === "POST") {
          const body = await readBody(req, ACK_MAX_BYTES);
          if (body === null) return send(res, 413, { error: "ack at most 1 MB of ids" });
          let ids;
          try { ids = JSON.parse(body.toString("utf8") || "{}").ids; } catch { return send(res, 400, { error: "malformed JSON" }); }
          if (!Array.isArray(ids)) return send(res, 400, { error: "send { ids: [...] }" });
          return send(res, 200, { acked: ack(ids), remaining: index.length });
        }
        req.resume();
        return send(res, 405, { error: "method not allowed" });
      }
      req.resume();
      return send(res, 404, { error: "not found" });
    } catch (e) {
      log.error?.("[relay]", e);
      if (!res.headersSent) send(res, 500, { error: "relay error" });
    }
  }

  const server = http.createServer(handler);
  // Items age out even when nothing arrives.
  const timer = setInterval(enforceCaps, 3600_000);
  timer.unref();
  server.on("close", () => clearInterval(timer));
  return {
    server,
    listen: (port = 8787, host = "127.0.0.1") => new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(() => resolve())),
    stats: () => ({ items: index.length, bytes: total() }),
    enforceCaps,
  };
}

// ---- command line ---------------------------------------------------------- //
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
  const port = Number(arg("port", 8787));
  const host = arg("host", "127.0.0.1");        // behind the TLS proxy; --host 0.0.0.0 only if you know why
  const dataDir = arg("data", null);
  try {
    const relay = createRelay({ dataDir, key: process.env.RELAY_KEY });
    const bound = await relay.listen(port, host);
    const s = relay.stats();
    console.log(`[relay] listening on ${host}:${bound} · data ${dataDir} · ${s.items} item(s) waiting`);
    for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => relay.close().then(() => process.exit(0)));
  } catch (e) {
    console.error(`[relay] ${e.message}`);
    process.exit(1);
  }
}
