"use client";
// Accuracy checks: people count, the system measures, and the page says how
// closely they agree — the evidence a vet (or a client's vet corps) asks for.
// The system's own value is shown only after the person has answered, so it
// cannot lead them. Breathing is reported the way method studies do (bias and
// 95% limits of agreement, per reading and per night).
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, RotateCcw } from "lucide-react";
import * as api from "../data/api";
import type { Agreement, CheckMoment, HitRates } from "../data/api";
import { useStable, useToast } from "../store";

const STATES = [["lying", "Lying down"], ["eating", "Eating at the hay"], ["resting", "Standing at rest"], ["moving", "Moving about"]] as const;

export default function Validation() {
  const { horses } = useStable();
  const notify = useToast();
  const [horse, setHorse] = useState("");
  const [kind, setKind] = useState<"breathing" | "state">("breathing");
  const [moments, setMoments] = useState<CheckMoment[]>([]);
  const [i, setI] = useState(0);
  const [ticket, setTicket] = useState("");
  const [report, setReport] = useState<Agreement | null>(null);
  const [last, setLast] = useState<{ you: number | string; system: number | string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (!horse && horses.length) setHorse(horses[0].id); }, [horses, horse]);
  useEffect(() => { api.footageTicket().then((r) => r.ok && setTicket(r.data.ticket)); }, []);
  const loadReport = useCallback(() => { if (horse) api.validationReport(horse).then((r) => r.ok && setReport(r.data)); }, [horse]);
  useEffect(() => { loadReport(); }, [loadReport]);

  const sample = async () => {
    setLoading(true);
    const r = await api.validationSample(horse, kind, 10);
    setLoading(false);
    if (!r.ok) { notify(r.error); return; }
    setMoments(r.data); setI(0); setLast(null);
    if (!r.data.length) notify(kind === "breathing" ? "No measured breathing with video for this horse yet" : "No measured minutes with video for this horse yet");
  };
  const m = moments[i];
  const answer = async (payload: { breaths?: number; seconds?: number; state?: string }) => {
    if (!m) return;
    const r = await api.postValidation({ horse, camera: m.camera, at: m.at, kind, ...payload });
    if (!r.ok) { notify(r.details?.[0] ?? r.error); return; }
    setLast({ you: r.data.value, system: r.data.system });
    setI((x) => x + 1);
    loadReport();
  };

  return (
    <div>
      <AlertHitRates />
      <div className="card" style={{ marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
        <div className="field" style={{ margin: 0, minWidth: 180 }}>
          <label>Horse</label>
          <select value={horse} onChange={(e) => { setHorse(e.target.value); setMoments([]); }}>
            {horses.map((h) => <option key={h.id} value={h.id}>{h.name} · {h.stall}</option>)}
          </select>
        </div>
        <div className="tabs">
          <button className={kind === "breathing" ? "on" : ""} onClick={() => { setKind("breathing"); setMoments([]); }}>Count breaths</button>
          <button className={kind === "state" ? "on" : ""} onClick={() => { setKind("state"); setMoments([]); }}>Lying / eating / standing</button>
        </div>
        <button className="btn-primary" disabled={!horse || loading} onClick={sample}>
          {loading ? <Loader2 className="spin" size={15} /> : <Play size={15} />} 10 moments to check
        </button>
      </div>

      <div className="grid cols-2" style={{ gap: 14, alignItems: "start" }}>
        <div className="card" style={{ padding: 14 }}>
          {!m ? (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {moments.length ? "Done — thank you. Get 10 more, or read the agreement on the right." : "Get moments to check. Each is a clip of a minute the system measured; you answer without seeing its value."}
            </p>
          ) : (
            <>
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
                {i + 1} of {moments.length} · {new Date(m.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {m.stream === "thermal" ? "thermal" : "colour"} picture
              </div>
              {ticket && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video key={`${m.camera}${m.at}`} controls autoPlay muted playsInline style={{ width: "100%", borderRadius: 10, background: "#000" }}
                  src={api.clipUrl(ticket, { camera: m.camera, at: m.at, stream: m.stream, stall: m.stall, before: kind === "breathing" ? 0 : 10, after: kind === "breathing" ? 30 : 10 })} />
              )}
              {kind === "breathing" ? <BreathCounter onDone={(breaths, seconds) => answer({ breaths, seconds })} onSkip={() => setI((x) => x + 1)} />
                : (
                  <div className="flex" style={{ flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                    {STATES.map(([k, l]) => <button key={k} className="btn-ghost" onClick={() => answer({ state: k })}>{l}</button>)}
                    <button className="btn-ghost" onClick={() => setI((x) => x + 1)}>Can't tell — skip</button>
                  </div>
                )}
            </>
          )}
          {last && (
            <p style={{ fontSize: 13, marginBottom: 0 }}>
              Last answer: you <b>{String(last.you)}</b>{kind === "breathing" ? " /min" : ""} · the system <b>{last.system === null ? "—" : String(last.system)}</b>{kind === "breathing" && last.system !== null ? " /min" : ""}
            </p>
          )}
        </div>
        <AgreementCard r={report} />
      </div>
    </div>
  );
}

/** Tap once per breath while the clip plays (30 s), or type the count. */
function BreathCounter({ onDone, onSkip }: { onDone: (breaths: number, seconds: number) => void; onSkip: () => void }) {
  const [n, setN] = useState(0);
  const [start, setStart] = useState<number | null>(null);
  const [left, setLeft] = useState(30);
  const [typed, setTyped] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  const tap = () => {
    if (start === null) {
      const t0 = Date.now();
      setStart(t0); setN(1);
      timer.current = setInterval(() => {
        const l = 30 - Math.floor((Date.now() - t0) / 1000);
        setLeft(Math.max(0, l));
        if (l <= 0 && timer.current) clearInterval(timer.current);
      }, 250);
    } else if (left > 0) setN((x) => x + 1);
  };
  const reset = () => { if (timer.current) clearInterval(timer.current); setStart(null); setN(0); setLeft(30); };
  return (
    <div style={{ marginTop: 10 }}>
      <div className="flex" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn-primary" style={{ minWidth: 150 }} onClick={tap} disabled={start !== null && left <= 0}>
          {start === null ? "Tap at each breath" : left > 0 ? `Breath ${n} · ${left} s` : `${n} breaths in 30 s`}
        </button>
        <button className="btn-ghost" onClick={reset}><RotateCcw size={14} /></button>
        {start !== null && left <= 0 && <button className="btn-primary" onClick={() => { onDone(n, 30); reset(); }}>Save {n * 2} /min</button>}
      </div>
      <div className="flex" style={{ gap: 6, alignItems: "center", marginTop: 8, fontSize: 12.5 }}>
        <span className="muted">or type the breaths you counted over 30 s:</span>
        <input type="number" min={0} max={100} style={{ width: 64 }} value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button className="btn-ghost" disabled={typed === ""} onClick={() => { onDone(Number(typed), 30); setTyped(""); }}>Save</button>
        <button className="btn-ghost" onClick={onSkip}>Can't see the breathing — skip</button>
      </div>
    </div>
  );
}

function AgreementCard({ r }: { r: Agreement | null }) {
  if (!r) return <div className="card muted" style={{ padding: 14 }}>No checks yet.</div>;
  const b = r.breathing, s = r.state;
  return (
    <div className="card" style={{ padding: 14 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>How closely the system agrees with people</h3>
      {b ? (
        <>
          <b style={{ fontSize: 13 }}>Breathing ({b.n} checks{b.enough ? "" : " — 30+ needed before quoting it"})</b>
          <table style={{ width: "100%", fontSize: 13, marginTop: 6 }}><tbody>
            <tr><td>Average difference (system − people)</td><td className="num">{b.bias > 0 ? "+" : ""}{b.bias} /min</td></tr>
            <tr><td>95% of readings within</td><td className="num">{b.limits[0]} to {b.limits[1]} /min</td></tr>
            <tr><td>Typical miss (mean absolute)</td><td className="num">{b.mae} /min</td></tr>
            <tr><td>Within ±2 /min</td><td className="num">{b.within2}%</td></tr>
            {b.nightMae !== null && <tr><td>Night median, typical miss ({b.nights} nights)</td><td className="num">{b.nightMae} /min</td></tr>}
          </tbody></table>
        </>
      ) : <p className="muted" style={{ fontSize: 13 }}>No breathing checks yet.</p>}
      {s ? (
        <>
          <b style={{ fontSize: 13, display: "block", marginTop: 12 }}>Lying / eating / standing ({s.n} checks{s.enough ? "" : " — 50+ needed before quoting it"})</b>
          <p style={{ fontSize: 13, margin: "4px 0" }}>Agreed on {s.agree}% of moments.</p>
          <table style={{ width: "100%", fontSize: 12 }}>
            <thead><tr><th>People said ↓ / system said →</th>{STATES.map(([k]) => <th key={k}>{k}</th>)}</tr></thead>
            <tbody>{STATES.map(([k]) => <tr key={k}><td>{k}</td>{STATES.map(([j]) => <td key={j} className="num">{s.table[k]?.[j] ?? 0}</td>)}</tr>)}</tbody>
          </table>
        </>
      ) : <p className="muted" style={{ fontSize: 13 }}>No lying / eating / standing checks yet.</p>}
      <small className="muted" style={{ display: "block", marginTop: 10 }}>{r.note}</small>
    </div>
  );
}

/** How often each kind of alert was right, from staff's marks on the Alerts
 *  page — what decides which alerts to trust, and when to end a silent trial. */
function AlertHitRates() {
  const [h, setH] = useState<HitRates | null>(null);
  useEffect(() => { api.hitRates().then((r) => r.ok && setH(r.data)); }, []);
  if (!h) return null;
  const trial = h.trialUntil && Date.parse(h.trialUntil) > Date.now();
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <h3>How often each alert was right</h3>
        <span className="sub">{trial ? `silent trial until ${new Date(h.trialUntil!).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "from staff's marks on the Alerts page"}</span>
      </div>
      {!h.types.length ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          No alerts marked yet. On the Alerts page, after looking at the horse, mark each alert right or wrong — the share that were right shows here per kind.
        </p>
      ) : (
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead><tr>{["Alert", "Right", "Wrong", "Unsure", "Right, of those judged"].map((x, i) => <th key={x} style={{ textAlign: i ? "right" : "left", padding: "4px 6px", fontWeight: 600 }}>{x}</th>)}</tr></thead>
          <tbody>
            {h.types.map((t) => (
              <tr key={t.type} style={{ borderTop: "1px solid var(--border, rgba(0,0,0,.06))" }}>
                <td style={{ padding: "4px 6px" }}>{t.type}</td>
                <td style={{ padding: "4px 6px", textAlign: "right" }}>{t.right}</td>
                <td style={{ padding: "4px 6px", textAlign: "right" }}>{t.wrong}</td>
                <td style={{ padding: "4px 6px", textAlign: "right" }} className="muted">{t.unsure}</td>
                <td style={{ padding: "4px 6px", textAlign: "right" }}>
                  {t.rate === null ? "—" : <b style={{ color: t.judged < 10 ? undefined : t.rate >= 70 ? "var(--positive)" : t.rate < 40 ? "var(--alert)" : "var(--warn)" }}>{t.rate}%</b>}
                  {t.judged > 0 && t.judged < 10 && <small className="muted"> · only {t.judged}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
