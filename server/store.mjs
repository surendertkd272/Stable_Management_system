// Storage layer behind a small interface so the JSON-file dev store can be
// swapped for Postgres (India region, DPDP residency) with no caller changes.
//   createStore()  -> picks Postgres when DATABASE_URL is set, else JSON file.
// Both expose the same synchronous read interface (readings are memory-cached);
// writes are durable. rollup.mjs is pure and takes readings as args, so it is
// unaffected by the backend choice.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RETENTION_MS = 21 * 24 * 3600 * 1000; // ~3 weeks (covers 14-day baseline)
const MAX_READINGS = 300_000;

function normalize(r, seq) {
  return {
    id: `r-${Date.now()}-${seq}`,
    horseId: r.horseId ?? null,
    stallId: r.stallId ?? null,
    metric: r.metric,
    value: r.value,
    unit: r.unit ?? null,
    ts: r.ts ?? new Date().toISOString(),
    source: r.source ?? null,
    confidence: typeof r.confidence === "number" ? r.confidence : 1,
    meta: r.meta ?? null,
  };
}
const valid = (r) => r && typeof r.metric === "string" && typeof r.value === "number";

// --------------------------------------------------------------------------- //
// JSON-file store (default; zero dependencies)
// --------------------------------------------------------------------------- //
function makeJsonStore() {
  const DATA_DIR = join(HERE, "data");
  const STATE_FILE = join(DATA_DIR, "state.json");
  let state = { readings: [], acks: {}, seq: 0 };
  let saveTimer = null;

  try {
    state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    state.readings ||= []; state.acks ||= {}; state.seq ||= 0;
  } catch { /* fresh */ }

  const save = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(STATE_FILE, JSON.stringify(state));
    }, 250);
  };
  const prune = () => {
    const cutoff = Date.now() - RETENTION_MS;
    state.readings = state.readings.filter((r) => Date.parse(r.ts) >= cutoff);
    if (state.readings.length > MAX_READINGS) state.readings = state.readings.slice(-MAX_READINGS);
  };

  return {
    backend: "json",
    appendReadings(readings) {
      let n = 0;
      for (const r of readings) if (valid(r)) { state.readings.push(normalize(r, ++state.seq)); n++; }
      prune(); save(); return n;
    },
    allReadings: () => state.readings,
    readingsForHorse: (id) => state.readings.filter((r) => r.horseId === id),
    isAcked: (k) => !!state.acks[k],
    ackAlert(k) { state.acks[k] = true; save(); },
    statsSummary: () => ({
      backend: "json",
      readings: state.readings.length,
      horses: new Set(state.readings.map((r) => r.horseId)).size,
      oldest: state.readings[0]?.ts ?? null,
      newest: state.readings[state.readings.length - 1]?.ts ?? null,
    }),
  };
}

// --------------------------------------------------------------------------- //
export async function createStore() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { makePgStore } = await import("./store.pg.mjs");
    return makePgStore(url, { RETENTION_MS, MAX_READINGS, normalize, valid });
  }
  return makeJsonStore();
}
