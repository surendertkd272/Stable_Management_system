// The stable's care log (server/care-log.mjs): risk windows, settling nights,
// isolation of new arrivals, long journeys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { configureCareLog, colicRisks, settlingTimes, isolation, recentLongJourneys, validateEvent } from "./care-log.mjs";

const H = 3600e3, DAY = 24 * H;
const NOW = Date.parse("2026-10-04T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

test("risk windows open and close", () => {
  configureCareLog({ horses: [{ id: "a" }, { id: "b", cribBiter: true }], events: [
    { kind: "hay_change", horseId: "*", at: iso(NOW - 3 * DAY) },
    { kind: "diet_change", horseId: "a", at: iso(NOW - 20 * DAY) },            // closed after 14 days
    { kind: "transport", horseId: "a", at: iso(NOW - 30 * H), hours: 6 },      // closed after 2 days? still open at 30 h
    { kind: "weather_change", horseId: "a", at: iso(NOW + DAY) },             // the future does not count
  ] });
  const a = colicRisks("a", NOW);
  assert.deepEqual(a.map((r) => r.kind).sort(), ["hay_change", "transport"]);
  assert.match(a.find((r) => r.kind === "transport").text, /6-hour journey 30 h ago/);
  assert.deepEqual(colicRisks("b", NOW).map((r) => r.kind).sort(), ["crib_biter", "hay_change"], "standing risk never closes");
  assert.deepEqual(colicRisks("a", NOW + 12 * DAY).map((r) => r.kind), [], "hay change closes after 14 days");
});

test("moves and arrivals mark the settling nights", () => {
  configureCareLog({ horses: [{ id: "a", arrivedAt: iso(NOW - 40 * DAY) }], events: [{ kind: "moved", horseId: "a", at: iso(NOW - 2 * DAY) }] });
  assert.equal(settlingTimes("a").length, 2);
});

test("new arrivals are isolated for 3 weeks", () => {
  configureCareLog({ horses: [{ id: "a", arrivedAt: iso(NOW - 4.5 * DAY) }, { id: "b" }], events: [] });
  assert.deepEqual(isolation("a", NOW), { since: iso(NOW - 4.5 * DAY), day: 5 });
  assert.equal(isolation("a", NOW + 17 * DAY), null);
  assert.equal(isolation("b", NOW), null);
});

test("a long journey starts a 7-day watch", () => {
  configureCareLog({ horses: [{ id: "a" }], events: [{ kind: "transport", horseId: "a", at: iso(NOW - 30 * H), hours: 26 }] });
  assert.deepEqual(recentLongJourneys("a", NOW).map((j) => [j.hours, j.day]), [[26, 2]]);
  assert.equal(colicRisks("a", NOW + 5 * DAY).length, 1, "a long journey's risk lasts the 7 days");
  assert.deepEqual(recentLongJourneys("a", NOW + 7 * DAY), []);
});

test("care-log entries are checked", () => {
  const horses = [{ id: "a" }];
  assert.ok(validateEvent({ kind: "nap", horseId: "a" }, { horses }).errors);
  assert.ok(validateEvent({ kind: "hay_change", horseId: "zz" }, { horses }).errors);
  assert.ok(validateEvent({ kind: "transport", horseId: "a" }, { horses }).errors, "a journey needs its hours");
  assert.ok(validateEvent({ kind: "hay_change", horseId: "a", at: iso(Date.now() + 2 * H) }, { horses }).errors);
  const ok = validateEvent({ kind: "transport", horseId: "a", hours: "22", note: " lorry from Meerut " }, { horses });
  assert.equal(ok.event.hours, 22);
  assert.equal(ok.event.note, "lorry from Meerut");
  assert.equal(validateEvent({ kind: "hay_change", horseId: "*" }, { horses }).event.horseId, "*");
});
