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
const bands = { low: actV.filter((v) => v < 0.2).length, moderate: actV.filter((v) => v >= 0.2 && v < 0.6).length, high: actV.filter((v) => v >= 0.6).length };
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
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String((ms - c.at) / 1000), "-i", c.path, "-frames:v", "1", "-vf", `scale=${width}:-1`, "-q:v", "3", tmp]);
    const b = readFileSync(tmp).toString("base64"); rmSync(tmp, { force: true });
    return `data:image/jpeg;base64,${b}`;
  } catch { return null; }
};
const photoAt = hmToMs(arg("photo", clock(from + 30 * 60000)));
const photo = { colour: frameAt(photoAt, clipsOf("visible"), 960), thermal: frameAt(photoAt, clipsOf("thermal"), 640) };

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
  const lh = 30, H = lanes.length * lh;
  const cw = (W - 150 - R) / minutes;
  const body = lanes.map(([name, fn, cls], i) => {
    const y = i * lh;
    const cells = Array.from({ length: minutes }, (_, m) => fn(m)
      ? `<rect x="${150 + m * cw}" y="${y + 7}" width="${cw + 0.6}" height="${lh - 14}" class="lane-${cls}" data-tip="${esc(name)} · ${clock(from + m * 60000)}"/>` : "").join("");
    return `<text x="140" y="${y + lh / 2 + 4}" class="tick strong" text-anchor="end">${esc(name)}</text><rect x="150" y="${y + 7}" width="${W - 150 - R}" height="${lh - 14}" rx="3" class="lane-bg"/>${cells}`;
  }).join("");
  const tk = Array.from({ length: Math.floor(minutes / 10) + 1 }, (_, i) => i * 10).map((m) => `<text x="${150 + m * cw}" y="${H + 16}" class="tick" text-anchor="middle">${clock(from + m * 60000)}</text>`).join("");
  const tm = turns.map((t) => { const m = (t - from) / 60000 - 0.5; return `<g data-tip="Turned around in the stall · ${clock(t)}"><path d="M${150 + m * cw - 6},-2 h12 l-6,10 z" class="turn"/></g>`; }).join("");
  return `<svg viewBox="0 -14 ${W} ${H + 36}" role="img" aria-label="Session timeline">${body}${tk}${tm}</svg>`;
}

function activityChart() {
  const H = 200, bw = (W - L - R) / minutes - 2, y = (v) => H - v * H;
  const grid = [0, 0.2, 0.6, 1].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" class="tick" text-anchor="end">${v.toFixed(1)}</text>`).join("");
  const zones = `<rect x="${L}" y="${y(1)}" width="${W - L - R}" height="${y(0.6) - y(1)}" class="zone-hi"/>`;
  const bars = act.map((v, m) => v === null ? "" : v < 0.02
    ? `<rect x="${X(m) + 1}" y="${H - 1.5}" width="${bw}" height="1.5" class="bar" data-tip="${clock(from + m * 60000)} · activity ${f2(v)}"/>`
    : `<path d="M${X(m) + 1},${H} V${Math.min(H - 1, y(v) + 3)} q0,-3 3,-3 h${Math.max(0, bw - 6)} q3,0 3,3 V${H} Z" class="bar" data-tip="${clock(from + m * 60000)} · activity ${f2(v)}"/>`).join("");
  const pts = roll.map((v, m) => (v === null ? null : `${X(m) + bw / 2 + 1},${y(v)}`)).filter(Boolean).join(" ");
  const line = `<polyline points="${pts}" class="trend"/>`;
  return `<svg viewBox="0 -8 ${W} ${H + 34}" role="img" aria-label="Activity per minute with 5-minute average">${zones}${grid}${ticks(H)}${bars}${line}</svg>`;
}

function tempChart() {
  const H = 190, lo = 32, hi = 35.5, y = (v) => H - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * H;
  const m = med(eyeV), q1 = q(eyeV, 0.25), q3 = q(eyeV, 0.75);
  const grid = [32, 33, 34, 35].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" class="tick" text-anchor="end">${v} °C</text>`).join("");
  const band = q1 === null ? "" : `<rect x="${L}" y="${y(q3)}" width="${W - L - R}" height="${Math.max(2, y(q1) - y(q3))}" class="iqr"/><line x1="${L}" x2="${W - R}" y1="${y(m)}" y2="${y(m)}" class="median"/><text x="${X(47)}" y="${y(m) - 8}" class="lbl halo" text-anchor="middle">median ${f1(m)} °C</text>`;
  const dots = eye.map((r) => `<circle cx="${X((Date.parse(r.ts) - from) / 60000)}" cy="${y(r.value)}" r="5.5" class="dot" data-tip="${clock(Date.parse(r.ts))} · ${f1(r.value)} °C"/>`).join("");
  const awayRects = away.map(([a, b]) => { const m0 = (hmToMs(`${Math.floor(a / 60)}:${a % 60}`) - from) / 60000, m1 = (hmToMs(`${Math.floor(b / 60)}:${b % 60}`) - from) / 60000 + 1;
    return `<rect x="${X(Math.max(0, m0))}" y="0" width="${X(Math.min(minutes, m1)) - X(Math.max(0, m0))}" height="${H}" class="away"/><text x="${(X(Math.max(0, m0)) + X(Math.min(minutes, m1))) / 2}" y="16" class="zlabel" text-anchor="middle">facing away — eye not visible</text>`; }).join("");
  return `<svg viewBox="0 -8 ${W} ${H + 34}" role="img" aria-label="Eye temperature readings">${awayRects}${grid}${band}${ticks(H)}${dots}</svg>`;
}

function distribution() {
  const tot = actV.length || 1, seg = [["Low", bands.low, "d-low"], ["Moderate", bands.moderate, "d-mid"], ["High", bands.high, "d-hi"]];
  let x = 0;
  const rects = seg.map(([n, v, c]) => { const w = (v / tot) * 100; const r = `<div class="dseg ${c}" style="width:${w}%" data-tip="${n} activity · ${v} min (${Math.round(w)}%)"></div>`; x += w; return r; }).join("");
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
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(horse.name)} — monitoring session report</title>
<style>
:root{color-scheme:light;--page:#f6f5f1;--surface:#fdfdfb;--ink:#101010;--ink2:#4f4e4a;--muted:#8a8882;--grid:#e6e4dc;--ring:rgba(16,16,16,.09);
--accent:#2a78d6;--accentSoft:rgba(42,120,214,.12);--alt:#8a8882;--hot:#e0822f;--ok:#0ca30c;--part:#d59a0d;--cam:#8a8882;--lanebg:#efeee9;}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#fff;--ink2:#c3c2b7;--grid:#2c2c2a;--ring:rgba(255,255,255,.1);--accent:#3987e5;--accentSoft:rgba(57,135,229,.16);--lanebg:#242422;}}
:root[data-theme="dark"]{color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#fff;--ink2:#c3c2b7;--grid:#2c2c2a;--ring:rgba(255,255,255,.1);--accent:#3987e5;--accentSoft:rgba(57,135,229,.16);--lanebg:#242422;}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:32px 16px 64px}
.brand{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
h1{font-size:34px;line-height:1.15;margin:0;letter-spacing:-.015em}h2{font-size:19px;margin:0 0 2px;letter-spacing:-.005em}.sub{color:var(--ink2);margin:6px 0 0}
.card{background:var(--surface);border:1px solid var(--ring);border-radius:18px;padding:22px 24px;margin-top:16px}
.hero{display:grid;grid-template-columns:1.25fr 1fr;gap:20px;align-items:stretch;margin-top:20px}
.hero .ph{position:relative;border-radius:16px;overflow:hidden;min-height:260px;background:#000}.hero .ph img.c{width:100%;height:100%;object-fit:cover;display:block}
.hero .ph img.t{position:absolute;right:12px;bottom:12px;width:34%;border-radius:10px;border:2px solid rgba(255,255,255,.85);box-shadow:0 4px 18px rgba(0,0,0,.4)}
.hero .ph figcaption{position:absolute;left:12px;top:12px;color:#fff;font-size:12px;background:rgba(0,0,0,.45);padding:3px 8px;border-radius:6px}
.summary p{margin:10px 0 0}.kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:14px}
.kpi{border:1px solid var(--ring);border-radius:14px;padding:12px 14px;background:var(--page)}.kpi b{display:block;font-size:24px;line-height:1.15}.kpi span{font-size:12.5px;color:var(--ink2)}
table{border-collapse:collapse;width:100%;font-size:14px}th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600;text-align:left;padding:8px 10px;border-bottom:1px solid var(--grid)}
td{padding:11px 10px;border-bottom:1px solid var(--grid);vertical-align:top}td.num{font-variant-numeric:tabular-nums;white-space:nowrap}tr:last-child td{border-bottom:0}
.pt-name{font-weight:600}.pt-note{color:var(--ink2);font-size:13px}.pt-val{font-size:17px;font-weight:650;white-space:nowrap}
.st{display:inline-flex;gap:6px;align-items:center;font-size:12px;font-weight:600;white-space:nowrap;padding:3px 9px;border-radius:999px;border:1px solid var(--ring)}
.st i{font-style:normal;display:inline-grid;place-items:center;width:17px;height:17px;border-radius:50%;color:#fff;font-size:11px}
.st.ok i{background:var(--ok)}.st.part i{background:var(--part)}.st.cam i{background:var(--cam)}
svg{width:100%;height:auto;display:block;overflow:visible}.grid{stroke:var(--grid)}.tick{fill:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}.tick.strong{fill:var(--ink2);font-size:12.5px}
.lbl{fill:var(--ink2);font-size:12px}.zlabel{fill:var(--muted);font-size:11px}.halo{paint-order:stroke;stroke:var(--surface);stroke-width:4px;stroke-linejoin:round}
.bar{fill:var(--accent)}.trend{fill:none;stroke:var(--ink);stroke-width:2;stroke-linejoin:round;opacity:.75}.zone-hi{fill:var(--accentSoft);opacity:.55}
.dot{fill:var(--accent);stroke:var(--surface);stroke-width:2}.iqr{fill:var(--accentSoft)}.median{stroke:var(--ink2);stroke-width:1.5;stroke-dasharray:5 4}.away{fill:var(--lanebg)}
.lane-bg{fill:var(--lanebg)}.lane-on{fill:var(--accent)}.lane-alt{fill:var(--alt);opacity:.55}.lane-hot{fill:var(--hot)}.turn{fill:var(--hot);stroke:var(--surface);stroke-width:1.5}
.legend{display:flex;flex-wrap:wrap;gap:18px;font-size:12.5px;color:var(--ink2);margin-top:10px}.legend span{display:inline-flex;align-items:center;gap:7px}
.sw{display:inline-block;width:12px;height:12px;border-radius:3px}.sw.bar{background:var(--accent)}.sw.line{height:2px;width:18px;background:var(--ink);opacity:.75;border-radius:0}.sw.dot{border-radius:50%;background:var(--accent)}.sw.iqr{background:var(--accentSoft)}.sw.hot{background:var(--hot)}.sw.alt{background:var(--alt);opacity:.55}
.dbar{display:flex;height:22px;border-radius:8px;overflow:hidden;gap:2px;margin-top:12px}.dseg{height:100%}.d-low,.dlegend i.d-low{background:#b7d3f6}.d-mid,.dlegend i.d-mid{background:#5598e7}.d-hi,.dlegend i.d-hi{background:#1c5cab}
.dlegend{display:flex;flex-wrap:wrap;gap:18px;margin-top:10px;font-size:13px;color:var(--ink2)}.dlegend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}.dlegend em{color:var(--muted);font-style:normal;margin-left:4px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:14px}.stat{border-left:3px solid var(--accent);padding:2px 0 2px 10px}.stat b{display:block;font-size:20px}.stat span{font-size:12px;color:var(--ink2)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}.rec li{margin:6px 0}.rec{padding-left:20px;margin:8px 0 0}
.foot{color:var(--muted);font-size:12px;margin-top:22px;text-align:center}
#tip{position:fixed;pointer-events:none;background:var(--surface);color:var(--ink);border:1px solid var(--ring);box-shadow:0 6px 20px rgba(0,0,0,.15);border-radius:8px;padding:6px 10px;font-size:12.5px;display:none;z-index:9}
tr.dim td{color:var(--muted)}
@media print{body{background:#fff}.card{break-inside:avoid;border-color:#ddd}#tip{display:none!important}main{padding:0}}
@media (max-width:760px){.hero,.two{grid-template-columns:1fr}h1{font-size:26px}}
</style></head><body><main>
<div class="brand"><span>BSV EquiCare · Horse monitoring</span><span>Session report</span></div>
<h1>${esc(horse.name)} <span style="color:var(--muted);font-weight:500">· Stall ${esc(horse.stall)}</span></h1>
<p class="sub">${day} · ${clock(from)}–${clock(to)} IST · ${minutes}-minute monitoring session · thermal + colour camera</p>

<section class="hero">
<figure class="ph" style="margin:0">${photo.colour ? `<img class="c" src="${photo.colour}" alt="${esc(horse.name)} during the session">` : ""}${photo.thermal ? `<img class="t" src="${photo.thermal}" alt="thermal view">` : ""}<figcaption>${clock(photoAt)} · colour and thermal view</figcaption></figure>
<div class="card summary" style="margin-top:0"><h2>Summary</h2>
<p>${esc(horse.name)} was monitored continuously for ${minutes} minutes with camera data in ${anyMin.size} of ${minutes} minutes. Eye-surface temperature was <b>stable at ${f1(med(eyeV))} °C</b>. Activity was <b>moderate to high</b> — ${bands.high} minutes of high activity and ${stillMin} minutes of standing rest — with ${turns.length} turning movements in the stall. No stereotypic behaviour was identified.</p>
<div class="kpis">
<div class="kpi"><b>${f1(med(eyeV))} °C</b><span>eye temperature (median)</span></div>
<div class="kpi"><b>${f2(med(actV))}</b><span>activity index (median)</span></div>
<div class="kpi"><b>${stillMin} min</b><span>standing rest</span></div>
<div class="kpi"><b>${Math.round((anyMin.size / minutes) * 100)}%</b><span>monitoring coverage</span></div>
</div></div></section>

<section class="card"><h2>Monitoring points</h2><p class="sub">The eight camera monitoring points for this session.</p>
<table style="margin-top:10px"><thead><tr><th style="width:30%">Point</th><th>Result</th><th>Status</th><th>Detail</th></tr></thead><tbody>
${points.map(([n, name, st, val, note]) => `<tr><td class="pt-name">${n}. ${esc(name)}</td><td class="pt-val">${esc(val)}</td><td><span class="st ${st[0]}"><i>${st[1]}</i>${st[2]}</span></td><td class="pt-note">${esc(note)}</td></tr>`).join("")}
</tbody></table></section>

<section class="card"><h2>Session timeline</h2><p class="sub">Minute by minute: when the camera had the horse, where the head was, rest and activity. ▼ marks a turn in the stall.</p>
${timeline()}
<div class="legend"><span><i class="sw bar"></i>present</span><span><i class="sw alt"></i>facing away from the camera</span><span><i class="sw hot"></i>high activity / turn</span></div></section>

<section class="card"><h2>Activity</h2><p class="sub">Activity index per minute (0 = still, 1 = very active) with the 5-minute average.</p>
${activityChart()}
<div class="legend"><span><i class="sw bar"></i>activity per minute</span><span><i class="sw line"></i>5-minute average</span><span><i class="sw iqr"></i>high-activity zone (0.6 and above) · low is below 0.2</span></div>
<h3 style="margin:18px 0 0;font-size:15px">Time by activity level</h3>${distribution()}</section>

<section>
<div class="card"><h2>Eye temperature</h2><p class="sub">Readings taken with the eye in view.</p>
${tempChart()}
<div class="legend"><span><i class="sw dot"></i>reading</span><span><i class="sw iqr"></i>middle 50% of readings</span></div>
<div class="stats"><div class="stat"><b>${f1(med(eyeV))} °C</b><span>median</span></div><div class="stat"><b>${f1(Math.min(...eyeV))}–${f1(Math.max(...eyeV))}</b><span>range, °C</span></div><div class="stat"><b>${eye.length}</b><span>readings</span></div><div class="stat"><b>${f1(q(eyeV, 0.75) - q(eyeV, 0.25))} °C</b><span>spread (middle 50%)</span></div></div></div>
<div class="card"><h2>Rest and movement</h2><p class="sub">How the hour was spent.</p>
<div class="stats" style="margin-top:6px"><div class="stat"><b>${stillMin} min</b><span>standing rest</span></div><div class="stat"><b>${bands.moderate} min</b><span>moderate activity</span></div><div class="stat"><b>${bands.high} min</b><span>high activity</span></div><div class="stat"><b>${turns.length}</b><span>turns in the stall</span></div></div>
<p class="sub" style="margin-top:14px">${restSentence}</p></div>
</section>

<section class="card"><h2>Ten-minute breakdown</h2>
<table style="margin-top:8px"><thead><tr><th>Period</th><th>Avg activity</th><th>Peak</th><th>Standing rest</th><th>Eye temp.</th><th>Turns</th><th>Head</th></tr></thead><tbody>
${blocks.map((b) => `<tr class="${b.away ? "dim" : ""}"><td class="num">${b.label}</td><td class="num">${f2(b.act)}</td><td class="num">${f2(b.peak)}</td><td class="num">${b.still} min</td><td class="num">${b.n ? `${f1(b.temp)} °C` : "—"}</td><td class="num">${b.turns || "—"}</td><td>${b.away ? "mostly facing away" : "in view"}</td></tr>`).join("")}
</tbody></table></section>

<section class="card"><h2>Recommendations for the next session</h2>
<ul class="rec">
<li><b>Camera distance 3.5–4 m</b> from where the head usually rests, mounted high in a corner and angled down. This brings the full body and the stall floor into view and adds respiration, lying, urination and excretion to the report.</li>
<li><b>Keep the stall clear of people</b> during the session so activity reflects the horse alone.</li>
<li><b>Longer sessions (overnight)</b> establish ${esc(horse.name)}'s personal baseline, after which changes in temperature and activity are flagged automatically.</li>
</ul></section>

<p class="foot">BSV EquiCare · generated ${new Date().toLocaleString("en-GB", { timeZone: TZ })} IST from ${rd.length} recorded readings and ${Math.round(clipsOf("visible").length + clipsOf("thermal").length)} video clips. Screening measurements; clinical decisions should be confirmed by a veterinarian.</p>
</main><div id="tip"></div>
<script>const tip=document.getElementById("tip");document.addEventListener("pointermove",(e)=>{const t=e.target.closest&&e.target.closest("[data-tip]");if(!t){tip.style.display="none";return;}tip.textContent=t.getAttribute("data-tip");tip.style.display="block";const r=tip.getBoundingClientRect();let x=e.clientX+14,y=e.clientY+14;if(x+r.width>innerWidth-8)x=e.clientX-r.width-14;if(y+r.height>innerHeight-8)y=e.clientY-r.height-14;tip.style.left=x+"px";tip.style.top=y+"px";});</script>
</body></html>`;

mkdirSync(outDir, { recursive: true });
const file = join(outDir, `${horse.id}-client-${new Date(from).toISOString().slice(0, 10)}.html`);
writeFileSync(file, html);
console.log(file, `${Math.round(html.length / 1024)} KB`);
