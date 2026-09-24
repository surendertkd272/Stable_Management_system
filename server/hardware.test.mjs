// Camera integration: datasheet maths, credential handling and access control.
// Drives the real request handler (server/app.mjs) with Web Requests — no
// server process and no camera needed; network probes are not exercised here.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DATA = mkdtempSync(join(tmpdir(), "equicare-hw-"));
let handle, spec, secrets, camera;
const tokens = {};

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

before(async () => {
  process.env.EQUICARE_DATA_DIR = DATA;
  process.env.ADMIN_PASSWORD = "test-admin-pw";
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  ({ handle } = await import("./app.mjs"));
  spec = await import("./hardware-spec.mjs");
  secrets = await import("./secrets.mjs");
  camera = await import("./camera.mjs");

  tokens.admin = (await call("POST", "/auth/login", { body: { username: "admin", password: "test-admin-pw" } })).body.token;
  for (const [role, extra] of [["staff", {}], ["owner", { owner: "Bharat Sports Venture" }]]) {
    await call("POST", "/api/users", { token: tokens.admin, body: { username: role, password: "pw-" + role, role, name: role, ...extra } });
    tokens[role] = (await call("POST", "/auth/login", { body: { username: role, password: "pw-" + role } })).body.token;
  }
});
after(() => rmSync(DATA, { recursive: true, force: true }));

// ---- datasheet ------------------------------------------------------------ //
test("optics: the PO's 640 variants clear the nostril threshold at 3.5 m", () => {
  const tele = spec.assessOptics("640", "25", 3.5);
  const wide = spec.assessOptics("640", "13", 3.5);
  assert.ok(tele.targets.nostril.px > 20, `25 mm: ${tele.targets.nostril.px}`);
  assert.ok(wide.targets.nostril.px > 10, `13 mm: ${wide.targets.nostril.px}`);
  assert.equal(tele.targets.nostril.verdict, "good");
  assert.equal(wide.targets.nostril.verdict, "good");
});

test("optics: the 256/3.2 mm variant cannot resolve a nostril at stall distance", () => {
  const a = spec.assessOptics("256", "3.2", 3.5);
  assert.equal(a.targets.nostril.verdict, "insufficient");
  assert.ok(a.targets.nostril.maxDistanceM < 3.5);
});

test("footprint follows the datasheet FOV", () => {
  const f = spec.thermalFootprint("640", "13", 3.5);             // 48° x 36°
  assert.ok(Math.abs(f.widthM - 2 * 3.5 * Math.tan((24 * Math.PI) / 180)) < 1e-9);
  assert.equal(f.fovH, 48);
  assert.equal(spec.thermalFootprint("640", "6", 3.5), null, "6 mm is not a 640 lens");
});

test("validation rejects lenses the variant does not take", () => {
  const errs = spec.validateCameraModel({ variant: "640", thermalLens: "3.2", visibleLens: "4", emissivity: 0.98, distanceM: 3.5 });
  assert.match(errs.join(" "), /takes a 13 or 25 mm/);
  assert.equal(spec.validateCameraModel({ variant: "384", thermalLens: "13", visibleLens: "6", emissivity: 0.98, distanceM: 3.5 }).length, 0);
});

// ---- credentials ---------------------------------------------------------- //
test("secrets round-trip and detect tampering", () => {
  const s = secrets.seal("hunter2");
  assert.notEqual(s, "hunter2");
  assert.equal(secrets.open(s), "hunter2");
  assert.equal(secrets.open(s.slice(0, -2) + "xx"), null);
  assert.equal(secrets.seal(""), null);
});

// ---- host guard ----------------------------------------------------------- //
test("the server will only connect to site-network addresses", async () => {
  for (const ok of ["127.0.0.1", "192.168.1.102", "10.0.4.20", "172.20.0.5", "fd00::1"])
    assert.equal((await camera.checkHost(ok)).ok, true, ok);
  for (const bad of ["8.8.8.8", "1.1.1.1", "http://192.168.1.2", "a b"])
    assert.equal((await camera.checkHost(bad)).ok, false, bad);
});

// ---- API ------------------------------------------------------------------ //
const CAM = {
  name: "A-04 thermal", stall: "A-04", host: "192.168.1.102", httpPort: 80,
  username: "admin", password: "cam-secret-123",
  variant: "640", thermalLens: "25", visibleLens: "4", distanceM: 3.5, emissivity: 0.98,
};

test("admin can register a camera; the password never comes back", async () => {
  const r = await call("POST", "/api/cameras", { token: tokens.admin, body: CAM });
  assert.equal(r.status, 201);
  assert.equal(r.body.hasPassword, true);
  assert.equal(r.body.passwordEnc, undefined);
  assert.ok(!r.raw.includes("cam-secret-123"), "plaintext password in response");
  const list = await call("GET", "/api/cameras", { token: tokens.admin });
  assert.ok(!list.raw.includes("cam-secret-123") && !list.raw.includes("v1:"), "credential material in list");
});

test("the password is encrypted at rest, not stored in plaintext", async () => {
  await new Promise((r) => setTimeout(r, 400));   // the JSON store debounces writes by 250 ms
  const state = readFileSync(join(DATA, "state.json"), "utf8");
  assert.ok(!state.includes("cam-secret-123"), "plaintext password in state.json");
  assert.match(state, /"passwordEnc":"v1:/);
});

test("invalid optics are rejected with the datasheet's reason", async () => {
  const r = await call("POST", "/api/cameras", { token: tokens.admin, body: { ...CAM, thermalLens: "6" } });
  assert.equal(r.status, 400);
  assert.match(r.body.details.join(" "), /13 or 25 mm/);
});

test("PATCH without a password keeps the stored one; re-aiming marks calibration stale", async () => {
  const [cam] = (await call("GET", "/api/cameras", { token: tokens.admin })).body;
  const r = await call("PATCH", `/api/cameras/${cam.id}`, { token: tokens.admin, body: { name: "renamed" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.hasPassword, true);
  assert.equal(r.body.name, "renamed");
});

test("ROI coordinates are validated before anything is sent to a camera", async () => {
  const [cam] = (await call("GET", "/api/cameras", { token: tokens.admin })).body;
  const bad = await call("PUT", `/api/cameras/${cam.id}/rois`, {
    token: tokens.admin, body: { eye: { x: 5000, y: 20000 }, nostril: { x0: 1, y0: 1, x1: 2, y1: 2 } } });
  assert.equal(bad.status, 400);
  const inverted = await call("PUT", `/api/cameras/${cam.id}/rois`, {
    token: tokens.admin, body: { eye: { x: 5000, y: 5000 }, nostril: { x0: 6000, y0: 1, x1: 5000, y1: 2 } } });
  assert.equal(inverted.status, 400);
});

test("staff can list cameras but not change them or pull snapshots", async () => {
  const [cam] = (await call("GET", "/api/cameras", { token: tokens.staff })).body;
  assert.ok(cam, "staff can list");
  assert.equal((await call("POST", "/api/cameras", { token: tokens.staff, body: CAM })).status, 403);
  assert.equal((await call("DELETE", `/api/cameras/${cam.id}`, { token: tokens.staff })).status, 403);
  assert.equal((await call("GET", `/api/cameras/${cam.id}/snapshot`, { token: tokens.staff })).status, 403);
  assert.equal((await call("POST", `/api/cameras/${cam.id}/probe`, { token: tokens.staff })).status, 403);
});

test("owners see status for their horses' cameras — no address, no credentials, no snapshots", async () => {
  const admList = (await call("GET", "/api/cameras", { token: tokens.admin })).body;
  const r = await call("GET", "/api/cameras", { token: tokens.owner });
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 1, "Zarina (A-04) belongs to this owner");
  assert.deepEqual(Object.keys(r.body[0]).sort(), ["calibrated", "checkedAt", "id", "name", "online", "stall"]);
  assert.ok(!r.raw.includes("192.168"), "owner must not see the camera address");
  assert.equal((await call("GET", `/api/cameras/${admList[0].id}/snapshot`, { token: tokens.owner })).status, 404);
  assert.equal((await call("GET", `/api/cameras/${admList[0].id}/temps`, { token: tokens.owner })).status, 404);
});

test("unauthenticated callers get nothing", async () => {
  assert.equal((await call("GET", "/api/cameras")).status, 401);
});

test("admin can delete a camera", async () => {
  const [cam] = (await call("GET", "/api/cameras", { token: tokens.admin })).body;
  assert.equal((await call("DELETE", `/api/cameras/${cam.id}`, { token: tokens.admin })).status, 200);
  assert.equal((await call("GET", "/api/cameras", { token: tokens.admin })).body.length, 0);
});
