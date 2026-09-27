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
  status: "available" | "prototype" | "model-pending" | "pending";
}
export const getCoverage = () => get<CoverageRow[]>("/api/coverage");

/** Camera behaviour (prototype heuristics). null = not measured here. */
export interface HorseBehaviour {
  activity: { now: number; at: string; avg4h: number | null; baseline: number | null; unusual: "high" | "low" | null } | null;
  inactive: { todayMin: number; longestMin: number; periods: { start: string; end: string; minutes: number }[] } | null;
  urination: { count24h: number; last: string; times: string[] } | null;
  excretion: { count24h: number; last: string; times: string[] } | null;
  weaving: { count24h: number; last: string } | null;
  breathing: { regularity: number | null; method: string | null; at: string } | null;
}

// Per-horse live detail (summary + latest vitals + 7-day charts).
export interface HorseDetail {
  behaviour?: HorseBehaviour;
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

export interface RoiBox { x0: number; y0: number; x1: number; y1: number }
export interface CameraRois {
  /** A box read as its hottest pixel. Cameras calibrated before that hold a point. */
  eye: RoiBox | { x: number; y: number };
  nostril: RoiBox;
  /** Optional floor area for the urination/excretion detector. */
  floor?: RoiBox | null;
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
  /** "mtrpc" = the JSON-RPC firmware on the Sparsh demo unit; "auto" until detected. */
  protocol?: "auto" | "isapi" | "mtrpc";
  /** Keep thermal + visible video on the edge box for labelling. */
  record?: boolean;
  identity: { serial: string; model: string | null; firmware?: string | null; pinnedAt: string } | null;
  /** The last aim check: breathing found by the edge agent's own algorithm,
   *  against a hand count. Applies only while `roisAt` matches rois.pushedAt. */
  verification?: CameraVerification | null;
}
export interface CameraVerification {
  at: string; by: string;
  breathing: { bpm: number; periodicity: number | null; seconds: number | null; samples: number | null };
  handCountBpm: number | null; agrees: boolean | null;
  eyeC: number | null; nostrilSwingC: number | null; roisAt: string;
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
  /** mode "box-max": hottest pixel in the eye box, `at` where it is (0–10000). */
  eye: { c: number | null; at: { x: number; y: number } | null; mode: "box-max" | "point" } | null;
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
export const pushRois = (id: string, rois: Pick<CameraRois, "eye" | "nostril"> & { floor?: RoiBox | null }) =>
  call<{ ok: true; rois: CameraRois; verify: { verified: boolean | null; detail: string } }>("PUT", dpath(id, "rois"), rois, 30000);
/** Live ROI temperatures. `parts: "nostril"` is the fast path for the
 *  breathing check; `rois` measures boxes not yet pushed (JSON-RPC cameras
 *  are measured by EquiCare, so it can read any box while you aim). */
export const readCameraTemps = (id: string, opts: { parts?: "nostril"; rois?: { eye: RoiBox; nostril: RoiBox } } = {}) => {
  const q = new URLSearchParams();
  if (opts.parts) q.set("parts", opts.parts);
  if (opts.rois) {
    const b = (x: RoiBox) => [x.x0, x.y0, x.x1, x.y1].join(",");
    q.set("eye", b(opts.rois.eye));
    q.set("nostril", b(opts.rois.nostril));
  }
  return call<CameraTemps>("GET", dpath(id, "temps") + (q.size ? `?${q}` : ""));
};
/** Breathing check from the thermal video (JSON-RPC cameras): a job the
 *  calibrator polls for its trace and verdict. */
export interface BreathingJob {
  id: string; state: "running" | "done" | "failed"; error: string | null;
  elapsed: number; seconds: number; samples: number; trace: number[];
  result: { bpm: number | null; periodicity: number; samples: number; seconds: number; swing: number; method: string } | null;
}
export const startBreathingCheck = (id: string, nostril: RoiBox, seconds = 60) =>
  call<BreathingJob>("POST", dpath(id, "breathing"), { nostril, seconds }, 30000);
export const breathingCheckStatus = (id: string, job: string) =>
  call<BreathingJob>("GET", `${dpath(id, "breathing")}/${encodeURIComponent(job)}`);

export const saveVerification = (id: string, v: {
  breathing: { bpm: number; periodicity: number; seconds: number; samples: number };
  handCountBpm: number | null; eyeC: number | null; nostrilSwingC: number | null;
}) => call<CameraVerification>("POST", dpath(id, "verification"), v);

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

/* --- recorded footage and labels (training data) ------------------------- */
export interface FootageStreamRef { start: string; at: string; bytes: number }
export interface FootageClip {
  id: string; camera: string; cameraName: string; stall: string | null;
  start: string; at: string; end: string; recording: boolean; labels: number;
  thermal: FootageStreamRef | null; visible: FootageStreamRef | null;
}
export interface LabelDef { key: string; name: string; kind: "interval" | "moment"; shortcut: string }
export interface FootageLabel {
  id: string; camera: string; clip: string; label: string; startAt: string; endAt: string | null;
  note: string; horse: string | null; stall: string | null; by: string; createdAt: string;
}
export const listFootage = () => call<{ clips: FootageClip[]; cameras: { id: string; name: string; stall: string | null }[] }>("GET", "/api/footage");
export const footageTicket = () => call<{ ticket: string; expiresInS: number }>("GET", "/api/footage/ticket");
export const labelVocabulary = () => call<LabelDef[]>("GET", "/api/footage/labels/meta");
export const footageLabels = (camera: string, from?: string, to?: string) => {
  const q = new URLSearchParams({ camera });
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  return call<FootageLabel[]>("GET", `/api/footage/labels?${q}`);
};
export const createFootageLabel = (l: { camera: string; clip: string; label: string; startAt: string; endAt?: string | null; note?: string }) =>
  call<FootageLabel>("POST", "/api/footage/labels", l);
export const deleteFootageLabel = (id: string) => call<{ ok: true }>("DELETE", `/api/footage/labels/${encodeURIComponent(id)}`);
/** URL a <video> element can play: carries the short-lived ticket, not the session. */
export const footageVideoUrl = (camera: string, stream: "thermal" | "visible", start: string, ticket: string, h264 = false) =>
  `${BASE}/api/footage/video/${encodeURIComponent(camera)}/${stream}/${encodeURIComponent(start)}?vt=${encodeURIComponent(ticket)}${h264 ? "&format=h264" : ""}`;
/** Download all labels as CSV (authenticated, so fetched as a blob). */
export async function exportFootageLabels(): Promise<boolean> {
  if (!apiConfigured) return false;
  try {
    const res = await fetch(`${BASE}/api/footage/labels/export`, { headers: authHeaders() });
    if (!res.ok) return false;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `equicare-labels-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

/** A box around a horse on one frame (fractions of the frame, 0–1). */
export interface FootageBox {
  id: string; camera: string; clip: string; stream: "thermal" | "visible"; at: string;
  x0: number; y0: number; x1: number; y1: number; label: string; horse: string | null; by: string;
}
export interface QueueItem {
  id: string; kind: string; at: string; reason: string; detail: string; camera: string; clip: string;
  status: "pending" | "done" | "skipped"; by: string | null;
}
export const footageBoxes = (camera: string, from?: string, to?: string) => {
  const q = new URLSearchParams({ camera });
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  return call<FootageBox[]>("GET", `/api/footage/boxes?${q}`);
};
export const createFootageBox = (b: Omit<FootageBox, "id" | "by">) => call<FootageBox>("POST", "/api/footage/boxes", b);
export const deleteFootageBox = (id: string) => call<{ ok: true }>("DELETE", `/api/footage/boxes/${encodeURIComponent(id)}`);
export const labellingQueue = (camera: string, status: "pending" | "done" | "skipped" | "all" = "pending") =>
  call<{ items: QueueItem[]; counts: Record<string, number> }>("GET", `/api/footage/queue?camera=${encodeURIComponent(camera)}&status=${status}`);
export const setQueueStatus = (id: string, status: "done" | "skipped" | "pending") =>
  call<{ ok: true }>("POST", `/api/footage/queue/${encodeURIComponent(id)}`, { status });
/** Download all boxes as JSON (frames with their clip file and offset). */
export async function exportFootageBoxes(): Promise<boolean> {
  if (!apiConfigured) return false;
  try {
    const res = await fetch(`${BASE}/api/footage/boxes/export`, { headers: authHeaders() });
    if (!res.ok) return false;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `equicare-boxes-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
