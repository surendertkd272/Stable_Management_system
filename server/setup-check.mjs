// Before a calibration is saved: is the horse really where the boxes are?
// A checklist read off the camera's own temperatures — the idea taken from
// handheld gait apps, which refuse a recording until the eye and withers are
// in view. Required items must pass to save without a warning.
//
//   1. the camera answers temperature reads
//   2. a warm horse is in the thermal view (warm body against the background)
//   3. the eye box reads like an eye (hottest 33–41 °C, and a small hot spot
//      inside the box, not one running off its edge)
//   4. the nostril box is on the head (warmer than the background)
//   5. the nostril box is not the eye box
//   6. nothing sun-hot in view (a sunlit wall or roof over 45 °C pulls the
//      readings — what the second RVC session showed)
// plus the optional colour boxes (flank, hay, floor) — noted, not required.
import { gridPoints } from "./mtrpc.mjs";

const PRESENT_CONTRAST_C = 2.5, PRESENT_EYE_C = 32.0;      // as edge/video_analytics.horse_present
const EYE_MIN_C = 33.0, EYE_MAX_C = 41.0;                   // as edge/behaviour.py
const SUN_HOT_C = 45.0;                                     // no part of a horse is this hot: sun or a lamp
const pct = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
const overlap = (a, b) => a && b && Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)) > 0;

/** The judgement, from temperatures already read (testable without a camera).
 *  grid: 8×8 over the whole view; eyeGrid: n×n over the eye box (row by row);
 *  nostril: { avgC } over the nostril box. */
export function judge({ grid = [], eyeGrid = null, eyeCols = 0, nostril = null, eye = null, nostrilBox = null, extras = {} }) {
  const items = [];
  const add = (key, label, ok, required, detail) => items.push({ key, label, ok, required, detail });
  const g = grid.filter((v) => v !== null && Number.isFinite(v));
  add("camera", "The camera answers temperature reads", g.length >= 32, true,
    g.length >= 32 ? `${g.length} of ${grid.length} points read` : "too few temperature reads — check the camera's connection");
  const hi = g.length ? pct(g, 0.95) : null, lo = g.length ? pct(g, 0.1) : null;
  if (g.length) {
    const max = Math.max(...g);
    add("sun", "Nothing sun-hot in view", max < SUN_HOT_C, false,
      max < SUN_HOT_C ? `hottest point ${max.toFixed(1)} °C` : `a ${max.toFixed(1)} °C surface — direct sun or a lamp in view; move or shade the camera so the sun does not fall in the picture`);
  }
  const ev = eyeGrid ? eyeGrid.filter((v) => v !== null) : [];
  const peak = ev.length ? Math.max(...ev) : null;
  const present = g.length >= 8 && (hi - lo >= PRESENT_CONTRAST_C || (peak !== null && peak >= PRESENT_EYE_C));
  add("horse", "A horse in the thermal view", present, true,
    g.length ? `warmest ${hi.toFixed(1)} °C against ${lo.toFixed(1)} °C${present ? "" : " — no warm body; is the horse in front of the camera?"}` : "no reads");
  if (eyeGrid && eye) {
    const warm = peak !== null && peak >= EYE_MIN_C && peak <= EYE_MAX_C;
    add("eye_warm", "The eye box holds something eye-warm (33–41 °C)", warm, true,
      peak === null ? "no reads in the eye box" : `hottest ${peak.toFixed(1)} °C${peak > EYE_MAX_C ? " — too hot for an eye (a lamp, the sun?)" : peak < EYE_MIN_C ? " — too cool; the eye is not in the box" : ""}`);
    if (warm && eyeCols > 2) {
      const rows = Math.round(eyeGrid.length / eyeCols);
      const k = eyeGrid.indexOf(peak);
      const c = k % eyeCols, r = Math.floor(k / eyeCols);
      const onEdge = c === 0 || r === 0 || c === eyeCols - 1 || r === rows - 1;
      const hot = ev.filter((v) => v >= peak - 0.6).length / ev.length;
      add("eye_shape", "The hot spot sits inside the eye box, small like an eye", !onEdge && hot <= 0.25, false,
        onEdge ? "the hottest point is on the box's edge — move the box so the eye is in its middle"
          : hot > 0.25 ? "much of the box is as hot as the peak — the box may be on warm skin or a coat, not the eye" : "looks like an eye");
    }
  } else add("eye_warm", "Eye box drawn", false, true, "draw the eye box");
  if (nostril && nostrilBox) {
    const onHead = lo !== null && nostril.avgC - lo >= 2.0;
    add("nostril", "The nostril box is on the head", onHead, true,
      `average ${nostril.avgC.toFixed(1)} °C${lo !== null ? ` vs background ${lo.toFixed(1)} °C` : ""}${onHead ? "" : " — not warmer than the background: the box is off the head"}`);
    add("apart", "The nostril and eye boxes do not overlap", !overlap(eye, nostrilBox), true,
      overlap(eye, nostrilBox) ? "move the nostril box down to the nostril" : "separate");
  } else add("nostril", "Nostril box drawn", false, true, "draw the nostril box");
  for (const [k, label] of [["flank", "Flank box (breathing from the colour picture)"], ["hay", "Hay box (eating time)"], ["colourFloor", "Floor box (droppings and urine)"]])
    add(k, label, Boolean(extras[k]), false, extras[k] ? "drawn" : "optional — not drawn");
  return { items, ready: items.filter((i) => i.required).every((i) => i.ok) };
}

/** Reads the camera (a JSON-RPC MtrpcCamera) and judges. */
export async function setupChecklist(c, { eye, nostril, extras = {} }) {
  const grid = await c.readPixels(gridPoints({ x0: 0, y0: 0, x1: 10000, y1: 10000 }, 8));
  let eyeGrid = null, eyeCols = 0;
  if (eye) {
    const pts = gridPoints(eye, 12);
    eyeGrid = await c.readPixels(pts);
    eyeCols = new Set(pts.map((p) => p.x)).size;
  }
  const nst = nostril ? await c.boxStats(nostril) : null;
  return { at: new Date().toISOString(), ...judge({ grid, eyeGrid, eyeCols, nostril: nst, eye, nostrilBox: nostril, extras }) };
}
