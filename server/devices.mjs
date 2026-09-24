// Device registry — every piece of hardware the stable runs, managed from the
// Hardware page as the single source of truth.
//
//   edge_box        the on-site computer (Jetson) that polls devices; holds a token
//   thermal_camera  Sparsh SC-IT6420-HB V2, polled by an edge box over ISAPI
//   modbus_sensor   any Modbus/TCP device (flow meter, load cell, feeder),
//                   described by a register map — no code per model
//   push_device     a device or gateway that sends its own readings with a token
//
// Before this, registering a camera in the portal changed nothing about what
// was measured: the edge agent was configured separately, by hand, on its
// command line. Now an edge box fetches its device list from here, so adding,
// re-aiming or removing hardware in the portal is what actually happens.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isKnownMetric, METRICS } from "./contract.mjs";
import { validateCameraModel } from "./hardware-spec.mjs";
import { seal, open } from "./secrets.mjs";
import { checkHost, rtspOptions } from "./camera.mjs";
import { withCamera, forget, IdentityMismatch } from "./camera-pool.mjs";
import { readRegisters, readSensor, TYPES, WORD_ORDERS } from "./modbus.mjs";

export const KINDS = ["edge_box", "thermal_camera", "modbus_sensor", "push_device"];
const POLLED = new Set(["thermal_camera", "modbus_sensor"]);
const TOKEN_KINDS = new Set(["edge_box", "push_device"]);
export const EYE_IDX = 0, NOSTRIL_IDX = 1;          // camera ROI slots the edge agent reads

// Freshness thresholds.
const EDGE_ONLINE_MS = 3 * 60_000;           // edge heartbeats every 30 s
const DEVICE_ONLINE_MS = 5 * 60_000;         // polled devices report at least every window
const PUSH_ONLINE_MS = 15 * 60_000;
const MAX_EVENTS = 5000;

const now = () => new Date().toISOString();
const sha = (s) => createHash("sha256").update(s).digest("hex");
const age = (iso) => (iso ? Date.now() - Date.parse(iso) : Infinity);

// --------------------------------------------------------------------------- //
// Tokens: shown once, stored only as a hash. High-entropy random values, so a
// plain SHA-256 is sufficient (unlike passwords, they cannot be guessed).
// --------------------------------------------------------------------------- //
export function newToken() {
  const token = `eqd_${randomBytes(24).toString("base64url")}`;
  return { token, tokenHash: sha(token), tokenHint: token.slice(-4) };
}

function safeEq(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// --------------------------------------------------------------------------- //
// Validation, per kind. Returns { out, errs }.
// --------------------------------------------------------------------------- //
const num = (v, d) => (v === undefined || v === "" || v === null ? d : Number(v));
const isPort = (p) => Number.isInteger(p) && p > 0 && p < 65536;
const str = (v, d = "") => String(v ?? d).trim();

export function validateDevice(kind, body, existing = {}, all = []) {
  const errs = [];
  if (!KINDS.includes(kind)) return { out: null, errs: [`unknown device kind "${kind}" (${KINDS.join(", ")})`] };
  const pick = (k, d) => (body[k] !== undefined ? body[k] : existing[k] !== undefined ? existing[k] : d);

  const out = {
    kind,
    name: str(pick("name")),
    enabled: pick("enabled", true) !== false,
    notes: str(pick("notes")),
  };
  if (!out.name) errs.push("name is required");

  if (kind !== "edge_box") out.stall = str(pick("stall"));
  if (kind === "push_device" && !out.stall) errs.push("stall is required — readings are attributed to it");

  if (POLLED.has(kind)) {
    out.edgeId = pick("edgeId", null) || null;
    if (out.edgeId && !all.some((d) => d.id === out.edgeId && d.kind === "edge_box"))
      errs.push("the chosen edge box does not exist");
    out.host = str(pick("host"));
    if (!out.host) errs.push("IP address is required");
    else if (/[\s/?#@]/.test(out.host)) errs.push("enter a bare IP address or hostname, not a URL");
  }

  if (kind === "thermal_camera") {
    Object.assign(out, {
      httpPort: num(pick("httpPort"), 80),
      https: Boolean(pick("https", false)),
      rtspPort: num(pick("rtspPort"), 554),
      modbusPort: num(pick("modbusPort"), 502),
      username: str(pick("username"), "admin"),
      variant: String(pick("variant", "640")),
      thermalLens: String(pick("thermalLens", "13")),
      visibleLens: String(pick("visibleLens", "4")),
      distanceM: num(pick("distanceM"), 3.5),
      emissivity: num(pick("emissivity"), 0.98),
    });
    errs.push(...validateCameraModel(out));
    if (!out.stall) errs.push("stall is required — the camera's readings are attributed to it");
    for (const k of ["httpPort", "rtspPort", "modbusPort"]) if (!isPort(out[k])) errs.push(`${k} must be a port number`);
  }

  if (kind === "modbus_sensor") {
    Object.assign(out, {
      port: num(pick("port"), 502),
      unitId: num(pick("unitId"), 1),
      function: num(pick("function"), 3),
      addressing: pick("addressing", "zero-based") === "one-based" ? "one-based" : "zero-based",
      pollSeconds: num(pick("pollSeconds"), 10),
    });
    if (!out.stall) errs.push("stall is required — the sensor's readings are attributed to it");
    if (!isPort(out.port)) errs.push("port must be a port number");
    if (!(Number.isInteger(out.unitId) && out.unitId >= 0 && out.unitId <= 247)) errs.push("unit id must be 0–247");
    if (![3, 4].includes(out.function)) errs.push("function must be 3 (holding registers) or 4 (input registers)");
    if (!(out.pollSeconds >= 1 && out.pollSeconds <= 3600)) errs.push("poll interval must be 1–3600 s");
    const regs = pick("registers", []);
    if (!Array.isArray(regs) || regs.length === 0) errs.push("add at least one register");
    else if (regs.length > 32) errs.push("at most 32 registers per sensor");
    out.registers = (Array.isArray(regs) ? regs : []).map((r, i) => {
      const reg = {
        name: str(r.name) || `register ${i + 1}`,
        address: num(r.address, NaN),
        type: String(r.type || "uint16"),
        wordOrder: WORD_ORDERS.includes(r.wordOrder) ? r.wordOrder : "high-first",
        scale: num(r.scale, 1),
        offset: num(r.offset, 0),
        metric: String(r.metric || ""),
        unit: str(r.unit) || METRICS[r.metric]?.unit || "",
        mode: r.mode === "counter" ? "counter" : "gauge",
      };
      const minAddr = out.addressing === "one-based" ? 1 : 0;
      if (!(Number.isInteger(reg.address) && reg.address >= minAddr && reg.address <= 65535 + minAddr))
        errs.push(`${reg.name}: address must be a whole number (${out.addressing}, ${minAddr}–${65535 + minAddr})`);
      if (!TYPES[reg.type]) errs.push(`${reg.name}: type must be one of ${Object.keys(TYPES).join(", ")}`);
      if (!isKnownMetric(reg.metric)) errs.push(`${reg.name}: pick which monitoring metric it feeds`);
      if (!Number.isFinite(reg.scale) || reg.scale === 0) errs.push(`${reg.name}: scale must be a non-zero number`);
      if (!Number.isFinite(reg.offset)) errs.push(`${reg.name}: offset must be a number`);
      return reg;
    });
  }

  if (kind === "push_device") {
    const metrics = pick("metrics", []);
    out.metrics = Array.isArray(metrics) ? [...new Set(metrics.map(String))] : [];
    if (!out.metrics.length) errs.push("choose which metrics this device may send");
    for (const m of out.metrics) if (!isKnownMetric(m)) errs.push(`unknown metric "${m}"`);
  }

  if (kind === "edge_box") out.location = str(pick("location"));

  // Two records for the same endpoint would double-poll it (and double-count
  // a water meter). Refuse.
  if (POLLED.has(kind) && out.host) {
    const port = kind === "thermal_camera" ? out.httpPort : out.port;
    const clash = all.find((d) => d.id !== existing.id && d.kind === kind && d.host === out.host &&
      (kind === "thermal_camera" ? d.httpPort : d.port) === port);
    if (clash) errs.push(`"${clash.name}" is already registered at ${out.host}:${port}`);
  }
  return { out, errs };
}

// --------------------------------------------------------------------------- //
// What leaves the server.
// --------------------------------------------------------------------------- //
/** Admin/staff view: never a password or token hash, in any form. */
export function publicDevice(d, all = []) {
  const { passwordEnc, tokenHash, ...rest } = d;
  return {
    ...rest,
    hasPassword: Boolean(passwordEnc),
    hasToken: Boolean(tokenHash),
    status: deviceStatus(d, all),
  };
}

/** Owner view: that a camera watches their horse and whether it works. */
export const ownerDevice = (d, all) => ({
  id: d.id, kind: d.kind, name: d.name, stall: d.stall,
  status: deviceStatus(d, all).state,
  calibrated: d.kind === "thermal_camera" ? Boolean(d.rois && !d.rois.stale) : null,
});

/** One honest word for how a device is doing, and why. */
export function deviceStatus(d, all = []) {
  if (d.enabled === false) return { state: "disabled", detail: "switched off in the portal" };
  if (d.kind === "edge_box") {
    if (!d.lastSeen) return { state: "never", detail: "has never connected — install the agent with its token" };
    return age(d.lastSeen) < EDGE_ONLINE_MS
      ? { state: "online", detail: `agent ${d.agent?.version ?? "?"}` }
      : { state: "offline", detail: `last heard ${d.lastSeen}` };
  }
  if (d.kind === "push_device") {
    if (!d.lastSeen) return { state: "never", detail: "has not sent anything yet" };
    return age(d.lastSeen) < PUSH_ONLINE_MS ? { state: "online", detail: "sending" } : { state: "silent", detail: `last reading ${d.lastSeen}` };
  }
  // polled
  if (!d.edgeId) return { state: "unassigned", detail: "not assigned to an edge box — nothing polls it" };
  const edge = all.find((e) => e.id === d.edgeId);
  if (!edge) return { state: "unassigned", detail: "its edge box was removed" };
  if (edge.enabled === false || !edge.lastSeen || age(edge.lastSeen) >= EDGE_ONLINE_MS)
    return { state: "edge-offline", detail: `edge box "${edge.name}" is not connected` };
  if (d.health && d.health.ok === false && age(d.health.at) < DEVICE_ONLINE_MS) {
    if (d.health.code === "NO_ROIS")
      return { state: "needs-calibration", detail: "the camera answers but has no ROIs — calibrate it to start measuring" };
    if (d.health.code === "IDENTITY_MISMATCH")
      return { state: "error", detail: d.health.error };
    return { state: "error", detail: d.health.error || "the edge box reports an error" };
  }
  if (d.lastSeen && age(d.lastSeen) < DEVICE_ONLINE_MS) return { state: "online", detail: "reporting" };
  return { state: d.lastSeen ? "stale" : "waiting", detail: d.lastSeen ? `last reading ${d.lastSeen}` : "waiting for the edge box's first reading" };
}

// --------------------------------------------------------------------------- //
// The API. `ctx` = { store, json, CORS }.
// --------------------------------------------------------------------------- //
export function deviceApi({ store, json, CORS }) {
  const list = () => store.list("devices");
  const byId = (id) => list().find((d) => d.id === id);

  function event(dev, actor, action, detail = "") {
    store.create("device_events", { deviceId: dev.id, device: dev.name, at: now(), actor, action, detail: String(detail).slice(0, 500) });
    const evs = store.list("device_events");
    if (evs.length > MAX_EVENTS) for (const e of evs.slice(0, evs.length - MAX_EVENTS)) store.remove("device_events", e.id);
  }

  /** Stored camera password, or a clear reason it is unusable. */
  function cameraPassword(dev) {
    if (!dev.passwordEnc) return { password: "" };
    const p = open(dev.passwordEnc);
    if (p === null) return {
      error: "the stored camera password cannot be decrypted — the encryption key changed " +
        "(CAMERA_SECRET_KEY or <data dir>/secret.key). Edit the camera and re-enter its password.",
    };
    return { password: p };
  }

  /** Run fn against a camera through the pool, with every guard applied. */
  async function camera(dev, fn, { acceptIdentity = false, fresh = false } = {}) {
    const host = await checkHost(dev.host);
    if (!host.ok) throw new Error(host.error);
    const cred = cameraPassword(dev);
    if (cred.error) throw new Error(cred.error);
    return withCamera(dev, fn, {
      password: cred.password,
      expectSerial: acceptIdentity ? undefined : dev.identity?.serial,
      fresh,
    });
  }

  // ---- migration from the first camera-only version ----------------------- //
  function migrate() {
    for (const c of store.list("cameras")) {
      if (!byId(c.id)) {
        const serial = c.lastProbe?.device?.DeviceSN;
        store.create("devices", {
          ...c, kind: "thermal_camera", enabled: true, edgeId: null,
          identity: serial ? { serial, model: c.lastProbe.device.Model ?? null, pinnedAt: c.lastProbe.at } : null,
        });
      }
      store.remove("cameras", c.id);
    }
  }

  // ---- token principals (edge boxes, push devices) ------------------------ //
  function deviceByToken(token) {
    if (!token || !token.startsWith("eqd_")) return null;
    const h = sha(token);
    return list().find((d) => d.tokenHash && d.enabled !== false && safeEq(d.tokenHash, h)) || null;
  }
  const anyDeviceTokens = () => list().some((d) => d.tokenHash);

  /**
   * Attribute and vet an ingest batch sent by a device token. Returns
   * { clean, rejected } — rejected readings carry a reason. Legacy callers
   * (no device token) pass through with deviceId-based stall resolution.
   */
  function attribute(batch, principal) {
    const clean = [], rejected = [];
    const seen = new Map();
    for (const r0 of batch) {
      const r = { ...r0, meta: { ...(r0.meta || {}) } };
      let dev = null;
      if (principal?.kind === "push_device") {
        dev = principal;
        if (!dev.metrics.includes(r.metric)) { rejected.push({ metric: r.metric, reason: "metric not allowed for this device" }); continue; }
      } else if (principal?.kind === "edge_box" && !r.deviceId) {
        // An edge box's token entitles it to report ITS devices — not to write
        // to any stall it names. (Seen in testing: a stray agent's stall-only
        // readings were accepted under another edge box's token.)
        rejected.push({ stallId: r.stallId ?? null, reason: "readings from an edge box must name their device (deviceId)" });
        continue;
      } else if (r.deviceId) {
        dev = byId(r.deviceId);
        if (!dev) { rejected.push({ deviceId: r.deviceId, reason: "unknown device" }); continue; }
        if (principal?.kind === "edge_box" && dev.edgeId !== principal.id) {
          rejected.push({ deviceId: r.deviceId, reason: "device is not assigned to this edge box" }); continue;
        }
        if (dev.enabled === false) { rejected.push({ deviceId: r.deviceId, reason: "device is disabled" }); continue; }
      }
      if (dev) {
        // The registry decides where a device's readings belong — not the sender.
        r.deviceId = dev.id;
        r.stallId = dev.stall || r.stallId;
        r.meta.deviceId = dev.id;
        if (!r.unit && METRICS[r.metric]) r.unit = METRICS[r.metric].unit;
        if (!r.source && dev.kind === "push_device") r.source = METRICS[r.metric]?.source ?? "push_device";
        if (dev.kind === "thermal_camera") {
          r.source = "thermal_camera";
          if (!dev.rois || dev.rois.stale) r.meta.calibrated = false;
        }
        seen.set(dev.id, r.ts || now());
      }
      clean.push(r);
    }
    const stamp = now();
    for (const id of seen.keys()) store.update("devices", id, { lastSeen: stamp });
    if (principal) store.update("devices", principal.id, { lastSeen: stamp });
    return { clean, rejected };
  }

  // ---- probes -------------------------------------------------------------- //
  async function probeCamera(dev, { acceptIdentity }) {
    const steps = [];
    const step = async (name, fn) => {
      const t0 = Date.now();
      try {
        const detail = await fn();
        steps.push({ name, ok: true, detail, ms: Date.now() - t0 });
        return true;
      } catch (e) {
        steps.push({ name, ok: false, detail: e.message, ms: Date.now() - t0, code: e.code });
        return false;
      }
    };
    let device = null;
    const reach = await step("Address allowed", async () => {
      const h = await checkHost(dev.host);
      if (!h.ok) throw new Error(h.error);
      return h.addrs.join(", ");
    });
    const authed = reach && await step("Login + identity", () => camera(dev, async (c, s) => {
      device = s.device;
      return `authenticated (${s.loginMethod}) · ${device.Model || "?"} · S/N ${s.serial || "?"}` +
        (dev.identity?.serial && !acceptIdentity ? " · matches the registered unit" : "");
    }, { acceptIdentity, fresh: true }));   // the test always asks the device who it is
    if (authed) {
      await step("Capabilities", () => camera(dev, async (c) => {
        const x = await c.capabilities();
        return [x.WithCCD === "Yes" ? "visible channel" : "NO visible channel",
          x.WithMetaRaw === "Yes" ? "per-frame temperature stream" : "no meta stream",
          x.WithBlackBody === "Yes" ? "blackbody reference" : "no blackbody (±2 °C, screening-grade)"].join(" · ");
      }));
      await step("Thermometry", () => camera(dev, async (c) => {
        const b = await c.basicParam();
        return `emissivity ${(b.FPara100 ?? 0) / 100} · distance ${(b.AimDistance ?? 0) / 100} m`;
      }));
      await step("Live temperatures", () => camera(dev, async (c) => {
        const t = await c.queryTemps();
        if (!t.length) return "no ROIs configured yet — calibrate to start measuring";
        return t.map((x) => x.type === "Point" ? `point ${x.id}: ${x.pointC?.toFixed(1)} °C` : `${x.type.toLowerCase()} ${x.id}: avg ${x.avgC?.toFixed(1)} °C`).join(" · ");
      }));
    }
    if (reach) {
      await step(`Modbus/TCP :${dev.modbusPort}`, async () => {
        const regs = await readRegisters(dev.host, dev.modbusPort, 1, 3, 1018, 2);
        const b = Buffer.alloc(4); b.writeUInt16LE(regs[0], 0); b.writeUInt16LE(regs[1], 2);
        return `point 1 = ${b.readFloatLE(0).toFixed(1)} °C (cross-check against ISAPI)`;
      });
      await step(`RTSP :${dev.rtspPort}`, () => rtspOptions(dev.host, dev.rtspPort));
    }
    const ok = Boolean(authed);
    const patch = { lastProbe: { at: now(), ok, steps, device } };
    // Pin the unit's identity the first time it answers (or when an admin
    // confirms a replacement), so a different camera at this IP is refused later.
    if (ok && device?.DeviceSN && (!dev.identity?.serial || acceptIdentity))
      patch.identity = { serial: device.DeviceSN, model: device.Model ?? null, firmware: device.FWVersion ?? null, pinnedAt: now() };
    // A replacement unit has not been aimed: whatever ROIs it carries were set
    // somewhere else (or not at all). Hold its readings back until calibrated.
    if (patch.identity && dev.identity?.serial && dev.identity.serial !== patch.identity.serial && dev.rois)
      patch.rois = { ...dev.rois, stale: true };
    return { result: patch.lastProbe, patch };
  }

  async function probeSensor(dev) {
    const h = await checkHost(dev.host);
    if (!h.ok) return { at: now(), ok: false, values: [], error: h.error };
    const values = await readSensor(dev);
    return { at: now(), ok: values.length > 0 && values.every((v) => v.ok), values };
  }

  // ---- ROI verification ---------------------------------------------------- //
  async function verifyRois(c, eye, n) {
    try {
      const pts = (await c.getJson("/ISAPI/Thermometry/Point?Dev=0&Idx=255")).ThermometryList || [];
      const areas = (await c.getJson("/ISAPI/Thermometry/Area?Dev=0&Idx=255")).ThermometryList || [];
      const p = pts.find((x) => x.Type === "Point" && x.Id === EYE_IDX);
      const a = areas.find((x) => x.Type === "Area" && x.Id === NOSTRIL_IDX);
      const pg = p?.Point || p?.PointTemp;
      const ag = a?.Area?.EndPointList;
      if (!p || !a) return { verified: false, detail: "the camera does not list the ROIs it just accepted" };
      if (!pg || !ag) return { verified: null, detail: "the camera confirms both ROIs exist but does not report their coordinates" };
      const eyeOk = pg.RatX === eye.x && pg.RatY === eye.y;
      const xs = ag.map((q) => q.RatX), ys = ag.map((q) => q.RatY);
      const boxOk = Math.min(...xs) === n.x0 && Math.max(...xs) === n.x1 && Math.min(...ys) === n.y0 && Math.max(...ys) === n.y1;
      return eyeOk && boxOk
        ? { verified: true, detail: "read back from the camera and matched" }
        : { verified: false, detail: "the camera reports different coordinates than were sent" };
    } catch (e) {
      return { verified: null, detail: `could not read the ROIs back: ${e.message}` };
    }
  }

  const inRange = (v) => Number.isInteger(v) && v >= 0 && v <= 10000;
  const actorOf = (who) => who?.name || who?.role || "system";
  const readBody = async (req) => {
    try { return { body: JSON.parse((await req.text()) || "{}") }; }
    catch { return { error: json(400, { error: "malformed JSON" }) }; }
  };

  // ---- /edge/* (edge-box token) ------------------------------------------- //
  async function handleEdge(req, url) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const edge = deviceByToken(token);
    if (!edge || edge.kind !== "edge_box") return json(401, { error: "unknown or revoked edge-box token" });

    if (url.pathname === "/edge/config" && req.method === "GET") {
      store.update("devices", edge.id, { lastSeen: now() });
      const devices = list().filter((d) => d.edgeId === edge.id && d.enabled !== false).map((d) => {
        const base = { id: d.id, kind: d.kind, name: d.name, stall: d.stall, host: d.host };
        if (d.kind === "thermal_camera") {
          const cred = cameraPassword(d);
          return {
            ...base, httpPort: d.httpPort, https: d.https, username: d.username,
            // Delivered only to the assigned edge box, over its token. Run the
            // site server behind HTTPS or on an isolated VLAN.
            password: cred.password ?? null, configError: cred.error ?? null,
            emissivity: d.emissivity, distanceM: d.distanceM,
            calibrated: Boolean(d.rois && !d.rois.stale), serial: d.identity?.serial ?? null,
          };
        }
        return {
          ...base, port: d.port, unitId: d.unitId, function: d.function,
          addressing: d.addressing, pollSeconds: d.pollSeconds, registers: d.registers,
        };
      });
      return json(200, { edge: { id: edge.id, name: edge.name }, devices, refreshSeconds: 60 });
    }

    if (url.pathname === "/edge/heartbeat" && req.method === "POST") {
      const { body, error } = await readBody(req);
      if (error) return error;
      const stamp = now();
      const agent = body.agent && typeof body.agent === "object" ? {
        version: String(body.agent.version ?? "").slice(0, 40), host: String(body.agent.host ?? "").slice(0, 80),
        uptimeS: Number(body.agent.uptimeS) || 0, reportedAt: stamp,
      } : edge.agent;
      store.update("devices", edge.id, { lastSeen: stamp, agent });
      let updated = 0;
      for (const h of Array.isArray(body.devices) ? body.devices : []) {
        const d = byId(h.id);
        if (!d || d.edgeId !== edge.id) continue;      // an edge may only report on its own devices
        store.update("devices", d.id, {
          health: h.ok === null || h.ok === undefined
            ? { at: stamp, ok: null, error: null, code: null }        // still starting: no verdict
            : {
                at: stamp, ok: Boolean(h.ok),
                error: h.ok ? null : String(h.error ?? "unknown error").slice(0, 300),
                code: h.ok ? null : (typeof h.code === "string" ? h.code.slice(0, 40) : null),
              },
        });
        updated++;
      }
      return json(200, { ok: true, updated });
    }
    return json(404, { error: "not found" });
  }

  // ---- /api/devices ------------------------------------------------------- //
  async function handleDevices(req, url, who, visibleRoster) {
    const path = url.pathname, method = req.method;
    const all = list();

    if (path === "/api/devices" && method === "GET") {
      if (who?.role === "owner") {
        const stalls = new Set(visibleRoster().map((h) => h.stall));
        return json(200, all.filter((d) => d.kind !== "edge_box" && stalls.has(d.stall)).map((d) => ownerDevice(d, all)));
      }
      return json(200, all.map((d) => publicDevice(d, all)));
    }

    if (path === "/api/devices" && method === "POST") {
      const { body, error } = await readBody(req);
      if (error) return error;
      const { out, errs } = validateDevice(body.kind, body, {}, all);
      if (errs.length) return json(400, { error: "invalid device", details: errs });
      const extra = { createdAt: now(), lastSeen: null, health: null };
      let token = null;
      if (out.kind === "thermal_camera") Object.assign(extra, { passwordEnc: seal(body.password), rois: null, lastProbe: null, identity: null });
      if (TOKEN_KINDS.has(out.kind)) { const t = newToken(); token = t.token; Object.assign(extra, { tokenHash: t.tokenHash, tokenHint: t.tokenHint }); }
      const created = store.create("devices", { ...out, ...extra });
      event(created, actorOf(who), "created", `${out.kind} "${out.name}"`);
      return json(201, { device: publicDevice(created, list()), token });
    }

    const m = path.match(/^\/api\/devices\/([^/]+)(?:\/(probe|snapshot|rois|temps|token|events))?$/);
    if (!m) return null;
    const dev = byId(decodeURIComponent(m[1]));
    if (!dev) return json(404, { error: "unknown device" });
    const action = m[2];
    const cameraOnly = () => (dev.kind === "thermal_camera" ? null : json(400, { error: "only cameras support this" }));

    if (!action && method === "PATCH") {
      const { body, error } = await readBody(req);
      if (error) return error;
      if (body.kind && body.kind !== dev.kind) return json(400, { error: "a device's kind cannot change — remove it and add a new one" });
      const { out, errs } = validateDevice(dev.kind, body, dev, all);
      if (errs.length) return json(400, { error: "invalid device", details: errs });
      const patch = { ...out, updatedAt: now() };
      const changes = Object.keys(out).filter((k) => JSON.stringify(out[k]) !== JSON.stringify(dev[k]));
      if (dev.kind === "thermal_camera") {
        if (body.password) { patch.passwordEnc = seal(body.password); changes.push("password"); }
        // Moving the camera or changing its optics invalidates the aim.
        if (["host", "stall", "variant", "thermalLens", "distanceM"].some((k) => changes.includes(k)) && dev.rois)
          patch.rois = { ...dev.rois, stale: true };
        // A new address may legitimately be a replacement unit; identity is
        // re-confirmed on the next test rather than silently carried over.
        if (changes.includes("host") || changes.includes("httpPort")) forget(dev.id);
      }
      const row = store.update("devices", dev.id, patch);
      if (changes.length) event(dev, actorOf(who), "updated", changes.join(", "));
      return json(200, publicDevice(row, list()));
    }

    if (!action && method === "DELETE") {
      const assigned = all.filter((d) => d.edgeId === dev.id);
      if (dev.kind === "edge_box" && assigned.length && url.searchParams.get("force") !== "1")
        return json(409, { error: `${assigned.length} device(s) are assigned to this edge box`, assigned: assigned.map((d) => d.name) });
      for (const d of assigned) store.update("devices", d.id, { edgeId: null });
      forget(dev.id);
      store.remove("devices", dev.id);
      event(dev, actorOf(who), "removed", assigned.length ? `unassigned ${assigned.length} device(s)` : "");
      return json(200, { ok: true });
    }

    if (action === "token" && method === "POST") {
      if (!TOKEN_KINDS.has(dev.kind)) return json(400, { error: "only edge boxes and push devices have tokens" });
      const t = newToken();
      store.update("devices", dev.id, { tokenHash: t.tokenHash, tokenHint: t.tokenHint });
      event(dev, actorOf(who), "token rotated", "the previous token stopped working immediately");
      return json(200, { token: t.token });
    }

    if (action === "events" && method === "GET")
      return json(200, store.list("device_events").filter((e) => e.deviceId === dev.id).slice(-100).reverse());

    if (action === "probe" && method === "POST") {
      if (dev.kind === "thermal_camera") {
        const acceptIdentity = url.searchParams.get("acceptIdentity") === "1";
        const { result, patch } = await probeCamera(dev, { acceptIdentity });
        store.update("devices", dev.id, patch);
        const note = patch.identity ? ` · pinned S/N ${patch.identity.serial}` : "";
        event(dev, actorOf(who), "tested", `${result.ok ? "answered" : "failed"}${note}`);
        return json(200, result);
      }
      if (dev.kind === "modbus_sensor") {
        const result = await probeSensor(dev);
        store.update("devices", dev.id, { lastProbe: result });
        event(dev, actorOf(who), "test read", result.ok ? "all registers read" : result.error || "some registers failed");
        return json(200, result);
      }
      return json(400, { error: "nothing to test directly — this device connects to the server itself" });
    }

    if (action === "snapshot" && method === "GET") {
      const bad = cameraOnly(); if (bad) return bad;
      const devNo = url.searchParams.get("dev") === "1" ? 1 : 0;
      try {
        const snap = await camera(dev, (c) => c.snapshot(devNo));
        return new Response(snap.bytes, { status: 200, headers: { "Content-Type": snap.contentType, "Cache-Control": "no-store", ...CORS } });
      } catch (e) {
        return json(e instanceof IdentityMismatch ? 409 : 502, { error: e.message, code: e.code });
      }
    }

    if (action === "temps" && method === "GET") {
      const bad = cameraOnly(); if (bad) return bad;
      try {
        const temps = await camera(dev, (c) => c.queryTemps());
        const eyeT = temps.find((x) => x.type === "Point" && x.id === EYE_IDX);
        const nosT = temps.find((x) => x.type !== "Point" && x.id === NOSTRIL_IDX);
        return json(200, {
          at: now(), eye: eyeT ? { c: eyeT.pointC } : null,
          nostril: nosT ? { avgC: nosT.avgC, minC: nosT.minC, maxC: nosT.maxC } : null, all: temps,
        });
      } catch (e) {
        return json(e instanceof IdentityMismatch ? 409 : 502, { error: e.message, code: e.code });
      }
    }

    if (action === "rois" && method === "PUT") {
      const bad = cameraOnly(); if (bad) return bad;
      const { body, error } = await readBody(req);
      if (error) return error;
      const eye = body.eye, n = body.nostril;
      if (!eye || !inRange(eye.x) || !inRange(eye.y)) return json(400, { error: "eye must be {x, y} in 0–10000" });
      if (!n || ![n.x0, n.y0, n.x1, n.y1].every(inRange) || n.x1 <= n.x0 || n.y1 <= n.y0)
        return json(400, { error: "nostril must be {x0, y0, x1, y1} in 0–10000 with x1>x0, y1>y0" });
      if (n.x1 - n.x0 < 50 || n.y1 - n.y0 < 50) return json(400, { error: "the nostril box is too small to average over" });
      const opts = { emissivity: dev.emissivity, distanceM: dev.distanceM };
      try {
        const out = await camera(dev, async (c) => {
          const basic = await c.setBasicParam(opts);
          const point = await c.setPoint(EYE_IDX, eye.x, eye.y, { ...opts, name: "equicare-eye" });
          const area = await c.setArea(NOSTRIL_IDX, [[n.x0, n.y0], [n.x1, n.y0], [n.x1, n.y1], [n.x0, n.y1]], { ...opts, name: "equicare-nostril" });
          const verify = point.ok && area.ok ? await verifyRois(c, eye, n) : null;
          return { basic, point, area, verify };
        });
        const results = { basic: out.basic.ok, eye: out.point.ok, nostril: out.area.ok };
        if (!out.point.ok || !out.area.ok) {
          event(dev, actorOf(who), "calibration failed", JSON.stringify(results));
          return json(502, { error: "the camera rejected the ROI update", results, camera: { eye: out.point.body, nostril: out.area.body } });
        }
        if (out.verify.verified === false) {
          event(dev, actorOf(who), "calibration not confirmed", out.verify.detail);
          return json(502, { error: `ROIs sent, but ${out.verify.detail}`, results, verify: out.verify });
        }
        const rois = { eye: { x: eye.x, y: eye.y }, nostril: { x0: n.x0, y0: n.y0, x1: n.x1, y1: n.y1 }, pushedAt: now(), verified: out.verify.verified };
        store.update("devices", dev.id, { rois });
        event(dev, actorOf(who), "calibrated", `eye (${eye.x}, ${eye.y}), nostril (${n.x0}, ${n.y0})–(${n.x1}, ${n.y1}); ${out.verify.detail}`);
        return json(200, { ok: true, results, rois, verify: out.verify });
      } catch (e) {
        return json(e instanceof IdentityMismatch ? 409 : 502, { error: e.message, code: e.code });
      }
    }

    return json(405, { error: "method not allowed" });
  }

  // ---- alerts for hardware that stopped working --------------------------- //
  function deviceAlerts(isAcked) {
    const all = list();
    const day = now().slice(0, 10);
    const out = [];
    for (const d of all) {
      const s = deviceStatus(d, all);
      let type = null, detail = "";
      if (d.kind === "edge_box" && s.state === "offline") { type = "Edge box offline"; detail = `"${d.name}" has not checked in — every device it polls is dark. ${s.detail}.`; }
      else if (s.state === "error") { type = "Device error"; detail = `${d.name}: ${s.detail}`; }
      else if (s.state === "stale" || (d.kind === "push_device" && s.state === "silent")) { type = "Device not reporting"; detail = `${d.name} (stall ${d.stall || "—"}): ${s.detail}.`; }
      if (!type) continue;
      const id = `device:${d.id}:${type}:${day}`;
      out.push({ id, horse: d.name, type, severity: "warn", time: "now", detail, acknowledged: isAcked(id), device: true });
    }
    return out;
  }

  return { migrate, handleEdge, handleDevices, attribute, deviceByToken, anyDeviceTokens, deviceAlerts };
}
