// One camera, several stalls, zooming in on each horse: the setup is checked,
// the edge box gets it with each stall's horse, and each reading lands on the
// horse in the stall it names (only stalls that camera watches).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OnvifPtz, validateViews, stallsOf, envelope } from "./onvif-ptz.mjs";

const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const SETUP = () => ({
  ptz: { protocol: "onvif", port: 80 },
  schedule: { closeEveryMin: 5 },
  views: [
    { id: "wide", kind: "wide", position: { moves: [{ profile: "Profile_1", preset: "1" }, { profile: "Profile_2", preset: "1" }] },
      zones: [{ stall: "A-04", colour: box(0, 0, 5000, 10000), thermal: box(0, 0, 5000, 10000), rois: { hay: box(500, 6000, 2500, 8000) } },
              { stall: "B-01", colour: box(5000, 0, 10000, 10000), thermal: box(5000, 0, 10000, 10000) }] },
    { id: "close:A-04", kind: "close", stall: "A-04", position: { moves: [{ profile: "Profile_1", preset: "2" }, { profile: "Profile_2", zoom: 0.8 }], settleS: 3 },
      rois: { eye: box(4000, 3000, 5000, 3800), nostril: box(4500, 7000, 5500, 8000) } },
  ],
});

// ---- the setup --------------------------------------------------------------- //
test("a complete setup passes; each stall's boxes and the positions are kept", () => {
  const { out, errs } = validateViews(SETUP(), "2026-10-04T00:00:00Z");
  assert.deepEqual(errs, []);
  assert.deepEqual(out.views[0].zones.map((z) => z.stall), ["A-04", "B-01"]);
  assert.deepEqual(out.views[0].zones[0].rois.hay, box(500, 6000, 2500, 8000));
  assert.equal(out.views[1].position.moves[1].zoom, 0.8);
  assert.equal(out.views[1].position.settleS, 3);
  assert.equal(out.views[0].pushedAt, "2026-10-04T00:00:00Z");
  assert.deepEqual(stallsOf({ stall: "A-04", ...out }), ["A-04", "B-01"]);
});

test("incomplete or unsafe setups are refused, saying what is missing", () => {
  const e = (mut) => { const s = SETUP(); mut(s); return validateViews(s).errs.join(" | "); };
  assert.match(e((s) => { s.views = s.views.filter((v) => v.kind !== "wide"); }), /exactly one wide view/);
  assert.match(e((s) => { s.views[0].zones[1].stall = "A-04"; }), /drawn twice/);
  assert.match(e((s) => { delete s.views[0].zones[1].colour; }), /draw stall B-01 on the colour picture/);
  assert.match(e((s) => { s.views[1].stall = "C-02"; s.views[1].id = "close:C-02"; }), /not drawn on the wide view/);
  assert.match(e((s) => { s.views[1].rois = {}; }), /draw the eye and\/or the nostril/);
  assert.match(e((s) => { s.views[1].rois.eye = box(0, 0, 6000, 6000); }), /eye box is too large/);
  assert.match(e((s) => { s.views[1].position = { moves: [] }; }), /save the camera's position/);
  assert.match(e((s) => { s.ptz = { protocol: "none" }; }), /close-ups need a camera that zooms/);
  assert.match(e((s) => { s.schedule.closeEveryMin = 1; }), /2–120 minutes/);
  assert.match(e((s) => { s.views[0].zones[0].colour = box(5000, 0, 4000, 10000); }), /x1>x0/);
});

test("a fixed (non-zoom) camera seeing two stalls needs no positions", () => {
  const s = SETUP();
  s.ptz = { protocol: "none" };
  s.views = [s.views[0]];
  delete s.views[0].position;
  assert.deepEqual(validateViews(s).errs, []);
});

// ---- ONVIF ------------------------------------------------------------------- //
test("ONVIF: the camera's clock stamps the digest; presets, moves and refusals", async () => {
  const sent = [];
  const answers = {
    GetSystemDateAndTime: "<tt:UTCDateTime><tt:Date><tt:Year>2026</tt:Year><tt:Month>7</tt:Month><tt:Day>2</tt:Day></tt:Date><tt:Time><tt:Hour>10</tt:Hour><tt:Minute>0</tt:Minute><tt:Second>0</tt:Second></tt:Time></tt:UTCDateTime>",
    GetCapabilities: "<tt:Media><tt:XAddr>http://10.0.0.5/onvif/media_service</tt:XAddr></tt:Media><tt:PTZ><tt:XAddr>http://10.0.0.5/onvif/ptz_service</tt:XAddr></tt:PTZ>",
    GetProfiles: '<trt:Profiles token="Profile_1"><tt:Name>colour</tt:Name><tt:VideoSourceConfiguration><tt:SourceToken>v1</tt:SourceToken></tt:VideoSourceConfiguration><tt:PTZConfiguration token="p"/></trt:Profiles>'
      + '<trt:Profiles token="Profile_2"><tt:Name>thermal</tt:Name><tt:VideoSourceConfiguration><tt:SourceToken>v2</tt:SourceToken></tt:VideoSourceConfiguration></trt:Profiles>',
    SetPreset: "<tptz:PresetToken>7</tptz:PresetToken>",
    GotoPreset: "",
    GetStatus: '<tptz:PTZStatus><tt:Position><tt:PanTilt x="0.1" y="-0.2"/><tt:Zoom x="0.5"/></tt:Position><tt:MoveStatus><tt:PanTilt>IDLE</tt:PanTilt></tt:MoveStatus></tptz:PTZStatus>',
  };
  const p = new OnvifPtz({ host: "10.0.0.5", password: "pw", post: async (path, body) => {
    const op = body.match(/<s:Body><(?:\w+:)?(\w+)/)[1];
    sent.push({ path, op, body });
    if (op === "GotoPreset" && body.includes(">bad<")) return { status: 400, raw: "<s:Envelope><s:Body><s:Fault><s:Reason><s:Text>No such preset</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>" };
    return { status: 200, raw: `<s:Envelope><s:Body>${answers[op] ?? ""}</s:Body></s:Envelope>` };
  } });
  const profiles = await p.profiles();
  assert.deepEqual(profiles.map((x) => [x.token, x.name, x.ptz, x.source]), [["Profile_1", "colour", true, "v1"], ["Profile_2", "thermal", false, "v2"]]);
  assert.equal(sent[0].op, "GetSystemDateAndTime");
  assert.ok(!sent[0].body.includes("UsernameToken"), "the clock is asked for without a login");
  const created = sent[1].body.match(/<Created[^>]*>([^<]+)</)[1];
  assert.match(created, /^2026-07-02T10:00/, "the digest is stamped with the camera's clock, not ours");
  assert.equal(sent.find((s) => s.op === "GetProfiles").path, "/onvif/media_service");
  assert.equal(await p.savePreset("Profile_1", "EquiCare wide"), "7");
  await p.gotoPreset("Profile_1", "7");
  assert.equal(sent.at(-1).path, "/onvif/ptz_service");
  await assert.rejects(p.gotoPreset("Profile_1", "bad"), /camera refused: No such preset/);
  assert.deepEqual(await p.status("Profile_1"), { pan: 0.1, tilt: -0.2, zoom: 0.5, moving: false });
  assert.match(envelope("<x/>", "admin", "pw"), /PasswordDigest">[A-Za-z0-9+/=]{28}</);
});

// ---- the server ---------------------------------------------------------------- //
const DATA = mkdtempSync(join(tmpdir(), "equicare-zoom-"));
let handle;
const tokens = {}, ids = {};
const call = async (method, path, { token, body } = {}) => {
  const res = await handle(new Request(`http://local${path}`, { method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
};
const admin = (m, p, body) => call(m, p, { token: tokens.admin, body });

before(async () => {
  process.env.EQUICARE_DATA_DIR = DATA;
  process.env.ADMIN_PASSWORD = "test-admin-pw";
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.AUTH_INGEST_TOKEN;
  ({ handle } = await import("./app.mjs"));
  tokens.admin = (await call("POST", "/auth/login", { body: { username: "admin", password: "test-admin-pw" } })).body.token;
  const e = await admin("POST", "/api/devices", { kind: "edge_box", name: "Barn edge" });
  tokens.edge = e.body.token; ids.edge = e.body.device.id;
  const c = await admin("POST", "/api/devices", { kind: "thermal_camera", name: "Zoom camera", stall: "A-04", host: "127.0.0.1", httpPort: 18080,
    username: "admin", password: "cam-secret-123", variant: "640", thermalLens: "25", visibleLens: "4", distanceM: 3.5, emissivity: 0.98, edgeId: ids.edge });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  ids.cam = c.body.device.id;
});
after(() => rmSync(DATA, { recursive: true, force: true }));

test("views are saved on the camera and refused when incomplete", async () => {
  const bad = await admin("PUT", `/api/devices/${ids.cam}/views`, { ...SETUP(), schedule: { closeEveryMin: 0 } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.details.join(" "), /2–120/);
  const ok = await admin("PUT", `/api/devices/${ids.cam}/views`, SETUP());
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const got = (await admin("GET", `/api/devices/${ids.cam}/views`)).body;
  assert.deepEqual(got.stalls, ["A-04", "B-01"]);
  assert.equal(got.views.length, 2);
});

test("the edge box gets the views, the zoom and the horse in each stall", async () => {
  const cfg = (await call("GET", "/edge/config", { token: tokens.edge })).body;
  const d = cfg.devices.find((x) => x.id === ids.cam);
  assert.equal(d.views.length, 2);
  assert.equal(d.ptz.protocol, "onvif");
  assert.deepEqual(d.schedule, { closeEveryMin: 5 });
  assert.deepEqual(d.stallHorses, { "A-04": { id: "zarina", name: "Zarina" }, "B-01": { id: "shaan", name: "Shaan" } });
});

test("each reading goes to the horse in the stall it names — only a stall the camera watches", async () => {
  const r = await call("POST", "/ingest/readings", { token: tokens.edge, body: { readings: [
    { deviceId: ids.cam, stallId: "B-01", metric: "activity_index", value: 0.42, source: "visible_video", meta: { view: "wide" } },
    { deviceId: ids.cam, stallId: "A-04", metric: "activity_index", value: 0.07, source: "visible_video", meta: { view: "wide" } },
    { deviceId: ids.cam, stallId: "A-04", metric: "body_temp_c", value: 37.4, source: "thermal_camera", meta: { view: "close" } },
    { deviceId: ids.cam, stallId: "B-01", metric: "body_temp_c", value: 37.9, source: "thermal_camera", meta: { view: "close" } },
    { deviceId: ids.cam, stallId: "C-02", metric: "activity_index", value: 0.99, source: "visible_video", ts: new Date(Date.now() + 1000).toISOString() },
  ] } });
  assert.equal(r.body.accepted, 5, JSON.stringify(r.body));
  const zarina = (await admin("GET", "/api/horses/zarina")).body, shaan = (await admin("GET", "/api/horses/shaan")).body;
  const raja = (await admin("GET", "/api/horses/raja")).body;
  assert.equal(shaan.vitals.activity_index.value, 0.42);
  assert.equal(zarina.vitals.activity_index.value, 0.99, "a stall the camera does not watch (C-02, Raja's) falls back to its own stall");
  assert.notEqual(raja.vitals?.activity_index?.value, 0.99);
  assert.equal(zarina.vitals.body_temp_c.calibrated, true, "A-04 has a close-up with an eye box");
  assert.equal(shaan.vitals.body_temp_c.calibrated, false, "B-01 has no close-up: an eye reading for it is not aimed");
});
