// The camera session pool, against a fake camera that behaves like firmware:
// capped sessions, expiring sessions, dropped connections, changeable serial.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.EQUICARE_CAMERA_IDLE_MS = "300";
const { startFakeCamera } = await import("./testing/fake-camera.mjs");
const { withCamera, forget, IdentityMismatch, _poolSize, _sweepNow } = await import("./camera-pool.mjs");

let cam;
const dev = () => ({ id: "cam-1", host: "127.0.0.1", httpPort: cam.port, https: false, username: "admin" });
const temps = (c) => c.queryTemps();

before(async () => { cam = await startFakeCamera({ serial: "SN-A", password: "pw", maxSessions: 3 }); });
after(async () => { forget("cam-1"); await cam.close(); });

test("20 reads (a 'watch breathing' run) use ONE camera session, not 20", async () => {
  const before = cam.st.logins;
  for (let i = 0; i < 20; i++) await withCamera(dev(), temps, { password: "pw" });
  assert.equal(cam.st.logins - before, 1, "one login for the whole run");
  assert.ok(cam.st.sessions.size <= 1, `sessions open on camera: ${cam.st.sessions.size}`);
});

test("50 back-to-back operations never exhaust the camera's session cap (3)", async () => {
  for (let i = 0; i < 50; i++) await withCamera(dev(), temps, { password: "pw" });
  assert.ok(cam.st.sessions.size < cam.st.maxSessions);
});

test("concurrent requests to one camera are serialized", async () => {
  cam.st.slowMs = 30; cam.st.maxInflight = 0;
  await Promise.all(Array.from({ length: 8 }, () => withCamera(dev(), temps, { password: "pw" })));
  cam.st.slowMs = 0;
  assert.equal(cam.st.maxInflight, 1, `camera saw ${cam.st.maxInflight} requests at once`);
});

test("a session the camera expired is re-established transparently", async () => {
  await withCamera(dev(), temps, { password: "pw" });
  cam.expireSessions();
  const t = await withCamera(dev(), temps, { password: "pw" });
  assert.ok(Array.isArray(t));
});

test("a dropped connection on a read is retried once", async () => {
  await withCamera(dev(), temps, { password: "pw" });
  cam.st.dropNext = 1;
  const t = await withCamera(dev(), temps, { password: "pw" });
  assert.ok(Array.isArray(t));
});

test("idle sessions are logged out, freeing the camera's slot", async () => {
  await withCamera(dev(), temps, { password: "pw" });
  const outs = cam.st.logouts;
  await new Promise((r) => setTimeout(r, 400));
  _sweepNow();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(_poolSize(), 0);
  assert.ok(cam.st.logouts > outs, "the pool must log out, not just forget");
  assert.equal(cam.st.sessions.size, 0);
});

test("a different camera at the same address is refused, not calibrated", async () => {
  cam.st.serial = "SN-B";                     // e.g. DHCP handed the IP to another unit
  forget("cam-1");
  await assert.rejects(
    withCamera(dev(), (c) => c.setPoint(0, 1, 1, { emissivity: 0.98, distanceM: 3.5, name: "eye" }),
      { password: "pw", expectSerial: "SN-A" }),
    (e) => e instanceof IdentityMismatch && /SN-A/.test(e.message) && /SN-B/.test(e.message));
  assert.equal(cam.st.rois.has("Point:0"), false, "nothing may be written to the wrong camera");
  cam.st.serial = "SN-A";
});

test("wrong credentials fail with the camera's reason, and the queue keeps working", async () => {
  forget("cam-1");
  await assert.rejects(withCamera(dev(), temps, { password: "nope" }), /rejected|refused|401/);
  const t = await withCamera(dev(), temps, { password: "pw" });
  assert.ok(Array.isArray(t));
});

test("an oversized reply is cut off instead of exhausting server memory", async () => {
  cam.st.hugeSnapshot = true;
  const { CameraClient } = await import("./camera.mjs");
  const c = new CameraClient({ host: "127.0.0.1", httpPort: cam.port, username: "admin", password: "pw", maxBytes: 2 * 1024 * 1024 });
  await c.login();
  await assert.rejects(c.snapshot(0), /exceeded/);
  cam.st.hugeSnapshot = false;
  await c.logout();
});

test("identity is re-checked after the client transparently logs in again", async () => {
  forget("cam-1");
  await withCamera(dev(), temps, { password: "pw", expectSerial: "SN-A" });
  // The unit at this IP changes, and the old session dies with it.
  cam.st.serial = "SN-B";
  cam.expireSessions();
  await assert.rejects(withCamera(dev(), temps, { password: "pw", expectSerial: "SN-A" }),
    (e) => e instanceof IdentityMismatch, "a re-login must trigger a fresh identity check");
  cam.st.serial = "SN-A";
  forget("cam-1");
});
