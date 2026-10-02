// The client report from the command line — the same report as the app's
// Session page → "Client report" (server/client_report.mjs), for a finished
// session, with an optional PDF.
//
//   node tools/client_report_html.mjs --horse badal --from 2026-09-27T11:05:56Z [--minutes 60 | --to <ISO>]
//        [--notes "text" | --notes-file notes.txt] [--tz Asia/Kolkata] [--out <dir>] [--pdf]
//        [--paused "13:21:13-13:41:13"]   (stretches the session was paused: not counted)
//        [--colour-crop "0.46,0.09,0.87,0.91"]   (colour photos zoomed on the horse's stall, 0..1 of the picture)
//        [--no-thermal]                         (colour photos only; by default each photo pairs colour and thermal)
//        [--client "Remount Veterinary Corps"]  (on the cover: who the report is prepared for)
//        [--compare-from <ISO> --compare-minutes 60 | --compare-to <ISO>] [--compare-away …] [--compare-paused …]
//                                               (a page comparing the horse with an earlier session)
//        [--away "16:40-16:59,…"]   (sessions recorded before the eye-shape check,
//                                    28 Sep 2026: periods the horse faced away)
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, mkdtempSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { clientReport, safeTimeZone } from "../server/client_report.mjs";
import { frameGrabber, listClips } from "../server/footage.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const HOME = join(homedir(), "EquiCare-demo");
const horseId = arg("horse");
const from = Date.parse(arg("from", ""));
if (!horseId || !from) {
  console.error("usage: node tools/client_report_html.mjs --horse <id> --from <ISO time> [--minutes 60 | --to <ISO>] [--notes …] [--pdf]");
  process.exit(2);
}
const to = arg("to") ? Date.parse(arg("to")) : from + Number(arg("minutes", 60)) * 60000;
const tz = safeTimeZone(arg("tz"));
const state = JSON.parse(readFileSync(join(process.env.EQUICARE_DATA_DIR || join(HOME, "data"), "state.json"), "utf8"));
const horse = state.entities.horses.find((h) => h.id === horseId);
if (!horse) { console.error(`no horse "${horseId}"`); process.exit(2); }
const readings = state.readings.filter((r) => r.horseId === horseId);
const inWin = readings.filter((r) => { const t = Date.parse(r.ts); return t >= from && t <= to; });
const camIds = new Set(inWin.map((r) => r.meta?.deviceId).filter(Boolean));
const devices = state.entities.devices || [];
// The camera(s) whose readings fall in a window.
const camsFor = (a, b) => {
  const ids = new Set(readings.filter((r) => { const t = Date.parse(r.ts); return t >= a && t <= b; }).map((r) => r.meta?.deviceId).filter(Boolean));
  const cs = devices.filter((d) => ids.has(d.id));
  return { cs, cam: cs[0] || devices.find((d) => d.kind === "thermal_camera" && d.stall === horse.stall) || null };
};
const floorOf = (cs, c) => (cs.length ? cs.some((d) => d.rois?.floor || d.rois?.colourFloor) : c ? Boolean(c.rois?.floor || c.rois?.colourFloor) : null);
const { cs: cams, cam } = camsFor(from, to);
const clips = cam ? listClips().filter((c) => c.camera === cam.id && Date.parse(c.end) >= from && Date.parse(c.at) <= to) : [];

// "HH:MM" on the session's day, in its time zone.
const offsetAt = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(ms).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
};
const localMs = (hm, on = from) => {
  const [h, m, sec = 0] = hm.trim().split(":").map(Number);
  const off = offsetAt(on), day = new Date(on + off);
  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m, sec) - off;
};
const windows = (list, on, endPad = 0) => (list || "").split(",").filter(Boolean)
  .map((w) => { const [a, b] = w.split("-"); return [localMs(a, on), localMs(b, on) + endPad]; });
const away = windows(arg("away"), from, 59999);
// --paused "13:21:13-13:41:13,…": stretches the session was paused (not counted).
const paused = windows(arg("paused"), from);

// An earlier session to compare with: its numbers, worked out the same way.
let previous = null;
if (arg("compare-from")) {
  const pFrom = Date.parse(arg("compare-from"));
  const pTo = arg("compare-to") ? Date.parse(arg("compare-to")) : pFrom + Number(arg("compare-minutes", 60)) * 60000;
  const { cs: pCams, cam: pCam } = camsFor(pFrom, pTo);
  const prev = await clientReport({ horse, readings, from: pFrom, to: pTo, tz, away: windows(arg("compare-away"), pFrom, 59999),
    paused: windows(arg("compare-paused"), pFrom), floorWatched: floorOf(pCams, pCam) });
  previous = { summary: prev.summary };
}
const crop = arg("colour-crop") ? arg("colour-crop").split(",").map(Number) : null;
const notes = arg("notes-file") ? readFileSync(arg("notes-file"), "utf8") : arg("notes", "");

const { html, ref, photos } = await clientReport({
  horse, readings, from, to, tz, notes, away, paused, previous,
  floorWatched: floorOf(cams, cam),
  grab: cam && clips.length ? frameGrabber(cam.id, "visible", undefined, { crop }) : null,
  grabThermal: cam && clips.length && !flag("no-thermal") ? frameGrabber(cam.id, "thermal", undefined, { lift: true }) : null,
  grabFull: cam && clips.length ? frameGrabber(cam.id, "visible") : null,   // the stall map: the whole picture
  client: arg("client", ""),
  clipCount: clips.reduce((n, c) => n + (c.thermal ? 1 : 0) + (c.visible ? 1 : 0), 0),
});
const outDir = arg("out", join(HOME, "research", "reports"));
mkdirSync(outDir, { recursive: true });
const base = join(outDir, `${horse.id}-client-${ref.split("-").at(-1)}`);
writeFileSync(`${base}.html`, html);
console.log(`${base}.html  (${Math.round(html.length / 1024)} KB, ${photos} photos, ref ${ref})`);

if (flag("pdf")) {
  // Chrome prints the A4 pages edge to edge (the report sets @page margin 0 and
  // exact colours); no header or footer.
  const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
  if (!chrome) { console.error("PDF needs Google Chrome — or open the .html and use Save as PDF."); process.exit(1); }
  // Headless Chrome on macOS writes the PDF and then does not always exit:
  // wait for the file to stop growing, then close it.
  const profile = mkdtempSync(join(tmpdir(), "eqc-pdf-"));
  rmSync(`${base}.pdf`, { force: true });
  const ch = spawn(chrome, ["--headless=new", "--disable-gpu", `--user-data-dir=${profile}`, "--no-pdf-header-footer",
    `--print-to-pdf=${base}.pdf`, `file://${base}.html`], { stdio: "ignore", detached: true });
  let last = -1, done = false;
  for (let i = 0; i < 240 && !done; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const size = existsSync(`${base}.pdf`) ? statSync(`${base}.pdf`).size : -1;
    done = size > 0 && size === last;
    last = size;
  }
  const exited = new Promise((r) => { ch.once("exit", r); setTimeout(r, 5000); });
  try { process.kill(-ch.pid); } catch { /* already gone */ }
  await exited;
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* a temp folder; the OS clears it */ }
  if (!done) { console.error("Chrome did not produce the PDF — open the .html and use Save as PDF."); process.exit(1); }
  console.log(`${base}.pdf`);
}
