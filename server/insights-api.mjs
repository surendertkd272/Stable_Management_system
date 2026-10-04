// Routes for what we learned from handheld gait apps (RealHorse): each horse
// against its own normal, events with clips and a verdict that a vet can
// confirm, the accuracy kit, gait checks done elsewhere, and the report as a
// PDF. app.mjs hands requests here after login and role checks.
import { compare, validateBaseline } from "./baseline.mjs";
import { buildEvents, cutClip, validateReview, labelFor, sampleMoments, validateCheck, systemValue, agreement } from "./events.mjs";
import { listClips, serveFile } from "./footage.mjs";
import { buildAlerts } from "./rollup.mjs";
import { safeTimeZone } from "./client_report.mjs";

const H = 3600 * 1000;
const LIMBS = ["LF", "RF", "LH", "RH"];
const GRADES = ["sound", "mild", "moderate", "severe"];
const TOOLS = ["RealHorse", "Sleip", "vet", "other"];

export function insightsApi({ store, json, CORS, roster }) {
  const bio = (id) => roster().find((h) => h.id === id) || null;
  const body = async (req) => { try { return JSON.parse((await req.text()) || "{}"); } catch { return null; } };
  const actorOf = (who) => who?.name || who?.username || who?.role || "admin";

  /** A camera's crop of this horse's stall (several stalls on one camera). */
  const cropFor = (camera, stall) => {
    const d = store.list("devices").find((x) => x.id === camera);
    const z = d?.views?.find((v) => v.kind === "wide")?.zones?.find((x) => x.stall === stall);
    return z ? [z.colour.x0, z.colour.y0, z.colour.x1, z.colour.y1].map((v) => v / 10000) : null;
  };
  const eyeBase = (h, rd, tz) => {
    const c = compare(h, rd, { tz });
    return c.rows.find((r) => r.key === "eye")?.baseline ?? null;
  };

  /** Clips are fetched by <video>, which cannot send a login header: a ticket instead. */
  async function clip(req, url, tickets) {
    const t = tickets?.get(url.searchParams.get("vt") || "");
    if (!t || t.exp < Date.now()) return json(401, { error: "video ticket missing or expired — reload the page" });
    const camera = url.searchParams.get("camera") || "";
    const stream = url.searchParams.get("stream") === "thermal" ? "thermal" : "visible";
    const atMs = Date.parse(url.searchParams.get("at") || "");
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(camera) || !Number.isFinite(atMs)) return json(400, { error: "camera and at are required" });
    const num = (k, d, lo, hi) => Math.max(lo, Math.min(hi, Number(url.searchParams.get(k) ?? d) || d));
    const stall = url.searchParams.get("stall");
    let mark = null;
    try { mark = url.searchParams.get("mark") ? JSON.parse(url.searchParams.get("mark")) : null; } catch { mark = null; }
    try {
      const file = await cutClip({ camera, stream, atMs, beforeS: num("before", 10, 0, 60), afterS: num("after", 20, 1, 120),
        crop: stream === "visible" && stall ? cropFor(camera, stall) : null, mark, slow: url.searchParams.get("slow") === "1" });
      if (!file) return json(404, { error: "nothing was recorded then" });
      return serveFile(req, file, "video/mp4", CORS);
    } catch (e) {
      return json(502, { error: e.message });
    }
  }

  async function handle(req, url, who) {
    const path = url.pathname, method = req.method;
    const tz = safeTimeZone(url.searchParams.get("tz") || undefined);
    const staffOnly = () => (who?.role === "owner" ? json(404, { error: "not found" }) : null);

    // ---- each horse against its own normal ------------------------------- //
    const bm = path.match(/^\/api\/horses\/([^/]+)\/baseline$/);
    if (bm) {
      const h = bio(decodeURIComponent(bm[1]));
      if (!h || (who?.role === "owner" && h.owner !== who.owner)) return json(404, { error: "unknown horse" });
      if (method === "GET") {
        const from = Date.parse(url.searchParams.get("from") || ""), to = Date.parse(url.searchParams.get("to") || "");
        return json(200, compare(h, store.readingsForHorse(h.id), { tz, ...(Number.isFinite(from) && Number.isFinite(to) ? { from, to } : {}) }));
      }
      if (method === "PUT") {
        const deny = staffOnly(); if (deny) return deny;
        const b = await body(req);
        if (!b) return json(400, { error: "malformed JSON" });
        const { baseline, errs } = validateBaseline(b);
        if (errs.length) return json(400, { error: "invalid baseline", details: errs });
        store.update("horses", h.id, { baseline: baseline ? { ...baseline, setBy: actorOf(who), setAt: new Date().toISOString() } : null });
        return json(200, compare({ ...h, baseline: baseline ? { ...baseline } : null }, store.readingsForHorse(h.id), { tz }));
      }
    }

    // ---- events with a verdict, and a person's review --------------------- //
    if (path === "/api/events" && method === "GET") {
      const deny = staffOnly(); if (deny) return deny;
      const to = Date.parse(url.searchParams.get("to") || "") || Date.now();
      const from = Date.parse(url.searchParams.get("from") || "") || to - 24 * H;
      if (!(from < to) || to - from > 14 * 24 * H) return json(400, { error: "the window must be up to 14 days" });
      const only = url.searchParams.get("horse");
      const horses = roster().filter((h) => !only || h.id === only);
      const reviews = new Map(store.list("event_reviews").map((r) => [r.eventId, r]));
      const clipsAt = listClips();
      const all = store.allReadings();
      const untrusted = new Set(store.list("devices").filter((d) => d.peopleTrusted === false).map((d) => d.id));
      const peopleTrusted = (cam) => !untrusted.has(cam);
      const out = [];
      for (const h of horses) {
        const rd = all.filter((r) => r.horseId === h.id);
        const alerts = buildAlerts([h], all, store.isAcked).map((a) => ({ ...a, ts: undefined }));
        for (const e of buildEvents(h, rd, { from, to, alerts: only ? alerts : [], eyeBaseline: eyeBase(h, rd, tz), peopleTrusted })) {
          const t = Date.parse(e.at);
          const video = e.camera ? clipsAt.some((c) => c.camera === e.camera && c[e.stream] && Date.parse(c.at) <= t && t < Date.parse(c.end)) : false;
          out.push({ ...e, video, review: reviews.get(e.id) ?? null });
        }
      }
      return json(200, out);
    }
    const rv = path.match(/^\/api\/events\/([^/]+)\/review$/);
    if (rv && method === "POST") {
      const deny = staffOnly(); if (deny) return deny;
      const b = await body(req);
      if (!b) return json(400, { error: "malformed JSON" });
      const { review, errs } = validateReview(b);
      if (errs.length) return json(400, { error: "invalid review", details: errs });
      // The event is rebuilt from the readings, never taken from the client.
      const h = bio(String(b.horse || ""));
      const at = Date.parse(b.at || "");
      if (!h || !Number.isFinite(at)) return json(400, { error: "horse and at are required" });
      const rd = store.readingsForHorse(h.id);
      const ev = buildEvents(h, rd, { from: at - H, to: at + H, eyeBaseline: eyeBase(h, rd, tz) }).find((e) => e.id === decodeURIComponent(rv[1]));
      if (!ev) return json(404, { error: "no such event" });
      const old = store.list("event_reviews").find((r) => r.eventId === ev.id);
      const row = { eventId: ev.id, horse: h.id, kind: ev.kind, at: ev.at, camera: ev.camera, stall: ev.stall, ...review, by: actorOf(who), reviewedAt: new Date().toISOString() };
      const saved = old ? store.update("event_reviews", old.id, row) : store.create("event_reviews", row);
      const label = labelFor(ev, review, actorOf(who));
      if (label && !store.list("footage_labels").some((l) => l.camera === label.camera && l.label === label.label && l.startAt === label.startAt))
        store.create("footage_labels", label);
      return json(200, { review: saved, trainingLabel: Boolean(label) });
    }
    if (path === "/api/events/reviews/export" && method === "GET") {
      const deny = staffOnly(); if (deny) return deny;
      const rows = store.list("event_reviews").sort((a, b) => a.at.localeCompare(b.at));
      const esc = (v) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
      const csv = ["event_id,horse,kind,at,camera,stall,verdict,note,by,reviewed_at",
        ...rows.map((r) => [r.eventId, r.horse, r.kind, r.at, r.camera, r.stall, r.verdict, r.note, r.by, r.reviewedAt].map(esc).join(","))].join("\n") + "\n";
      return new Response(csv, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="equicare-event-reviews-${new Date().toISOString().slice(0, 10)}.csv"`, ...CORS } });
    }

    // ---- accuracy kit ----------------------------------------------------- //
    if (path === "/api/validation/sample" && method === "GET") {
      const deny = staffOnly(); if (deny) return deny;
      const h = bio(url.searchParams.get("horse") || "");
      if (!h) return json(400, { error: "choose a horse" });
      const kind = url.searchParams.get("kind") === "state" ? "state" : "breathing";
      const done = new Set(store.list("validation_checks").map((c) => `${c.camera}|${c.at}`));
      return json(200, sampleMoments(store.readingsForHorse(h.id), listClips(), { kind, n: Math.min(30, Number(url.searchParams.get("n")) || 10),
        seed: Number(url.searchParams.get("seed")) || Date.now() % 100000, done }));
    }
    if (path === "/api/validation" && method === "POST") {
      const deny = staffOnly(); if (deny) return deny;
      const b = await body(req);
      if (!b) return json(400, { error: "malformed JSON" });
      const { check, errs } = validateCheck(b);
      if (errs.length) return json(400, { error: "invalid check", details: errs });
      const h = check.horse ? bio(check.horse) : null;
      const sys = systemValue(h ? store.readingsForHorse(h.id) : store.allReadings(), check);
      const row = store.create("validation_checks", { ...check, system: sys, by: actorOf(who), createdAt: new Date().toISOString() });
      return json(201, row);
    }
    if (path === "/api/validation/report" && method === "GET") {
      const deny = staffOnly(); if (deny) return deny;
      const only = url.searchParams.get("horse");
      const checks = store.list("validation_checks").filter((c) => !only || c.horse === only);
      return json(200, { ...agreement(checks), checks: checks.length,
        note: "Breathing: system minus people, per reading (bias and 95% limits of agreement) and per night (median). Lying/eating/standing: share of moments where the system and people agree. Small samples say little — aim for 30+ breathing and 50+ state checks." });
    }

    // ---- gait checks done elsewhere (RealHorse, Sleip, a vet's trot-up) --- //
    const gm = path.match(/^\/api\/horses\/([^/]+)\/gait$/);
    if (gm && method === "POST") {
      const deny = staffOnly(); if (deny) return deny;
      const h = bio(decodeURIComponent(gm[1]));
      if (!h) return json(404, { error: "unknown horse" });
      const b = await body(req);
      if (!b) return json(400, { error: "malformed JSON" });
      const errs = [];
      const at = Date.parse(b.at || "") || Date.now();
      const tool = String(b.tool || "");
      const grade = String(b.grade || "");
      const mm = b.mm === undefined || b.mm === null || b.mm === "" ? null : Number(b.mm);
      const limb = b.limb ? String(b.limb) : null;
      if (!TOOLS.includes(tool)) errs.push(`tool must be one of ${TOOLS.join(", ")}`);
      if (!GRADES.includes(grade)) errs.push(`grade must be one of ${GRADES.join(", ")}`);
      if (mm !== null && !(mm >= 0 && mm <= 200)) errs.push("asymmetry in mm must be 0–200");
      if (limb && !LIMBS.includes(limb)) errs.push(`limb must be one of ${LIMBS.join(", ")}`);
      if (at > Date.now() + 60000) errs.push("the check cannot be in the future");
      if (errs.length) return json(400, { error: "invalid gait check", details: errs });
      // Its own metric: a check done with a phone app or by a vet is not the
      // wearable's trot measure, and must not move that one's normal.
      const r = { horseId: h.id, stallId: h.stall, metric: "gait_check", value: GRADES.indexOf(grade),
        unit: "grade", ts: new Date(at).toISOString(), source: "manual", confidence: 1,
        meta: { tool, grade, limb, asymmetryMm: mm, scale: "0 sound, 1 mild, 2 moderate, 3 severe", note: String(b.note || "").slice(0, 300), by: actorOf(who), manual: true } };
      const n = store.appendReadings([r]);
      return json(n ? 201 : 409, n ? r : { error: "not stored" });
    }
    return null;
  }

  return { handle, clip };
}
