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
// The cap, overridable for tests and for a server with memory to spare.
const readingsCap = () => Math.max(1, Math.floor(Number(process.env.EQUICARE_MAX_READINGS) || MAX_READINGS));

// A reading re-sent by a device (the edge outbox after a timeout, the relay
// after a lost ack, a hub replaying its buffer) must not count twice. The
// ingest path stamps meta.dedupKey on every reading from a known device; a
// store keeps each key once.
const dedupKeyOf = (r) => (typeof r?.meta?.dedupKey === "string" && r.meta.dedupKey ? r.meta.dedupKey : null);

/** The /api/health storage block: how full the store is, and what to do. */
function storageView({ backend, readings, cap, droppedByCap, lastDropAt = null, cacheEvicted = 0 }) {
  let advice = null;
  if (backend === "json" && droppedByCap > 0)
    advice = `The JSON store is full: the oldest readings are being dropped to stay under ${cap.toLocaleString("en-GB")}. ` +
      "Switch to the Postgres store (set DATABASE_URL) to keep them.";
  else if (backend === "json" && readings >= 0.8 * cap)
    advice = `The JSON store is at ${Math.round((readings / cap) * 100)}% of its ${cap.toLocaleString("en-GB")}-reading limit; ` +
      "at the limit the oldest readings are dropped. Switch to the Postgres store (set DATABASE_URL) before then.";
  else if (backend === "postgres" && cacheEvicted > 0)
    advice = `Postgres keeps every reading, but the live view holds only the newest ${cap.toLocaleString("en-GB")} — ` +
      "set EQUICARE_MAX_READINGS higher if this server has the memory.";
  return { backend, readings, cap, droppedByCap, lastDropAt, ...(backend === "postgres" ? { cacheEvicted } : {}), advice };
}

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
  const cap = readingsCap();
  let state = { readings: [], acks: {}, seq: 0, entities: {} };
  let saveTimer = null;

  try {
    state = JSON.parse(readFileSync(/*turbopackIgnore: true*/ STATE_FILE, "utf8"));
    state.readings ||= []; state.acks ||= {}; state.seq ||= 0; state.entities ||= {};
  } catch { /* fresh */ }
  // Readings the cap pushed out, ever — kept in the state so a restart does
  // not make a full store look healthy again.
  state.droppedByCap ||= 0;
  const keys = new Set(state.readings.map(dedupKeyOf).filter(Boolean));

  const save = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (!existsSync(/*turbopackIgnore: true*/ DATA_DIR)) mkdirSync(/*turbopackIgnore: true*/ DATA_DIR, { recursive: true });
      writeFileSync(/*turbopackIgnore: true*/ STATE_FILE, JSON.stringify(state));
    }, 250);
  };
  const forget = (r) => { const k = dedupKeyOf(r); if (k) keys.delete(k); };
  const prune = () => {
    const cutoff = Date.now() - RETENTION_MS;
    const kept = [];
    for (const r of state.readings) if (Date.parse(r.ts) >= cutoff) kept.push(r); else forget(r);
    state.readings = kept;
    if (state.readings.length > cap) {
      const over = state.readings.length - cap;
      for (const r of state.readings.slice(0, over)) forget(r);
      state.readings = state.readings.slice(over);
      if (!state.droppedByCap) console.warn(`[store] the JSON store reached its cap of ${cap} readings — dropping the oldest; switch to Postgres (DATABASE_URL)`);
      state.droppedByCap += over;
      state.lastDropAt = new Date().toISOString();
    }
  };

  return {
    backend: "json",
    /** Returns how many were stored. `stats.duplicates` (when passed) gets
     *  how many were skipped as already stored (same meta.dedupKey). */
    appendReadings(readings, stats) {
      let n = 0, dup = 0;
      for (const r of readings) {
        if (!valid(r)) continue;
        const k = dedupKeyOf(r);
        if (k && keys.has(k)) { dup++; continue; }
        if (k) keys.add(k);
        state.readings.push(normalize(r, ++state.seq)); n++;
      }
      if (stats) stats.duplicates = (stats.duplicates || 0) + dup;
      if (n) { prune(); save(); }
      return n;
    },
    allReadings: () => state.readings,
    readingsForHorse: (id) => state.readings.filter((r) => r.horseId === id),
    /** A horse deleted for good: its readings go too. Returns how many. */
    removeReadingsForHorse(id) {
      const before = state.readings.length;
      state.readings = state.readings.filter((r) => (r.horseId === id ? (forget(r), false) : true));
      const n = before - state.readings.length;
      if (n) save();
      return n;
    },
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

    storage: () => storageView({ backend: "json", readings: state.readings.length, cap,
      droppedByCap: state.droppedByCap, lastDropAt: state.lastDropAt ?? null }),
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
    return makePgStore(url, { RETENTION_MS, MAX_READINGS: readingsCap(), normalize, valid, dedupKeyOf, storageView });
  }
  return makeJsonStore();
}
