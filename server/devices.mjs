// Device registry — every piece of hardware the stable runs, managed from the
// Hardware page as the single source of truth.
//
//   edge_box        the on-site computer (Jetson) that polls devices; holds a token
//   thermal_camera  Sparsh SC-IT6420-HB V2, polled by an edge box over ISAPI
//   ip_camera       a camera the stable already owns (any IP / CCTV camera or
//                   NVR channel with RTSP): the colour measures, no temperatures
//   modbus_sensor   any Modbus/TCP or Modbus RTU (RS-485) device (flow meter,
//                   load cell, feeder), described by a register map — no code
//                   per model
//   push_device     a device or gateway that sends its own readings with a token
//   wearable_hub    the halter hub with a SIM (+ its leg tag and pelvis sensor):
//                   sends with its own token, bound to ONE horse
//
// Before this, registering a camera in the portal changed nothing about what
// was measured: the edge agent was configured separately, by hand, on its
// command line. Now an edge box fetches its device list from here, so adding,
// re-aiming or removing hardware in the portal is what actually happens.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isKnownMetric, METRICS, WEARABLE_SENSORS, FEEDER_FAULTS } from "./contract.mjs";
import { validateCameraModel } from "./hardware-spec.mjs";
import { seal, open } from "./secrets.mjs";
import { checkHost, rtspOptions } from "./camera.mjs";
import { withCamera, forget, protocolOf, IdentityMismatch } from "./camera-pool.mjs";
import { readRegisters, readSensor, TYPES, WORD_ORDERS } from "./modbus.mjs";
import { startBreathingCheck, breathingJob, jobView } from "./thermal-video.mjs";
import { liveResponse } from "./live-video.mjs";
import { startCoolingTest, coolingJob, coolingView, splitFromCalib } from "./cooling.mjs";
import { OnvifPtz, validateViews, stallsOf } from "./onvif-ptz.mjs";
import { setupChecklist } from "./setup-check.mjs";
import { MAKES, pathsFor, parseRtspUrl, probeIpCamera, snapshotIpCamera, onvifStreams, chooseStreams } from "./ip-camera.mjs";

export const KINDS = ["edge_box", "thermal_camera", "ip_camera", "modbus_sensor", "push_device", "wearable_hub"];
const POLLED = new Set(["thermal_camera", "ip_camera", "modbus_sensor"]);
export const CAMERA_KINDS = new Set(["thermal_camera", "ip_camera"]);
const TOKEN_KINDS = new Set(["edge_box", "push_device", "wearable_hub"]);

// What a wearable hub may send: everything the wearable measures, and the
// hub's own status. Fixed — unlike a push device, there is nothing to choose.
export const WEARABLE_METRICS = new Set([
  ...Object.keys(METRICS).filter((m) => METRICS[m].source === "imu"),
  "device_status", "device_detached", "gps_fix", "exercise_session", "lameness_result",
  "steps", "activity_index", "rest_minutes", "gait_asymmetry",
]);
// About the hardware, not the horse: never tagged as a prototype measure.
const WEARABLE_DEVICE_METRICS = new Set(["device_status", "device_detached", "gps_fix"]);
const HARDWARE_ID = /^[A-Za-z0-9._:-]{1,64}$/;

// What the edge box makes of a Modbus register (edge/intake.py). Without a
// `use` a register is today's plain gauge / counter. With one, the use fixes
// how it is read (a flow meter is a running total, a load cell an
// instantaneous weight) and which metrics come out of it.
export const REGISTER_USES = {
  flow:      { mode: "counter", metrics: ["water_ml", "water_visit"] },                    // water meter → drinking bouts
  bucket:    { mode: "gauge",   metrics: ["water_ml", "water_visit", "water_refill"] },    // water bucket load cell
  feed_bowl: { mode: "gauge",   metrics: ["feed_intake_g", "feed_offered_g", "feed_refusal_g"] }, // weigh-back feeder bowl
  hay:       { mode: "gauge",   metrics: ["hay_intake_g"] },                               // hay net / rack load cell
  fault:     { mode: "gauge",   metrics: ["feeder_fault"] },                               // feeder fault-code register
};
const SERIAL_PORT = /^(\/dev\/[A-Za-z0-9._+\/-]{1,120}|COM[0-9]{1,3})$/;
// Camera ROI slots the edge agent reads. The eye is a small BOX (Area 0) read
// as its maximum: the inner corner of the eye is the warmest spot on the head,
// and the camera reports the hottest pixel inside the box and where it is — so
// the aim no longer has to be pixel-exact. Cameras calibrated before this used
// a single point (Point 0); readers still fall back to it.
export const EYE_AREA_IDX = 0, NOSTRIL_IDX = 1, LEGACY_EYE_POINT_IDX = 0;
const EYE_BOX_MAX = 4000;       // wider than this and the "max" may be a heat lamp, not the eye
// Readings whose meaning depends on the ROIs being on the eye and nostril.
const AIMED_METRICS = new Set(["body_temp_c", "nostril_temp_c", "respiratory_rate_bpm"]);
const VIDEO_SOURCES = new Set(["thermal_video", "visible_video"]);

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
// The same address with only its IPv6 zone changed ("fe80::…%en8" -> "%en9")
// is the same camera reached through another adapter port, not a camera moved.
export const sameAddress = (a, b) => String(a ?? "").replace(/%.*$/, "").toLowerCase() === String(b ?? "").replace(/%.*$/, "").toLowerCase();
const str = (v, d = "") => String(v ?? d).trim();

export function validateDevice(kind, body, existing = {}, all = [], { horses = [] } = {}) {
  const errs = [];
  if (!KINDS.includes(kind)) return { out: null, errs: [`unknown device kind "${kind}" (${KINDS.join(", ")})`] };
  // A pasted RTSP address carries the camera's address, port and stream path.
  if (kind === "ip_camera" && body.rtspUrl) {
    const u = parseRtspUrl(body.rtspUrl);
    if (u.error) errs.push(u.error);
    else body = { ...body, host: u.host, rtspPort: u.port, rtspPath: u.path, ...(body.username || !u.username ? {} : { username: u.username }) };
    if (body.rtspUrlMain) {
      const m = parseRtspUrl(body.rtspUrlMain);
      if (m.error) errs.push(`full-detail stream: ${m.error}`); else body = { ...body, rtspPathMain: m.path };
    }
  }
  const pick = (k, d) => (body[k] !== undefined ? body[k] : existing[k] !== undefined ? existing[k] : d);

  const out = {
    kind,
    name: str(pick("name")),
    enabled: pick("enabled", true) !== false,
    notes: str(pick("notes")),
  };
  if (!out.name) errs.push("name is required");

  // A wearable has no stall of its own: it goes where its horse goes.
  if (kind !== "edge_box" && kind !== "wearable_hub") out.stall = str(pick("stall"));
  if (kind === "push_device" && !out.stall) errs.push("stall is required — readings are attributed to it");

  // RS-485 sensors hang off the edge box's serial port: no address to reach.
  const rtu = kind === "modbus_sensor" && pick("transport", "tcp") === "rtu";
  if (POLLED.has(kind)) {
    out.edgeId = pick("edgeId", null) || null;
    if (out.edgeId && !all.some((d) => d.id === out.edgeId && d.kind === "edge_box"))
      errs.push("the chosen edge box does not exist");
    out.host = rtu ? "" : str(pick("host"));
    if (rtu) { /* no host */ }
    else if (!out.host) errs.push("IP address is required");
    else if (/[\s/?#@]/.test(out.host)) errs.push("enter a bare IP address or hostname, not a URL");
  }

  if (kind === "wearable_hub") {
    out.horseId = str(pick("horseId"));
    if (!out.horseId) errs.push("choose the horse that wears it — every reading it sends is attributed to that horse");
    else if (!horses.some((h) => h.id === out.horseId)) errs.push("that horse is not in the roster");
    const s = pick("sensors", {}) || {};
    const leg = s.leg === undefined || s.leg === null || s.leg === "" ? null : str(s.leg);
    const pelvis = Array.isArray(s.pelvis) ? [...new Set(s.pelvis.map((v) => str(v)).filter(Boolean))] : [];
    if (s.pelvis !== undefined && s.pelvis !== null && !Array.isArray(s.pelvis)) errs.push("pelvis sensors must be a list of hardware IDs");
    if (pelvis.length > 4) errs.push("at most 4 pelvis sensors per hub");
    for (const id of [leg, ...pelvis]) if (id !== null && !HARDWARE_ID.test(id))
      errs.push(`sensor ID "${id.slice(0, 70)}": use the ID printed on the sensor (letters, digits, . _ : -; up to 64)`);
    out.sensors = { leg, pelvis };
    out.imei = str(pick("imei")).replace(/[\s-]/g, "");
    if (out.imei && !/^[0-9]{14,16}$/.test(out.imei)) errs.push("IMEI is the 15-digit number on the hub's label");
    // Two hubs on one horse would double-count its steps; one sensor paired
    // to two hubs would put one horse's gait on another.
    for (const d of all) {
      if (d.kind !== "wearable_hub" || d.id === existing.id) continue;
      if (out.horseId && d.horseId === out.horseId && d.enabled !== false && out.enabled)
        errs.push(`"${d.name}" is already on this horse — switch it off or remove it first`);
      const theirs = new Set([d.sensors?.leg, ...(d.sensors?.pelvis || [])].filter(Boolean));
      for (const id of [leg, ...pelvis]) if (id && theirs.has(id)) errs.push(`sensor ${id} is already paired to "${d.name}"`);
      if (out.imei && d.imei === out.imei) errs.push(`IMEI ${out.imei} is already registered as "${d.name}"`);
    }
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
      // "isapi": the vendor's documented API. "mtrpc": the JSON-RPC firmware
      // the demo unit actually runs. "auto": detected on first contact.
      protocol: String(pick("protocol", "auto")),
      // Keep thermal + visible video on the edge box for labelling and
      // training (off by default: it is continuous footage, and disk).
      record: pick("record", false) === true,
      // Whether people found in the colour picture are counted as visits. Off
      // where the detector takes the horse for a person (1–2 Oct, RVC, at
      // night: the horse's dark hindquarters) — then only visits a person
      // confirms on the recording are reported.
      peopleTrusted: pick("peopleTrusted", true) !== false,
      // Which picture behaviour (activity, lying, vices) is read from.
      // Colour is the default: more detail, and the horse detector runs on
      // it. (On the demo unit both pictures show about the same ~25° view.)
      behaviourStream: String(pick("behaviourStream", "visible")),
      // Colour stream: the camera's sub-stream ("sub", 704x576) or its full-HD
      // main stream ("main", 1920x1080) — sharper recordings and report photos
      // to zoom into, larger files.
      colourStream: String(pick("colourStream", "sub")),
    });
    if (!["auto", "isapi", "mtrpc"].includes(out.protocol)) errs.push("protocol must be auto, isapi or mtrpc");
    if (!["visible", "thermal"].includes(out.behaviourStream)) errs.push("behaviourStream must be visible or thermal");
    if (!["sub", "main"].includes(out.colourStream)) errs.push("colourStream must be sub or main");
    errs.push(...validateCameraModel(out));
    if (!out.stall) errs.push("stall is required — the camera's readings are attributed to it");
    for (const k of ["httpPort", "rtspPort", "modbusPort"]) if (!isPort(out[k])) errs.push(`${k} must be a port number`);
  }

  if (kind === "ip_camera") {
    Object.assign(out, {
      make: str(pick("make"), "hikvision"),
      channel: num(pick("channel"), 1),
      rtspPort: num(pick("rtspPort"), 554),
      httpPort: num(pick("httpPort"), 80),           // ONVIF, to find the stream on other makes
      username: str(pick("username"), "admin"),
      record: pick("record", false) === true,
      peopleTrusted: pick("peopleTrusted", true) !== false,
      // Recordings from the sub stream (small) or the main stream (detail).
      colourStream: String(pick("colourStream", "sub")),
    });
    if (!MAKES[out.make]) errs.push("choose the camera's make");
    else if (MAKES[out.make].path) Object.assign(out, pathsFor(out.make, out.channel));
    else {
      // pasted, or found over ONVIF ("Find the stream")
      out.rtspPath = str(pick("rtspPath")) || null;
      out.rtspPathMain = str(pick("rtspPathMain")) || out.rtspPath;
      if (out.make === "custom" && !out.rtspPath) errs.push("paste the camera's RTSP address (rtsp://…)");
    }
    if (out.rtspPath && !/^\/\S*$/.test(out.rtspPath)) errs.push("the stream path must start with /");
    if (!Number.isInteger(out.channel) || out.channel < 1 || out.channel > 64) errs.push("channel is 1 to 64 (1 for a camera on its own)");
    if (!["sub", "main"].includes(out.colourStream)) errs.push("recordings: sub or main stream");
    if (!out.stall) errs.push("stall is required — the camera's readings are attributed to it");
    for (const k of ["httpPort", "rtspPort"]) if (!isPort(out[k])) errs.push(`${k} must be a port number`);
  }

  if (kind === "modbus_sensor") {
    Object.assign(out, {
      transport: String(pick("transport", "tcp")),
      port: num(pick("port"), 502),
      unitId: num(pick("unitId"), 1),
      function: num(pick("function"), 3),
      addressing: pick("addressing", "zero-based") === "one-based" ? "one-based" : "zero-based",
      pollSeconds: num(pick("pollSeconds"), 10),
    });
    if (!out.stall) errs.push("stall is required — the sensor's readings are attributed to it");
    if (!["tcp", "rtu"].includes(out.transport)) errs.push('transport must be "tcp" (Modbus/TCP) or "rtu" (RS-485)');
    if (rtu) {
      Object.assign(out, {
        serialPort: str(pick("serialPort")),
        baud: num(pick("baud"), 9600),
        parity: String(pick("parity", "N")).toUpperCase(),
        stopBits: num(pick("stopBits"), 1),
      });
      if (!out.serialPort) errs.push("serial port is required for RS-485 (e.g. /dev/ttyUSB0)");
      else if (!SERIAL_PORT.test(out.serialPort)) errs.push("serial port must be a device path such as /dev/ttyUSB0 (or COM3)");
      if (!(Number.isInteger(out.baud) && out.baud >= 1200 && out.baud <= 115200)) errs.push("baud must be a whole number, 1200–115200");
      if (!["N", "E", "O"].includes(out.parity)) errs.push("parity must be N, E or O");
      if (![1, 2].includes(out.stopBits)) errs.push("stop bits must be 1 or 2");
      // Unit 0 is the RS-485 broadcast address: nothing ever answers it.
      if (out.unitId === 0) errs.push("unit id 0 is the RS-485 broadcast address — use the sensor's own address (1–247)");
    } else {
      // Switching back to TCP: no serial settings left behind to confuse anyone.
      Object.assign(out, { serialPort: undefined, baud: undefined, parity: undefined, stopBits: undefined });
      if (!isPort(out.port)) errs.push("port must be a port number");
    }
    if (!(Number.isInteger(out.unitId) && out.unitId >= 0 && out.unitId <= 247)) errs.push("unit id must be 0–247");
    if (![3, 4].includes(out.function)) errs.push("function must be 3 (holding registers) or 4 (input registers)");
    if (!(out.pollSeconds >= 1 && out.pollSeconds <= 3600)) errs.push("poll interval must be 1–3600 s");
    const regs = pick("registers", []);
    if (!Array.isArray(regs) || regs.length === 0) errs.push("add at least one register");
    else if (regs.length > 32) errs.push("at most 32 registers per sensor");
    out.registers = (Array.isArray(regs) ? regs : []).map((r0, i) => {
      const r = r0 && typeof r0 === "object" ? r0 : {};
      const use = r.use === undefined || r.use === null || r.use === "" ? null : String(r.use);
      const how = use ? REGISTER_USES[use] : null;
      // A use decides the metric (its first one, unless another it emits is
      // named) and how the register is read.
      const metric = String(r.metric || (how ? how.metrics[0] : ""));
      const reg = {
        name: str(r.name) || `register ${i + 1}`,
        address: num(r.address, NaN),
        type: String(r.type || "uint16"),
        wordOrder: WORD_ORDERS.includes(r.wordOrder) ? r.wordOrder : "high-first",
        scale: num(r.scale, 1),
        offset: num(r.offset, 0),
        metric,
        unit: str(r.unit) || METRICS[metric]?.unit || "",
        mode: how ? how.mode : r.mode === "counter" ? "counter" : "gauge",
      };
      if (use) {
        reg.use = use;
        if (!how) errs.push(`${reg.name}: use must be one of ${Object.keys(REGISTER_USES).join(", ")} (or none)`);
        else if (!how.metrics.includes(metric)) errs.push(`${reg.name}: a ${use} register feeds ${how.metrics.join(" / ")}, not ${metric}`);
        // Which fault code means what, when the feeder's table differs from
        // the edge agent's default. { "<code>": "<fault kind>" }
        if (use === "fault" && r.faultCodes !== undefined && r.faultCodes !== null) {
          const codes = r.faultCodes;
          const ok = typeof codes === "object" && !Array.isArray(codes) && Object.entries(codes).length <= 64 &&
            Object.entries(codes).every(([k, v]) => /^[0-9]{1,5}$/.test(k) && Number(k) <= 65535 && FEEDER_FAULTS.includes(v));
          if (!ok) errs.push(`${reg.name}: fault codes map a register value (0–65535) to one of ${FEEDER_FAULTS.join(", ")}`);
          else reg.faultCodes = Object.fromEntries(Object.entries(codes).map(([k, v]) => [String(Number(k)), v]));
        }
      }
      const minAddr = out.addressing === "one-based" ? 1 : 0;
      if (!(Number.isInteger(reg.address) && reg.address >= minAddr && reg.address <= 65535 + minAddr))
        errs.push(`${reg.name}: address must be a whole number (${out.addressing}, ${minAddr}–${65535 + minAddr})`);
      if (!TYPES[reg.type]) errs.push(`${reg.name}: type must be one of ${Object.keys(TYPES).join(", ")}`);
      if (!isKnownMetric(reg.metric)) errs.push(`${reg.name}: pick which monitoring metric it feeds`);
      if (!Number.isFinite(reg.scale) || reg.scale === 0) errs.push(`${reg.name}: scale must be a non-zero number`);
      if (!Number.isFinite(reg.offset)) errs.push(`${reg.name}: offset must be a number`);
      return reg;
    });
    // Readings are told apart by device, metric and time (the dedupKey): two
    // registers of one sensor sending the same metric in the same poll would
    // be stored as one — and for one stall they would double-count anyway
    // (a flow meter AND a bucket scale both measure its water).
    const emits = new Map();
    for (const reg of out.registers) {
      for (const m of reg.use ? REGISTER_USES[reg.use]?.metrics ?? [] : [reg.metric]) {
        if (!emits.has(m)) { emits.set(m, reg.name); continue; }
        errs.push(`${reg.name} and ${emits.get(m)} would both send ${m} — one sensor record feeds each metric once`);
        break;
      }
    }
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
    // an NVR: one address, a channel per camera — the stream is what must differ
    const port = kind === "thermal_camera" ? out.httpPort : kind === "ip_camera" ? `${out.rtspPort}${out.rtspPath ?? ""}` : out.port;
    const clash = all.find((d) => d.id !== existing.id && d.kind === kind && d.host === out.host && d.transport !== "rtu" &&
      (kind === "thermal_camera" ? d.httpPort : kind === "ip_camera" ? `${d.rtspPort}${d.rtspPath ?? ""}` : d.port) === port);
    if (clash) errs.push(`"${clash.name}" is already registered at ${out.host}${kind === "ip_camera" ? ` (${out.rtspPath ?? "same stream"})` : `:${port}`}`);
  }
  // On an RS-485 bus the endpoint is (edge box, serial port, unit id), and
  // every device on one port shares its line settings.
  if (rtu && out.serialPort) {
    const bus = all.filter((d) => d.id !== existing.id && d.kind === "modbus_sensor" && d.transport === "rtu" &&
      d.edgeId === out.edgeId && d.serialPort === out.serialPort);
    const clash = bus.find((d) => d.unitId === out.unitId);
    if (clash) errs.push(`"${clash.name}" already answers as unit ${out.unitId} on ${out.serialPort}`);
    const odd = bus.find((d) => d.baud !== out.baud || d.parity !== out.parity || d.stopBits !== out.stopBits);
    if (odd) errs.push(`every sensor on ${out.serialPort} must use the same line settings — "${odd.name}" uses ${odd.baud} baud, 8${odd.parity}${odd.stopBits}`);
  }
  return { out, errs };
}

// --------------------------------------------------------------------------- //
// What leaves the server.
// --------------------------------------------------------------------------- //
/** The stall a horse is in, or null ("—" is the UI's placeholder). */
const stallOf = (h) => (h?.stall && h.stall !== "—" ? h.stall : null);

/** Admin/staff view: never a password or token hash, in any form. A
 *  wearable's stall is its horse's current one, looked up here. */
export function publicDevice(d, all = [], { horses = [] } = {}) {
  const { passwordEnc, tokenHash, ...rest } = d;
  const hub = d.kind === "wearable_hub"
    ? { stall: stallOf(horses.find((h) => h.id === d.horseId)), metrics: [...WEARABLE_METRICS], sensorStatus: d.sensorStatus ?? [] }
    : {};
  return {
    ...rest,
    ...hub,
    hasPassword: Boolean(passwordEnc),
    hasToken: Boolean(tokenHash),
    status: deviceStatus(d, all),
  };
}

/** Owner view: that a camera watches their horse and whether it works. */
export const ownerDevice = (d, all, { horses = [] } = {}) => ({
  id: d.id, kind: d.kind, name: d.name,
  stall: d.kind === "wearable_hub" ? stallOf(horses.find((h) => h.id === d.horseId)) : d.stall,
  status: deviceStatus(d, all).state,
  calibrated: d.kind === "thermal_camera" ? Boolean(d.rois && !d.rois.stale) : d.kind === "ip_camera" ? true : null,
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
  if (d.kind === "push_device" || d.kind === "wearable_hub") {
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
  if (d.lastSeen && age(d.lastSeen) < DEVICE_ONLINE_MS)
    return { state: "online", detail: "reporting", ...(d.health?.warnings?.length ? { warnings: d.health.warnings } : {}) };
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

  // ---- token principals (edge boxes, push devices, wearable hubs) --------- //
  /** The enabled device holding this token hash — how the relay's stored
   *  items (which keep only sha256(token)) find their sender. */
  function deviceByTokenHash(hash) {
    if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return null;
    return list().find((d) => d.tokenHash && d.enabled !== false && safeEq(d.tokenHash, hash)) || null;
  }
  function deviceByToken(token) {
    if (!token || !token.startsWith("eqd_")) return null;
    return deviceByTokenHash(sha(token));
  }
  const anyDeviceTokens = () => list().some((d) => d.tokenHash);

  /** Battery / signal / attached per sensor, from the hub's device_status and
   *  device_detached readings — what the Hardware page shows for a wearable.
   *  Out-of-order delivery (the relay, a backlog) never overwrites newer news. */
  function sensorStatusUpdate(dev, rs) {
    const out = Array.isArray(dev.sensorStatus) ? dev.sensorStatus.map((s) => ({ ...s })) : [];
    const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const iso = (ts) => (Number.isFinite(Date.parse(ts)) ? new Date(Date.parse(ts)).toISOString() : now());
    for (const r of rs.map((x) => ({ ...x, ts: iso(x.ts) })).sort((a, b) => a.ts.localeCompare(b.ts))) {
      const hw = typeof r.meta.hardwareId === "string" ? r.meta.hardwareId.slice(0, 64) : null;
      let s = out.find((x) => x.sensor === r.meta.sensor && (!hw || !x.hardwareId || x.hardwareId === hw));
      if (!s) {
        if (out.length >= 8) continue;
        out.push(s = { sensor: r.meta.sensor, hardwareId: hw, batteryPct: null, signalDbm: null, attached: null, firmware: null, lastSeen: null });
      }
      if (s.lastSeen && r.ts < s.lastSeen) continue;
      s.lastSeen = r.ts;
      if (hw) s.hardwareId = hw;
      if (r.metric === "device_detached") { s.attached = false; continue; }
      const pct = n(r.value);
      s.batteryPct = pct === null ? null : Math.max(0, Math.min(100, Math.round(pct)));
      s.signalDbm = n(r.meta.signalDbm);
      s.attached = typeof r.meta.attached === "boolean" ? r.meta.attached : null;
      s.firmware = typeof r.meta.firmware === "string" ? r.meta.firmware.slice(0, 40) : null;
    }
    return out;
  }

  /**
   * Attribute and vet an ingest batch sent by a device token. Returns
   * { clean, rejected } — rejected readings carry a reason. Legacy callers
   * (no device token) pass through with deviceId-based stall resolution.
   *
   * The registry decides whose readings these are. A device token can NOT
   * choose the horse: a horseId in its payload is removed — a wearable's
   * readings go to the horse it is registered on, everything else to the
   * horse in its stall. Only the legacy ingest token may still name one.
   */
  function attribute(batch, principal) {
    const clean = [], rejected = [];
    const seen = new Map();
    const statusFor = new Map();       // wearable id -> its device_status / device_detached readings
    const horses = new Map(store.list("horses").map((h) => [h.id, h]));
    for (const r0 of batch) {
      const r = { ...r0, meta: { ...(r0.meta || {}) } };
      if (principal) delete r.horseId;
      let dev = null;
      if (principal?.kind === "push_device" || principal?.kind === "wearable_hub") {
        dev = principal;
        const allowed = dev.kind === "wearable_hub" ? WEARABLE_METRICS.has(r.metric) : dev.metrics.includes(r.metric);
        if (!allowed) { rejected.push({ metric: r.metric, reason: "metric not allowed for this device" }); continue; }
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
        r.meta.deviceId = dev.id;
        if (dev.kind === "wearable_hub") {
          const horse = horses.get(dev.horseId);
          if (!horse) { rejected.push({ metric: r.metric, reason: "this wearable's horse is no longer in the roster — edit the wearable" }); continue; }
          const needsSensor = r.metric === "device_status" || r.metric === "device_detached";
          if ((needsSensor || r.meta.sensor !== undefined) && !WEARABLE_SENSORS.includes(r.meta.sensor)) {
            rejected.push({ metric: r.metric, reason: `meta.sensor must be ${WEARABLE_SENSORS.join(", ")}` }); continue;
          }
          r.horseId = horse.id;
          r.stallId = stallOf(horse);
          // Whatever the hub claims, it is a wearable measurement — and an
          // unvalidated one: activity, lying and steps from it must not drive
          // the colic rule until the wearable has been checked on real horses.
          r.source = "imu";
          if (!WEARABLE_DEVICE_METRICS.has(r.metric)) r.meta.prototype = true;
          if (needsSensor) (statusFor.get(dev.id) ?? statusFor.set(dev.id, []).get(dev.id)).push(r);
        } else if (dev.kind === "thermal_camera" && dev.views?.length) {
          // A camera watching several stalls says which stall each reading is
          // from — only one it watches; anything else is its own stall.
          r.stallId = stallsOf(dev).includes(r.stallId) ? r.stallId : dev.stall;
          r.meta.stall = r.stallId;                           // two horses' readings of one second are not duplicates
        } else {
          r.stallId = dev.stall || r.stallId;
        }
        if (!r.unit && METRICS[r.metric]) r.unit = METRICS[r.metric].unit;
        if (!r.source && dev.kind === "push_device") r.source = METRICS[r.metric]?.source ?? "push_device";
        if (dev.kind === "ip_camera") {
          // An ordinary camera sees colour only: no temperature can come from it.
          if (METRICS[r.metric]?.source === "thermal_camera") { rejected.push({ metric: r.metric, reason: "an ordinary camera has no thermal sensor" }); continue; }
          r.source = VIDEO_SOURCES.has(r.source) ? r.source : "visible_video";
        }
        if (dev.kind === "thermal_camera") {
          // Vitals come off the camera's thermometry; behaviour off its thermal
          // or colour video — both prototype sources. Anything else is taken
          // as thermometry: a behaviour reading must never be relabelled as a
          // validated measurement (it would then count towards the colic alarm).
          r.source = VIDEO_SOURCES.has(r.source) ? r.source : "thermal_camera";
          // Only the vitals depend on where the ROIs are aimed.
          if (AIMED_METRICS.has(r.metric)) {
            // Aimed: the stall's close-up (a multi-stall camera) or the camera's own ROIs.
            const close = dev.views?.find((v) => v.kind === "close" && v.stall === r.stallId);
            const aimed = dev.views?.length ? Boolean(close && (close.rois?.eye || close.rois?.nostril)) || r.meta?.view === "wide" : Boolean(dev.rois && !dev.rois.stale);
            if (!aimed) r.meta.calibrated = false;
          }
        }
        seen.set(dev.id, r.ts || now());
      }
      clean.push(r);
    }
    const stamp = now();
    for (const id of seen.keys()) store.update("devices", id, { lastSeen: stamp });
    if (principal) store.update("devices", principal.id, { lastSeen: stamp });
    for (const [id, rs] of statusFor) {
      const d = byId(id);
      if (d) store.update("devices", id, { sensorStatus: sensorStatusUpdate(d, rs) });
    }
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
    let protocol = null;
    if (reach) await step("Protocol", async () => {
      protocol = await protocolOf(dev);
      return protocol === "mtrpc"
        ? "JSON-RPC (/mtrpc) — the firmware on the Sparsh demo unit; temperatures are read by sampling the ROI pixels"
        : "ISAPI — the vendor-documented API";
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
        if (b.mode === "kBodyTemperature")
          throw new Error(`the camera is in body-temperature mode, which applies a human skin-to-core correction — switch it to body-surface mode (emissivity ${(b.FPara100 ?? 0) / 100}, distance ${(b.AimDistance ?? 0) / 100} m)`);
        return `emissivity ${(b.FPara100 ?? 0) / 100} · distance ${(b.AimDistance ?? 0) / 100} m` + (b.mode ? " · surface-temperature mode" : "");
      }));
      if (protocol === "mtrpc") await step("Live temperatures", () => camera(dev, async (c) => {
        if (dev.rois && !dev.rois.stale) {
          const r = await mtrpcReadings(c, dev.rois);
          return `eye ${r.eye?.c?.toFixed(1) ?? "?"} °C (hottest in box) · nostril avg ${r.nostril?.avgC?.toFixed(1) ?? "?"} °C`;
        }
        const centre = await c.readPixels([{ x: 4096, y: 4096 }]);
        return `centre of the frame ${centre[0]?.toFixed(1) ?? "?"} °C — no ROIs yet, calibrate to start measuring`;
      }));
      else await step("Live temperatures", () => camera(dev, async (c) => {
        const t = await c.queryTemps();
        if (!t.length) return "no ROIs configured yet — calibrate to start measuring";
        const r = roiReadings(t);
        const parts = [];
        if (r.eye) parts.push(`eye ${r.eye.c?.toFixed(1)} °C (${r.eye.mode === "box-max" ? "hottest in box" : "point"})`);
        if (r.nostril) parts.push(`nostril avg ${r.nostril.avgC?.toFixed(1)} °C`);
        return parts.join(" · ") || t.map((x) => `${x.type.toLowerCase()} ${x.id}`).join(", ") + " — not the slots EquiCare uses; calibrate";
      }));
    }
    if (reach && protocol !== "mtrpc") {
      await step(`Modbus/TCP :${dev.modbusPort}`, async () => {
        const regs = await readRegisters(dev.host, dev.modbusPort, 1, 3, 1018, 2);
        const b = Buffer.alloc(4); b.writeUInt16LE(regs[0], 0); b.writeUInt16LE(regs[1], 2);
        return `point 1 = ${b.readFloatLE(0).toFixed(1)} °C (cross-check against ISAPI)`;
      });
      await step(`RTSP :${dev.rtspPort}`, () => rtspOptions(dev.host, dev.rtspPort));
    } else if (reach) {
      await step(`RTSP :${dev.rtspPort}`, () => rtspOptions(dev.host, dev.rtspPort));
    }
    const ok = Boolean(authed);
    const patch = { lastProbe: { at: now(), ok, steps, device } };
    if (protocol && dev.protocol !== protocol) patch.protocol = protocol;   // remember what auto found
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

  /** Eye and nostril readings from a Query result, matched by type AND id —
   *  with two Areas on the camera, "the Area" would be ambiguous. */
  function roiReadings(temps) {
    const eyeBox = temps.find((x) => x.type === "Area" && x.id === EYE_AREA_IDX);
    const eyePoint = temps.find((x) => x.type === "Point" && x.id === LEGACY_EYE_POINT_IDX);
    const nos = temps.find((x) => x.type === "Area" && x.id === NOSTRIL_IDX);
    return {
      eye: eyeBox ? { c: eyeBox.maxC, at: eyeBox.maxAt, mode: "box-max" }
        : eyePoint ? { c: eyePoint.pointC, at: null, mode: "point" } : null,
      nostril: nos ? { avgC: nos.avgC, minC: nos.minC, maxC: nos.maxC } : null,
    };
  }

  /** JSON-RPC cameras: measure the stored ROIs by sampling pixels. `parts`
   *  "nostril" skips the eye scan (~0.7 s), for the fast breathing check. */
  async function mtrpcReadings(c, rois, parts = "all") {
    if (!rois) return { eye: null, nostril: null };
    const nostril = await c.boxStats(rois.nostril);
    const eyeBox = rois.eye && rois.eye.x0 !== undefined ? rois.eye
      : rois.eye ? { x0: rois.eye.x - 150, y0: rois.eye.y - 120, x1: rois.eye.x + 150, y1: rois.eye.y + 120 } : null;
    const eye = parts === "nostril" || !eyeBox ? null : await c.boxMax(eyeBox);
    return {
      eye: eye ? { c: eye.c, at: eye.at, mode: "box-max" } : null,
      nostril: nostril ? { avgC: nostril.avgC, minC: nostril.minC, maxC: nostril.maxC } : null,
    };
  }

  // ---- ROI verification ---------------------------------------------------- //
  async function verifyRois(c, eye, n) {
    const sameBox = (pts, b) => {
      const xs = pts.map((q) => q.RatX), ys = pts.map((q) => q.RatY);
      return Math.min(...xs) === b.x0 && Math.max(...xs) === b.x1 && Math.min(...ys) === b.y0 && Math.max(...ys) === b.y1;
    };
    try {
      const areas = (await c.getJson("/ISAPI/Thermometry/Area?Dev=0&Idx=255")).ThermometryList || [];
      const e = areas.find((x) => (x.Type || "Area") === "Area" && x.Id === EYE_AREA_IDX && x.Enable !== "No");
      const a = areas.find((x) => (x.Type || "Area") === "Area" && x.Id === NOSTRIL_IDX && x.Enable !== "No");
      if (!e || !a) return { verified: false, detail: "the camera does not list the ROIs it just accepted" };
      const eg = e.Area?.EndPointList, ag = a.Area?.EndPointList;
      if (!eg || !ag) return { verified: null, detail: "the camera confirms both ROIs exist but does not report their coordinates" };
      return sameBox(eg, eye) && sameBox(ag, n)
        ? { verified: true, detail: "read back from the camera and matched" }
        : { verified: false, detail: "the camera reports different coordinates than were sent" };
    } catch (err) {
      return { verified: null, detail: `could not read the ROIs back: ${err.message}` };
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
      const horses = store.list("horses");
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
            protocol: d.protocol || "auto",
            record: d.record === true, rtspPort: d.rtspPort,
            behaviourStream: d.behaviourStream || "visible",
            // The horse the roster puts in this stall: recognition checks it is
            // the one standing there, and learns its look (edge/identity.py).
            stallHorse: (({ id, name } = {}) => (id ? { id, name } : null))(horses.find((h) => stallOf(h) && stallOf(h) === d.stall)),
            // A camera watching several stalls (edge/multistall.py): its views,
            // its zoom, and the horse in each stall it watches.
            ...(d.views?.length ? {
              views: d.views, ptz: d.ptz ?? null, schedule: d.schedule ?? { closeEveryMin: 5 },
              stallHorses: Object.fromEntries(stallsOf(d).map((s) => [s, (({ id, name } = {}) => (id ? { id, name } : null))(horses.find((h) => stallOf(h) === s))])),
            } : {}),
            colourStream: d.colourStream || "sub",
            // Urine/manure split from the floor cooling test (null = the
            // edge agent's default guess).
            floorCalib: { urineHalfLifeMin: splitFromCalib(d.floorCalib), deltaC: d.floorCalib?.deltaC ?? null },
            // JSON-RPC cameras are measured by the edge box sampling these.
            // flank is on the COLOUR picture (breathing from flank movement).
            rois: d.rois && !d.rois.stale ? { eye: d.rois.eye, nostril: d.rois.nostril, floor: d.rois.floor ?? null, flank: d.rois.flank ?? null, colourFloor: d.rois.colourFloor ?? null, hay: d.rois.hay ?? null, pushedAt: d.rois.pushedAt ?? null } : null,
          };
        }
        if (d.kind === "ip_camera") {
          const cred = cameraPassword(d);
          return {
            ...base, protocol: "rtsp", username: d.username, password: cred.password ?? null,
            configError: cred.error ?? (d.rtspPath ? null : "the camera's stream is not found yet — press “Find the stream” on the Hardware page"),
            rtspPort: d.rtspPort, rtspPath: d.rtspPath, rtspPathMain: d.rtspPathMain || d.rtspPath,
            record: d.record === true, colourStream: d.colourStream || "sub", behaviourStream: "visible", calibrated: true,
            stallHorse: (({ id, name } = {}) => (id ? { id, name } : null))(horses.find((h) => stallOf(h) && stallOf(h) === d.stall)),
            // the colour boxes, all optional: flank (breathing), floor, hay
            rois: d.rois ? { flank: d.rois.flank ?? null, colourFloor: d.rois.colourFloor ?? null, hay: d.rois.hay ?? null, pushedAt: d.rois.pushedAt ?? null } : null,
          };
        }
        // registers carry their `use` (flow / bucket / feed_bowl / hay /
        // fault) when set: the edge box turns those into bouts and meals.
        return {
          ...base, transport: d.transport || "tcp", port: d.port, unitId: d.unitId, function: d.function,
          addressing: d.addressing, pollSeconds: d.pollSeconds, registers: d.registers,
          ...(d.transport === "rtu" ? { serialPort: d.serialPort, baud: d.baud, parity: d.parity, stopBits: d.stopBits } : {}),
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
                // Working, but part of it is not (a video stream, the detector).
                warnings: Array.isArray(h.warnings) ? h.warnings.slice(0, 4).map((w) => String(w).slice(0, 200)) : [],
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
    const horses = { horses: store.list("horses") };

    if (path === "/api/devices" && method === "GET") {
      if (who?.role === "owner") {
        const mine = visibleRoster();
        const stalls = new Set(mine.map((h) => h.stall)), ids = new Set(mine.map((h) => h.id));
        return json(200, all.filter((d) => d.kind !== "edge_box" && (d.kind === "wearable_hub" ? ids.has(d.horseId) : stalls.has(d.stall)))
          .map((d) => ownerDevice(d, all, horses)));
      }
      return json(200, all.map((d) => publicDevice(d, all, horses)));
    }

    if (path === "/api/devices" && method === "POST") {
      const { body, error } = await readBody(req);
      if (error) return error;
      const { out, errs } = validateDevice(body.kind, body, {}, all, horses);
      if (errs.length) return json(400, { error: "invalid device", details: errs });
      const extra = { createdAt: now(), lastSeen: null, health: null };
      let token = null;
      if (out.kind === "thermal_camera") Object.assign(extra, { passwordEnc: seal(body.password), rois: null, lastProbe: null, identity: null });
      if (out.kind === "ip_camera") {
        const pw = body.password || (body.rtspUrl ? parseRtspUrl(body.rtspUrl).password : null);
        Object.assign(extra, { passwordEnc: pw ? seal(pw) : null, rois: null, lastProbe: null });
      }
      if (TOKEN_KINDS.has(out.kind)) { const t = newToken(); token = t.token; Object.assign(extra, { tokenHash: t.tokenHash, tokenHint: t.tokenHint }); }
      const created = store.create("devices", { ...out, ...extra });
      event(created, actorOf(who), "created", `${out.kind} "${out.name}"`);
      return json(201, { device: publicDevice(created, list(), horses), token });
    }

    // Breathing check progress (JSON-RPC cameras: from the thermal video).
    const bj = path.match(/^\/api\/devices\/([^/]+)\/breathing\/([^/]+)$/);
    if (bj && method === "GET") {
      const job = breathingJob(decodeURIComponent(bj[2]));
      if (!job || job.deviceId !== decodeURIComponent(bj[1])) return json(404, { error: "unknown check" });
      return json(200, jobView(job));
    }

    // Floor cooling test progress, stop, and save as the urine/manure calibration.
    const cj = path.match(/^\/api\/devices\/([^/]+)\/cooling\/([^/]+)(?:\/(stop|save))?$/);
    if (cj) {
      const job = coolingJob(decodeURIComponent(cj[2]));
      const dev = byId(decodeURIComponent(cj[1]));
      if (!job || !dev || job.deviceId !== dev.id) return json(404, { error: "unknown test" });
      if (!cj[3] && method === "GET") return json(200, coolingView(job));
      if (cj[3] === "stop" && method === "POST") { job.stop = true; await job.done; return json(200, coolingView(job)); }
      if (cj[3] === "save" && method === "POST") {
        const { body, error } = await readBody(req);
        if (error) return error;
        if (!["urine", "manure"].includes(body.as)) return json(400, { error: "save it as urine or manure" });
        const r = coolingView(job).result;
        if (!r.halfLifeMin) return json(409, { error: "not measured yet — the patch has not cooled to half its warmth" });
        const floorCalib = { ...(dev.floorCalib || {}),
          [body.as]: { halfLifeMin: r.halfLifeMin, peakRiseC: r.peakRiseC, areaFrac: r.areaFrac, fill: r.fill, at: now(), by: actorOf(who) } };
        store.update("devices", dev.id, { floorCalib });
        const split = splitFromCalib(floorCalib);
        event(dev, actorOf(who), "floor calibrated",
          `${body.as}: cooled to half in ${r.halfLifeMin} min (peak +${r.peakRiseC} °C)` + (split ? `; urine/manure split now ${split} min` : ""));
        return json(200, { floorCalib, urineHalfLifeMin: split });
      }
      return json(405, { error: "method not allowed" });
    }

    const m = path.match(/^\/api\/devices\/([^/]+)(?:\/(probe|snapshot|live|rois|temps|token|events|verification|breathing|cooling|views|ptz|checklist|find))?$/);
    if (!m) return null;
    const dev = byId(decodeURIComponent(m[1]));
    if (!dev) return json(404, { error: "unknown device" });
    const action = m[2];
    const cameraOnly = () => (dev.kind === "thermal_camera" ? null : json(400, { error: "only cameras support this" }));

    if (!action && method === "PATCH") {
      const { body, error } = await readBody(req);
      if (error) return error;
      if (body.kind && body.kind !== dev.kind) return json(400, { error: "a device's kind cannot change — remove it and add a new one" });
      const { out, errs } = validateDevice(dev.kind, body, dev, all, horses);
      if (errs.length) return json(400, { error: "invalid device", details: errs });
      const patch = { ...out, updatedAt: now() };
      const changes = Object.keys(out).filter((k) => JSON.stringify(out[k]) !== JSON.stringify(dev[k]));
      if (dev.kind === "thermal_camera") {
        if (body.password) { patch.passwordEnc = seal(body.password); changes.push("password"); }
        // Moving the camera or changing its optics invalidates the aim.
        const moved = changes.includes("host") && !sameAddress(out.host, dev.host);
        if ((moved || ["stall", "variant", "thermalLens", "distanceM"].some((k) => changes.includes(k))) && dev.rois)
          patch.rois = { ...dev.rois, stale: true };
        // A new address may legitimately be a replacement unit; identity is
        // re-confirmed on the next test rather than silently carried over.
        if (changes.includes("host") || changes.includes("httpPort")) forget(dev.id);
      }
      if (dev.kind === "ip_camera") {
        const pw = body.password || (body.rtspUrl ? parseRtspUrl(body.rtspUrl).password : null);
        if (pw) { patch.passwordEnc = seal(pw); changes.push("password"); }
        // another camera or channel: the boxes drawn on the old picture no longer fit
        if (["host", "channel", "make", "rtspPath"].some((k) => changes.includes(k)) && dev.rois) patch.rois = null;
      }
      const row = store.update("devices", dev.id, patch);
      if (changes.length) event(dev, actorOf(who), "updated", changes.join(", "));
      return json(200, publicDevice(row, list(), horses));
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

    // ---- a camera the stable already owns (server/ip-camera.mjs) ------------ //
    if (dev.kind === "ip_camera" && ["probe", "snapshot", "rois", "find", "live"].includes(action)) {
      const cred = cameraPassword(dev);
      if (cred.error) return json(400, { error: cred.error });
      const host = await checkHost(dev.host);
      if (!host.ok) return json(400, { error: host.error });
      if (action === "find" && method === "POST") {
        // ONVIF: ask the camera where its streams are
        try {
          const list = await onvifStreams({ host: dev.host, port: dev.httpPort || 80, username: dev.username || "admin", password: cred.password });
          const chosen = chooseStreams(list);
          store.update("devices", dev.id, { ...chosen, rois: dev.rtspPath && dev.rtspPath !== chosen.rtspPath ? null : dev.rois, updatedAt: now() });
          event(dev, actorOf(who), "stream found", `${list.length} streams over ONVIF; analysing ${chosen.rtspPath}`);
          return json(200, { streams: list.map(({ token, width, height, encoding, path: p }) => ({ token, width, height, encoding, path: p })), ...chosen });
        } catch (e) {
          return json(502, { error: `could not find the stream over ONVIF: ${e.message} — paste the RTSP address instead` });
        }
      }
      if (!dev.rtspPath) return json(409, { error: "the camera's stream is not known yet — find it or paste its RTSP address" });
      if (action === "probe" && method === "POST") {
        const result = await probeIpCamera(dev, cred.password);
        store.update("devices", dev.id, { lastProbe: result });
        event(dev, actorOf(who), "tested", result.ok ? result.lines[0] : result.lines.join(" "));
        return json(200, result);
      }
      if (action === "snapshot" && method === "GET") {
        try {
          const snap = await snapshotIpCamera(dev, cred.password);
          return new Response(snap.bytes, { status: 200, headers: { "Content-Type": snap.contentType, "Cache-Control": "no-store", ...CORS } });
        } catch (e) {
          return json(502, { error: e.message });
        }
      }
      if (action === "live") return json(501, { error: "live video is shown as pictures for this camera" });
      if (action === "rois" && method === "PUT") {
        // Only the colour boxes, all optional: the flank (breathing), the floor
        // (droppings and urine), the hay (eating time).
        const { body, error } = await readBody(req);
        if (error) return error;
        const ok = (b) => b && [b.x0, b.y0, b.x1, b.y1].every(inRange) && b.x1 - b.x0 >= 50 && b.y1 - b.y0 >= 50;
        const rois = { pushedAt: now() };
        for (const k of ["flank", "colourFloor", "hay"]) {
          if (body[k] === null || body[k] === undefined) continue;
          if (!ok(body[k])) return json(400, { error: `the ${k === "colourFloor" ? "floor" : k} box must be {x0, y0, x1, y1} in 0–10000, not tiny` });
          rois[k] = { x0: body[k].x0, y0: body[k].y0, x1: body[k].x1, y1: body[k].y1 };
        }
        store.update("devices", dev.id, { rois });
        event(dev, actorOf(who), "boxes drawn", ["flank", "colourFloor", "hay"].filter((k) => rois[k]).join(", ") || "none (the whole picture)");
        return json(200, { ok: true, rois });
      }
      return json(405, { error: "method not allowed" });
    }

    if (action === "token" && method === "POST") {
      if (!TOKEN_KINDS.has(dev.kind)) return json(400, { error: "only edge boxes, push devices and wearable hubs have tokens" });
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
      if (dev.kind === "modbus_sensor" && dev.transport === "rtu")
        return json(400, { error: "an RS-485 sensor is wired to its edge box — the server cannot read it directly; the edge box reports whether it answers" });
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

    // Live video for the Live page (server/live-video.mjs); the page falls
    // back to snapshots when this is not available.
    if (action === "live" && method === "GET") {
      const bad = cameraOnly(); if (bad) return bad;
      if (dev.enabled === false) return json(409, { error: "this camera is switched off on the Hardware page" });
      if (await protocolOf(dev) !== "mtrpc") return json(501, { error: "live video is available for the JSON-RPC cameras only" });
      const host = await checkHost(dev.host);
      if (!host.ok) return json(400, { error: host.error });
      const cred = cameraPassword(dev);
      if (cred.error) return json(500, { error: cred.error });
      const which = url.searchParams.get("stream") === "colour" ? "colour" : "thermal";
      return liveResponse(dev, cred.password, which, req.signal, CORS);
    }

    if (action === "temps" && method === "GET") {
      const bad = cameraOnly(); if (bad) return bad;
      try {
        if (await protocolOf(dev) === "mtrpc") {
          // Measured against the ROIs sent with the request (while aiming) or
          // the stored ones.
          const q = url.searchParams;
          const box = (k) => { const v = q.get(k)?.split(",").map(Number); return v?.length === 4 && v.every(inRange) ? { x0: v[0], y0: v[1], x1: v[2], y1: v[3] } : null; };
          const rois = box("nostril") ? { nostril: box("nostril"), eye: box("eye") } : dev.rois;
          if (!rois) return json(200, { at: now(), eye: null, nostril: null, note: "no ROIs yet" });
          const r = await camera(dev, (c) => mtrpcReadings(c, rois, q.get("parts") === "nostril" ? "nostril" : "all"));
          return json(200, { at: now(), ...r });
        }
        const temps = await camera(dev, (c) => c.queryTemps());
        return json(200, { at: now(), ...roiReadings(temps), all: temps });
      } catch (e) {
        return json(e instanceof IdentityMismatch ? 409 : 502, { error: e.message, code: e.code });
      }
    }

    // ---- a camera watching several stalls, zooming in on each horse --------- //
    // views: the wide view with each stall drawn on it, and a close-up per
    // horse (edge/multistall.py). ptz: moving the camera while setting them up.
    if (action === "views") {
      const bad = cameraOnly();
      if (bad) return bad;
      if (method === "GET") return json(200, { ptz: dev.ptz ?? null, views: dev.views ?? [], schedule: dev.schedule ?? { closeEveryMin: 5 }, stalls: stallsOf(dev) });
      if (method === "DELETE") {
        store.update("devices", dev.id, { ptz: null, views: null, schedule: null, updatedAt: now() });
        event(dev, actorOf(who), "views removed", "back to one stall");
        return json(200, publicDevice(byId(dev.id), list(), horses));
      }
      if (method === "PUT") {
        const { body, error } = await readBody(req);
        if (error) return error;
        const { out, errs } = validateViews(body, now());
        if (errs.length) return json(400, { error: "the zoom-camera setup is not complete", details: errs });
        store.update("devices", dev.id, { ...out, updatedAt: now() });
        const stalls = stallsOf({ ...dev, ...out });
        event(dev, actorOf(who), "views set", `${out.views.length} views; stalls ${stalls.join(", ")}; close-up every ${out.schedule.closeEveryMin} min`);
        return json(200, publicDevice(byId(dev.id), list(), horses));
      }
    }
    // Is the horse where the boxes are? Checked before a calibration is saved.
    // GET ?eye=x0,y0,x1,y1&nostril=…&flank=1&hay=1&colourFloor=1
    if (action === "checklist" && method === "GET") {
      const bad = cameraOnly();
      if (bad) return bad;
      const q = url.searchParams;
      const inRange = (v) => Number.isFinite(v) && v >= 0 && v <= 10000;
      const box = (k) => { const v = q.get(k)?.split(",").map(Number); return v?.length === 4 && v.every(inRange) && v[2] > v[0] && v[3] > v[1] ? { x0: v[0], y0: v[1], x1: v[2], y1: v[3] } : null; };
      if (await protocolOf(dev) !== "mtrpc") return json(400, { error: "the setup check reads the camera's pixels — JSON-RPC cameras only" });
      try {
        const r = await camera(dev, (c) => setupChecklist(c, { eye: box("eye"), nostril: box("nostril"),
          extras: { flank: q.get("flank") === "1", hay: q.get("hay") === "1", colourFloor: q.get("colourFloor") === "1" } }));
        return json(200, r);
      } catch (e) {
        return json(e instanceof IdentityMismatch ? 409 : 502, { error: e.message });
      }
    }
    if (action === "ptz") {
      const bad = cameraOnly();
      if (bad) return bad;
      const cred = cameraPassword(dev);
      if (cred.error) return json(400, { error: cred.error });
      const host = await checkHost(dev.host);
      if (!host.ok) return json(400, { error: host.error });
      const p = new OnvifPtz({ host: dev.host, username: dev.username || "admin", password: cred.password,
        port: Number(dev.ptz?.port ?? dev.httpPort ?? 80), path: dev.ptz?.path });
      try {
        if (method === "GET") {
          const profiles = await p.profiles();
          const presets = {};
          for (const pr of profiles.filter((x) => x.ptz)) presets[pr.token] = await p.presets(pr.token).catch(() => []);
          return json(200, { profiles, presets });
        }
        if (method === "POST") {
          const { body, error } = await readBody(req);
          if (error) return error;
          const prof = String(body.profile ?? "");
          if (!/^[A-Za-z0-9 ._:-]{1,64}$/.test(prof)) return json(400, { error: "profile (the lens's profile token) is required" });
          const n = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
          if (body.action === "nudge") await p.nudge(prof, { pan: n(body.pan) ?? 0, tilt: n(body.tilt) ?? 0, zoom: n(body.zoom) ?? 0, seconds: n(body.seconds) ?? 0.4 });
          else if (body.action === "absolute") await p.absolute(prof, { pan: n(body.pan), tilt: n(body.tilt), zoom: n(body.zoom) });
          else if (body.action === "goto") await p.gotoPreset(prof, String(body.preset));
          else if (body.action === "save") {
            const name = String(body.name ?? "equicare").slice(0, 40);
            const token = await p.savePreset(prof, name, body.token ? String(body.token) : null);
            event(dev, actorOf(who), "zoom position saved", `${name} on ${prof}`);
            return json(200, { token, status: await p.status(prof).catch(() => null) });
          } else if (body.action !== "status") return json(400, { error: "action must be nudge, absolute, goto, save or status" });
          return json(200, { status: await p.status(prof).catch(() => null) });
        }
      } catch (e) {
        return json(502, { error: `zoom control: ${e.message}` });
      }
    }

    if (action === "rois" && method === "PUT") {
      const bad = cameraOnly(); if (bad) return bad;
      const { body, error } = await readBody(req);
      if (error) return error;
      const n = body.nostril;
      // Eye: a box {x0,y0,x1,y1}; a point {x,y} (older clients) becomes a small
      // box around it.
      let eye = body.eye;
      if (eye && inRange(eye.x) && inRange(eye.y) && eye.x0 === undefined) {
        const cl = (v) => Math.max(0, Math.min(10000, v));
        eye = { x0: cl(eye.x - 150), y0: cl(eye.y - 120), x1: cl(eye.x + 150), y1: cl(eye.y + 120) };
      }
      const badBox = (b, what, max) =>
        !b || ![b.x0, b.y0, b.x1, b.y1].every(inRange) || b.x1 <= b.x0 || b.y1 <= b.y0
          ? `${what} must be {x0, y0, x1, y1} in 0–10000 with x1>x0, y1>y0`
          : b.x1 - b.x0 < 50 || b.y1 - b.y0 < 50 ? `the ${what} box is too small to measure over`
          : max && (b.x1 - b.x0 > max || b.y1 - b.y0 > max) ? `the ${what} box is too large — its hottest pixel may be something other than the eye`
          : null;
      // Optional: where the horse stands and urinates/defecates, for the
      // floor-event detector. Sent as null to remove it.
      const floor = body.floor ?? null;
      // Optional, on the COLOUR picture: the horse's flank, for breathing
      // from flank movement (a second opinion to the nostril).
      const flank = body.flank ?? null;
      // Optional, on the COLOUR picture: the floor the colour camera watches
      // for manure piles and wet bedding (one camera covering the floor).
      const colourFloor = body.colourFloor ?? null;
      // Optional, on the COLOUR picture: where the hay is, for the time
      // budget's "eating" (head at the hay, moving a little).
      const hay = body.hay ?? null;
      const why = badBox(eye, "eye", EYE_BOX_MAX) || badBox(n, "nostril") || (floor ? badBox(floor, "floor") : null)
        || (flank ? badBox(flank, "flank") : null) || (colourFloor ? badBox(colourFloor, "colour floor") : null)
        || (hay ? badBox(hay, "hay") : null);
      if (why) return json(400, { error: why });
      const box = (b) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });
      if (await protocolOf(dev) === "mtrpc") {
        // EquiCare measures these ROIs itself (pixel sampling), so storing
        // them is what matters. The camera is not given copies: it would
        // draw them as fixed boxes into its video (and the recordings), and
        // copies from earlier versions are switched off. The camera's
        // emissivity/distance are not touched here.
        let verify;
        try {
          verify = await camera(dev, (c) => c.hideRules());
        } catch (e) {
          if (e instanceof IdentityMismatch) return json(409, { error: e.message, code: e.code });
          verify = { verified: null, detail: `stored in EquiCare; the camera's own copies could not be checked (${e.message})` };
        }
        const rois = { eye: box(eye), nostril: box(n), ...(floor ? { floor: box(floor) } : {}), ...(flank ? { flank: box(flank) } : {}), ...(colourFloor ? { colourFloor: box(colourFloor) } : {}), ...(hay ? { hay: box(hay) } : {}), pushedAt: now(), verified: verify.verified };
        store.update("devices", dev.id, { rois, verification: null });
        event(dev, actorOf(who), "calibrated",
          `eye box (${eye.x0}, ${eye.y0})–(${eye.x1}, ${eye.y1}), nostril (${n.x0}, ${n.y0})–(${n.x1}, ${n.y1}); ${verify.detail}`);
        return json(200, { ok: true, results: { eye: true, nostril: true }, rois, verify });
      }
      const opts = { emissivity: dev.emissivity, distanceM: dev.distanceM };
      const corners = (b) => [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
      try {
        const out = await camera(dev, async (c) => {
          const basic = await c.setBasicParam(opts);
          const eyeRes = await c.setArea(EYE_AREA_IDX, corners(eye), { ...opts, name: "equicare-eye" });
          const area = await c.setArea(NOSTRIL_IDX, corners(n), { ...opts, name: "equicare-nostril" });
          // Retire the single-point eye of an earlier calibration, so nothing
          // reads a stale point. Best effort: failing this does not invalidate
          // the new ROIs, which readers prefer anyway.
          let legacy = null;
          try { legacy = await c.disableRoi("Point", LEGACY_EYE_POINT_IDX); } catch (e) { legacy = { ok: false, error: e.message }; }
          const verify = eyeRes.ok && area.ok ? await verifyRois(c, eye, n) : null;
          return { basic, eyeRes, area, legacy, verify };
        });
        const results = { basic: out.basic.ok, eye: out.eyeRes.ok, nostril: out.area.ok, legacyPointOff: out.legacy?.ok ?? null };
        if (!out.eyeRes.ok || !out.area.ok) {
          event(dev, actorOf(who), "calibration failed", JSON.stringify(results));
          return json(502, { error: "the camera rejected the ROI update", results, camera: { eye: out.eyeRes.body, nostril: out.area.body } });
        }
        if (out.verify.verified === false) {
          event(dev, actorOf(who), "calibration not confirmed", out.verify.detail);
          return json(502, { error: `ROIs sent, but ${out.verify.detail}`, results, verify: out.verify });
        }
        const rois = { eye: box(eye), nostril: box(n), ...(floor ? { floor: box(floor) } : {}), ...(flank ? { flank: box(flank) } : {}), ...(colourFloor ? { colourFloor: box(colourFloor) } : {}), ...(hay ? { hay: box(hay) } : {}), pushedAt: now(), verified: out.verify.verified };
        // A new aim has not been checked yet: any earlier verification was of
        // the old ROIs.
        store.update("devices", dev.id, { rois, verification: null });
        event(dev, actorOf(who), "calibrated",
          `eye box (${eye.x0}, ${eye.y0})–(${eye.x1}, ${eye.y1}), nostril (${n.x0}, ${n.y0})–(${n.x1}, ${n.y1}); ${out.verify.detail}`);
        return json(200, { ok: true, results, rois, verify: out.verify });
      } catch (e) {
        return json(e instanceof IdentityMismatch ? 409 : 502, { error: e.message, code: e.code });
      }
    }

    if (action === "breathing" && method === "POST") {
      const bad = cameraOnly(); if (bad) return bad;
      if (await protocolOf(dev) !== "mtrpc")
        return json(400, { error: "this camera's breathing check reads its temperature stream directly (use temps)" });
      const { body, error } = await readBody(req);
      if (error) return error;
      const n = body.nostril;
      if (!n || ![n.x0, n.y0, n.x1, n.y1].every(inRange) || n.x1 <= n.x0 || n.y1 <= n.y0)
        return json(400, { error: "nostril must be {x0, y0, x1, y1} in 0–10000" });
      const seconds = Math.max(20, Math.min(120, Number(body.seconds) || 60));
      try {
        // Same credentials and identity check as every other camera action,
        // before the video is opened.
        await camera(dev, async () => true);
      } catch (e) {
        return json(e instanceof IdentityMismatch ? 409 : 502, { error: e.message, code: e.code });
      }
      const cred = cameraPassword(dev);
      if (cred.error) return json(502, { error: cred.error });
      const job = await startBreathingCheck(dev, cred.password, n, { seconds });
      return json(202, jobView(job));
    }

    if (action === "cooling" && method === "POST") {
      const bad = cameraOnly(); if (bad) return bad;
      if (await protocolOf(dev) !== "mtrpc") return json(400, { error: "the floor cooling test needs the JSON-RPC camera's pixel reads" });
      if (!dev.rois?.floor || dev.rois.stale) return json(409, { error: "draw and save a floor box first (Hardware → calibrate → Floor)" });
      const { body, error } = await readBody(req);
      if (error) return error;
      const minutes = Math.max(3, Math.min(60, Number(body.minutes) || 20));
      try {
        await camera(dev, async () => true);             // credentials + identity, before starting
      } catch (e) {
        return json(e instanceof IdentityMismatch ? 409 : 502, { error: e.message, code: e.code });
      }
      const job = startCoolingTest(dev, (pts) => camera(dev, (c) => c.readPixels(pts)), { minutes });
      event(dev, actorOf(who), "floor cooling test", `started (${minutes} min)`);
      return json(202, coolingView(job));
    }

    if (action === "verification" && method === "POST") {
      const bad = cameraOnly(); if (bad) return bad;
      if (!dev.rois || dev.rois.stale) return json(409, { error: "calibrate the camera first — there is nothing to verify" });
      const { body, error } = await readBody(req);
      if (error) return error;
      const b = body.breathing || {};
      const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
      const bpm = num(b.bpm, 4, 60);
      if (bpm === null) return json(400, { error: "a verification needs a measured breathing rate — the check found no rhythm" });
      const hand = body.handCountBpm === undefined || body.handCountBpm === null || body.handCountBpm === "" ? null : num(Number(body.handCountBpm), 2, 80);
      if (body.handCountBpm && hand === null) return json(400, { error: "the hand count must be breaths per minute (2–80)" });
      // Agreement is decided here, not by the browser.
      const agrees = hand === null ? null : Math.abs(bpm - hand) <= Math.max(3, 0.2 * hand);
      const verification = {
        at: now(), by: actorOf(who),
        breathing: { bpm: Math.round(bpm * 10) / 10, periodicity: num(b.periodicity, 0, 1), seconds: num(b.seconds, 1, 600), samples: num(b.samples, 1, 10000) },
        handCountBpm: hand, agrees,
        eyeC: num(body.eyeC, -20, 100), nostrilSwingC: num(body.nostrilSwingC, 0, 50),
        roisAt: dev.rois.pushedAt,
      };
      store.update("devices", dev.id, { verification });
      event(dev, actorOf(who), agrees === false ? "verification disagrees" : "verified",
        `breathing ${verification.breathing.bpm} bpm` + (hand === null ? " (no hand count)" : `, hand count ${hand} bpm`) +
        (verification.eyeC !== null ? `, eye ${verification.eyeC} °C` : ""));
      return json(200, verification);
    }

    return json(405, { error: "method not allowed" });
  }

  // ---- alerts for hardware that stopped working --------------------------- //
  function deviceAlerts(isAcked) {
    const all = list();
    const horseName = (id) => store.list("horses").find((h) => h.id === id)?.name ?? id;
    const day = now().slice(0, 10);
    const out = [];
    for (const d of all) {
      const s = deviceStatus(d, all);
      let type = null, detail = "";
      if (d.kind === "edge_box" && s.state === "offline") { type = "Edge box offline"; detail = `"${d.name}" has not checked in — every device it polls is dark. ${s.detail}.`; }
      else if (s.state === "error") { type = "Device error"; detail = `${d.name}: ${s.detail}`; }
      else if (s.state === "stale" || ((d.kind === "push_device" || d.kind === "wearable_hub") && s.state === "silent")) {
        type = "Device not reporting";
        const where = d.kind === "wearable_hub" ? `on ${horseName(d.horseId)}` : `stall ${d.stall || "—"}`;
        detail = `${d.name} (${where}): ${s.detail}.`;
      }
      if (!type) continue;
      const id = `device:${d.id}:${type}:${day}`;
      out.push({ id, horse: d.name, type, severity: "warn", time: "now", detail, acknowledged: isAcked(id), device: true });
    }
    return out;
  }

  return { migrate, handleEdge, handleDevices, attribute, deviceByToken, deviceByTokenHash, anyDeviceTokens, deviceAlerts };
}
