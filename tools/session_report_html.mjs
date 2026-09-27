// A designed, self-contained session report (HTML with charts) straight from
// the stored readings and recordings — read-only, so it runs beside a live
// demo. Opens in any browser, prints to PDF, works offline.
//
//   node tools/session_report_html.mjs --horse badal --from 2026-09-27T11:05:56Z --minutes 60 \
//        [--data ~/EquiCare-demo/data/state.json] [--out ~/EquiCare-demo/research/reports]
//
// Eye temperature counts only readings of 33 °C or more (a living eye); lower
// values were the forelock or coat under the eye box and are shown, faded, as
// excluded. Frames at flagged moments are cut from the recorded colour video.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const HOME = join(homedir(), "EquiCare-demo");
const horseId = arg("horse", "badal");
const from = Date.parse(arg("from"));
const minutes = Number(arg("minutes", 60));
const to = from + minutes * 60000;
const state = JSON.parse(readFileSync(arg("data", join(HOME, "data", "state.json")), "utf8"));
const outDir = arg("out", join(HOME, "research", "reports"));
const EYE_MIN = 33;

const horse = state.entities.horses.find((h) => h.id === horseId) || { id: horseId, name: horseId, stall: "?" };
const cams = state.entities.devices.filter((d) => d.kind === "thermal_camera" && d.stall === horse.stall);
const cam = cams[0] || null;
const rd = state.readings.filter((r) => r.horseId === horseId && Date.parse(r.ts) >= from && Date.parse(r.ts) <= to)
  .sort((a, b) => a.ts.localeCompare(b.ts));
const of = (m) => rd.filter((r) => r.metric === m);
const minuteOf = (r) => Math.min(minutes - 1, Math.floor((Date.parse(r.ts) - from) / 60000));
const clock = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
const clockS = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Kolkata" });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const f1 = (v) => (v === null || v === undefined ? "—" : (Math.round(v * 10) / 10).toFixed(1));

// ---- per-minute series ---------------------------------------------------- //
const temps = of("body_temp_c");
// Periods the video shows the horse facing away (--away "16:40-16:59,..."):
// a reading then is a warm fold of coat, not an eye, whatever its value.
const istMin = (ms) => { const d = new Date(ms + 5.5 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const away = (arg("away", "") || "").split(",").filter(Boolean).map((w) => w.split("-").map((hm) => { const [h, m] = hm.trim().split(":").map(Number); return h * 60 + m; }));
const facingAway = (r) => away.some(([a, b]) => istMin(Date.parse(r.ts)) >= a && istMin(Date.parse(r.ts)) <= b);
const eye = temps.filter((r) => r.value >= EYE_MIN && !facingAway(r));
const awayWarm = temps.filter((r) => r.value >= EYE_MIN && facingAway(r));
const coat = temps.filter((r) => r.value < EYE_MIN);
const act = new Array(minutes).fill(null), still = new Array(minutes).fill(null);
for (const r of of("activity_index")) act[minuteOf(r)] = r.value;
for (const r of of("inactive_minutes")) still[minuteOf(r)] = Math.min(1, r.value / (r.meta?.windowMin || 1));
const resp = of("respiratory_rate_bpm");
const vices = of("vice_event");
const pev = of("posture_event");
const floorEv = [...of("urination_event"), ...of("excretion_event")];
const lying = of("lying_minutes");
const anyMin = new Set(rd.map(minuteOf));
const rows = [
  ["Eye temperature", new Set(eye.map(minuteOf))],
  ["Activity & stillness", new Set(of("activity_index").map(minuteOf))],
  ["Breathing rate", new Set(resp.map(minuteOf))],
  ["Lying (posture)", new Set([...lying, ...pev].map(minuteOf))],
  ["Urination / manure", new Set(floorEv.map(minuteOf))],
];
const floorWatched = Boolean(cam?.rois?.floor || cam?.rois?.colourFloor);

// ---- video: clips in the window, frames at flagged moments ------------------ //
const recRoot = join(HOME, "recordings", cam?.id || "none");
const clipsOf = (stream) => {
  const dir = join(recRoot, stream);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".mp4")).map((f) => {
    const at = Date.parse(f.slice(0, -4).replace(/T(\d\d)-(\d\d)-(\d\d)$/, "T$1:$2:$3") + "+05:30");
    return { f, at, path: join(dir, f), bytes: statSync(join(dir, f)).size };
  }).sort((a, b) => a.at - b.at);
};
const vis = clipsOf("visible"), thr = clipsOf("thermal");
const inWin = (c, i, all) => c.at <= to && (all[i + 1]?.at ?? Infinity) >= from;
const videoBytes = [...vis.filter(inWin), ...thr.filter(inWin)].reduce((a, c) => a + c.bytes, 0);
const frameAt = (ms, clips, width = 440, q = 5) => {
  const c = [...clips].reverse().find((x) => x.at <= ms);
  if (!c) return null;
  const tmp = join(tmpdir(), `eqframe-${ms}.jpg`);
  try {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String((ms - c.at) / 1000), "-i", c.path, "-frames:v", "1", "-vf", `scale=${width}:-1`, "-q:v", String(q), tmp]);
    const b64 = readFileSync(tmp).toString("base64");
    rmSync(tmp, { force: true });
    return `data:image/jpeg;base64,${b64}`;
  } catch { return null; }
};
const flagged = vices.map((r) => ({ at: Date.parse(r.ts) - 30000, kind: (r.meta?.kind || "weaving").replace("_", " ") }));
const frames = flagged.map((v) => ({ ...v, colour: frameAt(v.at, vis), thermal: frameAt(v.at, thr) }));
const posAt = arg("position") ? null : from + 5 * 60000;
// Best frames (chosen by eye from the filmstrip) and captions for moments.
const hhmmToMs = (hm) => { const [h, m] = hm.split(":").map(Number); const d = new Date(from + 5.5 * 3600000); d.setUTCHours(h, m, 0, 0); return d.getTime() - 5.5 * 3600000; };
const captions = Object.fromEntries((arg("captions", "") || "").split(";").filter(Boolean).map((kv) => { const [k, ...v] = kv.split("="); return [k.trim(), v.join("=").trim()]; }));
const best = (arg("best", "") || "").split(",").filter(Boolean).map((hm) => { const at = hhmmToMs(hm.trim());
  return { at, hm: hm.trim(), caption: captions[hm.trim()] || "", colour: frameAt(at, vis, 900, 3), thermal: frameAt(at, thr, 640, 3) }; });
const opening = (() => { const at = posAt ?? hhmmToMs(arg("position")); return { at, colour: frameAt(at, vis, 900, 3), thermal: frameAt(at, thr, 640, 3) }; })();
const strip = Array.from({ length: Math.floor(minutes / 2) }, (_, i) => { const at = hhmmToMs(clock(from + (i * 2 + 1) * 60000)); return { at, img: frameAt(at, vis, 220, 7) }; });

// ---- charts (inline SVG) --------------------------------------------------- //
const W = 900, PADL = 48, PADR = 16;
const x = (m) => PADL + (m / minutes) * (W - PADL - PADR);
const xTicks = (h) => Array.from({ length: Math.floor(minutes / 10) + 1 }, (_, i) => i * 10)
  .map((m) => `<g><line x1="${x(m)}" x2="${x(m)}" y1="0" y2="${h}" class="grid"/><text x="${x(m)}" y="${h + 16}" class="tick" text-anchor="middle">${clock(from + m * 60000)}</text></g>`).join("");

function tempChart() {
  const H = 220, lo = 29, hi = 36;
  const y = (v) => H - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * H;
  const med = median(eye.map((r) => r.value));
  const yt = [29, 30, 31, 32, 33, 34, 35, 36].map((v) => `<g><line x1="${PADL}" x2="${W - PADR}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${PADL - 8}" y="${y(v) + 4}" class="tick" text-anchor="end">${v}</text></g>`).join("");
  const mx = (r) => x((Date.parse(r.ts) - from) / 60000);
  const dots = [
    ...awayWarm.map((r) => `<rect x="${mx(r) - 4.5}" y="${y(r.value) - 4.5}" width="9" height="9" rx="1.5" class="dot-away" data-tip="${clockS(Date.parse(r.ts))} · ${f1(r.value)} °C · horse facing away — warm coat, not the eye (excluded)"><title>${f1(r.value)} °C facing away</title></rect>`),
    ...coat.map((r) => `<circle cx="${mx(r)}" cy="${y(r.value)}" r="4.5" class="dot-excluded" data-tip="${clockS(Date.parse(r.ts))} · ${f1(r.value)} °C · coat/forelock (excluded)"><title>${f1(r.value)} °C excluded</title></circle>`),
    ...eye.map((r) => `<circle cx="${mx(r)}" cy="${y(r.value)}" r="5" class="dot-eye" data-tip="${clockS(Date.parse(r.ts))} · ${f1(r.value)} °C · eye"><title>${f1(r.value)} °C</title></circle>`),
  ].join("");
  const medLine = med === null ? "" : `<line x1="${PADL}" x2="${W - PADR}" y1="${y(med)}" y2="${y(med)}" class="median"/><text x="${x(47)}" y="${y(med) - 8}" class="lbl halo" text-anchor="middle">median ${f1(med)} °C</text>`;
  const band = `<rect x="${PADL}" y="${y(EYE_MIN)}" width="${W - PADL - PADR}" height="${H - y(EYE_MIN)}" class="exclude-band"/><text x="${PADL + 6}" y="${H - 6}" class="lbl muted">below 33 °C: not an eye (coat, forelock)</text>`;
  return `<svg viewBox="0 -14 ${W} ${H + 38}" role="img" aria-label="Eye temperature readings over the session">${band}${yt}${xTicks(H)}${medLine}${dots}</svg>`;
}

function barChart(series, { H = 140, label, fmt, cls = "bar", markers = [] }) {
  const bw = (W - PADL - PADR) / minutes - 2;
  const y = (v) => H - v * H;
  const yt = [0, 0.5, 1].map((v) => `<g><line x1="${PADL}" x2="${W - PADR}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${PADL - 8}" y="${y(v) + 4}" class="tick" text-anchor="end">${fmt(v)}</text></g>`).join("");
  const bars = series.map((v, m) => v !== null && v < 0.02
    ? `<rect x="${x(m) + 1}" y="${H - 1.5}" width="${bw}" height="1.5" class="${cls}" data-tip="${clock(from + m * 60000)} · ${label} ${fmt(v)}"/>`
    : v === null
    ? `<rect x="${x(m) + 1}" y="${H - 2}" width="${bw}" height="2" class="nodata" data-tip="${clock(from + m * 60000)} · no reading"/>`
    : `<path d="M${x(m) + 1},${H} V${Math.min(H - 1, y(v) + 4)} q0,-4 4,-4 h${Math.max(0, bw - 8)} q4,0 4,4 V${H} Z" class="${cls}" data-tip="${clock(from + m * 60000)} · ${label} ${fmt(v)}"/>`).join("");
  const mk = markers.map((mm) => `<g class="marker" data-tip="${esc(mm.tip)}"><line x1="${x(mm.m) + bw / 2}" x2="${x(mm.m) + bw / 2}" y1="-4" y2="${H}" class="flagline"/><path d="M${x(mm.m) + bw / 2 - 7},-6 h14 l-7,-12 z" class="flag"/><text x="${x(mm.m) + bw / 2}" y="-22" class="lbl" text-anchor="middle">${esc(mm.label)}</text></g>`).join("");
  return `<svg viewBox="0 -34 ${W} ${H + 58}" role="img" aria-label="${esc(label)} per minute">${yt}${xTicks(H)}${bars}${mk}</svg>`;
}

function coverageChart() {
  const rh = 26, H = rows.length * rh;
  const cw = (W - 170 - PADR) / minutes;
  const cells = rows.map(([name, set], i) => {
    const yy = i * rh;
    const c = Array.from({ length: minutes }, (_, m) => `<rect x="${170 + m * cw + 0.5}" y="${yy + 4}" width="${Math.max(1, cw - 1.5)}" height="${rh - 8}" rx="2" class="${set.has(m) ? "cov-on" : "cov-off"}" data-tip="${esc(name)} · ${clock(from + m * 60000)} · ${set.has(m) ? "measured" : "no reading"}"/>`).join("");
    return `<text x="160" y="${yy + rh / 2 + 4}" class="tick strong" text-anchor="end">${esc(name)}</text>${c}<text x="${W - 4}" y="${yy + rh / 2 + 4}" class="tick" text-anchor="end"></text>`;
  }).join("");
  const ticks = Array.from({ length: Math.floor(minutes / 10) + 1 }, (_, i) => i * 10).map((m) => `<text x="${170 + m * cw}" y="${H + 16}" class="tick" text-anchor="middle">${clock(from + m * 60000)}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H + 24}" role="img" aria-label="Which signals were measured in each minute">${cells}${ticks}</svg>`;
}

// ---- the 8 points ---------------------------------------------------------- //
const eyeMed = median(eye.map((r) => r.value));
const actMed = median(act.filter((v) => v !== null));
const stillMin = still.filter((v) => v !== null).reduce((a, v) => a + v, 0);
const points = [
  { n: 1, name: "Body temperature", status: eye.length ? "good" : "critical", tag: eye.length ? "Measured" : "Not measured",
    value: eye.length ? `${f1(eyeMed)} °C` : "—", sub: eye.length ? `eye surface, median of ${eye.length} face-in-view readings (${f1(Math.min(...eye.map((r) => r.value)))}–${f1(Math.max(...eye.map((r) => r.value)))} °C)` : "the eye was never in the thermal view",
    note: `Kept ${eye.length} readings with the face in view. Excluded ${coat.length} below 33 °C (coat, forelock) and ${awayWarm.length} of 33 °C+ taken while he faced away — a warm coat fold reads like an eye in a warm stall, so the automatic eye search needs a face check (next step). Eye infrared runs ~2 °C below rectal: a trend for Badal, not a core temperature.` },
  { n: 2, name: "Respiration pattern", status: resp.length ? "good" : "critical", tag: resp.length ? "Measured" : "Not measured", value: resp.length ? "measured" : "—",
    sub: resp.length ? "" : "no 30 s stretch with the muzzle still in view",
    note: "The muzzle was mostly below the thermal view and the flank was not in the colour picture. Tilting the camera down, or moving it back, fixes this." },
  { n: 3, name: "Respiratory rate", status: resp.length ? "good" : "critical", tag: resp.length ? "Measured" : "Not measured",
    value: resp.length ? `${f1(median(resp.map((r) => r.value)))} /min` : "—", sub: resp.length ? `${resp.length} readings` : "same cause as point 2",
    note: "A rate is reported only over 30 s+ with the head still and only when it matches a count of breaths — silence here is the system refusing to guess." },
  { n: 4, name: "Activity", status: actMed !== null ? "warning" : "critical", tag: actMed !== null ? "Prototype" : "Not measured",
    value: actMed !== null ? f1(actMed) : "—", sub: "median, 0 = still · 1 = very active",
    note: `Measured in ${act.filter((v) => v !== null).length} of ${minutes} minutes. With the camera ~1.5–2 m from the head every head movement fills the picture, which inflates activity. "Unusual for this horse" needs 3 days of Badal's own data.` },
  { n: 5, name: "Resting pattern", status: lying.length ? "warning" : "neutral", tag: lying.length ? "Prototype" : "Learning",
    value: `${Math.round(stillMin)} min still`, sub: `of ${minutes} min · lying not yet learned`,
    note: "Stillness is not lying. Lying is reported once the camera has seen Badal both standing and lying from this position — his legs and the floor were not in view." },
  { n: 6, name: "Stable vices", status: vices.length ? "warning" : "good", tag: vices.length ? "To verify" : "None seen",
    value: vices.length ? `${vices.length} flags` : "none", sub: vices.length ? `"${[...new Set(vices.map((v) => (v.meta?.kind || "weaving").replace("_", " ")))].join(", ")}" at ${vices.map((v) => clock(Date.parse(v.ts))).join(", ")}` : "",
    note: "The video frames below show Badal turning around in a small stall at those moments (hindquarters to the camera at one of them). The movement is real; a single turn is not stereotypic box walking — not confirmed as a vice." },
  { n: 7, name: "Urination", status: floorWatched ? "good" : "critical", tag: floorWatched ? (of("urination_event").length ? "Prototype" : "None seen") : "Not measured",
    value: floorWatched ? String(of("urination_event").length) : "—", sub: floorWatched ? "events" : "no floor in either picture",
    note: "The floor is watched only where a floor box is drawn; from this position neither the thermal nor the colour picture showed bedding." },
  { n: 8, name: "Excretion", status: floorWatched ? "good" : "critical", tag: floorWatched ? (of("excretion_event").length ? "Prototype" : "None seen") : "Not measured",
    value: floorWatched ? String(of("excretion_event").length) : "—", sub: floorWatched ? "events" : "no floor in either picture",
    note: "Same as urination: needs bedding in view (camera further back and angled down)." },
];
const measuredCount = points.filter((p) => p.status !== "critical").length;

const actMarkers = vices.map((r) => ({ m: minuteOf(r), label: "flag", tip: `${clock(Date.parse(r.ts))} · "${(r.meta?.kind || "weaving").replace("_", " ")}" flagged — turning around, see frames` }));
const statusIcon = { good: "✓", warning: "!", critical: "✕", neutral: "…" };

// ---- page ------------------------------------------------------------------- //
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Badal — session report</title>
<style>
:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--ring:rgba(11,11,11,.10);
--s1:#2a78d6;--s1soft:#cde2fb;--good:#0ca30c;--warn:#fab219;--crit:#d03b3b;--neutral:#898781;--excl:#b9b7ae;--band:rgba(137,135,129,.08);}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#fff;--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#383835;--ring:rgba(255,255,255,.10);--s1:#3987e5;--s1soft:#1c3a5e;--excl:#5a5954;--band:rgba(255,255,255,.04);}}
:root[data-theme="dark"]{color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#fff;--ink2:#c3c2b7;--grid:#2c2c2a;--axis:#383835;--ring:rgba(255,255,255,.10);--s1:#3987e5;--s1soft:#1c3a5e;--excl:#5a5954;--band:rgba(255,255,255,.04);}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:28px 16px 60px}
header{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;justify-content:space-between;margin-bottom:18px}
h1{font-size:28px;margin:0;letter-spacing:-.01em}h2{font-size:18px;margin:0 0 4px}h3{font-size:15px;margin:0}
.sub{color:var(--ink2);margin:4px 0 0}.muted{color:var(--muted);fill:var(--muted)}
.card{background:var(--surface);border:1px solid var(--ring);border-radius:16px;padding:18px 20px;margin-bottom:16px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.kpi{background:var(--surface);border:1px solid var(--ring);border-radius:14px;padding:14px 16px}.kpi b{display:block;font-size:26px;line-height:1.2}.kpi span{color:var(--ink2);font-size:13px}
.points{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px}
.pt{background:var(--surface);border:1px solid var(--ring);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:4px}
.pt .v{font-size:22px;font-weight:650}.pt .s{color:var(--ink2);font-size:12.5px}.pt p{color:var(--ink2);font-size:12.5px;margin:6px 0 0}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;border:1px solid var(--ring);color:var(--ink);align-self:flex-start}
.chip i{font-style:normal;display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;color:#fff;font-size:11px}
.chip.good i{background:var(--good)}.chip.warning i{background:var(--warn);color:#0b0b0b}.chip.critical i{background:var(--crit)}.chip.neutral i{background:var(--neutral)}
svg{width:100%;height:auto;display:block;overflow:visible}
.grid{stroke:var(--grid);stroke-width:1}.tick{fill:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}.tick.strong{fill:var(--ink2);font-size:12px}
.lbl{fill:var(--ink2);font-size:11.5px}.median{stroke:var(--ink2);stroke-width:1.5;stroke-dasharray:4 4}
.dot-eye{fill:var(--s1);stroke:var(--surface);stroke-width:2}.dot-away{fill:none;stroke:var(--excl);stroke-width:1.5;stroke-dasharray:2 2}
.halo{paint-order:stroke;stroke:var(--surface);stroke-width:4px;stroke-linejoin:round}.dot-excluded{fill:none;stroke:var(--excl);stroke-width:1.5}.exclude-band{fill:var(--band)}
.bar{fill:var(--s1)}.bar.still{fill:var(--s1)}.nodata{fill:var(--grid)}.cov-on{fill:var(--s1)}.cov-off{fill:var(--grid)}
.flag{fill:var(--warn);stroke:var(--surface);stroke-width:1.5}.flagline{stroke:var(--warn);stroke-width:1.5;stroke-dasharray:3 3}
.legend{display:flex;flex-wrap:wrap;gap:16px;font-size:12.5px;color:var(--ink2);margin:8px 0 0}.legend span{display:inline-flex;align-items:center;gap:6px}
.sw{width:10px;height:10px;border-radius:50%;display:inline-block}.sw.eye{background:var(--s1)}.sw.excl{border:1.5px solid var(--excl)}.sw.flag{background:var(--warn);border-radius:2px}
.frames{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}.frame{margin:0}.frame img{width:100%;border-radius:10px;display:block}.frame figcaption{font-size:12.5px;color:var(--ink2);margin-top:6px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.best{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}.bframe{margin:0;position:relative}
.bcol{width:100%;border-radius:12px;display:block}.bthr{position:absolute;right:8px;top:8px;width:36%;border-radius:8px;border:2px solid var(--surface);box-shadow:0 2px 10px rgba(0,0,0,.35)}
.bframe figcaption{font-size:12.5px;color:var(--ink2);margin-top:6px}
.strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:6px}.strip figure{margin:0}.strip img{width:100%;border-radius:6px;display:block}
.strip figcaption{font-size:11px;color:var(--muted);text-align:center;font-variant-numeric:tabular-nums}.notes{font-size:13px;color:var(--ink2)}
ul{margin:6px 0 0;padding-left:20px}li{margin:3px 0}
table{border-collapse:collapse;width:100%;font-size:12.5px;font-variant-numeric:tabular-nums}td,th{padding:4px 8px;border-bottom:1px solid var(--grid);text-align:left}
#tip{position:fixed;pointer-events:none;background:var(--surface);color:var(--ink);border:1px solid var(--ring);box-shadow:0 4px 16px rgba(0,0,0,.15);border-radius:8px;padding:6px 10px;font-size:12.5px;display:none;z-index:9}
[data-tip]{cursor:default}.marker{cursor:help}
@media print{body{background:#fff}.card,.kpi,.pt{break-inside:avoid;border-color:#ccc}#tip{display:none!important}}
@media (max-width:560px){.two{grid-template-columns:1fr}h1{font-size:23px}}
</style></head>
<body><main>
<header><div>
<div class="muted" style="font-size:12.5px;letter-spacing:.06em;text-transform:uppercase">BSV EquiCare · practice session report</div>
<h1>${esc(horse.name)} · stall ${esc(horse.stall)}</h1>
<p class="sub">${new Date(from).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })} · ${clock(from)}–${clock(to)} IST (${minutes} min) · one camera (TPC-B3404-ILP, thermal + colour)</p>
</div><div class="chip ${measuredCount >= 6 ? "good" : "warning"}"><i>${measuredCount >= 6 ? "✓" : "!"}</i>${measuredCount} of 8 points produced data</div></header>

<section class="kpis">
<div class="kpi"><b>${anyMin.size}/${minutes}</b><span>minutes with camera data</span></div>
<div class="kpi"><b>${rd.length}</b><span>readings stored</span></div>
<div class="kpi"><b>${(videoBytes / 1e9).toFixed(2)} GB</b><span>video recorded (thermal + colour)</span></div>
<div class="kpi"><b>${eye.length ? `${f1(eyeMed)} °C` : "—"}</b><span>eye temperature, median</span></div>
<div class="kpi"><b>${Math.round(stillMin)} min</b><span>standing still</span></div>
</section>

<section class="card"><h2>In one paragraph</h2>
<p style="margin:6px 0 0">The system ran the full hour without a gap: ${rd.length} readings and ${(videoBytes / 1e9).toFixed(2)} GB of thermal and colour video are stored for research. From this position — the camera about 1.5–2 m from Badal's head — it measured <b>eye temperature</b> (median ${f1(eyeMed)} °C, steady) and <b>activity</b> (a restless horse: still only ${Math.round(stillMin)} of ${minutes} minutes), and flagged ${vices.length} moments of movement that the video shows were Badal turning around in the stall. <b>Breathing, lying, urination and manure were not measurable</b>: the muzzle, legs and bedding were out of view. Moving the camera to 3.5–4 m, high and angled down, brings all eight points into view.</p></section>

<section class="card"><h2>Best frames from the recording</h2><p class="sub">Colour and thermal at the same moment. The thermal lens sees a narrower, softer view of the head (too close for its 3.0–4.3 m focus).</p>
<div class="best">${best.map((b) => `<figure class="bframe"><img src="${b.colour}" alt="colour frame ${b.hm}" class="bcol"><img src="${b.thermal}" alt="thermal frame ${b.hm}" class="bthr"><figcaption><b>${clock(b.at)}</b>${b.caption ? ` · ${esc(b.caption)}` : ""}</figcaption></figure>`).join("")}</div></section>

<section class="points">
${points.map((p) => `<div class="pt"><span class="chip ${p.status}"><i>${statusIcon[p.status]}</i>${esc(p.tag)}</span><h3>${p.n}. ${esc(p.name)}</h3><div class="v">${esc(p.value)}</div><div class="s">${esc(p.sub)}</div><p>${esc(p.note)}</p></div>`).join("")}
</section>

<section class="card"><h2>The hour in pictures</h2><p class="sub">A colour frame every 2 minutes — hover or zoom for the time.</p>
<div class="strip">${strip.map((f) => f.img ? `<figure data-tip="${clock(f.at)}${captions[clock(f.at)] ? " · " + esc(captions[clock(f.at)]) : ""}"><img src="${f.img}" alt="frame at ${clock(f.at)}"><figcaption>${clock(f.at)}${captions[clock(f.at)] ? " ⓘ" : ""}</figcaption></figure>` : "").join("")}</div>
${Object.keys(captions).length ? `<ul class="notes">${Object.entries(captions).map(([k, v]) => `<li><b>${esc(k)}</b> — ${esc(v)}</li>`).join("")}</ul>` : ""}</section>

<section class="card"><h2>What was measured, minute by minute</h2><p class="sub">A filled cell is a minute with a reading.</p>${coverageChart()}</section>

<section class="card"><h2>Eye temperature</h2><p class="sub">Each mark is one reading. Kept as eye: 33 °C and above <b>and</b> the face in view on the video. The automatic eye search also picked warm folds of coat while Badal faced away — those are excluded.</p>
${tempChart()}
<div class="legend"><span><i class="sw eye"></i>eye, face in view (${eye.length})</span><span><i class="sw excl" style="border-radius:2px;border-style:dashed"></i>33 °C+ while facing away — warm coat, excluded (${awayWarm.length})</span><span><i class="sw excl"></i>below 33 °C — coat / forelock, excluded (${coat.length})</span><span>— — median of eye readings</span></div></section>

<section class="card"><h2>Activity per minute</h2><p class="sub">Share of the horse moving (0 = still, 1 = very active). ▲ = moments flagged as a vice (see the frames below).</p>
${barChart(act, { label: "activity", fmt: (v) => v.toFixed(1), markers: actMarkers })}
<div class="legend"><span><i class="sw eye" style="border-radius:2px"></i>activity</span><span><i class="sw flag"></i>flagged moment</span></div></section>

<section class="card"><h2>Standing still</h2><p class="sub">Share of each minute Badal stood still (stillness, not lying).</p>
${barChart(still, { label: "still", fmt: (v) => `${Math.round(v * 100)}%`, cls: "bar still", H: 110 })}</section>

<section class="card"><h2>Flagged moments, checked on the recorded video</h2><p class="sub">Frames cut from the recording at each flag — colour and thermal side by side.</p>
<div class="frames">${frames.map((fr) => `<figure class="frame"><div class="two">${fr.colour ? `<img src="${fr.colour}" alt="colour frame at ${clockS(fr.at)}">` : ""}${fr.thermal ? `<img src="${fr.thermal}" alt="thermal frame at ${clockS(fr.at)}">` : ""}</div><figcaption><b>${clockS(fr.at)}</b> · flagged "${esc(fr.kind)}" — Badal turning in the stall. Not confirmed as a vice.</figcaption></figure>`).join("") || "<p>No moments flagged.</p>"}</div></section>

<section class="card"><h2>Camera position</h2><p class="sub">What the camera saw at ${clock(opening.at)} — the horse facing it, head filling the colour picture.</p>
<div class="two">${opening.colour ? `<img src="${opening.colour}" alt="colour view" style="width:100%;border-radius:10px">` : ""}${opening.thermal ? `<img src="${opening.thermal}" alt="thermal view" style="width:100%;border-radius:10px">` : ""}</div>
<ul><li><b>Too close:</b> about 1.5–2 m from the head; the thermal lens is sharp only from 3.0–4.3 m, so the thermal picture is soft and eye readings run a little low.</li>
<li><b>Only the head and neck in view:</b> no legs (lying), no flank or muzzle much of the time (breathing), no bedding (urination, manure).</li>
<li><b>Next time:</b> 3.5–4 m from where the head usually is, high in a corner, angled down — the thermal view keeps the head, the colour view gets the whole horse and the floor. Then draw a floor box in the calibrator.</li></ul></section>

<section class="card"><h2>Honest limits</h2><ul>
<li>Behaviour measures (activity, stillness, vices, floor) are <b>prototypes</b> — methods proven on other animals, not yet validated on horses. Compare them with what the person at the stall saw.</li>
<li>Eye infrared temperature is a trend for this horse, not a rectal temperature; alerts compare with his own 7-day baseline, which a first session cannot have.</li>
<li>Nothing here is a diagnosis.</li></ul></section>

<section class="card"><h2>Stored for research</h2><ul>
<li>Readings: <code>~/EquiCare-demo/research/readings/</code> (every reading, kept permanently)</li>
<li>Video: <code>~/EquiCare-demo/recordings/</code> — ${vis.filter(inWin).length} colour and ${thr.filter(inWin).length} thermal clips in this window</li>
<li>Label the video in <b>Footage &amp; labels</b> to turn these prototypes into validated detectors.</li></ul>
<details style="margin-top:10px"><summary>Per-minute data (table)</summary><table><thead><tr><th>Time</th><th>Eye °C</th><th>Activity</th><th>Still</th><th>Flag</th></tr></thead><tbody>
${Array.from({ length: minutes }, (_, m) => { const e = eye.filter((r) => minuteOf(r) === m).map((r) => f1(r.value)).join(", "); const fl = vices.filter((r) => minuteOf(r) === m).length ? "▲" : ""; return `<tr><td>${clock(from + m * 60000)}</td><td>${e || "—"}</td><td>${act[m] === null ? "—" : act[m].toFixed(2)}</td><td>${still[m] === null ? "—" : Math.round(still[m] * 100) + "%"}</td><td>${fl}</td></tr>`; }).join("")}
</tbody></table></details></section>
<p class="muted" style="font-size:12px">Generated ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })} IST from the stored readings and recordings.</p>
</main><div id="tip"></div>
<script>
const tip=document.getElementById("tip");
document.addEventListener("pointermove",(e)=>{const t=e.target.closest&&e.target.closest("[data-tip]");if(!t){tip.style.display="none";return;}
tip.textContent=t.getAttribute("data-tip");tip.style.display="block";const r=tip.getBoundingClientRect();
let x=e.clientX+14,y=e.clientY+14;if(x+r.width>innerWidth-8)x=e.clientX-r.width-14;if(y+r.height>innerHeight-8)y=e.clientY-r.height-14;tip.style.left=x+"px";tip.style.top=y+"px";});
</script></body></html>`;

mkdirSync(outDir, { recursive: true });
const file = join(outDir, `${horse.id}-${new Date(from).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.html`);
writeFileSync(file, html);
console.log(file, `${Math.round(html.length / 1024)} KB`, `${rd.length} readings, ${eye.length} eye temps, ${vices.length} flags, ${frames.length} frames`);
