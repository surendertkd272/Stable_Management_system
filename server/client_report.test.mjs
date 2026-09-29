// Client report: built from measurements only, for any horse and window.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientReport, safeTimeZone } from "./client_report.mjs";

const horse = { id: "tara", name: "Tara", stall: "07" };
const from = Date.parse("2026-09-20T09:00:00Z"), hour = 3600000;
const at = (min, s = 55) => new Date(from + min * 60000 + s * 1000).toISOString();
const R = (metric, value, min, meta = {}, source = "visible_video") => ({ metric, value, ts: at(min), source, confidence: 0.7, meta, horseId: "tara" });
const eyeR = (min, v) => R("body_temp_c", v, min, { method: "eye box, eye-shaped hot spot", readAt: (from + min * 60000 + 50000) / 1000 }, "thermal_camera");
const clean = (html) => !/NaN|undefined|Infinity|\[object/.test(html.replace(/<script>[\s\S]*?<\/script>/, ""));

function hourOf({ eyeEvery = 3, eyeBase = 33.6, rise = 0, extra = [] } = {}) {
  const rd = [];
  for (let m = 0; m < 60; m++) {
    rd.push(R("activity_index", m < 20 ? 0.7 : m < 40 ? 0.3 : 0.03, m));
    rd.push(R("inactive_minutes", m >= 40 ? 1 : 0, m, { windowMin: 1 }));
    if (m % eyeEvery === 0) rd.push(eyeR(m, eyeBase + (rise * m) / 60));
  }
  return [...rd, ...extra];
}
const grabs = [];
const grab = async (ms, width) => { grabs.push(ms); return Buffer.alloc(1000 + (Math.floor(ms / 1000) % 7) * 10, width); };

test("an hour: every section from the numbers, photos where the eye was read, no hand-written claims", async () => {
  grabs.length = 0;
  const { html, photos, ref } = await clientReport({ horse, readings: hourOf(), from, to: from + hour, floorWatched: false, tz: "Asia/Kolkata", grab, clipCount: 12,
    notes: "Fed at 14:30.\n<script>alert(1)</script>" });
  assert.equal(ref, "EQ-TARA-202609201430");
  assert.match(html, /Tara · Stall 07|Tara <span>· Stall 07/);
  assert.equal((html.match(/Page \d of 5/g) || []).length, 5);
  assert.equal(photos, 15, "three cover photos and a gallery of twelve");
  assert.match(html, /14:30–15:30 IST/);
  assert.match(html, /Temperature stable/);
  assert.match(html, /20 min high, 20 min moderate and 0 min low activity; 20 min standing still/);
  assert.match(html, /Not captured<\/span><\/td><td class="pt-note">The stall floor is not marked/);
  assert.match(html, /Notes from the stable/);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !html.includes("<script>alert(1)"), "notes are escaped");
  assert.doesNotMatch(html, /prototype|ears forward|investigat|Badal|RVC|BSV/i);
  assert.ok(clean(html));
  // Cover photos come from minutes with the eye in view, at the second it was read (±1 s).
  const eyeMoments = hourOf().filter((r) => r.metric === "body_temp_c").map((r) => r.meta.readAt * 1000);
  const coverGrabs = grabs.slice(0, 9);
  assert.ok(coverGrabs.every((g) => eyeMoments.some((e) => Math.abs(g - e) <= 1000)), "photos taken when the eye was read");
});

test("nothing measured: says what was not captured, never zero, and builds without photos", async () => {
  const { html, photos } = await clientReport({ horse, readings: [], from, to: from + hour, tz: "Asia/Kolkata" });
  assert.equal(photos, 0);
  assert.match(html, /Eye temperature was not captured/);
  assert.match(html, /No video was recorded in this session/);
  assert.match(html, /No eye-temperature readings in this session/);
  assert.equal((html.match(/Page \d of 5/g) || []).length, 5);
  assert.ok(clean(html));
});

test("a rising temperature is said, with the size of the rise", async () => {
  const { html } = await clientReport({ horse, readings: hourOf({ eyeEvery: 2, rise: 1.2 }), from, to: from + hour, tz: "UTC" });
  assert.match(html, /Temperature rising/);
  assert.match(html, /rose by 0\.\d °C|rose by 1\.\d °C/);
});

test("box walking: an old single-window flag is not counted; laps in consecutive windows are", async () => {
  const old = R("vice_event", 1, 30, { kind: "box_walking", windowMin: 1, method: "laps of the stall" });
  const now = R("vice_event", 1, 45, { kind: "box_walking", windowMin: 2, method: "laps of the stall, in consecutive windows" });
  const a = await clientReport({ horse, readings: hourOf({ extra: [old] }), from, to: from + hour, tz: "UTC" });
  assert.match(a.html, /No stereotypic behaviour/);
  const b = await clientReport({ horse, readings: hourOf({ extra: [old, now] }), from, to: from + hour, tz: "UTC" });
  assert.match(b.html, /Behaviour flagged for review/);
  assert.match(b.html, /box walking at 09:45/);
});

test("a 12-hour night: wider bars, a readable breakdown, night context", async () => {
  const start = Date.parse("2026-09-20T14:30:00Z");                 // 20:00 IST
  const rd = [];
  for (let m = 0; m < 720; m++) rd.push({ metric: "activity_index", value: m % 90 < 10 ? 0.4 : 0.02, ts: new Date(start + m * 60000 + 55000).toISOString(), meta: {} });
  const { html } = await clientReport({ horse, readings: rd, from: start, to: start + 12 * hour, tz: "Asia/Kolkata" });
  const bars = (html.match(/class="b-(none|low|moderate|high)"|class="nodata"/g) || []).length;
  assert.ok(bars <= 90 && bars >= 40, `bars ${bars}`);
  const rows = (html.match(/<tr class="(dim)?"><td class="num">/g) || []).length;
  assert.ok(rows <= 10 && rows >= 6, `rows ${rows}`);
  assert.match(html, /hour breakdown/);
  assert.match(html, /The session spans day and night|A night session/);
  assert.ok(clean(html));
});

test("an unknown time zone falls back to the server's", () => {
  assert.equal(safeTimeZone("Asia/Kolkata"), "Asia/Kolkata");
  assert.ok(safeTimeZone("Mars/Olympus").length > 0);
});

test("breathing not captured: the main reason, in plain words", async () => {
  const checks = Array.from({ length: 40 }, (_, m) => R("breathing_check", 0, m, { nostril: m < 30 ? "head_off_boxes" : "head_moving" }, "thermal_video"));
  const { html } = await clientReport({ horse, readings: hourOf({ extra: checks }), from, to: from + hour, tz: "UTC" });
  assert.match(html, /head was in view but away from the position the camera was set up for/);
  assert.match(html, /<dt>Readings<\/dt><dd>(\d+)<\/dd>/);
  const n = Number(html.match(/<dt>Readings<\/dt><dd>(\d+)<\/dd>/)[1]);
  assert.equal(n, hourOf().length, "the checks are not counted as readings");
});

test("a paused stretch is left out: its readings, its minutes in coverage, and the summary says so", async () => {
  const { html } = await clientReport({ horse, readings: hourOf(), from, to: from + hour, floorWatched: false, tz: "Asia/Kolkata",
    paused: [[from + 20 * 60000, from + 40 * 60000]] });
  assert.match(html, /monitored for 40 minutes \(the session was paused 14:50–15:10 to adjust the camera; that time is not counted\)/);
  assert.match(html, /40 of 40 minutes/, "coverage counts the monitored minutes only");
  assert.match(html, /class="paused"/, "the timeline marks the pause");
  assert.ok(clean(html));
});

test("photos pair colour with thermal; the comparison page is about the horse, not the equipment", async () => {
  const before = await clientReport({ horse, readings: hourOf(), from, to: from + hour, floorWatched: false, tz: "Asia/Kolkata" });
  assert.equal(before.summary.eye.n, 20);
  // A calmer session, with the floor watched and no eye readings.
  const calm = hourOf({ eyeEvery: 1000 }).filter((r) => r.metric !== "body_temp_c")
    .map((r) => (r.metric === "activity_index" ? { ...r, value: 0.04 } : r));
  const { html, summary } = await clientReport({ horse, readings: calm, from, to: from + hour, floorWatched: true, tz: "Asia/Kolkata", grab,
    grabThermal: grab, previous: { summary: before.summary } });
  assert.equal(summary.eye.n, 0);
  assert.equal((html.match(/Page \d of 6/g) || []).length, 6, "six pages with the comparison");
  assert.match(html, /class="pair"/, "colour and thermal side by side");
  assert.match(html, /Tara across sessions/);
  assert.match(html, /<b>Tara was calmer<\/b> than on 20 Sept 2026: median activity 0\.04 against 0\.30/);
  assert.match(html, /read on 20 Sept 2026 \(33\.\d °C median\) but not on 20 Sept 2026|cannot be compared this time/);
  assert.match(html, /none seen this session; not assessed on 20 Sept 2026/);
  const page6 = html.slice(html.indexOf("across sessions"));
  assert.doesNotMatch(page6, /lens|camera|coverage|sun|monitoring points/i, "nothing about the equipment");
  assert.ok(clean(html));
});

test("recommendations are about the horse: no equipment instructions", async () => {
  const { html } = await clientReport({ horse, readings: hourOf({ eyeEvery: 1000 }), from, to: from + hour, floorWatched: false, tz: "Asia/Kolkata" });
  const recs = html.slice(html.indexOf("Recommendations"), html.indexOf("About this report"));
  assert.match(recs, /Run longer sessions/);
  assert.doesNotMatch(recs, /camera|lens|thermal view|mark the stall floor/i);
});
