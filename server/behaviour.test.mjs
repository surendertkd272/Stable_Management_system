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
