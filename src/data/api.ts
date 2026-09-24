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
  vitals: Record<string, { value: number; unit: string | null; ts: string; source: string | null; confidence: number; calibrated?: boolean }>;
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

/* --- hardware devices --------------------------------------------------------
   Every device runs through the site server, which is the only thing that can
   reach the barn LAN. The browser never sees a camera password or a device
   token after it is first shown — only `hasPassword` / `hasToken`. */
export type DeviceKind = "edge_box" | "thermal_camera" | "modbus_sensor" | "push_device";
export type DeviceState =
  | "online" | "offline" | "never" | "disabled" | "unassigned" | "edge-offline"
  | "needs-calibration" | "error" | "stale" | "waiting" | "silent";
export interface DeviceStatus { state: DeviceState; detail: string }
export interface DeviceHealth { at: string; ok: boolean | null; error: string | null; code: string | null }

export interface CameraRois {
  eye: { x: number; y: number };
  nostril: { x0: number; y0: number; x1: number; y1: number };
  pushedAt?: string;
  /** true = read back and matched; null = the camera does not report coordinates */
  verified?: boolean | null;
  /** set when the camera was moved or its optics changed after calibrating */
  stale?: boolean;
}
export interface ProbeStep { name: string; ok: boolean; detail: string; ms: number; code?: string }
export interface CameraProbe {
  at: string; ok: boolean; steps: ProbeStep[];
  device: Record<string, string> | null;
}
export interface SensorValue { name: string; metric: string; unit?: string; raw?: number; value?: number; ok: boolean; error?: string }
export interface SensorProbe { at: string; ok: boolean; values: SensorValue[]; error?: string }

export interface ModbusRegister {
  name: string; address: number;
  type: "uint16" | "int16" | "uint32" | "int32" | "float32";
  wordOrder: "high-first" | "low-first";
  scale: number; offset: number; metric: string; unit: string;
  /** counter = a running total (litres dispensed); readings are the increase */
  mode: "gauge" | "counter";
}

interface DeviceCommon {
  id: string; kind: DeviceKind; name: string; enabled: boolean; notes: string;
  status: DeviceStatus; createdAt: string; updatedAt?: string;
  lastSeen: string | null; health: DeviceHealth | null;
  hasToken: boolean; tokenHint?: string;
}
export interface EdgeBox extends DeviceCommon {
  kind: "edge_box"; location: string;
  agent?: { version: string; host: string; uptimeS: number; reportedAt: string };
}
export interface ThermalCamera extends DeviceCommon {
  kind: "thermal_camera"; stall: string; edgeId: string | null;
  host: string; httpPort: number; https: boolean; rtspPort: number; modbusPort: number;
  username: string; hasPassword: boolean;
  variant: "256" | "384" | "640"; thermalLens: string; visibleLens: string;
  distanceM: number; emissivity: number;
  rois: CameraRois | null; lastProbe: CameraProbe | null;
  identity: { serial: string; model: string | null; firmware?: string | null; pinnedAt: string } | null;
}
export interface ModbusSensor extends DeviceCommon {
  kind: "modbus_sensor"; stall: string; edgeId: string | null;
  host: string; port: number; unitId: number; function: 3 | 4;
  addressing: "zero-based" | "one-based"; pollSeconds: number;
  registers: ModbusRegister[]; lastProbe: SensorProbe | null;
}
export interface PushDevice extends DeviceCommon {
  kind: "push_device"; stall: string; metrics: string[];
}
export type Device = EdgeBox | ThermalCamera | ModbusSensor | PushDevice;

/** What an owner account receives: status only, no address or credentials. */
export interface OwnerDevice {
  id: string; kind: Exclude<DeviceKind, "edge_box">; name: string; stall: string;
  status: DeviceState; calibrated: boolean | null;
}
export interface DeviceEvent { id: string; deviceId: string; device: string; at: string; actor: string; action: string; detail: string }
export interface CameraTemps {
  at: string;
  eye: { c: number | null } | null;
  nostril: { avgC: number | null; minC: number | null; maxC: number | null } | null;
}
/** Fields an admin sends when adding or editing a device (password only for cameras). */
export type DeviceInput = { kind: DeviceKind; password?: string } & Record<string, unknown>;

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

const dpath = (id: string, action = "") => `/api/devices/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;

export const listDevices = () => call<Device[]>("GET", "/api/devices");
/** Owner accounts get the status-only projection. */
export const listOwnerDevices = () => call<OwnerDevice[]>("GET", "/api/devices");
/** `token` is returned exactly once, for edge boxes and push devices. */
export const createDevice = (d: DeviceInput) => call<{ device: Device; token: string | null }>("POST", "/api/devices", d);
export const updateDevice = (id: string, d: Partial<DeviceInput>) => call<Device>("PATCH", dpath(id), d);
export const deleteDevice = (id: string, force = false) =>
  call<{ ok: true }>("DELETE", dpath(id) + (force ? "?force=1" : ""));
export const rotateToken = (id: string) => call<{ token: string }>("POST", dpath(id, "token"));
export const deviceEvents = (id: string) => call<DeviceEvent[]>("GET", dpath(id, "events"));
/** Camera connection test, or a Modbus test read. `acceptIdentity` confirms a replacement camera. */
export const probeDevice = (id: string, acceptIdentity = false) =>
  call<CameraProbe | SensorProbe>("POST", dpath(id, "probe") + (acceptIdentity ? "?acceptIdentity=1" : ""), undefined, 45000);
export const pushRois = (id: string, rois: Pick<CameraRois, "eye" | "nostril">) =>
  call<{ ok: true; rois: CameraRois; verify: { verified: boolean | null; detail: string } }>("PUT", dpath(id, "rois"), rois, 30000);
export const readCameraTemps = (id: string) => call<CameraTemps>("GET", dpath(id, "temps"));

/** Snapshot as an object URL. An <img src> cannot carry the Authorization
 *  header, so the image is fetched and handed to the page as a blob. */
export async function fetchSnapshot(id: string, dev: 0 | 1): Promise<{ url?: string; error?: string; status?: number }> {
  if (!apiConfigured) return { error: "demo mode — no server" };
  try {
    const res = await fetch(`${BASE}${dpath(id, "snapshot")}?dev=${dev}`, { headers: authHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body.error ?? `HTTP ${res.status}`, status: res.status };
    }
    return { url: URL.createObjectURL(await res.blob()) };
  } catch {
    return { error: "cannot reach the server" };
  }
}

/** The site server's own address, as the edge agent should use it. */
export const serverOrigin = () => BASE || (typeof window !== "undefined" ? window.location.origin : "http://<site-server>:8080");
