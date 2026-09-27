// Camera behaviour in the rollup: prototype readings are shown and can raise
// "watch" notes, but never a clinical alarm.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeHorse, buildAlerts, behaviourForHorse, prototype } from "./rollup.mjs";

const bio = { id: "h1", name: "Zarina", stall: "A-04", owner: "o" };
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const R = (metric, value, min, extra = {}) => ({ horseId: "h1", metric, value, ts: ago(min), ...extra });
const cam = { source: "thermal_video", meta: { prototype: true } };
const vit = (min) => [R("body_temp_c", 37.6, min, { source: "thermal_camera" }), R("respiratory_rate_bpm", 14, min, { source: "thermal_camera" })];
const types = (rd) => buildAlerts([bio], rd, () => false).map((a) => `${a.severity}:${a.type}`);

test("camera activity is a prototype; an IMU reading is not", () => {
  assert.equal(prototype(R("activity_index", 0.9, 1, cam)), true);
  assert.equal(prototype(R("activity_index", 0.9, 1, { source: "thermal_video" })), true, "by source too");
  assert.equal(prototype(R("activity_index", 0.9, 1, { source: "imu" })), false);
});

test("someone moving in front of the camera does not raise a colic alarm", () => {
  const rd = [...vit(1), ...[5, 10, 15, 20].map((m) => R("activity_index", 0.9, m, cam))];
  assert.ok(!types(rd).some((t) => t.includes("colic")), types(rd).join());
  assert.equal(summarizeHorse(bio, rd).status, "calm");
  assert.equal(summarizeHorse(bio, rd).stress, null, "no welfare score from a heuristic alone");
});

test("the colic alarm still fires on validated activity with measured low lying", () => {
  const rd = [...vit(1), ...[5, 10, 15].map((m) => R("activity_index", 0.9, m, { source: "imu" })), R("rest_minutes", 10, 30, { source: "imu" })];
  assert.ok(types(rd).includes("alert:Abnormal activity — colic pattern"));
});

test("…but not when lying-down is simply not measured", () => {
  const rd = [...vit(1), ...[5, 10, 15].map((m) => R("activity_index", 0.9, m, { source: "imu" }))];
  assert.ok(!types(rd).some((t) => t.includes("colic")), "0 minutes of an unmeasured thing is not 'little lying'");
});

test("rest periods are runs of still minutes; the total counts every still minute", () => {
  const rd = [];
  for (let m = 60; m >= 41; m--) rd.push(R("inactive_minutes", 1, m, { ...cam, meta: { prototype: true, windowMin: 1 } }));   // 20 still minutes
  for (let m = 40; m >= 31; m--) rd.push(R("inactive_minutes", 0, m, { ...cam, meta: { prototype: true, windowMin: 1 } }));   // moving
  for (let m = 30; m >= 26; m--) rd.push(R("inactive_minutes", 1, m, { ...cam, meta: { prototype: true, windowMin: 1 } }));   // 5 still: too short
  const b = behaviourForHorse(rd);
  assert.equal(b.inactive.todayMin, 25);
  assert.equal(b.inactive.periods.length, 1);
  assert.equal(b.inactive.longestMin, 20);
});

test("no manure for 12 h raises a watch note — only where the detector has seen this stall", () => {
  const seen = [...vit(1), R("excretion_event", 1, 13 * 60, cam), R("excretion_event", 1, 30 * 60, cam)];
  assert.ok(types(seen).includes("warn:No manure seen"), types(seen).join());
  assert.ok(!types(seen).some((t) => t.startsWith("alert:")), "a watch note, not an alarm");
  const never = [...vit(1)];
  assert.ok(!types(never).includes("warn:No manure seen"), "no events ever = detector not watching, not 'no manure'");
  const recent = [...vit(1), R("excretion_event", 1, 60, cam)];
  assert.ok(!types(recent).includes("warn:No manure seen"));
});

test("activity unusual for this horse, against its own 7-day level", () => {
  const rd = [...vit(1)];
  for (const d of [1, 2, 3, 4]) for (let h = 0; h < 6; h++) rd.push(R("activity_index", 0.1, d * 1440 + h * 60, cam));
  for (const m of [10, 30, 60, 90]) rd.push(R("activity_index", 0.5, m, cam));
  const b = behaviourForHorse(rd);
  assert.equal(b.activity.unusual, "high");
  assert.ok(types(rd).includes("warn:Activity unusual for this horse"));
  const fewDays = [...vit(1), R("activity_index", 0.1, 1500, cam), R("activity_index", 0.9, 10, cam)];
  assert.equal(behaviourForHorse(fewDays).activity.unusual, null, "needs 3 days of history first");
});

test("urination and weaving are counted with their times; absent parts are null", () => {
  const rd = [R("urination_event", 1, 120, cam), R("urination_event", 1, 30, cam), R("vice_event", 1, 45, { ...cam, meta: { prototype: true, kind: "weaving" } })];
  const b = behaviourForHorse(rd);
  assert.equal(b.urination.count24h, 2);
  assert.equal(b.weaving.count24h, 1);
  assert.equal(b.excretion, null);
  assert.equal(b.inactive, null);
});

// ---- posture, vices and floor evidence (camera, prototype) ---------------- //
const vis = (meta = {}) => ({ source: "visible_video", confidence: 0.5, meta: { prototype: true, ...meta } });
const posture = (kind, min) => R("posture_event", 1, min, vis({ kind }));

test("resting pattern: lying minutes, bouts and the longest bout from camera posture", () => {
  const rd = [...vit(1),
    R("lying_minutes", 1, 200, vis({ windowMin: 1, observedMin: 1 })), R("lying_minutes", 1, 199, vis({ windowMin: 1, observedMin: 1 })),
    posture("lie_down", 230), posture("get_up", 200), posture("lie_down", 120), posture("get_up", 60)];
  const r = behaviourForHorse(rd).resting;
  assert.equal(r.bouts24h, 2);
  assert.equal(r.longestBoutMin, 60);
  assert.equal(r.lyingTodayMin, 2);
});

test("lying down and getting up 3 times within an hour: a watch note, never an alarm", () => {
  const rd = [...vit(1), posture("lie_down", 50), posture("get_up", 45), posture("lie_down", 35), posture("get_up", 30), posture("lie_down", 15)];
  assert.ok(types(rd).includes("warn:Lying down and getting up repeatedly"), types(rd).join());
  assert.ok(!types(rd).some((t) => t.startsWith("alert:")), "prototype posture never raises a clinical alarm");
  const calm = [...vit(1), posture("lie_down", 200), posture("get_up", 150)];
  assert.ok(!types(calm).some((t) => t.includes("repeatedly")));
});

test("possible cast in the last hour: 'check the horse now' (watch level)", () => {
  const rd = [...vit(1), posture("lie_down", 30), posture("possible_cast", 5)];
  assert.ok(types(rd).includes("warn:Possibly cast — check the horse now"), types(rd).join());
});

test("an hour flat on the side in the last 90 min is noted; chest lying is not", () => {
  const flat = [...vit(1)];
  for (let m = 70; m >= 1; m--) flat.push(R("lying_minutes", 1, m, vis({ windowMin: 1, observedMin: 1, lateralMin: 1 })));
  assert.ok(types(flat).includes("warn:Lying flat on the side a long time"), types(flat).join());
  const chest = [...vit(1)];
  for (let m = 70; m >= 1; m--) chest.push(R("lying_minutes", 1, m, vis({ windowMin: 1, observedMin: 1, lateralMin: 0 })));
  assert.ok(!types(chest).some((t) => t.includes("flat")));
});

test("weaving: minutes and phases per day; a new vice is flagged only with a week of camera history", () => {
  const rd = [...vit(1)];
  for (let d = 1; d <= 5; d++) rd.push(R("activity_index", 0.2, d * 24 * 60, vis()));         // 6 camera days
  for (const m of [100, 99, 98, 20, 19]) rd.push(R("vice_event", 1, m, vis({ kind: "weaving", windowMin: 1 })));
  const w = behaviourForHorse(rd).weaving;
  assert.equal(w.minutes24h, 5);
  assert.equal(w.phases24h, 2, "bouts more than 10 min apart are separate phases");
  assert.equal(w.isNew, true);
  assert.ok(types(rd).includes("warn:New stable vice: weaving"), types(rd).join());
  const young = [...vit(1), R("vice_event", 1, 20, vis({ kind: "weaving", windowMin: 1 }))];
  assert.ok(!types(young).some((t) => t.includes("New stable vice")), "no history: cannot call it new");
});

test("less manure than this horse's usual: a watch note that mentions feeding", () => {
  const rd = [...vit(1)];
  for (let d = 0; d <= 5; d++) rd.push(R("activity_index", 0.2, d * 24 * 60 + 5, vis()));
  for (let d = 1; d <= 5; d++) for (let k = 0; k < 8; k++) rd.push(R("excretion_event", 1, d * 24 * 60 + k * 90, { ...cam, confidence: 0.6, meta: { prototype: true, tier: "probable" } }));
  rd.push(R("excretion_event", 1, 100, { ...cam, confidence: 0.6, meta: { prototype: true, tier: "probable", halfLifeMin: 14 } }));
  const ex = behaviourForHorse(rd).excretion;
  assert.equal(ex.tier, "probable");
  assert.equal(ex.lastHalfLifeMin, 14);
  const note = buildAlerts([bio], rd, () => false).find((a) => a.type === "Less manure than usual");
  assert.ok(note && /last ate/.test(note.detail), types(rd).join());
});

test("breathing carries its band and breath-to-breath regularity", () => {
  const rd = [R("respiratory_rate_bpm", 72, 1, { source: "thermal_camera", meta: { band: "fast", regularity: 0.8, intervalCv: 0.1, method: "thermal video, nostril box" } })];
  const b = behaviourForHorse(rd).breathing;
  assert.equal(b.band, "fast");
  assert.equal(b.regularity, 0.8);
});
