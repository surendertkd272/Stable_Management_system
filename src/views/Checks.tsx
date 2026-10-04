"use client";
// Health checks (server/care-api.mjs): every horse's body temperature by the
// thermal camera, the checks that are due (new arrivals in isolation, after a
// long journey, older horses, foals), the stable's care log — the changes the
// research ties to colic — and outbreak mode.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Trash2, ShieldAlert, Thermometer, ClipboardCheck } from "lucide-react";
import * as api from "../data/api";
import type { CarePage, CareHorse } from "../data/api";
import { useAuth } from "../auth";
import { useToast } from "../store";

const DAY = 24 * 3600 * 1000;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const nowLocal = () => {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function TempCell({ h }: { h: CareHorse }) {
  const t = h.temperature;
  if (t.value != null) {
    const raised = t.rise != null && t.within != null && t.rise >= Math.max(0.5, t.within);
    return (
      <span style={{ fontWeight: 700, color: t.fever ? "var(--alert)" : raised ? "var(--warn)" : undefined }}>
        {t.value.toFixed(1)} °C
        <small className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>
          {t.by === "camera" && t.rise != null ? `${t.rise >= 0 ? "+" : "−"}${Math.abs(t.rise).toFixed(1)} on its normal · ±${t.within}` : "body sensor"}
        </small>
      </span>
    );
  }
  if (t.learning) return <span className="muted">learning its normal · day {t.learnedDays ?? 0} of 3</span>;
  return <span className="muted">no eye reading in the last 30 min</span>;
}

export default function Checks() {
  const notify = useToast();
  const { user, authRequired } = useAuth();
  const isAdmin = !authRequired || user?.role === "admin";
  const [page, setPage] = useState<CarePage | null>(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ kind: "hay_change", horseId: "*", at: nowLocal(), hours: "", note: "" });
  const [ob, setOb] = useState({ disease: "", days: 28 });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api.carePage();
    if (r.ok) { setPage(r.data); setErr(""); } else setErr(r.error);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const logIt = async () => {
    setBusy(true);
    const r = await api.logCare({ kind: form.kind, horseId: form.horseId, at: new Date(form.at).toISOString(),
      ...(form.kind === "transport" ? { hours: Number(form.hours) } : {}), note: form.note });
    setBusy(false);
    if (!r.ok) { notify(r.details?.[0] ?? r.error); return; }
    notify(`Logged: ${r.data.label}`);
    setForm({ ...form, at: nowLocal(), hours: "", note: "" });
    load();
  };
  const remove = async (id: string) => {
    const r = await api.deleteCare(id);
    if (!r.ok) { notify(r.error); return; }
    load();
  };
  const outbreak = async (action: "start" | "case" | "end") => {
    setBusy(true);
    const r = await api.outbreakAction({ action, ...(action === "start" ? { disease: ob.disease, quarantineDays: ob.days } : {}) });
    setBusy(false);
    if (!r.ok) { notify(r.error); return; }
    setPage(r.data);
    notify(action === "start" ? "Outbreak mode on" : action === "case" ? "New case recorded — the quarantine countdown restarts" : "Outbreak mode ended");
  };

  if (err) return <div className="card">Could not load the health checks: {err}</div>;
  if (!page) return <div className="card"><Loader2 className="spin" size={18} /></div>;

  const o = page.outbreak;
  const left = o.active && o.lastCaseAt ? Math.ceil((Date.parse(o.lastCaseAt) + o.quarantineDays * DAY - Date.now()) / DAY) : null;
  const feverish = page.horses.filter((h) => h.temperature.fever);
  const checks = page.horses.flatMap((h) => h.checks.map((c) => ({ ...c, horse: h })))
    .sort((a, b) => (a.severity === "warn" ? 0 : 1) - (b.severity === "warn" ? 0 : 1));

  return (
    <>
      {/* outbreak mode */}
      <div className={o.active ? "row urgent" : "card"} style={{ marginBottom: 14, padding: 16, display: "block" }}>
        <div className="flex between center wrap" style={{ gap: 10 }}>
          <div className="flex center" style={{ gap: 8 }}>
            <ShieldAlert size={18} />
            <b>{o.active ? `Outbreak mode${o.disease ? ` · ${o.disease}` : ""}` : "Outbreak mode is off"}</b>
          </div>
          {o.active ? (
            <div className="flex wrap" style={{ gap: 8 }}>
              <button className="btn-ghost" disabled={busy} onClick={() => outbreak("case")}>New case today</button>
              {isAdmin && <button className="btn-ghost" disabled={busy} onClick={() => outbreak("end")}>End outbreak mode</button>}
            </div>
          ) : (
            <div className="flex wrap" style={{ gap: 8, alignItems: "end" }}>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="ob-disease">Disease, if known</label>
                <input id="ob-disease" placeholder="e.g. strangles" value={ob.disease} maxLength={60} onChange={(e) => setOb({ ...ob, disease: e.target.value })} />
              </div>
              <div className="field" style={{ margin: 0, width: 130 }}>
                <label htmlFor="ob-days">Quarantine, days</label>
                <input id="ob-days" type="number" min={7} max={120} value={ob.days} onChange={(e) => setOb({ ...ob, days: Number(e.target.value) })} />
              </div>
              <button className="btn-ghost" disabled={busy} onClick={() => outbreak("start")}>Start outbreak mode</button>
            </div>
          )}
        </div>
        <p style={{ fontSize: 12.5, margin: "8px 0 0" }}>
          {o.active
            ? `Since ${when(o.startedAt!)}. No horse moves in or out. ${left !== null && left > 0 ? `Quarantine can be lifted in ${left} day${left === 1 ? "" : "s"} if no new case appears` : "The quarantine period since the last case has passed — the vet can lift it"}. The thermal camera reads every horse's temperature through the day; check this page morning and evening.`
            : "For when the vet suspects an infection spreading (strangles, influenza, EHV): it stops movement, counts down the quarantine from the last new case, and puts the stable at the top of the Alerts page. Glanders, surra and equine infectious anaemia are notifiable: report through the Army veterinary chain."}
        </p>
      </div>

      {feverish.length >= 2 && (
        <div className="row urgent" style={{ marginBottom: 14, padding: "12px 16px" }}>
          <Thermometer size={16} /> <span><b>{feverish.map((h) => h.name).join(", ")}</b> show a fever by the thermal camera — several at once can mean an infection spreading. Keep them apart and call the vet.</span>
        </div>
      )}

      {/* temperatures */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <h3 className="flex center gap-sm"><Thermometer size={16} /> Body temperature, every horse</h3>
          <span className="sub">by the thermal camera · fever at {page.feverLine} °C</span>
        </div>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead><tr>{["Horse", "Stall", "Body temperature", "Read at"].map((h) => <th key={h} style={{ textAlign: "left", padding: "4px 6px", fontWeight: 600 }}>{h}</th>)}</tr></thead>
          <tbody>
            {page.horses.map((h) => (
              <tr key={h.id} style={{ borderTop: "1px solid var(--border, rgba(0,0,0,.06))", background: h.temperature.fever ? "var(--alert-soft, rgba(220,38,38,.06))" : undefined }}>
                <td style={{ padding: "6px" }}><Link href={`/horses/${encodeURIComponent(h.id)}`}>{h.name}</Link>{h.species !== "horse" && <small className="muted"> · {h.species}</small>}</td>
                <td style={{ padding: "6px" }}>{h.stall}</td>
                <td style={{ padding: "6px" }}><TempCell h={h} /></td>
                <td style={{ padding: "6px" }} className="muted">{h.temperature.at ? when(h.temperature.at) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
          Each horse&apos;s normal eye temperature is learned for every time of day over its last 14 days (3 days to start); body temperature is a resting
          horse&apos;s normal plus how far the eye is from that, allowing for the stall&apos;s warmth. The ± is how much that horse&apos;s eye wanders on ordinary days.
          A horse needs its head facing the camera for a reading — hay and water in view help.
        </p>
      </div>

      {/* due checks */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <h3 className="flex center gap-sm"><ClipboardCheck size={16} /> Checks due</h3>
          <span className="sub">{checks.length ? `${checks.length}` : "none"}</span>
        </div>
        {!checks.length && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Nothing due. New arrivals, long journeys, horses aged 15 and over, and newborn foals show here.</p>}
        <div style={{ display: "grid", gap: 8 }}>
          {checks.map((c, i) => (
            <div key={i} className={`row ${c.severity === "warn" ? "watch" : "calm"}`} style={{ padding: "10px 14px", alignItems: "flex-start" }}>
              <b style={{ minWidth: 110 }}><Link href={`/horses/${encodeURIComponent(c.horse.id)}`}>{c.horse.name}</Link></b>
              <span style={{ fontSize: 13 }}>{c.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* care log */}
      <div className="card">
        <div className="card-head">
          <h3>Care log</h3>
          <span className="sub">changes that raise colic and illness risk</span>
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
          A new batch of hay, a change of feed or work, a move, an arrival, a journey or a big change in the weather: for the next days
          (2 weeks for most) one colic sign is enough to alert, the horse&apos;s first nights after a move are left out of its normal, and
          an arrival starts 3 weeks of isolation checks. A journey of 20 hours or more starts a 7-day watch and a vet check at 24–48 h.
        </p>
        <div className="flex wrap" style={{ gap: 10, alignItems: "end", marginBottom: 14 }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="care-kind">What changed</label>
            <select id="care-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {page.kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="care-horse">Horse</label>
            <select id="care-horse" value={form.horseId} onChange={(e) => setForm({ ...form, horseId: e.target.value })}>
              <option value="*">All horses</option>
              {page.horses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="care-at">When</label>
            <input id="care-at" type="datetime-local" value={form.at} max={nowLocal()} onChange={(e) => setForm({ ...form, at: e.target.value })} />
          </div>
          {form.kind === "transport" && (
            <div className="field" style={{ margin: 0, width: 120 }}>
              <label htmlFor="care-hours">Hours on the road</label>
              <input id="care-hours" type="number" min={1} max={200} value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />
            </div>
          )}
          <div className="field grow" style={{ margin: 0, minWidth: 160 }}>
            <label htmlFor="care-note">Note</label>
            <input id="care-note" maxLength={200} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <button className="btn-primary" disabled={busy || (form.kind === "transport" && !form.hours)} onClick={logIt}><Plus size={15} /> Log it</button>
        </div>
        {!page.events.length && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Nothing logged yet.</p>}
        <div style={{ display: "grid", gap: 6 }}>
          {page.events.map((e) => (
            <div key={e.id} className="flex between center" style={{ gap: 10, fontSize: 13, borderTop: "1px solid var(--border, rgba(0,0,0,.06))", paddingTop: 6 }}>
              <span>
                <b>{e.label}</b>{e.hours ? ` · ${e.hours} h` : ""} · {e.horseName} · {when(e.at)}
                {e.note && <span className="muted"> — {e.note}</span>}
                <small className="muted"> · {e.by}</small>
              </span>
              {(isAdmin || e.by === user?.username) && (
                <button className="btn-ghost" title="Remove" onClick={() => remove(e.id)}><Trash2 size={14} /></button>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
