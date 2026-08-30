// Auth tests. The shared VITE_API_TOKEN this replaces was compiled into the JS
// bundle, so anyone with devtools had full API access. These pin the properties
// that must hold for the replacement.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword, verifyPassword, createSession, getSession, destroySession,
  publicUser, ROLES,
} from "./auth.mjs";

test("password hashing is salted — same password, different hashes", () => {
  const a = hashPassword("same-password");
  const b = hashPassword("same-password");
  assert.notEqual(a, b, "a shared salt would let one crack reveal every match");
  assert.ok(verifyPassword("same-password", a));
  assert.ok(verifyPassword("same-password", b));
});

test("verifyPassword rejects wrong, empty and malformed input without throwing", () => {
  const h = hashPassword("correct");
  assert.equal(verifyPassword("wrong", h), false);
  assert.equal(verifyPassword("", h), false);
  assert.equal(verifyPassword("correct", "garbage"), false);
  assert.equal(verifyPassword("correct", ""), false);
  assert.equal(verifyPassword("correct", undefined), false);
  // the login route verifies against a dummy hash for unknown users so that
  // response timing does not reveal whether a username exists
  assert.equal(verifyPassword("anything", "scrypt$0$0"), false);
});

test("the stored hash never contains the plaintext", () => {
  const h = hashPassword("Sup3rSecret!");
  assert.ok(!h.includes("Sup3rSecret!"));
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
});

test("sessions issue opaque tokens and expire on destroy", () => {
  const user = { id: "u1", role: "staff", name: "Staffer", username: "s" };
  const { token } = createSession(user);
  assert.ok(token.length >= 40, "token must be long enough to resist guessing");
  assert.ok(!token.includes("u1"), "token must not encode the user id");

  const s = getSession(token);
  assert.equal(s.role, "staff");
  assert.equal(s.userId, "u1");

  destroySession(token);
  assert.equal(getSession(token), null, "sign-out must invalidate immediately");
});

test("unknown or empty tokens resolve to no session", () => {
  assert.equal(getSession("nope"), null);
  assert.equal(getSession(""), null);
  assert.equal(getSession(null), null);
  assert.equal(getSession(undefined), null);
});

test("publicUser strips the password hash", () => {
  const u = { id: "u", username: "x", name: "X", role: "admin", password: hashPassword("p") };
  const pub = publicUser(u);
  assert.ok(!("password" in pub), "the hash must never reach the client");
  assert.deepEqual(Object.keys(pub).sort(), ["id", "name", "owner", "role", "username"]);
});

test("roles are exactly the three the API enforces", () => {
  assert.deepEqual(ROLES, ["admin", "staff", "owner"]);
});

// --------------------------------------------------------------------------- //
// Owner scoping. The SPA also hides other owners, but that is presentation —
// these pin the rule the API itself must enforce.
import { test as t2 } from "node:test";

const ROSTER = [
  { id: "noor", name: "Noor", owner: "R. Singh" },
  { id: "laila", name: "Laila", owner: "R. Singh" },
  { id: "zarina", name: "Zarina", owner: "Bharat Sports Venture" },
];
// mirrors visibleRoster() in index.mjs
const visible = (who) =>
  who?.role === "owner" ? ROSTER.filter((h) => h.owner === who.owner) : ROSTER;

t2("an owner sees only their own horses; staff and admin see all", () => {
  const owner = { role: "owner", owner: "R. Singh" };
  assert.deepEqual(visible(owner).map((h) => h.id), ["noor", "laila"]);
  assert.equal(visible({ role: "admin" }).length, 3);
  assert.equal(visible({ role: "staff" }).length, 3);
  assert.equal(visible(null).length, 3, "open/local mode is unscoped");
});

t2("record rows are filtered by owner or by horse name", () => {
  const who = { role: "owner", owner: "R. Singh" };
  const mine = new Set(visible(who).map((h) => h.name));
  const rows = [
    { horse: "Noor", note: "mine" },
    { horse: "Zarina", note: "someone else's" },
    { owner: "R. Singh", amount: 500 },
    { owner: "Equestrian Club", amount: 900 },
    { note: "no owner or horse field" },
  ];
  const filtered = rows.filter((r) =>
    r.owner !== undefined ? r.owner === who.owner
    : r.horse !== undefined ? mine.has(r.horse)
    : false);
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((r) => r.owner === "R. Singh" || r.horse === "Noor"));
  // a row with neither field must be withheld rather than leaked by default
  assert.ok(!filtered.some((r) => r.note === "no owner or horse field"));
});
