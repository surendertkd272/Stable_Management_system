// Pan, tilt and zoom over ONVIF — the site server's twin of edge/ptz.py, for
// the Hardware page's zoom-camera setup (move the camera, save views).
//
// WS-Security UsernameToken with a password digest, stamped with the
// camera's own clock (GetSystemDateAndTime): the 13 mm unit's clock is months
// out, and a digest stamped with ours is refused by cameras that check it.
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";

const SOAP = "http://www.w3.org/2003/05/soap-envelope";
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, Number(v)));

export function envelope(body, user = null, password = "", created = new Date()) {
  let sec = "";
  if (user !== null) {
    const nonce = randomBytes(16);
    const stamp = created.toISOString().replace(/\.\d+Z$/, "Z");
    const digest = createHash("sha1").update(Buffer.concat([nonce, Buffer.from(stamp), Buffer.from(password)])).digest("base64");
    sec = `<s:Header><Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><UsernameToken>`
      + `<Username>${xml(user)}</Username>`
      + `<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password>`
      + `<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString("base64")}</Nonce>`
      + `<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${stamp}</Created>`
      + `</UsernameToken></Security></s:Header>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="${SOAP}" xmlns:tt="http://www.onvif.org/ver10/schema" `
    + `xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" `
    + `xmlns:tds="http://www.onvif.org/ver10/device/wsdl">${sec}<s:Body>${body}</s:Body></s:Envelope>`;
}

/** Elements by local name (namespace prefixes vary between cameras). */
const tags = (raw, name) => [...raw.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`, "g"))]
  .map((m) => ({ attrs: m[1] || "", body: m[2] ?? "" }));
const attr = (attrs, k) => attrs.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1] ?? null;
const text = (raw, name) => tags(raw, name)[0]?.body?.replace(/<[^>]+>/g, "").trim() ?? null;

export class OnvifPtz {
  constructor({ host, username = "admin", password = "", port = 80, path = "/onvif/device_service", timeoutMs = 8000, post }) {
    Object.assign(this, { host, username, password, port, devicePath: path, timeoutMs });
    this.ptzPath = this.mediaPath = null;
    this.skewMs = null;
    this._post = post || ((p, body) => this._http(p, body));
  }

  _http(path, body) {
    const host = String(this.host).replace(/^\[|\]$/g, "");      // "fe80::…%en8" keeps its zone: the OS resolves it
    return new Promise((resolve, reject) => {
      const req = http.request({ host, port: this.port, path, method: "POST",
        headers: { "Content-Type": "application/soap+xml; charset=utf-8", "Content-Length": Buffer.byteLength(body) },
        timeout: this.timeoutMs }, (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; if (raw.length > 2e6) req.destroy(new Error("answer too large")); });
        res.on("end", () => resolve({ status: res.statusCode, raw }));
      });
      req.on("timeout", () => req.destroy(new Error(`no answer from ${this.host}`)));
      req.on("error", reject);
      req.end(body);
    });
  }

  async call(path, body, auth = true) {
    const created = new Date(Date.now() + (this.skewMs ?? 0));
    const { status, raw } = await this._post(path, envelope(body, auth ? this.username : null, this.password, created));
    if (/<(?:[\w-]+:)?Fault\b/.test(raw)) {
      const reason = (text(raw, "Text") || text(raw, "Reason") || "refused").slice(0, 200);
      throw new Error(`camera refused: ${reason}`);
    }
    if (status !== 200) throw new Error(`HTTP ${status} from the camera's ONVIF service`);
    return raw;
  }

  async _services() {
    if (this.ptzPath) return;
    if (this.skewMs === null) {
      try {
        const raw = await this.call(this.devicePath, "<tds:GetSystemDateAndTime/>", false);
        const u = tags(raw, "UTCDateTime")[0]?.body ?? "";
        const v = (k) => Number(text(u, k));
        const cam = Date.UTC(v("Year"), v("Month") - 1, v("Day"), v("Hour"), v("Minute"), v("Second"));
        this.skewMs = Number.isFinite(cam) ? cam - Date.now() : 0;
      } catch { this.skewMs = 0; }
    }
    const raw = await this.call(this.devicePath, "<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>");
    const addr = (name) => {
      const block = tags(raw, name)[0]?.body ?? "";
      const x = text(block, "XAddr");
      return x ? x.replace(/^https?:\/\/[^/]+/, "") || "/" : null;
    };
    this.ptzPath = addr("PTZ");
    this.mediaPath = addr("Media");
    if (!this.ptzPath) throw new Error("this camera has no ONVIF PTZ service — it cannot be moved or zoomed by EquiCare");
  }

  /** [{token, name, ptz, source}] — one per stream / lens. */
  async profiles() {
    await this._services();
    const raw = await this.call(this.mediaPath, "<trt:GetProfiles/>");
    return tags(raw, "Profiles").map((p) => ({
      token: attr(p.attrs, "token"), name: text(p.body, "Name") || "",
      ptz: /PTZConfiguration\b/.test(p.body), source: text(p.body, "SourceToken"),
    }));
  }

  async presets(profile) {
    await this._services();
    const raw = await this.call(this.ptzPath, `<tptz:GetPresets><tptz:ProfileToken>${xml(profile)}</tptz:ProfileToken></tptz:GetPresets>`);
    return tags(raw, "Preset").map((p) => ({ token: attr(p.attrs, "token"), name: text(p.body, "Name") || "" }));
  }

  async savePreset(profile, name, token = null) {
    await this._services();
    const raw = await this.call(this.ptzPath, `<tptz:SetPreset><tptz:ProfileToken>${xml(profile)}</tptz:ProfileToken>`
      + `<tptz:PresetName>${xml(name)}</tptz:PresetName>${token ? `<tptz:PresetToken>${xml(token)}</tptz:PresetToken>` : ""}</tptz:SetPreset>`);
    return text(raw, "PresetToken") || token;
  }

  async gotoPreset(profile, preset) {
    await this._services();
    await this.call(this.ptzPath, `<tptz:GotoPreset><tptz:ProfileToken>${xml(profile)}</tptz:ProfileToken><tptz:PresetToken>${xml(preset)}</tptz:PresetToken></tptz:GotoPreset>`);
  }

  async absolute(profile, { pan = null, tilt = null, zoom = null } = {}) {
    await this._services();
    const pos = (pan !== null && tilt !== null ? `<tt:PanTilt x="${clamp(pan)}" y="${clamp(tilt)}"/>` : "") + (zoom !== null ? `<tt:Zoom x="${clamp(zoom, 0, 1)}"/>` : "");
    await this.call(this.ptzPath, `<tptz:AbsoluteMove><tptz:ProfileToken>${xml(profile)}</tptz:ProfileToken><tptz:Position>${pos}</tptz:Position></tptz:AbsoluteMove>`);
  }

  /** Move at a speed for a moment, then stop — the setup screen's buttons. */
  async nudge(profile, { pan = 0, tilt = 0, zoom = 0, seconds = 0.4 } = {}) {
    await this._services();
    const vel = (pan || tilt ? `<tt:PanTilt x="${clamp(pan)}" y="${clamp(tilt)}"/>` : "") + (zoom ? `<tt:Zoom x="${clamp(zoom)}"/>` : "");
    await this.call(this.ptzPath, `<tptz:ContinuousMove><tptz:ProfileToken>${xml(profile)}</tptz:ProfileToken><tptz:Velocity>${vel}</tptz:Velocity></tptz:ContinuousMove>`);
    await new Promise((r) => setTimeout(r, Math.max(50, Math.min(3000, seconds * 1000))));
    await this.call(this.ptzPath, `<tptz:Stop><tptz:ProfileToken>${xml(profile)}</tptz:ProfileToken><tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>`);
  }

  async status(profile) {
    await this._services();
    const raw = await this.call(this.ptzPath, `<tptz:GetStatus><tptz:ProfileToken>${xml(profile)}</tptz:ProfileToken></tptz:GetStatus>`);
    const pos = tags(raw, "Position")[0]?.body ?? "";
    const pt = tags(pos, "PanTilt")[0], z = tags(pos, "Zoom")[0];
    const num = (a, k) => (a ? Number(attr(a.attrs, k)) : null);
    return { pan: num(pt, "x"), tilt: num(pt, "y"), zoom: num(z, "x"), moving: /MOVING/i.test(tags(raw, "MoveStatus")[0]?.body ?? "") };
  }
}

// --------------------------------------------------------------------------- //
// The views a zoom camera is set up with (edge/multistall.py runs them).
// --------------------------------------------------------------------------- //
const inRange = (v) => Number.isFinite(v) && v >= 0 && v <= 10000;
const STALL = /^[A-Za-z0-9 ._-]{1,24}$/;
const VIEW_ID = /^(wide|close:[A-Za-z0-9 ._-]{1,24})$/;
const TOKEN = /^[A-Za-z0-9 ._:-]{1,64}$/;

function boxOf(b, what, errs) {
  if (b === null || b === undefined) return null;
  const v = [b.x0, b.y0, b.x1, b.y1].map(Number);
  if (!v.every(inRange) || v[2] <= v[0] || v[3] <= v[1]) { errs.push(`${what} must be {x0, y0, x1, y1} in 0–10000 with x1>x0, y1>y0`); return null; }
  if (v[2] - v[0] < 50 || v[3] - v[1] < 50) { errs.push(`the ${what} box is too small`); return null; }
  return { x0: v[0], y0: v[1], x1: v[2], y1: v[3] };
}

function positionOf(p, what, errs) {
  if (!p) return null;
  const moves = [];
  for (const m of Array.isArray(p.moves) ? p.moves.slice(0, 4) : []) {
    if (!TOKEN.test(String(m.profile ?? ""))) { errs.push(`${what}: each move needs the lens's profile token`); continue; }
    if (m.preset !== undefined && m.preset !== null) {
      if (!TOKEN.test(String(m.preset))) { errs.push(`${what}: bad preset token`); continue; }
      moves.push({ profile: String(m.profile), preset: String(m.preset) });
    } else {
      const n = (v, lo, hi) => (v === undefined || v === null ? null : Math.max(lo, Math.min(hi, Number(v))));
      const mv = { profile: String(m.profile), pan: n(m.pan, -1, 1), tilt: n(m.tilt, -1, 1), zoom: n(m.zoom, 0, 1) };
      if ([mv.pan, mv.tilt, mv.zoom].some((v) => v !== null && !Number.isFinite(v))) { errs.push(`${what}: pan/tilt/zoom must be numbers`); continue; }
      moves.push(mv);
    }
  }
  const settleS = Math.max(0, Math.min(30, Number(p.settleS ?? 4)));
  return { moves, settleS: Number.isFinite(settleS) ? settleS : 4 };
}

/** Checks a zoom camera's setup; returns { out: {ptz, views, schedule}, errs }. */
export function validateViews(body, stamp = new Date().toISOString()) {
  const errs = [];
  const proto = body?.ptz?.protocol ?? "none";
  if (!["onvif", "none"].includes(proto)) errs.push('ptz.protocol must be "onvif" (a camera that zooms) or "none" (a fixed camera)');
  const port = Number(body?.ptz?.port ?? 80);
  if (!(Number.isInteger(port) && port > 0 && port < 65536)) errs.push("ptz.port must be a port number");
  const ptz = proto === "none" ? null : { protocol: proto, port, ...(body?.ptz?.path ? { path: String(body.ptz.path).slice(0, 120) } : {}) };
  const views = [];
  const ids = new Set();
  const src = Array.isArray(body?.views) ? body.views.slice(0, 13) : [];
  const wide = src.filter((v) => v?.kind === "wide");
  if (wide.length !== 1) errs.push("exactly one wide view is needed — every stall drawn on it");
  let stalls = [];
  for (const v of src) {
    const id = String(v?.id ?? "");
    if (!VIEW_ID.test(id) || ids.has(id)) { errs.push(`bad or repeated view id "${id}"`); continue; }
    ids.add(id);
    if (v.kind === "wide") {
      const zones = [];
      for (const z of Array.isArray(v.zones) ? v.zones.slice(0, 6) : []) {
        const stall = String(z?.stall ?? "").trim();
        if (!STALL.test(stall)) { errs.push("each stall on the wide view needs its stall name"); continue; }
        if (zones.some((x) => x.stall === stall)) { errs.push(`stall ${stall} is drawn twice`); continue; }
        const colour = boxOf(z.colour, `stall ${stall} (colour picture)`, errs);
        if (!colour) { if (!z.colour) errs.push(`draw stall ${stall} on the colour picture`); continue; }
        const r = z.rois || {};
        zones.push({ stall, colour, thermal: boxOf(z.thermal, `stall ${stall} (thermal picture)`, errs),
          rois: { hay: boxOf(r.hay, `stall ${stall} hay`, errs), colourFloor: boxOf(r.colourFloor, `stall ${stall} floor (colour)`, errs),
            flank: boxOf(r.flank, `stall ${stall} flank`, errs), floor: boxOf(r.floor, `stall ${stall} floor (thermal)`, errs) } });
      }
      if (!zones.length) errs.push("draw at least one stall on the wide view");
      stalls = zones.map((z) => z.stall);
      views.push({ id, kind: "wide", position: positionOf(v.position, "wide view", errs), zones, pushedAt: stamp });
    } else if (v.kind === "close") {
      const stall = String(v.stall ?? "");
      const r = v.rois || {};
      const eye = boxOf(r.eye, `close-up ${stall} eye`, errs), nostril = boxOf(r.nostril, `close-up ${stall} nostril`, errs);
      if (eye && (eye.x1 - eye.x0 > 4000 || eye.y1 - eye.y0 > 4000)) errs.push(`the close-up ${stall} eye box is too large — its hottest pixel may not be the eye`);
      if (!eye && !nostril) errs.push(`close-up ${stall}: draw the eye and/or the nostril`);
      views.push({ id, kind: "close", stall, position: positionOf(v.position, `close-up ${stall}`, errs), rois: { eye, nostril }, pushedAt: stamp });
    } else errs.push(`view "${id}": kind must be wide or close`);
  }
  for (const v of views) if (v.kind === "close" && !stalls.includes(v.stall)) errs.push(`close-up for stall ${v.stall}, which is not drawn on the wide view`);
  if (ptz) for (const v of views) if (!v.position?.moves?.length) errs.push(`${v.id === "wide" ? "the wide view" : `close-up ${v.stall}`}: save the camera's position for it`);
  if (!ptz && views.some((v) => v.kind === "close")) errs.push("close-ups need a camera that zooms (ptz.protocol onvif)");
  const every = Math.round(Number(body?.schedule?.closeEveryMin ?? 5));
  if (!(every >= 2 && every <= 120)) errs.push("schedule.closeEveryMin must be 2–120 minutes");
  return { out: { ptz, views, schedule: { closeEveryMin: every } }, errs };
}

/** The stalls a camera reports for: its own, and each stall on its wide view. */
export const stallsOf = (d) => [...new Set([d.stall, ...((d.views || []).find((v) => v.kind === "wide")?.zones || []).map((z) => z.stall)].filter(Boolean))];
