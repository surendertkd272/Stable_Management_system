"use client";

// Session report — the 8 points over a window (a practice demo, a night),
// printable. Every point says what share of the window it covers; nothing
// measured is said plainly, never shown as zero.
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Printer, Loader2, Film, AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import * as api from "../data/api";
import { useStable } from "../store";

const PILL: Record<api.SessionPoint["status"], string> = {
  measured: "ok", prototype: "warn", learning: "muted", "none seen": "muted", "not measured": "alert", uncalibrated: "warn",
};
const hm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const toLocalInput = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
// The notes are kept in this browser only, per horse, until the next report.
const notesKey = (horse: string) => `equicare.reportNotes.${horse}`;
const readNotes = (horse: string) => { try { return localStorage.getItem(notesKey(horse)) || ""; } catch { return ""; } };
const keepNotes = (horse: string, v: string) => { try { localStorage.setItem(notesKey(horse), v); } catch { /* not kept */ } };

export default function Session() {
  const params = useSearchParams();
  const router = useRouter();
  const { horses } = useStable();
  const horseId = params.get("horse") || horses.find((h) => h.monitoring === "live")?.id || horses[0]?.id || "";
  const from = params.get("from") || undefined;
  const to = params.get("to") || undefined;
  const [rep, setRep] = useState<api.SessionReport | null>(null);
  const [err, setErr] = useState("");
  const [notes, setNotes] = useState("");
  const [building, setBuilding] = useState(false);
  const [reportErr, setReportErr] = useState("");
  useEffect(() => { if (horseId) setNotes(readNotes(horseId)); }, [horseId]);
  const clientReport = async () => {
    setBuilding(true);
    setReportErr("");
    const e = await api.openClientReport(horseId, rep?.window.from ?? from, to, notes);
    setBuilding(false);
    if (e) setReportErr(e);
  };
  useEffect(() => {
    if (!horseId) return;
    setRep(null);
    setErr("");
    api.getSession(horseId, from, to).then((r) => (r.ok ? setRep(r.data) : setErr(r.error)));
  }, [horseId, from, to]);
  const go = (p: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const next = { horse: horseId, from, to, ...p };
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    router.push(`/session?${q}`);
  };

  return (
    <div>
      <div className="card no-print" style={{ marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
        <div className="field" style={{ margin: 0, minWidth: 180 }}>
          <label>Horse</label>
          <select value={horseId} onChange={(e) => go({ horse: e.target.value })}>
            {horses.map((h) => <option key={h.id} value={h.id}>{h.name} · {h.stall}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>From</label>
          <input type="datetime-local" value={rep ? toLocalInput(rep.window.from) : ""} onChange={(e) => e.target.value && go({ from: new Date(e.target.value).toISOString() })} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>To</label>
          <input type="datetime-local" value={rep && to ? toLocalInput(rep.window.to) : ""} placeholder="now" onChange={(e) => go({ to: e.target.value ? new Date(e.target.value).toISOString() : undefined })} />
        </div>
        <button className="btn-ghost" onClick={() => go({ from: undefined, to: undefined })}>Last 60 min</button>
        <button className="btn-ghost" onClick={() => window.print()}><Printer size={15} /> Print this page</button>
        <button className="btn-primary" disabled={!rep || building} onClick={clientReport}>
          {building ? <Loader2 className="spin" size={15} /> : <FileText size={15} />} Client report
        </button>
      </div>
      <div className="card no-print" style={{ marginBottom: 14 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Notes from the stable for the client report (optional)</label>
          <textarea rows={3} maxLength={1400} value={notes} placeholder="What people saw: feeding times, visitors or handling in the stall, anything unusual…"
            onChange={(e) => { setNotes(e.target.value); keepNotes(horseId, e.target.value); }} />
          <small className="muted">
            The client report is built from the measurements for the window above — photos where the eye was in view, and plain
            statements of what was and was not captured. These notes are added as the stable&apos;s own. It opens in a new tab: use
            “Save as PDF” there.
          </small>
        </div>
        {reportErr && <p style={{ color: "var(--alert)", fontSize: 13, margin: "8px 0 0" }}>{reportErr}</p>}
      </div>

      {err && <div className="card">Could not build the report: {err}</div>}
      {!rep && !err && <div className="card"><Loader2 className="spin" size={18} /></div>}
      {rep && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <h3 style={{ marginTop: 0 }}>Session report · {rep.horse?.name} · stall {rep.horse?.stall}</h3>
            <p style={{ margin: "4px 0", fontSize: 13.5 }}>
              {new Date(rep.window.from).toLocaleString()} → {hm(rep.window.to)} ({rep.window.minutes} min). Camera data in{" "}
              <b>{rep.coverage.minutesWithData} of {rep.window.minutes} minutes ({rep.coverage.percent} %)</b>, {rep.coverage.readings} readings.
              {" "}{rep.footage.clips ? <>Video recorded: {rep.footage.clips} clips, {rep.footage.megabytes} MB.</> : <>No video recorded in this window.</>}
            </p>
            {rep.coverage.gaps.length > 0 && (
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                Gaps with no camera data: {rep.coverage.gaps.map((g) => `${hm(g.from)}–${hm(g.to)} (${g.minutes} min)`).join(", ")} — the horse out of view, or the camera/edge agent not running.
              </p>
            )}
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              Temperature and breathing come from the thermal view (head); activity, lying, vices and the floor from the colour
              picture. Behaviour measures are prototypes, not yet validated on horses — compare them with what someone watched.
            </p>
          </div>

          <div className="grid cols-2" style={{ gap: 12, marginBottom: 14 }}>
            {rep.points.map((p) => (
              <div key={p.n} className="card" style={{ padding: 16 }}>
                <div className="flex between center" style={{ marginBottom: 6 }}>
                  <b>{p.n}. {p.label}</b>
                  <span className={`pill ${PILL[p.status]}`}>{p.status}</span>
                </div>
                <p style={{ margin: "0 0 6px", fontSize: 13.5 }}>{p.summary}</p>
                {p.series && (
                  <div style={{ display: "flex", alignItems: "end", gap: 2, height: 36, margin: "6px 0" }} aria-label="activity per 5 minutes">
                    {p.series.map((s) => (
                      <div key={s.at} title={`${hm(s.at)}: ${s.avg ?? "no data"}`}
                        style={{ flex: 1, height: s.avg === null ? 2 : `${Math.max(4, Math.round(s.avg * 100))}%`, background: s.avg === null ? "var(--border)" : "var(--accent)", borderRadius: 2 }} />
                    ))}
                  </div>
                )}
                {p.methods && <p className="muted" style={{ fontSize: 11.5, margin: "0 0 4px" }}>How: {Object.entries(p.methods).map(([k, n]) => `${k} (${n})`).join(", ")}</p>}
                {p.notes?.map((n) => <p key={n} className="muted" style={{ fontSize: 11.5, margin: "0 0 2px" }}>{n}</p>)}
              </div>
            ))}
          </div>

          <div className="grid cols-2" style={{ gap: 12, alignItems: "start" }}>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Timeline</h3>
              {rep.timeline.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>No posture changes, vices or floor events detected.</p>
                : rep.timeline.map((e, i) => <div key={i} style={{ fontSize: 13, padding: "3px 0" }}><b>{hm(e.at)}</b> · {e.what}</div>)}
              {rep.footage.clips > 0 && (
                <p style={{ fontSize: 12.5, marginBottom: 0 }} className="no-print"><Film size={13} /> <Link href="/footage">Watch and label the recorded video</Link></p>
              )}
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Alerts and watch notes</h3>
              {rep.alerts.length === 0 ? <p className="muted" style={{ fontSize: 13 }}><CheckCircle2 size={13} /> None open.</p>
                : rep.alerts.map((a, i) => (
                  <div key={i} style={{ fontSize: 13, padding: "4px 0" }}>
                    <AlertTriangle size={12} color={a.severity === "alert" ? "var(--alert)" : "var(--warn)"} /> <b>{a.type}</b>
                    <div className="muted" style={{ fontSize: 12 }}>{a.detail}</div>
                  </div>
                ))}
              <h3>To verify</h3>
              <ul style={{ fontSize: 13, paddingLeft: 18, margin: 0 }}>{rep.verify.map((v) => <li key={v}>{v}</li>)}</ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
