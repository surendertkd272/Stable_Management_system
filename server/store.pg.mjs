// Postgres-backed store (pilot / production). Same interface as the JSON store:
// readings are cached in memory for synchronous reads (rollup calls are sync),
// while writes are persisted to Postgres. Enable by setting DATABASE_URL and
// installing the driver:  cd server && npm install pg
//
// Point DATABASE_URL at a Postgres in your data-residency region (e.g. a Mumbai
// ap-south-1 managed instance) to satisfy DPDP. Run schema.sql once.
//
// NOTE: exercised against the interface but NOT yet run against a live database
// in this environment — verify migrations + the initial cache load on a real
// Postgres before the pilot.

export async function makePgStore(url, { RETENTION_MS, MAX_READINGS, normalize, valid, dedupKeyOf, storageView, pool: injected }) {
  // `pool` is injectable so the store's own logic can be tested without a database.
  const pool = injected ?? await (async () => {
    const pg = await import("pg");           // lazy: only loaded when DATABASE_URL is set
    return new pg.default.Pool({ connectionString: url, max: 4 });
  })();

  // in-memory cache for synchronous reads (mirrors the JSON store's behaviour)
  let readings = [];
  const acks = new Set();
  const entities = {};        // kind -> rows (cached; Postgres is source of truth)
  let seq = 0;
  let cacheEvicted = 0;       // readings pushed out of the CACHE by the cap (still in Postgres)
  const keys = new Set();     // dedupKeys of the cached readings (the database's index covers the rest)

  // A re-sent reading must not be stored twice: a unique index on its
  // dedupKey, and ON CONFLICT DO NOTHING on insert. Created here (idempotent)
  // so an existing database picks it up; it fails only if duplicates are
  // already stored, which is logged and leaves ingest working (the cache
  // still de-duplicates).
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS readings_dedup_key_idx
                        ON readings ((meta->>'dedupKey')) WHERE meta ? 'dedupKey'`);
  } catch (e) {
    console.error("[pg] could not create the dedupKey index (duplicates already stored?):", e.message);
  }

  // load recent window + acks into cache on boot — the NEWEST readings when
  // the window holds more than the cache can.
  {
    const since = new Date(Date.now() - RETENTION_MS).toISOString();
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT id, horse_id AS "horseId", stall_id AS "stallId", metric, value, unit,
                to_char(ts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ts, ts AS ts_order, source, confidence, meta
           FROM readings WHERE readings.ts >= $1 ORDER BY readings.ts DESC LIMIT $2) recent
       ORDER BY ts_order ASC`,
      [since, MAX_READINGS]);
    readings = rows.map(({ ts_order, ...r }) => ({ ...r, value: Number(r.value), confidence: Number(r.confidence) }));
    for (const r of readings) { const k = dedupKeyOf(r); if (k) keys.add(k); }
    const a = await pool.query(`SELECT alert_key FROM alert_acks`);
    for (const row of a.rows) acks.add(row.alert_key);
    const e = await pool.query(`SELECT kind, id, data FROM entities ORDER BY created_at ASC`);
    for (const row of e.rows) (entities[row.kind] ||= []).push({ ...row.data, id: row.id });
  }

  // No conflict target: skips a clash on the id OR on the dedupKey index.
  const insert = `INSERT INTO readings
    (id, horse_id, stall_id, metric, value, unit, ts, source, confidence, meta)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`;
  const forget = (r) => { const k = dedupKeyOf(r); if (k) keys.delete(k); };

  return {
    backend: "postgres",
    appendReadings(batch, stats) {
      let n = 0, dup = 0;
      const rows = [];
      for (const r of batch) {
        if (!valid(r)) continue;
        const k = dedupKeyOf(r);
        if (k && keys.has(k)) { dup++; continue; }
        if (k) keys.add(k);
        const x = normalize(r, ++seq); rows.push(x); readings.push(x); n++;
      }
      if (stats) stats.duplicates = (stats.duplicates || 0) + dup;
      // write-through (fire-and-forget with error logging; cache already updated)
      for (const x of rows) {
        pool.query(insert, [x.id, x.horseId, x.stallId, x.metric, x.value, x.unit, x.ts,
                            x.source, x.confidence, x.meta ? JSON.stringify(x.meta) : null])
          .catch((e) => console.error("[pg] insert failed:", e.message));
      }
      const cutoff = Date.now() - RETENTION_MS;
      readings = readings.filter((r) => (Date.parse(r.ts) >= cutoff ? true : (forget(r), false)));
      if (readings.length > MAX_READINGS) {
        const over = readings.length - MAX_READINGS;
        for (const r of readings.slice(0, over)) forget(r);
        readings = readings.slice(over);
        cacheEvicted += over;
      }
      return n;
    },
    allReadings: () => readings,
    readingsForHorse: (id) => readings.filter((r) => r.horseId === id),
    isAcked: (k) => acks.has(k),
    ackAlert(k) {
      acks.add(k);
      pool.query(`INSERT INTO alert_acks(alert_key) VALUES($1) ON CONFLICT DO NOTHING`, [k])
        .catch((e) => console.error("[pg] ack failed:", e.message));
    },

    // ---- entities: same contract as the JSON store ---------------------- //
    list(kind) { return entities[kind] ?? []; },
    seed(kind, rows) {
      if (entities[kind]?.length) return entities[kind];
      entities[kind] = rows;
      for (const r of rows)
        pool.query(`INSERT INTO entities(kind,id,data) VALUES($1,$2,$3)
                    ON CONFLICT (kind,id) DO NOTHING`, [kind, r.id, r])
          .catch((e) => console.error("[pg] seed failed:", e.message));
      return rows;
    },
    create(kind, obj) {
      const row = { ...obj, id: obj.id ?? `${kind}-${Date.now()}-${++seq}` };
      (entities[kind] ||= []).push(row);
      pool.query(`INSERT INTO entities(kind,id,data) VALUES($1,$2,$3)
                  ON CONFLICT (kind,id) DO UPDATE SET data = $3`, [kind, row.id, row])
        .catch((e) => console.error("[pg] entity insert failed:", e.message));
      return row;
    },
    update(kind, id, patch) {
      const list = entities[kind] ||= [];
      const i = list.findIndex((r) => r.id === id);
      if (i < 0) return null;
      list[i] = { ...list[i], ...patch, id };
      pool.query(`UPDATE entities SET data = $3 WHERE kind = $1 AND id = $2`, [kind, id, list[i]])
        .catch((e) => console.error("[pg] entity update failed:", e.message));
      return list[i];
    },
    remove(kind, id) {
      const list = entities[kind] ||= [];
      const i = list.findIndex((r) => r.id === id);
      if (i < 0) return false;
      list.splice(i, 1);
      pool.query(`DELETE FROM entities WHERE kind = $1 AND id = $2`, [kind, id])
        .catch((e) => console.error("[pg] entity delete failed:", e.message));
      return true;
    },
    // Nothing is dropped from Postgres itself; only the in-memory view is capped.
    storage: () => storageView({ backend: "postgres", readings: readings.length, cap: MAX_READINGS, droppedByCap: 0, cacheEvicted }),
    statsSummary: () => ({
      backend: "postgres",
      readings: readings.length,
      horses: new Set(readings.map((r) => r.horseId)).size,
      oldest: readings[0]?.ts ?? null,
      newest: readings[readings.length - 1]?.ts ?? null,
      entities: Object.fromEntries(Object.entries(entities).map(([k, v]) => [k, v.length])),
    }),
  };
}
