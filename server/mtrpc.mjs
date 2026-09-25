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

/** A camera rectangle rule for an EquiCare box (0–10000). Unknown fields of an
 *  existing rule are kept, so settings made in the camera's web page survive. */
export function rectRule(box, { name, emissivity, distanceM }, existing = {}) {
  return {
    ...existing,
    enable: true,
    type: "kRectangle",
    name,
    // The web app stores a rectangle as its corner points.
    points: [
      { x: toCam(box.x0), y: toCam(box.y0) }, { x: toCam(box.x1), y: toCam(box.y0) },
      { x: toCam(box.x1), y: toCam(box.y1) }, { x: toCam(box.x0), y: toCam(box.y1) },
    ],
    target_radiation_coefficient: emissivity,
    target_distance: distanceM,
  };
}

/** The bounding box (0–10000) of a camera rule, or null. */
export function ruleBox(rule) {
  const pts = rule?.points;
  if (!Array.isArray(pts) || !pts.length) return null;
  const xs = pts.map((p) => fromCam(Number(p.x))), ys = pts.map((p) => fromCam(Number(p.y)));
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Put the eye and nostril rules into a rule list, by name: reuse our own
 *  slots if present, otherwise take free (disabled) slots or append. Rules
 *  anyone else set up on the camera are left alone. */
export function placeRules(rules, eyeRule, nostrilRule, max = 12) {
  const out = Array.isArray(rules) ? rules.map((r) => ({ ...r })) : [];
  for (const rule of [eyeRule, nostrilRule]) {
    let i = out.findIndex((r) => r.name === rule.name);
    if (i < 0) i = out.findIndex((r) => !r.enable && !Object.values(RULE_NAMES).includes(r.name));
    if (i < 0) {
      if (out.length >= max) throw new Error(`the camera already has ${max} measurement rules — remove one in its web page`);
      out.push(rule);
    } else {
      out[i] = { ...out[i], ...rule };
    }
  }
  return out;
}
