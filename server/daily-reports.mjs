// A report for each horse every morning, of the night before (18:00–06:00),
// saved as a PDF on the site server — the morning round starts from a page,
// not from scrolling a chart. Settings → "Nightly reports" (reports.daily,
// reports.hour). Only horses with readings in the night get one.
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const reportsDir = () => process.env.EQUICARE_REPORTS_DIR || join(homedir(), "EquiCare-demo", "reports", "daily");
const G = (globalThis.__equicareDaily ??= { running: false, lastDay: null, made: 0, failed: 0, lastError: null });
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/, FILE_RE = /^[A-Za-z0-9 ._-]{1,120}\.pdf$/;
const pad = (n) => String(n).padStart(2, "0");
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The night that ended this morning: yesterday 18:00 to today 06:00, server time. */
export function lastNight(now = Date.now()) {
  const to = new Date(now); to.setHours(6, 0, 0, 0);
  if (to.getTime() > now) to.setDate(to.getDate() - 1);
  const from = new Date(to); from.setDate(from.getDate() - 1); from.setHours(18, 0, 0, 0);
  return { from: from.getTime(), to: to.getTime(), day: localDay(to) };
}
const fileName = (name) => `${String(name).replace(/[^A-Za-z0-9 _-]/g, "").trim() || "horse"}.pdf`;

/**
 * Called from the server's minute tick. build(horse, from, to) -> html;
 * pdf(html) -> bytes. Makes the reports once a day at or after reports.hour.
 */
export async function dailyTick({ settings, horses, readingsFor, build, pdf, now = Date.now() }) {
  const r = settings?.reports;
  if (!r?.daily || G.running) return 0;
  const t = new Date(now);
  if (t.getHours() < (r.hour ?? 7)) return 0;
  const night = lastNight(now);
  if (G.lastDay === night.day) return 0;
  G.running = true;
  let made = 0;
  try {
    const dir = join(reportsDir(), night.day);
    for (const h of horses) {
      const out = join(dir, fileName(h.name));
      if (existsSync(out)) continue;
      const rd = readingsFor(h.id).filter((x) => { const ms = Date.parse(x.ts); return ms >= night.from && ms <= night.to; });
      if (!rd.length) continue;
      try {
        const bytes = await pdf(await build(h, night.from, night.to));
        mkdirSync(dir, { recursive: true });
        writeFileSync(out, bytes);
        made++; G.made++;
        console.log(`[reports] ${night.day} ${h.name} -> ${out}`);
      } catch (e) {
        G.failed++; G.lastError = e.message;
        console.error(`[reports] ${h.name}: ${e.message}`);
      }
    }
    G.lastDay = night.day;
  } finally {
    G.running = false;
  }
  return made;
}

/** [{ day, files: [{ name, bytes }] }], newest first. */
export function listDaily(limit = 30) {
  const root = reportsDir();
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((d) => DAY_RE.test(d)).sort().reverse().slice(0, limit).map((day) => ({
    day,
    files: readdirSync(join(root, day)).filter((f) => FILE_RE.test(f)).sort()
      .map((name) => ({ name, bytes: statSync(join(root, day, name)).size })),
  })).filter((d) => d.files.length);
}

/** The path of one saved report, or null (names are checked: no way out of the folder). */
export function dailyPath(day, name) {
  if (!DAY_RE.test(day) || !FILE_RE.test(name)) return null;
  const p = join(reportsDir(), day, name);
  return existsSync(p) ? p : null;
}

export const dailyStatus = () => ({ made: G.made, failed: G.failed, lastDay: G.lastDay, lastError: G.lastError });
