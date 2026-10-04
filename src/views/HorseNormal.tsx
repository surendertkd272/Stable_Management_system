"use client";
// On the horse's page: the horse against its own normal (a baseline a vet can
// move), and gait checks done elsewhere — a phone trot-up app (RealHorse,
// Sleip) or a vet — entered by hand so they sit in the horse's record and
// reports.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Footprints, Info } from "lucide-react";
import * as api from "../data/api";
import type { BaselineCompare, BaselineRow } from "../data/api";
import { Modal } from "../components/ui";
import { useToast } from "../store";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmt = (r: BaselineRow, v: number | null) => (v === null ? "—" : r.unit.startsWith("%") ? `${Math.round(v)}%` : r.key === "activity" ? v.toFixed(2)
  : r.key === "eye" ? `${v.toFixed(1)} °C` : r.key === "breathing" ? `${v.toFixed(1)} /min` : `${Math.round(v)}`);
const change = (r: BaselineRow) => (r.change === null ? "—" : r.change === 0 ? "same"
  : `${r.change > 0 ? "▲" : "▼"} ${r.unit.startsWith("%") ? `${Math.abs(Math.round(r.change))} pts` : r.key === "activity" ? Math.abs(r.change).toFixed(2) : Math.abs(r.change).toFixed(1)}`);

export function NormalCard({ horseId, name, canEdit }: { horseId: string; name: string; canEdit: boolean }) {
  const notify = useToast();
  const [c, setC] = useState<BaselineCompare | null>(null);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const load = useCallback(() => api.getBaseline(horseId).then((r) => (r.ok ? setC(r.data) : setErr(r.error))), [horseId]);
  useEffect(() => { load(); }, [load]);
  const save = async (body: { from: string; to: string } | { reset: true }) => {
    const r = await api.setBaseline(horseId, body);
    if (!r.ok) { notify(r.details?.[0] ?? r.error); return; }
    setC(r.data); setEditing(false);
    notify("reset" in body ? "Back to the first days as the normal" : "Baseline set");
  };
  const rows = (c?.rows ?? []).filter((r) => r.baseline !== null || r.recent !== null);
  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-head">
        <h3>Compared with {name}&apos;s normal</h3>
        {canEdit && <button className="btn-ghost" onClick={() => { setEditing(true); setFrom(c?.window?.from?.slice(0, 10) ?? ""); setTo(c?.window?.to?.slice(0, 10) ?? ""); }}>Set baseline</button>}
      </div>
      {err && <p className="muted">{err}</p>}
      {c && (c.learning ? (
        <p className="muted" style={{ fontSize: 13 }}>Learning {name}&apos;s normal — it needs a day with at least 4 hours watched.</p>
      ) : !c.window?.set && c.baselineDays < 3 && !c.comparedDays ? (
        <p className="muted" style={{ fontSize: 13 }}>
          Learning {name}&apos;s normal: day {c.baselineDays} of 3. From day 4 each day is compared with these first days.
        </p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            Normal: {c.window ? `${day(c.window.from)} – ${day(c.window.to)}` : "—"} ({c.baselineDays} day{c.baselineDays === 1 ? "" : "s"}{c.window?.set ? `, set by ${c.window.by ?? "the stable"}` : ", its first days monitored"}).
            {c.comparedDays ? " Compared: the latest day." : " No day after the baseline yet."}
          </p>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead><tr>{["Measure", "Normal", "Latest day", "Change"].map((h, i) => <th key={h} style={{ textAlign: i ? "right" : "left", padding: "4px 6px", fontWeight: 600 }}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} style={{ borderTop: "1px solid var(--border, rgba(0,0,0,.06))" }}>
                  <td style={{ padding: "4px 6px" }}><Link href={`/guide#${r.pattern}`}>{r.label}</Link></td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmt(r, r.baseline)}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmt(r, r.recent)}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{r.notable ? <span className="pill warn">{change(r)}</span> : <span className="muted">{change(r)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <small className="muted" style={{ display: "block", marginTop: 6 }}><Info size={12} style={{ verticalAlign: -2 }} /> {c.note}</small>
        </>
      ))}
      {editing && (
        <Modal open onClose={() => setEditing(false)} title={`${name}'s normal`}
          footer={<>
            <button className="btn-ghost" onClick={() => save({ reset: true })}>Use the first days</button>
            <div className="grow" />
            <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn-primary" disabled={!from || !to} onClick={() => save({ from: new Date(`${from}T12:00`).toISOString(), to: new Date(`${to}T12:00`).toISOString() })}>Save</button>
          </>}>
          <p style={{ fontSize: 13, marginTop: 0 }}>Choose days when {name} was well and settled — not the first nights in a new stall, and not while ill. Days run noon to noon.</p>
          <div className="flex" style={{ gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label>From (noon)</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label>To (noon)</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

const GRADES = [["sound", "Sound"], ["mild", "Mild asymmetry"], ["moderate", "Moderate"], ["severe", "Severe"]] as const;
const LIMBS = [["", "—"], ["LF", "left fore"], ["RF", "right fore"], ["LH", "left hind"], ["RH", "right hind"]] as const;

export function GaitCheckButton({ horseId, name, onSaved }: { horseId: string; name: string; onSaved?: () => void }) {
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [g, setG] = useState({ at: new Date().toISOString().slice(0, 10), tool: "RealHorse", grade: "sound", limb: "", mm: "", note: "" });
  const save = async () => {
    const r = await api.addGaitCheck(horseId, { at: new Date(`${g.at}T12:00`).toISOString(), tool: g.tool, grade: g.grade,
      limb: g.limb || null, mm: g.mm === "" ? null : Number(g.mm), note: g.note });
    if (!r.ok) { notify(r.details?.[0] ?? r.error); return; }
    notify("Gait check added to the horse's record");
    setOpen(false);
    onSaved?.();
  };
  return (
    <>
      <button className="btn-ghost" onClick={() => setOpen(true)} title="A trot-up checked with a phone app (RealHorse, Sleip) or by a vet"><Footprints size={15} /> Add gait check</button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title={`Gait check · ${name}`}
          footer={<><button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
          <p style={{ fontSize: 13, marginTop: 0 }}>The stall camera does not see a trot. Enter a trot-up done with a phone app or by a vet — it appears in {name}&apos;s reports, marked as entered by the stable.</p>
          <div className="grid cols-2" style={{ gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label>Date</label><input type="date" value={g.at} onChange={(e) => setG({ ...g, at: e.target.value })} /></div>
            <div className="field" style={{ margin: 0 }}><label>Checked with</label>
              <select value={g.tool} onChange={(e) => setG({ ...g, tool: e.target.value })}>{["RealHorse", "Sleip", "vet", "other"].map((t) => <option key={t}>{t}</option>)}</select></div>
            <div className="field" style={{ margin: 0 }}><label>Result</label>
              <select value={g.grade} onChange={(e) => setG({ ...g, grade: e.target.value })}>{GRADES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="field" style={{ margin: 0 }}><label>Leg</label>
              <select value={g.limb} onChange={(e) => setG({ ...g, limb: e.target.value })}>{LIMBS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="field" style={{ margin: 0 }}><label>Asymmetry, mm (if the app gives it)</label><input type="number" min={0} max={200} step={0.1} value={g.mm} onChange={(e) => setG({ ...g, mm: e.target.value })} /></div>
            <div className="field" style={{ margin: 0 }}><label>Note</label><input value={g.note} maxLength={300} onChange={(e) => setG({ ...g, note: e.target.value })} /></div>
          </div>
        </Modal>
      )}
    </>
  );
}
