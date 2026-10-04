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
  resting?: {
    lyingTodayMin: number; lateralTodayMin: number; lateralLast90Min: number; nightLyingMin: number;
    bouts24h: number; getUps24h: number; bouts: { start: string; end: string | null; minutes: number }[];
    longestBoutMin: number | null; nightsSeen: number; lowNights: number; rolls24h: number;
    lastRoll: string | null; lastCast: string | null;
  } | null;
  stream?: string | null;
  urination: FloorEvents | null;
  excretion: FloorEvents | null;
  weaving: ViceSummary | null;
  boxWalking?: ViceSummary | null;
  headTossing?: ViceSummary | null;
  breathing: { regularity: number | null; method: string | null; band?: string | null; intervalCv?: number | null; at: string } | null;
}
export interface FloorEvents {
  count24h: number; last: string; times: string[];
  lastConfidence?: number | null; lastHalfLifeMin?: number | null; tier?: string | null; baselinePerDay?: number | null;
}
export interface ViceSummary {
  count24h: number; last: string; minutes24h?: number; phases24h?: number; baselineMinPerDay?: number | null; isNew?: boolean;
}

/** Leg on which the trot analysis found the largest asymmetry. */
export type Limb = "LF" | "RF" | "LH" | "RH";
export type WearableSensor = "leg" | "head" | "pelvis";

/** From the wearable set (leg tag + halter hub + pelvis sensor). null = none
 *  of its readings for this horse. The 7-day arrays run oldest → today; null
 *  entries are days with no reading. Lameness and exercise are prototype. */
export interface HorseMotion {
  stepsToday: number | null; steps7d: (number | null)[];
  lameness: null | {
    at: string; limb: Limb | null; valueMm: number;
    headMinDiffMm: number | null; headMaxDiffMm: number | null; pelvisMinDiffMm: number | null; pelvisMaxDiffMm: number | null;
    /** baselineMm: median of this horse's earlier trots (14 days, ≥ 3), null until there are enough */
    strides: number | null; baselineMm: number | null; flagged: boolean;
  };
  lamenessRecent: { at: string; valueMm: number; limb: string | null }[];
  /** live = a session is open and its readings are < 5 min old */
  exercise: null | { at: string; minutes: number; steps: number | null; distanceM: number | null; live: boolean; speedMps: number | null };
  wearable: null | {
    lastSeen: string;
    sensors: { sensor: WearableSensor; batteryPct: number | null; signalDbm: number | null; attached: boolean | null; lastSeen: string }[];
  };
}
/** From the water meter / weighed bucket, weigh-back feeder and hay load cell.
 *  null = no water, feed or hay readings for this horse. */
export interface HorseIntake {
  waterTodayMl: number | null; water7dMl: (number | null)[]; drinksToday: number | null; lastDrinkAt: string | null;
  mealsToday: { at: string; meal: string | null; offeredG: number | null; eatenG: number | null; refusedG: number | null }[];
  hayTodayG: number | null; hay7dG: (number | null)[];
  faults: { at: string; kind: string }[];
}

// Per-horse live detail (summary + latest vitals + 7-day charts).
export interface HorseDetail {
  behaviour?: HorseBehaviour;
  /** breathing_check / eye_check (diagnostics) carry `detail`: how, or why the last minute had no reading.
   *  `where` (eye) and `box` (breathing) say where in the thermal view (0–10000) it was found. */
  vitals: Record<string, { value: number; unit: string | null; ts: string; source: string | null; confidence: number; calibrated?: boolean;
    detail?: string | null; method?: string; where?: { x: number; y: number }; box?: { x0: number; y0: number; x1: number; y1: number };
    /** horse_identity: is the horse in the stall this one (edge/identity.py)? */
    identity?: { verdict: "match" | "other" | "unsure" | "learning" | null; samples: number; best: string | null; bestScore: number | null } }>;
  // null entries are days with no reading — never render them as zero.
  charts: Record<string, (number | null)[]>;
  /** Absent from a server that predates the wearable / stall sensors. */
  motion?: HorseMotion | null;
  intake?: HorseIntake | null;
}
export const getHorseDetail = (id: string) =>
  get<HorseDetail & Record<string, unknown>>(`/api/horses/${encodeURIComponent(id)}`);

/** The server's status check. `storage` is absent from a server that predates it. */
export interface HealthStatus {
  ok: boolean; backend?: string; readings?: number; authRequired?: boolean;
  /** advice: set when the JSON store is dropping readings at its cap (use Postgres, DATABASE_URL) */
  storage?: { backend: string; readings: number; cap: number | null; droppedByCap: number; advice: string | null };
}
export const getHealth = () => get<HealthStatus>("/api/health");

export const getHorses = () => get<Horse[]>("/api/horses");
export const getAlerts = () => get<Alert[]>("/api/alerts");
/** Daily series for the yard, or for one horse when `horse` is given. */
export const getSeries = (days = 7, horse?: string) =>
  get<Record<string, (number | null)[]>>(`/api/series?days=${days}${horse ? `&horse=${encodeURIComponent(horse)}` : ""}`);

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

// Where each collection lives on the server (health tasks are not /api/health,
// the server's status check).
const kindPath = (kind: Kind) => (kind === "health" ? "health-tasks" : kind);

export const getEntities = <T,>(kind: Kind) => get<T[]>(`/api/${kindPath(kind)}`);

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
  send<T>("POST", `/api/${kindPath(kind)}`, body);

export const patchEntity = <T,>(kind: Kind, id: string, patch: unknown) =>
  send<T>("PATCH", `/api/${kindPath(kind)}/${encodeURIComponent(id)}`, patch);

export const deleteEntity = (kind: Kind, id: string) =>
  send<{ ok: boolean }>("DELETE", `/api/${kindPath(kind)}/${encodeURIComponent(id)}`);

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
export type DeviceKind = "edge_box" | "thermal_camera" | "modbus_sensor" | "push_device" | "wearable_hub";
export type DeviceState =
  | "online" | "offline" | "never" | "disabled" | "unassigned" | "edge-offline"
  | "needs-calibration" | "error" | "stale" | "waiting" | "silent";
export interface DeviceStatus { state: DeviceState; detail: string; warnings?: string[] }
export interface DeviceHealth { at: string; ok: boolean | null; error: string | null; code: string | null }

export interface RoiBox { x0: number; y0: number; x1: number; y1: number }
export interface CameraRois {
  /** A box read as its hottest pixel. Cameras calibrated before that hold a point. */
  eye: RoiBox | { x: number; y: number };
  nostril: RoiBox;
  /** Optional floor area for the urination/excretion detector. */
  floor?: RoiBox | null;
  /** Optional, on the COLOUR picture: the flank, for breathing from flank movement. */
  flank?: RoiBox | null;
  /** Optional, on the COLOUR picture: the floor watched for manure piles and wet bedding. */
  colourFloor?: RoiBox | null;
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
  /** What the edge box makes of it. Absent = the plain gauge / counter above.
   *  flow: a water meter's counter → drinking bouts · bucket: a water bucket's
   *  load cell · feed_bowl: a weigh-back feeder's bowl · hay: a hay net / rack
   *  load cell · fault: a feeder's fault-code register. */
  use?: RegisterUse;
}
export type RegisterUse = "flow" | "bucket" | "feed_bowl" | "hay" | "fault";

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
  /** Which picture behaviour is read from (colour: more detail, and the horse detector). */
  behaviourStream?: "visible" | "thermal";
  /** Colour stream: the camera's sub-stream (704x576) or full HD (1920x1080). */
  colourStream?: "sub" | "main";
  /** Floor cooling test results (urine / manure half-lives on this bedding). */
  floorCalib?: { urine?: FloorCalibEntry; manure?: FloorCalibEntry; deltaC?: number } | null;
  identity: { serial: string; model: string | null; firmware?: string | null; pinnedAt: string } | null;
  /** The last aim check: breathing found by the edge agent's own algorithm,
   *  against a hand count. Applies only while `roisAt` matches rois.pushedAt. */
  verification?: CameraVerification | null;
  /** A camera watching several stalls (and zooming in on each horse). */
  views?: ZoomView[] | null; ptz?: PtzSettings | null; schedule?: { closeEveryMin: number } | null;
}
// ---- one camera, several stalls (edge/multistall.py) ------------------------- //
export interface PtzSettings { protocol: "onvif"; port: number; path?: string }
/** One lens's part of a camera position: a preset saved on the camera, or pan/tilt/zoom. */
export interface PtzMove { profile: string; preset?: string; pan?: number | null; tilt?: number | null; zoom?: number | null }
export interface PtzPosition { moves: PtzMove[]; settleS?: number }
export interface ZoomZone {
  stall: string; colour: RoiBox; thermal?: RoiBox | null;
  rois?: { hay?: RoiBox | null; colourFloor?: RoiBox | null; flank?: RoiBox | null; floor?: RoiBox | null };
}
export type ZoomView =
  | { id: "wide"; kind: "wide"; position?: PtzPosition | null; zones: ZoomZone[]; pushedAt?: string }
  | { id: string; kind: "close"; stall: string; position?: PtzPosition | null; rois: { eye?: RoiBox | null; nostril?: RoiBox | null }; pushedAt?: string };
export interface ZoomSetup { ptz: PtzSettings | null; views: ZoomView[]; schedule: { closeEveryMin: number }; stalls?: string[] }
export interface PtzProfile { token: string; name: string; ptz: boolean; source: string | null }
export interface CameraVerification {
  at: string; by: string;
  breathing: { bpm: number; periodicity: number | null; seconds: number | null; samples: number | null };
  handCountBpm: number | null; agrees: boolean | null;
  eyeC: number | null; nostrilSwingC: number | null; roisAt: string;
}
export interface ModbusSensor extends DeviceCommon {
  kind: "modbus_sensor"; stall: string; edgeId: string | null;
  /** tcp (default, Modbus/TCP at host:port) or rtu (Modbus RTU over the edge
   *  box's RS-485 port — host/port unused). Absent on a server that predates it. */
  transport?: "tcp" | "rtu";
  host: string; port: number;
  serialPort?: string; baud?: number; parity?: "N" | "E" | "O"; stopBits?: 1 | 2;
  unitId: number; function: 3 | 4;
  addressing: "zero-based" | "one-based"; pollSeconds: number;
  registers: ModbusRegister[]; lastProbe: SensorProbe | null;
}
export interface PushDevice extends DeviceCommon {
  kind: "push_device"; stall: string; metrics: string[];
}
/** The halter hub with a SIM, and the sensors paired to it. The server
 *  attributes every reading to `horseId` — the hub cannot name a horse — so it
 *  has no stall of its own: `stall`, when sent, is that horse's current stall. */
export interface WearableHub extends DeviceCommon {
  kind: "wearable_hub"; horseId: string;
  sensors: { leg: string | null; pelvis: string[] };
  imei: string;
  stall?: string | null;
  metrics?: string[];
}
export type Device = EdgeBox | ThermalCamera | ModbusSensor | PushDevice | WearableHub;

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
/** `token` is returned exactly once, for edge boxes, push devices and wearable hubs. */
export const createDevice = (d: DeviceInput) => call<{ device: Device; token: string | null }>("POST", "/api/devices", d);
export const updateDevice = (id: string, d: Partial<DeviceInput>) => call<Device>("PATCH", dpath(id), d);
export const deleteDevice = (id: string, force = false) =>
  call<{ ok: true }>("DELETE", dpath(id) + (force ? "?force=1" : ""));
export const rotateToken = (id: string) => call<{ token: string }>("POST", dpath(id, "token"));
export interface SetupItem { key: string; label: string; ok: boolean; required: boolean; detail: string }
/** Is the horse where the boxes are? Read off the camera (JSON-RPC cameras). */
export const setupChecklist = (id: string, r: { eye?: RoiBox | null; nostril?: RoiBox | null; flank?: boolean; hay?: boolean; colourFloor?: boolean }) => {
  const b = (x?: RoiBox | null) => (x ? `${x.x0},${x.y0},${x.x1},${x.y1}` : "");
  const q = new URLSearchParams({ ...(r.eye ? { eye: b(r.eye) } : {}), ...(r.nostril ? { nostril: b(r.nostril) } : {}),
    ...(r.flank ? { flank: "1" } : {}), ...(r.hay ? { hay: "1" } : {}), ...(r.colourFloor ? { colourFloor: "1" } : {}) });
  return call<{ at: string; items: SetupItem[]; ready: boolean }>("GET", `${dpath(id, "checklist")}?${q}`, undefined, 45000);
};
export const getZoomSetup = (id: string) => call<ZoomSetup>("GET", dpath(id, "views"));
export const putZoomSetup = (id: string, s: ZoomSetup) => call<Device>("PUT", dpath(id, "views"), s);
export const deleteZoomSetup = (id: string) => call<Device>("DELETE", dpath(id, "views"));
export const ptzInfo = (id: string) => call<{ profiles: PtzProfile[]; presets: Record<string, { token: string; name: string }[]> }>("GET", dpath(id, "ptz"), undefined, 30000);
/** nudge (move a moment), absolute, goto (a preset), save (where the lens is now, as a preset) or status. */
export const ptzAction = (id: string, body: { action: "nudge" | "absolute" | "goto" | "save" | "status"; profile: string;
  pan?: number; tilt?: number; zoom?: number; seconds?: number; preset?: string; name?: string; token?: string }) =>
  call<{ status: { pan: number | null; tilt: number | null; zoom: number | null; moving: boolean } | null; token?: string }>("POST", dpath(id, "ptz"), body, 30000);
export const deviceEvents = (id: string) => call<DeviceEvent[]>("GET", dpath(id, "events"));
/** Camera connection test, or a Modbus test read. `acceptIdentity` confirms a replacement camera. */
export const probeDevice = (id: string, acceptIdentity = false) =>
  call<CameraProbe | SensorProbe>("POST", dpath(id, "probe") + (acceptIdentity ? "?acceptIdentity=1" : ""), undefined, 45000);
export const pushRois = (id: string, rois: Pick<CameraRois, "eye" | "nostril"> & { floor?: RoiBox | null; flank?: RoiBox | null; colourFloor?: RoiBox | null }) =>
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

export interface FloorCalibEntry { halfLifeMin: number; peakRiseC: number; areaFrac: number; fill: number; at: string; by: string }
export interface CoolingJob {
  id: string; state: "running" | "done" | "error"; error: string | null; minutes: number; elapsedS: number;
  result: {
    state: "baseline" | "waiting" | "cooling" | "measured"; note: string;
    peakRiseC?: number; halfLifeMin?: number | null; areaFrac?: number; fill?: number;
    series?: { t: number; meanRiseC: number; warmArea: number }[];
  };
}
export const startCoolingTest = (id: string, minutes = 20) => call<CoolingJob>("POST", dpath(id, "cooling"), { minutes }, 30000);
export const coolingStatus = (id: string, job: string) => call<CoolingJob>("GET", `${dpath(id, "cooling")}/${encodeURIComponent(job)}`);
export const stopCoolingTest = (id: string, job: string) => call<CoolingJob>("POST", `${dpath(id, "cooling")}/${encodeURIComponent(job)}/stop`);
export const saveCooling = (id: string, job: string, as: "urine" | "manure") =>
  call<{ floorCalib: ThermalCamera["floorCalib"]; urineHalfLifeMin: number | null }>("POST", `${dpath(id, "cooling")}/${encodeURIComponent(job)}/save`, { as });

export const saveVerification = (id: string, v: {
  breathing: { bpm: number; periodicity: number; seconds: number; samples: number };
  handCountBpm: number | null; eyeC: number | null; nostrilSwingC: number | null;
}) => call<CameraVerification>("POST", dpath(id, "verification"), v);

/** Snapshot as an object URL. An <img src> cannot carry the Authorization
 *  header, so the image is fetched and handed to the page as a blob. */
/**
 * A camera's live video (server/live-video.mjs): per frame a 4-byte length and
 * a JPEG. Calls onFrame with the newest frame of each read, until the stream
 * ends, the signal aborts or the tab is hidden (which frees the camera's
 * stream). Resolves to the number of frames shown; 0 means no live video, so
 * the caller shows snapshots instead.
 */
export async function readLive(id: string, stream: "thermal" | "colour", signal: AbortSignal,
  onFrame: (jpeg: Blob) => void): Promise<number> {
  if (!apiConfigured) return 0;
  let res: Response;
  try {
    res = await fetch(`${BASE}${dpath(id, "live")}?stream=${stream}`, { headers: authHeaders(), signal, cache: "no-store" });
  } catch { return 0; }
  if (!res.ok || !res.body) return 0;
  const reader = res.body.getReader();
  let buf: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  let shown = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const joined = new Uint8Array(buf.length + value.length);
      joined.set(buf);
      joined.set(value, buf.length);
      buf = joined;
      let newest: Uint8Array<ArrayBuffer> | null = null;
      while (buf.length >= 4) {
        const n = ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0;
        if (buf.length < 4 + n) break;
        newest = buf.slice(4, 4 + n);
        buf = buf.slice(4 + n);
      }
      if (newest) { onFrame(new Blob([newest], { type: "image/jpeg" })); shown++; }
      if (document.visibilityState !== "visible") { await reader.cancel(); break; }
    }
  } catch { /* stopped, or the connection dropped */ }
  return shown;
}

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
export interface LabelDef { key: string; name: string; kind: "interval" | "moment"; shortcut: string; def?: string; pattern?: string | null }
export interface FootageLabel {
  id: string; camera: string; clip: string; label: string; startAt: string; endAt: string | null;
  note: string; horse: string | null; stall: string | null; by: string; createdAt: string;
}
export const listFootage = () => call<{ clips: FootageClip[]; cameras: { id: string; name: string; stall: string | null }[] }>("GET", "/api/footage");
export const footageTicket = () => call<{ ticket: string; expiresInS: number }>("GET", "/api/footage/ticket");

// ---- each horse's own normal (server/baseline.mjs) ---------------------------- //
export interface BaselineRow { key: string; label: string; unit: string; baseline: number | null; recent: number | null;
  change: number | null; pct: number | null; notable: boolean; direction: "up" | "down" | "same" | null; pattern: string }
export interface BaselineCompare { window: { from: string; to: string; set: boolean; by?: string | null; at?: string | null; days?: number } | null;
  learning: boolean; comparedDays: number; baselineDays: number; sameAsBaseline: boolean; rows: BaselineRow[];
  days: Record<string, number | string | null>[]; note: string }
const tzq = () => `tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`;
export const getBaseline = (horse: string) => call<BaselineCompare>("GET", `/api/horses/${encodeURIComponent(horse)}/baseline?${tzq()}`);
export const setBaseline = (horse: string, b: { from: string; to: string } | { reset: true }) =>
  call<BaselineCompare>("PUT", `/api/horses/${encodeURIComponent(horse)}/baseline?${tzq()}`, b);

// ---- events with a verdict, clips, reviews (server/events.mjs) ---------------- //
export interface HorseEvent { id: string; horse: string; horseName: string; kind: string; title: string; at: string;
  verdict: "normal" | "watch" | "vet"; next: string; pattern: string | null; label: string | null; camera: string | null; stall: string | null;
  stream: "visible" | "thermal"; where: { x: number; y: number } | null; box: RoiBox | null; detail: string | null; prototype: boolean;
  video: boolean; review: { verdict: "confirmed" | "wrong"; note: string; by: string; reviewedAt: string } | null }
export const listEvents = (p: { horse?: string; from?: string; to?: string }) =>
  call<HorseEvent[]>("GET", `/api/events?${new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString()}&${tzq()}`);
export const reviewEvent = (e: HorseEvent, verdict: "confirmed" | "wrong", note: string) =>
  call<{ review: unknown; trainingLabel: boolean }>("POST", `/api/events/${encodeURIComponent(e.id)}/review?${tzq()}`, { horse: e.horse, at: e.at, verdict, note });
/** A short clip a <video> can play (ticket, not the session). */
export const clipUrl = (ticket: string, p: { camera: string; at: string; stream?: "visible" | "thermal"; stall?: string | null;
  mark?: RoiBox | { x: number; y: number } | null; slow?: boolean; before?: number; after?: number }) =>
  `${BASE}/api/clip?${new URLSearchParams({ vt: ticket, camera: p.camera, at: p.at, stream: p.stream ?? "visible",
    ...(p.stall ? { stall: p.stall } : {}), ...(p.mark ? { mark: JSON.stringify(p.mark) } : {}), ...(p.slow ? { slow: "1" } : {}),
    before: String(p.before ?? 10), after: String(p.after ?? 20) }).toString()}`;
export const eventReviewsCsvUrl = () => `${BASE}/api/events/reviews/export`;

// ---- accuracy checks ---------------------------------------------------------- //
export interface CheckMoment { at: string; camera: string; stall: string | null; kind: "breathing" | "state"; stream: "visible" | "thermal" }
export interface Agreement {
  breathing: { n: number; bias: number; sd: number; limits: [number, number]; mae: number; within2: number; nights: number; nightMae: number | null; enough: boolean } | null;
  state: { n: number; agree: number; table: Record<string, Record<string, number>>; enough: boolean } | null;
  checks: number; note: string;
}
export const validationSample = (horse: string, kind: "breathing" | "state", n = 10) =>
  call<CheckMoment[]>("GET", `/api/validation/sample?horse=${encodeURIComponent(horse)}&kind=${kind}&n=${n}`);
export const postValidation = (c: { horse: string; camera: string; at: string; kind: "breathing" | "state"; breaths?: number; seconds?: number; state?: string }) =>
  call<{ value: number | string; system: number | string | null }>("POST", "/api/validation", c);
export const validationReport = (horse?: string) => call<Agreement>("GET", `/api/validation/report${horse ? `?horse=${encodeURIComponent(horse)}` : ""}`);

// ---- gait checks done elsewhere ------------------------------------------------ //
export const addGaitCheck = (horse: string, g: { at?: string; tool: string; grade: string; limb?: string | null; mm?: number | null; note?: string }) =>
  call<{ ts: string }>("POST", `/api/horses/${encodeURIComponent(horse)}/gait`, g);
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

// ---- site settings (server-side; what the Settings page switches do) ------ //
export interface SiteSettings {
  delivery: {
    instant: boolean; digest: boolean; digestHour: number; escalation: boolean; escalateAfterMin: number;
    recipients: { manager: string; onCall: string; vet: string };
  };
  send: Record<"temperature" | "breathing" | "colic" | "casting" | "activity" | "vices" | "sleep" | "elimination" | "lameness" | "water" | "monitoring", boolean>;
  sensitivity: number;
  privacy: { consentAt: string | null; consentBy: string | null };
  notify: { transport: "webhook" | "log-only"; minSeverity: string; disabled: boolean; notified: number; escalated: number; digests: number; failed: number };
}
export const getSettings = () => call<SiteSettings>("GET", "/api/settings");
export const patchSettings = (patch: unknown) => call<SiteSettings>("PATCH", "/api/settings", patch);

// ---- session report (the 8 points over a window) -------------------------- //
export interface SessionPoint {
  n: number; label: string; status: "measured" | "prototype" | "learning" | "none seen" | "not measured" | "uncalibrated";
  summary: string; notes?: string[];
  stats?: { n: number; min: number; median: number; max: number; last: number; lastAt: string };
  methods?: Record<string, number>; series?: { at: string; avg: number | null }[];
}
export interface SessionReport {
  horse: { id: string; name: string; stall: string } | null;
  window: { from: string; to: string; minutes: number };
  coverage: { minutesWithData: number; percent: number; readings: number; gaps: { from: string; to: string; minutes: number }[] };
  points: SessionPoint[]; measured: number;
  timeline: { at: string; what: string }[];
  alerts: { type: string; severity: string; detail: string; time: string }[];
  footage: { clips: number; megabytes: number; first: string | null; last: string | null };
  verify: string[];
}
/**
 * The client report — designed A4 pages for a horse's owner or vet — in a new
 * tab, where "Save as PDF" prints it. The endpoint is authenticated, so the
 * page is fetched and shown from a blob. Returns an error message, or null.
 */
/** The client report as a PDF file (made by the site server), downloaded. */
export async function downloadClientReportPdf(horse: string, from: string | undefined, to: string | undefined, notes: string): Promise<string | null> {
  if (!apiConfigured) return "No backend configured";
  try {
    const res = await fetch(`${BASE}/api/session/report?format=pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ horse, from, to, notes, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return body.error ?? `The PDF could not be made (${res.status})`;
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "EquiCare report.pdf";
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return null;
  } catch {
    return "cannot reach the server";
  }
}

export async function openClientReport(horse: string, from: string | undefined, to: string | undefined, notes: string): Promise<string | null> {
  if (!apiConfigured) return "No backend configured";
  // Opened now, inside the click, so the browser does not block it as a pop-up.
  const w = window.open("", "_blank");
  if (w) w.document.body.innerHTML = '<p style="font:15px system-ui;padding:24px">Building the report…</p>';
  try {
    const res = await fetch(`${BASE}/api/session/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ horse, from, to, notes, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      w?.close();
      return body.error ?? `The report could not be built (${res.status})`;
    }
    const url = URL.createObjectURL(await res.blob());
    if (w) w.location.href = url;
    else window.location.href = url;
    return null;
  } catch {
    w?.close();
    return "Cannot reach the server";
  }
}

export const getSession = (horse: string, from?: string, to?: string) => {
  const q = new URLSearchParams({ horse });
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  return call<SessionReport>("GET", `/api/session?${q}`);
};
