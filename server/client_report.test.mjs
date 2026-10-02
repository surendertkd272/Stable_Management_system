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
  assert.equal(photos, 9, "three cover photos and six colour views");
  assert.match(html, /14:30–15:30 IST/);
  assert.match(html, /Temperature stable/);
  assert.match(html, /20 min high, 20 min moderate and 0 min low activity; 20 min standing still/);
  assert.match(html, /Not captured<\/span><\/td><td class="pt-note">The stall floor was not in view/);
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

test("a session reviewed from recorded footage: eye temperature is live-only, said plainly — never 'the eye was not in view'", async () => {
  const rec = hourOf().filter((r) => r.metric !== "body_temp_c").map((r) => ({ ...r, meta: { ...r.meta, fromRecording: true } }));
  rec.push(R("eye_check", 0, 5, { detail: "not measured — recorded video holds no temperatures", fromRecording: true }, "thermal_camera"));
  const { html } = await clientReport({ horse, readings: rec, from, to: from + hour, tz: "Asia/Kolkata", grab, clipCount: 12 });
  assert.match(html, /Eye temperature: live monitoring only/);
  assert.match(html, /This session was recorded at the stable and reviewed minute by minute afterwards\. Eye temperature is taken during live monitoring, so it is not part of this review\./);
  assert.match(html, /Review after recording/, "an hour is not 'overnight'");
  assert.match(html, /<small>live monitoring only<\/small>/);
  assert.doesNotMatch(html, /eye not in view|the eye was not in view|Eye in view<\/text>|recorded footage|camera|sensor/i);
  assert.match(html, /20 min high, 20 min moderate/, "the rest of the report is as live");
  assert.ok(clean(html));
  const live = await clientReport({ horse, readings: [], from, to: from + hour, tz: "Asia/Kolkata" });
  assert.doesNotMatch(live.html, /reviewed minute by minute|live monitoring only/);
});

test("an overnight review plus a live morning check: temperature from the check, each part named with its times", async () => {
  const night = Date.parse("2026-09-20T15:00:00Z");                    // 20:30 IST, 10 h to 06:30
  const atN = (min) => new Date(night + min * 60000 + 55000).toISOString();
  const rd = [];
  for (let m = 0; m < 600; m++) {
    const recorded = m < 540;                                          // 20:30–05:30 reviewed, 05:30–06:30 live
    const meta = recorded ? { fromRecording: true } : {};
    rd.push({ metric: "activity_index", value: m % 50 < 5 ? 0.7 : 0.1, ts: atN(m), source: "visible_video", confidence: 0.6, meta, horseId: "tara" });
    if (!recorded && m % 3 === 0) rd.push({ metric: "body_temp_c", value: 37.1, ts: atN(m), source: "thermal_camera", confidence: 0.95,
      meta: { method: "eye box, eye-shaped hot spot", readAt: (night + m * 60000 + 50000) / 1000 }, horseId: "tara" });
  }
  const { html } = await clientReport({ horse, readings: rd, from: night, to: night + 600 * 60000, tz: "Asia/Kolkata", grab, clipCount: 60 });
  assert.match(html, /Temperature stable/);
  assert.match(html, /Eye temperature was taken during the live check \(05:30–06:30\); the overnight part \(20:30–05:30\) was recorded at the stable and reviewed minute by minute afterwards\./);
  assert.match(html, /Overnight review/);
  assert.match(html, /eye in view for 20 of 60 live minutes/);
  assert.match(html, /Reviewed afterwards/, "the timeline shows which part was the review");
  assert.ok(clean(html));
});

test("visits: people at the stall are listed with their times, and the timeline shows them", async () => {
  const rd = hourOf().concat(Array.from({ length: 60 }, (_, m) =>
    R("people_in_view_s", (m >= 10 && m < 14) || m === 41 ? 40 : 0, m, { windowMin: 1 })));
  const { html } = await clientReport({ horse, readings: rd, from, to: from + hour, tz: "Asia/Kolkata" });
  assert.match(html, /People came to the stall 2 times \(14:40–14:44, 15:11–15:12\)\. Their movement is left out of Tara's activity\./);
  assert.match(html, /People at the stall/);
  const none = await clientReport({ horse, readings: hourOf().concat([R("people_in_view_s", 0, 3)]), from, to: from + hour, tz: "Asia/Kolkata" });
  assert.match(none.html, /No one came to the stall during the session/);
  const old = await clientReport({ horse, readings: hourOf(), from, to: from + hour, tz: "Asia/Kolkata" });
  assert.doesNotMatch(old.html, /Visits|People at the stall/, "no people check ran: nothing said");
});

test("how the time was spent: budget, hour by hour, where he stood; feeding from time at the hay; prepared for the client", async () => {
  const rd = hourOf().filter((r) => r.metric !== "body_temp_c");
  for (let m = 0; m < 60; m++) {
    const eating = m < 30 ? 40 : 10;
    rd.push(R("time_budget", 60, m, { lyingS: 0, eatingS: eating, restingS: 60 - eating - 5, movingS: 5, unseenS: 0, hay: true, grid: "12x8",
      where: [[3 * 12 + 2, 50], [5 * 12 + 8, 10]] }));
  }
  rd.push(R("respiratory_rate_bpm", 9.2, 12, { method: "thermal video, nostril box" }, "thermal_video"));
  const { html } = await clientReport({ horse, readings: rd, from, to: from + hour, tz: "Asia/Kolkata", grab, grabThermal: grab, grabFull: grab,
    client: "Remount Veterinary Corps" });
  assert.match(html, /<b>Prepared for<\/b> Remount Veterinary Corps/);
  assert.match(html, /<h2>How the time was spent<\/h2>/);
  assert.match(html, /Eating at the hay 25 min/i, "the summary gives the time eating");
  assert.match(html, /Feeding<small>Point 12<\/small><\/td><td class="pt-val">25 min<\/td><td><span class="st part">/, "feeding: time at the hay, partly captured");
  assert.match(html, /The amount eaten is not measured/);
  assert.match(html, /<h2>Where Tara spent the time<\/h2>/);
  assert.match(html, /Tara spent most of the time at the (middle|back) left of the stall \(83% of the time seen\)/);
  assert.match(html, /Breathing 9 \/min, read in this minute/, "a heat view says what it shows");
  assert.match(html, /Every 10 minutes/);
  assert.doesNotMatch(html, /camera|sensor|detector|thermal camera|RVC/i);
  assert.ok(clean(html));
});

test("urination and droppings: patches close together are moved bedding, not counted", async () => {
  const rd = hourOf().concat([R("excretion_event", 1, 5), R("excretion_event", 1, 30), R("excretion_event", 1, 31), R("urination_event", 1, 33),
    R("urination_event", 1, 55)]);
  const { html } = await clientReport({ horse, readings: rd, from, to: from + hour, floorWatched: true, tz: "Asia/Kolkata" });
  assert.match(html, /Urination<small>Point 7<\/small><\/td><td class="pt-val">1 seen</);
  assert.match(html, /Excretion<small>Point 8<\/small><\/td><td class="pt-val">1 seen</);
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
  assert.match(html, /the head was not in position for breathing to be read at the nostril/);
  assert.match(html, /<dt>Readings<\/dt><dd>(\d+)<\/dd>/);
  const n = Number(html.match(/<dt>Readings<\/dt><dd>(\d+)<\/dd>/)[1]);
  assert.equal(n, hourOf().length, "the checks are not counted as readings");
});

test("a paused stretch is left out: its readings, its minutes in coverage, and the summary says so", async () => {
  const { html } = await clientReport({ horse, readings: hourOf(), from, to: from + hour, floorWatched: false, tz: "Asia/Kolkata",
    paused: [[from + 20 * 60000, from + 40 * 60000]] });
  assert.match(html, /monitored for 40 minutes \(the session was paused 14:50–15:10; that time is not counted\)/);
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
  assert.equal((html.match(/Page \d of 7/g) || []).length, 7, "seven pages: the heat views and the comparison added");
  assert.match(html, /class="pair"/, "cover photos: colour and thermal side by side");
  assert.match(html, /<h2>Colour views<\/h2>/);
  assert.match(html, /<h2>Heat views<\/h2>/, "the heat images in a section of their own");
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

test("the whole report reads without equipment: no camera or sensor anywhere a reader sees", async () => {
  const { html } = await clientReport({ horse, readings: hourOf(), from, to: from + hour, floorWatched: false, tz: "Asia/Kolkata", grab, grabThermal: grab,
    paused: [[from + 20 * 60000, from + 30 * 60000]] });
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/src="data:[^"]+"/g, "").replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(text, /camera|sensor|lens\b|water meter|feeder/i);
});
