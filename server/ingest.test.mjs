// Ingest attribution and CSV export.
//
// A camera knows its STALL, not which horse is standing in it, and horses change
// stalls routinely. Before this, a stall-only reading was reported as accepted
// and then never reached any horse — a fever could vanish with a 200 OK.
import { test } from "node:test";
import assert from "node:assert/strict";

const ROSTER = [
  { id: "zarina", name: "Zarina", stall: "A-04" },
  { id: "shaan", name: "Shaan", stall: "B-01" },
  { id: "nostall", name: "NoStall" },              // horse with no stall assigned
];

// mirrors the resolution in index.mjs
function attribute(batch, roster) {
  const byStall = new Map(roster.filter((h) => h.stall).map((h) => [h.stall, h.id]));
  const clean = [], unattributed = [];
  for (const r of batch) {
    if (r.horseId) { clean.push(r); continue; }
    const horseId = r.stallId ? byStall.get(r.stallId) : undefined;
    if (horseId) clean.push({ ...r, horseId });
    else unattributed.push(r.stallId ?? null);
  }
  return { clean, unattributed };
}

test("a stall-only reading is attributed to the horse in that stall", () => {
  const { clean, unattributed } = attribute(
    [{ stallId: "A-04", metric: "body_temp_c", value: 39.5 }], ROSTER);
  assert.equal(clean.length, 1);
  assert.equal(clean[0].horseId, "zarina");
  assert.equal(unattributed.length, 0);
});

test("an explicit horseId always wins over the stall lookup", () => {
  const { clean } = attribute(
    [{ horseId: "shaan", stallId: "A-04", metric: "steps", value: 10 }], ROSTER);
  assert.equal(clean[0].horseId, "shaan", "the edge must be able to override");
});

test("an unknown stall is reported, never silently accepted", () => {
  const { clean, unattributed } = attribute(
    [{ stallId: "Z-99", metric: "body_temp_c", value: 38 }], ROSTER);
  assert.equal(clean.length, 0, "it must not be stored against nobody");
  assert.deepEqual(unattributed, ["Z-99"], "the edge has to learn it was dropped");
});

test("a reading with neither horse nor stall is unattributed", () => {
  const { clean, unattributed } = attribute([{ metric: "body_temp_c", value: 38 }], ROSTER);
  assert.equal(clean.length, 0);
  assert.deepEqual(unattributed, [null]);
});

test("moving a horse re-points its stall without touching history", () => {
  const moved = ROSTER.map((h) => (h.id === "zarina" ? { ...h, stall: "D-07" } : h));
  assert.equal(attribute([{ stallId: "D-07", metric: "x", value: 1 }], moved).clean[0].horseId, "zarina");
  // the vacated stall must not keep resolving to the horse that left
  assert.deepEqual(attribute([{ stallId: "A-04", metric: "x", value: 1 }], moved).unattributed, ["A-04"]);
});

// --------------------------------------------------------------------------- //
// CSV: a crafted value must not become an executable formula when a vet opens
// the export in Excel or Sheets.
function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Undo RFC-4180 quoting, to inspect the value a spreadsheet will actually see. */
function unquote(cell) {
  return cell.startsWith('"') && cell.endsWith('"')
    ? cell.slice(1, -1).replace(/""/g, '"')
    : cell;
}

test("CSV neutralises formula injection", () => {
  // A value containing commas/quotes is ALSO RFC-4180 quoted, so the guard
  // apostrophe sits inside the quoting — assert on the unquoted value, which is
  // what the spreadsheet evaluates.
  for (const bad of ['=HYPERLINK("http://evil","x")', "+1+1", "-2+3", "@SUM(A1)", "\t=1+1"])
    assert.ok(unquote(csvCell(bad)).startsWith("'"),
      `${bad} must be prefixed; got ${csvCell(bad)}`);

  // and the original text is preserved after the guard character
  assert.equal(unquote(csvCell("+1+1")), "'+1+1");
  assert.equal(unquote(csvCell('=HYPERLINK("http://evil","x")')), '\'=HYPERLINK("http://evil","x")');
});

test("CSV quotes separators, quotes and newlines", () => {
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(0), "0", "zero must not be treated as empty");
});
