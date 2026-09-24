// User accounts and sessions.
//
// Replaces the shared VITE_API_TOKEN, which was compiled into the JS bundle —
// anyone opening devtools on the deployed site had full API access.
//
// Passwords use scrypt from node:crypto (no dependency). Sessions are opaque
// random tokens held server-side; the browser only ever sees the token, never
// a password hash.
//
// Roles:
//   admin  full access, may manage users
//   staff  full read/write on horses and records
//   owner  read-only, and only their own horses (the Portal view)
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";

const SESSION_TTL_MS = 12 * 3600 * 1000;      // 12h — a barn shift
export const ROLES = ["admin", "staff", "owner"];

// ---- password hashing ----------------------------------------------------- //
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const attempt = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    // constant-time: a length mismatch alone must not short-circuit
    return attempt.length === expected.length && timingSafeEqual(attempt, expected);
  } catch {
    return false;
  }
}

// ---- sessions (in-process; a restart signs everyone out, which is fine) ---- //
// token -> { userId, role, name, expires }. On globalThis so every copy of this
// module in the process (Next.js bundles route handlers separately, and dev
// mode reloads them) sees the same sessions — otherwise signing in through
// /auth/login would issue a token the /api routes had never heard of.
const sessions = (globalThis.__equicareSessions ??= new Map());

function sweep() {
  const now = Date.now();
  for (const [t, s] of sessions) if (s.expires <= now) sessions.delete(t);
}

export function createSession(user) {
  sweep();
  const token = randomBytes(32).toString("base64url");
  sessions.set(token, {
    userId: user.id, role: user.role, name: user.name,
    owner: user.owner ?? null, expires: Date.now() + SESSION_TTL_MS,
  });
  return { token, expiresIn: SESSION_TTL_MS };
}

export function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expires <= Date.now()) { sessions.delete(token); return null; }
  return s;
}

export const destroySession = (token) => sessions.delete(token);
export const sessionCount = () => { sweep(); return sessions.size; };

// ---- bootstrap ------------------------------------------------------------ //
/** Ensure at least one admin exists, so a fresh deployment is reachable. */
export function ensureAdmin(store) {
  if (store.list("users").length) return null;
  const password = process.env.ADMIN_PASSWORD || randomBytes(9).toString("base64url");
  const user = store.create("users", {
    id: `user-${randomUUID().slice(0, 8)}`,
    username: process.env.ADMIN_USER || "admin",
    name: "Administrator",
    role: "admin",
    password: hashPassword(password),
  });
  // Printed once, at first boot only. Set ADMIN_PASSWORD to choose it yourself.
  console.log(`[auth] created first admin '${user.username}' — password: ${password}`);
  console.log("[auth] change it after signing in; this is printed only once.");
  return { user, password };
}

/** Public shape — never leak the password hash. */
export const publicUser = (u) =>
  u && { id: u.id, username: u.username, name: u.name, role: u.role, owner: u.owner ?? null };
