// Stall sensors — water meter / weighed bucket, weigh-back feeder, hay scale:
// the watch notes they raise (thresholds are ours), the horse page's `intake`
// block, and points 11–12 of the session and client reports. Never a zero
// where nothing was measured.
//
// The clock is pinned to 14:00 local today: "today" is the stable's calendar
// day, so a test must not depend on the hour it happens to run at.
import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildAlerts, intakeForHorse, summarizeHorse } from "./rollup.mjs";
import { sessionReport } from "./session.mjs";
import { clientReport } from "./client_report.mjs";

const BIO = { id: "test", name: "Testy", stall: "T-01" };
const H = 3600 * 1000;
let NOW;
beforeEach(() => {
  const d = new Date(); d.setHours(14, 0, 0, 0); NOW = d.getTime();
  mock.timers.enable({ apis: ["Date"], now: NOW });
});
afterEach(() => mock.timers.reset());

const ago = (hours) => new Date(NOW - hours * H).toISOString();
/** Local wall-clock time `daysAgo` days back, e.g. dayAt(0, 7) = 07:00 today. */
const dayAt = (daysAgo, h, m = 0) => { const d = new Date(NOW); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d.toISOString(); };
const R = (metric, value, ts, meta = {}, source = "test") => ({ horseId: BIO.id, stallId: BIO.stall, metric, value, unit: null, source, confidence: 1, ts, meta });
/** Something from the camera every 10 min for the last 2 h (the horse is monitored). */
const camera = () => Array.from({ length: 12 }, (_, i) => R("body_temp_c", 37.6, ago(i / 6)));
/** One weighed meal: offered, eaten and left, as the feeder reports it. */
const meal = (ts, offered, eaten, meal = "morning", id = ts) => [
  R("feed_offered_g", offered, ts, { meal, mealId: id }, "feeder"),
  R("feed_intake_g", eaten, new Date(Date.parse(ts) + 40 * 60000).toISOString(), { meal, mealId: id }, "feeder"),
  R("feed_refusal_g", offered - eaten, new Date(Date.parse(ts) + 40 * 60000).toISOString(), { meal, mealId: id }, "feeder"),
];
const alerts = (rd) => buildAlerts([BIO], rd, () => false);
const find = (rd, type) => alerts(rd).find((a) => a.type === type);

// ---- left feed ------------------------------------------------------------ //
test("left feed: half the morning feed left, against a horse that usually finishes -> watch", () => {
  const rd = [...camera()];
  for (let d = 1; d <= 6; d++) rd.push(...meal(dayAt(d, 7), 2000, 1900));       // usually leaves 5 %
  rd.push(...meal(dayAt(0, 7), 2000, 1000));                                     // today: 50 %
  const a = find(rd, "Left feed");
  assert.ok(a, JSON.stringify(alerts(rd).map((x) => x.type)));
  assert.equal(a.severity, "warn");
  assert.match(a.detail, /^Refused 50% of the morning feed at 07:00 \(1\.0 kg of 2\.0 kg\)/);
  assert.match(a.detail, /usually leaves ~5%/);
  assert.match(a.detail, /Our watch rule/);
  assert.equal(summarizeHorse(BIO, rd).status, "watch");
});

test("left feed: judged against the horse's own usual leftovers, not a fixed line", () => {
  const rd = [...camera()];
  for (let d = 1; d <= 6; d++) rd.push(...meal(dayAt(d, 7), 2000, 1200));       // usually leaves 40 %
  rd.push(...meal(dayAt(0, 7), 2000, 1100));                                     // today 45 %: its normal
  assert.equal(find(rd, "Left feed"), undefined, "45 % is within 15 points of this horse's usual 40 %");
  rd.push(...meal(dayAt(0, 12), 2000, 600, "midday"));                           // 70 %: well over
  assert.match(find(rd, "Left feed").detail, /^Refused 70% of the midday feed/, "the latest meal today is judged");
});

test("left feed: with no history 30 % is enough; 25 % is not; an unweighed meal is not judged", () => {
  assert.match(find([...camera(), ...meal(dayAt(0, 7), 2000, 1300)], "Left feed").detail, /no earlier meals to compare with/);
  assert.equal(find([...camera(), ...meal(dayAt(0, 7), 2000, 1500)], "Left feed"), undefined);
  const served = [...camera(), R("feed_offered_g", 2000, dayAt(0, 13), { meal: "midday", mealId: "m9" }, "feeder")];
  assert.equal(find(served, "Left feed"), undefined, "offered but not weighed back yet");
  assert.equal(find([...camera(), ...meal(dayAt(1, 18), 2000, 400, "evening")], "Left feed"), undefined, "yesterday's meal is not today's");
});

// ---- no drinking ------------------------------------------------------------ //
test("no drinking for 10 h where the water meter works -> watch, timed from the last drink", () => {
  const rd = [...camera()];
  for (const h of [30, 24, 18, 12]) rd.push(R("water_visit", 1, ago(h), { boutId: `b${h}` }, "flow_meter"), R("water_ml", 3000, ago(h), { boutId: `b${h}` }, "flow_meter"));
  const a = find(rd, "No drinking recorded");
  assert.ok(a);
  assert.equal(a.severity, "warn");
  assert.match(a.detail, /^No drinking recorded for 12h 00m — /);
  assert.match(a.time, /^since /);
  rd.push(R("water_ml", 2500, ago(3), {}, "flow_meter"));
  assert.equal(find(rd, "No drinking recorded"), undefined, "a drink 3 h ago");
});

test("no drinking: silence is not judged where no water meter has reported in 48 h", () => {
  assert.equal(find(camera(), "No drinking recorded"), undefined, "camera only: not measured");
  assert.equal(find([...camera(), R("water_ml", 3000, ago(60), {}, "flow_meter")], "No drinking recorded"), undefined, "meter last seen 60 h ago");
  const zeros = [...camera(), ...[20, 10, 2].map((h) => R("water_ml", 0, ago(h), {}, "flow_meter"))];
  assert.match(find(zeros, "No drinking recorded").detail, /since the water meter started reporting/, "a meter reporting only zeros");
});

// ---- low hay ---------------------------------------------------------------- //
const hayDay = (daysAgo, perHour, hours = 24) => Array.from({ length: hours }, (_, h) => R("hay_intake_g", perHour, dayAt(daysAgo, h, 30), { periodMin: 60 }, "feeder"));

test("low hay: under 60 % of the horse's 7-day average, pro rata for the hours gone -> watch", () => {
  const rd = [...camera()];
  for (let d = 1; d <= 5; d++) rd.push(...hayDay(d, 333));                       // ~8 kg a day
  rd.push(...hayDay(0, 100, 14));                                                 // 1.4 kg by 14:00 (expected ~4.7 kg)
  const a = find(rd, "Low hay intake");
  assert.ok(a);
  assert.match(a.detail, /^1\.4 kg of hay eaten so far today vs ~4\.7 kg expected by now from this horse's 7-day average of 8\.0 kg a day/);
  const normal = [...camera(), ...[1, 2, 3, 4, 5].flatMap((d) => hayDay(d, 333)), ...hayDay(0, 330, 14)];
  assert.equal(find(normal, "Low hay intake"), undefined);
});

test("low hay: not judged without 3 earlier days, or with the scale silent", () => {
  const short = [...camera(), ...hayDay(1, 333), ...hayDay(2, 333), ...hayDay(0, 50, 14)];
  assert.equal(find(short, "Low hay intake"), undefined, "two days are not a baseline");
  const silent = [...camera(), ...[1, 2, 3, 4].flatMap((d) => hayDay(d, 333)), ...hayDay(0, 50, 10)];  // last total 09:30
  assert.equal(find(silent, "Low hay intake"), undefined, "no hay total for 4 h: the scale is not reporting");
});

// ---- feeder fault ------------------------------------------------------------ //
test("feeder fault in the last 2 h -> watch with the kind; older faults are not news", () => {
  const rd = [...camera(), ...[1.5, 1, 0.5].map((h) => R("feeder_fault", 1, ago(h), { kind: "jam" }, "feeder")), R("feeder_fault", 1, ago(1), { kind: "empty" }, "feeder")];
  const a = find(rd, "Feeder fault");
  assert.equal(a.severity, "warn");
  assert.match(a.detail, /jam \(3 times, last at 13:30\); empty hopper at 13:00/);
  assert.equal(find([...camera(), R("feeder_fault", 1, ago(3), { kind: "jam" }, "feeder")], "Feeder fault"), undefined);
});

// ---- the horse page: intake ---------------------------------------------------- //
test("intake is null where no water or feed sensor has reported", () => {
  assert.equal(intakeForHorse(camera()), null);
});

test("intake: today's water, drinks, meals, hay and faults, with 7-day series", () => {
  const rd = [...camera()];
  for (const [d, h, ml] of [[0, 9, 3000], [0, 12, 2000], [1, 16, 4000], [3, 10, 5000]])
    rd.push(R("water_visit", 1, dayAt(d, h), { boutId: `${d}${h}` }, "flow_meter"), R("water_ml", ml, dayAt(d, h), { boutId: `${d}${h}` }, "flow_meter"));
  rd.push(R("water_refill", 12000, dayAt(0, 8), {}, "flow_meter"));
  rd.push(...meal(dayAt(0, 7), 2400, 2100), ...meal(dayAt(0, 12), 1000, 1000, "midday"), ...meal(dayAt(1, 18), 2000, 2000, "evening"));
  rd.push(...hayDay(0, 250, 13), ...hayDay(2, 300));
  rd.push(R("feeder_fault", 1, dayAt(0, 6), { kind: "empty" }, "feeder"), R("feeder_fault", 1, dayAt(2, 6), { kind: "jam" }, "feeder"));
  const x = intakeForHorse(rd);
  assert.deepEqual(Object.keys(x).sort(), ["drinksToday", "faults", "hay7dG", "hayTodayG", "lastDrinkAt", "mealsToday", "water7dMl", "waterTodayMl"]);
  assert.equal(x.waterTodayMl, 5000, "the refill is not drinking");
  assert.deepEqual(x.water7dMl, [null, null, null, 5000, null, 4000, 5000]);
  assert.equal(x.drinksToday, 2);
  assert.equal(x.lastDrinkAt, dayAt(0, 12));
  assert.deepEqual(x.mealsToday, [
    { at: dayAt(0, 7), meal: "morning", offeredG: 2400, eatenG: 2100, refusedG: 300 },
    { at: dayAt(0, 12), meal: "midday", offeredG: 1000, eatenG: 1000, refusedG: 0 },
  ]);
  assert.equal(x.hayTodayG, 3250);
  assert.deepEqual(x.hay7dG, [null, null, null, null, 7200, null, 3250]);
  assert.deepEqual(x.faults, [{ at: dayAt(0, 6), kind: "empty" }, { at: dayAt(2, 6), kind: "jam" }], "newest first");
});

test("intake never reports zero for what was not measured", () => {
  const feedOnly = intakeForHorse([...camera(), ...meal(dayAt(0, 7), 2000, 1800)]);
  assert.equal(feedOnly.waterTodayMl, null);
  assert.equal(feedOnly.drinksToday, null);
  assert.ok(feedOnly.water7dMl.every((v) => v === null));
  assert.equal(feedOnly.hayTodayG, null);
  assert.equal(feedOnly.lastDrinkAt, null);
  // The meter reported yesterday evening and nothing since: no bout today IS a
  // measurement — the horse has not drunk today.
  const dry = intakeForHorse([...camera(), R("water_visit", 1, dayAt(1, 20), {}, "flow_meter"), R("water_ml", 3000, dayAt(1, 20), {}, "flow_meter")]);
  assert.equal(dry.waterTodayMl, 0);
  assert.equal(dry.drinksToday, 0);
  assert.equal(dry.water7dMl[5], 3000);
  // A meter that reports volumes only (no bouts) measures water but cannot count drinks.
  const gauge = intakeForHorse([...camera(), R("water_ml", 1500, dayAt(0, 9), {}, "modbus"), R("water_ml", 900, dayAt(0, 11), {}, "modbus")]);
  assert.equal(gauge.waterTodayMl, 2400);
  assert.equal(gauge.drinksToday, null, "not 0 drinks beside 2.4 L");
});

test("older feeders without a meal id: intake and refusal stamped together pair up", () => {
  const ts = dayAt(0, 7);
  const x = intakeForHorse([...camera(), R("feed_intake_g", 1800, ts, {}, "feeder"), R("feed_refusal_g", 200, ts, {}, "feeder")]);
  assert.deepEqual(x.mealsToday, [{ at: ts, meal: null, offeredG: null, eatenG: 1800, refusedG: 200 }]);
});

// ---- points 11–12 in the session report --------------------------------------- //
const from = Date.parse("2026-09-27T11:00:00Z"), to = from + H;
const inWin = (min) => new Date(from + min * 60000).toISOString();

test("session: watering and feeding summarised, refills kept apart from drinking", () => {
  const rd = [
    R("water_visit", 1, inWin(10), {}, "flow_meter"), R("water_ml", 3200, inWin(10), {}, "flow_meter"),
    R("water_visit", 1, inWin(40), {}, "flow_meter"), R("water_ml", 1800, inWin(40), {}, "flow_meter"),
    R("water_refill", 12000, inWin(50), {}, "flow_meter"),
    ...meal(inWin(5), 2400, 2100, "morning", "m1"),
    R("hay_intake_g", 400, inWin(30), { periodMin: 30 }, "feeder"),
  ];
  const rep = sessionReport({ readings: rd, from, to });
  const p = (n) => rep.points.find((x) => x.n === n);
  assert.equal(p(11).status, "measured");
  assert.match(p(11).summary, /^5\.0 L drunk in 2 drinks, last at .*; bucket refilled 1 time \(12\.0 kg added, not counted as drinking\)\.$/);
  assert.equal(p(12).status, "measured");
  assert.match(p(12).summary, /^1 meal: morning .* offered 2\.4 kg ate 2\.1 kg left 300 g; hay 400 g eaten\.$/);
  assert.equal(rep.coverage.minutesWithData, 0, "stall sensors are not camera coverage");
  assert.equal(rep.coverage.readings, rd.length);
});

test("session: 'none seen' only where the sensor was reporting; otherwise not measured", () => {
  const p = (rep, n) => rep.points.find((x) => x.n === n);
  const none = sessionReport({ readings: [], from, to });
  assert.equal(p(none, 11).status, "not measured");
  assert.equal(p(none, 12).status, "not measured");
  const before = [R("water_ml", 3000, new Date(from - 5 * H).toISOString(), {}, "flow_meter"),
    R("hay_intake_g", 300, new Date(from - 2 * H).toISOString(), {}, "feeder")];
  const quiet = sessionReport({ readings: before, from, to });
  assert.equal(p(quiet, 11).status, "none seen");
  assert.match(p(quiet, 11).summary, /the water meter was reporting/);
  assert.equal(p(quiet, 12).status, "none seen");
});

// ---- rows 11–12 in the client report ------------------------------------------ //
const cell = (html, name) => html.match(new RegExp(`${name}<small>Point \\d+</small></td><td class="pt-val">([^<]*)</td><td><span class="st (\\w+)">.*?</span></td><td class="pt-note">([^<]*)</td>`));

test("client report: watering and feeding rows from the sensors, still five pages", async () => {
  const rd = [
    R("water_visit", 1, inWin(10), {}, "flow_meter"), R("water_ml", 3200, inWin(10), {}, "flow_meter"),
    ...meal(inWin(5), 2400, 2100, "morning", "m1"),
  ];
  const { html } = await clientReport({ horse: { id: "tara", name: "Tara", stall: "07" }, readings: rd, from, to, tz: "UTC" });
  assert.deepEqual(cell(html, "Watering").slice(1), ["3.2 L", "ok", "1 drink."]);
  assert.deepEqual(cell(html, "Feeding").slice(1), ["2.1 kg", "ok", "1 meal: offered 2.4 kg, left 0.3 kg."]);
  assert.equal((html.match(/Page \d of 5/g) || []).length, 5);
  assert.match(html, /twelve monitoring points/);
  assert.doesNotMatch(html, /eight camera monitoring points/);
});

test("client report: no water or feed sensor -> Not captured, with what it needs", async () => {
  const { html } = await clientReport({ horse: { id: "tara", name: "Tara", stall: "07" }, readings: [], from, to, tz: "UTC" });
  assert.deepEqual(cell(html, "Watering").slice(1), ["—", "cam", "Not monitored in this session."]);
  assert.deepEqual(cell(html, "Feeding").slice(1), ["—", "cam", "Not monitored in this session."]);
});
