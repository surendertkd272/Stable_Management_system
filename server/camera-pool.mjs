// One session per camera, one operation at a time.
//
// Every API call used to open a fresh camera login. "Watch breathing" alone
// opened twenty. Camera firmware caps concurrent sessions and can lock an
// account after bursts of logins, so on calibration day the page would have
// started failing with login errors that had nothing to do with credentials.
// It also let two admins' requests interleave on the camera (a ROI push racing
// a temperature read).
//
// Here each camera gets one cached, authenticated client:
//   - reused across requests, logged out after IDLE_MS of quiet;
//   - operations on the same camera run strictly one after another;
//   - on first use, the device's serial number is checked against the one
//     recorded when it was first registered — so a DHCP reshuffle that puts a
//     DIFFERENT camera at the same IP is refused, instead of silently
//     calibrating the wrong stall.
import { createHash } from "node:crypto";
import { CameraClient, IdentityMismatch } from "./camera.mjs";

export { IdentityMismatch };

const G = (globalThis.__equicareCameraPool ??= { entries: new Map(), timer: null });
const IDLE_MS = Number(process.env.EQUICARE_CAMERA_IDLE_MS) || 60_000;

/** Anything that changes how we reach or log into the camera starts a new session. */
const keyFor = (dev, password) =>
  `${dev.id}|` + createHash("sha256")
    .update(JSON.stringify([dev.host, dev.httpPort, dev.https, dev.username, password]))
    .digest("hex").slice(0, 16);

function sweep() {
  const now = Date.now();
  for (const [k, e] of G.entries) {
    if (!e.busy && now - e.lastUsed > IDLE_MS) {
      G.entries.delete(k);
      e.client.logout().catch(() => {});
    }
  }
}

function ensureSweeper() {
  if (G.timer) return;
  G.timer = setInterval(sweep, Math.min(IDLE_MS, 15_000));
  G.timer.unref?.();
}

/**
 * Run fn(client) against the camera with an authenticated, serialized session.
 * opts.password: decrypted password. opts.expectSerial: pinned serial, if any.
 */
export async function withCamera(dev, fn, { password, expectSerial, fresh = false } = {}) {
  ensureSweeper();
  const key = keyFor(dev, password);
  // A changed configuration must not leave the old session open on the camera.
  for (const [k, e] of G.entries) {
    if (k.startsWith(`${dev.id}|`) && k !== key && !e.busy) {
      G.entries.delete(k);
      e.client.logout().catch(() => {});
    }
  }
  let e = G.entries.get(key);
  if (!e) {
    e = {
      client: new CameraClient({ host: dev.host, httpPort: dev.httpPort, https: dev.https, username: dev.username, password }),
      chain: Promise.resolve(), lastUsed: Date.now(), busy: 0, serial: null,
    };
    G.entries.set(key, e);
  }
  const run = async () => {
    e.busy++;
    e.client.expectSerial = expectSerial;     // checked again on any transparent re-login
    try {
      if (!e.client.loggedIn) {
        const login = await e.client.login();
        if (!login.ok) throw new Error(login.error);
        e.loginMethod = login.method;
        e.serial = null;
      }
      // Re-read identity after ANY new login — including the transparent
      // re-login the client does when a session is rejected, which is exactly
      // what a different camera taking over this IP would cause. Reading it
      // once per pool entry let a swapped unit pass the check.
      if (fresh || !e.serial || e.serialGen !== e.client.generation) {
        const info = await e.client.deviceInfo();
        e.serial = info.DeviceSN || null;
        e.device = info;
        e.serialGen = e.client.generation;
      }
      if (expectSerial && e.serial && e.serial !== expectSerial)
        throw new IdentityMismatch(expectSerial, e.serial, dev.host);
      return await fn(e.client, { loginMethod: e.loginMethod, device: e.device, serial: e.serial });
    } finally {
      e.busy--;
      e.lastUsed = Date.now();
    }
  };
  // Serialize per camera; a failure must not poison the queue for the next caller.
  const result = e.chain.then(run, run);
  e.chain = result.catch(() => {});
  try {
    return await result;
  } catch (err) {
    // A network-level failure means the session may be dead; start clean next time.
    if (!(err instanceof IdentityMismatch)) {
      G.entries.delete(key);
      e.client.logout().catch(() => {});
    }
    throw err;
  }
}

/** Drop a device's session (on delete or credential change). */
export function forget(devId) {
  for (const [k, e] of G.entries) {
    if (k.startsWith(`${devId}|`)) {
      G.entries.delete(k);
      e.client.logout().catch(() => {});
    }
  }
}

export const _poolSize = () => G.entries.size;
export const _sweepNow = sweep;
