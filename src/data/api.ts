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

const TOKEN = (import.meta.env.VITE_API_TOKEN as string | undefined) ?? "";
export const apiConfigured = BASE.length > 0;

const authHeaders = (): Record<string, string> =>
  TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

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
export const getSeries = () =>
  get<Record<string, number[]>>("/api/series");

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
