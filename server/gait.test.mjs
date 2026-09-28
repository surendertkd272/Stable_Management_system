// Gait analysis on SYNTHETIC wearable signals — no sensor has been bought yet,
// so these pin the method, not its accuracy on horses. The generator builds a
// session from bouts (stand / walk / trot / lie): the left-front cannon swings
// once per stride and lands with an impact spike; the head and pelvis rise and
// fall twice per stride, with a chosen asymmetry mixed in; everything is then
// seen through each device's own tilt, with noise and a little gyro bias.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRawCsv, analyzeSession } from "./gait.mjs";

const G = 9.80665;
const DEG = Math.PI / 180;
const FS = 200;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) {
  let u = 0;
  while (!u) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
const series = (n, mag) => Object.fromEntries(["t", "ax", "ay", "az", "gx", "gy", "gz", ...(mag ? ["mx", "my", "mz"] : [])].map((k) => [k, new Float64Array(n)]));
/** Raised-cosine ramp over the first and last second of a bout (no steps in height). */
const envelope = (tau, len) => (tau < 1 ? (1 - Math.cos(Math.PI * tau)) / 2 : tau > len - 1 ? (1 - Math.cos(Math.PI * Math.max(0, len - tau))) / 2 : 1);

/**
 * bouts: [{ kind: "stand"|"walk"|"trot"|"lie", s, hz?, yaw? (°/s, turning) }]
 * headLF / headMaxLF / pelvisLH: injected asymmetry in mm (MinDiff / head
 * MaxDiff / pelvis MinDiff with the module's sign: positive = the left leg).
 * Returns the three series and how many strides the leg really made.
 */
function synth({ bouts, seed = 7, headLF = 0, headMaxLF = 0, pelvisLH = 0 }) {
  const r = rng(seed);
  const total = bouts.reduce((a, b) => a + b.s, 0);
  const n = Math.round(total * FS);
  const legPitch = new Float64Array(n), legGy = new Float64Array(n), legRoll = new Float64Array(n), impact = new Float64Array(n);
  const zHead = new Float64Array(n), zPelvis = new Float64Array(n), surge = new Float64Array(n), sway = new Float64Array(n), yaw = new Float64Array(n);
  let strides = 0, start = 0;
  for (const b of bouts) {
    if (b.kind === "lie") for (let i = Math.round(start * FS); i < Math.round((start + b.s) * FS); i++) legRoll[i] = 85;
    if (b.kind === "walk" || b.kind === "trot") {
      const trot = b.kind === "trot";
      const k = Math.max(1, Math.round(b.s * b.hz));
      let T = Array.from({ length: k }, () => 1 + 0.03 * gauss(r));
      const sum = T.reduce((a, x) => a + x, 0);
      T = T.map((x) => (x * b.s) / sum);
      // Stance for the first `ds` of the stride (slow rotation over the planted
      // hoof), then a swing: a sharp rotation the other way, peak P °/s.
      const ds = trot ? 0.45 : 0.62, P = trot ? 600 : 250, C = (P * (5 / 16) * (1 - ds)) / ds;
      let sk = start;
      for (const Tk of T) {
        let theta = (-C * ds * Tk) / 2;
        for (let i = Math.round(sk * FS); i < Math.round((sk + Tk) * FS) && i < n; i++) {
          const tt = i / FS, p = (tt - sk) / Tk;
          const g = p < ds ? C : -P * Math.sin((Math.PI * (p - ds)) / (1 - ds)) ** 6;
          legGy[i] = g; legPitch[i] = theta; theta += g / FS;
          const env = envelope(tt - start, b.s);
          // Head lows at 0.27 and 0.77 of the stride (it lags the legs a
          // little), pelvis lows at 0.22 and 0.72; highs half-way between.
          const A = trot ? 40 : 12, Ap = trot ? 35 : 10;
          zHead[i] = env * (-A * Math.cos(4 * Math.PI * (p - 0.27))
            + (trot ? (headLF / 2) * Math.cos(2 * Math.PI * (p - 0.27)) - (headMaxLF / 2) * Math.cos(2 * Math.PI * (p - 0.52)) : 0)) / 1000;
          zPelvis[i] = env * (-Ap * Math.cos(4 * Math.PI * (p - 0.22)) + (trot ? (pelvisLH / 2) * Math.cos(2 * Math.PI * (p - 0.72)) : 0)) / 1000;
          surge[i] = env * (trot ? 1.5 : 0.5) * Math.cos(4 * Math.PI * p);
          sway[i] = env * (trot ? 0.8 : 0.4) * Math.cos(2 * Math.PI * p) + (b.yaw ? 3.5 * b.yaw * DEG : 0);
          yaw[i] = b.yaw ?? 0;
        }
        // The hoof lands as the swing ends.
        const ih = Math.round((sk + Tk) * FS);
        for (let q = ih - 8; q <= ih + 8; q++) if (q >= 0 && q < n) impact[q] += (trot ? 30 : 15) * Math.exp(-(((q - ih) / FS) ** 2) / (2 * 0.008 ** 2));
        sk += Tk;
        strides++;
      }
    }
    start += b.s;
  }
  const leg = series(n), head = series(n), pelvis = series(n);
  const nz = (s) => s * gauss(r);
  for (let i = 0; i < n; i++) {
    const t = i / FS;
    leg.t[i] = head.t[i] = pelvis.t[i] = t;
    // Leg tag: gravity seen through the cannon's pitch (or roll, when lying).
    const th = legPitch[i] * DEG, ro = legRoll[i] * DEG;
    leg.ax[i] = -Math.sin(th) * G + 0.3 * impact[i] + nz(0.3);
    leg.ay[i] = Math.sin(ro) * G + nz(0.3);
    leg.az[i] = Math.cos(th) * Math.cos(ro) * G + impact[i] + nz(0.3);
    leg.gx[i] = -Math.sin(th) * yaw[i] + nz(1);
    leg.gy[i] = legGy[i] + nz(1);
    leg.gz[i] = Math.cos(th) * yaw[i] + nz(1);
    // Head and pelvis: vertical acceleration from the height, plus surge and
    // sway, rotated into a device pitched 15° ± 8° (the head nods slowly) or 5°.
    for (const [dev, z, pitch, rate, bias] of [
      [head, zHead, 15 + 8 * Math.sin(2 * Math.PI * 0.1 * t), 8 * 2 * Math.PI * 0.1 * Math.cos(2 * Math.PI * 0.1 * t), 0.5],
      [pelvis, zPelvis, 5, 0, 0.3],
    ]) {
      const up = i > 0 && i < n - 1 ? (z[i + 1] - 2 * z[i] + z[i - 1]) * FS * FS : 0;
      const p = pitch * DEG, fx = surge[i], fz = up + G;
      dev.ax[i] = Math.cos(p) * fx - Math.sin(p) * fz + nz(0.1);
      dev.ay[i] = sway[i] + nz(0.1);
      dev.az[i] = Math.sin(p) * fx + Math.cos(p) * fz + nz(0.1);
      dev.gx[i] = -Math.sin(p) * yaw[i] + nz(1);
      dev.gy[i] = rate + bias + nz(1);
      dev.gz[i] = Math.cos(p) * yaw[i] + bias + nz(1);
    }
  }
  return { leg, head, pelvis, strides };
}

const TROT_UP = [
  { kind: "stand", s: 10 }, { kind: "walk", s: 20, hz: 0.9 },
  { kind: "trot", s: 40, hz: 1.45 },
  { kind: "walk", s: 20, hz: 0.9 }, { kind: "stand", s: 10 },
];
const run = (opts, only = {}) => {
  const s = synth(opts);
  return { s, r: analyzeSession({ rateHz: FS, leg: s.leg, head: s.head, pelvis: s.pelvis, ...only }) };
};
const log = (name, l) => console.log(`  ${name}: ${JSON.stringify(l)}`);

test("a sound straight trot: one trot stretch, small asymmetry, no limb", () => {
  const { r } = run({ bouts: TROT_UP });
  log("sound", r.lameness);
  assert.equal(r.trotSegments.length, 1);
  assert.ok(Math.abs(r.trotSegments[0].startS - 30) < 1.5 && Math.abs(r.trotSegments[0].endS - 70) < 1.5, JSON.stringify(r.trotSegments));
  assert.ok(r.lameness, "a trot with head and pelvis gives a result");
  assert.equal(r.lameness.limb, null);
  assert.ok(r.lameness.valueMm < 2.5, `sound trot measured ${r.lameness.valueMm} mm`);
  assert.ok(r.lameness.strides >= 50);
  assert.equal(r.durationS, 100);
});

test("head drops less on the left front (+12 mm) -> LF", () => {
  const { r } = run({ bouts: TROT_UP, headLF: 12, headMaxLF: 6 });
  log("LF", r.lameness);
  assert.equal(r.lameness.limb, "LF");
  assert.ok(Math.abs(r.lameness.head.minDiffMm - 12) < 2, JSON.stringify(r.lameness.head));
  assert.ok(Math.abs(r.lameness.head.maxDiffMm - 6) < 2, JSON.stringify(r.lameness.head));
  assert.ok(Math.abs(r.lameness.pelvis.minDiffMm) < 1.5);
  assert.equal(r.lameness.valueMm, Math.abs(r.lameness.head.minDiffMm));
});

test("head drops less on the right front (−12 mm) -> RF", () => {
  const { r } = run({ bouts: TROT_UP, headLF: -12 });
  log("RF", r.lameness);
  assert.equal(r.lameness.limb, "RF");
  assert.ok(Math.abs(r.lameness.head.minDiffMm + 12) < 2, JSON.stringify(r.lameness.head));
});

test("pelvis drops less on the left hind (+8 mm, with a small head nod) -> a hind limb, LH", () => {
  // A hind lameness also makes the head nod a little (4 mm, under the head's
  // floor); relative to their floors the pelvis is the larger and decides.
  const { r } = run({ bouts: TROT_UP, pelvisLH: 8, headLF: 4 });
  log("LH", r.lameness);
  assert.ok(["LH", "RH"].includes(r.lameness.limb));
  assert.equal(r.lameness.limb, "LH");
  assert.ok(Math.abs(r.lameness.pelvis.minDiffMm - 8) < 1.5, JSON.stringify(r.lameness.pelvis));
});

test("a right-hind pelvic asymmetry reads RH; the pelvis alone is enough", () => {
  const { r } = run({ bouts: TROT_UP, pelvisLH: -8 }, { head: null });
  log("RH (no head)", r.lameness);
  assert.equal(r.lameness.limb, "RH");
  assert.equal(r.lameness.head, null);
});

test("walking about the stall: no trot stretch and no lameness result", () => {
  const bouts = [];
  for (let k = 0; k < 8; k++) bouts.push({ kind: "walk", s: 6 + (k % 3) * 5, hz: 0.8 + (k % 4) * 0.05 }, { kind: "stand", s: 4 + (k % 2) * 6 });
  const { r, s } = run({ bouts, seed: 3 });
  assert.deepEqual(r.trotSegments, []);
  assert.equal(r.lameness, null);
  assert.ok(Math.abs(r.strides - s.strides) <= 0.1 * s.strides, `${r.strides} vs ${s.strides}`);
  assert.ok(r.posture.every((p) => p.state === "standing"));
});

test("a trot on a circle (lungeing) is not a straight trot", () => {
  const { r } = run({ bouts: [{ kind: "stand", s: 5 }, { kind: "trot", s: 40, hz: 1.45, yaw: 25 }, { kind: "stand", s: 5 }] });
  assert.deepEqual(r.trotSegments, []);
  assert.equal(r.lameness, null);
});

test("trot shorter than 10 s is not analysed", () => {
  const { r } = run({ bouts: [{ kind: "stand", s: 5 }, { kind: "trot", s: 8, hz: 1.45 }, { kind: "stand", s: 5 }] });
  assert.deepEqual(r.trotSegments, []);
  assert.equal(r.lameness, null);
});

test("lying: a 5-minute stretch is found; a 20 s leg lift is not lying", () => {
  const { r } = run({
    bouts: [
      { kind: "stand", s: 30 }, { kind: "lie", s: 20 }, { kind: "stand", s: 30 },
      { kind: "lie", s: 300 }, { kind: "stand", s: 60 }, { kind: "walk", s: 30, hz: 0.9 },
    ],
  });
  const lying = r.posture.filter((p) => p.state === "lying");
  assert.equal(lying.length, 1, JSON.stringify(r.posture));
  assert.ok(Math.abs(lying[0].startS - 80) <= 2 && Math.abs(lying[0].endS - 380) <= 2, JSON.stringify(lying));
  assert.equal(r.posture[0].state, "standing");
  assert.equal(r.posture[r.posture.length - 1].state, "standing");
  assert.equal(r.posture[0].startS, 0);
  assert.equal(r.posture[r.posture.length - 1].endS, 470);
});

test("steps: hoof strikes of the tagged leg × 4, within 10 % of the true count", () => {
  const { r, s } = run({
    bouts: [
      { kind: "stand", s: 20 }, { kind: "walk", s: 60, hz: 0.9 }, { kind: "trot", s: 30, hz: 1.5 },
      { kind: "walk", s: 60, hz: 0.85 }, { kind: "stand", s: 20 }, { kind: "walk", s: 30, hz: 0.95 },
    ],
    seed: 11,
  });
  const truth = s.strides * 4;
  console.log(`  steps: ${r.steps} counted vs ${truth} synthetic`);
  assert.ok(Math.abs(r.steps - truth) <= 0.1 * truth, `${r.steps} vs ${truth}`);
  assert.equal(r.steps, r.strides * 4);
});

test("without the leg tag nothing is claimed: steps, strides and lameness are null", () => {
  const s = synth({ bouts: TROT_UP });
  const r = analyzeSession({ rateHz: FS, leg: null, head: s.head, pelvis: s.pelvis });
  assert.equal(r.steps, null);
  assert.equal(r.strides, null);
  assert.equal(r.lameness, null);
  assert.deepEqual(r.trotSegments, []);
  assert.equal(r.durationS, 100);
});

test("the leg tag alone finds the trot but gives no lameness result", () => {
  const s = synth({ bouts: TROT_UP });
  const r = analyzeSession({ rateHz: FS, leg: s.leg, head: null, pelvis: null });
  assert.equal(r.trotSegments.length, 1);
  assert.equal(r.lameness, null);
});

// ---- CSV ---------------------------------------------------------------------- //

const FIELDS = ["t", "ax", "ay", "az", "gx", "gy", "gz"];
const MAG = ["mx", "my", "mz"];
function toCsv(s, cols, header = true) {
  const rows = [];
  if (header) rows.push(cols.join(","));
  for (let i = 0; i < s.t.length; i++) rows.push(cols.map((c) => String(s[c][i])).join(","));
  return rows.join("\n") + "\n";
}
function small(mag) {
  const r = rng(5), n = 50, s = series(n, mag);
  for (let i = 0; i < n; i++) for (const k of Object.keys(s)) s[k][i] = k === "t" ? i / 100 : Math.round(gauss(r) * 1e6) / 1e3;
  return s;
}

test("parseRawCsv round-trips a CSV without a magnetometer", () => {
  const s = small(false);
  const p = parseRawCsv(toCsv(s, FIELDS));
  assert.deepEqual(Object.keys(p).sort(), [...FIELDS].sort());
  for (const k of FIELDS) assert.deepEqual(Array.from(p[k]), Array.from(s[k]), k);
  assert.ok(p.t instanceof Float64Array);
  assert.equal(p.mx, undefined);
});

test("parseRawCsv round-trips a CSV with magnetometer columns (and CRLF, comments, blank lines)", () => {
  const s = small(true);
  const csv = "# leg tag 00:11:22\r\n" + toCsv(s, [...FIELDS, ...MAG]).replace(/\n/g, "\r\n") + "\r\n";
  const p = parseRawCsv(csv);
  for (const k of [...FIELDS, ...MAG]) assert.deepEqual(Array.from(p[k]), Array.from(s[k]), k);
});

test("parseRawCsv: columns by header name in any order, or by position with no header", () => {
  const s = small(false);
  const shuffled = ["gz", "t", "ax", "status", "ay", "az", "gx", "gy"];
  const withStatus = { ...s, status: new Float64Array(s.t.length).fill(1) };
  const p = parseRawCsv(toCsv(withStatus, shuffled));
  for (const k of FIELDS) assert.deepEqual(Array.from(p[k]), Array.from(s[k]), k);
  const q = parseRawCsv(toCsv(small(true), [...FIELDS, ...MAG], false));
  assert.equal(q.mx.length, 50);
});

test("parseRawCsv rejects malformed input, naming the line", () => {
  assert.throws(() => parseRawCsv(""), /no samples/);
  assert.throws(() => parseRawCsv("t,ax,ay,az,gx,gy\n0,1,2,3,4,5\n"), /header lacks gz/);
  assert.throws(() => parseRawCsv("t,ax,ay,az,gx,gy,gz,mx\n"), /mx, my, mz/);
  assert.throws(() => parseRawCsv("t,ax,ay,az,gx,gy,gz\n0,1,2,3,4,5,6\n0.01,1,2,x,4,5,6\n"), /line 3: az is not a number/);
  assert.throws(() => parseRawCsv("t,ax,ay,az,gx,gy,gz\n0,1,2,3,4,5,6\n0.01,1,2,3\n"), /line 3: 4 values, expected 7/);
  assert.throws(() => parseRawCsv("0.5,1,2,3,4,5,6\n0.4,1,2,3,4,5,6\n"), /line 2: t goes backwards/);
  assert.throws(() => parseRawCsv("0,1,2,3,4\n"), /5 values/);
});
