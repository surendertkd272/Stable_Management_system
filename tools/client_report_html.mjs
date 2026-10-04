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
//        [--review "03:00-04:20|lying|with short spells flat on the side"]   (seen on the recording by a person:
//                                               lying down where the view cannot tell it; said as reviewed)
//        [--boxes night-boxes.json --trough "0.33,0.26,0.71,0.50"]   (the horse's box every few seconds: moving about,
//                                               time at a trough area of the picture, 0..1)
//        [--review "04:23:05-04:23:15|getup|…" / "03:43-03:48|lateral"]   (getting up; flat-on-the-side spells, seen on the recording)
//        [--no-auto-visits]                     (people seen by the detector are not used; --review "23:24-23:29|visit" instead)
//        [--mark "03:30|Lying down" --mark …]   (a photo of that moment among the colour views, said as seen on the recording)
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
import { compare as baselineCompare } from "../server/baseline.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const HOME = join(homedir(), "EquiCare-demo");
// --horses a,b: one report per horse for the same window (e.g. two horses one
// camera watches) — this script once for each.
if (arg("horses")) {
  const { spawnSync } = await import("node:child_process");
  const rest = process.argv.slice(2);
  const i = rest.indexOf("--horses");
  rest.splice(i, 2);
  let failed = 0;
  for (const id of arg("horses").split(",").map((s) => s.trim()).filter(Boolean)) {
    console.log(`— ${id}`);
    const r = spawnSync(process.execPath, [process.argv[1], "--horse", id, ...rest], { stdio: "inherit" });
    if (r.status) failed += 1;
  }
  process.exit(failed ? 1 : 0);
}
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
// A camera watching several stalls: this horse's stall on its wide view.
const zoneOf = (c) => c?.views?.find((v) => v.kind === "wide")?.zones?.find((z) => z.stall === horse.stall) || null;
const floorIn = (d) => Boolean(d.rois?.floor || d.rois?.colourFloor || zoneOf(d)?.rois?.floor || zoneOf(d)?.rois?.colourFloor);
const floorOf = (cs, c) => (cs.length ? cs.some(floorIn) : c ? floorIn(c) : null);
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
// Local clock times inside the session, which may run past midnight.
const inSession = (hm) => { let t = localMs(hm, from); while (t < from - 60000) t += 86400000; return t; };
const all = (k) => process.argv.flatMap((v, i) => (v === `--${k}` && process.argv[i + 1] ? [process.argv[i + 1]] : []));
const review = all("review").map((v) => { const [span, kind, text = ""] = v.split("|"); const [a, b] = span.split("-");
  return { from: inSession(a), to: inSession(b) < inSession(a) ? inSession(b) + 86400000 : inSession(b), kind, text }; });
const marks = all("mark").map((v) => { const [hm, ...text] = v.split("|"); return { at: inSession(hm), text: text.join("|") }; });
// --last-live <ISO from>,<ISO to>: the horse's last live check, for the
// temperature when this session had none (said as such, with its date).
let lastLive = null;
if (arg("last-live")) {
  const [a, b] = arg("last-live").split(",").map((x) => Date.parse(x));
  const vals = readings.filter((r) => r.horseId === horse.id && r.metric === "body_temp_c" && Date.parse(r.ts) >= a && Date.parse(r.ts) <= b)
    .map((r) => r.value).sort((x, y) => x - y);
  if (vals.length) lastLive = { median: vals[Math.floor(vals.length / 2)], n: vals.length, where: arg("last-live-where", "the warmest point of the head"),
    date: flag("last-live-no-date") ? "" : new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" }).format(a) };
}
// Colour photos: the crop asked for, else this horse's own stall when the
// camera watches several (its zone on the wide view).
const zone = zoneOf(cam);
const crop = arg("colour-crop") ? arg("colour-crop").split(",").map(Number)
  : zone ? [zone.colour.x0, zone.colour.y0, zone.colour.x1, zone.colour.y1].map((v) => v / 10000) : null;
const notes = arg("notes-file") ? readFileSync(arg("notes-file"), "utf8") : arg("notes", "");

const { html, ref, photos } = await clientReport({
  horse, readings, from, to, tz, notes, away, paused, previous,
  floorWatched: floorOf(cams, cam),
  grab: cam && clips.length ? frameGrabber(cam.id, "visible", undefined, { crop }) : null,
  grabThermal: cam && clips.length && !flag("no-thermal") ? frameGrabber(cam.id, "thermal", undefined, { lift: true }) : null,
  // The stall map: the photo and its grid cover the same part of the picture
  // (the colour crop, else the picture less the strips the camera writes on).
  grabFull: cam && clips.length ? frameGrabber(cam.id, "visible", undefined, { crop }) : null,
  mapCrop: crop || [0, 0.09, 1, 0.91],
  client: arg("client", ""),
  review, marks, lastLive, autoVisits: !flag("no-auto-visits"),
  boxes: arg("boxes") ? JSON.parse(readFileSync(arg("boxes"), "utf8")) : null,
  trough: arg("trough") ? arg("trough").split(",").map(Number) : null,
  clipCount: clips.reduce((n, c) => n + (c.thermal ? 1 : 0) + (c.visible ? 1 : 0), 0),
  baseline: baselineCompare(horse, readings, { tz, from, to }),
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
