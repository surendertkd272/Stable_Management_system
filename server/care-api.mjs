// /api/care — the Health checks page: each horse's temperature by the thermal
// camera, the checks that are due, the stable's care log, and outbreak mode
// (CLINICAL_RESEARCH.md, part I). Staff and admins; owners do not see it.
//
//   GET    /api/care              the page: horses, due checks, log, outbreak
//   POST   /api/care/events       log a change (new hay, a journey, a move…)
//   DELETE /api/care/events/:id   remove an entry (its author or an admin)
//   POST   /api/care/outbreak     { action: "start", disease } | { action: "case" } | { action: "end" }
import { KINDS, validateEvent, configureCareLog, colicRisks, isolation, recentLongJourneys, ISOLATION_DAYS, POST_JOURNEY_DAYS } from "./care-log.mjs";
import { bodyTemperature, isFever, FEVER_C } from "./core-temp.mjs";
import { foalingWindow, foalingPlan } from "./named-alerts.mjs";
import { currentSettings, saveSettings } from "./settings.mjs";

const COLLECTION = "care_events";
const DAY = 24 * 3600 * 1000;
const SENIOR_AGE = 15, SENIOR_EVERY_DAYS = 182;     // PPID and teeth: a look every 6 months from 15 [H]

/** The horse's age in years from "16 yr", "16" or a birth year; null when unknown. */
export function ageYears(h, now = Date.now()) {
  const born = Number(h?.born);
  if (born > 1950 && born <= new Date(now).getFullYear()) return new Date(now).getFullYear() - born;
  const m = String(h?.age ?? "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/** The checks due for one horse now: [{ kind, text, severity }]. */
export function dueChecks(h, rd, now = Date.now()) {
  const out = [];
  const iso = isolation(h.id, now);
  if (iso) {
    const t = bodyTemperature(h, rd, now);
    const seenToday = rd.some((r) => r.metric === "body_temp_c" && new Date(r.ts).toDateString() === new Date(now).toDateString());
    out.push({ kind: "isolation", severity: "warn",
      text: `New arrival: day ${iso.day} of ${ISOLATION_DAYS} in isolation. Keep it apart, its own buckets and tools, and handle it last. ` +
        (seenToday ? "The thermal camera has read its temperature today." : "The thermal camera has not caught its eye today yet.") +
        (t.camera?.learning ? ` Its own normal is still being learned (day ${t.camera.days} of 3).` : "") });
  }
  for (const j of recentLongJourneys(h.id, now))
    out.push({ kind: "journey", severity: j.day >= 2 && j.day <= 3 ? "warn" : "ok",
      text: `Day ${j.day} of ${POST_JOURNEY_DAYS} after a ${j.hours}-hour journey: shipping fever shows 1–2 days after. A vet check at 24–48 h; the camera watches temperature, breathing, eating and droppings.` });
  const risks = colicRisks(h.id, now).filter((r) => Number.isFinite(r.until));
  if (risks.length)
    out.push({ kind: "colic_risk", severity: "ok",
      text: `Colic risk period: ${risks.map((r) => r.text).join("; ")}. One colic sign is enough to alert until it ends.` });
  const age = ageYears(h, now);
  if (age !== null && age >= SENIOR_AGE) {
    const last = Date.parse(h.seniorCheckAt ?? "");
    const days = Number.isFinite(last) ? Math.floor((now - last) / DAY) : null;
    if (days === null || days >= SENIOR_EVERY_DAYS)
      out.push({ kind: "senior", severity: "ok",
        text: `Aged ${age}: the 6-monthly check is due${days === null ? "" : ` (last ${days} days ago)`} — teeth, coat (long or slow to shed), ` +
          "topline and body condition, feet. Older horses are where PPID (Cushing's) and dental disease are found." });
  }
  if (foalingWindow(h, now)) {
    const p = foalingPlan(h);
    out.push({ kind: "foaling", severity: "ok",
      text: `Foaling watch: day ${p.gestationDay(now)} of pregnancy, due about ${new Date(p.due).toISOString().slice(0, 10)}` +
        `${p.fromOwnHistory ? ` (her own usual ${p.expected} days)` : ""}. Most mares foal at night; the camera watches for labour signs.` });
  }
  const foaled = Date.parse(h.foaledAt ?? "");
  if (Number.isFinite(foaled) && now - foaled >= 0 && now - foaled <= 2 * DAY) {
    const missing = [!h.foalStoodAt && "foal standing", !h.foalNursedAt && "foal nursing", !h.placentaAt && "placenta passed"].filter(Boolean);
    if (missing.length)
      out.push({ kind: "foal", severity: h.foaledTimeKnown ? "warn" : "ok",
        text: `Newborn foal: record ${missing.join(", ")} on the mare's page${h.foaledTimeKnown ? "" : ", and the time of birth"}. ` +
          "Standing within 1 h, nursing within 2 h and the placenta within 3 h is the usual 1-2-3." });
  }
  return out;
}

export function careApi({ store, json, roster, readingsFor, onChange = () => {} }) {
  const refresh = () => { configureCareLog({ events: store.list(COLLECTION), horses: roster() }); onChange(); };
  refresh();
  const actor = (who) => who?.username || who?.name || "admin";
  const body = async (req) => { try { return JSON.parse((await req.text()) || "{}"); } catch { return null; } };
  const nameOf = (id) => (id === "*" ? "All horses" : roster().find((h) => h.id === id)?.name ?? id);

  function page(now = Date.now()) {
    configureCareLog({ events: store.list(COLLECTION), horses: roster() });
    const horses = roster().map((h) => {
      const rd = readingsFor(h.id);
      const t = bodyTemperature(h, rd, now);
      const c = t.camera;
      return {
        id: h.id, name: h.name, stall: h.stall, species: h.species || "horse",
        temperature: {
          value: t.current?.value ?? null,
          by: t.current?.source ?? null,
          at: t.current?.at ?? null,
          rise: c?.rise ?? null, within: c?.within ?? null,
          learning: Boolean(c?.learning), learnedDays: c?.days ?? null, settled: c?.settled ?? null,
          fever: isFever(c) || (c === null && (t.measured?.value ?? 0) >= FEVER_C),
          noRecentEye: c === null,
        },
        checks: dueChecks(h, rd, now),
      };
    });
    const events = store.list(COLLECTION).slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 100)
      .map((e) => ({ ...e, label: KINDS[e.kind]?.label ?? e.kind, horseName: nameOf(e.horseId) }));
    return { horses, events, kinds: Object.entries(KINDS).map(([key, k]) => ({ key, label: k.label })),
      outbreak: currentSettings(store).outbreak, feverLine: FEVER_C };
  }

  async function handle(req, url, who) {
    const path = url.pathname, method = req.method;
    if (!path.startsWith("/api/care")) return null;
    if (who?.role === "owner") return json(404, { error: "not found" });
    if (path === "/api/care" && method === "GET") return json(200, page());

    if (path === "/api/care/events" && method === "POST") {
      const b = await body(req);
      if (!b) return json(400, { error: "malformed JSON" });
      const { event, errors } = validateEvent(b, { horses: roster() });
      if (errors) return json(400, { error: errors[0], errors });
      const row = store.create(COLLECTION, { ...event, by: actor(who), createdAt: new Date().toISOString() });
      // an arrival also starts the horse's isolation
      if (event.kind === "arrived" && event.horseId !== "*") store.update("horses", event.horseId, { arrivedAt: event.at });
      refresh();
      return json(201, row);
    }
    const one = path.match(/^\/api\/care\/events\/([^/]+)$/);
    if (one && method === "DELETE") {
      const cur = store.list(COLLECTION).find((e) => e.id === decodeURIComponent(one[1]));
      if (!cur) return json(404, { error: "no such entry" });
      if (who && who.role !== "admin" && cur.by !== actor(who)) return json(403, { error: `only ${cur.by} or an administrator can remove this` });
      store.remove(COLLECTION, cur.id);
      refresh();
      return json(200, { ok: true });
    }

    if (path === "/api/care/outbreak" && method === "POST") {
      const b = await body(req);
      if (!b) return json(400, { error: "malformed JSON" });
      const s = currentSettings(store), now = new Date().toISOString();
      let ob = s.outbreak;
      if (b.action === "start") {
        const disease = String(b.disease ?? "").trim().slice(0, 60);
        const days = Math.round(Number(b.quarantineDays) || 28);
        if (days < 7 || days > 120) return json(400, { error: "quarantine of 7 to 120 days" });
        ob = { active: true, disease, startedAt: now, lastCaseAt: now, quarantineDays: days, by: actor(who) };
      } else if (b.action === "case") {
        if (!ob?.active) return json(409, { error: "outbreak mode is not on" });
        ob = { ...ob, lastCaseAt: now };
      } else if (b.action === "end") {
        if (who && who.role !== "admin") return json(403, { error: "an administrator ends outbreak mode, on the vet's word" });
        ob = { ...ob, active: false, endedAt: now, endedBy: actor(who) };
      } else return json(400, { error: "action: start, case or end" });
      saveSettings(store, { ...s, outbreak: ob });
      onChange();
      return json(200, page());
    }
    return json(405, { error: "method not allowed" });
  }
  return { handle, refresh };
}
