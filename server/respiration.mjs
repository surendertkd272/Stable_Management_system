// Respiratory rate from a nostril-ROI temperature series — a line-for-line
// port of compute_resp_rate() in edge/edge_agent.py, so the calibration check
// in the browser judges a camera's aim with exactly the algorithm that will
// produce its readings. edge/resp_parity_test.py holds the two to agreement.
// No imports: this runs in the browser as well as in Node.
//
// See the Python for the reasoning behind each step (detrending, the
// periodicity gate, true local maxima only, subharmonic rejection). The short
// version: it returns null rather than a normal-looking number when there is no
// real rhythm, because an invented vital sign reads as a healthy horse.

export const RESP_MIN_PERIODICITY = 0.40;
export const RESP_SUBHARMONIC_RATIO = 0.80;

/** Remove the least-squares linear trend, not just the mean. */
export function detrend(samples) {
  const n = samples.length;
  const mx = (n - 1) / 2;
  let my = 0;
  for (const v of samples) my += v;
  my /= n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (i - mx) ** 2;
    sxy += (i - mx) * (samples[i] - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return samples.map((v, i) => v - (my + slope * (i - mx)));
}

/**
 * Breaths per minute from `samples` taken at `fs` Hz.
 * @returns {{ bpm: number | null, periodicity: number }}
 */
export function computeRespRate(samples, fs) {
  const n = samples.length;
  const none = (p = 0) => ({ bpm: null, periodicity: p });
  if (n < fs * 15) return none();                       // too short to trust

  const x = detrend(samples);
  let energy = 0;
  for (const v of x) energy += v * v;
  if (energy <= 1e-9) return none();                     // flatline
  const unit = energy / n;

  // Python's int() truncates toward zero; fs and the bounds are positive.
  const lo = Math.trunc(fs / 0.6);
  let hi = Math.trunc(fs / 0.1);                         // 0.1–0.6 Hz => 6–36 bpm
  hi = Math.min(hi, n - 1);
  if (hi <= lo) return none();

  const acf = new Map();
  for (let lag = Math.max(1, lo - 1); lag < Math.min(hi + 1, n - 1); lag++) {
    const overlap = n - lag;
    let s = 0;
    for (let i = 0; i < overlap; i++) s += x[i] * x[i + lag];
    acf.set(lag, s / overlap / unit);
  }

  // Only a true local maximum counts — a step change has none.
  const peaks = [];
  for (let lag = lo; lag < hi; lag++) {
    if (acf.has(lag - 1) && acf.has(lag + 1) && acf.get(lag) > acf.get(lag - 1) && acf.get(lag) >= acf.get(lag + 1))
      peaks.push(lag);
  }
  if (!peaks.length) return none();
  // max() in Python keeps the first of equal values; so does this.
  let bestLag = peaks[0];
  for (const lag of peaks) if (acf.get(lag) > acf.get(bestLag)) bestLag = lag;
  const peak = acf.get(bestLag);
  if (peak < RESP_MIN_PERIODICITY) return none(Math.max(0, peak));

  // Reject period doubling: the earliest near-as-strong local maximum is the
  // fundamental.
  for (let lag = lo + 1; lag < bestLag; lag++) {
    if (acf.get(lag) >= RESP_SUBHARMONIC_RATIO * peak && acf.get(lag) >= acf.get(lag - 1) && acf.get(lag) >= acf.get(lag + 1)) {
      bestLag = lag;
      break;
    }
  }
  return { bpm: (60 * fs) / bestLag, periodicity: acf.get(bestLag) };
}
