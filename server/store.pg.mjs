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

export async function makePgStore(url, { RETENTION_MS, MAX_READINGS, normalize, valid }) {
  const pg = await import("pg");             // lazy: only loaded when DATABASE_URL is set
  const pool = new pg.default.Pool({ connectionString: url, max: 4 });

  // in-memory cache for synchronous reads (mirrors the JSON store's behaviour)
  let readings = [];
  const acks = new Set();
  let seq = 0;

  // load recent window + acks into cache on boot
  {
    const since = new Date(Date.now() - RETENTION_MS).toISOString();
    const { rows } = await pool.query(
      `SELECT id, horse_id AS "horseId", stall_id AS "stallId", metric, value, unit,
              to_char(ts,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ts, source, confidence, meta
         FROM readings WHERE ts >= $1 ORDER BY ts ASC LIMIT $2`,
      [since, MAX_READINGS]);
    readings = rows.map((r) => ({ ...r, value: Number(r.value), confidence: Number(r.confidence) }));
    const a = await pool.query(`SELECT alert_key FROM alert_acks`);
    for (const row of a.rows) acks.add(row.alert_key);
  }

  const insert = `INSERT INTO readings
    (id, horse_id, stall_id, metric, value, unit, ts, source, confidence, meta)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`;

  return {
    backend: "postgres",
    appendReadings(batch) {
      let n = 0;
      const rows = [];
      for (const r of batch) if (valid(r)) { const x = normalize(r, ++seq); rows.push(x); readings.push(x); n++; }
      // write-through (fire-and-forget with error logging; cache already updated)
      for (const x of rows) {
        pool.query(insert, [x.id, x.horseId, x.stallId, x.metric, x.value, x.unit, x.ts,
                            x.source, x.confidence, x.meta ? JSON.stringify(x.meta) : null])
          .catch((e) => console.error("[pg] insert failed:", e.message));
      }
      const cutoff = Date.now() - RETENTION_MS;
      readings = readings.filter((r) => Date.parse(r.ts) >= cutoff);
      if (readings.length > MAX_READINGS) readings = readings.slice(-MAX_READINGS);
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
    statsSummary: () => ({
      backend: "postgres",
      readings: readings.length,
      horses: new Set(readings.map((r) => r.horseId)).size,
      oldest: readings[0]?.ts ?? null,
      newest: readings[readings.length - 1]?.ts ?? null,
    }),
  };
}
