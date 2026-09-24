// Sparsh SC-IT6420-HB V2 client for the server — ISAPI over HTTP(S), Modbus/TCP
// and an RTSP reachability check. A port of sparsh_camera.py's protocol code
// (same login hash, same register map), so the browser's "test connection"
// exercises exactly what the edge agent will use in the barn.
//
// Talks to the camera directly from the site server, so it only works where the
// server can reach the barn LAN — which is why the backend runs on-site.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import dns from "node:dns/promises";
import { createHash, randomBytes } from "node:crypto";

const md5 = (s) => createHash("md5").update(s).digest("hex");   // device-mandated hash
const CLIENT_REALM = "aB3xY7pQ";
const ALARM_OFF = { UpType: 0, UpLimit: 7000, DownType: 0, DownLimit: 1000 };
const ARM_24_7 = "ffffff-ffffff-ffffff-ffffff-ffffff-ffffff-ffffff-";

// --------------------------------------------------------------------------- //
// Which hosts the server may be asked to connect to.
//
// An admin types an address and the SERVER connects to it — without a limit
// that is a way to make the server probe anything it can reach. Cameras live on
// the barn LAN, so private, loopback and link-local addresses are allowed and
// public ones are refused unless EQUICARE_CAMERA_ALLOW_PUBLIC=1.
// --------------------------------------------------------------------------- //
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::1") return true;
    if (l.startsWith("::ffff:")) return isPrivateAddress(l.slice(7));
    return l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
  }
  return false;
}

export async function checkHost(host) {
  if (!host || /[\s/?#@]/.test(host)) return { ok: false, error: "enter a bare IP address or hostname" };
  let addrs;
  try {
    addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  } catch {
    return { ok: false, error: `cannot resolve ${host}` };
  }
  if (process.env.EQUICARE_CAMERA_ALLOW_PUBLIC === "1") return { ok: true, addrs };
  const pub = addrs.filter((a) => !isPrivateAddress(a));
  return pub.length
    ? { ok: false, error: `${host} resolves to a public address (${pub[0]}); cameras must be on the site network` }
    : { ok: true, addrs };
}

// --------------------------------------------------------------------------- //
// ISAPI
// --------------------------------------------------------------------------- //
export class CameraClient {
  constructor({ host, httpPort = 80, https: useHttps = false, username, password, timeoutMs = 6000 }) {
    Object.assign(this, { host, port: Number(httpPort) || 80, useHttps, username, password, timeoutMs });
    this.sessionId = null;
    this.digest = null;       // { realm, nonce, qop, opaque } when the device wants HTTP Digest
    this.nc = 0;
  }

  /** Raw request. Cameras ship self-signed certificates, so TLS is not verified
   *  here — the link is the site LAN, and the camera is addressed by IP. */
  request(method, path, { body, headers = {}, binary = false } = {}) {
    const mod = this.useHttps ? https : http;
    const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const h = { ...headers };
    if (payload !== undefined) {
      h["Content-Type"] ??= "application/json;charset=utf8";
      h["Content-Length"] = Buffer.byteLength(payload);
    }
    if (this.sessionId) h.SessionID = this.sessionId;
    if (this.digest) h.Authorization = this.digestHeader(method, path);
    return new Promise((resolve, reject) => {
      const req = mod.request({
        host: this.host, port: this.port, method, path, headers: h,
        rejectUnauthorized: false, timeout: this.timeoutMs,
      }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode, headers: res.headers, body: binary ? buf : buf.toString("utf8") });
        });
      });
      req.on("timeout", () => req.destroy(new Error(`no response within ${this.timeoutMs / 1000}s`)));
      req.on("error", reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  digestHeader(method, uri) {
    const { realm, nonce, qop, opaque } = this.digest;
    const nc = (++this.nc).toString(16).padStart(8, "0");
    const cnonce = randomBytes(8).toString("hex");
    const ha1 = md5(`${this.username}:${realm}:${this.password}`);
    const ha2 = md5(`${method}:${uri}`);
    const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
    return `Digest username="${this.username}", realm="${realm}", nonce="${nonce}", uri="${uri}", ` +
      `response="${response}"` + (qop ? `, qop=auth, nc=${nc}, cnonce="${cnonce}"` : "") +
      (opaque ? `, opaque="${opaque}"` : "");
  }

  /** Session login (the device's own scheme), falling back to HTTP Digest. */
  async login() {
    const probe = await this.request("GET", "/ISAPI/System/Capability/DeviceInfo");
    const www = String(probe.headers["www-authenticate"] || "");
    const realm = /realm="([^"]*)"/.exec(www)?.[1] || "Server Status";
    const body = {
      Realm: CLIENT_REALM,
      Name: md5(`${this.username}:${CLIENT_REALM}`),
      Password: md5(`${md5(`${this.username}:${realm}:${this.password}`)}:${CLIENT_REALM}`),
    };
    for (const method of ["PUT", "POST"]) {
      try {
        const r = await this.request(method, "/ISAPI/Security/User/Login", { body });
        if (r.status === 200) {
          const sid = JSON.parse(r.body || "{}").SessionID;
          if (sid) { this.sessionId = sid; return { ok: true, method: "session" }; }
        }
      } catch { /* try the next method */ }
    }
    if (/^Digest/i.test(www)) {
      this.digest = {
        realm, nonce: /nonce="([^"]*)"/.exec(www)?.[1],
        qop: /qop="?([^",]*)/.exec(www)?.[1], opaque: /opaque="([^"]*)"/.exec(www)?.[1],
      };
      const r = await this.request("GET", "/ISAPI/System/Capability/DeviceInfo");
      if (r.status === 200) return { ok: true, method: "digest" };
      this.digest = null;
      return { ok: false, error: `camera rejected the credentials (HTTP ${r.status})` };
    }
    if (probe.status === 200) return { ok: true, method: "none" };   // auth disabled on the device
    return { ok: false, error: `login refused (HTTP ${probe.status})` };
  }

  async getJson(path) {
    const r = await this.request("GET", path);
    if (r.status !== 200) throw new Error(`${path} -> HTTP ${r.status}`);
    return JSON.parse(r.body || "{}");
  }

  async putJson(path, body) {
    const r = await this.request("PUT", path, { body });
    let parsed;
    try { parsed = JSON.parse(r.body || "{}"); } catch { parsed = { raw: r.body.slice(0, 200) }; }
    return { http: r.status, ok: r.status === 200 && (parsed.Result ?? "OK") === "OK", body: parsed };
  }

  deviceInfo() { return this.getJson("/ISAPI/System/Capability/DeviceInfo"); }
  capabilities() { return this.getJson("/ISAPI/System/Capability/CSCI"); }
  rtspAddresses() { return this.getJson("/ISAPI/System/Capability/RtspStreamAddress"); }
  basicParam(dev = 0) { return this.getJson(`/ISAPI/Thermometry/BasicParam?Dev=${dev}`); }

  async setBasicParam({ emissivity, distanceM }, dev = 0) {
    const cur = await this.basicParam(dev);
    return this.putJson(`/ISAPI/Thermometry/BasicParam?Dev=${dev}`, {
      ...cur, FPara100: Math.round(emissivity * 100), AimDistance: Math.round(distanceM * 100),
    });
  }

  common({ emissivity, distanceM }) {
    return {
      FPara100: Math.round(emissivity * 100), AimDistance: Math.round(distanceM * 100),
      AlarmFilterTime: 2, AlarmLinkOutInfo: "", FtpPicNum: 1, EMailPicNum: 1,
      MailContentType: 1, RecTime: 5, PreRecordTime: 5, ActiveTimeSet: ARM_24_7,
    };
  }

  setPoint(idx, x, y, opts, dev = 0) {
    return this.putJson(`/ISAPI/Thermometry/Point?Dev=${dev}&Idx=${idx}`, { ThermometryList: [{
      Id: idx, PresetIdx: 0, Type: "Point", Enable: "Yes", Name: opts.name,
      Point: { RatX: x, RatY: y }, TempAlarm: { ...ALARM_OFF }, ...this.common(opts),
    }] });
  }

  setArea(idx, pts, opts, dev = 0) {
    return this.putJson(`/ISAPI/Thermometry/Area?Dev=${dev}&Idx=${idx}`, { ThermometryList: [{
      Id: idx, PresetIdx: 0, Type: "Area", Enable: "Yes", Name: opts.name,
      Area: { Total: pts.length, EndPointList: pts.map(([x, y]) => ({ RatX: x, RatY: y })) },
      MaxTempAlarm: { ...ALARM_OFF }, MinTempAlarm: { ...ALARM_OFF }, DiffTempAlarm: { ...ALARM_OFF },
      ...this.common(opts),
    }] });
  }

  /** Live ROI temperatures in °C (the device reports °C × 100). */
  async queryTemps(dev = 0) {
    const raw = await this.getJson(`/ISAPI/Thermometry/Query?Dev=${dev}&Type=255`);
    const c = (v) => (v === undefined || v === null ? null : v / 100);
    return (raw.ThermometryList || []).map((it) =>
      it.Type === "Point"
        ? { id: it.Id, type: "Point", pointC: c(it.PointTemp?.Value) }
        : { id: it.Id, type: it.Type, maxC: c(it.MaxTemp?.Value), minC: c(it.MinTemp?.Value), avgC: c(it.AvgTemp?.Value) });
  }

  /** Plain snapshot (Type=0). dev 0 = thermal, 1 = visible. */
  async snapshot(dev = 0) {
    const r = await this.request("GET", `/ISAPI/Snapshot/JPG?Dev=${dev}&Type=0`, { binary: true });
    if (r.status !== 200) throw new Error(`snapshot -> HTTP ${r.status}`);
    return { contentType: String(r.headers["content-type"] || "image/jpeg"), bytes: r.body };
  }
}

// --------------------------------------------------------------------------- //
// Modbus/TCP — function 03. Point N at 1019 + 12(N-1), documented 1-based and
// sent 0-based; each value two registers, IEEE-754 float, LOW register first.
// --------------------------------------------------------------------------- //
export function modbusReadTemps(host, port = 502, unit = 1, timeoutMs = 4000) {
  const DOC_ADDR = 1019, COUNT = 8;   // point 1 + area 1 (min, max, avg)
  const req = Buffer.alloc(12);
  req.writeUInt16BE(1, 0); req.writeUInt16BE(0, 2); req.writeUInt16BE(6, 4);
  req.writeUInt8(unit, 6); req.writeUInt8(3, 7);
  req.writeUInt16BE(DOC_ADDR - 1, 8); req.writeUInt16BE(COUNT, 10);
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port, timeout: timeoutMs });
    let buf = Buffer.alloc(0);
    sock.on("connect", () => sock.write(req));
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 9 && buf.length >= 9 + buf[8]) {
        sock.end();
        if (buf[7] !== 3) return reject(new Error(`Modbus exception (function 0x${buf[7].toString(16)})`));
        const regs = [];
        for (let i = 0; i < buf[8] / 2; i++) regs.push(buf.readUInt16BE(9 + i * 2));
        const f = (lo, hi) => { const b = Buffer.alloc(4); b.writeUInt16LE(lo, 0); b.writeUInt16LE(hi, 2); return b.readFloatLE(0); };
        resolve({ pointC: f(regs[0], regs[1]), areaMinC: f(regs[2], regs[3]), areaMaxC: f(regs[4], regs[5]), areaAvgC: f(regs[6], regs[7]) });
      }
    });
    sock.on("timeout", () => { sock.destroy(); reject(new Error(`no Modbus response within ${timeoutMs / 1000}s`)); });
    sock.on("error", reject);
  });
}

// --------------------------------------------------------------------------- //
// RTSP — an OPTIONS round trip proves the stream server answers. Decoding the
// video itself is the edge box's job (ffprobe), not the web server's.
// --------------------------------------------------------------------------- //
export function rtspOptions(host, port = 554, path = "/stream/live?dev=0&chn=0", timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port, timeout: timeoutMs });
    sock.on("connect", () => sock.write(`OPTIONS rtsp://${host}:${port}${path} RTSP/1.0\r\nCSeq: 1\r\n\r\n`));
    sock.once("data", (d) => { sock.end(); resolve(d.toString("utf8").split("\r\n")[0]); });
    sock.on("timeout", () => { sock.destroy(); reject(new Error(`no RTSP response within ${timeoutMs / 1000}s`)); });
    sock.on("error", reject);
  });
}
