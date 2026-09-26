// Recorded footage and labels: listing and pairing clips, serving video with
// seeking, the video ticket, access for owners, and the labels themselves.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATA = mkdtempSync(join(tmpdir(), "equicare-footage-data-"));
const REC = mkdtempSync(join(tmpdir(), "equicare-footage-rec-"));
let handle, footage;
const tokens = {};

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await handle(new Request(`http://local${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }));
  const type = res.headers.get("content-type") || "";
  const raw = type.includes("json") || type.includes("csv") ? await res.text() : null;
  return { status: res.status, res, raw, body: type.includes("json") && raw ? JSON.parse(raw) : null };
}
const admin = (m, p, body) => call(m, p, { token: tokens.admin, body });

function clip(cam, stream, start, bytes = 1000) {
  const dir = join(REC, cam, stream);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `${start}.mp4`);
  writeFileSync(f, Buffer.alloc(bytes, stream === "thermal" ? 1 : 2));
  const old = new Date(Date.now() - 3600 * 1000);
  utimesSync(f, old, old);                                     // finished clips
  return f;
}

before(async () => {
  process.env.EQUICARE_DATA_DIR = DATA;
  process.env.EQUICARE_RECORDINGS_DIR = REC;
  process.env.ADMIN_PASSWORD = "test-admin-pw";
  delete process.env.DATABASE_URL;
  ({ handle } = await import("./app.mjs"));
  footage = await import("./footage.mjs");
  tokens.admin = (await call("POST", "/auth/login", { body: { username: "admin", password: "test-admin-pw" } })).body.token;
  for (const [role, extra] of [["staff", {}], ["owner", { owner: "Bharat Sports Venture" }]]) {
    await admin("POST", "/api/users", { username: role, password: "pw-" + role, role, name: role, ...extra });
    tokens[role] = (await call("POST", "/auth/login", { body: { username: role, password: "pw-" + role } })).body.token;
  }
  // Two clips per stream; the visible ones start a second or two off, as on the camera.
  clip("cam1", "thermal", "2026-09-26T16-40-00", 5000);
  clip("cam1", "visible", "2026-09-26T16-40-01", 7000);
  clip("cam1", "thermal", "2026-09-26T16-50-00");
  clip("cam1", "visible", "2026-09-26T16-49-59");
  clip("cam1", "thermal", "2026-09-26T17-00-00");              // its visible partner is missing
});
after(() => { rmSync(DATA, { recursive: true, force: true }); rmSync(REC, { recursive: true, force: true }); });

test("clips of the two streams pair up when they start within seconds; a lone one stays", () => {
  const clips = footage.listClips(REC);
  assert.equal(clips.length, 3);
  const [c17, c1650, c1640] = clips;                           // newest first
  assert.equal(c1640.thermal.start, "2026-09-26T16-40-00");
  assert.equal(c1640.visible.start, "2026-09-26T16-40-01");
  assert.equal(c1650.visible.start, "2026-09-26T16-49-59");
  assert.equal(c17.visible, null);
  assert.equal(c1640.end, c1650.at, "a clip ends where the next begins");
});

test("only real clip names resolve — no path tricks", () => {
  assert.ok(footage.clipPath("cam1", "thermal", "2026-09-26T16-40-00", REC));
  assert.equal(footage.clipPath("../etc", "thermal", "2026-09-26T16-40-00", REC), null);
  assert.equal(footage.clipPath("cam1", "thermal", "../../x", REC), null);
  assert.equal(footage.clipPath("cam1", "audio", "2026-09-26T16-40-00", REC), null);
  assert.equal(footage.clipPath("cam1", "thermal", "2026-09-26T09-00-00", REC), null);
});

test("video needs a ticket; with one it plays and seeks (range requests)", async () => {
  const url = "/api/footage/video/cam1/thermal/2026-09-26T16-40-00";
  assert.equal((await call("GET", url)).status, 401);
  assert.equal((await call("GET", `${url}?vt=forged`)).status, 401);
  const t = (await admin("GET", "/api/footage/ticket")).body.ticket;
  const full = await call("GET", `${url}?vt=${t}`);
  assert.equal(full.status, 200);
  assert.equal(full.res.headers.get("content-length"), "5000");
  const part = await call("GET", `${url}?vt=${t}`, { headers: { Range: "bytes=100-199" } });
  assert.equal(part.status, 206);
  assert.equal(part.res.headers.get("content-range"), "bytes 100-199/5000");
  assert.equal((await part.res.arrayBuffer()).byteLength, 100);
  assert.equal((await call("GET", `/api/footage/video/cam1/thermal/2026-09-26T09-00-00?vt=${t}`)).status, 404);
});

test("owners cannot see footage or labels; staff can label", async () => {
  assert.equal((await call("GET", "/api/footage", { token: tokens.owner })).status, 404);
  assert.equal((await call("GET", "/api/footage/ticket", { token: tokens.owner })).status, 404);
  assert.equal((await call("GET", "/api/footage", { token: tokens.staff })).status, 200);
  const r = await call("POST", "/api/footage/labels", { token: tokens.staff, body: { camera: "cam1", label: "urinating", startAt: "2026-09-26T11:12:00.000Z" } });
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.body.by, "staff");
});

test("labels are validated, listed by time, exported, and deletable", async () => {
  const bad = await admin("POST", "/api/footage/labels", { camera: "cam1", label: "flying", startAt: "nope" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.details.length, 2);
  assert.equal((await admin("POST", "/api/footage/labels", { camera: "cam1", label: "lying", startAt: "2026-09-26T11:20:00Z", endAt: "2026-09-26T11:10:00Z" })).status, 400);
  assert.equal((await admin("POST", "/api/footage/labels", { camera: "cam1", label: "other", startAt: "2026-09-26T11:20:00Z" })).status, 400, "'other' needs a note");
  const lying = await admin("POST", "/api/footage/labels", { camera: "cam1", label: "lying", startAt: "2026-09-26T11:10:00Z", endAt: "2026-09-26T11:25:30Z" });
  assert.equal(lying.status, 201);
  const moment = await admin("POST", "/api/footage/labels", { camera: "cam1", label: "defecating", startAt: "2026-09-26T11:30:00Z", endAt: "2026-09-26T11:31:00Z" });
  assert.equal(moment.body.endAt, null, "a moment has no end");
  const list = (await admin("GET", "/api/footage/labels?camera=cam1")).body;
  assert.deepEqual(list.map((l) => l.label), ["lying", "urinating", "defecating"]);
  const csv = await admin("GET", "/api/footage/labels/export");
  assert.match(csv.res.headers.get("content-type"), /text\/csv/);
  assert.match(csv.raw, /^id,camera,horse,label,start_at,end_at,duration_s/);
  assert.match(csv.raw, /lying,2026-09-26T11:10:00.000Z,2026-09-26T11:25:30.000Z,930,/);
  assert.equal((await admin("DELETE", `/api/footage/labels/${lying.body.id}`)).status, 200);
  assert.equal((await admin("GET", "/api/footage/labels?camera=cam1")).body.length, 2);
});

test("the footage list carries camera names and label counts", async () => {
  const r = await admin("GET", "/api/footage");
  assert.equal(r.status, 200);
  assert.equal(r.body.clips.length, 3);
  assert.equal(r.body.cameras[0].id, "cam1");
  assert.equal((await admin("GET", "/api/footage/labels/meta")).body.find((l) => l.key === "lying").kind, "interval");
});
