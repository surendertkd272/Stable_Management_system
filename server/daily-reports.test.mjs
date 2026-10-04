// Nightly reports: once each morning, one PDF per horse watched in the night.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = mkdtempSync(join(tmpdir(), "equicare-daily-"));
process.env.EQUICARE_REPORTS_DIR = DIR;
const { dailyTick, listDaily, dailyPath, lastNight } = await import("./daily-reports.mjs");
after(() => rmSync(DIR, { recursive: true, force: true }));

test("the night is yesterday 18:00 to this morning 06:00", () => {
  const now = new Date(2026, 9, 4, 9, 30).getTime();
  const n = lastNight(now);
  assert.equal(new Date(n.from).getHours(), 18);
  assert.equal(new Date(n.from).getDate(), 3);
  assert.equal(new Date(n.to).getHours(), 6);
  assert.equal(n.day, "2026-10-04");
});

test("made once, after the hour, only for horses with readings in the night; names cannot leave the folder", async () => {
  const at = (h, m = 0) => new Date(2026, 9, 4, h, m).getTime();
  const night = new Date(2026, 9, 3, 23, 0).toISOString();
  const horses = [{ id: "a", name: "Badal" }, { id: "b", name: "Noor" }];
  const readingsFor = (id) => (id === "a" ? [{ ts: night }] : []);
  const built = [];
  const args = (now, daily = true) => ({ settings: { reports: { daily, hour: 7 } }, horses, readingsFor, now,
    build: async (h, from, to) => { built.push([h.name, new Date(from).getHours(), new Date(to).getHours()]); return `<p>${h.name}</p>`; },
    pdf: async (html) => Buffer.from(`%PDF ${html}`) });
  assert.equal(await dailyTick(args(at(8), false)), 0, "switched off");
  assert.equal(await dailyTick(args(at(6, 30))), 0, "before 07:00");
  assert.equal(await dailyTick(args(at(7, 1))), 1);
  assert.deepEqual(built, [["Badal", 18, 6]]);
  assert.equal(await dailyTick(args(at(8))), 0, "once a day");
  const list = listDaily();
  assert.deepEqual(list.map((d) => [d.day, d.files.map((f) => f.name)]), [["2026-10-04", ["Badal.pdf"]]]);
  assert.match(readFileSync(dailyPath("2026-10-04", "Badal.pdf"), "utf8"), /^%PDF <p>Badal/);
  assert.equal(dailyPath("2026-10-04", "../../secret.pdf"), null);
  assert.equal(dailyPath("..", "Badal.pdf"), null);
});
