// Cameras a stable already owns: the stream address for each make, ONVIF to
// find it on others, a pasted address (its password sealed, never stored in
// the path), what the edge box is told, and no temperature accepted from a
// camera that has no thermal sensor.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathsFor, parseRtspUrl, judgeStreams, onvifStreams, chooseStreams, safeAddress, rtspUrl } from "./ip-camera.mjs";

test("the usual stream address for each make and channel", () => {
  assert.deepEqual(pathsFor("hikvision", 1), { rtspPath: "/Streaming/Channels/102", rtspPathMain: "/Streaming/Channels/101" });
  assert.deepEqual(pathsFor("hikvision", 4), { rtspPath: "/Streaming/Channels/402", rtspPathMain: "/Streaming/Channels/401" });
  assert.equal(pathsFor("dahua", 2).rtspPath, "/cam/realmonitor?channel=2&subtype=1");
  assert.equal(pathsFor("uniview", 1).rtspPathMain, "/unicast/c1/s0/live");
  assert.equal(pathsFor("tapo", 1).rtspPath, "/stream2");
  assert.equal(pathsFor("reolink", 1).rtspPathMain, "/h264Preview_01_main");
  assert.equal(pathsFor("onvif", 1), null);
});

test("a pasted address: host, port, path; the password taken out of it", () => {
  assert.deepEqual(parseRtspUrl("rtsp://admin:p%40ss@192.168.1.64:8554/Streaming/Channels/102?transportmode=unicast"),
    { host: "192.168.1.64", port: 8554, path: "/Streaming/Channels/102?transportmode=unicast", username: "admin", password: "p@ss" });
  assert.match(parseRtspUrl("http://192.168.1.64/").error, /rtsp:\/\//);
  assert.match(parseRtspUrl("not a url").error, /RTSP address/);
  const dev = { host: "fe80::1", rtspPort: 554, username: "admin" };
  assert.equal(safeAddress(dev, "/s"), "rtsp://[fe80::1]:554/s", "no password in messages");
  assert.equal(rtspUrl(dev, "a b", "/s"), "rtsp://admin:a%20b@[fe80::1]:554/s");
});

test("what the picture is good for", () => {
  assert.equal(judgeStreams({ codec: "h264", width: 640, height: 360, fps: 12 }, null).ok, true);
  const small = judgeStreams({ codec: "h264", width: 176, height: 144, fps: 12 }, null);
  assert.equal(small.ok, false);
  assert.match(small.lines.join(" "), /Too small/);
  assert.match(judgeStreams({ codec: "h264", width: 640, height: 360, fps: 2 }, null).lines.join(" "), /Too few frames/);
  assert.equal(judgeStreams({ error: "the camera refused the username or password" }, null).lines[0], "the camera refused the username or password");
});

test("ONVIF: the streams, the largest for stills and a 640-wide one to analyse", async () => {
  const answers = {
    GetSystemDateAndTime: "<tt:UTCDateTime><tt:Date><tt:Year>2026</tt:Year><tt:Month>10</tt:Month><tt:Day>4</tt:Day></tt:Date><tt:Time><tt:Hour>12</tt:Hour><tt:Minute>0</tt:Minute><tt:Second>0</tt:Second></tt:Time></tt:UTCDateTime>",
    GetCapabilities: "<tt:Media><tt:XAddr>http://10.0.0.5/onvif/Media</tt:XAddr></tt:Media>",
    GetProfiles: ["Profile_1:2560:1440", "Profile_2:704:576", "Profile_3:352:288"].map((p) => { const [t, w, h] = p.split(":");
      return `<trt:Profiles token="${t}"><tt:Name>${t}</tt:Name><tt:VideoEncoderConfiguration><tt:Encoding>H264</tt:Encoding><tt:Resolution><tt:Width>${w}</tt:Width><tt:Height>${h}</tt:Height></tt:Resolution></tt:VideoEncoderConfiguration></trt:Profiles>`; }).join(""),
  };
  const post = async (path, body) => {
    const op = Object.keys(answers).find((k) => body.includes(`:${k}`)) ?? (body.includes("GetStreamUri") ? "GetStreamUri" : null);
    if (op === "GetStreamUri") {
      const t = body.match(/<trt:ProfileToken>([^<]+)</)[1];
      return { status: 200, raw: `<trt:MediaUri><tt:Uri>rtsp://10.0.0.5:554/Streaming/Channels/${t.slice(-1)}01</tt:Uri></trt:MediaUri>` };
    }
    return { status: 200, raw: `<s:Body>${answers[op] ?? ""}</s:Body>` };
  };
  const list = await onvifStreams({ host: "10.0.0.5", password: "x", post });
  assert.deepEqual(list.map((s) => [s.width, s.path]), [[2560, "/Streaming/Channels/101"], [704, "/Streaming/Channels/201"], [352, "/Streaming/Channels/301"]]);
  assert.deepEqual(chooseStreams(list), { rtspPath: "/Streaming/Channels/201", rtspPathMain: "/Streaming/Channels/101", rtspPort: 554 });
});

// ---- through the server ------------------------------------------------------- //
const DATA = mkdtempSync(join(tmpdir(), "equicare-ipcam-"));
let handle;
const tok = {};
const call = async (method, path, { token, body } = {}) => {
  const res = await handle(new Request(`http://local${path}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
};
const admin = (m, p, body) => call(m, p, { token: tok.admin, body });
before(async () => {
  process.env.EQUICARE_DATA_DIR = DATA;
  process.env.EQUICARE_SAMPLE_HORSES = "1";
  process.env.ADMIN_PASSWORD = "test-admin-pw";
  process.env.EQUICARE_NOTIFY_TICK_MS = "0";
  delete process.env.DATABASE_URL;
  delete process.env.AUTH_INGEST_TOKEN;
  ({ handle } = await import("./app.mjs"));
  tok.admin = (await call("POST", "/auth/login", { body: { username: "admin", password: "test-admin-pw" } })).body.token;
  const e = await admin("POST", "/api/devices", { kind: "edge_box", name: "Barn edge" });
  tok.edge = e.body.token; tok.edgeId = e.body.device.id;
});
after(() => rmSync(DATA, { recursive: true, force: true }));

test("an NVR channel and a pasted address; what the edge box is told; nothing thermal accepted", async () => {
  const hik = await admin("POST", "/api/devices", { kind: "ip_camera", name: "Stall A-04 CCTV", make: "hikvision", channel: 3,
    host: "192.168.1.20", password: "nvr-secret", stall: "A-04", edgeId: tok.edgeId, record: true });
  assert.equal(hik.status, 201, JSON.stringify(hik.body));
  assert.equal(hik.body.device.rtspPath, "/Streaming/Channels/302");
  assert.equal(hik.body.device.hasPassword, true);
  assert.equal(hik.body.device.passwordEnc, undefined);
  // the same NVR channel twice: refused; another channel of the NVR: fine
  const dup = await admin("POST", "/api/devices", { kind: "ip_camera", name: "dup", make: "hikvision", channel: 3, host: "192.168.1.20", stall: "B-01" });
  assert.equal(dup.status, 400);
  assert.match(dup.body.details.join(" "), /already registered/);
  const pasted = await admin("POST", "/api/devices", { kind: "ip_camera", name: "Stall B-01 camera", make: "custom",
    rtspUrl: "rtsp://viewer:pa%24%24@192.168.1.77:8554/live/ch1", stall: "B-01", edgeId: tok.edgeId });
  assert.equal(pasted.status, 201, JSON.stringify(pasted.body));
  assert.deepEqual([pasted.body.device.host, pasted.body.device.rtspPort, pasted.body.device.rtspPath, pasted.body.device.username],
    ["192.168.1.77", 8554, "/live/ch1", "viewer"]);
  await new Promise((res) => setTimeout(res, 400));          // the JSON store debounces writes
  const onDisk = readFileSync(join(DATA, "state.json"), "utf8");
  assert.ok(!onDisk.includes("pa$$") && !onDisk.includes("nvr-secret"), "passwords are sealed, never stored plain");

  const cfg = (await call("GET", "/edge/config", { token: tok.edge })).body.devices;
  const c = cfg.find((d) => d.id === hik.body.device.id);
  assert.deepEqual([c.kind, c.protocol, c.rtspPath, c.rtspPathMain, c.password, c.record, c.configError],
    ["ip_camera", "rtsp", "/Streaming/Channels/302", "/Streaming/Channels/301", "nvr-secret", true, null]);
  assert.equal(cfg.find((d) => d.id === pasted.body.device.id).password, "pa$$");

  const r = await call("POST", "/ingest/readings", { token: tok.edge, body: { readings: [
    { deviceId: c.id, metric: "activity_index", value: 0.3, source: "thermal_camera" },
    { deviceId: c.id, metric: "body_temp_c", value: 38.1 },
  ] } });
  assert.equal(r.body.accepted, 1);
  assert.match(JSON.stringify(r.body.rejections), /no thermal sensor/);
  const s = await admin("GET", "/api/session?horse=zarina");
  assert.equal(s.body.points.find((p) => p.n === 1).summary, "Not measured on this stall — its camera has no thermal sensor (eye temperature needs one).");
});

test("ONVIF make: no stream until found; colour boxes only", async () => {
  const o = await admin("POST", "/api/devices", { kind: "ip_camera", name: "Stall C-02 camera", make: "onvif", host: "192.168.1.90", password: "x", stall: "C-02", edgeId: tok.edgeId });
  assert.equal(o.status, 201);
  const cfg = (await call("GET", "/edge/config", { token: tok.edge })).body.devices.find((d) => d.id === o.body.device.id);
  assert.match(cfg.configError, /Find the stream/);
  assert.equal((await admin("POST", `/api/devices/${o.body.device.id}/probe`)).status, 409);
  await admin("PATCH", `/api/devices/${o.body.device.id}`, { rtspPath: "/h264/ch1/sub/av_stream", rtspPathMain: "/h264/ch1/main/av_stream" });
  const bad = await admin("PUT", `/api/devices/${o.body.device.id}/rois`, { hay: { x0: 0, y0: 0, x1: 10, y1: 10 } });
  assert.equal(bad.status, 400);
  const ok = await admin("PUT", `/api/devices/${o.body.device.id}/rois`, { hay: { x0: 1000, y0: 6000, x1: 3000, y1: 9000 }, flank: null });
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(ok.body.rois).sort(), ["hay", "pushedAt"]);
  const cfg2 = (await call("GET", "/edge/config", { token: tok.edge })).body.devices.find((d) => d.id === o.body.device.id);
  assert.equal(cfg2.rtspPath, "/h264/ch1/sub/av_stream");
  assert.deepEqual(cfg2.rois.hay, { x0: 1000, y0: 6000, x1: 3000, y1: 9000 });
});
