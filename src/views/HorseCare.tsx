"use client";
// On the horse's page: how unusual the latest day was against the horse's own
// normal (0–10), and for a mare, her foaling dates — the window in which signs
// of labour raise "Foaling may be starting", and the 90 days after foaling
// when the camera sees two animals and single-horse notes are paused.
import { useState } from "react";
import { Baby, Thermometer, ClipboardList } from "lucide-react";
import * as api from "../data/api";
import type { Horse } from "../data/mock";
import { useStable, useToast } from "../store";

const DAY = 24 * 3600 * 1000;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export const unusualColor = (s: number | null | undefined) =>
  s == null ? "var(--text-secondary)" : s >= 6 ? "var(--alert)" : s >= 3 ? "var(--warn)" : "var(--positive)";
export const unusualWord = (s: number | null | undefined) =>
  s == null ? "learning" : s >= 6 ? "very unusual" : s >= 3 ? "a little unusual" : "usual";

export function UnusualCard({ horse }: { horse: Horse }) {
  const u = horse.unusual;
  if (!u) return null;
  return (
    <div className="card">
      <div className="card-head">
        <h3>How unusual today</h3>
        <span className="sub">against {horse.name}&apos;s normal</span>
      </div>
      <div className="flex center gap-md">
        <div style={{ fontFamily: "var(--font-display)", fontSize: 44, fontWeight: 700, lineHeight: 1, color: unusualColor(u.score) }}>
          {u.score ?? "—"}
          {u.score != null && <small style={{ fontSize: 18, color: "var(--text-secondary)" }}>/10</small>}
        </div>
        <div className="grow">
          <b style={{ color: unusualColor(u.score) }}>{unusualWord(u.score)}</b>
          <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>
            {u.score == null
              ? "Shown once there is a normal to compare with (the first days monitored)."
              : u.reasons.length
                ? `Most different: ${u.reasons.join(", ")}.`
                : "Every measure close to normal."}
          </p>
        </div>
      </div>
    </div>
  );
}

/** "+0.4 °C" */
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} °C`;

/** The camera's body temperature, in words for the horse's page and lists. */
export function bodyTempWords(horse: Horse): { value: string; note: string; state: "fever" | "raised" | "normal" | "learning" | "none" } {
  const c = horse.bodyTemp?.camera, cur = horse.bodyTemp?.current;
  if (c && c.value != null) {
    const within = c.within ?? 0.2, rise = c.rise ?? 0;
    const state = c.value >= 38.6 && rise >= Math.max(0.8, within) ? "fever" : rise >= Math.max(0.5, within) ? "raised" : "normal";
    return { value: `${c.value.toFixed(1)} °C`, state,
      note: `±${within} · eye ${signed(rise)} on its normal for this hour${c.settled ? "" : ` · from ${c.days} days so far`}` };
  }
  if (c?.learning) return { value: "—", state: "learning", note: `learning its normal: day ${c.days ?? 0} of ${c.needed ?? 3}` };
  if (cur && cur.value != null) return { value: `${cur.value.toFixed(1)} °C`, state: "normal", note: "body sensor" };
  return { value: "—", state: "none", note: "no eye reading in the last 30 min" };
}

export function BodyTempCard({ horse }: { horse: Horse }) {
  const w = bodyTempWords(horse);
  const eye = horse.vitals?.eyeTempC;
  const pill = w.state === "fever" ? ["alert", "Possible fever"] : w.state === "raised" ? ["warn", "Raised"] : w.state === "normal" ? ["ok", "Normal for this horse"]
    : w.state === "learning" ? ["muted", "Learning"] : ["muted", "Not read just now"];
  const normal = horse.species === "donkey" ? 37.1 : horse.species === "mule" ? 37.6 : 37.8;
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="flex center gap-sm"><Thermometer size={16} /> Body temperature</h3>
        <span className={`pill ${pill[0]}`}>{pill[1]}</span>
      </div>
      <div className="flex center gap-md">
        <div style={{ fontFamily: "var(--font-display)", fontSize: 40, fontWeight: 700, lineHeight: 1,
          color: w.state === "fever" ? "var(--alert)" : w.state === "raised" ? "var(--warn)" : undefined }}>{w.value}</div>
        <div className="grow" style={{ fontSize: 12.5 }}>
          <div>{w.note}</div>
          {eye != null && <div className="muted">eye surface {eye.toFixed(1)} °C (thermal camera)</div>}
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
        {w.state === "learning"
          ? `The thermal camera is learning ${horse.name}'s normal eye temperature for each time of day. Body temperature is shown from day 4; until then an eye at 38.6 °C or more still raises a fever alert.`
          : `From the thermal and colour cameras: a resting ${horse.species ?? "horse"}'s ${normal} °C plus how far ${horse.name}'s eye is from its own normal at this time of day, allowing for the stall's warmth. Readings with a person at the stall are left out.`}
      </p>
    </div>
  );
}

const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const hm = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function FoalingCard({ horse, canEdit }: { horse: Horse; canEdit: boolean }) {
  const notify = useToast();
  const { refreshHorses } = useStable();
  const [covered, setCovered] = useState(horse.coveredAt?.slice(0, 10) ?? "");
  const [past, setPast] = useState((horse.pastGestationDays ?? []).join(", "));
  const [due, setDue] = useState(horse.foalingDue?.slice(0, 10) ?? "");
  const [born, setBorn] = useState(toLocalInput(horse.foaledAt));
  const [busy, setBusy] = useState(false);
  if (horse.sex !== "Mare" && !horse.foalingDue && !horse.foaledAt && !horse.coveredAt) return null;

  const now = Date.now();
  const f = horse.foaling;
  const bornMs = horse.foaledAt ? Date.parse(horse.foaledAt) : NaN;
  const state = Number.isFinite(bornMs) && now - bornMs <= 90 * DAY
    ? { pill: "ok", text: "Mare and foal", note: `Foaled ${horse.foaledTimeKnown ? hm(horse.foaledAt!) : day(horse.foaledAt!)}. With two animals in view, single-horse notes (lying, rolling, colic signs) are paused until ${day(new Date(bornMs + 90 * DAY).toISOString())}; temperature, breathing, people and heat still alert.` }
    : f?.watching
      ? { pill: "warn", text: "Foaling watch on", note: `Day ${f.day} of pregnancy, due about ${day(f.due)}${f.fromOwnHistory ? ` (her own usual ${f.expected} days)` : ""}. Two signs of labour together — restlessness, lying down and getting up, rolling — raise “Foaling may be starting” and call the chain. The watch stays on until she foals.` }
      : f
        ? { pill: "muted", text: "Due date set", note: `Due about ${day(f.due)}${f.fromOwnHistory ? ` (her own usual ${f.expected} days)` : ""}. The foaling watch starts on ${day(f.watchFrom)}, about day 315 of pregnancy.` }
        : { pill: "muted", text: "Not in foal", note: "Enter the covering date (or a due date) to watch for the start of foaling." };

  const save = async (patch: Partial<Horse>, done: string) => {
    setBusy(true);
    const r = await api.patchEntity("horses", horse.id, patch);
    setBusy(false);
    if (!r) { notify("Could not save — try again"); return; }
    await refreshHorses();
    notify(done);
  };
  const iso = (d: string) => (d ? new Date(`${d}T12:00:00`).toISOString() : null);
  const pastDays = past.split(/[,\s]+/).map(Number).filter((n) => n >= 290 && n <= 440);
  // the first hours after foaling: stood within 1 h, nursed within 2 h, placenta within 3 h
  const fresh = Number.isFinite(bornMs) && now - bornMs <= 2 * DAY;
  const milestones = [
    ["foalStoodAt", "Foal stood"], ["foalNursedAt", "Foal nursed"], ["placentaAt", "Placenta passed"],
  ] as const;

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="flex center gap-sm"><Baby size={16} /> Foaling</h3>
        <span className={`pill ${state.pill}`}>{state.text}</span>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>{state.note}</p>
      {fresh && (
        <div style={{ margin: "0 0 12px" }}>
          <p style={{ fontSize: 12.5, margin: "0 0 6px" }}>
            The first hours: the foal standing within 1 h, nursing within 2 h, and the placenta out within 3 h.
            {horse.foaledTimeKnown ? " Missing ones call the chain at 2–3 h." : " Enter the time of birth so missing ones are called in time."}
          </p>
          <div className="flex wrap" style={{ gap: 8 }}>
            {milestones.map(([k, label]) => horse[k]
              ? <span key={k} className="pill ok">{label} · {hm(horse[k]!)}</span>
              : canEdit && <button key={k} className="btn-ghost" disabled={busy} onClick={() => save({ [k]: new Date().toISOString() } as Partial<Horse>, `${label} — recorded`)}>{label} now</button>)}
          </div>
        </div>
      )}
      {canEdit && (
        <div className="grid cols-2" style={{ gap: 10, alignItems: "end" }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="foal-covered">Covered on</label>
            <input id="foal-covered" type="date" value={covered} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setCovered(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="foal-past">Her past pregnancies, days (optional)</label>
            <input id="foal-past" placeholder="e.g. 348, 352" value={past} onChange={(e) => setPast(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="foal-due">Or a due date</label>
            <input id="foal-due" type="date" value={due} disabled={Boolean(covered)} onChange={(e) => setDue(e.target.value)} />
          </div>
          <button className="btn-ghost" disabled={busy}
            onClick={() => save({ coveredAt: iso(covered), pastGestationDays: pastDays, foalingDue: covered ? null : iso(due) },
              covered || due ? "Foaling dates saved" : "Foaling dates cleared")}>Save dates</button>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="foal-born">Foaled at (date and time)</label>
            <input id="foal-born" type="datetime-local" value={born} max={toLocalInput(new Date().toISOString())} onChange={(e) => setBorn(e.target.value)} />
          </div>
          <button className="btn-ghost" disabled={busy || born === toLocalInput(horse.foaledAt)}
            onClick={() => save(born ? { foaledAt: new Date(born).toISOString(), foaledTimeKnown: true } : { foaledAt: null, foaledTimeKnown: false },
              born ? "Foal recorded — mare-and-foal mode for 90 days" : "Cleared")}>
            {born ? "Foal born" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

/** The horse's own record that changes its alerts: species, arrival
 *  (isolation), standing colic risks, the 6-monthly check from 15. */
export function HorseRecordCard({ horse, canEdit }: { horse: Horse; canEdit: boolean }) {
  const notify = useToast();
  const { refreshHorses } = useStable();
  const [busy, setBusy] = useState(false);
  const save = async (patch: Partial<Horse>, done: string) => {
    setBusy(true);
    const r = await api.patchEntity("horses", horse.id, patch);
    setBusy(false);
    if (!r) { notify("Could not save — try again"); return; }
    await refreshHorses();
    notify(done);
  };
  const age = Number(String(horse.age).match(/\d+/)?.[0] ?? NaN);
  const flags = [
    ["cribBiter", "Crib-biter", "colic risk"], ["previousColic", "Had colic before", "colic risk"], ["dentalIssue", "Known dental problem", "colic and eating"],
  ] as const;
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="flex center gap-sm"><ClipboardList size={16} /> Health record</h3>
        <span className="sub">changes how {horse.name}&apos;s alerts judge</span>
      </div>
      <div className="grid cols-2" style={{ gap: 10 }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="rec-species">Animal</label>
          <select id="rec-species" disabled={!canEdit || busy} value={horse.species ?? "horse"}
            onChange={(e) => save({ species: e.target.value as Horse["species"] }, "Saved")}>
            <option value="horse">Horse</option><option value="mule">Mule</option><option value="donkey">Donkey</option>
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="rec-arrived">Arrived at the stable</label>
          <input id="rec-arrived" type="date" disabled={!canEdit || busy} defaultValue={horse.arrivedAt?.slice(0, 10) ?? ""}
            max={new Date().toISOString().slice(0, 10)}
            onBlur={(e) => e.target.value !== (horse.arrivedAt?.slice(0, 10) ?? "") &&
              save({ arrivedAt: e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null }, e.target.value ? "Arrival saved — 3 weeks of isolation checks" : "Cleared")} />
        </div>
      </div>
      <div className="flex wrap" style={{ gap: 14, marginTop: 10, fontSize: 13 }}>
        {flags.map(([k, label, why]) => (
          <label key={k} className="flex center" style={{ gap: 6 }} title={why}>
            <input type="checkbox" disabled={!canEdit || busy} checked={Boolean(horse[k])}
              onChange={(e) => save({ [k]: e.target.checked } as Partial<Horse>, `${label}: ${e.target.checked ? "yes" : "no"}`)} />
            {label}
          </label>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
        Ticked colic risks make a single colic sign enough to alert. A mule or donkey has a lower normal temperature and may not breathe faster in the heat.
      </p>
      {age >= 15 && (
        <div className="flex between center wrap" style={{ gap: 8, marginTop: 10, fontSize: 12.5 }}>
          <span>Aged {age}: teeth, coat, topline and feet every 6 months{horse.seniorCheckAt ? ` — last ${day(horse.seniorCheckAt)}` : " — none recorded"}.</span>
          {canEdit && <button className="btn-ghost" disabled={busy} onClick={() => save({ seniorCheckAt: new Date().toISOString() }, "6-monthly check recorded")}>Checked today</button>}
        </div>
      )}
    </div>
  );
}
