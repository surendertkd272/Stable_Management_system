// The relay for the SIM hubs (server/relay.mjs) and the site server's pull
// from it. The relay runs in-process on a free port; the site server is the
// real request handler, pulling over HTTP exactly as it would across the
// internet.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRelay } from "./relay.mjs";

const DATA = mkdtempSync(join(tmpdir(), "equicare-relay-"));
const KEY = "relay-key-for-tests-0123456789";
let relay, base, app, appStore;
const tokens = {};
const logs = [];
const quiet = { warn: (m) => logs.push(m), error: (m) => logs.push(String(m)), log() {} };

const hubPost = (path, token, body, headers = {}) => fetch(`${base}${path}`, {
  method: "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body });
const pull = (key = KEY, q = "") => fetch(`${base}/relay/pull${q}`, { headers: { Authorization: `Bearer ${key}` } });
const ackAll = async () => {
  const { items } = await (await pull()).json();
  await fetch(`${base}/relay/ack`, { method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ ids: items.map((i) => i.id) }) });
};
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

before(async () => {
  relay = createRelay({ dataDir: join(DATA, "relay"), key: KEY, log: quiet });
  base = `http://127.0.0.1:${await relay.listen(0)}`;
  process.env.EQUICARE_DATA_DIR = join(DATA, "site");
  process.env.ADMIN_PASSWORD = "test-admin-pw";
  process.env.EQUICARE_SENSOR_TICK_MS = "0";
  process.env.EQUICARE_NOTIFY_TICK_MS = "0";
  delete process.env.DATABASE_URL; delete process.env.VERCEL; delete process.env.AUTH_INGEST_TOKEN;
  app = await import("./app.mjs");
  const call = async (method, path, body, token = tokens.admin) => {
    const res = await app.handle(new Request(`http://local${path}`, { method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  tokens.admin = (await call("POST", "/auth/login", { username: "admin", password: "test-admin-pw" }, null)).body.token;
  const hub = await call("POST", "/api/devices", { kind: "wearable_hub", name: "Shaan's hub", horseId: "shaan" });
  tokens.hub = hub.body.token;
  tokens.hubId = hub.body.device.id;
  tokens.call = call;
  appStore = await globalThis.__equicare.ready;
});
after(async () => {
  await relay?.close();
  delete process.env.EQUICARE_RELAY_URL; delete process.env.EQUICARE_RELAY_KEY;
  rmSync(DATA, { recursive: true, force: true });
});

// ---- the relay on its own ---------------------------------------------------- //
test("the relay takes hub sends with a device token, keeps only its hash, and answers 202", async () => {
  assert.equal((await hubPost("/ingest/readings", null, "[]")).status, 401);
  assert.equal((await hubPost("/ingest/readings", "some-password", "[]")).status, 401, "not a device token");
  const r = await hubPost("/ingest/readings", tokens.hub, JSON.stringify({ readings: [] }),
    { "Content-Type": "application/json", "X-EquiCare-Format": "equicare-wearable/1", "X-Forwarded-For": "100.64.1.2", "User-Agent": "hub/1.0" });
  assert.equal(r.status, 202);
  assert.match((await r.json()).queued, /^\d{15}-/);
  const dir = join(DATA, "relay", "queue");
  const onDisk = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  assert.ok(!onDisk.includes(tokens.hub), "the plaintext token is never stored");
  const meta = JSON.parse(readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith(".json"))), "utf8"));
  assert.equal(meta.tokenHash, createHash("sha256").update(tokens.hub).digest("hex"));
  assert.equal(meta.headers["x-equicare-format"], "equicare-wearable/1");
  assert.equal(meta.headers["content-type"], "application/json");
  assert.equal(meta.headers["x-forwarded-for"], undefined, "the hub's address is not kept");
  assert.equal(meta.headers["user-agent"], undefined, "only X-* and Content-*");
  await ackAll();
});

test("pull and ack need the relay key; items come oldest first, raw as base64", async () => {
  assert.equal((await pull("wrong-key-wrong-key-wrong")).status, 401);
  assert.equal((await fetch(`${base}/relay/pull`)).status, 401);
  assert.equal((await fetch(`${base}/relay/ack`, { method: "POST", body: "{}" })).status, 401);
  await hubPost("/ingest/readings", tokens.hub, '{"readings":[1]}');
  await hubPost("/ingest/raw", tokens.hub, Buffer.from([0, 1, 2, 255]), { "X-Sensor": "leg" });
  await hubPost("/ingest/readings", tokens.hub, '{"readings":[3]}');
  const one = await (await pull(KEY, "?max=2")).json();
  assert.equal(one.items.length, 2);
  assert.equal(one.remaining, 1);
  const all = (await (await pull()).json()).items;
  assert.deepEqual(all.map((i) => i.kind), ["readings", "raw", "readings"]);
  assert.equal(all[0].body, '{"readings":[1]}');
  assert.equal(all[0].encoding, "utf8");
  assert.equal(all[1].encoding, "base64");
  assert.deepEqual([...Buffer.from(all[1].body, "base64")], [0, 1, 2, 255]);
  assert.equal(all[1].headers["x-sensor"], "leg");
  const a = await (await fetch(`${base}/relay/ack`, { method: "POST", headers: { Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ ids: [all[0].id, all[1].id, "nonsense"] }) })).json();
  assert.deepEqual(a, { acked: 2, remaining: 1 });
  await ackAll();
  assert.equal(relay.stats().items, 0);
});

test("the relay refuses oversized requests: 1 MB of readings, 50 MB of raw", async () => {
  assert.equal((await hubPost("/ingest/readings", tokens.hub, "x".repeat(1024 * 1024 + 1))).status, 413);
  assert.equal((await hubPost("/ingest/raw", tokens.hub, Buffer.alloc(50 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await hubPost("/ingest/raw", tokens.hub, Buffer.alloc(0))).status, 400);
  assert.equal(relay.stats().items, 0);
});

test("past 7 days or 2 GB the oldest items are dropped, and it is logged", async () => {
  let now = Date.parse("2026-09-01T00:00:00Z");
  const small = createRelay({ dataDir: join(DATA, "small"), key: KEY, maxBytes: 25, now: () => now, log: quiet });
  const url = `http://127.0.0.1:${await small.listen(0)}`;
  const post = (body) => fetch(`${url}/ingest/readings`, { method: "POST", headers: { Authorization: `Bearer ${tokens.hub}` }, body });
  await post("0123456789"); now += 1000; await post("abcdefghij"); now += 1000;
  assert.equal(small.stats().items, 2);
  await post("ABCDEFGHIJ");                                // 30 bytes > 25: the oldest goes
  assert.equal(small.stats().items, 2);
  assert.ok(logs.some((l) => /dropped 1 item\(s\) to stay under 25 bytes/.test(l)), logs.join("\n"));
  now += 8 * 24 * 3600_000;
  small.enforceCaps();
  assert.equal(small.stats().items, 0);
  assert.ok(logs.some((l) => /older than 168 h/.test(l)));
  await small.close();
});

test("what the relay holds survives a restart; half-written items do not", async () => {
  const dir = join(DATA, "restart");
  const a = createRelay({ dataDir: dir, key: KEY, log: quiet });
  const url = `http://127.0.0.1:${await a.listen(0)}`;
  await fetch(`${url}/ingest/readings`, { method: "POST", headers: { Authorization: `Bearer ${tokens.hub}` }, body: '{"readings":[]}' });
  await a.close();
  writeFileSync(join(dir, "queue", "000000000000001-000001-dead.body"), "orphan");      // no .json: a crash mid-write
  const b = createRelay({ dataDir: dir, key: KEY, log: quiet });
  assert.equal(b.stats().items, 1);
  assert.ok(!readdirSync(join(dir, "queue")).some((f) => f.includes("dead")));
});

test("the relay will not start without a proper RELAY_KEY", () => {
  assert.throws(() => createRelay({ dataDir: join(DATA, "nokey"), key: "short" }), /RELAY_KEY/);
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL("./relay.mjs", import.meta.url)), "--port", "0", "--data", join(DATA, "cli")],
    { env: { ...process.env, RELAY_KEY: "" }, encoding: "utf8", timeout: 10000 });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /RELAY_KEY must be set/);
});

// ---- the site server pulling ------------------------------------------------- //
test("the site server pulls, ingests as the hub (by token hash), acks — and skips what it already has", async () => {
  process.env.EQUICARE_RELAY_URL = base + "/";
  process.env.EQUICARE_RELAY_KEY = KEY;
  const batch = JSON.stringify({ readings: [
    { horseId: "zarina", metric: "steps", value: 350, ts: ago(20), meta: { sensor: "leg", periodMin: 15 } },
    { metric: "device_status", value: 81, ts: ago(20), meta: { sensor: "head", signalDbm: -95 } },
  ] });
  await hubPost("/ingest/readings", tokens.hub, batch, { "Content-Type": "application/json" });
  await hubPost("/ingest/readings", tokens.hub, batch, { "Content-Type": "application/json" });          // the hub retried
  await hubPost("/ingest/readings", tokens.hub, gzipSync(JSON.stringify([{ metric: "steps", value: 40, ts: ago(5), meta: { sensor: "leg" } }])),
    { "Content-Encoding": "gzip" });
  await hubPost("/ingest/readings", "eqd_" + "x".repeat(32), batch);                                 // nobody's token
  const start = Date.now() - 30 * 60000;
  const csv = "t,ax,ay,az,gx,gy,gz\n" + Array.from({ length: 200 }, (_, i) => `${i / 50},0,0,9.81,0,0,0`).join("\n");
  await hubPost("/ingest/raw", tokens.hub, gzipSync(csv), { "Content-Encoding": "gzip", "X-Sensor": "leg", "X-Start": new Date(start).toISOString(), "X-Rate-Hz": "50" });
  assert.equal(relay.stats().items, 5);

  const out = await app.pullRelay();
  assert.deepEqual(out, { received: 4, rejected: 1 });
  assert.equal(relay.stats().items, 0, "everything acked, the unknown token's item too");
  const shaan = appStore.readingsForHorse("shaan");
  assert.equal(shaan.filter((r) => r.metric === "steps").length, 2, "the retried batch counted once; the gzipped one as well");
  assert.equal(appStore.readingsForHorse("zarina").filter((r) => r.metric === "steps").length, 0, "the hub's horse, not the payload's");
  assert.ok(shaan.every((r) => r.meta.deviceId === tokens.hubId));
  const sess = appStore.list("raw_sessions");
  assert.equal(sess.length, 1);
  assert.equal(sess[0].horseId, "shaan");
  const hub = appStore.list("devices").find((d) => d.id === tokens.hubId);
  assert.ok(hub.lastSeen, "the hub shows as heard from");
  assert.equal(hub.sensorStatus.find((s) => s.sensor === "head").batteryPct, 81);

  const h = await tokens.call("GET", "/api/health");
  assert.equal(h.body.relay.lastError, null);
  assert.equal(h.body.relay.received, 4);
  assert.equal(h.body.relay.rejected, 1);
  assert.ok(!JSON.stringify(h.body).includes(KEY), "the key never shows");
});

test("a revoked token's items are refused; a relay that cannot be reached is reported, not fatal", async () => {
  await hubPost("/ingest/readings", tokens.hub, JSON.stringify([{ metric: "steps", value: 1, ts: ago(1), meta: { sensor: "leg" } }]));
  await tokens.call("POST", `/api/devices/${tokens.hubId}/token`);                   // rotated: the old token is dead
  const out = await app.pullRelay();
  assert.deepEqual(out, { received: 0, rejected: 1 });
  assert.equal(relay.stats().items, 0);
  process.env.EQUICARE_RELAY_URL = "http://127.0.0.1:9";                            // nothing listens there
  const down = await app.pullRelay();
  assert.deepEqual(down, { received: 0, rejected: 0 });
  const h = await tokens.call("GET", "/api/health");
  assert.ok(h.body.relay.lastError, "the failure is visible on /api/health");
  process.env.EQUICARE_RELAY_URL = base;
});
