// The wearable set and the stall sensors on the server side: the wearable_hub
// device kind (bound to a horse), attribution by the registry for EVERY device
// token (a device can no longer choose the horse), de-duplication, payload
// formats, Modbus RTU / register `use`, and the store's capacity accounting.
// Drives the real request handler (server/app.mjs), like hardware.test.mjs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const DATA = mkdtempSync(join(tmpdir(), "equicare-wear-"));
const LEGACY = "legacy-ingest-secret";
let handle, store;
const tokens = {};
const ids = {};

const call = async (method, path, { token, body, headers = {}, raw } = {}) => {
  const res = await handle(new Request(`http://local${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, raw: text };
};
const admin = (m, p, body) => call(m, p, { token: tokens.admin, body });
const ingest = (token, readings, opts = {}) => call("POST", "/ingest/readings", { token, body: { readings }, ...opts });
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const of = (horse, metric) => store.readingsForHorse(horse).filter((r) => r.metric === metric);

before(async () => {
  process.env.EQUICARE_DATA_DIR = DATA;
  process.env.EQUICARE_SAMPLE_HORSES = "1";
  process.env.ADMIN_PASSWORD = "test-admin-pw";
  process.env.AUTH_INGEST_TOKEN = LEGACY;
  process.env.EQUICARE_SENSOR_TICK_MS = "0";
  process.env.EQUICARE_NOTIFY_TICK_MS = "0";
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.EQUICARE_RELAY_URL;
  ({ handle } = await import("./app.mjs"));
  tokens.admin = (await call("POST", "/auth/login", { body: { username: "admin", password: "test-admin-pw" } })).body.token;
  for (const [role, extra] of [["staff", {}], ["owner", { owner: "Bharat Sports Venture" }], ["owner2", { owner: "R. Singh" }]]) {
    await admin("POST", "/api/users", { username: role, password: "pw-" + role, role: role.replace(/\d$/, ""), name: role, ...extra });
    tokens[role] = (await call("POST", "/auth/login", { body: { username: role, password: "pw-" + role } })).body.token;
  }
  store = await globalThis.__equicare.ready;
});
after(() => rmSync(DATA, { recursive: true, force: true }));

// ---- the device kind ------------------------------------------------------- //
test("a wearable hub is bound to a horse in the roster; its token is shown once", async () => {
  const r = await admin("POST", "/api/devices", { kind: "wearable_hub", name: "Zarina's halter hub", horseId: "zarina",
    sensors: { leg: "LEG-0001", pelvis: ["PEL-0001"] }, imei: "35693803 5643809", stall: "Z-99" });
  assert.equal(r.status, 201, r.raw);
  assert.match(r.body.token, /^eqd_/);
  tokens.hub = r.body.token; ids.hub = r.body.device.id;
  const d = r.body.device;
  assert.equal(d.horseId, "zarina");
  assert.equal(d.stall, "A-04", "no stall of its own — the horse's current one");
  assert.equal(d.imei, "356938035643809");
  assert.deepEqual(d.sensors, { leg: "LEG-0001", pelvis: ["PEL-0001"] });
  for (const m of ["steps", "lameness_result", "exercise_session", "device_status", "device_detached", "gps_fix", "activity_index", "rest_minutes", "gait_asymmetry"])
    assert.ok(d.metrics.includes(m), m);
  assert.ok(!d.metrics.includes("body_temp_c"));
  const list = await admin("GET", "/api/devices");
  assert.ok(!list.raw.includes(tokens.hub) && !list.raw.includes("tokenHash"));
  assert.equal(list.body.find((x) => x.id === ids.hub).status.state, "never");
});

test("a wearable needs a horse from the roster, a sane IMEI, and its own sensors", async () => {
  const base = { kind: "wearable_hub", name: "hub" };
  const errs = async (b) => { const r = await admin("POST", "/api/devices", { ...base, ...b }); assert.equal(r.status, 400, r.raw); return r.body.details.join(" | "); };
  assert.match(await errs({}), /choose the horse/);
  assert.match(await errs({ horseId: "pegasus" }), /not in the roster/);
  assert.match(await errs({ horseId: "shaan", imei: "12ab" }), /IMEI/);
  assert.match(await errs({ horseId: "zarina" }), /already on this horse/, "two hubs would double-count its steps");
  assert.match(await errs({ horseId: "shaan", sensors: { leg: "LEG-0001" } }), /already paired/);
  assert.match(await errs({ horseId: "shaan", sensors: { leg: "bad id with spaces" } }), /sensor ID/);
  assert.match(await errs({ horseId: "shaan", imei: "356938035643809" }), /already registered/);
});

test("a hub's readings go to ITS horse — a horseId in the payload is ignored", async () => {
  const r = await ingest(tokens.hub, [
    { horseId: "shaan", stallId: "C-06", metric: "steps", value: 480, ts: ago(30), meta: { sensor: "leg", periodMin: 60 } },
    { horseId: "shaan", metric: "activity_index", value: 0.4, ts: ago(30), source: "thermal_camera", meta: { sensor: "leg" } },
    { metric: "body_temp_c", value: 41, ts: ago(30) },
    { metric: "steps", value: 5, ts: ago(29), meta: { sensor: "tail" } },
  ]);
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.body.accepted, 2);
  assert.equal(r.body.rejected, 2);
  assert.match(r.body.rejections.map((x) => x.reason).join(" | "), /not allowed.*meta\.sensor must be/s);
  const steps = of("zarina", "steps");
  assert.equal(steps.length, 1);
  assert.equal(of("shaan", "steps").length, 0, "the payload's horseId must not decide");
  assert.equal(steps[0].stallId, "A-04");
  assert.equal(steps[0].source, "imu");
  assert.equal(steps[0].meta.prototype, true, "unvalidated wearable steps");
  assert.equal(steps[0].meta.deviceId, ids.hub);
  const act = of("zarina", "activity_index")[0];
  assert.equal(act.source, "imu", "a hub cannot pass its activity off as a camera measure");
  assert.equal(act.meta.prototype, true, "so the colic rule ignores it");
  const hub = (await admin("GET", "/api/devices")).body.find((d) => d.id === ids.hub);
  assert.equal(hub.status.state, "online");
});

test("push devices and edge boxes cannot choose the horse either", async () => {
  const push = await admin("POST", "/api/devices", { kind: "push_device", name: "A-04 gateway", stall: "A-04", metrics: ["water_ml"] });
  const p = await ingest(push.body.token, [{ horseId: "shaan", metric: "water_ml", value: 900, ts: ago(20) }]);
  assert.equal(p.body.accepted, 1);
  assert.equal(of("shaan", "water_ml").length, 0);
  assert.equal(of("zarina", "water_ml").length, 1, "attributed by the gateway's stall (A-04 = Zarina)");

  const edge = await admin("POST", "/api/devices", { kind: "edge_box", name: "Barn B edge" });
  tokens.edge = edge.body.token; ids.edge = edge.body.device.id;
  const meter = await admin("POST", "/api/devices", { kind: "modbus_sensor", name: "B-01 meter", stall: "B-01", host: "127.0.0.1",
    port: 1502, edgeId: ids.edge, registers: [{ name: "total", address: 1, type: "uint32", metric: "water_ml", use: "flow" }] });
  assert.equal(meter.status, 201, meter.raw);
  ids.meter = meter.body.device.id;
  const e = await ingest(tokens.edge, [{ deviceId: ids.meter, horseId: "zarina", metric: "water_visit", value: 1, ts: ago(10), meta: { ml: 1200, durationS: 40, boutId: "b1" } }]);
  assert.equal(e.body.accepted, 1);
  assert.equal(of("zarina", "water_visit").length, 0, "an edge box cannot move a reading to another horse");
  assert.equal(of("shaan", "water_visit").length, 1, "B-01 = Shaan");
});

test("only the legacy ingest token may still name the horse", async () => {
  const r = await ingest(LEGACY, [{ horseId: "noor", stallId: "A-04", metric: "feed_intake_g", value: 1500, ts: ago(5) }]);
  assert.equal(r.status, 200);
  assert.equal(r.body.accepted, 1);
  assert.equal(of("noor", "feed_intake_g").length, 1);
  assert.equal((await ingest("not-a-token", [{ horseId: "noor", metric: "steps", value: 1 }])).status, 401);
});

test("a re-sent reading is stored once, and the response says how many were duplicates", async () => {
  const batch = [
    { metric: "device_status", value: 76, ts: ago(15), meta: { sensor: "leg", hardwareId: "LEG-0001", signalDbm: -71, attached: true } },
    { metric: "device_status", value: 64, ts: ago(15), meta: { sensor: "head", signalDbm: -80, attached: true, firmware: "1.0.3" } },
  ];
  const first = await ingest(tokens.hub, batch);
  assert.equal(first.body.accepted, 2);
  assert.equal(first.body.duplicates, 0);
  const again = await ingest(tokens.hub, batch);
  assert.equal(again.body.accepted, 0);
  assert.equal(again.body.duplicates, 2);
  assert.equal(of("zarina", "device_status").length, 2);
  // In one batch, and the tie-breakers: meta.kind and meta.seq tell apart two
  // events of one instant.
  const t = ago(14);
  const inOne = await ingest(tokens.hub, [
    { metric: "device_detached", value: 1, ts: t, meta: { sensor: "pelvis", seq: 1 } },
    { metric: "device_detached", value: 1, ts: t, meta: { sensor: "pelvis", seq: 1 } },
    { metric: "device_detached", value: 1, ts: t, meta: { sensor: "pelvis", seq: 2 } },
  ]);
  assert.equal(inOne.body.accepted, 2);
  assert.equal(inOne.body.duplicates, 1);
  // A reading from no known device has no key: the legacy path is unchanged.
  const leg = await ingest(LEGACY, [{ horseId: "noor", metric: "steps", value: 3, ts: t, meta: { dedupKey: "forged" } }]);
  assert.equal(leg.body.accepted, 1);
  assert.equal(of("noor", "steps")[0].meta.dedupKey, undefined, "a sender cannot plant a key");
});

test("the hub's status per sensor is kept on the device, newest news winning", async () => {
  await ingest(tokens.hub, [
    { metric: "device_status", value: 12, ts: ago(60), meta: { sensor: "leg", hardwareId: "LEG-0001", attached: true } },   // older: ignored
    { metric: "device_detached", value: 1, ts: ago(1), meta: { sensor: "head" } },
  ]);
  const hub = (await admin("GET", "/api/devices")).body.find((d) => d.id === ids.hub);
  const leg = hub.sensorStatus.find((s) => s.sensor === "leg");
  const head = hub.sensorStatus.find((s) => s.sensor === "head");
  assert.equal(leg.batteryPct, 76);
  assert.equal(leg.signalDbm, -71);
  assert.equal(leg.hardwareId, "LEG-0001");
  assert.equal(head.attached, false, "came off after its last status");
  assert.equal(head.firmware, "1.0.3");
  const refused = await ingest(tokens.hub, [{ metric: "device_status", value: 50, ts: ago(1) }]);
  assert.equal(refused.body.rejected, 1, "a status must say which sensor it is about");
});

test("the horse page carries motion and intake (null where nothing was measured)", async () => {
  const z = await admin("GET", "/api/horses/zarina");
  assert.equal(z.status, 200);
  assert.ok("motion" in z.body && "intake" in z.body);
  assert.notEqual(z.body.motion, null, "Zarina has wearable readings");
  const laila = await admin("GET", "/api/horses/laila");
  assert.equal(laila.body.motion, null, "no wearable: not measured, not zero");
  assert.equal(laila.body.intake, null);
});

test("payload formats: ours by default, an unknown one refused with the known ones listed, gzip accepted", async () => {
  const bad = await ingest(tokens.hub, [], { headers: { "X-EquiCare-Format": "vendor-x/9" } });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.formats.includes("equicare-wearable/1"), bad.raw);
  const ours = await ingest(tokens.hub, [{ metric: "steps", value: 7, ts: ago(3), meta: { sensor: "leg", periodMin: 1 } }],
    { headers: { "X-EquiCare-Format": "equicare-wearable/1" } });
  assert.equal(ours.body.accepted, 1);
  const gz = await call("POST", "/ingest/readings", { token: tokens.hub, headers: { "Content-Encoding": "gzip" },
    raw: gzipSync(JSON.stringify({ readings: [{ metric: "steps", value: 9, ts: ago(2), meta: { sensor: "leg", periodMin: 1 } }] })) });
  assert.equal(gz.status, 200, gz.raw);
  assert.equal(gz.body.accepted, 1);
  const broken = await call("POST", "/ingest/readings", { token: tokens.hub, raw: "{not json" });
  assert.equal(broken.status, 400);
  assert.equal(broken.body.error, "malformed JSON");
});

test("a hub whose horse left the roster: its readings are refused, not misattributed", async () => {
  await admin("POST", "/api/horses", { id: "visitor", name: "Visitor", stall: "D-01" });
  const r = await admin("POST", "/api/devices", { kind: "wearable_hub", name: "loan hub", horseId: "visitor" });
  assert.equal(r.status, 201, r.raw);
  assert.equal((await ingest(r.body.token, [{ metric: "steps", value: 1, ts: ago(1), meta: { sensor: "leg" } }])).body.accepted, 1);
  await admin("DELETE", "/api/horses/visitor");
  const after = await ingest(r.body.token, [{ metric: "steps", value: 2, ts: ago(0), meta: { sensor: "leg" } }]);
  assert.equal(after.body.accepted, 0);
  assert.match(after.body.rejections[0].reason, /no longer in the roster/);
  await admin("DELETE", `/api/devices/${r.body.device.id}`);
});

test("owners see their own horses' wearables (with the horse's stall), not others'", async () => {
  const mine = await call("GET", "/api/devices", { token: tokens.owner });
  const hub = mine.body.find((d) => d.id === ids.hub);
  assert.ok(hub, "Zarina belongs to Bharat Sports Venture");
  assert.equal(hub.stall, "A-04");
  assert.equal(Object.keys(hub).sort().join(), "calibrated,id,kind,name,stall,status");
  const theirs = await call("GET", "/api/devices", { token: tokens.owner2 });
  assert.ok(!theirs.body.some((d) => d.id === ids.hub));
});

test("a wearable's token rotates; a silent wearable raises a hardware alert naming the horse", async () => {
  const r = await admin("POST", `/api/devices/${ids.hub}/token`);
  assert.match(r.body.token, /^eqd_/);
  assert.equal((await ingest(tokens.hub, [{ metric: "steps", value: 1, ts: ago(0), meta: { sensor: "leg" } }])).status, 401);
  tokens.hub = r.body.token;
  store.update("devices", ids.hub, { lastSeen: ago(60) });
  const a = (await admin("GET", "/api/alerts")).body.filter((x) => x.device && x.type === "Device not reporting");
  assert.ok(a.some((x) => /on Zarina/.test(x.detail)), JSON.stringify(a));
});

// ---- Modbus: RS-485 and register use --------------------------------------- //
test("an RS-485 (Modbus RTU) sensor needs a serial port and sane line settings — not an IP", async () => {
  const base = { kind: "modbus_sensor", name: "bowl", stall: "A-07", edgeId: null, transport: "rtu",
    registers: [{ name: "bowl", address: 0, type: "int32", scale: 1, use: "feed_bowl" }] };
  const bad = await admin("POST", "/api/devices", { ...base, serialPort: "ttyUSB0; rm -rf", baud: 300, parity: "X", stopBits: 3, unitId: 0 });
  assert.equal(bad.status, 400);
  const d = bad.body.details.join(" | ");
  for (const re of [/serial port must be a device path/, /baud/, /parity/, /stop bits/, /broadcast/]) assert.match(d, re);
  assert.doesNotMatch(d, /IP address/, "RS-485 has no address to reach");
  assert.match((await admin("POST", "/api/devices", { ...base, serialPort: "" })).body.details.join(" "), /serial port is required/);
  const ok = await admin("POST", "/api/devices", { ...base, edgeId: ids.edge, serialPort: "/dev/ttyUSB0", baud: 19200, parity: "e", unitId: 3 });
  assert.equal(ok.status, 201, ok.raw);
  ids.bowl = ok.body.device.id;
  const dev = ok.body.device;
  assert.deepEqual([dev.transport, dev.serialPort, dev.baud, dev.parity, dev.stopBits, dev.host], ["rtu", "/dev/ttyUSB0", 19200, "E", 1, ""]);
  assert.equal(dev.registers[0].metric, "feed_intake_g", "a feed bowl feeds the feed metrics");
  assert.equal(dev.registers[0].mode, "gauge", "a load cell is read as it is, not as a running total");
  // Same bus: another unit id is fine, the same one is not, and one bus has one line setting.
  const same = await admin("POST", "/api/devices", { ...base, edgeId: ids.edge, serialPort: "/dev/ttyUSB0", baud: 19200, parity: "E", unitId: 3 });
  assert.match(same.body.details.join(" "), /already answers as unit 3/);
  const odd = await admin("POST", "/api/devices", { ...base, edgeId: ids.edge, serialPort: "/dev/ttyUSB0", baud: 9600, unitId: 4 });
  assert.match(odd.body.details.join(" "), /same line settings/);
  const probe = await admin("POST", `/api/devices/${ids.bowl}/probe`);
  assert.equal(probe.status, 400);
  assert.match(probe.body.error, /wired to its edge box/);
});

test("register use: validated against what it emits, and delivered to the edge box with the serial settings", async () => {
  const reg = (r) => admin("POST", "/api/devices", { kind: "modbus_sensor", name: "x", stall: "C-02", host: "127.0.0.1", port: 1600 + Math.floor(Math.random() * 1000), registers: [{ name: "r", address: 1, type: "uint16", ...r }] });
  assert.match((await reg({ use: "sprinkler" })).body.details.join(" "), /use must be one of flow, bucket, feed_bowl, hay, fault/);
  assert.match((await reg({ use: "flow", metric: "feed_intake_g" })).body.details.join(" "), /a flow register feeds water_ml \/ water_visit/);
  assert.match((await reg({ use: "fault", faultCodes: { 1: "gremlins" } })).body.details.join(" "), /fault codes/);
  const both = await admin("POST", "/api/devices", { kind: "modbus_sensor", name: "y", stall: "C-02", host: "127.0.0.1", port: 2999, registers: [
    { name: "meter", address: 1, type: "uint32", use: "flow" }, { name: "bucket", address: 3, type: "int32", use: "bucket" }] });
  assert.match(both.body.details.join(" "), /bucket and meter would both send water_ml/, "one stall's water, counted twice — and stored as one reading");
  const hay = await admin("POST", "/api/devices", { kind: "modbus_sensor", name: "C-02 hay + faults", stall: "C-02", edgeId: ids.edge,
    transport: "rtu", serialPort: "/dev/ttyUSB1", unitId: 7, registers: [
      { name: "hay net", address: 10, type: "float32", use: "hay" },
      { name: "feeder fault", address: 20, type: "uint16", use: "fault", faultCodes: { "01": "empty", 2: "jam" } },
      { name: "plain", address: 30, type: "uint16", metric: "water_ml", mode: "counter" },
    ] });
  assert.equal(hay.status, 201, hay.raw);
  const cfg = await call("GET", "/edge/config", { token: tokens.edge });
  const got = cfg.body.devices.find((d) => d.id === hay.body.device.id);
  assert.deepEqual([got.transport, got.serialPort, got.baud, got.parity, got.stopBits], ["rtu", "/dev/ttyUSB1", 9600, "N", 1]);
  assert.deepEqual(got.registers.map((r) => [r.use, r.metric, r.mode]), [["hay", "hay_intake_g", "gauge"], ["fault", "feeder_fault", "gauge"], [undefined, "water_ml", "counter"]]);
  assert.deepEqual(got.registers[1].faultCodes, { 1: "empty", 2: "jam" });
  const flow = cfg.body.devices.find((d) => d.id === ids.meter);
  assert.equal(flow.transport, "tcp");
  assert.equal(flow.serialPort, undefined, "no serial settings for a TCP sensor");
  assert.deepEqual([flow.registers[0].use, flow.registers[0].metric, flow.registers[0].mode], ["flow", "water_ml", "counter"], "a flow meter is a running total");
  // Back to TCP: an address is needed again, and the serial settings go.
  assert.match((await admin("PATCH", `/api/devices/${hay.body.device.id}`, { transport: "tcp" })).body.details.join(" "), /IP address is required/);
  const tcp = await admin("PATCH", `/api/devices/${hay.body.device.id}`, { transport: "tcp", host: "127.0.0.1", port: 2502 });
  assert.equal(tcp.status, 200, tcp.raw);
  assert.equal(tcp.body.serialPort, undefined);
});

// ---- the store ------------------------------------------------------------- //
test("/api/health reports the store's capacity", async () => {
  const h = await call("GET", "/api/health");
  assert.equal(h.status, 200);
  assert.equal(h.body.storage.backend, "json");
  assert.equal(h.body.storage.cap, 300000);
  assert.equal(h.body.storage.droppedByCap, 0);
  assert.equal(h.body.storage.advice, null);
  assert.equal(h.body.relay, undefined, "no relay configured");
});

test("the JSON store records readings dropped at its cap, and says to switch to Postgres", async () => {
  const dir = mkdtempSync(join(tmpdir(), "equicare-cap-"));
  const prev = process.env.EQUICARE_DATA_DIR;
  process.env.EQUICARE_DATA_DIR = dir; process.env.EQUICARE_MAX_READINGS = "5";
  process.env.EQUICARE_SAMPLE_HORSES = "1";
  try {
    const { createStore } = await import("./store.mjs");
    const s = await createStore();
    const rs = (from, n) => Array.from({ length: n }, (_, i) => ({ horseId: "h", metric: "steps", value: i, ts: ago(n - i), meta: { deviceId: "d", dedupKey: `k${from + i}` } }));
    assert.equal(s.appendReadings(rs(0, 4)), 4);
    assert.match(s.storage().advice, /80%|at \d+%/, "an early warning before anything is lost");
    const stats = {};
    assert.equal(s.appendReadings([...rs(0, 2), ...rs(10, 3)], stats), 3);
    assert.equal(stats.duplicates, 2);
    const st = s.storage();
    assert.equal(st.readings, 5);
    assert.equal(st.droppedByCap, 2);
    assert.match(st.advice, /Postgres.*DATABASE_URL/);
    // A key dropped with its reading may be stored again (it is no longer there).
    assert.equal(s.appendReadings(rs(0, 1)), 1);
  } finally {
    process.env.EQUICARE_DATA_DIR = prev; delete process.env.EQUICARE_MAX_READINGS;
    process.env.EQUICARE_SAMPLE_HORSES = "1";
    await new Promise((r) => setTimeout(r, 300));          // let the debounced save land before removing
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the Postgres store de-duplicates on a unique dedupKey index and never counts its cache as data lost", async () => {
  const queries = [];
  const pool = { query: async (sql, args) => { queries.push({ sql, args }); return { rows: [] }; } };
  const { makePgStore } = await import("./store.pg.mjs");
  const dedupKeyOf = (r) => r?.meta?.dedupKey ?? null;
  const s = await makePgStore("postgres://x", {
    RETENTION_MS: 21 * 864e5, MAX_READINGS: 3, pool, dedupKeyOf,
    normalize: (r, i) => ({ id: `r-${i}`, ...r, meta: r.meta ?? null }), valid: (r) => typeof r.value === "number",
    storageView: (v) => ({ ...v, advice: v.cacheEvicted ? "cache" : null }),
  });
  assert.ok(queries.some((q) => /CREATE UNIQUE INDEX IF NOT EXISTS readings_dedup_key_idx[\s\S]*meta->>'dedupKey'/.test(q.sql)));
  const rs = [1, 2, 2, 3, 4].map((k, i) => ({ metric: "steps", value: i, ts: ago(5 - i), meta: { dedupKey: `k${k}` } }));
  const stats = {};
  assert.equal(s.appendReadings(rs, stats), 4);
  assert.equal(stats.duplicates, 1);
  const inserts = queries.filter((q) => q.sql.includes("INSERT INTO readings"));
  assert.equal(inserts.length, 4);
  assert.match(inserts[0].sql, /ON CONFLICT DO NOTHING/, "a clash on the dedupKey index is skipped too, not only on the id");
  const v = s.storage();
  assert.equal(v.droppedByCap, 0, "Postgres keeps every reading");
  assert.equal(v.cacheEvicted, 1);
});

test("dedupKey: device, metric, instant, sensor, kind, seq", async () => {
  const { dedupKey } = await import("./contract.mjs");
  assert.equal(dedupKey({ metric: "steps", ts: "2026-09-29T10:00:00Z", meta: {} }), null, "no device, no key");
  assert.equal(dedupKey({ metric: "steps", ts: "2026-09-29T15:30:00+05:30", meta: { deviceId: "d1", sensor: "leg", seq: 4 } }),
    "d1|steps|2026-09-29T10:00:00.000Z|leg||4", "the same instant written two ways is one key");
});

test("deviceByTokenHash finds the device a relay item came from — only by the full hash", async () => {
  const hash = createHash("sha256").update(tokens.hub).digest("hex");
  const devs = globalThis.__equicare.devices;
  assert.equal(devs.deviceByTokenHash(hash)?.id, ids.hub);
  assert.equal(devs.deviceByTokenHash(hash.slice(0, 63)), null);
  assert.equal(devs.deviceByTokenHash(tokens.hub), null, "the token itself is not a hash");
});
