// Gait analysis for the wearable set: hoof strikes, strides, straight-trot
// detection, head and pelvis movement asymmetry, posture and a step estimate,
// all from raw motion uploaded to POST /ingest/raw (WEARABLE_PAYLOAD.md).
// No imports: pure functions over typed arrays, so the whole method can be
// exercised on synthetic signals (gait.test.mjs) before any sensor is bought.
//
// The lameness method is the published approach of inertial-sensor lameness
// systems (the work of Keegan, Pfau, Rhodin and colleagues): during a straight
// trot, take the vertical movement of the head and of the pelvis stride by
// stride and compare its two halves. A horse lame on a front leg drops its head
// less while the sore leg bears weight ("down on sound"), and rises less after
// it; lame on a hind leg, its pelvis does the same on the sore side. The leg
// tag's hoof strikes tell the two halves of each stride apart.
//
// What is OURS and not validated on horses: every threshold below (swing size,
// trot band, steadiness, turning limit, tilt angles, noise floors, stride
// counts), the stride-window rules and the step estimate. Every result is a
// prototype (the readings built from it carry meta.prototype = true).
//
// Frame: each device as mounted on a standing horse — x forward, y to the
// horse's left, z up. Accelerometer in m/s² including gravity (a device at rest
// reads about +9.81 on its upward axis), gyroscope in °/s. The leg tag is on
// the LEFT front cannon.

const G = 9.80665;
const DEG = Math.PI / 180;

// ---- thresholds: ours, unvalidated ---------------------------------------- //
const SWING_MIN_DPS = 60;             // a swing of the cannon peaks above this
const REFRACTORY_S = 0.35;            // two swings of one leg are at least this far apart
const IMPACT_MIN = 0.5 * G;           // an acceleration spike this far above 1 g marks the hoof landing
const STRIDE_MIN_S = 0.35, STRIDE_MAX_S = 2.5;   // a longer gap: the leg stopped
const TROT_MIN_HZ = 1.2, TROT_MAX_HZ = 1.8;      // stride frequency of a working trot
const TROT_MIN_S = 10;                // shorter stretches are not analysed
const STEADY_STEP = 0.15;             // stride-to-stride change allowed within a trot
const STEADY_CV = 0.10;               // stride-time variation allowed over a whole stretch
const YAW_MAX_DPS = 10;               // mean turning rate over a stride: tighter than a ~20 m radius at trot is a turn
const STAND_MAX_DEG = 30;             // cannon within this of vertical: standing
const LIE_MIN_DEG = 60;               // cannon within 30° of horizontal ...
const LIE_MIN_S = 60;                 // ... for this long: lying
const HEAD_FLOOR_MM = 5;              // asymmetry below these is taken as noise
const PELVIS_FLOOR_MM = 3;
const MIN_STRIDES = 10;               // strides needed for a lameness result
const TAU_S = 2;                      // time constant of the tilt (gravity) estimate
const N_PHASE = 128;                  // points per stride after resampling

const BASE_COLS = ["t", "ax", "ay", "az", "gx", "gy", "gz"];
const MAG_COLS = ["mx", "my", "mz"];

/**
 * Parse a raw motion upload: CSV `t,ax,ay,az,gx,gy,gz[,mx,my,mz]`, t in seconds
 * from X-Start. A header line names the columns (any order; extra columns are
 * ignored); without one the columns are taken by position (7 or 10). Blank
 * lines and `#` comments are skipped. Throws on anything malformed, naming the
 * line, rather than guessing at a sample.
 * @returns {{ t: Float64Array, ax: Float64Array, ay: Float64Array, az: Float64Array,
 *   gx: Float64Array, gy: Float64Array, gz: Float64Array, mx?: Float64Array, my?: Float64Array, mz?: Float64Array }}
 */
export function parseRawCsv(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  let idx = null, width = 0, fields = BASE_COLS;
  const cols = {};
  let lastT = -Infinity;
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln].trim();
    if (!line || line[0] === "#") continue;
    const cells = line.split(",").map((c) => c.trim());
    if (!idx) {
      if (cells.some((c) => /^[a-z_]/i.test(c))) {
        const names = cells.map((c) => c.toLowerCase());
        const missing = BASE_COLS.filter((f) => !names.includes(f));
        if (missing.length) throw new Error(`line ${ln + 1}: header lacks ${missing.join(", ")}`);
        const mags = MAG_COLS.filter((f) => names.includes(f));
        if (mags.length && mags.length < 3) throw new Error(`line ${ln + 1}: the magnetometer needs all of mx, my, mz`);
        fields = mags.length ? [...BASE_COLS, ...MAG_COLS] : BASE_COLS;
        idx = fields.map((f) => names.indexOf(f));
        width = names.length;
        for (const f of fields) cols[f] = [];
        continue;
      }
      if (cells.length !== 7 && cells.length !== 10)
        throw new Error(`line ${ln + 1}: ${cells.length} values — expected t,ax,ay,az,gx,gy,gz[,mx,my,mz]`);
      fields = cells.length === 10 ? [...BASE_COLS, ...MAG_COLS] : BASE_COLS;
      idx = fields.map((_, i) => i);
      width = cells.length;
      for (const f of fields) cols[f] = [];
    }
    if (cells.length !== width) throw new Error(`line ${ln + 1}: ${cells.length} values, expected ${width}`);
    for (let k = 0; k < fields.length; k++) {
      const c = cells[idx[k]];
      const v = Number(c);
      if (c === "" || !Number.isFinite(v)) throw new Error(`line ${ln + 1}: ${fields[k]} is not a number`);
      cols[fields[k]].push(v);
    }
    const t = cols.t[cols.t.length - 1];
    if (t < lastT) throw new Error(`line ${ln + 1}: t goes backwards (${t} after ${lastT})`);
    lastT = t;
  }
  if (!idx || !cols.t.length) throw new Error("no samples");
  const out = {};
  for (const f of fields) out[f] = Float64Array.from(cols[f]);
  return out;
}

/**
 * Analyse one recording. Each series is a parsed CSV (parseRawCsv) whose t is
 * already measured from a common start, or null. The leg tag gives strides,
 * trot detection, posture and steps; head and/or pelvis add the lameness
 * measures. Without the leg nothing can be told left from right, so steps,
 * strides and lameness are null ("not measured"), never zero.
 */
export function analyzeSession({ rateHz, leg, head, pelvis }) {
  const has = (s) => s && s.t && s.t.length > 1;
  leg = has(leg) ? leg : null;
  head = has(head) ? head : null;
  pelvis = has(pelvis) ? pelvis : null;
  const present = [leg, head, pelvis].filter(Boolean);
  const durationS = present.length
    ? Math.max(...present.map((s) => s.t[s.t.length - 1] + 1 / rateOf(s, rateHz))) - Math.min(...present.map((s) => s.t[0]))
    : 0;
  const result = { durationS: round(durationS, 1), steps: null, trotSegments: [], strides: null, posture: [], lameness: null };
  if (!leg) return result;

  const legFs = rateOf(leg, rateHz);
  const { segments: posture, blocks } = postureOf(leg);
  const lyingAt = (x) => posture.some((p) => p.state === "lying" && x >= p.startS && x < p.endS);
  const strikes = hoofStrikes(leg, legFs).filter((x) => !lyingAt(x));
  result.posture = posture.map((p) => ({ startS: round(p.startS, 1), endS: round(p.endS, 1), state: p.state }));
  result.strides = strikes.length;
  // Steps: the tag sees one leg, so every stride of it is counted as one step
  // of each of the four legs. An ESTIMATE — right for walk and trot, wrong
  // when the horse shifts its hind legs in the stall without moving the front.
  result.steps = strikes.length * 4;

  // Strides of the tagged leg: hoof strike to next hoof strike.
  const strides = [];
  for (let k = 0; k + 1 < strikes.length; k++) {
    const T = strikes[k + 1] - strikes[k];
    if (T >= STRIDE_MIN_S && T <= STRIDE_MAX_S) strides.push({ t0: strikes[k], t1: strikes[k + 1], T, k });
  }

  // Vertical movement and turning rate of the trunk sensors.
  const hm = head ? trunkMotion(head, rateOf(head, rateHz)) : null;
  const pm = pelvis ? trunkMotion(pelvis, rateOf(pelvis, rateHz)) : null;
  const legYaw = legYawRate(leg, blocks);
  for (const s of strides) {
    s.head = hm ? strideProfile(hm, s.t0, s.t1) : null;
    s.pelvis = pm ? strideProfile(pm, s.t0, s.t1) : null;
    // Straightness: the pelvis turns with the body; the head also looks
    // around, and the leg tag only sees turning while its leg is upright.
    s.yaw = meanOver(pm, s.t0, s.t1) ?? meanOver(hm, s.t0, s.t1) ?? meanOver(legYaw, s.t0, s.t1) ?? 0;
  }
  for (let k = 0; k < strides.length; k++) {
    const near = strides.slice(Math.max(0, k - 1), k + 2).map((s) => s.yaw);
    strides[k].yawSmooth = median(near);
  }

  // Straight trot: a run of contiguous strides with a steady 1.2–1.8 Hz rhythm
  // and no turning, lasting ≥ 10 s.
  const trotLike = (s) => 1 / s.T >= TROT_MIN_HZ && 1 / s.T <= TROT_MAX_HZ && Math.abs(s.yawSmooth) <= YAW_MAX_DPS;
  const runs = [];
  let run = [];
  for (const s of strides) {
    const prev = run[run.length - 1];
    const joins = prev && prev.k + 1 === s.k && Math.abs(s.T / prev.T - 1) <= STEADY_STEP;
    if (trotLike(s) && (joins || !prev)) run.push(s);
    else {
      if (run.length) runs.push(run);
      run = trotLike(s) ? [s] : [];
    }
  }
  if (run.length) runs.push(run);
  const segments = runs.filter((r) => {
    if (r[r.length - 1].t1 - r[0].t0 < TROT_MIN_S) return false;
    const Ts = r.map((s) => s.T);
    const m = mean(Ts);
    if (Math.sqrt(mean(Ts.map((x) => (x - m) ** 2))) / m > STEADY_CV) return false;
    // A canter can share the trot's stride rate; at trot the trunk rises and
    // falls twice per stride, at canter once. Checked when a trunk sensor
    // covers the stretch (a leg tag alone cannot tell them apart).
    const pel = r.map((s) => s.pelvis).filter(Boolean), hd = r.map((s) => s.head).filter(Boolean);
    const prof = pel.length >= r.length / 2 ? pel : hd;
    if (prof.length >= r.length / 2) {
      const a1 = median(prof.map((p) => harmonic(p, 1).amp));
      const a2 = median(prof.map((p) => harmonic(p, 2).amp));
      if (a2 < a1) return false;
    }
    return true;
  });
  result.trotSegments = segments.map((r) => ({ startS: round(r[0].t0, 2), endS: round(r[r.length - 1].t1, 2) }));

  // Lameness over every straight-trot stride of the session.
  const trot = segments.flat();
  const h = asymmetry(trot.map((s) => s.head), "head");
  const p = asymmetry(trot.map((s) => s.pelvis), "pelvis");
  if (h || p) {
    const hs = h ? Math.max(Math.abs(h.minDiffMm), Math.abs(h.maxDiffMm)) / HEAD_FLOOR_MM : 0;
    const ps = p ? Math.max(Math.abs(p.minDiffMm), Math.abs(p.maxDiffMm)) / PELVIS_FLOOR_MM : 0;
    const lead = (a) => (Math.abs(a.minDiffMm) >= Math.abs(a.maxDiffMm) ? a.minDiffMm : a.maxDiffMm);
    // Head asymmetry points at a front leg, pelvic at a hind leg; the larger
    // relative to its noise floor decides (a hind lameness also makes the head
    // nod a little, and a front one the pelvis). Positive = the left leg.
    let limb = null;
    if (Math.max(hs, ps) >= 1) limb = hs >= ps ? (lead(h) > 0 ? "LF" : "RF") : (lead(p) > 0 ? "LH" : "RH");
    const all = [h, p].filter(Boolean).flatMap((a) => [Math.abs(a.minDiffMm), Math.abs(a.maxDiffMm)]);
    result.lameness = {
      limb,
      valueMm: round(Math.max(...all), 1),
      head: h ? { minDiffMm: h.minDiffMm, maxDiffMm: h.maxDiffMm } : null,
      pelvis: p ? { minDiffMm: p.minDiffMm, maxDiffMm: p.maxDiffMm } : null,
      strides: trot.filter((s) => s.head || s.pelvis).length,
    };
  }
  return result;
}

// ---- leg tag ---------------------------------------------------------------- //

/**
 * Posture from the cannon's tilt, in 1 s blocks: near vertical = standing;
 * near horizontal for ≥ 60 s = lying (shorter: a leg picked up, pawing). The
 * band between keeps the previous state so one wobble does not flip it.
 */
function postureOf(s) {
  const n = s.t.length, dt = 1 / rateOf(s);
  const blocks = [];
  for (let i = 0; i < n;) {
    const b0 = s.t[i];
    let sx = 0, sy = 0, sz = 0, j = i;
    for (; j < n && s.t[j] < b0 + 1; j++) { sx += s.ax[j]; sy += s.ay[j]; sz += s.az[j]; }
    const m = Math.hypot(sx, sy, sz) || 1;
    blocks.push({ t0: b0, t1: j < n ? s.t[j] : s.t[n - 1] + dt, ux: sx / m, uy: sy / m, uz: sz / m, tilt: Math.atan2(Math.hypot(sx, sy), sz) / DEG });
    i = j;
  }
  let state = blocks[0].tilt >= LIE_MIN_DEG ? "lying" : "standing";
  const raw = blocks.map((b) => {
    if (b.tilt >= LIE_MIN_DEG) state = "lying";
    else if (b.tilt <= STAND_MAX_DEG) state = "standing";
    return { startS: b.t0, endS: b.t1, state };
  });
  const merge = (list) => list.reduce((out, x) => {
    const last = out[out.length - 1];
    if (last && last.state === x.state) last.endS = x.endS;
    else out.push({ ...x });
    return out;
  }, []);
  const segments = merge(merge(raw).map((x) => (x.state === "lying" && x.endS - x.startS < LIE_MIN_S ? { ...x, state: "standing" } : x)));
  return { segments, blocks };
}

/**
 * Hoof strikes of the tagged leg, in seconds. Each swing shows as the largest
 * angular-velocity peak of the stride in the cannon's fore-aft rotation (gy);
 * the hoof lands as that swing ends, usually with an impact spike in the
 * accelerometer, which pins the moment when present.
 */
function hoofStrikes(s, fs) {
  const g = lowpass(s.gy, 10, fs);
  const pos = swingPeaks(g, s.t, 1), neg = swingPeaks(g, s.t, -1);
  // The swing is the larger rotation whichever way the tag is fitted; the
  // other direction holds the slower rotation over the planted hoof.
  const hp = median(pos.map((p) => p.v)) ?? 0, hn = median(neg.map((p) => p.v)) ?? 0;
  if (!pos.length && !neg.length) return [];
  const sign = hp >= hn ? 1 : -1;
  const peaks = sign > 0 ? pos : neg;
  const n = s.t.length;
  const out = [];
  for (const pk of peaks) {
    let j = pk.i;
    while (j < n - 1 && sign * g[j] > 0.2 * pk.v) j++;
    let at = j, best = IMPACT_MIN;
    const hi = lowerBound(s.t, s.t[j] + 0.2);
    for (let q = lowerBound(s.t, s.t[j] - 0.03); q < hi; q++) {
      const m = Math.hypot(s.ax[q], s.ay[q], s.az[q]) - G;
      if (m > best) { best = m; at = q; }
    }
    out.push(s.t[at]);
  }
  return out;
}

function swingPeaks(g, t, sign) {
  const peaks = [];
  let inPk = false, pi = -1, pv = 0, last = -Infinity;
  for (let i = 0; i < g.length; i++) {
    const v = sign * g[i];
    if (!inPk) {
      if (v > SWING_MIN_DPS && t[i] - last >= REFRACTORY_S) { inPk = true; pi = i; pv = v; }
    } else if (v > pv) { pv = v; pi = i; }
    else if (v < Math.max(SWING_MIN_DPS / 2, 0.3 * pv)) { peaks.push({ i: pi, v: pv }); last = t[pi]; inPk = false; }
  }
  return peaks;
}

/** Turning rate seen by the leg tag: its rotation about the 1 s mean "up". */
function legYawRate(s, blocks) {
  const yaw = new Float64Array(s.t.length);
  let b = 0;
  for (let i = 0; i < s.t.length; i++) {
    while (b < blocks.length - 1 && s.t[i] >= blocks[b].t1) b++;
    const u = blocks[b];
    yaw[i] = s.gx[i] * u.ux + s.gy[i] * u.uy + s.gz[i] * u.uz;
  }
  return { t: s.t, v: yaw };
}

// ---- head and pelvis ------------------------------------------------------ //

/**
 * Vertical acceleration and turning rate of a trunk sensor. "Up" is tracked in
 * the sensor's frame by a complementary filter: turned by the gyroscope, pulled
 * slowly (τ = 2 s) towards the accelerometer's direction. This follows head
 * pitching while ignoring the stride-to-stride accelerations.
 */
function trunkMotion(s, fs) {
  const n = s.t.length;
  const av = new Float64Array(n), yaw = new Float64Array(n);
  let ux = 0, uy = 0, uz = 0;
  for (let i = 0; i < n && s.t[i] < s.t[0] + 1; i++) { ux += s.ax[i]; uy += s.ay[i]; uz += s.az[i]; }
  let m = Math.hypot(ux, uy, uz) || 1;
  ux /= m; uy /= m; uz /= m;
  for (let i = 0; i < n; i++) {
    const dt = i ? s.t[i] - s.t[i - 1] : 0;
    const wx = s.gx[i] * DEG, wy = s.gy[i] * DEG, wz = s.gz[i] * DEG;
    // A world-fixed direction seen from a rotating sensor turns the other way.
    let px = ux - (wy * uz - wz * uy) * dt, py = uy - (wz * ux - wx * uz) * dt, pz = uz - (wx * uy - wy * ux) * dt;
    const ax = s.ax[i], ay = s.ay[i], az = s.az[i], am = Math.hypot(ax, ay, az);
    if (am > 0 && dt > 0) {
      const k = Math.min(1, dt / TAU_S);
      px += k * (ax / am - px); py += k * (ay / am - py); pz += k * (az / am - pz);
    }
    m = Math.hypot(px, py, pz) || 1;
    ux = px / m; uy = py / m; uz = pz / m;
    av[i] = ax * ux + ay * uy + az * uz - G;
    yaw[i] = (wx * ux + wy * uy + wz * uz) / DEG;
  }
  return { t: s.t, av, v: yaw, fs };
}

/**
 * Vertical displacement over one stride (mm, resampled to N_PHASE points from
 * this stride's hoof strike to the next), by double integration with the drift
 * removed per stride: at a steady trot the trunk returns to the same height and
 * vertical speed each stride, so the acceleration's mean and then the
 * velocity's mean are removed, and any residual end-to-end offset is taken out
 * linearly. null if the sensor does not cover the whole stride.
 */
function strideProfile(m, t0, t1) {
  const { t, av } = m;
  const i0 = lowerBound(t, t0), i1 = lowerBound(t, t1);
  const tol = 3 / m.fs;
  if (i1 >= t.length || t[i0] - t0 > tol || t[i1] - t1 > tol || i1 - i0 < 16) return null;
  for (let i = i0 + 1; i <= i1; i++) if (t[i] - t[i - 1] > tol) return null;   // a gap in the recording
  const tt = t.subarray(i0, i1 + 1), a = Float64Array.from(av.subarray(i0, i1 + 1));
  const len = a.length;
  const am = trapMean(tt, a);
  for (let j = 0; j < len; j++) a[j] -= am;
  const v = cumTrap(tt, a);
  const vm = trapMean(tt, v);
  for (let j = 0; j < len; j++) v[j] -= vm;
  const p = cumTrap(tt, v);
  const span = tt[len - 1] - tt[0];
  for (let j = 0; j < len; j++) p[j] -= p[len - 1] * (tt[j] - tt[0]) / span;
  const out = new Float64Array(N_PHASE);
  let q = 0, sum = 0;
  for (let j = 0; j < N_PHASE; j++) {
    const tj = t0 + (j / N_PHASE) * (t1 - t0);
    while (q < len - 2 && tt[q + 1] < tj) q++;
    const f = Math.min(1, Math.max(0, (tj - tt[q]) / (tt[q + 1] - tt[q])));
    out[j] = (p[q] + f * (p[q + 1] - p[q])) * 1000;
    sum += out[j];
  }
  for (let j = 0; j < N_PHASE; j++) out[j] -= sum / N_PHASE;
  return out;
}

/**
 * MinDiff / MaxDiff (mm, median over strides) from per-stride profiles.
 * Each stride has two lows (one per diagonal stance) and two highs (each after
 * a stance). The first half of a stride, from the left-front hoof strike, holds
 * the left-front (and right-hind) stance; the second half the right-front (and
 * left-hind). Where exactly the lows fall is found from the mean profile's
 * twice-per-stride component, so a head that lags the legs is still read right.
 * Sign: positive = less downward movement during the LEFT-front stance (head)
 * or LEFT-hind stance (pelvis); for MaxDiff, less upward movement after it.
 */
function asymmetry(profiles, kind) {
  const ok = profiles.filter(Boolean);
  if (ok.length < MIN_STRIDES) return null;
  // Drop strides unlike the rest (a head toss, a stumble).
  const ranges = ok.map((p) => Math.max(...p) - Math.min(...p));
  const mr = median(ranges);
  const good = ok.filter((_, i) => ranges[i] >= 0.4 * mr && ranges[i] <= 2.5 * mr);
  if (good.length < MIN_STRIDES) return null;
  const avg = new Float64Array(N_PHASE);
  for (const p of good) for (let j = 0; j < N_PHASE; j++) avg[j] += p[j] / good.length;
  const phase = harmonic(avg, 2).phase;
  // x ≈ A·cos(4πj/N + φ): the lows sit where 4πj/N + φ = π, twice per stride.
  const low1 = (((Math.PI - phase) / (4 * Math.PI)) % 0.5 + 0.5) % 0.5;
  const jA = Math.round(low1 * N_PHASE), jB = jA + N_PHASE / 2, w = N_PHASE / 4;
  const at = (p, j) => p[((j % N_PHASE) + N_PHASE) % N_PHASE];
  const extreme = (p, from, to, sgn) => {
    let bi = from, bv = sgn * at(p, from);
    for (let j = from + 1; j <= to; j++) if (sgn * at(p, j) > bv) { bv = sgn * at(p, j); bi = j; }
    return { j: bi, v: sgn * bv };
  };
  const mins = [], maxs = [];
  for (const p of good) {
    const lowA = extreme(p, jA - w, jA + w - 1, -1);    // left-front (+ right-hind) stance
    const lowB = extreme(p, jB - w, jB + w - 1, -1);    // right-front (+ left-hind) stance
    const highA = extreme(p, lowA.j, lowB.j, 1).v;       // after the first stance
    const highB = extreme(p, lowB.j, lowA.j + N_PHASE, 1).v;
    if (kind === "head") { mins.push(lowA.v - lowB.v); maxs.push(highB - highA); }
    else { mins.push(lowB.v - lowA.v); maxs.push(highA - highB); }
  }
  return { minDiffMm: round(median(mins), 1), maxDiffMm: round(median(maxs), 1), strides: good.length };
}

// ---- small numeric helpers -------------------------------------------------- //

/** Zero-phase low-pass: a 2nd-order Butterworth run forwards then backwards. */
function lowpass(x, fc, fs) {
  if (!(fs > 0) || fc >= fs / 2.2) return Float64Array.from(x);
  const w = 2 * Math.PI * fc / fs, c = Math.cos(w), al = Math.sin(w) / Math.SQRT2, a0 = 1 + al;
  const k = { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: -2 * c / a0, a2: (1 - al) / a0 };
  return biquad(biquad(x, k, false), k, true);
}

function biquad(x, k, reverse) {
  const n = x.length, y = new Float64Array(n);
  if (!n) return y;
  const first = reverse ? x[n - 1] : x[0];
  let x1 = first, x2 = first, y1 = first, y2 = first;
  for (let j = 0; j < n; j++) {
    const i = reverse ? n - 1 - j : j;
    const v = x[i];
    const out = k.b0 * v + k.b1 * x1 + k.b2 * x2 - k.a1 * y1 - k.a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = out;
    y[i] = out;
  }
  return y;
}

/** Amplitude and phase of the k-th harmonic of one period (x ≈ amp·cos(2πkj/N + phase)). */
function harmonic(x, k) {
  let re = 0, im = 0;
  const N = x.length;
  for (let j = 0; j < N; j++) { const a = 2 * Math.PI * k * j / N; re += x[j] * Math.cos(a); im -= x[j] * Math.sin(a); }
  return { amp: 2 * Math.hypot(re, im) / N, phase: Math.atan2(im, re) };
}

/** Sample rate from the series' own timestamps (median spacing); `fallback` if they cannot say. */
function rateOf(s, fallback) {
  const n = Math.min(s.t.length - 1, 2000);
  const d = [];
  for (let i = 1; i <= n; i++) { const x = s.t[i] - s.t[i - 1]; if (x > 0) d.push(x); }
  const md = median(d);
  return md ? 1 / md : fallback > 0 ? fallback : 100;
}

function meanOver(m, t0, t1) {
  if (!m) return null;
  const i0 = lowerBound(m.t, t0), i1 = lowerBound(m.t, t1);
  if (i1 - i0 < 2 || m.t[i0] - t0 > 0.1 || i1 >= m.t.length) return null;
  let s = 0;
  for (let i = i0; i < i1; i++) s += m.v[i];
  return s / (i1 - i0);
}

function trapMean(t, x) {
  let s = 0;
  for (let i = 1; i < x.length; i++) s += (x[i] + x[i - 1]) / 2 * (t[i] - t[i - 1]);
  return s / (t[t.length - 1] - t[0]);
}

function cumTrap(t, x) {
  const y = new Float64Array(x.length);
  for (let i = 1; i < x.length; i++) y[i] = y[i - 1] + (x[i] + x[i - 1]) / 2 * (t[i] - t[i - 1]);
  return y;
}

function lowerBound(a, x) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }

function round(x, d) { const f = 10 ** d; return Math.round(x * f) / f || 0; }   // never -0
