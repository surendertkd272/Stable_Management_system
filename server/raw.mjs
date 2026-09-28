// Raw motion recordings from the wearable set, and turning them into readings.
//
// The hub uploads a sensor's raw samples for a stretch of time (a trot-up, an
// exercise session): POST /ingest/raw, one sensor per upload, headers X-Sensor
// (leg | head | pelvis), X-Start (ISO time of the first sample), X-Rate-Hz;
// body = CSV  t,ax,ay,az,gx,gy,gz[,mx,my,mz]  (t in seconds from X-Start,
// accel m/s², gyro °/s), optionally gzipped.
//
// Kept on disk as <dataDir>/raw/<horseId>/<YYYY-MM-DD>/<start>-<sensor>-<deviceId>.csv.gz
// and indexed as the `raw_sessions` entity. Kept EQUICARE_RAW_DAYS (30) days.
//
// Processing: once a leg recording has its head and/or pelvis recordings
// (overlapping in time) — or has waited PAIR_WAIT_MS for them — the gait
// analysis (server/gait.mjs, or an injected analyzer) runs over the time they
// overlap, and its results go into the store as ordinary readings:
// exercise_session, steps and, when a straight trot was found, lameness_result
// — source imu, meta.prototype true (the analysis is not validated on horses
// yet), meta.rawSessionIds naming the recordings they came from.
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, renameSync, rmdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { WEARABLE_SENSORS, dedupKey } from "./contract.mjs";

export const MAX_RAW_BYTES = 50 * 1024 * 1024;        // per upload, as received
const MAX_CSV_BYTES = 256 * 1024 * 1024;              // after gunzip (a zip bomb stops here)
const PAIR_WAIT_MS = 10 * 60_000;                     // how long a leg recording waits for its partners
const MIN_OVERLAP_S = 10;                             // shorter overlap than this is not "the same session"
const MAX_LIST = 500;
export const rawDays = () => Math.max(1, Number(process.env.EQUICARE_RAW_DAYS) || 30);

export class RawError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// A path segment from an id: nothing but these characters, and never "." or "..".
const safe = (s) => { const x = String(s).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80); return !x || /^\.+$/.test(x) ? "_" : x; };
const compact = (iso) => iso.replace(/[-:]/g, "").replace(/\.\d+/, "");     // 2026-09-29T10:15:00.000Z -> 20260929T101500Z
const isGzip = (b) => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;

/**
 * Check an upload is the CSV it claims to be, without keeping the numbers —
 * the same rules as the gait parser (gait.mjs parseRawCsv): an optional header
 * row naming the columns (any order), else 7 or 10 by position; blank lines
 * and # comments skipped; every sample numeric; t never going backwards.
 * Returns { samples, lastT }.
 */
const BASE_COLS = ["t", "ax", "ay", "az", "gx", "gy", "gz"];
export function checkRawCsv(text) {
  let samples = 0, width = 0, idx = null, lastT = -Infinity, line = 0, pos = 0;
  while (pos < text.length) {
    let nl = text.indexOf("\n", pos);
    if (nl < 0) nl = text.length;
    const row = text.slice(pos, nl).trim();
    pos = nl + 1; line++;
    if (!row || row[0] === "#") continue;
    const f = row.split(",").map((c) => c.trim());
    if (!idx) {
      if (f.some((c) => /^[a-z_]/i.test(c))) {
        const names = f.map((c) => c.toLowerCase());
        const missing = BASE_COLS.filter((c) => !names.includes(c));
        if (missing.length) throw new RawError(400, `line ${line}: the header lacks ${missing.join(", ")} (t,ax,ay,az,gx,gy,gz[,mx,my,mz])`);
        idx = [...BASE_COLS, ...["mx", "my", "mz"].filter((c) => names.includes(c))].map((c) => names.indexOf(c));
        width = names.length;
        continue;
      }
      if (f.length !== 7 && f.length !== 10) throw new RawError(400, `line ${line}: expected 7 columns (t,ax,ay,az,gx,gy,gz) or 10 (+ mx,my,mz), found ${f.length}`);
      width = f.length;
      idx = f.map((_, i) => i);
    }
    if (f.length !== width) throw new RawError(400, `line ${line}: ${f.length} columns where the file has ${width}`);
    for (const i of idx) if (f[i] === "" || !Number.isFinite(Number(f[i]))) throw new RawError(400, `line ${line}: "${f[i].slice(0, 20)}" is not a number`);
    const t = Number(f[idx[0]]);
    if (t < lastT) throw new RawError(400, `line ${line}: t goes backwards (${t} after ${lastT})`);
    lastT = t; samples++;
  }
  if (!samples) throw new RawError(400, "no samples in the upload");
  return { samples, lastT };
}

/**
 * One series resampled onto a uniform grid t = k / rateHz, k = 0.. over
 * [offsetS, offsetS + durS] of its own time — how recordings that started at
 * different moments (or rates) are aligned to a common start for the analysis.
 * Linear interpolation; every channel the parser produced is carried.
 */
export function alignSeries(series, offsetS, durS, rateHz) {
  const n = Math.max(0, Math.floor(durS * rateHz) + 1);
  const src = series.t;
  const keys = Object.keys(series).filter((k) => k !== "t" && series[k] && typeof series[k].length === "number" && series[k].length === src.length);
  const out = { t: new Float64Array(n) };
  for (const k of keys) out[k] = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const tt = offsetS + i / rateHz;
    out.t[i] = i / rateHz;
    while (j < src.length - 2 && src[j + 1] <= tt) j++;
    const t0 = src[j], t1 = src[Math.min(j + 1, src.length - 1)];
    const w = t1 > t0 ? Math.max(0, Math.min(1, (tt - t0) / (t1 - t0))) : 0;
    for (const k of keys) {
      const a = series[k][j], b = series[k][Math.min(j + 1, src.length - 1)];
      out[k][i] = a + (b - a) * w;
    }
  }
  return out;
}

/**
 * The raw store. `analyzer` is { parseRawCsv, analyzeSession } or a function
 * resolving to one (default: server/gait.mjs, loaded when first needed — so
 * uploads work, and wait, while it is missing). `expectedSensors(session)`
 * lists the partner sensors a leg recording should wait for.
 */
export function rawStore({ store, dataDir, analyzer, now = () => Date.now(), expectedSensors = () => ["head"], log = console } = {}) {
  const at = (rel) => join(dataDir, rel);              // index paths are relative to the data dir
  const sessions = () => store.list("raw_sessions");
  let loaded = null, warned = false, running = null;

  async function getAnalyzer() {
    if (loaded) return loaded;
    try {
      const a = typeof analyzer === "function" ? await analyzer()
        : analyzer ?? await import("./gait.mjs");
      if (typeof a?.analyzeSession !== "function" || typeof a?.parseRawCsv !== "function")
        throw new Error("analyzeSession / parseRawCsv not exported");
      return (loaded = a);
    } catch (e) {
      if (!warned) log.warn?.(`[raw] gait analysis unavailable (${e.message}) — recordings are kept and processed once it is`);
      warned = true;
      return null;
    }
  }

  /** Store one upload. Returns { status, body }; throws RawError on a bad one. */
  function upload({ horseId, deviceId, headers, bytes }) {
    const h = (k) => headers.get(k);
    const sensor = String(h("x-sensor") || "").trim().toLowerCase();
    if (!WEARABLE_SENSORS.includes(sensor)) throw new RawError(400, `X-Sensor must be ${WEARABLE_SENSORS.join(", ")}`);
    const startMs = Date.parse(h("x-start") || "");
    if (!Number.isFinite(startMs)) throw new RawError(400, "X-Start must be the ISO time of the first sample");
    if (startMs > now() + 24 * 3600_000) throw new RawError(400, "X-Start is in the future — check the hub's clock");
    if (startMs < now() - rawDays() * 24 * 3600_000) throw new RawError(400, `X-Start is older than the ${rawDays()}-day raw retention`);
    const rateHz = Number(h("x-rate-hz"));
    if (!(Number.isFinite(rateHz) && rateHz >= 1 && rateHz <= 2000)) throw new RawError(400, "X-Rate-Hz must be the sample rate, 1–2000");
    if (bytes.length > MAX_RAW_BYTES) throw new RawError(413, `an upload is at most ${MAX_RAW_BYTES / 1048576} MB`);
    if (!bytes.length) throw new RawError(400, "empty upload");

    // Stored gzipped either way; a gzipped upload is kept as sent.
    const gz = /gzip/i.test(h("content-encoding") || "") || isGzip(bytes);
    let text, stored;
    if (gz) {
      try { text = gunzipSync(bytes, { maxOutputLength: MAX_CSV_BYTES }).toString("utf8"); }
      catch (e) {
        if (e.code === "ERR_BUFFER_TOO_LARGE" || e instanceof RangeError) throw new RawError(413, `the unzipped CSV is over ${MAX_CSV_BYTES / 1048576} MB`);
        throw new RawError(400, "the body says gzip but does not unzip");
      }
      stored = bytes;
    } else {
      text = bytes.toString("utf8");
    }
    const { samples, lastT } = checkRawCsv(text);
    if (!stored) stored = gzipSync(bytes);

    const start = new Date(startMs).toISOString();
    const rel = join("raw", safe(horseId), start.slice(0, 10), `${compact(start)}-${sensor}-${safe(deviceId)}.csv.gz`);
    const dup = sessions().find((s) => s.path === rel);
    // The same recording again (a retry, the relay re-delivering): one copy.
    if (dup) return { status: 200, body: { duplicate: true, id: dup.id, sensor, start, samples: dup.samples, processed: dup.processed } };

    const file = at(rel);
    mkdirSync(/*turbopackIgnore: true*/ dirname(file), { recursive: true });
    const tmp = `${file}.part`;
    writeFileSync(/*turbopackIgnore: true*/ tmp, stored);
    renameSync(/*turbopackIgnore: true*/ tmp, file);
    const row = store.create("raw_sessions", {
      horseId, deviceId, sensor, start, end: new Date(startMs + Math.round(Math.max(0, lastT) * 1000)).toISOString(),
      rateHz, samples, bytes: stored.length, path: rel, processed: false, results: null,
      uploadedAt: new Date(now()).toISOString(),
    });
    return { status: 201, body: { id: row.id, sensor, start, samples, bytes: stored.length, processed: false } };
  }

  function list({ horseId } = {}) {
    return sessions().filter((s) => !horseId || s.horseId === horseId)
      .sort((a, b) => b.start.localeCompare(a.start) || a.sensor.localeCompare(b.sensor)).slice(0, MAX_LIST);
  }

  const overlapS = (a, b) => (Math.min(Date.parse(a.end), Date.parse(b.end)) - Math.max(Date.parse(a.start), Date.parse(b.start))) / 1000;
  const readCsv = (s) => gunzipSync(readFileSync(/*turbopackIgnore: true*/ at(s.path)), { maxOutputLength: MAX_CSV_BYTES }).toString("utf8");

  /** Analyse every leg recording that is ready; returns how many were. */
  function processPending() {
    running ??= (async () => {
      try { return await processOnce(); }
      finally { running = null; }
    })();
    return running;
  }

  async function processOnce() {
    const all = sessions();
    const pending = all.filter((s) => !s.processed);
    if (!pending.length) return 0;
    let done = 0;
    for (const leg of pending.filter((s) => s.sensor === "leg").sort((a, b) => a.start.localeCompare(b.start))) {
      const partners = all.filter((s) => s.horseId === leg.horseId && s.sensor !== "leg" && overlapS(leg, s) >= MIN_OVERLAP_S);
      const have = new Set(partners.map((s) => s.sensor));
      const waited = now() - Date.parse(leg.uploadedAt) >= PAIR_WAIT_MS;
      if (!waited && !expectedSensors(leg).every((x) => have.has(x))) continue;
      const a = await getAnalyzer();
      if (!a) return done;                            // keep everything for when it is available
      const head = partners.filter((s) => s.sensor === "head").sort((x, y) => overlapS(leg, y) - overlapS(leg, x))[0] ?? null;
      const pelvis = partners.filter((s) => s.sensor === "pelvis").sort((x, y) => overlapS(leg, y) - overlapS(leg, x))[0] ?? null;
      const used = [leg, head, pelvis].filter(Boolean);
      let results;
      try {
        results = analyse(a, leg, head, pelvis);
      } catch (e) {
        results = { error: String(e.message || e).slice(0, 300) };
        log.warn?.(`[raw] analysis of ${leg.id} failed: ${results.error}`);
      }
      const stamp = new Date(now()).toISOString();
      for (const s of used) store.update("raw_sessions", s.id, {
        processed: true, processedAt: stamp, results: s === leg ? results : { usedWith: leg.id },
      });
      done++;
    }
    // A head or pelvis recording no leg recording ever overlapped: say why it
    // produced nothing, rather than leaving it "pending" for ever.
    for (const s of sessions().filter((x) => !x.processed && x.sensor !== "leg")) {
      if (now() - Date.parse(s.uploadedAt) < PAIR_WAIT_MS) continue;
      if (sessions().some((l) => l.sensor === "leg" && l.horseId === s.horseId && overlapS(l, s) >= MIN_OVERLAP_S)) continue;
      store.update("raw_sessions", s.id, { processed: true, processedAt: new Date(now()).toISOString(),
        results: { skipped: "no leg-tag recording overlaps this one — steps and lameness need the leg tag" } });
    }
    return done;
  }

  /** Align, analyse, and store the results as readings. The window is the
   *  time ALL the recordings used cover — normally the whole session, since
   *  the hub starts and stops its sensors together. */
  function analyse(a, leg, head, pelvis) {
    const parts = [leg, head, pelvis].filter(Boolean);
    const from = Math.max(...parts.map((s) => Date.parse(s.start)));
    const to = Math.min(...parts.map((s) => Date.parse(s.end)));
    const durS = (to - from) / 1000;
    const rateHz = leg.rateHz;
    const series = (s) => s ? alignSeries(a.parseRawCsv(readCsv(s)), (from - Date.parse(s.start)) / 1000, durS, rateHz) : null;
    const res = a.analyzeSession({ rateHz, leg: series(leg), head: series(head), pelvis: series(pelvis) });

    const ids = parts.map((s) => s.id);
    const horse = store.list("horses").find((h) => h.id === leg.horseId);
    const stallId = horse?.stall && horse.stall !== "—" ? horse.stall : null;
    const startIso = new Date(from).toISOString(), endIso = new Date(to).toISOString();
    const trotS = (res.trotSegments || []).reduce((n, g) => n + Math.max(0, g.endS - g.startS), 0);
    const steps = Number.isFinite(res.steps) ? Math.round(res.steps) : null;
    const base = (metric, value, unit, ts, meta) => {
      const r = { horseId: leg.horseId, stallId, metric, value, unit, ts, source: "imu",
        // An unvalidated analysis: never presented with a sensor's full confidence.
        confidence: 0.5,
        // seq keeps these apart from the hub's own live readings at the same instant.
        meta: { deviceId: leg.deviceId, prototype: true, rawSessionIds: ids, seq: `raw-${leg.id}`, ...meta } };
      r.meta.dedupKey = dedupKey(r);
      return r;
    };
    const out = [];
    const minutes = +(durS / 60).toFixed(1);
    out.push(base("exercise_session", minutes, "min", startIso, {
      start: startIso, end: endIso, steps, distanceM: null, trotMin: +(trotS / 60).toFixed(1),
    }));
    // Hoof strikes of the one tagged leg × 4 — an estimate for all four legs.
    if (steps !== null) out.push(base("steps", steps, "count", startIso, {
      sensor: "leg", periodMin: minutes, method: "leg-tag strikes x 4",
    }));
    const l = res.lameness;
    if (l && Number.isFinite(l.valueMm)) {
      const first = (res.trotSegments || [])[0];
      out.push(base("lameness_result", +l.valueMm.toFixed(1), "mm", new Date(from + (first ? first.startS * 1000 : 0)).toISOString(), {
        limb: l.limb ?? null, head: l.head ?? null, pelvis: l.pelvis ?? null,
        strides: l.strides ?? res.strides ?? null, durationS: Math.round(trotS),
      }));
    }
    const stats = {};
    const stored = store.appendReadings(out, stats);
    return {
      durationS: Math.round(durS), steps, strides: res.strides ?? null,
      trotSegments: (res.trotSegments || []).length, trotMin: +(trotS / 60).toFixed(1),
      lameness: l ? { limb: l.limb ?? null, valueMm: l.valueMm } : null,
      sensors: parts.map((s) => s.sensor), readings: stored, duplicates: stats.duplicates || 0,
    };
  }

  /** Drop recordings past the retention, files and index both. */
  function prune() {
    const cutoff = now() - rawDays() * 24 * 3600_000;
    let n = 0;
    for (const s of sessions().filter((x) => Date.parse(x.start) < cutoff)) {
      const file = at(s.path);
      try { rmSync(/*turbopackIgnore: true*/ file, { force: true }); } catch { /* already gone */ }
      store.remove("raw_sessions", s.id);
      for (const d of [dirname(file), dirname(dirname(file))]) {
        try { if (existsSync(/*turbopackIgnore: true*/ d) && !readdirSync(/*turbopackIgnore: true*/ d).length) rmdirSync(/*turbopackIgnore: true*/ d); } catch { /* not empty */ }
      }
      n++;
    }
    return n;
  }

  return { upload, list, processPending, prune };
}
