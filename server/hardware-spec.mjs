// Sparsh SC-IT6420-HB V2 — the datasheet (Rev 1.3) as data.
//
// One source for both the server (validating a camera's configuration) and the
// browser (the optics planner), so the two can never disagree about what lenses
// a variant takes or how wide its field of view is. Every number below is from
// the datasheet unless it says "rule of thumb".

export const SC_IT6420_HB_V2 = {
  model: "SC-IT6420-HB V2",
  vendor: "Sparsh CCTV",
  datasheetRev: "1.3",
  thermal: {
    // resolution [w, h], NETD in mK, lens focal length (mm) -> FOV [h°, v°]
    256: { resolution: [256, 192], netdMk: 50, lenses: { "3.2": [50, 38], "6": [29.8, 22.3] }, defaultLens: "3.2" },
    384: { resolution: [384, 288], netdMk: 40, lenses: { "7.5": [49.8, 37.4], "13": [28.8, 21.6] }, defaultLens: "7.5" },
    640: { resolution: [640, 512], netdMk: 40, lenses: { "13": [48, 36], "25": [25, 19] }, defaultLens: "13" },
  },
  sensor: "Vanadium oxide uncooled focal plane (microbolometer)",
  spectralUm: [8, 14],
  focus: "Fixed, athermalized",
  visible: { sensor: '1/2.8" CMOS', resolution: [1920, 1080], lenses: ["4", "6"], irRangeM: 30 },
  measurement: {
    rangesC: [[-20, 180], [0, 650]],        // first gear, second gear
    accuracy: "±2 °C or ±2%, whichever is greater",
    accuracyC: 2,
    maxPoints: 10, maxAreas: 10, maxLines: 3,
    emissivity: [0.01, 1.0],
    corrections: ["distance", "linear"],
    alarms: ["high temperature", "low temperature"],
  },
  environment: { workingC: [-20, 50], humidity: "0–95% RH", protection: "IP66" },
  power: { supply: "DC 12 V / PoE", maxW: 5 },
  network: {
    protocols: ["TCP/IP", "RTSP", "NTP", "HTTP", "HTTPS", "DHCP", "FTP"],
    compatibility: ["ONVIF", "RTSP"],
    temperatureOutput: ["SDK", "TCP protocol (Modbus/TCP)"],
    ethernet: "1 × RJ45 10/100",
    serial: "RS485",
    alarmIO: "1 in / 1 out",
    security: ["HTTPS login", "categorized login", "IP address filtering", "access logs", "802.1X"],
  },
  video: "H.264",
  physical: { material: "Aluminium", dimensionsMm: [278, 100, 83], maxKg: 1 },
};

// Target sizes on the horse, in cm. Not from the datasheet — anatomy.
export const TARGETS = {
  nostril: { cm: 5, label: "nostril (respiration)" },
  eye: { cm: 3, label: "eye region (temperature)" },
};

// Rule of thumb, not datasheet: an average needs a few pixels to average over,
// and a point needs margin so it doesn't straddle the target's edge.
export const MIN_PX = { nostril: 5, eye: 3 };

const rad = (deg) => (deg * Math.PI) / 180;

export const variants = () => Object.keys(SC_IT6420_HB_V2.thermal);
export const lensesFor = (variant) => Object.keys(SC_IT6420_HB_V2.thermal[variant]?.lenses ?? {});

/** Scene covered by the thermal sensor at a distance, and its sampling density. */
export function thermalFootprint(variant, lens, distanceM) {
  const v = SC_IT6420_HB_V2.thermal[variant];
  const fov = v?.lenses[lens];
  if (!v || !fov || !(distanceM > 0)) return null;
  const widthM = 2 * distanceM * Math.tan(rad(fov[0] / 2));
  const heightM = 2 * distanceM * Math.tan(rad(fov[1] / 2));
  return {
    fovH: fov[0], fovV: fov[1],
    widthM, heightM,
    pxPerCm: v.resolution[0] / (widthM * 100),
  };
}

/** Thermal pixels across a target of `targetCm` at `distanceM`. */
export function pixelsOnTarget(variant, lens, distanceM, targetCm) {
  const f = thermalFootprint(variant, lens, distanceM);
  return f ? f.pxPerCm * targetCm : 0;
}

/** Furthest mounting distance at which a target still gets `minPx` pixels. */
export function maxDistanceFor(variant, lens, targetCm, minPx) {
  const v = SC_IT6420_HB_V2.thermal[variant];
  const fov = v?.lenses[lens];
  if (!fov) return 0;
  // px = res * cm / (200 * d * tan(h/2))  =>  d = res * cm / (200 * px * tan(h/2))
  return (v.resolution[0] * targetCm) / (200 * minPx * Math.tan(rad(fov[0] / 2)));
}

/** Can this variant + lens + distance actually read the horse's vitals? */
export function assessOptics(variant, lens, distanceM) {
  const footprint = thermalFootprint(variant, lens, distanceM);
  if (!footprint) return null;
  const targets = {};
  for (const [key, t] of Object.entries(TARGETS)) {
    const px = footprint.pxPerCm * t.cm;
    const need = MIN_PX[key];
    targets[key] = {
      label: t.label, cm: t.cm, px, need,
      verdict: px >= need * 1.5 ? "good" : px >= need ? "marginal" : "insufficient",
      maxDistanceM: maxDistanceFor(variant, lens, t.cm, need),
    };
  }
  return { footprint, targets };
}

/** Validate a camera's model fields against the datasheet. Returns error strings. */
export function validateCameraModel({ variant, thermalLens, visibleLens, emissivity, distanceM }) {
  const errs = [];
  if (!SC_IT6420_HB_V2.thermal[variant]) errs.push(`unknown thermal variant "${variant}" (datasheet: ${variants().join(", ")})`);
  else if (!lensesFor(variant).includes(String(thermalLens)))
    errs.push(`the ${variant} variant takes a ${lensesFor(variant).join(" or ")} mm thermal lens, not ${thermalLens} mm`);
  if (!SC_IT6420_HB_V2.visible.lenses.includes(String(visibleLens)))
    errs.push(`visible lens must be ${SC_IT6420_HB_V2.visible.lenses.join(" or ")} mm`);
  const [eLo, eHi] = SC_IT6420_HB_V2.measurement.emissivity;
  if (!(emissivity >= eLo && emissivity <= eHi)) errs.push(`emissivity must be between ${eLo} and ${eHi}`);
  if (!(distanceM > 0 && distanceM <= 30)) errs.push("mounting distance must be between 0 and 30 m");
  return errs;
}
