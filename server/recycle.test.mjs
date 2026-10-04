// Deleting a horse: 30 days in the recycle bin, restorable with its readings,
// then gone for good. Administrators only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DATA = mkdtempSync(join(tmpdir(), "equicare-bin-"));
let handle, recycle;
const tokens = {};
const call = async (method, path, { token = tokens.admin, body } = {}) => {
  const res = await handle(new Request(`http://local${path}`, { method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
};
before(async () => {
  process.env.EQUICARE_DATA_DIR = DATA;
  process.env.ADMIN_PASSWORD = "test-admin-pw";
  delete process.env.DATABASE_URL; delete process.env.VERCEL; delete process.env.AUTH_INGEST_TOKEN;
  ({ handle } = await import("./app.mjs"));
  tokens.admin = (await call("POST", "/auth/login", { token: null, body: { username: "admin", password: "test-admin-pw" } })).body.token;
  await call("POST", "/api/users", { body: { username: "st", password: "pw-st", role: "staff", name: "s" } });
  tokens.staff = (await call("POST", "/auth/login", { token: null, body: { username: "st", password: "pw-st" } })).body.token;
  await call("POST", "/ingest/readings", { token: null, body: { readings: [{ stallId: "A-04", metric: "activity_index", value: 0.2, ts: new Date().toISOString() }] } });
});
after(() => rmSync(DATA, { recursive: true, force: true }));

test("only an administrator can delete a horse", async () => {
  assert.equal((await call("DELETE", "/api/horses/zarina", { token: tokens.staff })).status, 403);
  assert.equal((await call("DELETE", "/api/horses/nobody")).status, 404);
});

test("a deleted horse leaves the roster and waits 30 days in the bin, with its readings", async () => {
  const r = await call("DELETE", "/api/horses/zarina");
  assert.equal(r.status, 200);
  assert.equal(r.body.bin.daysLeft, 30);
  const roster = (await call("GET", "/api/horses")).body.map((h) => h.id);
  assert.ok(!roster.includes("zarina"));
  const bin = (await call("GET", "/api/bin/horses")).body;
  assert.equal(bin[0].name, "Zarina");
  assert.equal(bin[0].readings, 1, "its readings are kept while it is in the bin");
});

test("restored: back on the roster with its readings; a stall given away meanwhile is not taken back", async () => {
  await call("POST", "/api/horses", { body: { name: "Newcomer", stall: "A-04" } });
  const bin = (await call("GET", "/api/bin/horses")).body;
  const r = await call("POST", `/api/bin/horses/${bin[0].id}/restore`);
  assert.equal(r.status, 200);
  assert.equal(r.body.horse.stall, "—");
  assert.deepEqual(r.body.stallFreed, { stall: "A-04", nowWith: "Newcomer" });
  const z = (await call("GET", "/api/horses/zarina")).body;
  assert.equal(z.name, "Zarina");
  assert.equal((await call("GET", "/api/bin/horses")).body.length, 0);
});

test("deleted for good: now, or by itself after 30 days — readings too", async () => {
  await call("DELETE", "/api/horses/zarina");
  const id = (await call("GET", "/api/bin/horses")).body[0].id;
  const r = await call("DELETE", `/api/bin/horses/${id}`);
  assert.equal(r.body.deletedReadings, 1);
  assert.equal((await call("POST", `/api/bin/horses/${id}/restore`)).status, 404);
  // the 30-day rule
  await call("DELETE", "/api/horses/shaan");
  const { recycleApi } = await import("./recycle.mjs");
  const g = globalThis.__equicare;
  assert.equal(g.recycle.purgeExpired(Date.now() + 29 * 86400e3), 0);
  assert.equal(g.recycle.purgeExpired(Date.now() + 31 * 86400e3), 1);
  assert.equal((await call("GET", "/api/bin/horses")).body.length, 0);
  void recycleApi;
});
