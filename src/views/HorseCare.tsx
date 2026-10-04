"use client";
// On the horse's page: how unusual the latest day was against the horse's own
// normal (0–10), and for a mare, her foaling dates — the window in which signs
// of labour raise "Foaling may be starting", and the 90 days after foaling
// when the camera sees two animals and single-horse notes are paused.
import { useState } from "react";
import { Baby } from "lucide-react";
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

export function FoalingCard({ horse, canEdit }: { horse: Horse; canEdit: boolean }) {
  const notify = useToast();
  const { refreshHorses } = useStable();
  const [due, setDue] = useState(horse.foalingDue?.slice(0, 10) ?? "");
  const [born, setBorn] = useState(horse.foaledAt?.slice(0, 10) ?? "");
  const [busy, setBusy] = useState(false);
  if (horse.sex !== "Mare" && !horse.foalingDue && !horse.foaledAt) return null;

  const now = Date.now();
  const dueMs = horse.foalingDue ? Date.parse(horse.foalingDue) : NaN;
  const bornMs = horse.foaledAt ? Date.parse(horse.foaledAt) : NaN;
  const state = Number.isFinite(bornMs) && now - bornMs <= 90 * DAY
    ? { pill: "ok", text: "Mare and foal", note: `Foaled ${day(horse.foaledAt!)}. With two animals in view, single-horse notes (lying, rolling, colic signs) are paused until ${day(new Date(bornMs + 90 * DAY).toISOString())}; temperature, breathing, people and heat still alert.` }
    : Number.isFinite(dueMs) && !horse.foaledAt && now >= dueMs - 30 * DAY && now <= dueMs + 30 * DAY
      ? { pill: "warn", text: "Foaling watch on", note: `Due ${day(horse.foalingDue!)}. Restlessness, lying down and getting up, rolling or eating less now raise “Foaling may be starting” and call the chain.` }
      : Number.isFinite(dueMs) && !horse.foaledAt && now < dueMs - 30 * DAY
        ? { pill: "muted", text: "Due date set", note: `Due ${day(horse.foalingDue!)}. The foaling watch starts 30 days before (${day(new Date(dueMs - 30 * DAY).toISOString())}).` }
        : { pill: "muted", text: "Not in foal", note: "Set a due date to watch for the start of foaling." };

  const save = async (patch: Partial<Horse>, done: string) => {
    setBusy(true);
    const r = await api.patchEntity("horses", horse.id, patch);
    setBusy(false);
    if (!r) { notify("Could not save — try again"); return; }
    await refreshHorses();
    notify(done);
  };
  const iso = (d: string) => (d ? new Date(`${d}T12:00:00`).toISOString() : null);

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="flex center gap-sm"><Baby size={16} /> Foaling</h3>
        <span className={`pill ${state.pill}`}>{state.text}</span>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>{state.note}</p>
      {canEdit && (
        <div className="flex wrap" style={{ gap: 10, alignItems: "end" }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="foal-due">Due date</label>
            <input id="foal-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <button className="btn-ghost" disabled={busy || due === (horse.foalingDue?.slice(0, 10) ?? "")}
            onClick={() => save({ foalingDue: iso(due) }, due ? "Due date saved" : "Due date cleared")}>Save</button>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="foal-born">Foaled on</label>
            <input id="foal-born" type="date" value={born} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBorn(e.target.value)} />
          </div>
          <button className="btn-ghost" disabled={busy || born === (horse.foaledAt?.slice(0, 10) ?? "")}
            onClick={() => save({ foaledAt: iso(born) }, born ? "Foal recorded — mare-and-foal mode for 90 days" : "Cleared")}>
            {born ? "Foal born" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
