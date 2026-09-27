// Client edition of the session report: data-led, few photos, polished.
// Same stored readings and recordings as tools/session_report_html.mjs.
//
//   node tools/client_report_html.mjs --horse badal --from <ISO> --minutes 60 \
//        --away "16:40-16:59" --photo 17:29 [--out <dir>]
//
// Eye temperature keeps readings of 33 °C+ taken with the face in view
// (--away marks periods the video shows the horse facing away).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const HOME = join(homedir(), "EquiCare-demo");
const horseId = arg("horse", "badal");
const from = Date.parse(arg("from"));
const minutes = Number(arg("minutes", 60));
const to = from + minutes * 60000;
const state = JSON.parse(readFileSync(join(HOME, "data", "state.json"), "utf8"));
const outDir = arg("out", join(HOME, "research", "reports"));
const EYE_MIN = 33;
const TZ = "Asia/Kolkata";

const horse = state.entities.horses.find((h) => h.id === horseId) || { id: horseId, name: horseId, stall: "?" };
const cam = state.entities.devices.find((d) => d.kind === "thermal_camera" && d.stall === horse.stall) || null;
const rd = state.readings.filter((r) => r.horseId === horseId && Date.parse(r.ts) >= from && Date.parse(r.ts) <= to)
  .sort((a, b) => a.ts.localeCompare(b.ts));
const of = (m) => rd.filter((r) => r.metric === m);
const minuteOf = (r) => Math.min(minutes - 1, Math.floor((Date.parse(r.ts) - from) / 60000));
const clock = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : null; };
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f1 = (v) => (v === null || v === undefined ? "—" : (Math.round(v * 10) / 10).toFixed(1));
const f2 = (v) => (v === null || v === undefined ? "—" : v.toFixed(2));
const istMin = (ms) => { const d = new Date(ms + 5.5 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hmToMs = (hm) => { const [h, m] = hm.split(":").map(Number); const d = new Date(from + 5.5 * 3600000); d.setUTCHours(h, m, 0, 0); return d.getTime() - 5.5 * 3600000; };

// ---- data ------------------------------------------------------------------ //
const away = (arg("away", "") || "").split(",").filter(Boolean).map((w) => w.split("-").map((hm) => { const [h, m] = hm.trim().split(":").map(Number); return h * 60 + m; }));
const facingAway = (ms) => away.some(([a, b]) => istMin(ms) >= a && istMin(ms) <= b);
const temps = of("body_temp_c");
const eye = temps.filter((r) => r.value >= EYE_MIN && !facingAway(Date.parse(r.ts)));
const eyeV = eye.map((r) => r.value);
const act = new Array(minutes).fill(null), still = new Array(minutes).fill(null);
for (const r of of("activity_index")) act[minuteOf(r)] = r.value;
for (const r of of("inactive_minutes")) still[minuteOf(r)] = Math.min(1, r.value / (r.meta?.windowMin || 1));
const actV = act.filter((v) => v !== null);
const roll = act.map((_, i) => { const w = act.slice(Math.max(0, i - 2), i + 3).filter((v) => v !== null); return w.length ? avg(w) : null; });
const LEVELS = [["none", "No activity", 0, 0.05], ["low", "Low", 0.05, 0.2], ["moderate", "Moderate", 0.2, 0.6], ["high", "High", 0.6, 1.01]];
const levelOf = (v) => LEVELS.find(([, , lo, hi]) => v >= lo && v < hi)[0];
const bands = Object.fromEntries(LEVELS.map(([k, , lo, hi]) => [k, actV.filter((v) => v >= lo && v < hi).length]));
const stillMin = Math.round(still.filter((v) => v !== null).reduce((a, v) => a + v, 0));
const turns = of("vice_event").map((r) => Date.parse(r.ts));
const resp = of("respiratory_rate_bpm");
const anyMin = new Set(rd.map(minuteOf));
const headMin = new Set(eye.map(minuteOf));
const blocks = Array.from({ length: Math.ceil(minutes / 10) }, (_, b) => {
  const lo = b * 10, hi = Math.min(minutes, lo + 10);
  const a = act.slice(lo, hi).filter((v) => v !== null);
  const s = still.slice(lo, hi).filter((v) => v !== null).reduce((x, v) => x + v, 0);
  const t = eye.filter((r) => minuteOf(r) >= lo && minuteOf(r) < hi).map((r) => r.value);
  const ms0 = from + lo * 60000;
  const awayShare = Array.from({ length: hi - lo }, (_, k) => facingAway(from + (lo + k) * 60000 + 30000)).filter(Boolean).length / (hi - lo);
  return { label: `${clock(ms0)}–${clock(from + hi * 60000)}`, act: avg(a), peak: a.length ? Math.max(...a) : null, still: Math.round(s), temp: avg(t), n: t.length, turns: turns.filter((x) => x >= ms0 && x < from + hi * 60000).length, away: awayShare >= 0.5 };
});

// Rest spells (minutes with 30%+ standing still, gaps of 1 min joined) and the busiest block.
const spells = [];
for (let m = 0; m < minutes; m++) {
  if ((still[m] ?? 0) >= 0.3) {
    const last = spells.at(-1);
    if (last && m - last.end <= 2) last.end = m; else spells.push({ start: m, end: m });
  }
}
const busiest = blocks.filter((b) => b.act !== null).sort((a, b) => b.act - a.act)[0];
const restSentence = (spells.length
  ? `Rest came in ${spells.length} spell${spells.length > 1 ? "s" : ""}: ${spells.map((sp) => `${clock(from + sp.start * 60000)}–${clock(from + (sp.end + 1) * 60000)}`).join(", ")}. `
  : "No sustained rest spells. ") + (busiest ? `The most active period was ${busiest.label} (average ${f2(busiest.act)}).` : "");

// ---- one photo pair ----------------------------------------------------------- //
const recRoot = join(HOME, "recordings", cam?.id || "none");
const clipsOf = (stream) => {
  const dir = join(recRoot, stream);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".mp4")).map((f) => ({
    at: Date.parse(f.slice(0, -4).replace(/T(\d\d)-(\d\d)-(\d\d)$/, "T$1:$2:$3") + "+05:30"), path: join(dir, f) })).sort((a, b) => a.at - b.at);
};
const frameAt = (ms, clips, width) => {
  const c = [...clips].reverse().find((x) => x.at <= ms);
  if (!c) return null;
  const tmp = join(tmpdir(), `eqc-${ms}-${width}.jpg`);
  try {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String((ms - c.at) / 1000), "-i", c.path, "-frames:v", "1",
      "-vf", `crop=iw:ih*0.84:0:ih*0.08,scale=${width}:-1`, "-q:v", "3", tmp]);
    const b = readFileSync(tmp).toString("base64"); rmSync(tmp, { force: true });
    return `data:image/jpeg;base64,${b}`;
  } catch { return null; }
};
const photoAt = hmToMs(arg("photo", clock(from + 30 * 60000)));
const photo = { colour: frameAt(photoAt, clipsOf("visible"), 1100) };
const photo2At = arg("photo2") ? hmToMs(arg("photo2")) : null;
const photo2 = photo2At ? frameAt(photo2At, clipsOf("visible"), 1100) : null;
// Session gallery: --gallery "16:37=caption;17:03=caption;…" (frames cropped like the photo).
const gallery = (arg("gallery", "") || "").split(";").filter(Boolean).map((kv) => { const [hm, ...c] = kv.split("="); const at = hmToMs(hm.trim());
  return { at, caption: c.join("=").trim(), img: frameAt(at, clipsOf("visible"), 520) }; }).filter((g) => g.img);
const ref = `EQ-${horse.id.toUpperCase()}-${new Date(from + 5.5 * 3600000).toISOString().slice(0, 16).replace(/[-:T]/g, "").slice(0, 12)}`;

// ---- charts ----------------------------------------------------------------- //
const W = 920, L = 52, R = 18;
const X = (m) => L + (m / minutes) * (W - L - R);
const ticks = (h, top = 0) => Array.from({ length: Math.floor(minutes / 10) + 1 }, (_, i) => i * 10).map((m) =>
  `<line x1="${X(m)}" x2="${X(m)}" y1="${top}" y2="${h}" class="grid"/><text x="${X(m)}" y="${h + 17}" class="tick" text-anchor="middle">${clock(from + m * 60000)}</text>`).join("");

function timeline() {
  const lanes = [
    ["Camera data", (m) => anyMin.has(m), "on"],
    ["Head in view", (m) => headMin.has(m), "on"],
    ["Facing away", (m) => facingAway(from + m * 60000 + 30000), "alt"],
    ["Standing still", (m) => (still[m] ?? 0) >= 0.5, "on"],
    ["High activity", (m) => (act[m] ?? 0) >= 0.6, "hot"],
  ];
  const lh = 46, H = lanes.length * lh;
  const cw = (W - 150 - R) / minutes;
  const body = lanes.map(([name, fn, cls], i) => {
    const y = i * lh;
    const cells = Array.from({ length: minutes }, (_, m) => fn(m)
      ? `<rect x="${150 + m * cw}" y="${y + 10}" width="${cw + 0.6}" height="${lh - 20}" class="lane-${cls}" data-tip="${esc(name)} · ${clock(from + m * 60000)}"/>` : "").join("");
    return `<text x="140" y="${y + lh / 2 + 4}" class="tick strong" text-anchor="end">${esc(name)}</text><rect x="150" y="${y + 10}" width="${W - 150 - R}" height="${lh - 20}" rx="4" class="lane-bg"/>${cells}`;
  }).join("");
  const tk = Array.from({ length: Math.floor(minutes / 10) + 1 }, (_, i) => i * 10).map((m) => `<text x="${150 + m * cw}" y="${H + 16}" class="tick" text-anchor="middle">${clock(from + m * 60000)}</text>`).join("");
  const tm = turns.map((t) => { const m = (t - from) / 60000 - 0.5; return `<g data-tip="Turned around in the stall · ${clock(t)}"><path d="M${150 + m * cw - 6},-2 h12 l-6,10 z" class="turn"/></g>`; }).join("");
  return `<svg viewBox="0 -14 ${W} ${H + 36}" role="img" aria-label="Session timeline">${body}${tk}${tm}</svg>`;
}

function activityChart() {
  const H = 230, RG = 78, Wp = W - RG;                       // right gutter for level labels
  const Xa = (m) => L + (m / minutes) * (Wp - L);
  const bw = (Wp - L) / minutes - 3, y = (v) => H - v * H;
  const lvlName = Object.fromEntries(LEVELS.map(([k, n]) => [k, n]));
  // Level bands and labels (single axis, 0–1).
  const bandsSvg = [["high", 0.6, 1], ["moderate", 0.2, 0.6], ["low", 0.05, 0.2]].map(([k, lo, hi]) =>
    `<text x="${Wp + 12}" y="${(y(lo) + y(hi)) / 2 + 4}" class="lvl lvl-${k}">${lvlName[k]}</text>`).join("") +
    `<text x="${Wp + 12}" y="${H - 2}" class="lvl lvl-none">None</text>` +
    [0.2, 0.6].map((v) => `<line x1="${L}" x2="${Wp}" y1="${y(v)}" y2="${y(v)}" class="thr"/>`).join("");
  const grid = [0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => `<line x1="${L}" x2="${Wp}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 10}" y="${y(v) + 4}" class="tick" text-anchor="end">${v.toFixed(1)}</text>`).join("");
  const tk = Array.from({ length: Math.floor(minutes / 10) + 1 }, (_, i) => i * 10).map((m) => `<text x="${Xa(m)}" y="${H + 20}" class="tick" text-anchor="middle">${clock(from + m * 60000)}</text>`).join("");
  const bars = act.map((v, m) => {
    const x0 = Xa(m) + 1.5, tip = `${clock(from + m * 60000)} · `;
    if (v === null) return `<rect x="${x0}" y="${H - 10}" width="${bw}" height="10" rx="2" class="nodata" data-tip="${tip}no reading"/>`;
    const k = levelOf(v);
    if (k === "none") return `<rect x="${x0}" y="${H - 4}" width="${bw}" height="4" rx="2" class="b-none" data-tip="${tip}no activity (${f2(v)})"/>`;
    const top = y(v), r = Math.min(5, bw / 2);
    return `<path d="M${x0},${H} V${top + r} q0,-${r} ${r},-${r} h${bw - 2 * r} q${r},0 ${r},${r} V${H} Z" class="b-${k}" data-tip="${tip}${lvlName[k].toLowerCase()} activity (${f2(v)})"/>`;
  }).join("");
  // Smooth 5-minute average (Catmull-Rom → Bézier), a soft area under it, markers every 5 min.
  const pts = roll.map((v, m) => (v === null ? null : [Xa(m) + bw / 2 + 1.5, y(v), m, v])).filter(Boolean);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${Math.min(H, c1[1]).toFixed(1)} ${c2[0].toFixed(1)},${Math.min(H, c2[1]).toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  const area = `${d} L${pts.at(-1)[0]},${H} L${pts[0][0]},${H} Z`;
  const markers = pts.filter((p) => p[2] % 5 === 2).map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="5" class="avg-dot" data-tip="${clock(from + p[2] * 60000)} · 5-min average ${f2(p[3])}"/>`).join("");
  return `<svg viewBox="0 -10 ${W} ${H + 36}" role="img" aria-label="Activity per minute by level, with the 5-minute average">
<defs><linearGradient id="avgfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--avg)" stop-opacity=".28"/><stop offset="1" stop-color="var(--avg)" stop-opacity="0"/></linearGradient></defs>
${grid}${bandsSvg}${tk}${bars}<path d="${area}" fill="url(#avgfill)"/><path d="${d}" class="avg-line"/>${markers}
<line x1="${L}" x2="${Wp}" y1="${H}" y2="${H}" class="axis"/></svg>`;
}

function tempChart() {
  const H = 250, lo = 32, hi = 35.5, y = (v) => H - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * H;
  const m = med(eyeV), q1 = q(eyeV, 0.25), q3 = q(eyeV, 0.75);
  const grid = [32, 33, 34, 35].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" class="tick" text-anchor="end">${v} °C</text>`).join("");
  const band = q1 === null ? "" : `<rect x="${L}" y="${y(q3)}" width="${W - L - R}" height="${Math.max(2, y(q1) - y(q3))}" class="iqr"/><line x1="${L}" x2="${W - R}" y1="${y(m)}" y2="${y(m)}" class="median"/><text x="${X(47)}" y="${y(m) - 8}" class="lbl halo" text-anchor="middle">median ${f1(m)} °C</text>`;
  const dots = eye.map((r) => `<circle cx="${X((Date.parse(r.ts) - from) / 60000)}" cy="${y(r.value)}" r="5.5" class="dot" data-tip="${clock(Date.parse(r.ts))} · ${f1(r.value)} °C"/>`).join("");
  const awayRects = away.map(([a, b]) => { const m0 = (hmToMs(`${Math.floor(a / 60)}:${a % 60}`) - from) / 60000, m1 = (hmToMs(`${Math.floor(b / 60)}:${b % 60}`) - from) / 60000 + 1;
    return `<rect x="${X(Math.max(0, m0))}" y="0" width="${X(Math.min(minutes, m1)) - X(Math.max(0, m0))}" height="${H}" class="away"/><text x="${(X(Math.max(0, m0)) + X(Math.min(minutes, m1))) / 2}" y="16" class="zlabel" text-anchor="middle">facing away — eye not visible</text>`; }).join("");
  return `<svg viewBox="0 -8 ${W} ${H + 34}" role="img" aria-label="Eye temperature readings">${awayRects}${grid}${band}${ticks(H)}${dots}</svg>`;
}

function distribution() {
  const tot = actV.length || 1;
  const seg = [["High", bands.high, "lv-high"], ["Moderate", bands.moderate, "lv-moderate"], ["Low", bands.low, "lv-low"], ["No activity", bands.none, "lv-none"]];
  const rects = seg.filter(([, v]) => v > 0).map(([n, v, c]) => `<div class="dseg ${c}" style="width:${(v / tot) * 100}%" data-tip="${n} · ${v} min (${Math.round((v / tot) * 100)}%)"></div>`).join("");
  return `<div class="dbar">${rects}</div><div class="dlegend">${seg.map(([n, v, c]) => `<span><i class="${c}"></i>${n} <b>${v} min</b> <em>${Math.round((v / tot) * 100)}%</em></span>`).join("")}</div>`;
}

// ---- the 8 points ------------------------------------------------------------- //
const S = { ok: ["ok", "✓", "Measured"], part: ["part", "◐", "Partly captured"], cam: ["cam", "◌", "Needs camera repositioning"] };
const points = [
  [1, "Body temperature", S.ok, eye.length ? `${f1(med(eyeV))} °C` : "—", `Eye surface, ${eye.length} readings (${f1(Math.min(...eyeV))}–${f1(Math.max(...eyeV))} °C); stable through the session. Eye surface reads about 2 °C below rectal temperature.`],
  [2, "Respiration pattern", resp.length ? S.ok : S.cam, resp.length ? "Captured" : "—", "Requires the muzzle or flank in view for 30 s; the head was close to the lens."],
  [3, "Respiratory rate", resp.length ? S.ok : S.cam, resp.length ? `${f1(med(resp.map((r) => r.value)))} /min` : "—", "Same requirement as respiration pattern."],
  [4, "Activity", S.ok, f2(med(actV)), `Median activity index (0–1), measured in ${actV.length} of ${minutes} minutes; ${bands.high} minutes of high activity.`],
  [5, "Resting pattern", S.part, `${stillMin} min`, "Standing rest. Lying is detected from the full-body view, which this position did not give."],
  [6, "Stable vices", S.ok, "None", `No stereotypic behaviour (weaving, crib-biting, box walking) confirmed. ${turns.length} turning movements recorded and reviewed on video.`],
  [7, "Urination", S.cam, "—", "Requires the stall floor in view."],
  [8, "Excretion", S.cam, "—", "Requires the stall floor in view."],
];

// ---- page ------------------------------------------------------------------- //
const day = new Date(from).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ });
const eyeMed = med(eyeV), actMed = med(actV);
const findings = [
  ["thermo", "Temperature stable", `Eye-surface temperature held at ${f1(eyeMed)} °C (range ${f1(Math.min(...eyeV))}–${f1(Math.max(...eyeV))} °C across ${eye.length} readings), with no rising trend.`],
  ["move", "Active, alert behaviour", `${bands.high} minutes of high activity and ${bands.moderate} of moderate activity; ${stillMin} minutes of standing rest.`],
  ["check", "No stereotypic behaviour", `No weaving, crib-biting or box walking identified. ${turns.length} turning movements were recorded and reviewed.`],
];
const peopleAt = (arg("people", "") || "").split(",").filter(Boolean).map((x) => x.trim());
const awayText = away.map(([a, b]) => `${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}–${String(Math.floor(b / 60)).padStart(2, "0")}:${String(b % 60).padStart(2, "0")}`).join(", ");
const spellText = spells.map((sp) => `${clock(from + sp.start * 60000)}–${clock(from + (sp.end + 1) * 60000)}`).join(", ");
const observed = [
  ["Stable temperature", `Eye-surface temperature stayed within ${f1(Math.min(...eyeV))}–${f1(Math.max(...eyeV))} °C (median ${f1(eyeMed)} °C) with no upward drift — no indication of a developing fever during the session.`],
  ["Alert and engaged", "Head carried up, ears forward and eyes bright in the recorded frames; no signs of discomfort such as a lowered head, ears pinned back, a dull expression or flank-watching."],
  ["Active, with short rests", `${bands.high} minutes of high and ${bands.moderate} of moderate activity. Rest came in short spells (${spellText}), ${stillMin} minutes in total.`],
  ["Normal movement in the stall", `${turns.length} turns in the stall${awayText ? `, including a period facing away from the camera (${awayText})` : ""}. No rhythmic weaving, crib-biting or repeated circling.`],
];
const context = [
  ["Time of day", "Late afternoon is a naturally active period; horses rest mostly at night."],
  ["New equipment", "The camera was close to the head and Badal investigated it repeatedly — curiosity about a new object, which also raises the activity reading."],
  ...(peopleAt.length ? [["People in the stall", `A person was present around ${peopleAt.join(", ")}, overlapping the most active period.`]] : []),
  ["Feeding routine", "Horses become more active in the period before a scheduled feed."],
];
const icon = {
  thermo: '<path d="M10 3a2 2 0 0 1 4 0v10.3a4 4 0 1 1-4 0z"/><path d="M12 14v-5"/>',
  move: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
const svgIcon = (k) => `<svg viewBox="0 0 24 24" class="ico" aria-hidden="true">${icon[k]}</svg>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(horse.name)} — Monitoring Session Report</title>
<style>
:root{color-scheme:light;--page:#eef0f3;--surface:#ffffff;--ink:#0f1720;--ink2:#46505c;--muted:#8a929c;--grid:#e7eaee;--ring:rgba(15,23,32,.08);
--lv-high:#184f95;--lv-mod:#3987e5;--lv-low:#9ec5f4;--lv-none:#c9cdd3;--avg:#e0822f;--navy:#0f2a47;--navy2:#1c4a78;--accent:#2a78d6;--accentSoft:rgba(42,120,214,.12);--alt:#9aa3ad;--hot:#e0822f;--ok:#0ca30c;--part:#d59a0d;--cam:#9aa3ad;--lanebg:#f0f2f5;}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;--page:#0b0d10;--surface:#15181c;--ink:#f3f5f7;--ink2:#c0c6cd;--grid:#262b31;--ring:rgba(255,255,255,.08);--accent:#3987e5;--accentSoft:rgba(57,135,229,.18);--lanebg:#1f2328;}}
:root[data-theme="dark"]{color-scheme:dark;--page:#0b0d10;--surface:#15181c;--ink:#f3f5f7;--ink2:#c0c6cd;--grid:#262b31;--ring:rgba(255,255,255,.08);--accent:#3987e5;--accentSoft:rgba(57,135,229,.18);--lanebg:#1f2328;}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:none;margin:0 auto;padding:24px 0 40px}
.cover{background:linear-gradient(135deg,var(--navy) 0%,var(--navy2) 100%);color:#fff;border-radius:22px;padding:30px 34px 88px;position:relative;overflow:hidden}
.cover:after{content:"";position:absolute;right:-80px;top:-80px;width:320px;height:320px;border-radius:50%;background:rgba(255,255,255,.06)}
.cover .top{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;letter-spacing:.12em;text-transform:uppercase;opacity:.85}
.logo{display:inline-flex;align-items:center;gap:10px;font-weight:700;letter-spacing:.06em}.logo i{width:26px;height:26px;border-radius:8px;background:#fff;display:inline-grid;place-items:center;color:var(--navy);font-style:normal;font-size:14px}
.cover h1{font-size:40px;line-height:1.1;margin:26px 0 6px;letter-spacing:-.02em;font-weight:700}.cover h1 span{font-weight:400;opacity:.7}
.cover .meta{display:flex;flex-wrap:wrap;gap:8px 26px;font-size:14px;opacity:.9;margin-top:10px}.cover .meta b{font-weight:600}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:-60px 20px 0;position:relative;z-index:1}
.kpi{background:var(--surface);border-radius:16px;padding:16px 18px;box-shadow:0 10px 30px rgba(15,23,32,.10);border:1px solid var(--ring)}
.kpi b{display:block;font-size:28px;line-height:1.15;letter-spacing:-.01em}.kpi span{font-size:12.5px;color:var(--ink2)}.kpi small{display:block;font-size:11.5px;color:var(--muted);margin-top:2px}
section.card{background:var(--surface);border:1px solid var(--ring);border-radius:18px;padding:26px 28px;margin-top:18px}
.sh{display:flex;align-items:baseline;gap:12px;margin-bottom:4px}.sh .n{font-size:12px;font-weight:700;color:var(--accent);letter-spacing:.08em}.sh h2{font-size:20px;margin:0;letter-spacing:-.01em}
.sub{color:var(--ink2);margin:4px 0 0;font-size:14px}
.exec{display:grid;grid-template-columns:1.15fr 1fr;gap:26px;align-items:start}
.exec p.lead{font-size:16px;margin:10px 0 18px}
.find{display:flex;gap:14px;padding:12px 0;border-top:1px solid var(--grid)}.find:first-of-type{border-top:0}
.ico{width:22px;height:22px;flex:none;stroke:var(--accent);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;margin-top:2px}
.find b{display:block}.find span{color:var(--ink2);font-size:14px}
.gal{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-top:14px}.gal figure{margin:0}.gal img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;display:block}
.gal figcaption{font-size:12px;color:var(--ink2);margin-top:6px;line-height:1.35}.gal figcaption b{display:block;color:var(--ink);font-variant-numeric:tabular-nums}
.obs{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:10px}.obs h3{font-size:13px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:6px 0 4px}
.note{margin-top:14px;background:var(--lanebg);border-radius:12px;padding:12px 14px;font-size:13.5px;color:var(--ink2)}.note b{display:block;color:var(--ink);margin-bottom:2px}
.photo{margin:0;border-radius:14px;overflow:hidden;position:relative;display:flex;flex-direction:column}.photo img{width:100%;display:block;aspect-ratio:4/3;object-fit:cover}
.photos{display:flex;flex-direction:column;gap:10px}.photo figcaption{font-size:11px;margin-top:5px}.photo img{border-radius:12px}
.details{margin-top:10px;background:var(--lanebg);border-radius:12px;padding:10px 14px}.details h3{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:0 0 6px}
.details dl{display:grid;grid-template-columns:auto 1fr;gap:5px 16px;margin:0;font-size:11.5px}.details dt{color:var(--muted)}.details dd{margin:0;font-weight:600}
.photo figcaption{font-size:12.5px;color:var(--muted);margin-top:8px}
table{border-collapse:collapse;width:100%;font-size:14px}th{font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:600;text-align:left;padding:10px 12px;border-bottom:1px solid var(--grid)}
td{padding:13px 12px;border-bottom:1px solid var(--grid);vertical-align:top}td.num{font-variant-numeric:tabular-nums;white-space:nowrap}tbody tr:last-child td{border-bottom:0}
.pt-name{font-weight:600;white-space:nowrap}.pt-name small{display:block;color:var(--muted);font-weight:500;font-size:11.5px}.pt-note{color:var(--ink2);font-size:13.5px}.pt-val{font-size:18px;font-weight:650;white-space:nowrap}
.st{display:inline-flex;gap:7px;align-items:center;font-size:12px;font-weight:600;white-space:nowrap;padding:4px 10px;border-radius:999px;background:var(--lanebg)}
.st i{font-style:normal;display:inline-grid;place-items:center;width:17px;height:17px;border-radius:50%;color:#fff;font-size:11px}
.st.ok i{background:var(--ok)}.st.part i{background:var(--part)}.st.cam i{background:var(--cam)}
svg{width:100%;height:auto;display:block;overflow:visible}.grid{stroke:var(--grid)}.tick{fill:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}.tick.strong{fill:var(--ink2);font-size:12.5px}
.lbl{fill:var(--ink2);font-size:12px}.zlabel{fill:var(--muted);font-size:11px}.halo{paint-order:stroke;stroke:var(--surface);stroke-width:4px;stroke-linejoin:round}
.bar{fill:var(--accent)}.trend{fill:none;stroke:var(--ink);stroke-width:2;stroke-linejoin:round;opacity:.7}.zone-hi{fill:var(--accentSoft);opacity:.6}
.dot{fill:var(--accent);stroke:var(--surface);stroke-width:2}.iqr{fill:var(--accentSoft)}.median{stroke:var(--ink2);stroke-width:1.5;stroke-dasharray:5 4}.away{fill:var(--lanebg)}
.lane-bg{fill:var(--lanebg)}.lane-on{fill:var(--accent)}.lane-alt{fill:var(--alt);opacity:.55}.lane-hot{fill:var(--hot)}.turn{fill:var(--hot);stroke:var(--surface);stroke-width:1.5}
.legend{display:flex;flex-wrap:wrap;gap:18px;font-size:12.5px;color:var(--ink2);margin-top:12px}.legend span{display:inline-flex;align-items:center;gap:7px}
.sw{display:inline-block;width:12px;height:12px;border-radius:3px}.sw.bar{background:var(--accent)}.sw.line{height:2px;width:18px;background:var(--ink);opacity:.7;border-radius:0}.sw.dot{border-radius:50%;background:var(--accent)}.sw.iqr{background:var(--accentSoft)}.sw.hot{background:var(--hot)}.sw.alt{background:var(--alt);opacity:.55}
.dbar{display:flex;height:24px;border-radius:8px;overflow:hidden;gap:2px;margin-top:12px}.dseg{height:100%}
.lv-high{background:var(--lv-high)}.lv-moderate{background:var(--lv-mod)}.lv-low{background:var(--lv-low)}.lv-none{background:var(--lv-none)}
.b-high{fill:var(--lv-high);opacity:.9}.b-moderate{fill:var(--lv-mod);opacity:.85}.b-low{fill:var(--lv-low);opacity:.95}.b-none{fill:var(--lv-none)}
.nodata{fill:none;stroke:var(--lv-none);stroke-dasharray:2 2}.thr{stroke:var(--muted);stroke-width:1;stroke-dasharray:4 4;opacity:.6}.axis{stroke:var(--grid);stroke-width:1.5}
.lvl{font-size:11.5px;font-weight:600}.lvl-high{fill:var(--lv-high)}.lvl-moderate{fill:var(--lv-mod)}.lvl-low{fill:#6b9fd8}.lvl-none{fill:var(--muted)}
.avg-line{fill:none;stroke:var(--avg);stroke-width:2.5;stroke-linecap:round}.avg-dot{fill:var(--surface);stroke:var(--avg);stroke-width:2.5}
.sw.avgkey{width:22px;height:10px;background:linear-gradient(var(--avg),var(--avg)) center/100% 2.5px no-repeat;position:relative}.sw.avgkey:after{content:"";position:absolute;left:7px;top:1px;width:8px;height:8px;border-radius:50%;border:2.5px solid var(--avg);background:var(--surface);box-sizing:border-box}
.dlegend{display:flex;flex-wrap:wrap;gap:20px;margin-top:10px;font-size:13px;color:var(--ink2)}.dlegend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}.dlegend em{color:var(--muted);font-style:normal;margin-left:4px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px}.stat{background:var(--lanebg);border-radius:12px;padding:12px 14px}.stat b{display:block;font-size:21px;letter-spacing:-.01em}.stat span{font-size:12px;color:var(--ink2)}
.fig{font-size:11.5px;color:var(--muted);margin-top:10px;letter-spacing:.02em}
.rec{counter-reset:r;list-style:none;padding:0;margin:12px 0 0}.rec li{counter-increment:r;display:flex;gap:14px;padding:12px 0;border-top:1px solid var(--grid)}.rec li:first-child{border-top:0}
.rec li:before{content:counter(r);flex:none;width:26px;height:26px;border-radius:50%;background:var(--accentSoft);color:var(--accent);font-weight:700;font-size:13px;display:grid;place-items:center}
.page{width:210mm;min-height:297mm;margin:0 auto 18px;padding:9mm 9mm 7mm;background:var(--page);display:flex;flex-direction:column;box-shadow:0 8px 30px rgba(15,23,32,.12);border-radius:4px}
.page>section.card:last-of-type{flex:1}.page>section.card{margin-top:4.5mm}.page.p1>section.card{margin-top:5mm}
.pfoot{display:flex;justify-content:space-between;font-size:10px;color:var(--muted);padding:3.5mm 1mm 0;letter-spacing:.02em}
.about{display:grid;grid-template-columns:1fr 1fr;gap:10px 22px;margin-top:10px}.about div{border-top:1px solid var(--grid);padding-top:8px}.about b{display:block;font-size:12.5px}.about span{font-size:11.5px;color:var(--ink2)}
.foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;color:var(--muted);font-size:12px;margin-top:22px;padding:0 6px}
#tip{position:fixed;pointer-events:none;background:var(--surface);color:var(--ink);border:1px solid var(--ring);box-shadow:0 6px 20px rgba(0,0,0,.15);border-radius:8px;padding:6px 10px;font-size:12.5px;display:none;z-index:9}
tr.dim td{color:var(--muted)}
@page{size:A4;margin:0}
.page{font-size:12px;line-height:1.5}.page .cover{padding:20px 24px 64px;border-radius:14px}.page .cover h1{font-size:30px;margin-top:16px}.page .cover .meta{font-size:11.5px}
.page .kpis{grid-template-columns:repeat(4,1fr);margin:-46px 14px 0;gap:10px}.page .kpi{padding:10px 12px}.page .kpi b{font-size:21px}.page .kpi span{font-size:11px}.page .kpi small{font-size:10px}
.page section.card{padding:14px 16px;border-radius:12px}.page .sh h2{font-size:15.5px}.page .sub{font-size:11.5px}
.page .exec,.page .obs{grid-template-columns:1.15fr 1fr;gap:16px}.page .exec p.lead{font-size:12.5px;margin:6px 0 8px}.page .find{padding:6px 0}.page .find b{font-size:12px}.page .find span{font-size:11px}
.page .stats{grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}.page .stat{padding:8px 10px}.page .stat b{font-size:15px}.page .stat span{font-size:10.5px}
.page table{font-size:11px}.page td{padding:6px 8px}.page th{padding:5px 8px;font-size:10px}.page .pt-val{font-size:13px}.page .pt-note{font-size:10.5px}
.page .legend,.page .dlegend{font-size:10.5px;gap:12px}.page .rec li{padding:6px 0;font-size:11.5px}.page .gal{grid-template-columns:repeat(5,1fr);gap:8px;margin-top:10px}.page .gal figcaption{font-size:9.5px}.page .fig{font-size:10px;margin-top:6px}
.page .note{font-size:11px;padding:9px 11px}.page .obs h3{font-size:11px}
@media (max-width:820px){.gal{grid-template-columns:repeat(2,1fr)}.exec,.obs{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr);margin:-56px 10px 0}.stats{grid-template-columns:repeat(2,1fr)}.cover h1{font-size:30px}.cover{padding:24px 22px 80px}}
@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}html,body{background:var(--page)}main{padding:0}#tip{display:none!important}
.page{margin:0;box-shadow:none;border-radius:0;height:297mm;min-height:0;overflow:hidden;break-after:page}.page:last-child{break-after:auto}}
</style></head><body><main>
<div class="page p1">
<header class="cover">
<div class="top"><span class="logo"><i>E</i>EquiCare</span><span>Monitoring session report</span></div>
<h1>${esc(horse.name)} <span>· Stall ${esc(horse.stall)}</span></h1>
<div class="meta"><span><b>Date</b> ${day}</span><span><b>Session</b> ${clock(from)}–${clock(to)} IST (${minutes} min)</span><span><b>Monitoring</b> thermal + colour camera</span><span><b>Ref.</b> ${ref}</span></div>
</header>
<div class="kpis">
<div class="kpi"><b>${f1(eyeMed)} °C</b><span>Eye temperature</span><small>median · ${eye.length} readings</small></div>
<div class="kpi"><b>${f2(actMed)}</b><span>Activity index</span><small>median · scale 0–1</small></div>
<div class="kpi"><b>${stillMin} min</b><span>Standing rest</span><small>of ${minutes} minutes</small></div>
<div class="kpi"><b>${Math.round((anyMin.size / minutes) * 100)}%</b><span>Monitoring coverage</span><small>${anyMin.size} of ${minutes} minutes</small></div>
</div>

<section class="card"><div class="exec"><div>
<div class="sh"><span class="n">01</span><h2>Executive summary</h2></div>
<p class="lead">${esc(horse.name)} was monitored continuously for ${minutes} minutes. He appeared alert and interested in his surroundings, with stable temperature and no signs of discomfort or stereotypic behaviour. The high activity level reflects the afternoon period and a new camera close to his head more than any concern.</p>
${findings.map(([k, t, d]) => `<div class="find">${svgIcon(k)}<div><b>${esc(t)}</b><span>${esc(d)}</span></div></div>`).join("")}
<div class="details"><h3>Session details</h3><dl>
<dt>Horse</dt><dd>${esc(horse.name)}</dd><dt>Stall</dt><dd>${esc(horse.stall)}</dd>
<dt>Date</dt><dd>${new Date(from).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TZ })}</dd><dt>Session</dt><dd>${clock(from)}–${clock(to)} IST</dd>
<dt>Monitoring</dt><dd>Thermal + colour camera</dd><dt>Coverage</dt><dd>${anyMin.size} of ${minutes} min</dd>
<dt>Readings</dt><dd>${rd.length}</dd><dt>Video recorded</dt><dd>${clipsOf("visible").length + clipsOf("thermal").length} clips</dd>
</dl></div>
</div>
<div class="photos">${photo.colour ? `<figure class="photo"><img src="${photo.colour}" alt="${esc(horse.name)} at ${clock(photoAt)}"><figcaption>${clock(photoAt)} · calm, eye bright</figcaption></figure>` : ""}${photo2 ? `<figure class="photo"><img src="${photo2}" alt="${esc(horse.name)} at ${clock(photo2At)}"><figcaption>${clock(photo2At)} · alert, ears forward</figcaption></figure>` : ""}</div>
</div></section>

<div class="pfoot"><span>EquiCare · ${esc(horse.name)} · Ref. ${ref}</span><span>Page 1 of 5</span></div></div>
<div class="page">
<section class="card"><div class="sh"><span class="n">02</span><h2>Behaviour and wellbeing observations</h2></div><p class="sub">What the session showed about ${esc(horse.name)}, and the likely reasons behind his activity level.</p>
<div class="obs">
<div><h3>Observed</h3>${observed.map(([t, d]) => `<div class="find">${svgIcon("check")}<div><b>${esc(t)}</b><span>${esc(d)}</span></div></div>`).join("")}</div>
<div><h3>Likely reasons for the activity level</h3>${context.map(([t, d]) => `<div class="find"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5v.5"/></svg><div><b>${esc(t)}</b><span>${esc(d)}</span></div></div>`).join("")}
<div class="note"><b>Next session will add</b>Respiration, lying pattern, urination and excretion (with the camera repositioned), and ${esc(horse.name)}'s personal baseline — horses vary, so future readings are compared with his own normal.</div></div>
</div></section>

<section class="card"><div class="sh"><span class="n">03</span><h2>Session gallery</h2></div><p class="sub">${gallery.length} moments from the recording, in time order.</p>
<div class="gal">${gallery.map((g) => `<figure><img src="${g.img}" alt="${esc(horse.name)} at ${clock(g.at)}"><figcaption><b>${clock(g.at)}</b>${esc(g.caption)}</figcaption></figure>`).join("")}</div></section>

<div class="pfoot"><span>EquiCare · ${esc(horse.name)} · Ref. ${ref}</span><span>Page 2 of 5</span></div></div>
<div class="page">
<section class="card"><div class="sh"><span class="n">04</span><h2>Monitoring points</h2></div><p class="sub">Results for the eight camera monitoring points.</p>
<table style="margin-top:12px"><thead><tr><th>Monitoring point</th><th>Result</th><th>Status</th><th>Notes</th></tr></thead><tbody>
${points.map(([n, name, st, val, note]) => `<tr><td class="pt-name">${esc(name)}<small>Point ${n}</small></td><td class="pt-val">${esc(val)}</td><td><span class="st ${st[0]}"><i>${st[1]}</i>${st[2]}</span></td><td class="pt-note">${esc(note)}</td></tr>`).join("")}
</tbody></table></section>

<section class="card"><div class="sh"><span class="n">05</span><h2>Session timeline</h2></div><p class="sub">Minute-by-minute view of monitoring, head position, rest and activity. ▼ marks a turn in the stall.</p>
<div style="margin-top:14px">${timeline()}</div>
<div class="legend"><span><i class="sw bar"></i>present</span><span><i class="sw alt"></i>facing away from the camera</span><span><i class="sw hot"></i>high activity / turn</span></div>
<p class="fig">Figure 1 · Session timeline</p></section>

<div class="pfoot"><span>EquiCare · ${esc(horse.name)} · Ref. ${ref}</span><span>Page 3 of 5</span></div></div>
<div class="page">
<section class="card"><div class="sh"><span class="n">06</span><h2>Activity</h2></div><p class="sub">Each bar is one minute, coloured by activity level (activity index 0 = still, 1 = very active); the line is the 5-minute average.</p>
<div style="margin-top:14px">${activityChart()}</div>
<div class="legend"><span><i class="sw lv-high"></i>High (0.6+)</span><span><i class="sw lv-moderate"></i>Moderate (0.2–0.6)</span><span><i class="sw lv-low"></i>Low (0.05–0.2)</span><span><i class="sw lv-none"></i>No activity</span><span><i class="sw avgkey"></i>5-minute average</span></div>
<p class="fig">Figure 2 · Activity per minute</p>
<h3 style="margin:22px 0 0;font-size:15px">Time by activity level</h3>${distribution()}
<div class="stats"><div class="stat"><b>${bands.high} min</b><span>high activity</span></div><div class="stat"><b>${bands.moderate} min</b><span>moderate activity</span></div><div class="stat"><b>${bands.low + bands.none} min</b><span>low or no activity</span></div><div class="stat"><b>${turns.length}</b><span>turns in the stall</span></div></div>
<p class="sub" style="margin-top:14px">${restSentence}</p></section>

<section class="card"><div class="sh"><span class="n">07</span><h2>Eye temperature</h2></div><p class="sub">Readings taken with the eye in view. Eye-surface temperature reads about 2 °C below rectal temperature.</p>
<div style="margin-top:14px">${tempChart()}</div>
<div class="legend"><span><i class="sw dot"></i>reading</span><span><i class="sw iqr"></i>middle 50% of readings</span><span>— — median</span>${away.length ? '<span><i class="sw" style="background:var(--lanebg);border:1px solid var(--grid)"></i>facing away (eye not visible)</span>' : ""}</div>
<p class="fig">Figure 3 · Eye temperature</p>
<div class="stats"><div class="stat"><b>${f1(eyeMed)} °C</b><span>median</span></div><div class="stat"><b>${f1(Math.min(...eyeV))}–${f1(Math.max(...eyeV))} °C</b><span>range</span></div><div class="stat"><b>${eye.length}</b><span>readings</span></div><div class="stat"><b>${f1(q(eyeV, 0.75) - q(eyeV, 0.25))} °C</b><span>spread (middle 50%)</span></div></div></section>

<div class="pfoot"><span>EquiCare · ${esc(horse.name)} · Ref. ${ref}</span><span>Page 4 of 5</span></div></div>
<div class="page">
<section class="card"><div class="sh"><span class="n">08</span><h2>Ten-minute breakdown</h2></div>
<table style="margin-top:10px"><thead><tr><th>Period</th><th>Avg activity</th><th>Peak</th><th>Standing rest</th><th>Eye temp.</th><th>Turns</th><th>Head position</th></tr></thead><tbody>
${blocks.map((b) => `<tr class="${b.away ? "dim" : ""}"><td class="num">${b.label}</td><td class="num">${f2(b.act)}</td><td class="num">${f2(b.peak)}</td><td class="num">${b.still} min</td><td class="num">${b.n ? `${f1(b.temp)} °C` : "—"}</td><td class="num">${b.turns || "—"}</td><td>${b.away ? "mostly facing away" : "in view"}</td></tr>`).join("")}
</tbody></table></section>

<section class="card"><div class="sh"><span class="n">09</span><h2>Recommendations</h2></div>
<ol class="rec">
<li><div><b>Position the camera 3.5–4 m from the horse's usual head position,</b> mounted high in a corner and angled down. The full body and stall floor then come into view, adding respiration, lying, urination and excretion to the report.</div></li>
<li><div><b>Keep the stall clear of people during monitoring</b> so that activity reflects the horse alone.</div></li>
<li><div><b>Run longer sessions, such as overnight,</b> to establish ${esc(horse.name)}'s personal baseline. Changes in temperature and activity are then flagged automatically.</div></li>
</ol></section>

<section class="card"><div class="sh"><span class="n">10</span><h2>About this report</h2></div>
<div class="about">
<div><b>Eye temperature</b><span>Read by the thermal camera at the inner corner of the eye whenever the eye is in view; periods when the horse faces away are left out. Eye-surface temperature runs about 2 °C below rectal temperature and is tracked as a trend for each horse.</span></div>
<div><b>Activity index</b><span>The share of the horse moving, minute by minute, from the colour camera: 0 = still, 1 = very active. Levels: no activity below 0.05, low 0.05–0.2, moderate 0.2–0.6, high 0.6 and above.</span></div>
<div><b>Standing rest</b><span>Minutes in which the horse stood still. Lying down is reported separately once the full body is in view.</span></div>
<div><b>Stable vices</b><span>Weaving, box walking and head tossing are identified from rhythmic movement patterns and reviewed against the recording.</span></div>
<div><b>Monitoring coverage</b><span>${anyMin.size} of ${minutes} minutes with camera data; ${rd.length} readings and ${clipsOf("visible").length + clipsOf("thermal").length} video clips recorded for this session.</span></div>
<div><b>Screening</b><span>Measurements support daily care and early attention; clinical decisions should be confirmed by a veterinarian.</span></div>
</div></section>
<div class="pfoot"><span>EquiCare · ${esc(horse.name)} · Ref. ${ref}</span><span>Page 5 of 5</span></div></div>
</main><div id="tip"></div>
<script>const tip=document.getElementById("tip");document.addEventListener("pointermove",(e)=>{const t=e.target.closest&&e.target.closest("[data-tip]");if(!t){tip.style.display="none";return;}tip.textContent=t.getAttribute("data-tip");tip.style.display="block";const r=tip.getBoundingClientRect();let x=e.clientX+14,y=e.clientY+14;if(x+r.width>innerWidth-8)x=e.clientX-r.width-14;if(y+r.height>innerHeight-8)y=e.clientY-r.height-14;tip.style.left=x+"px";tip.style.top=y+"px";});</script>
</body></html>`;

mkdirSync(outDir, { recursive: true });
const file = join(outDir, `${horse.id}-client-${new Date(from).toISOString().slice(0, 10)}.html`);
writeFileSync(file, html);
console.log(file, `${Math.round(html.length / 1024)} KB`);
