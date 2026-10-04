// Each horse's own normal, events with a verdict a vet can confirm, the
// accuracy kit, the setup checklist and gait checks entered by hand.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dailyValues, compare, validateBaseline, dayStart } from "./baseline.mjs";
import { buildEvents, agreement, labelFor, validateCheck, clipFilters } from "./events.mjs";
import { judge } from "./setup-check.mjs";

const H = 3600e3;
const DAY0 = Date.UTC(2026, 8, 1, 12);                   // noon UTC, 1 Sep
const tb = (t, s) => ({ metric: "time_budget", value: 60, ts: new Date(t).toISOString(), meta: s, horseId: "zarina" });
const R = (metric, value, t, meta = {}, extra = {}) => ({ metric, value, ts: new Date(t).toISOString(), meta, horseId: "zarina", ...extra });

/** n days of minute-by-minute time budget (lying share lie), breathing br. */
function days(n, { lie = 0.1, br = 12, eye = 35.5, start = DAY0 } = {}) {
  const out = [];
  for (let d = 0; d < n; d++) for (let m = 0; m < 24 * 60; m += 10) {
    const t = start + d * 24 * H + m * 60e3;
    out.push(tb(t, { lyingS: 600 * lie, eatingS: 600 * 0.3, restingS: 600 * (0.6 - lie), movingS: 600 * 0.1, unseenS: 0 }));
    if (m % 60 === 0) { out.push(R("respiratory_rate_bpm", br, t)); out.push(R("body_temp_c", eye, t, { calibrated: true })); }
  }
  return out;
}

// ---- baseline ------------------------------------------------------------ //
test("days run noon to noon, so a night is never cut in two", () => {
  const t = Date.UTC(2026, 9, 1, 20, 0);                 // 1 Oct 20:00 UTC = 2 Oct 01:30 IST
  assert.equal(new Date(dayStart(t, "Asia/Kolkata")).toISOString(), "2026-10-01T06:30:00.000Z");
  assert.equal(new Date(dayStart(Date.UTC(2026, 9, 1, 13), "UTC")).toISOString(), "2026-10-01T12:00:00.000Z");
});

test("the first 3 days are the normal; a later day is compared with it", () => {
  const rd = [...days(3), ...days(1, { lie: 0.2, br: 16, eye: 37.0, start: DAY0 + 3 * 24 * H })];
  const c = compare({ id: "zarina" }, rd, { tz: "UTC" });
  assert.equal(c.learning, false);
  assert.equal(c.baselineDays, 3);
  const row = Object.fromEntries(c.rows.map((r) => [r.key, r]));
  assert.equal(row.lying.baseline, 10);
  assert.equal(row.lying.recent, 20);
  assert.equal(row.lying.notable, true, "lying doubled");
  assert.equal(row.breathing.change, 4);
  assert.equal(row.breathing.notable, true);
  assert.equal(row.eye.change, 1.5);
  assert.equal(row.eye.notable, true);
  assert.equal(row.eating.notable, false, "eating unchanged");
});

test("a vet's chosen baseline replaces the first days; a session inside it is not compared with itself", () => {
  const rd = days(5);
  const set = { id: "zarina", baseline: { from: new Date(DAY0 + 2 * 24 * H).toISOString(), to: new Date(DAY0 + 4 * 24 * H).toISOString() } };
  const c = compare(set, rd, { tz: "UTC", from: DAY0 + 2 * 24 * H + H, to: DAY0 + 3 * 24 * H });
  assert.equal(c.window.set, true);
  assert.equal(c.baselineDays, 2);
  assert.equal(c.sameAsBaseline, true);
  assert.deepEqual(validateBaseline({ from: "2026-09-01", to: "2026-09-01T06:00Z" }).errs, ["a baseline needs at least 12 hours"]);
  assert.deepEqual(validateBaseline({ reset: true }), { baseline: null, errs: [] });
});

test("too little data: still learning", () => {
  assert.equal(compare({ id: "x" }, [], { tz: "UTC" }).learning, true);
  assert.equal(dailyValues([], "UTC").length, 0);
});

// ---- events ---------------------------------------------------------------- //
test("events carry a verdict, what to do, and the guide entry; repeated lying down is flagged for the vet", () => {
  const t = DAY0;
  const rd = [
    R("posture_event", 1, t, { kind: "lie_down", deviceId: "cam" }),
    R("posture_event", 1, t + 5 * 60e3, { kind: "get_up", deviceId: "cam" }),
    R("posture_event", 1, t + 15 * 60e3, { kind: "lie_down", deviceId: "cam" }),
    R("posture_event", 1, t + 30 * 60e3, { kind: "lie_down", deviceId: "cam" }),
    R("vice_event", 1, t + 2 * H, { kind: "weaving", deviceId: "cam" }),
    R("excretion_event", 1, t + 3 * H, { deviceId: "cam" }),
    R("respiratory_rate_bpm", 26, t + 4 * H, { deviceId: "cam" }),
    R("body_temp_c", 37.2, t + 5 * H, { deviceId: "cam", calibrated: true }),
    R("horse_identity", 0.5, t + 6 * H, { deviceId: "cam", verdict: "other", bestName: "Raja", bestScore: 0.9 }),
  ];
  const ev = buildEvents({ id: "zarina", name: "Zarina", stall: "A-04" }, rd, { from: t - H, to: t + 7 * H, eyeBaseline: 35.5 });
  const k = (kind) => ev.filter((e) => e.kind === kind);
  assert.equal(k("down_up").length, 1);
  assert.equal(k("down_up")[0].verdict, "vet");
  assert.equal(ev[0].verdict, "vet", "the most urgent first");
  assert.equal(k("fast_breathing")[0].verdict, "vet", "26 /min");
  assert.equal(k("eye_rise")[0].verdict, "vet", "+1.7 °C on its normal");
  assert.equal(k("weaving")[0].verdict, "watch");
  assert.equal(k("excretion")[0].verdict, "normal");
  assert.equal(k("other_horse")[0].detail, "looks like Raja (0.9)");
  assert.equal(k("lie_down")[0].pattern, "normal_lying");
  assert.ok(ev.every((e) => e.next && e.id));
});

test("a confirmed event becomes a training label; a wrong one does not", () => {
  const ev = { camera: "cam", label: "weaving", at: "2026-09-01T12:00:00Z", horseName: "Zarina", stall: "A-04" };
  assert.equal(labelFor(ev, { verdict: "confirmed", note: "" }, "vet").label, "weaving");
  assert.equal(labelFor(ev, { verdict: "wrong", note: "scratching" }, "vet"), null);
});

test("clips: the horse's stall cut out, a box at what was measured, slow motion", () => {
  const vf = clipFilters({ crop: [0.5, 0, 1, 1], mark: { x: 5000, y: 5000 }, slow: true });
  assert.match(vf, /^crop=iw\*0\.5000:ih\*1\.0000:iw\*0\.5000:ih\*0\.0000,scale=640:-2,drawbox=/);
  assert.match(vf, /setpts=2\.0\*PTS$/);
});

// ---- accuracy kit ------------------------------------------------------------ //
test("agreement: bias and limits for breathing, a confusion table for states", () => {
  assert.equal(validateCheck({ kind: "breathing", at: "2026-09-01T12:00Z", camera: "cam", breaths: 6, seconds: 30 }).check.value, 12);
  assert.match(validateCheck({ kind: "state", at: "x", camera: "cam", state: "flying" }).errs.join(), /at must be.*state must be/);
  const checks = [
    ...[[12, 12], [13, 12], [11, 12], [14, 12]].map(([s, v], i) => ({ kind: "breathing", system: s, value: v, at: `2026-09-0${1 + (i % 2)}T12:00:00Z` })),
    { kind: "state", system: "lying", value: "lying" }, { kind: "state", system: "resting", value: "lying" },
  ];
  const a = agreement(checks);
  assert.equal(a.breathing.n, 4);
  assert.equal(a.breathing.bias, 0.5);
  assert.equal(a.breathing.mae, 1);
  assert.equal(a.breathing.within2, 100);
  assert.equal(a.breathing.nights, 2);
  assert.equal(a.state.agree, 50);
  assert.equal(a.state.table.lying.resting, 1);
});

// ---- setup checklist ----------------------------------------------------------- //
test("setup check: passes with the horse and eye in their boxes, and says what is wrong otherwise", () => {
  const grid = [...Array(40).fill(26), ...Array(24).fill(33)];
  const eyeGrid = Array.from({ length: 144 }, (_, i) => (i === 5 * 12 + 6 ? 36.8 : [4 * 12 + 6, 6 * 12 + 6, 5 * 12 + 5, 5 * 12 + 7].includes(i) ? 36.3 : 32));
  const ok = judge({ grid, eyeGrid, eyeCols: 12, nostril: { avgC: 31 }, eye: { x0: 4000, y0: 3000, x1: 4800, y1: 3600 }, nostrilBox: { x0: 4500, y0: 7000, x1: 5500, y1: 8000 } });
  assert.equal(ok.ready, true, JSON.stringify(ok.items.filter((i) => !i.ok)));
  assert.equal(ok.items.find((i) => i.key === "eye_shape").ok, true);
  const empty = judge({ grid: Array(64).fill(26), eyeGrid: Array(144).fill(26), eyeCols: 12, nostril: { avgC: 26 }, eye: { x0: 4000, y0: 3000, x1: 4800, y1: 3600 }, nostrilBox: { x0: 4500, y0: 7000, x1: 5500, y1: 8000 } });
  assert.equal(empty.ready, false);
  assert.match(empty.items.find((i) => i.key === "horse").detail, /no warm body/);
  assert.match(empty.items.find((i) => i.key === "eye_warm").detail, /too cool/);
  assert.match(empty.items.find((i) => i.key === "nostril").detail, /off the head/);
  const lamp = judge({ grid, eyeGrid: Array(144).fill(55), eyeCols: 12, nostril: { avgC: 31 }, eye: { x0: 0, y0: 0, x1: 900, y1: 900 }, nostrilBox: { x0: 500, y0: 500, x1: 1500, y1: 1500 } });
  assert.match(lamp.items.find((i) => i.key === "eye_warm").detail, /too hot for an eye/);
  assert.equal(lamp.items.find((i) => i.key === "apart").ok, false);
});

// ---- through the server ---------------------------------------------------------- //
const DATA = mkdtempSync(join(tmpdir(), "equicare-insights-"));
let handle;
const tokens = {};
const call = async (method, path, { token = tokens.admin, body } = {}) => {
  const res = await handle(new Request(`http://local${path}`, { method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, raw: text, type: res.headers.get("content-type") };
};
before(async () => {
  process.env.EQUICARE_DATA_DIR = DATA;
  process.env.ADMIN_PASSWORD = "test-admin-pw";
  process.env.EQUICARE_RECORDINGS_DIR = join(DATA, "recordings");
  delete process.env.DATABASE_URL; delete process.env.VERCEL; delete process.env.AUTH_INGEST_TOKEN;
  ({ handle } = await import("./app.mjs"));
  tokens.admin = (await call("POST", "/auth/login", { token: null, body: { username: "admin", password: "test-admin-pw" } })).body.token;
  await call("POST", "/api/users", { body: { username: "own", password: "pw-own", role: "owner", name: "o", owner: "Bharat Sports Venture" } });
  tokens.owner = (await call("POST", "/auth/login", { token: null, body: { username: "own", password: "pw-own" } })).body.token;
});
after(() => rmSync(DATA, { recursive: true, force: true }));

test("a vet sets a horse's baseline; owners cannot", async () => {
  const bad = await call("PUT", "/api/horses/zarina/baseline", { body: { from: "2026-09-01", to: "2026-09-01T03:00:00Z" } });
  assert.equal(bad.status, 400);
  const ok = await call("PUT", "/api/horses/zarina/baseline", { body: { from: "2026-09-01T12:00:00Z", to: "2026-09-04T12:00:00Z" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.window.set, true);
  assert.equal(ok.body.window.from, "2026-09-01T12:00:00.000Z");
  const owner = await call("PUT", "/api/horses/zarina/baseline", { token: tokens.owner, body: { reset: true } });
  assert.ok([403, 404].includes(owner.status));
  const got = await call("GET", "/api/horses/zarina/baseline?tz=Asia/Kolkata");
  assert.equal(got.status, 200);
  assert.equal(got.body.window.set, true);
});

test("a gait check entered by hand shows on the report's lameness point", async () => {
  const bad = await call("POST", "/api/horses/zarina/gait", { body: { tool: "Ouija", grade: "mild" } });
  assert.match(bad.body.details.join(), /tool must be/);
  const r = await call("POST", "/api/horses/zarina/gait", { body: { tool: "RealHorse", grade: "mild", limb: "LH", mm: 9.5, note: "weekly trot-up" } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.metric, "gait_check");
  const rep = await call("POST", "/api/session/report", { body: { horse: "zarina", from: new Date(Date.now() - 2 * H).toISOString(), to: new Date().toISOString(), tz: "Asia/Kolkata" } });
  assert.equal(rep.status, 200);
  assert.match(rep.raw, /Trot-up checked with RealHorse on .*left hind.*9\.5 mm asymmetry/);
});

test("events and reviews go through the server; a confirmed one becomes a training label", async () => {
  const now = Date.now();
  // readings arrive through the legacy ingest (stall -> horse)
  const ing = await call("POST", "/ingest/readings", { token: null, body: { readings: [
    { stallId: "A-04", metric: "vice_event", value: 1, ts: new Date(now - 30 * 60e3).toISOString(), source: "visible_video", meta: { kind: "weaving" } },
  ] } });
  assert.equal(ing.status, 200, JSON.stringify(ing.body));
  const list = await call("GET", `/api/events?horse=zarina&from=${new Date(now - 2 * H).toISOString()}`);
  assert.equal(list.status, 200);
  const w = list.body.find((e) => e.kind === "weaving");
  assert.ok(w, JSON.stringify(list.body.map((e) => e.kind)));
  assert.equal(w.video, false, "nothing recorded in this test");
  const wrong = await call("POST", `/api/events/${w.id}/review`, { body: { horse: "zarina", at: w.at, verdict: "wrong" } });
  assert.match(wrong.body.details.join(), /say what it really was/);
  const ok = await call("POST", `/api/events/${w.id}/review`, { body: { horse: "zarina", at: w.at, verdict: "confirmed" } });
  assert.equal(ok.status, 200);
  const again = (await call("GET", `/api/events?horse=zarina&from=${new Date(now - 2 * H).toISOString()}`)).body.find((e) => e.id === w.id);
  assert.equal(again.review.verdict, "confirmed");
  assert.equal(ok.body.trainingLabel, false, "a reading without a camera cannot be a footage label");
  const csv = await call("GET", "/api/events/reviews/export");
  assert.match(csv.raw, /weaving,.*confirmed/);
  assert.equal((await call("GET", "/api/events", { token: tokens.owner })).status, 404, "stall events are for the yard's people");
});

test("accuracy checks are stored with the system's own value and reported", async () => {
  const at = new Date(Date.now() - 10 * 60e3).toISOString();
  await call("POST", "/ingest/readings", { token: null, body: { readings: [{ stallId: "A-04", metric: "respiratory_rate_bpm", value: 13, ts: at }] } });
  const r = await call("POST", "/api/validation", { body: { kind: "breathing", at, camera: "nocam", horse: "zarina", breaths: 6, seconds: 30 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.value, 12);
  const rep = await call("GET", "/api/validation/report?horse=zarina");
  assert.equal(rep.status, 200);
  assert.equal(rep.body.checks, 1);
});

test("a clip needs a video ticket", async () => {
  assert.equal((await call("GET", "/api/clip?camera=cam&at=2026-09-01T12:00:00Z", { token: null })).status, 401);
  const vt = (await call("GET", "/api/footage/ticket")).body.ticket;
  const r = await call("GET", `/api/clip?camera=cam&at=2026-09-01T12:00:00Z&vt=${vt}`, { token: null });
  assert.equal(r.status, 404, "nothing recorded then");
});

test("the normal leaves out implausible eye readings and floor patches from moved bedding", () => {
  const t = DAY0 + 3 * H;
  const rd = [
    R("body_temp_c", 40.4, t, { calibrated: true }), R("body_temp_c", 36.0, t + H, { calibrated: true }),
    R("body_temp_c", 37.2, t + 2 * H, { calibrated: true }), R("people_in_view_s", 30, t + 2 * H),
    R("excretion_event", 1, t + 3 * H), R("excretion_event", 1, t + 3 * H + 60e3), R("excretion_event", 1, t + 3 * H + 120e3),
    R("excretion_event", 1, t + 6 * H),
    ...days(1),
  ];
  const d = dailyValues(rd, "UTC")[0];
  assert.equal(d.eye, 35.5, "40.4 (people/sun) and 37.2 (people at the stall) are left out; the rest are the horse");
  assert.equal(d.manure, 1, "three patches in two minutes are bedding; one alone is a dropping");
  const ev = buildEvents({ id: "zarina", name: "Zarina" }, rd, { from: t - H, to: t + 7 * H });
  assert.equal(ev.filter((e) => e.kind === "excretion").length, 1);
});

test("a too-hot 'eye' (people, sun) is a picture to check, not a fever; system trouble is not for the vet", () => {
  const ev = buildEvents({ id: "zarina", name: "Zarina" }, [R("body_temp_c", 40.4, DAY0, { calibrated: true })],
    { from: DAY0 - H, to: DAY0 + H, eyeBaseline: 36.0, alerts: [{ id: "a", type: "Monitoring offline", severity: "alert", detail: "no data" }] });
  assert.deepEqual(ev.map((e) => [e.kind, e.verdict]).sort(), [["alert", "watch"], ["eye_odd", "watch"]]);
});

test("a camera whose people-detection is not trusted lists no visits", () => {
  const rd = [R("people_in_view_s", 40, DAY0, { deviceId: "cam" })];
  const at = (trusted) => buildEvents({ id: "zarina", name: "Zarina" }, rd, { from: DAY0 - H, to: DAY0 + H, peopleTrusted: () => trusted });
  assert.equal(at(true).filter((e) => e.kind === "visit").length, 1);
  assert.equal(at(false).filter((e) => e.kind === "visit").length, 0);
});
