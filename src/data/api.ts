// Thin client for the EquiCare backend. Sensor-derived data (horses' live
// status + alerts + dashboard series) comes from here when a backend is
// reachable; callers fall back to the bundled mock seeds when it is not, so the
// standalone demo keeps working offline / on Vercel with no API configured.
import type { Horse, Alert } from "./mock";

// The backend now ships inside this Next.js app, so by default the browser
// calls it on the same origin. NEXT_PUBLIC_API_URL points it elsewhere (a
// separately hosted backend). Demo mode — no API calls at all, bundled mock
// data only — is on automatically for a Vercel deployment with no external
// backend (see next.config.ts), which is exactly the public demo today.
const BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
export const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
export const apiConfigured = !demoMode;

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
    if (res.status === 503) return { user: null, authRequired: false };
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
  // "model-pending" = camera is installed, but the CV model for this point
  // is not trained yet. Distinct from "pending", where there is no sensor.
  status: "available" | "model-pending" | "pending";
}
export const getCoverage = () => get<CoverageRow[]>("/api/coverage");

// Per-horse live detail (summary + latest vitals + 7-day charts).
export interface HorseDetail {
  vitals: Record<string, { value: number; unit: string | null; ts: string; source: string | null; confidence: number }>;
  // null entries are days with no reading — never render them as zero.
  charts: Record<string, (number | null)[]>;
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

/** Download raw readings as CSV. Returns false when no backend is configured. */
export async function exportReadingsCsv(horseId: string, days = 30): Promise<boolean> {
  if (!apiConfigured) return false;
  try {
    const res = await fetch(
      `${BASE}/api/export/readings.csv?horse=${encodeURIComponent(horseId)}&days=${days}`,
      { headers: authHeaders() }
    );
    if (!res.ok) return false;
    // The endpoint is authenticated, so a plain link cannot carry the session
    // token — fetch the body and hand the browser a blob instead.
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `equicare-${horseId}-${days}d.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

/* --- cameras (hardware integration) ----------------------------------------
   Everything here runs through the site server, which is the only thing that
   can reach cameras on the barn LAN. The browser never sees a camera password —
   only `hasPassword`. */
export interface CameraRois {
  eye: { x: number; y: number };
  nostril: { x0: number; y0: number; x1: number; y1: number };
  pushedAt?: string;
  /** set when the camera was moved or its optics changed after calibrating */
  stale?: boolean;
}
export interface ProbeStep { name: string; ok: boolean; detail: string; ms: number }
export interface CameraProbe {
  at: string; ok: boolean; steps: ProbeStep[];
  device: Record<string, string> | null;
}
export interface Camera {
  id: string; name: string; stall: string;
  host: string; httpPort: number; https: boolean; rtspPort: number; modbusPort: number;
  username: string; hasPassword: boolean;
  variant: "256" | "384" | "640"; thermalLens: string; visibleLens: string;
  distanceM: number; emissivity: number;
  rois: CameraRois | null; lastProbe: CameraProbe | null; createdAt: string;
}
/** What an owner account receives: status only, no address or credentials. */
export interface OwnerCamera {
  id: string; name: string; stall: string;
  online: boolean | null; checkedAt: string | null; calibrated: boolean;
}
export interface CameraTemps {
  at: string;
  eye: { c: number | null } | null;
  nostril: { avgC: number | null; minC: number | null; maxC: number | null } | null;
}
export type CameraInput = Omit<Camera, "id" | "hasPassword" | "rois" | "lastProbe" | "createdAt"> & { password?: string };

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string; details?: string[] };

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 20000): Promise<Result<T>> {
  if (!apiConfigured) return { ok: false, status: 0, error: "demo mode — no server" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      signal: ctrl.signal,
      headers: { ...authHeaders(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, error: data.error ?? `HTTP ${res.status}`, details: data.details };
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).name === "AbortError" ? "timed out" : "cannot reach the server" };
  } finally {
    clearTimeout(timer);
  }
}

export const listCameras = () => call<Camera[] | OwnerCamera[]>("GET", "/api/cameras");
export const createCamera = (c: CameraInput) => call<Camera>("POST", "/api/cameras", c);
export const updateCamera = (id: string, c: Partial<CameraInput>) =>
  call<Camera>("PATCH", `/api/cameras/${encodeURIComponent(id)}`, c);
export const deleteCamera = (id: string) => call<{ ok: true }>("DELETE", `/api/cameras/${encodeURIComponent(id)}`);
export const probeCamera = (id: string) => call<CameraProbe>("POST", `/api/cameras/${encodeURIComponent(id)}/probe`, undefined, 45000);
export const pushRois = (id: string, rois: Pick<CameraRois, "eye" | "nostril">) =>
  call<{ ok: true; rois: CameraRois }>("PUT", `/api/cameras/${encodeURIComponent(id)}/rois`, rois);
export const readCameraTemps = (id: string) => call<CameraTemps>("GET", `/api/cameras/${encodeURIComponent(id)}/temps`);

/** Snapshot as an object URL. An <img src> cannot carry the Authorization
 *  header, so the image is fetched and handed to the page as a blob. */
export async function fetchSnapshot(id: string, dev: 0 | 1): Promise<{ url?: string; error?: string }> {
  if (!apiConfigured) return { error: "demo mode — no server" };
  try {
    const res = await fetch(`${BASE}/api/cameras/${encodeURIComponent(id)}/snapshot?dev=${dev}`, { headers: authHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body.error ?? `HTTP ${res.status}` };
    }
    return { url: URL.createObjectURL(await res.blob()) };
  } catch {
    return { error: "cannot reach the server" };
  }
}
