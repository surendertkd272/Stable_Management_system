// A JSON-RPC (/mtrpc) camera — the firmware the Sparsh demo unit runs —
// through the device registry: detection, identity by MAC, snapshots,
// calibration and temperatures measured by pixel sampling.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATA = mkdtempSync(join(tmpdir(), "equicare-mtrpc-"));
let handle, cam;
const tokens = {}, ids = {};

async function call(method, path, { token, body } = {}) {
  const res = await handle(new Request(`http://local${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }));
  const raw = res.headers.get("content-type")?.includes("json") ? await res.text() : "";
  return { status: res.status, body: raw ? JSON.parse(raw) : null, raw, res };
}
const admin = (m, p, body) => call(m, p, { token: tokens.admin, body });

before(async () => {
  process.env.EQUICARE_DATA_DIR = DATA;
  process.env.ADMIN_PASSWORD = "test-admin-pw";
  delete process.env.DATABASE_URL;
  ({ handle } = await import("./app.mjs"));
  cam = await (await import("./testing/fake-mtrpc.mjs")).startFakeMtrpc({ password: "Cam@123" });
  tokens.admin = (await call("POST", "/auth/login", { body: { username: "admin", password: "test-admin-pw" } })).body.token;
  const edge = await admin("POST", "/api/devices", { kind: "edge_box", name: "Demo Mac" });
  ids.edge = edge.body.device.id; tokens.edge = edge.body.token;
  const r = await admin("POST", "/api/devices", {
    kind: "thermal_camera", name: "Demo thermal", stall: "A-04", host: "127.0.0.1", httpPort: cam.port, edgeId: ids.edge,
    username: "admin", password: "Cam@123", variant: "640", thermalLens: "25", visibleLens: "4", distanceM: 3.5, emissivity: 0.98,
  });
  assert.equal(r.status, 201, r.raw);
  ids.cam = r.body.device.id;
  assert.equal(r.body.device.protocol, "auto");
});
after(async () => {
  (await import("./camera-pool.mjs")).forget(ids.cam);
  await cam?.close();
  rmSync(DATA, { recursive: true, force: true });
});

const device = async () => (await admin("GET", "/api/devices")).body.find((d) => d.id === ids.cam);

test("connection test detects JSON-RPC, pins identity by MAC (the serial is all zeros)", async () => {
  const p = await admin("POST", `/api/devices/${ids.cam}/probe`);
  assert.equal(p.status, 200, p.raw);
  const step = (name) => p.body.steps.find((s) => s.name.startsWith(name));
  assert.equal(p.body.ok, true, JSON.stringify(p.body.steps));
  assert.match(step("Protocol").detail, /JSON-RPC/);
  assert.match(step("Login").detail, /TPC-B3404-ILP/);
  assert.ok(step("Thermometry").ok, "surface mode passes");
  assert.match(step("Live temperatures").detail, /no ROIs yet/);
  assert.ok(!p.body.steps.some((s) => s.name.startsWith("Modbus")), "no Modbus step for this firmware");
  const d = await device();
  assert.equal(d.protocol, "mtrpc", "what auto found is remembered");
  assert.equal(d.identity.serial, "MAC 18:74:e2:dc:d5:d0");
});

test("body-temperature mode fails the test with a clear instruction", async () => {
  cam.st.config["Thermal.thermal_global_config"].measurement_mode = "kBodyTemperature";
  const p = await admin("POST", `/api/devices/${ids.cam}/probe`);
  const t = p.body.steps.find((s) => s.name === "Thermometry");
  assert.equal(t.ok, false);
  assert.match(t.detail, /body-surface mode/);
  cam.st.config["Thermal.thermal_global_config"].measurement_mode = "kBodySurface";
});

test("snapshots: thermal is camera channel 1, visible is channel 0", async () => {
  for (const [dev, channel] of [[0, 1], [1, 0]]) {
    const r = await admin("GET", `/api/devices/${ids.cam}/snapshot?dev=${dev}`);
    assert.equal(r.status, 200);
    const bytes = new Uint8Array(await r.res.arrayBuffer());
    assert.equal(bytes[10], channel);
  }
});

test("calibration stores the ROIs and switches off the camera's own copies (no fixed boxes in its video)", async () => {
  const cfg = cam.st.config["Thermal.thermometry_rule_all"];
  cfg.thermometry_rules[1] = { ...cfg.thermometry_rules[1], enable: true, name: "equicare-eye" };   // a copy from an earlier version
  const r = await admin("PUT", `/api/devices/${ids.cam}/rois`, {
    eye: { x0: 3000, y0: 3000, x1: 3600, y1: 3600 },          // around the hot spot at cam (2700,2700) ≈ (3296,3296)
    nostril: { x0: 5000, y0: 6200, x1: 6000, y1: 7000 },
  });
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.body.verify.verified, true);
  const rules = cam.st.config["Thermal.thermometry_rule_all"].thermometry_rules;
  assert.equal(rules.find((x) => x.name === "equicare-eye").enable, false, "the camera no longer draws the eye box");
  assert.equal(rules.find((x) => x.name === "vendor-default").enable, true, "the camera's other rules are left alone");
  assert.equal(cam.st.config["Thermal.thermal_global_config"].target_radiation_coefficient, 0.95,
    "the camera's own emissivity is left as the operator set it");
});

test("temperatures: eye = hottest sampled pixel (with where), nostril = average; fast path skips the eye", async () => {
  const t = await admin("GET", `/api/devices/${ids.cam}/temps`);
  assert.equal(t.status, 200, t.raw);
  assert.equal(t.body.eye.c, 37.5);
  assert.equal(t.body.eye.mode, "box-max");
  // Inside the imitation's eye spot (radius 120 camera units ≈ 146 of 10000; every pixel in it is equally hot).
  assert.ok(Math.hypot(t.body.eye.at.x - 3296, t.body.eye.at.y - 3296) <= 150, JSON.stringify(t.body.eye.at));
  assert.ok(t.body.nostril.avgC > 30);
  const before = cam.st.pointReads;
  const fast = await admin("GET", `/api/devices/${ids.cam}/temps?parts=nostril`);
  assert.equal(fast.body.eye, null);
  assert.ok(cam.st.pointReads - before <= 25, "the breathing check reads only the nostril grid");
});

test("a box missing the eye reads coat, not a fabricated eye temperature", async () => {
  const q = new URLSearchParams({ eye: "7000,1000,7500,1500", nostril: "5000,6200,6000,7000" });
  const t = await admin("GET", `/api/devices/${ids.cam}/temps?${q}`);
  assert.equal(t.body.eye.c, 30, "background, so the calibrator's 'probably off the eye' hint can fire");
});

test("an optional floor box is stored and sent to the edge box; a tiny one is refused", async () => {
  const eye = { x0: 3000, y0: 3000, x1: 3600, y1: 3600 }, nostril = { x0: 5000, y0: 6200, x1: 6000, y1: 7000 };
  assert.equal((await admin("PUT", `/api/devices/${ids.cam}/rois`, { eye, nostril, floor: { x0: 0, y0: 0, x1: 10, y1: 10 } })).status, 400);
  const r = await admin("PUT", `/api/devices/${ids.cam}/rois`, { eye, nostril, floor: { x0: 1000, y0: 7500, x1: 9000, y1: 9800 } });
  assert.equal(r.status, 200, r.raw);
  const c = await call("GET", "/edge/config", { token: tokens.edge });
  assert.deepEqual(c.body.devices.find((x) => x.id === ids.cam).rois.floor, { x0: 1000, y0: 7500, x1: 9000, y1: 9800 });
});

test("a flank box (colour picture) is stored and sent; behaviour runs on the colour stream by default", async () => {
  const eye = { x0: 3000, y0: 3000, x1: 3600, y1: 3600 }, nostril = { x0: 5000, y0: 6200, x1: 6000, y1: 7000 };
  const floor = { x0: 1000, y0: 7500, x1: 9000, y1: 9800 }, flank = { x0: 4000, y0: 4000, x1: 6000, y1: 5500 };
  const colourFloor = { x0: 0, y0: 4000, x1: 10000, y1: 10000 };
  const r = await admin("PUT", `/api/devices/${ids.cam}/rois`, { eye, nostril, floor, flank, colourFloor });
  assert.equal(r.status, 200, r.raw);
  const d = (await call("GET", "/edge/config", { token: tokens.edge })).body.devices.find((x) => x.id === ids.cam);
  assert.deepEqual(d.rois.flank, flank);
  assert.deepEqual(d.rois.colourFloor, colourFloor, "one camera: the colour picture watches the floor");
  assert.equal(d.behaviourStream, "visible");
  assert.deepEqual(d.floorCalib, { urineHalfLifeMin: null, deltaC: null }, "no cooling test yet: the edge default applies");
  const p = await admin("PATCH", `/api/devices/${ids.cam}`, { behaviourStream: "sideways" });
  assert.equal(p.status, 400);
  assert.equal((await admin("PATCH", `/api/devices/${ids.cam}`, { behaviourStream: "thermal" })).status, 200);
  const d2 = (await call("GET", "/edge/config", { token: tokens.edge })).body.devices.find((x) => x.id === ids.cam);
  assert.equal(d2.behaviourStream, "thermal");
  await admin("PATCH", `/api/devices/${ids.cam}`, { behaviourStream: "visible" });
});

test("floor cooling test: runs against the floor box, stops on request, refuses to save half-measured", async () => {
  const r = await admin("POST", `/api/devices/${ids.cam}/cooling`, { minutes: 3 });
  assert.equal(r.status, 202, r.raw);
  const again = await admin("POST", `/api/devices/${ids.cam}/cooling`, { minutes: 3 });
  assert.equal(again.body.id, r.body.id, "one test per camera at a time");
  await new Promise((res) => setTimeout(res, 2500));
  const g = await admin("GET", `/api/devices/${ids.cam}/cooling/${r.body.id}`);
  assert.equal(g.status, 200);
  assert.ok(["baseline", "waiting"].includes(g.body.result.state), g.raw);
  const s = await admin("POST", `/api/devices/${ids.cam}/cooling/${r.body.id}/stop`);
  assert.equal(s.body.state, "done");
  const save = await admin("POST", `/api/devices/${ids.cam}/cooling/${r.body.id}/save`, { as: "urine" });
  assert.equal(save.status, 409, "nothing cooled: nothing to save");
  assert.equal((await admin("POST", `/api/devices/${ids.cam}/cooling/${r.body.id}/save`, { as: "water" })).status, 400);
  assert.equal((await admin("GET", `/api/devices/${ids.cam}/cooling/nope`)).status, 404);
});

test("the edge box receives the protocol and the ROIs to sample", async () => {
  const c = await call("GET", "/edge/config", { token: tokens.edge });
  const d = c.body.devices.find((x) => x.id === ids.cam);
  assert.equal(d.protocol, "mtrpc");
  assert.deepEqual(d.rois.eye, { x0: 3000, y0: 3000, x1: 3600, y1: 3600 });
  assert.equal(d.calibrated, true);
});

test("breathing check: starts a video job, which reports failure clearly when there is no video", async () => {
  const r = await admin("POST", `/api/devices/${ids.cam}/breathing`, { nostril: { x0: 5000, y0: 6200, x1: 6000, y1: 7000 }, seconds: 20 });
  assert.equal(r.status, 202, r.raw);
  assert.ok(r.body.id);
  let v;
  for (let i = 0; i < 100; i++) {
    v = (await admin("GET", `/api/devices/${ids.cam}/breathing/${r.body.id}`)).body;
    if (v.state !== "running") break;
    await new Promise((res) => setTimeout(res, 200));
  }
  assert.equal(v.state, "failed", "the imitation camera has no RTSP stream");
  assert.ok(v.error && v.error.length > 5, v.error);
  assert.equal((await admin("POST", `/api/devices/${ids.cam}/breathing`, { nostril: { x0: 1, y0: 1, x1: 0, y1: 0 } })).status, 400);
});

test("a different unit at the address (different MAC) is refused", async () => {
  cam.st.config["NetWork.net_interface_list"].iface[0].mac = "aa:bb:cc:dd:ee:ff";
  (await import("./camera-pool.mjs")).forget(ids.cam);
  const t = await admin("GET", `/api/devices/${ids.cam}/temps`);
  assert.equal(t.status, 409);
  assert.match(t.body.error, /18:74:e2:dc:d5:d0.*aa:bb:cc:dd:ee:ff/);
  cam.st.config["NetWork.net_interface_list"].iface[0].mac = "18:74:E2:DC:D5:D0";
});
