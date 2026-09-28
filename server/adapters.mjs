// Payload formats a device may send to /ingest/readings, chosen by the
// `X-EquiCare-Format` header. The wearable hardware is not bought yet and its
// vendor's own payload is unknown, so EquiCare defines its own format
// (equicare-wearable/1: the Reading shape of contract.mjs, as a list or
// { readings: [...] }) for a vendor to target — and this is where a decoder
// for theirs goes if they cannot.
//
//   adapt(format, text) -> readings[]      throws AdapterError (-> 400)
//
// An adapter only reshapes. Everything after it — which metrics a device may
// send, whose horse they belong to, de-duplication — is the ingest path's job
// and applies to every format the same way.

export const DEFAULT_FORMAT = "equicare-wearable/1";

export class AdapterError extends Error {
  constructor(message, detail) { super(message); this.detail = detail; }
}

const parseJson = (text) => {
  try { return JSON.parse(text || "{}"); }
  catch (e) { throw new AdapterError("malformed JSON", String(e.message)); }
};

/** Our own format: already readings. The edge agent sends this too. */
function passthrough(text) {
  const body = parseJson(text);
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") return Array.isArray(body.readings) ? body.readings : [];
  throw new AdapterError("expected a list of readings or { readings: [...] }");
}

// Where the vendor's decoder goes, once their format is known: a function
// from the request body (text) to Readings, e.g.
//
//   function decodeVendorX(text) {
//     const p = parseJson(text);                 // or a binary/hex frame
//     return p.samples.map((s) => ({
//       metric: "steps", value: s.stepCount, ts: new Date(s.epoch * 1000).toISOString(),
//       meta: { sensor: s.pos === 1 ? "leg" : "head", periodMin: s.windowS / 60, seq: s.n },
//     }));
//   }
//
// and an entry below. Give every reading its sensor position (meta.sensor) and
// a meta.seq where two readings can share a timestamp, so a re-sent batch is
// recognised as one (the ingest path de-duplicates on them).
const ADAPTERS = {
  [DEFAULT_FORMAT]: passthrough,
  // "vendor-x/1": decodeVendorX,                 <- the vendor's decoder goes here
};

export const knownFormats = () => Object.keys(ADAPTERS);
export const isKnownFormat = (f) => Object.prototype.hasOwnProperty.call(ADAPTERS, f);

export function adapt(format, text) {
  const f = format || DEFAULT_FORMAT;
  if (!isKnownFormat(f))
    throw new AdapterError(`unknown payload format "${String(f).slice(0, 60)}"`, `known formats: ${knownFormats().join(", ")}`);
  const out = ADAPTERS[f](text);
  if (!Array.isArray(out)) throw new AdapterError(`the ${f} decoder did not produce a list of readings`);
  return out;
}
