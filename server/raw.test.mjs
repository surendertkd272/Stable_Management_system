// Raw motion recordings (POST /ingest/raw): validation, storage on disk, the
// raw_sessions index, pairing a leg recording with its head / pelvis ones,
// alignment, turning the analysis into readings, and retention. The analysis
// itself is injected here (gait.mjs has its own tests); the last tests drive
// the real handler with a wearable hub's token.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync, gunzipSync } from "node:zlib";
import { rawStore, checkRawCsv, alignSeries, RawError } from "./raw.mjs";

const DATA = mkdtempSync(join(tmpdir(), "equicare-raw-"));
const T0 = Date.parse("2026-09-29T06:30:00Z");

/** A recording: `n` samples at `rate` Hz, ax = seconds since its own start. */
const csv = (n, rate, { header = true, mag = false } = {}) =>
  (header ? `t,ax,ay,az,gx,gy,gz${mag ? ",mx,my,mz" : ""}\n` : "") +
  Array.from({ length: n }, (_, i) => [(i / rate).toFixed(3), (i / rate).toFixed(3), 0, 9.81, 0, 0, 0, ...(mag ? [1, 2, 3] : [])].join(",")).join("\n") + "\n";
const hdrs = (o) => new Headers(o);
const H = (sensor, startMs, rate = 50, extra = {}) => hdrs({ "X-Sensor": sensor,
  "X-Start": Number.isFinite(startMs) ? new Date(startMs).toISOString() : "after lunch", "X-Rate-Hz": String(rate), ...extra });

/** Just enough of the store for raw.mjs. */
function memStore(horses = [{ id: "zarina", name: "Zarina", stall: "A-04" }]) {
  const ent = { horses };
  const readings = [];
  let n = 0;
  return {
    readings,
    list: (k) => ent[k] ?? [],
    create: (k, o) => { const row = { ...o, id: o.id ?? `${k}-${++n}` }; (ent[k] ||= []).push(row); return row; },
    update: (k, id, p) => { const l = ent[k] || []; const i = l.findIndex((r) => r.id === id); if (i < 0) return null; l[i] = { ...l[i], ...p, id }; return l[i]; },
    remove: (k, id) => { const l = ent[k] || []; const i = l.findIndex((r) => r.id === id); if (i < 0) return false; l.splice(i, 1); return true; },
    appendReadings(rs, stats) {
      const keys = new Set(readings.map((r) => r.meta?.dedupKey));
      let a = 0, d = 0;
      for (const r of rs) { if (keys.has(r.meta.dedupKey)) { d++; continue; } keys.add(r.meta.dedupKey); readings.push(r); a++; }
      if (stats) stats.duplicates = d;
      return a;
    },
  };
}

/** A stand-in for gait.mjs that records what it was given. */
function fakeGait() {
  const calls = [];
  return {
    calls,
    parseRawCsv(text) {
      const rows = text.trim().split("\n").filter((l) => !/[a-z]/i.test(l)).map((l) => l.split(",").map(Number));
      return Object.fromEntries(["t", "ax", "ay", "az", "gx", "gy", "gz"].map((c, j) => [c, Float64Array.from(rows.map((r) => r[j]))]));
    },
    analyzeSession(args) {
      calls.push(args);
      return { durationS: args.leg.t.at(-1), steps: 812, strides: 30, posture: [], trotSegments: [{ startS: 5, endS: 25 }],
        lameness: args.head || args.pelvis ? { limb: "LF", valueMm: 14.23, head: { minDiffMm: -14.2, maxDiffMm: -6.1 }, pelvis: null, strides: 28 } : null };
    },
  };
}

const setup = ({ now = () => T0 + 3600_000, expected = () => ["head"], analyzer } = {}) => {
  const store = memStore();
  const dir = mkdtempSync(join(DATA, "s-"));
  const gait = analyzer ?? fakeGait();
  const raw = rawStore({ store, dataDir: dir, analyzer: gait, now, expectedSensors: expected, log: { warn() {} } });
  return { store, dir, gait, raw, up: (sensor, startMs, body, rate, extra) =>
    raw.upload({ horseId: "zarina", deviceId: "hub-1", headers: H(sensor, startMs, rate, extra), bytes: Buffer.from(body) }) };
};

// ---- the CSV ----------------------------------------------------------------- //
test("the CSV check follows the gait parser's rules and names the bad line", () => {
  assert.deepEqual(checkRawCsv(csv(5, 50)), { samples: 5, lastT: 0.08 });
  assert.equal(checkRawCsv(csv(3, 10, { header: false, mag: true })).samples, 3, "10 columns, no header");
  assert.equal(checkRawCsv("# hub fw 1.0\nax,t,ay,az,gx,gy,gz\n1,0,0,0,0,0,0\n1,0.02,0,0,0,0,0\n").lastT, 0.02, "header in any order");
  const bad = (text, re) => assert.throws(() => checkRawCsv(text), (e) => e instanceof RawError && e.status === 400 && re.test(e.message));
  bad("t,ax\n0,1\n", /header lacks ay/);
  bad("0,1,2,3\n", /line 1: expected 7 columns/);
  bad("0,0,0,9.8,0,0,0\n0.1,0,0,x,0,0,0\n", /line 2: "x" is not a number/);
  bad("0.2,0,0,0,0,0,0\n0.1,0,0,0,0,0,0\n", /t goes backwards/);
  bad("t,ax,ay,az,gx,gy,gz\n", /no samples/);
});

test("alignment puts recordings that started at different moments on one grid", () => {
  const leg = { t: Float64Array.from([0, 0.1, 0.2, 0.3, 0.4, 0.5]), ax: Float64Array.from([0, 1, 2, 3, 4, 5]) };
  const a = alignSeries(leg, 0.2, 0.2, 20);            // from 0.2 s of its own time, 0.2 s long, at 20 Hz
  assert.deepEqual([...a.t].map((x) => +x.toFixed(3)), [0, 0.05, 0.1, 0.15, 0.2]);
  assert.deepEqual([...a.ax].map((x) => +x.toFixed(3)), [2, 2.5, 3, 3.5, 4], "linear between samples");
});

// ---- uploads ------------------------------------------------------------------ //
test("an upload is checked before anything is stored", () => {
  const { up, store } = setup();
  const status = (fn) => { try { fn(); return 0; } catch (e) { assert.ok(e instanceof RawError, e.message); return [e.status, e.message]; } };
  assert.match(status(() => up("tail", T0, csv(5, 50)))[1], /X-Sensor must be leg, head, pelvis/);
  assert.match(status(() => up("leg", NaN, csv(5, 50)))[1], /X-Start/);
  assert.match(status(() => up("leg", T0 + 3 * 864e5, csv(5, 50)))[1], /future/);
  assert.match(status(() => up("leg", T0 - 40 * 864e5, csv(5, 50)))[1], /older than the 30-day/);
  assert.match(status(() => up("leg", T0, csv(5, 50), 0))[1], /X-Rate-Hz/);
  assert.match(status(() => up("leg", T0, Buffer.from([0x1f, 0x8b, 1, 2, 3])))[1], /does not unzip/);
  assert.match(status(() => up("leg", T0, ""))[1], /empty/);
  assert.equal(store.list("raw_sessions").length, 0);
});

test("a recording is kept gzipped under raw/<horse>/<day>/, indexed, and a re-send is one copy", () => {
  const { up, store, dir } = setup();
  const r = up("leg", T0, csv(500, 50));
  assert.equal(r.status, 201);
  const s = store.list("raw_sessions")[0];
  assert.equal(s.path, join("raw", "zarina", "2026-09-29", "20260929T063000Z-leg-hub-1.csv.gz"));
  assert.deepEqual([s.horseId, s.deviceId, s.sensor, s.start, s.rateHz, s.samples, s.processed, s.results],
    ["zarina", "hub-1", "leg", "2026-09-29T06:30:00.000Z", 50, 500, false, null]);
  assert.equal(s.end, "2026-09-29T06:30:09.980Z");
  const file = join(dir, s.path);
  assert.equal(gunzipSync(readFileSync(file)).toString(), csv(500, 50), "stored gzipped, byte for byte");
  assert.equal(s.bytes, readFileSync(file).length);
  const gz = gzipSync(csv(100, 50));
  const g = up("head", T0, gz, 50, { "Content-Encoding": "gzip" });
  assert.equal(g.status, 201);
  assert.deepEqual(readFileSync(join(dir, store.list("raw_sessions")[1].path)), gz, "a gzipped upload is kept as sent");
  const again = up("leg", T0, csv(500, 50));
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(store.list("raw_sessions").length, 2);
});

// ---- processing ------------------------------------------------------------ //
test("leg + head overlapping: analysed over their overlap, results stored as prototype imu readings", async () => {
  const { up, raw, store, gait } = setup();
  up("leg", T0, csv(1500, 50));                        // 30 s from T0
  assert.equal(await raw.processPending(), 0, "the leg waits for the hub's head recording");
  up("head", T0 + 2000, csv(1500, 50));                // starts 2 s later
  assert.equal(await raw.processPending(), 1);
  const [args] = gait.calls;
  assert.equal(args.rateHz, 50);
  assert.equal(args.pelvis, null);
  assert.equal(args.leg.t[0], 0);
  assert.equal(args.leg.t.length, args.head.t.length, "one grid");
  assert.ok(Math.abs(args.leg.ax[0] - 2) < 1e-9, "the leg is read from 2 s in — where the head recording starts");
  assert.ok(Math.abs(args.head.ax[0]) < 1e-9);
  const by = (m) => store.readings.filter((r) => r.metric === m);
  const ids = store.list("raw_sessions").map((s) => s.id);
  for (const r of store.readings) {
    assert.equal(r.source, "imu");
    assert.equal(r.horseId, "zarina");
    assert.equal(r.stallId, "A-04");
    assert.equal(r.meta.prototype, true);
    assert.deepEqual(r.meta.rawSessionIds.sort(), ids.sort());
    assert.ok(r.meta.dedupKey.startsWith("hub-1|"));
    assert.ok(r.confidence < 1, "an unvalidated analysis");
  }
  const lame = by("lameness_result")[0];
  assert.equal(lame.value, 14.2);
  assert.equal(lame.meta.limb, "LF");
  assert.deepEqual(lame.meta.head, { minDiffMm: -14.2, maxDiffMm: -6.1 });
  assert.equal(lame.meta.pelvis, null);
  assert.equal(lame.meta.durationS, 20);
  assert.equal(lame.ts, new Date(T0 + 2000 + 5000).toISOString(), "at the start of the trot");
  const ex = by("exercise_session")[0];
  assert.equal(ex.ts, new Date(T0 + 2000).toISOString());
  assert.deepEqual([ex.meta.steps, ex.meta.distanceM, ex.meta.trotMin], [812, null, 0.3]);
  assert.equal(by("steps")[0].value, 812);
  assert.equal(by("steps")[0].meta.sensor, "leg");
  const [leg, head] = store.list("raw_sessions");
  assert.equal(leg.processed, true);
  assert.deepEqual(leg.results.lameness, { limb: "LF", valueMm: 14.23 });
  assert.deepEqual(leg.results.sensors, ["leg", "head"]);
  assert.equal(head.results.usedWith, leg.id);
  assert.equal(await raw.processPending(), 0, "done once");
});

test("a leg recording waits for the pelvis the hub has paired — then goes ahead alone", async () => {
  let now = T0 + 3600_000;
  const { up, raw, store, gait } = setup({ now: () => now, expected: () => ["head", "pelvis"] });
  up("leg", T0, csv(1000, 50));
  up("head", T0 + 120_000, csv(100, 50));              // no overlap: a different session
  assert.equal(await raw.processPending(), 0);
  now += 11 * 60_000;
  assert.equal(await raw.processPending(), 1);
  assert.equal(gait.calls[0].head, null, "a recording that does not overlap is not used");
  assert.equal(store.readings.filter((r) => r.metric === "lameness_result").length, 0, "no head or pelvis: no lameness result");
  assert.equal(store.readings.filter((r) => r.metric === "exercise_session").length, 1);
  const head = store.list("raw_sessions").find((s) => s.sensor === "head");
  assert.match(head.results.skipped, /no leg-tag recording overlaps/, "said why, not left pending");
});

test("while the analysis is unavailable recordings wait; a failing analysis is recorded, not retried for ever", async () => {
  let gait = null;
  const { up, raw, store } = setup({ analyzer: async () => { if (!gait) throw new Error("gait.mjs not there"); return gait; } });
  up("leg", T0, csv(600, 50)); up("head", T0, csv(600, 50));
  assert.equal(await raw.processPending(), 0);
  assert.equal(store.list("raw_sessions").every((s) => !s.processed), true);
  gait = { ...fakeGait(), analyzeSession() { throw new Error("no strides"); } };
  assert.equal(await raw.processPending(), 1);
  const leg = store.list("raw_sessions").find((s) => s.sensor === "leg");
  assert.equal(leg.processed, true);
  assert.equal(leg.results.error, "no strides");
  assert.equal(store.readings.length, 0);
});

test("recordings older than EQUICARE_RAW_DAYS are removed, files and index", async () => {
  let now = T0 + 3600_000;
  const { up, raw, store, dir } = setup({ now: () => now });
  up("leg", T0, csv(100, 50));
  const file = join(dir, store.list("raw_sessions")[0].path);
  assert.ok(existsSync(file));
  process.env.EQUICARE_RAW_DAYS = "2";
  try {
    now = T0 + 1.5 * 864e5;
    assert.equal(raw.prune(), 0);
    now = T0 + 2.1 * 864e5;
    assert.equal(raw.prune(), 1);
  } finally { delete process.env.EQUICARE_RAW_DAYS; }
  assert.equal(store.list("raw_sessions").length, 0);
  assert.ok(!existsSync(file));
  assert.ok(!existsSync(join(dir, "raw", "zarina")), "empty folders go too");
});

// ---- through the real handler ------------------------------------------------- //
let handle, appStore;
const tokens = {};
const call = async (method, path, { token, body, headers = {} } = {}) => {
  const res = await handle(new Request(`http://local${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body),
  }));
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, raw: text };
};
const upload = (token, sensor, startMs, body, extra = {}) => call("POST", "/ingest/raw", { token, body,
  headers: { "X-Sensor": sensor, "X-Start": new Date(startMs).toISOString(), "X-Rate-Hz": "50", "Content-Type": "text/csv", ...extra } });

before(async () => {
  process.env.EQUICARE_DATA_DIR = join(DATA, "app");
  process.env.ADMIN_PASSWORD = "test-admin-pw";
  process.env.EQUICARE_SENSOR_TICK_MS = "0";
  process.env.EQUICARE_NOTIFY_TICK_MS = "0";
  delete process.env.DATABASE_URL; delete process.env.VERCEL; delete process.env.AUTH_INGEST_TOKEN; delete process.env.EQUICARE_RELAY_URL;
  ({ handle } = await import("./app.mjs"));
  tokens.admin = (await call("POST", "/auth/login", { body: { username: "admin", password: "test-admin-pw" }, headers: { "Content-Type": "application/json" } })).body.token;
  const mk = async (u, role, extra = {}) => {
    await call("POST", "/api/users", { token: tokens.admin, body: { username: u, password: "pw-" + u, role, name: u, ...extra } });
    tokens[u] = (await call("POST", "/auth/login", { body: { username: u, password: "pw-" + u } })).body.token;
  };
  await mk("staff", "staff"); await mk("owner", "owner", { owner: "Bharat Sports Venture" });
  tokens.hub = (await call("POST", "/api/devices", { token: tokens.admin, body: { kind: "wearable_hub", name: "hub", horseId: "zarina", sensors: { leg: "L1", pelvis: [] } } })).body.token;
  tokens.push = (await call("POST", "/api/devices", { token: tokens.admin, body: { kind: "push_device", name: "gw", stall: "A-04", metrics: ["steps"] } })).body.token;
  appStore = await globalThis.__equicare.ready;
});
after(() => rmSync(DATA, { recursive: true, force: true }));

test("POST /ingest/raw takes a wearable hub's recording and files it under its horse", async () => {
  const start = Date.now() - 3600_000;
  assert.equal((await upload(undefined, "leg", start, csv(100, 50))).status, 401);
  assert.equal((await upload(tokens.push, "leg", start, csv(100, 50))).status, 403, "only a wearable hub is bound to a horse");
  assert.equal((await upload(tokens.hub, "knee", start, csv(100, 50))).status, 400);
  const r = await upload(tokens.hub, "leg", start, csv(1500, 50));
  assert.equal(r.status, 201, r.raw);
  const g = await upload(tokens.hub, "head", start, gzipSync(csv(1500, 50)), { "Content-Encoding": "gzip" });
  assert.equal(g.status, 201, g.raw);
  const day = new Date(start).toISOString().slice(0, 10);
  const s = appStore.list("raw_sessions").find((x) => x.id === r.body.id);
  assert.ok(s.path.startsWith(join("raw", "zarina", day)));
  assert.ok(existsSync(join(DATA, "app", s.path)));
  // The analysis runs in the background with the real gait.mjs: it finishes,
  // whatever it makes of a synthetic recording.
  for (let i = 0; i < 50 && !appStore.list("raw_sessions").every((x) => x.processed); i++) await new Promise((res) => setTimeout(res, 20));
  const leg = appStore.list("raw_sessions").find((x) => x.id === r.body.id);
  assert.equal(leg.processed, true, JSON.stringify(leg));
  if (!leg.results.error) {
    const ex = appStore.readingsForHorse("zarina").filter((x) => x.metric === "exercise_session");
    assert.equal(ex.length, 1);
    assert.equal(ex[0].meta.prototype, true);
  }
});

test("an upload over 50 MB is refused", async () => {
  const r = await upload(tokens.hub, "leg", Date.now() - 60_000, Buffer.alloc(50 * 1024 * 1024 + 1, 0x30));
  assert.equal(r.status, 413);
});

test("GET /api/raw lists a horse's recordings for the yard's people, not owners", async () => {
  const list = await call("GET", "/api/raw?horse=zarina", { token: tokens.staff });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map((s) => s.sensor).sort(), ["head", "leg"]);
  for (const k of ["id", "horseId", "deviceId", "sensor", "start", "rateHz", "samples", "bytes", "path", "processed", "results"])
    assert.ok(k in list.body[0], k);
  assert.equal((await call("GET", "/api/raw?horse=shaan", { token: tokens.admin })).body.length, 0);
  assert.equal((await call("GET", "/api/raw?horse=pegasus", { token: tokens.admin })).status, 404);
  assert.equal((await call("GET", "/api/raw?horse=zarina", { token: tokens.owner })).status, 404);
});
