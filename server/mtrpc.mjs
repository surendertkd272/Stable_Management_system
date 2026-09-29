// Driver for the protocol the Sparsh SC-IT6420-HB V2 demo unit actually
// speaks: JSON-RPC 2.0 at POST /mtrpc (the vendor's "IR api" document describes
// ISAPI, which this firmware answers with 404). Worked out from the camera's
// own web app, 25 Sep 2026:
//
//   request   { id, jsonrpc: "2.0", method, params: { session_id, data | name } }
//   login     Auth.LoginChallenge -> digest {realm, nonce, qop} + session_id
//             Auth.Login with an HTTP-Digest-style response over "POST:/mtrpc"
//   keepalive Auth.Heartbeat
//   config    Config.GetConfig / Config.SetConfig by name, e.g.
//             "Thermal.thermometry_rule_all" (the measurement ROIs, max 12)
//             "Thermal.thermal_global_config" (emissivity, distance, …)
//   errors    { error: { code, message } }; -100101 = invalid session
//
// Coordinates on the camera run 0–8192; EquiCare uses 0–10000 everywhere
// else. Conversion happens here and nowhere else.
//
// VERIFIED against the real unit without a password: the login challenge.
// NOT YET VERIFIED (needs the password): the login response, the shape of
// Config replies, and temperature readings — see TODO(verify) below.
import http from "node:http";
import https from "node:https";
import { createHash, randomBytes } from "node:crypto";

const md5 = (s) => createHash("md5").update(s).digest("hex");
export const CAM_SCALE = 8192;
export const INVALID_SESSION = -100101;

/** 0–10000 (EquiCare) -> 0–8192 (camera), and back. */
export const toCam = (v) => Math.round((v * CAM_SCALE) / 10000);
export const fromCam = (v) => Math.round((v * 10000) / CAM_SCALE);

export class RpcError extends Error {
  constructor(method, err) {
    super(`${method}: ${err?.message?.trim() || "error"} (code ${err?.code})`);
    this.code = err?.code;
    this.method = method;
  }
}

/** The Digest response the camera's web app computes (MD5, qop=auth). */
export function loginResponse({ username, password, realm, nonce, qop, cnonce, nc = "00000001", uri = "/mtrpc" }) {
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`POST:${uri}`);
  return md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
}

export class MtrpcClient {
  constructor({ host, httpPort = 80, https: useHttps = false, username = "admin", password = "", timeoutMs = 6000 }) {
    Object.assign(this, { host, port: httpPort, useHttps, username, password, timeoutMs });
    this.sessionId = "";
    this.loggedIn = false;
    this.generation = 0;
    this.nextId = 1;
    this.heartbeatS = null;
  }

  /** One JSON-RPC call. `params` is merged next to session_id. */
  post(method, params = {}) {
    const body = JSON.stringify({ id: this.nextId++, jsonrpc: "2.0", method, params: { session_id: this.sessionId, ...params } });
    const mod = this.useHttps ? https : http;
    return new Promise((resolve, reject) => {
      const req = mod.request({
        host: this.host, port: this.port, method: "POST", path: "/mtrpc",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        rejectUnauthorized: false, timeout: this.timeoutMs,
      }, (res) => {
        let d = "";
        res.on("data", (c) => {
          d += c;
          if (d.length > 4 * 1024 * 1024) req.destroy(new Error("reply larger than 4 MB — not a camera reply"));
        });
        res.on("end", () => {
          if (res.statusCode !== 200) return reject(new Error(`${method} -> HTTP ${res.statusCode}`));
          try { resolve(JSON.parse(d)); } catch { reject(new Error(`${method}: reply is not JSON`)); }
        });
      });
      req.on("timeout", () => req.destroy(new Error(`no answer from ${this.host} within ${this.timeoutMs / 1000} s`)));
      req.on("error", reject);
      req.end(body);
    });
  }

  /** Call, throwing RpcError on a JSON-RPC error; returns `result`. */
  async rpc(method, params) {
    const r = await this.post(method, params);
    if (r.error) throw new RpcError(method, r.error);
    return r.result;
  }

  async login() {
    this.sessionId = "";
    let ch;
    try {
      ch = await this.rpc("Auth.LoginChallenge", { data: { encrypt_type: "kEncryptDigest", login_type: "kLoginWeb", username: this.username } });
    } catch (e) {
      return { ok: false, error: e.message };
    }
    const d = ch?.data?.digest;
    if (!d?.nonce || !d?.realm) return { ok: false, error: "the camera's login challenge is not in the expected form" };
    this.sessionId = ch.session_id || "";
    const cnonce = randomBytes(8).toString("hex");
    const digest = {
      realm: d.realm, uri: "/mtrpc", nonce: d.nonce, nc: "00000001", cnonce, qop: d.qop,
      response: loginResponse({ username: this.username, password: this.password, realm: d.realm, nonce: d.nonce, qop: d.qop, cnonce }),
    };
    try {
      const r = await this.rpc("Auth.Login", { data: { digest, encrypt_type: "kEncryptDigest", login_type: "kLoginWeb", username: this.username } });
      // TODO(verify): field names of the success reply on the real unit.
      const sid = r?.data?.session_id || r?.session_id;
      if (!sid) return { ok: false, error: "login accepted but no session returned" };
      this.sessionId = sid;
      this.heartbeatS = r?.data?.heartbeat_interval ?? null;
      this.loggedIn = true;
      this.generation++;
      return { ok: true, method: "mtrpc digest" };
    } catch (e) {
      this.sessionId = "";
      return { ok: false, error: e.message, code: e.code };
    }
  }

  /** A call that survives the camera expiring the session: log in once and
   *  retry. Safe for writes too — a call refused for an invalid session was
   *  never applied. */
  async call(method, params) {
    try {
      return await this.rpc(method, params);
    } catch (e) {
      if (e.code !== INVALID_SESSION || !this.loggedIn) throw e;
      const again = await this.login();
      if (!again.ok) throw new Error(`session expired and re-login failed: ${again.error}`);
      return this.rpc(method, params);
    }
  }

  heartbeat() { return this.call("Auth.Heartbeat", {}); }

  async logout() {
    if (!this.loggedIn) return;
    try { await this.rpc("Auth.Logout", {}); } catch { /* best effort */ }
    this.loggedIn = false;
    this.sessionId = "";
  }

  // TODO(verify): whether replies wrap the config in `data`, keyed by name.
  async getConfig(name) {
    const r = await this.call("Config.GetConfig", { name });
    return r?.data ?? r;
  }

  setConfig(name, data) {
    return this.call("Config.SetConfig", { name, data });
  }
}

// --------------------------------------------------------------------------- //
// Measurement rules <-> EquiCare ROIs
// --------------------------------------------------------------------------- //
export const RULE_NAMES = { eye: "equicare-eye", nostril: "equicare-nostril" };

/** A camera rectangle rule for an EquiCare box (0–10000), in exactly the
 *  shape the camera's own web app creates. The firmware does not validate
 *  gracefully: a rule missing `local_setting` or `alarm_output` made it drop the
 *  connection and restart its web service (seen on the demo unit, 26 Sep 2026).
 *
 *  `report`: which value the rule reports — the eye uses the maximum (the
 *  inner corner of the eye is the warmest spot), the nostril the average.
 *  `local`: per-rule emissivity/distance; omitted, the rule uses the camera's
 *  global thermal settings. Unknown fields of an existing rule are kept. */
export function rectRule(box, { name, report = "kAverageTemperature", local = null }, existing = {}) {
  return {
    ...existing,
    type: "kRectangle",
    enable: true,
    name,
    points: [
      { x: toCam(box.x0), y: toCam(box.y0) }, { x: toCam(box.x1), y: toCam(box.y0) },
      { x: toCam(box.x1), y: toCam(box.y1) }, { x: toCam(box.x0), y: toCam(box.y1) },
    ],
    local_setting: local
      ? { enable: true, target_radiation_coefficient: local.emissivity, target_distance: local.distanceM, target_reflection_temperature: local.reflectedC ?? 25 }
      : { ...(existing.local_setting || { target_radiation_coefficient: 0.95, target_distance: 2, target_reflection_temperature: 25 }), enable: false },
    // The camera's own alarm (buzzer / relay) stays off: EquiCare raises alerts.
    alarm_output: {
      ...(existing.alarm_output || { alarm_condition: "kAbove", alarm_threshold_temperature: 40, temperature_error: 0.1, temperature_duration: 30 }),
      enable: false,
      output_result: report,
    },
  };
}

export const eyeRule = (box, opts = {}) => rectRule(box, { name: RULE_NAMES.eye, report: "kHighestTemperature", ...opts });
export const nostrilRule = (box, opts = {}) => rectRule(box, { name: RULE_NAMES.nostril, report: "kAverageTemperature", ...opts });

/** The bounding box (0–10000) of a camera rule, or null. */
export function ruleBox(rule) {
  const pts = rule?.points;
  if (!Array.isArray(pts) || !pts.length) return null;
  const xs = pts.map((p) => fromCam(Number(p.x))), ys = pts.map((p) => fromCam(Number(p.y)));
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Put the eye and nostril rules into a rule list, by name: reuse our own
 *  slots if present, otherwise take free (disabled) slots or append. Rules
 *  anyone else set up on the camera are left alone.
 *
 *  Every rule carries a `rule_id` — the camera's slot number, 0–11, the first
 *  free one when a rule is added (as its web page does). A rule without it is
 *  the likeliest reason the firmware rebooted on our first writes. */
export function placeRules(rules, eyeR, nostrilR, max = 12) {
  const out = Array.isArray(rules) ? rules.map((r) => ({ ...r })) : [];
  const usedIds = () => new Set(out.map((r) => r.rule_id).filter((v) => Number.isInteger(v)));
  for (const rule of [eyeR, nostrilR]) {
    let i = out.findIndex((r) => r.name === rule.name);
    if (i < 0) i = out.findIndex((r) => !r.enable && !Object.values(RULE_NAMES).includes(r.name));
    if (i >= 0) {
      const id = Number.isInteger(out[i].rule_id) ? out[i].rule_id : null;
      out[i] = { ...out[i], ...rule };
      out[i].rule_id = id ?? freeId(usedIds(), max);
    } else {
      if (out.length >= max) throw new Error(`the camera already has ${max} measurement rules — remove one in its web page`);
      out.push({ ...rule, rule_id: freeId(usedIds(), max) });
    }
  }
  return out;
}

function freeId(used, max) {
  for (let id = 0; id < max; id++) if (!used.has(id)) return id;
  throw new Error(`no free measurement-rule slot (the camera allows ${max})`);
}

// --------------------------------------------------------------------------- //
// Temperatures by sampling pixels.
//
// This firmware's per-rule temperature feed (WebSocket "RuleTemperature") sent
// nothing to us, but single-pixel reads (Control.GetPointTemperature) answer
// in ~3 ms. So an ROI is measured by reading a grid of pixels inside it: the
// eye as the hottest pixel (and where it is), the nostril as the average. The
// ROIs live in EquiCare; the camera is used as a radiometric pixel reader.
//
// Out-of-frame reads come back as sentinels, not errors: exactly 8192 reads
// "0.00" and beyond reads "-1.00" (seen on the unit). Coordinates are clamped
// to 0–8191 and such values are discarded, never averaged in.
// --------------------------------------------------------------------------- //
export const CAM_MAX = CAM_SCALE - 1;
const clampCam = (v) => Math.max(0, Math.min(CAM_MAX, Math.round(v)));
const THERMAL_PX = 640;                        // sensor width; one grid step per pixel at most

/** Grid of camera coordinates covering an EquiCare box, at most n×n. */
export function gridPoints(box, n) {
  const x0 = clampCam(toCam(box.x0)), x1 = clampCam(toCam(box.x1));
  const y0 = clampCam(toCam(box.y0)), y1 = clampCam(toCam(box.y1));
  const pxStep = CAM_SCALE / THERMAL_PX;       // ~12.8 camera units per sensor pixel
  const cols = Math.max(2, Math.min(n, Math.floor((x1 - x0) / pxStep) + 1));
  const rows = Math.max(2, Math.min(n, Math.floor((y1 - y0) / pxStep) + 1));
  const pts = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++)
      pts.push({ x: Math.round(x0 + ((x1 - x0) * i) / (cols - 1)), y: Math.round(y0 + ((y1 - y0) * j) / (rows - 1)) });
  return pts;
}

/** A pixel reading, or null for the camera's out-of-range sentinels. */
export function pixelValue(reply) {
  const v = Number(reply?.data?.temperature);
  return Number.isFinite(v) && v > -1 && v !== 0 ? v : null;
}

export class MtrpcCamera extends MtrpcClient {
  /** Read many pixels, a few at a time (the camera handles small bursts). */
  async readPixels(points, parallel = 4) {
    const out = new Array(points.length);
    for (let i = 0; i < points.length; i += parallel) {
      const chunk = points.slice(i, i + parallel);
      const vals = await Promise.all(chunk.map((p) => this.call("Control.GetPointTemperature", { data: p })));
      vals.forEach((v, k) => (out[i + k] = pixelValue(v)));
    }
    return out;
  }

  /** Hottest pixel in a box: { c, at: {x, y} in 0–10000 } or null. */
  async boxMax(box, n = 16) {
    const pts = gridPoints(box, n);
    const vals = await this.readPixels(pts);
    let best = -1;
    vals.forEach((v, i) => { if (v !== null && (best < 0 || v > vals[best])) best = i; });
    return best < 0 ? null : { c: vals[best], at: { x: fromCam(pts[best].x), y: fromCam(pts[best].y) } };
  }

  /** Average (and min/max) over a box: { avgC, minC, maxC, n } or null. */
  async boxStats(box, n = 5) {
    const vals = (await this.readPixels(gridPoints(box, n))).filter((v) => v !== null);
    if (!vals.length) return null;
    return { avgC: vals.reduce((a, b) => a + b, 0) / vals.length, minC: Math.min(...vals), maxC: Math.max(...vals), n: vals.length };
  }

  // ---- the CameraClient surface the registry uses ---------------------- //
  async systemInfo() {
    if (!this._info) this._info = (await this.call("Control.GetSystemInfo", {}))?.data || {};
    return this._info;
  }

  /** The unit's MAC — this firmware reports serial_number "0000000000", so a
   *  serial cannot tell two cameras apart. */
  async mac() {
    const net = await this.getConfig("NetWork.net_interface_list");
    return (net?.iface || []).find((i) => i.mac)?.mac?.toLowerCase() || null;
  }

  async deviceInfo() {
    const i = await this.systemInfo();
    const serial = /^0*$/.test(String(i.serial_number || "")) ? null : i.serial_number;
    const mac = await this.mac();
    return {
      Model: i.hardware_version || "?", DeviceName: i.hardware_version, FWVersion: i.software_version,
      ThermalLens: i.thermal_lens, MAC: mac,
      // What identity pinning compares. MAC when the serial is blank.
      DeviceSN: serial || (mac ? `MAC ${mac}` : null),
    };
  }

  async verifyIdentity() {
    if (!this.expectSerial) return;
    const got = (await this.deviceInfo()).DeviceSN;
    if (got && got !== this.expectSerial) {
      const { IdentityMismatch } = await import("./camera.mjs");
      throw new IdentityMismatch(this.expectSerial, got, this.host);
    }
  }

  async capabilities() {
    const src = (await this.systemInfo()).video_source || [];
    return { WithCCD: src.includes("CHN_SOURCE_CAMARE") ? "Yes" : "No", WithMetaRaw: "No", WithBlackBody: "No" };
  }

  async basicParam() {
    const g = await this.getConfig("Thermal.thermal_global_config");
    return {
      FPara100: Math.round((g.target_radiation_coefficient ?? 0) * 100), AimDistance: Math.round((g.target_distance ?? 0) * 100),
      mode: g.measurement_mode,
    };
  }

  /** Snapshot: EquiCare's dev 0 = thermal = camera channel 1; dev 1 = visible = channel 0. */
  snapshot(dev = 0) {
    const channel = dev === 0 ? 1 : 0;
    const mod = this.useHttps ? https : http;
    return new Promise((resolve, reject) => {
      const req = mod.get({
        host: this.host, port: this.port, rejectUnauthorized: false, timeout: this.timeoutMs,
        path: `/download_file?snapshot&session_id=${encodeURIComponent(this.sessionId)}&channel=${channel}&stream=2`,
      }, (res) => {
        const chunks = []; let size = 0;
        res.on("data", (c) => { size += c.length; if (size > 8 * 1024 * 1024) req.destroy(new Error("snapshot larger than 8 MB")); else chunks.push(c); });
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode !== 200 || buf[0] !== 0xff || buf[1] !== 0xd8) return reject(new Error(`snapshot -> HTTP ${res.statusCode}, not a JPEG`));
          resolve({ contentType: "image/jpeg", bytes: buf });
        });
      });
      req.on("timeout", () => req.destroy(new Error("snapshot timed out")));
      req.on("error", reject);
    });
  }

  /** Switch off the camera's own copies of EquiCare's boxes (earlier versions
   *  mirrored them as its measurement rules). The camera draws enabled rules
   *  into its video, which put fixed boxes over the horse in the live view,
   *  in every recording and in the video the breathing is read from, while
   *  EquiCare measures the boxes itself and follows the horse. Other rules
   *  are left alone. Reads back to confirm. */
  async hideRules() {
    const cur = await this.getConfig("Thermal.thermometry_rule_all");
    const ours = (r) => r?.name === RULE_NAMES.eye || r?.name === RULE_NAMES.nostril;
    const rules = (cur?.thermometry_rules || []).map((r) => (ours(r) && r.enable ? { ...r, enable: false } : r));
    if (rules.some((r, i) => r !== cur.thermometry_rules[i]))
      await this.setConfig("Thermal.thermometry_rule_all", { ...cur, thermometry_rules: rules });
    const back = (await this.getConfig("Thermal.thermometry_rule_all"))?.thermometry_rules || [];
    return back.some((r) => ours(r) && r.enable)
      ? { verified: false, detail: "stored in EquiCare; the camera still draws its own copy of the boxes" }
      : { verified: true, detail: "stored in EquiCare, which measures the boxes itself; the camera does not draw them on its video" };
  }

  /** Mirror the ROIs as the camera's own measurement rules, so its web page
   *  and overlays show the same boxes. Reads them back to confirm. Not used
   *  by calibration any more (see hideRules). */
  async writeRules(eye, nostril) {
    const cur = await this.getConfig("Thermal.thermometry_rule_all");
    const rules = placeRules(cur?.thermometry_rules, eyeRule(eye), nostrilRule(nostril));
    await this.setConfig("Thermal.thermometry_rule_all", { ...cur, thermometry_rules: rules });
    const back = (await this.getConfig("Thermal.thermometry_rule_all"))?.thermometry_rules || [];
    const same = (r, b) => { const g = ruleBox(r); return g && ["x0", "y0", "x1", "y1"].every((k) => Math.abs(g[k] - b[k]) <= 2); };
    const e = back.find((r) => r.name === RULE_NAMES.eye), n = back.find((r) => r.name === RULE_NAMES.nostril);
    return e && n && same(e, eye) && same(n, nostril)
      ? { verified: true, detail: "read back from the camera and matched" }
      : { verified: false, detail: "the camera reports different rules than were sent" };
  }
}

/** Is there a JSON-RPC (/mtrpc) camera at this address? Asks for a login
 *  challenge only — no credentials, no login attempt counted. */
export async function detectMtrpc({ host, httpPort = 80, https: useHttps = false }) {
  const c = new MtrpcClient({ host, httpPort, https: useHttps, timeoutMs: 4000 });
  try {
    const r = await c.rpc("Auth.LoginChallenge", { data: { encrypt_type: "kEncryptDigest", login_type: "kLoginWeb", username: "admin" } });
    return Boolean(r?.data?.digest?.nonce);
  } catch {
    return false;
  }
}
