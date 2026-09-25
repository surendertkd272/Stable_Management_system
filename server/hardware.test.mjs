// Hardware integration: datasheet maths, credentials, the device registry,
// edge boxes, push devices, ingest attribution and access control. Drives the
// real request handler (server/app.mjs) with Web Requests, against in-process
// fake camera and Modbus devices.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DATA = mkdtempSync(join(tmpdir(), "equicare-hw-"));
let handle, spec, secrets, camera, fakeCam, fakeMb;
const tokens = {};
const ids = {};

const call = async (method, path, { token, body } = {}) => {
  const res = await handle(new Request(`http://local${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, raw: text };
};
const admin = (m, p, body) => call(m, p, { token: tokens.admin, body });

before(async () => {
  process.env.EQUICARE_DATA_DIR = DATA;
  process.env.ADMIN_PASSWORD = "test-admin-pw";
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.AUTH_INGEST_TOKEN;
  ({ handle } = await import("./app.mjs"));
  spec = await import("./hardware-spec.mjs");
  secrets = await import("./secrets.mjs");
  camera = await import("./camera.mjs");
  fakeCam = await (await import("./testing/fake-camera.mjs")).startFakeCamera({ serial: "SN-A", password: "cam-secret-123" });
  // flow meter: float32 total litres at 100-101 (high word first), int16 temp at 200
  fakeMb = await (await import("./testing/fake-modbus.mjs")).startFakeModbus({ 100: 0x4296, 101: 0x0000, 200: 0xfffe });

  tokens.admin = (await call("POST", "/auth/login", { body: { username: "admin", password: "test-admin-pw" } })).body.token;
  for (const [role, extra] of [["staff", {}], ["owner", { owner: "Bharat Sports Venture" }]]) {
    await admin("POST", "/api/users", { username: role, password: "pw-" + role, role, name: role, ...extra });
    tokens[role] = (await call("POST", "/auth/login", { body: { username: role, password: "pw-" + role } })).body.token;
  }
});
after(async () => {
  (await import("./camera-pool.mjs")).forget(ids.cam);
  await fakeCam?.close(); await fakeMb?.close();
  rmSync(DATA, { recursive: true, force: true });
});

// ---- datasheet ------------------------------------------------------------ //
test("optics: the PO's 640 variants clear the nostril threshold at 3.5 m; the 256/3.2 cannot", () => {
  assert.ok(spec.assessOptics("640", "25", 3.5).targets.nostril.px > 20);
  assert.ok(spec.assessOptics("640", "13", 3.5).targets.nostril.px > 10);
  assert.equal(spec.assessOptics("256", "3.2", 3.5).targets.nostril.verdict, "insufficient");
  // Vendor's pixel figures (27 Jul) agree with the model: 13 mm ≈ 12–13 px at 3 m, 25 mm ≈ 24 px.
  assert.ok(Math.abs(spec.pixelsOnTarget("640", "13", 3, 5) - 12.5) < 1);
  assert.ok(Math.abs(spec.pixelsOnTarget("640", "25", 3, 5) - 24) < 1.5);
  // Focus (vendor, factory-focused at 3.5 m): the 25 mm lens is sharp only 3.0–4.3 m.
  assert.equal(spec.focusFor("640", "25", 3.5).verdict, "sharp");
  assert.equal(spec.focusFor("640", "25", 2.5).verdict, "blurred", "enough pixels, but out of focus");
  assert.equal(spec.focusFor("640", "25", 4.5).verdict, "blurred");
  assert.equal(spec.focusFor("640", "13", 2.5).verdict, "sharp");
  assert.equal(spec.focusFor("640", "13", 1.5).verdict, "blurred");
  assert.equal(spec.focusFor("384", "7.5", 3).verdict, "unknown", "not stated by the vendor — not guessed");
  assert.equal(spec.assessOptics("640", "25", 2.5).focus.verdict, "blurred");
  assert.equal(spec.thermalFootprint("640", "6", 3.5), null, "6 mm is not a 640 lens");
});

test("secrets round-trip and detect tampering", () => {
  const s = secrets.seal("hunter2");
  assert.equal(secrets.open(s), "hunter2");
  assert.equal(secrets.open(s.slice(0, -2) + "xx"), null);
});

test("the server will only connect to site-network addresses", async () => {
  for (const ok of ["127.0.0.1", "192.168.1.102", "10.0.4.20", "172.20.0.5", "fd00::1"])
    assert.equal((await camera.checkHost(ok)).ok, true, ok);
  for (const bad of ["8.8.8.8", "1.1.1.1", "http://192.168.1.2", "a b"])
    assert.equal((await camera.checkHost(bad)).ok, false, bad);
});

// ---- edge boxes ----------------------------------------------------------- //
test("an edge box gets a token once; the list never shows it or its hash", async () => {
  const r = await admin("POST", "/api/devices", { kind: "edge_box", name: "Barn A edge", location: "Barn A tack room" });
  assert.equal(r.status, 201);
  assert.match(r.body.token, /^eqd_/);
  tokens.edge = r.body.token; ids.edge = r.body.device.id;
  const list = await admin("GET", "/api/devices");
  assert.ok(!list.raw.includes(tokens.edge) && !list.raw.includes("tokenHash"), "token material in list");
  assert.equal(list.body.find((d) => d.id === ids.edge).status.state, "never");
});

test("once a device token exists, anonymous ingest is refused", async () => {
  const r = await call("POST", "/ingest/readings", { body: { readings: [{ stallId: "A-04", metric: "steps", value: 1 }] } });
  assert.equal(r.status, 401);
});

// ---- cameras -------------------------------------------------------------- //
const CAM = () => ({
  kind: "thermal_camera", name: "A-04 thermal", stall: "A-04", host: "127.0.0.1", httpPort: fakeCam.port,
  username: "admin", password: "cam-secret-123", variant: "640", thermalLens: "25", visibleLens: "4",
  distanceM: 3.5, emissivity: 0.98, edgeId: null,
});

test("admin registers a camera; the password never comes back and is encrypted at rest", async () => {
  const r = await admin("POST", "/api/devices", { ...CAM(), edgeId: ids.edge });
  assert.equal(r.status, 201);
  ids.cam = r.body.device.id;
  assert.equal(r.body.device.hasPassword, true);
  assert.ok(!r.raw.includes("cam-secret-123"));
  await new Promise((res) => setTimeout(res, 400));          // JSON store debounces writes
  const state = readFileSync(join(DATA, "state.json"), "utf8");
  assert.ok(!state.includes("cam-secret-123"), "plaintext password at rest");
  assert.match(state, /"passwordEnc":"v1:/);
});

test("invalid optics and duplicate endpoints are refused", async () => {
  const lens = await admin("POST", "/api/devices", { ...CAM(), httpPort: 1, thermalLens: "6" });
  assert.equal(lens.status, 400);
  assert.match(lens.body.details.join(" "), /13 or 25 mm/);
  const dup = await admin("POST", "/api/devices", CAM());
  assert.equal(dup.status, 400);
  assert.match(dup.body.details.join(" "), /already registered/);
});

test("connection test logs in, and pins the camera's serial number", async () => {
  const r = await admin("POST", `/api/devices/${ids.cam}/probe`);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true, JSON.stringify(r.body.steps));
  const cam = (await admin("GET", "/api/devices")).body.find((d) => d.id === ids.cam);
  assert.equal(cam.identity.serial, "SN-A");
});

test("calibration is verified by reading the ROIs back from the camera", async () => {
  const r = await admin("PUT", `/api/devices/${ids.cam}/rois`, {
    eye: { x: 3300, y: 3400 }, nostril: { x0: 2000, y0: 6250, x1: 3000, y1: 6950 } });
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.body.verify.verified, true);
  assert.equal(fakeCam.st.rois.get("Point:0").Point.RatX, 3300);
});

test("tiny or inverted nostril boxes are refused before anything reaches the camera", async () => {
  for (const nostril of [{ x0: 10, y0: 10, x1: 20, y1: 20 }, { x0: 600, y0: 1, x1: 500, y1: 900 }]) {
    const r = await admin("PUT", `/api/devices/${ids.cam}/rois`, { eye: { x: 5000, y: 5000 }, nostril });
    assert.equal(r.status, 400);
  }
});

test("a different camera at the same IP is refused (409), until an admin confirms it", async () => {
  fakeCam.st.serial = "SN-B";
  (await import("./camera-pool.mjs")).forget(ids.cam);
  const r = await admin("GET", `/api/devices/${ids.cam}/temps`);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /SN-A.*SN-B/);
  const ok = await admin("POST", `/api/devices/${ids.cam}/probe?acceptIdentity=1`);
  assert.equal(ok.body.ok, true);
  assert.equal((await admin("GET", `/api/devices/${ids.cam}/temps`)).status, 200);
  const cam = (await admin("GET", "/api/devices")).body.find((d) => d.id === ids.cam);
  assert.equal(cam.identity.serial, "SN-B");
  assert.equal(cam.rois.stale, true, "a replacement unit has not been aimed");
  fakeCam.st.serial = "SN-A";
  await admin("POST", `/api/devices/${ids.cam}/probe?acceptIdentity=1`);
});

test("moving a camera marks its calibration stale", async () => {
  const r = await admin("PATCH", `/api/devices/${ids.cam}`, { distanceM: 4 });
  assert.equal(r.body.rois.stale, true);
  await admin("PATCH", `/api/devices/${ids.cam}`, { distanceM: 3.5 });
  await admin("PUT", `/api/devices/${ids.cam}/rois`, { eye: { x: 3300, y: 3400 }, nostril: { x0: 2000, y0: 6250, x1: 3000, y1: 6950 } });
});

test("an undecryptable stored password produces a clear instruction, not a login error", async () => {
  process.env.CAMERA_SECRET_KEY = "a-different-key";
  secrets._resetKeyForTests();
  (await import("./camera-pool.mjs")).forget(ids.cam);
  const r = await admin("GET", `/api/devices/${ids.cam}/temps`);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /cannot be decrypted.*re-enter/i);
  delete process.env.CAMERA_SECRET_KEY;
  secrets._resetKeyForTests();
});

// ---- the edge-box protocol ------------------------------------------------ //
test("an edge box fetches ONLY its own enabled devices, with what it needs to poll them", async () => {
  const other = await admin("POST", "/api/devices", { kind: "edge_box", name: "Barn B edge" });
  tokens.edgeB = other.body.token; ids.edgeB = other.body.device.id;
  const r = await call("GET", "/edge/config", { token: tokens.edge });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.devices.map((d) => d.id), [ids.cam]);
  const cam = r.body.devices[0];
  assert.equal(cam.password, "cam-secret-123", "the assigned edge box needs the camera login");
  assert.equal(cam.calibrated, true);
  assert.equal(cam.serial, "SN-A");
  const b = await call("GET", "/edge/config", { token: tokens.edgeB });
  assert.deepEqual(b.body.devices, [], "another edge box sees nothing it isn't assigned");
  assert.equal((await call("GET", "/edge/config", { token: "eqd_nope" })).status, 401);
});

test("heartbeat updates device health — but only for the edge's own devices", async () => {
  const r = await call("POST", "/edge/heartbeat", { token: tokens.edgeB, body: {
    agent: { version: "1.2.0" }, devices: [{ id: ids.cam, ok: false, error: "spoofed" }] } });
  assert.equal(r.body.updated, 0, "edge B must not be able to report on edge A's camera");
  await call("POST", "/edge/heartbeat", { token: tokens.edge, body: {
    agent: { version: "1.2.0", host: "jetson-a" }, devices: [{ id: ids.cam, ok: true }] } });
  const list = (await admin("GET", "/api/devices")).body;
  assert.equal(list.find((d) => d.id === ids.edge).status.state, "online");
  assert.equal(list.find((d) => d.id === ids.edge).agent.version, "1.2.0");
});

test("edge readings are attributed by the registry, not by what the edge claims", async () => {
  const r = await call("POST", "/ingest/readings", { token: tokens.edge, body: { readings: [
    { deviceId: ids.cam, stallId: "Z-99", metric: "body_temp_c", value: 37.7, source: "whatever", meta: { calibrated: true } },
  ] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.accepted, 1);
  const horse = (await admin("GET", "/api/horses/zarina")).body;
  assert.equal(horse.vitals.body_temp_c.value, 37.7, "stall came from the registry (A-04 = Zarina), not the claimed Z-99");
  assert.equal(horse.vitals.body_temp_c.calibrated, true);
  const cam = (await admin("GET", "/api/devices")).body.find((d) => d.id === ids.cam);
  assert.equal(cam.status.state, "online");
});

test("an edge box cannot send readings for a device it isn't assigned", async () => {
  const r = await call("POST", "/ingest/readings", { token: tokens.edgeB, body: { readings: [
    { deviceId: ids.cam, metric: "body_temp_c", value: 39.9 } ] } });
  assert.equal(r.body.accepted, 0);
  assert.equal(r.body.rejected, 1);
  assert.match(r.body.rejections[0].reason, /not assigned/);
});

test("an edge box cannot write to a stall by naming it — readings must name its device", async () => {
  const r = await call("POST", "/ingest/readings", { token: tokens.edge, body: { readings: [
    { stallId: "C-06", metric: "body_temp_c", value: 31.4, source: "thermal_camera" } ] } });
  assert.equal(r.body.accepted, 0);
  assert.match(r.body.rejections[0].reason, /must name their device/);
});

test("a camera with no ROIs shows 'needs calibration', not 'waiting' forever", async () => {
  await call("POST", "/edge/heartbeat", { token: tokens.edge, body: { devices: [
    { id: ids.cam, ok: false, code: "NO_ROIS", error: "no ROIs" } ] } });
  const s = (await admin("GET", "/api/devices")).body.find((d) => d.id === ids.cam).status;
  assert.equal(s.state, "needs-calibration");
  await call("POST", "/edge/heartbeat", { token: tokens.edge, body: { devices: [{ id: ids.cam, ok: true }] } });
});

test("a device that hasn't finished its first cycle is not reported as an error", async () => {
  await call("POST", "/edge/heartbeat", { token: tokens.edge, body: { devices: [{ id: ids.cam, ok: null }] } });
  const s = (await admin("GET", "/api/devices")).body.find((d) => d.id === ids.cam).status;
  assert.notEqual(s.state, "error");
  await call("POST", "/edge/heartbeat", { token: tokens.edge, body: { devices: [{ id: ids.cam, ok: true }] } });
});

test("rotating a token revokes the old one immediately", async () => {
  const old = tokens.edgeB;
  const r = await admin("POST", `/api/devices/${ids.edgeB}/token`);
  assert.match(r.body.token, /^eqd_/);
  assert.equal((await call("GET", "/edge/config", { token: old })).status, 401);
  assert.equal((await call("GET", "/edge/config", { token: r.body.token })).status, 200);
});

test("deleting an edge box with devices needs confirmation, then unassigns them", async () => {
  const x = await admin("POST", "/api/devices", { kind: "edge_box", name: "Temp edge" });
  const s = await admin("POST", "/api/devices", { kind: "modbus_sensor", name: "tmp", stall: "B-01", host: "127.0.0.1",
    port: 1502, edgeId: x.body.device.id, registers: [{ name: "w", address: 1, type: "uint16", metric: "water_ml" }] });
  const refused = await admin("DELETE", `/api/devices/${x.body.device.id}`);
  assert.equal(refused.status, 409);
  assert.equal((await admin("DELETE", `/api/devices/${x.body.device.id}?force=1`)).status, 200);
  const sensor = (await admin("GET", "/api/devices")).body.find((d) => d.id === s.body.device.id);
  assert.equal(sensor.edgeId, null);
  assert.equal(sensor.status.state, "unassigned");
  await admin("DELETE", `/api/devices/${s.body.device.id}`);
});

// ---- Modbus sensors ------------------------------------------------------- //
test("a Modbus sensor is configured by register map, and validated against the metric model", async () => {
  const bad = await admin("POST", "/api/devices", { kind: "modbus_sensor", name: "meter", stall: "B-01", host: "127.0.0.1",
    port: fakeMb.port, registers: [{ name: "total", address: 99999, type: "float64", metric: "banana" }] });
  assert.equal(bad.status, 400);
  const d = bad.body.details.join(" ");
  assert.match(d, /address/); assert.match(d, /type must be/); assert.match(d, /metric/);
  const r = await admin("POST", "/api/devices", { kind: "modbus_sensor", name: "B-01 water meter", stall: "B-01",
    host: "127.0.0.1", port: fakeMb.port, edgeId: ids.edge, registers: [
      { name: "total litres", address: 100, type: "float32", wordOrder: "high-first", scale: 1000, metric: "water_ml", mode: "counter" },
      { name: "temperature", address: 200, type: "int16", scale: 0.1, metric: "body_temp_c" },
    ] });
  assert.equal(r.status, 201, r.raw);
  ids.meter = r.body.device.id;
});

test("test read decodes the registers as configured — and reports a wrong address clearly", async () => {
  const r = await admin("POST", `/api/devices/${ids.meter}/probe`);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(r.body.values[0].raw, 75, "0x4296 0000 = 75.0 as float32");
  assert.equal(r.body.values[0].value, 75000, "×1000 scale -> ml");
  assert.ok(Math.abs(r.body.values[1].value - -0.2) < 1e-9, "int16 0xFFFE × 0.1 = -0.2");
  await admin("PATCH", `/api/devices/${ids.meter}`, { addressing: "one-based" });   // now reads 99/199: off by one
  const off = await admin("POST", `/api/devices/${ids.meter}/probe`);
  assert.equal(off.body.ok, false);
  assert.match(off.body.values[0].error, /illegal data address/);
  await admin("PATCH", `/api/devices/${ids.meter}`, { addressing: "zero-based" });
});

test("the edge box receives the sensor's register map", async () => {
  const r = await call("GET", "/edge/config", { token: tokens.edge });
  const meter = r.body.devices.find((d) => d.id === ids.meter);
  assert.equal(meter.registers.length, 2);
  assert.equal(meter.registers[0].mode, "counter");
  assert.equal(meter.password, undefined);
});

// ---- push devices --------------------------------------------------------- //
test("a push device may send only its allowed metrics, attributed to its stall", async () => {
  const r = await admin("POST", "/api/devices", { kind: "push_device", name: "IMU gateway A", stall: "A-04", metrics: ["steps", "activity_index"] });
  assert.equal(r.status, 201);
  const tok = r.body.token;
  const ing = await call("POST", "/ingest/readings", { token: tok, body: { readings: [
    { metric: "steps", value: 120, stallId: "C-06" },
    { metric: "body_temp_c", value: 41 },
  ] } });
  assert.equal(ing.body.accepted, 1);
  assert.equal(ing.body.rejected, 1, "a step counter must not be able to report a fever");
  const z = (await admin("GET", "/api/horses/zarina")).body;
  assert.equal(z.vitals.steps.value, 120, "attributed to A-04 (Zarina), not the claimed C-06");
  assert.equal(z.vitals.steps.unit, "count", "a gateway that omits the unit gets the metric's own");
  assert.equal(z.vitals.steps.source, "imu");
});

// ---- access, audit, alerts ------------------------------------------------ //
test("staff can see devices but not change them; owners see status for their stalls only", async () => {
  assert.equal((await call("GET", "/api/devices", { token: tokens.staff })).status, 200);
  assert.equal((await call("POST", "/api/devices", { token: tokens.staff, body: CAM() })).status, 403);
  assert.equal((await call("POST", `/api/devices/${ids.cam}/token`, { token: tokens.staff })).status, 403);
  assert.equal((await call("GET", `/api/devices/${ids.cam}/snapshot`, { token: tokens.staff })).status, 403);
  const own = await call("GET", "/api/devices", { token: tokens.owner });
  assert.ok(own.body.every((d) => Object.keys(d).sort().join() === "calibrated,id,kind,name,stall,status"));
  assert.ok(!own.raw.includes("127.0.0.1") && !own.raw.includes("edge"), "no addresses, no edge boxes for owners");
  assert.equal((await call("GET", `/api/devices/${ids.cam}/temps`, { token: tokens.owner })).status, 404);
});

test("every change is in the device's audit log, with who did it", async () => {
  const ev = (await admin("GET", `/api/devices/${ids.cam}/events`)).body.map((e) => `${e.action}`);
  for (const a of ["created", "tested", "calibrated", "updated"]) assert.ok(ev.includes(a), `missing "${a}" in ${ev}`);
  assert.equal((await admin("GET", `/api/devices/${ids.cam}/events`)).body[0].actor, "Administrator");
});

test("an edge box that stops checking in raises a hardware alert for staff, not owners", async () => {
  const { handle: _h } = await import("./app.mjs");
  const store = globalThis.__equicare && (await globalThis.__equicare.ready);
  store.update("devices", ids.edge, { lastSeen: new Date(Date.now() - 3600_000).toISOString() });
  const a = (await admin("GET", "/api/alerts")).body.filter((x) => x.device);
  assert.ok(a.some((x) => x.type === "Edge box offline"), JSON.stringify(a.map((x) => x.type)));
  const own = (await call("GET", "/api/alerts", { token: tokens.owner })).body;
  assert.ok(!own.some((x) => x.device), "owners are not paged about infrastructure");
});

test("the first-version camera records migrate into the registry", async () => {
  const devs = await import("./devices.mjs");
  const mem = { cameras: [{ id: "cameras-1", name: "old", stall: "A-04", host: "10.0.0.9", lastProbe: { at: "x", device: { DeviceSN: "SN-OLD", Model: "M" } } }], devices: [] };
  const fake = {
    list: (k) => mem[k] ?? [], create: (k, o) => (mem[k] ||= []).push(o) && o,
    remove: (k, id) => { mem[k] = mem[k].filter((x) => x.id !== id); return true; },
  };
  devs.deviceApi({ store: fake, json: () => null, CORS: {} }).migrate();
  assert.equal(mem.cameras.length, 0);
  assert.equal(mem.devices[0].kind, "thermal_camera");
  assert.equal(mem.devices[0].identity.serial, "SN-OLD");
});
