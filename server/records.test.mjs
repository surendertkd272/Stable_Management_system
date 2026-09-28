// Record collections over /api/<path>: health tasks live at /api/health-tasks,
// not /api/health (the server's status check, which used to swallow them).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DATA = mkdtempSync(join(tmpdir(), "equicare-records-"));
let handle, token;
const call = async (method, path, body) => {
  const res = await handle(new Request(`http://local${path}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json().catch(() => null) };
};

before(async () => {
  process.env.EQUICARE_DATA_DIR = DATA;
  process.env.ADMIN_PASSWORD = "test-admin-pw";
  ({ handle } = await import("./app.mjs"));
  token = (await call("POST", "/auth/login", { username: "admin", password: "test-admin-pw" })).body.token;
});
after(() => rmSync(DATA, { recursive: true, force: true }));

test("health tasks are saved, listed and updated at /api/health-tasks", async () => {
  assert.deepEqual((await call("GET", "/api/health-tasks")).body, [], "a new stable has none");
  const made = await call("POST", "/api/health-tasks", { horse: "Tara", type: "Vaccination", due: "2026-10-01" });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const list = (await call("GET", "/api/health-tasks")).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].type, "Vaccination");
  const patched = await call("PATCH", `/api/health-tasks/${list[0].id}`, { done: true });
  assert.equal(patched.status, 200);
  assert.equal((await call("GET", "/api/health-tasks")).body[0].done, true);
});

test("/api/health is still the status check", async () => {
  const r = await call("GET", "/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(!Array.isArray(r.body));
});
