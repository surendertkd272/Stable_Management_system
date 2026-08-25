// Tests for the record-collection layer and notification dispatch — the parts
// added when the app moved from "reads live, writes to localStorage" to a real
// write path.  Run: node --test server/
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE = join(HERE, "data", "state.json");

let createStore, buildSeries;
before(async () => {
  rmSync(STATE, { force: true });               // isolate from dev state
  delete process.env.DATABASE_URL;              // force the JSON store
  ({ createStore } = await import("./store.mjs"));
  ({ buildSeries } = await import("./rollup.mjs"));
});
after(() => rmSync(STATE, { force: true }));

// --------------------------------------------------------------------------- //
test("entity create / list / update / remove round-trips", async () => {
  const s = await createStore();
  assert.deepEqual(s.list("diary"), []);

  const row = s.create("diary", { horse: "Zarina", note: "vet visit" });
  assert.ok(row.id, "create must assign an id");
  assert.equal(s.list("diary").length, 1);

  const patched = s.update("diary", row.id, { note: "vet visit — done" });
  assert.equal(patched.note, "vet visit — done");
  assert.equal(patched.id, row.id, "id must not change on update");

  assert.equal(s.update("diary", "nope", { x: 1 }), null, "unknown id -> null");
  assert.equal(s.remove("diary", "nope"), false, "unknown id -> false");
  assert.equal(s.remove("diary", row.id), true);
  assert.equal(s.list("diary").length, 0);
});

test("a client-supplied id is honoured, so patch and delete can find the row", async () => {
  const s = await createStore();
  // The SPA generates the id and sends it; if the server minted its own the
  // client's later patch/delete would 404 and the record would resurrect.
  const row = s.create("feed", { id: "feed-client-1", horse: "Shaan", feed: "Oats" });
  assert.equal(row.id, "feed-client-1");
  assert.ok(s.update("feed", "feed-client-1", { amount: "2 kg" }));
  assert.equal(s.remove("feed", "feed-client-1"), true);
});

test("seed only populates an empty collection", async () => {
  const s = await createStore();
  s.seed("horses", [{ id: "a", name: "A" }]);
  s.seed("horses", [{ id: "b", name: "B" }, { id: "c", name: "C" }]);
  assert.equal(s.list("horses").length, 1, "second seed must not overwrite existing rows");
  assert.equal(s.list("horses")[0].id, "a");
});

test("a horse added at runtime enters the monitoring rollup", async () => {
  const s = await createStore();
  s.seed("horses", [{ id: "zarina", name: "Zarina", stall: "A-04" }]);
  s.create("horses", { id: "kesar", name: "Kesar", stall: "D-01" });
  const ids = s.list("horses").map((h) => h.id);
  assert.ok(ids.includes("kesar"),
    "the roster must be data, not a frozen file — otherwise a UI-created horse is never monitored");
});

test("entity counts are reported in the store summary", async () => {
  const s = await createStore();
  s.create("invoices", { owner: "X", amount: 1 });
  assert.ok(s.statsSummary().entities.invoices >= 1);
});

// --------------------------------------------------------------------------- //
test("buildSeries honours the requested span", () => {
  const roster = [{ id: "h1", name: "H1" }];
  for (const span of [7, 14, 30]) {
    const s = buildSeries(roster, [], span);
    for (const k of ["monitored", "rest", "water", "outside", "alerts"])
      assert.equal(s[k].length, span, `${k} should have ${span} points`);
  }
});

test("notify dispatches each alert once and respects severity threshold", async () => {
  const { dispatch, notifyStatus } = await import("./notify.mjs");
  const alerts = [
    { id: "a:1", horse: "A", severity: "alert", type: "Fever", detail: "", time: "", acknowledged: false },
    { id: "w:1", horse: "B", severity: "warn",  type: "Water", detail: "", time: "", acknowledged: false },
    { id: "k:1", horse: "C", severity: "alert", type: "Cold",  detail: "", time: "", acknowledged: true },
  ];
  const first = await dispatch(alerts);
  assert.equal(first, 1, "only the unacknowledged 'alert' should notify at default threshold");

  const second = await dispatch(alerts);
  assert.equal(second, 0, "re-dispatching the same alerts must not re-notify");
  assert.ok(notifyStatus().notified >= 1);
});
