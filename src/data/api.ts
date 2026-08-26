// Thin client for the EquiCare backend. Sensor-derived data (horses' live
// status + alerts + dashboard series) comes from here when a backend is
// reachable; callers fall back to the bundled mock seeds when it is not, so the
// standalone demo keeps working offline / on Vercel with no API configured.
import type { Horse, Alert } from "./mock";

// In dev, default to the local backend; in prod, only call an API if one is
// configured via VITE_API_URL (otherwise stay fully on mock data).
const BASE = (
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (import.meta.env.DEV ? "http://127.0.0.1:8080" : "")
).replace(/\/$/, "");

export const apiConfigured = BASE.length > 0;

/* --- session --------------------------------------------------------------
   The API token used to come from VITE_API_TOKEN, which Vite compiles into the
   JS bundle — anyone opening devtools on the deployed site had full API access.
   The token is now a per-user session issued by /auth/login and held only in
   this browser. */
const SESSION_KEY = "bsv-session";

export interface SessionUser {
  id: string; username: string; name: string;
  role: "admin" | "staff" | "owner"; owner: string | null;
}

let token: string | null = null;
try {
  token = localStorage.getItem(SESSION_KEY);
} catch {
  /* private mode — stay in memory for this tab */
}

export const getToken = () => token;
function setToken(value: string | null) {
  token = value;
  try {
    if (value) localStorage.setItem(SESSION_KEY, value);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* in-memory only */
  }
}

const authHeaders = (): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

/** Sign in. Returns the user on success, or an error message. */
export async function login(username: string, password: string):
  Promise<{ user?: SessionUser; error?: string }> {
  if (!apiConfigured) return { error: "No backend configured" };
  try {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=utf8" },
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body.error ?? `Sign-in failed (${res.status})` };
    setToken(body.token);
    return { user: body.user as SessionUser };
  } catch {
    return { error: "Cannot reach the server" };
  }
}

export async function logout(): Promise<void> {
  if (apiConfigured && token) {
    try {
      await fetch(`${BASE}/auth/logout`, { method: "POST", headers: authHeaders() });
    } catch {
      /* clear locally regardless */
    }
  }
  setToken(null);
}

/** Who am I? `authRequired:false` means the backend is open (local demo). */
export async function me(): Promise<{ user: SessionUser | null; authRequired: boolean }> {
  if (!apiConfigured) return { user: null, authRequired: false };
  try {
    const res = await fetch(`${BASE}/auth/me`, { headers: authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { user: body.user as SessionUser, authRequired: true };
    if (res.status === 401 && body.authRequired === false)
      return { user: null, authRequired: false };
    setToken(null);                       // stale/expired session
    return { user: null, authRequired: body.authRequired ?? true };
  } catch {
    return { user: null, authRequired: false };   // offline → mock mode
  }
}

async function get<T>(path: string): Promise<T | null> {
  if (!apiConfigured) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${BASE}${path}`, { signal: ctrl.signal, headers: authHeaders() });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // offline / not reachable -> caller keeps mock
  }
}

// Which of the 12 monitoring points are actually live vs awaiting hardware.
export interface CoverageRow {
  point: number;
  metric: string;
  label: string;
  source: string;
  status: "available" | "pending";
}
export const getCoverage = () => get<CoverageRow[]>("/api/coverage");

// Per-horse live detail (summary + latest vitals + 7-day charts).
export interface HorseDetail {
  vitals: Record<string, { value: number; unit: string | null; ts: string; source: string | null; confidence: number }>;
  charts: Record<string, number[]>;
}
export const getHorseDetail = (id: string) =>
  get<HorseDetail & Record<string, unknown>>(`/api/horses/${encodeURIComponent(id)}`);

export const getHorses = () => get<Horse[]>("/api/horses");
export const getAlerts = () => get<Alert[]>("/api/alerts");
export const getSeries = (days = 7) =>
  get<Record<string, number[]>>(`/api/series?days=${days}`);

export async function ackAlert(id: string): Promise<void> {
  if (!apiConfigured) return;
  try {
    await fetch(`${BASE}/api/alerts/${encodeURIComponent(id)}/ack`, {
      method: "POST",
      headers: authHeaders(),
    });
  } catch {
    /* best-effort; UI already updated optimistically */
  }
}

/* ---------------------------------------------------------------------------
   Record collections (horses, diary, health, feed, invoices, breeding).
   Writes are fire-and-forget from the caller's perspective: the store updates
   optimistically and these persist to the backend. With no backend configured
   every call is a no-op, so the standalone prototype behaves exactly as before.
--------------------------------------------------------------------------- */
export type Kind =
  | "horses" | "diary" | "health" | "feed" | "invoices" | "coverings" | "stallions";

export const getEntities = <T,>(kind: Kind) => get<T[]>(`/api/${kind}`);

async function send<T>(method: string, path: string, body?: unknown): Promise<T | null> {
  if (!apiConfigured) return null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json;charset=utf8", ...authHeaders() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // offline — the optimistic local update stands
  }
}

export const createEntity = <T,>(kind: Kind, body: unknown) =>
  send<T>("POST", `/api/${kind}`, body);

export const patchEntity = <T,>(kind: Kind, id: string, patch: unknown) =>
  send<T>("PATCH", `/api/${kind}/${encodeURIComponent(id)}`, patch);

export const deleteEntity = (kind: Kind, id: string) =>
  send<{ ok: boolean }>("DELETE", `/api/${kind}/${encodeURIComponent(id)}`);
