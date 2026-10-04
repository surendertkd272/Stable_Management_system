// Deleting a horse: it goes to a recycle bin for 30 days, where it can be
// restored with all its readings; after that it and its readings are deleted
// for good. Admins only. While in the bin the horse is off the roster, so its
// stall is free and nothing new is filed under it.
const BIN = "horses_bin";
export const KEEP_DAYS = 30;
const DAY = 24 * 3600 * 1000;

export function recycleApi({ store, json }) {
  const actorOf = (who) => who?.name || who?.username || who?.role || "admin";
  const daysLeft = (row, now = Date.now()) => Math.max(0, Math.ceil((Date.parse(row.purgeAt) - now) / DAY));

  /** Horses whose 30 days are up: deleted with their readings. Returns how many. */
  function purgeExpired(now = Date.now()) {
    let n = 0;
    for (const row of [...store.list(BIN)]) {
      if (Date.parse(row.purgeAt) <= now) { purge(row); n++; }
    }
    return n;
  }
  function purge(row) {
    store.removeReadingsForHorse?.(row.horseId);
    store.remove(BIN, row.id);
  }

  async function handle(req, url, who) {
    const path = url.pathname, method = req.method;
    const admin = () => (who && who.role !== "admin" ? json(403, { error: "only an administrator can delete or restore horses" }) : null);

    // DELETE /api/horses/:id — to the bin
    const del = path.match(/^\/api\/horses\/([^/]+)$/);
    if (del && method === "DELETE") {
      const deny = admin(); if (deny) return deny;
      const id = decodeURIComponent(del[1]);
      const h = store.list("horses").find((x) => x.id === id);
      if (!h) return json(404, { error: "unknown horse" });
      const now = new Date();
      const row = store.create(BIN, { horseId: h.id, horse: h, deletedAt: now.toISOString(), deletedBy: actorOf(who),
        purgeAt: new Date(now.getTime() + KEEP_DAYS * DAY).toISOString(),
        readings: store.readingsForHorse(h.id).length });
      store.remove("horses", h.id);
      return json(200, { ok: true, bin: { ...row, daysLeft: daysLeft(row) } });
    }

    if (path === "/api/bin/horses" && method === "GET") {
      if (who?.role === "owner") return json(404, { error: "not found" });
      purgeExpired();
      return json(200, store.list(BIN).map((r) => ({ id: r.id, horseId: r.horseId, name: r.horse?.name, stall: r.horse?.stall,
        photo: r.horse?.photo ?? null, deletedAt: r.deletedAt, deletedBy: r.deletedBy, purgeAt: r.purgeAt, daysLeft: daysLeft(r),
        readings: store.readingsForHorse(r.horseId).length }))
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)));
    }

    const rs = path.match(/^\/api\/bin\/horses\/([^/]+)\/restore$/);
    if (rs && method === "POST") {
      const deny = admin(); if (deny) return deny;
      const row = store.list(BIN).find((r) => r.id === decodeURIComponent(rs[1]));
      if (!row) return json(404, { error: "not in the recycle bin (restored already, or past its 30 days)" });
      if (store.list("horses").some((h) => h.id === row.horseId))
        return json(409, { error: `a horse with the id "${row.horseId}" exists again — rename or remove it first` });
      // Its stall may have been given to another horse meanwhile.
      const taken = row.horse?.stall && row.horse.stall !== "—" && store.list("horses").find((h) => h.stall === row.horse.stall);
      const restored = store.create("horses", { ...row.horse, id: row.horseId, ...(taken ? { stall: "—" } : {}) });
      store.remove(BIN, row.id);
      return json(200, { ok: true, horse: restored, stallFreed: taken ? { stall: row.horse.stall, nowWith: taken.name } : null });
    }

    const pg = path.match(/^\/api\/bin\/horses\/([^/]+)$/);
    if (pg && method === "DELETE") {
      const deny = admin(); if (deny) return deny;
      const row = store.list(BIN).find((r) => r.id === decodeURIComponent(pg[1]));
      if (!row) return json(404, { error: "not in the recycle bin" });
      const readings = store.readingsForHorse(row.horseId).length;
      purge(row);
      return json(200, { ok: true, deletedReadings: readings });
    }
    return null;
  }

  return { handle, purgeExpired };
}
