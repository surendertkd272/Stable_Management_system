// Storage layer behind a small interface so the JSON-file dev store can be
// swapped for Postgres (India region, DPDP residency) with no caller changes.
//   createStore()  -> picks Postgres when DATABASE_URL is set, else JSON file.
// Both expose the same synchronous read interface (readings are memory-cached);
// writes are durable. rollup.mjs is pure and takes readings as args, so it is
// unaffected by the backend choice.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// Where the JSON store lives. This used to be derived from import.meta.url —
// but once Next.js bundles the server, that URL points inside .next/, which is
// deleted on every build: the stable's data would vanish with each deploy.
// Resolved from the working directory (the app root under `npm start`), or set
// EQUICARE_DATA_DIR to put it somewhere backed up.
export const dataDir = () =>
  process.env.EQUICARE_DATA_DIR || join(process.cwd(), "server", "data");
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
  const DATA_DIR = dataDir();
  const STATE_FILE = join(DATA_DIR, "state.json");
  let state = { readings: [], acks: {}, seq: 0, entities: {} };
  let saveTimer = null;

  try {
    state = JSON.parse(readFileSync(/*turbopackIgnore: true*/ STATE_FILE, "utf8"));
    state.readings ||= []; state.acks ||= {}; state.seq ||= 0; state.entities ||= {};
  } catch { /* fresh */ }

  const save = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (!existsSync(/*turbopackIgnore: true*/ DATA_DIR)) mkdirSync(/*turbopackIgnore: true*/ DATA_DIR, { recursive: true });
      writeFileSync(/*turbopackIgnore: true*/ STATE_FILE, JSON.stringify(state));
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

    // ---- entities: user-authored records (horses, diary, health, …) ----- //
    list(kind) { return state.entities[kind] ?? []; },
    seed(kind, rows) {
      if (!state.entities[kind]?.length) { state.entities[kind] = rows; save(); }
      return state.entities[kind];
    },
    create(kind, obj) {
      const row = { ...obj, id: obj.id ?? `${kind}-${Date.now()}-${++state.seq}` };
      (state.entities[kind] ||= []).push(row); save(); return row;
    },
    update(kind, id, patch) {
      const list = state.entities[kind] ||= [];
      const i = list.findIndex((r) => r.id === id);
      if (i < 0) return null;
      list[i] = { ...list[i], ...patch, id }; save(); return list[i];
    },
    remove(kind, id) {
      const list = state.entities[kind] ||= [];
      const i = list.findIndex((r) => r.id === id);
      if (i < 0) return false;
      list.splice(i, 1); save(); return true;
    },

    statsSummary: () => ({
      backend: "json",
      readings: state.readings.length,
      horses: new Set(state.readings.map((r) => r.horseId)).size,
      oldest: state.readings[0]?.ts ?? null,
      newest: state.readings[state.readings.length - 1]?.ts ?? null,
      entities: Object.fromEntries(Object.entries(state.entities).map(([k, v]) => [k, v.length])),
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
