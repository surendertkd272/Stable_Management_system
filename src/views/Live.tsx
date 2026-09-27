"use client";

// Live view — the camera's two pictures, refreshing, beside what the system is
// reading from them right now, with a practice-session timer that opens the
// session report for exactly that window.
//
// Pictures are snapshots (browsers cannot play RTSP), one picture every ~2 s,
// alternating thermal and colour — the edge agent reads the full video
// streams; this is only for people to watch.
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Play, Square, FileText, Loader2, CircleDot, Thermometer, Wind, Activity, Moon } from "lucide-react";
import Link from "next/link";
import * as api from "../data/api";
import { useStable } from "../store";

type Snap = { url?: string; error?: string; at?: number };
const SESSION_KEY = (cam: string) => `bsv-session-start:${cam}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ago = (iso?: string | null) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

export default function Live() {
  const { horses } = useStable();
  const [cams, setCams] = useState<api.ThermalCamera[] | null>(null);
  const [camId, setCamId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api.listDevices().then((r) => {
      if (!r.ok) return setError(r.error);
      const list = r.data.filter((d): d is api.ThermalCamera => d.kind === "thermal_camera");
      setCams(list);
      if (list[0]) setCamId(list[0].id);
    });
  }, []);
  const cam = cams?.find((c) => c.id === camId) ?? null;
  if (error) return <div className="card">Cannot list cameras: {error}</div>;
  if (!cams) return <div className="card"><Loader2 className="spin" size={18} /></div>;
  if (!cams.length) return <div className="card">No camera yet — add one on the <Link href="/hardware">Hardware</Link> page.</div>;
  return (
    <div>
      {cams.length > 1 && (
        <div className="tabs" style={{ marginBottom: 12 }}>
          {cams.map((c) => <button key={c.id} className={c.id === camId ? "on" : ""} onClick={() => setCamId(c.id)}>{c.name}</button>)}
        </div>
      )}
      {cam && <CameraLive key={cam.id} cam={cam} horse={horses.find((h) => h.stall === cam.stall) ?? null} />}
    </div>
  );
}

function CameraLive({ cam, horse }: { cam: api.ThermalCamera; horse: { id: string; name: string } | null }) {
  const [thermal, setThermal] = useState<Snap>({});
  const [colour, setColour] = useState<Snap>({});
  const [paused, setPaused] = useState(false);
  const [detail, setDetail] = useState<api.HorseDetail | null>(null);
  const [status, setStatus] = useState<api.DeviceStatus | null>(cam.status);
  const [start, setStart] = useState<string | null>(null);
  const [, tick] = useState(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    try { setStart(localStorage.getItem(SESSION_KEY(cam.id))); } catch { /* not remembered */ }
  }, [cam.id]);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  // Pictures: alternate thermal and colour, one every ~2 s; stop when hidden.
  useEffect(() => {
    let stop = false;
    (async () => {
      let which: 0 | 1 = 0;
      while (!stop && alive.current) {
        if (!paused && document.visibilityState === "visible") {
          const s = await api.fetchSnapshot(cam.id, which);
          if (stop) { if (s.url) URL.revokeObjectURL(s.url); break; }
          const set = which === 0 ? setThermal : setColour;
          set((prev) => {
            if (s.url && prev.url) URL.revokeObjectURL(prev.url);
            return s.url ? { url: s.url, at: Date.now() } : { ...prev, error: s.error };
          });
          which = which === 0 ? 1 : 0;
        }
        await sleep(1000);
      }
    })();
    return () => { stop = true; };
  }, [cam.id, paused]);

  // What the system is reading: the horse's latest vitals and behaviour.
  const load = useCallback(async () => {
    if (horse) { const d = await api.getHorseDetail(horse.id); if (alive.current && d) setDetail(d); }
    const r = await api.listDevices();
    if (r.ok && alive.current) setStatus(r.data.find((d) => d.id === cam.id)?.status ?? null);
  }, [horse, cam.id]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const begin = () => {
    const now = new Date().toISOString();
    try { localStorage.setItem(SESSION_KEY(cam.id), now); } catch { /* still shown */ }
    setStart(now);
  };
  const end = () => {
    try { localStorage.removeItem(SESSION_KEY(cam.id)); } catch { /* ignore */ }
    setStart(null);
  };
  const elapsed = start ? Math.floor((Date.now() - Date.parse(start)) / 1000) : 0;
  const v = detail?.vitals ?? {};
  const b = detail?.behaviour;
  const reportHref = horse ? `/session?horse=${encodeURIComponent(horse.id)}${start ? `&from=${encodeURIComponent(start)}` : ""}` : "/session";

  return (
    <>
      <div className="card" style={{ marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <div className="grow" style={{ minWidth: 220 }}>
          <b style={{ fontSize: 15 }}>{cam.name}</b> · stall {cam.stall}{horse ? ` · ${horse.name}` : " · no horse in this stall on the Horses page"}
          <div className="muted" style={{ fontSize: 12.5 }}>
            <CircleDot size={11} color={status?.state === "online" ? "var(--positive)" : "var(--warn)"} /> {status?.state ?? "?"} — {status?.detail}
            {" · "}{cam.record ? "recording video for the report" : "NOT recording (Hardware → edit camera → Record video)"}
            {" · "}behaviour from the {cam.behaviourStream === "thermal" ? "thermal" : "colour"} picture
          </div>
        </div>
        {start ? (
          <>
            <span className="pill ok">Session {Math.floor(elapsed / 3600)}:{String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</span>
            <Link className="btn-primary" href={reportHref}><FileText size={15} /> Report so far</Link>
            <button className="btn-ghost" onClick={end}><Square size={14} /> End session</button>
          </>
        ) : (
          <>
            <button className="btn-primary" onClick={begin}><Play size={15} /> Start practice session</button>
            <Link className="btn-ghost" href={reportHref}><FileText size={15} /> Last hour report</Link>
          </>
        )}
      </div>

      <div className="grid cols-2" style={{ gap: 14, alignItems: "start" }}>
        {([["Thermal", thermal], ["Colour", colour]] as const).map(([name, s]) => (
          <div key={name} className="card" style={{ padding: 12 }}>
            <div className="flex between center" style={{ marginBottom: 6 }}>
              <b style={{ fontSize: 13 }}><Camera size={13} /> {name}</b>
              <span className="muted" style={{ fontSize: 11.5 }}>{s.at ? `${Math.round((Date.now() - s.at) / 1000)} s ago` : ""}{s.error ? ` · ${s.error}` : ""}</span>
            </div>
            {s.url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={s.url} alt={`${name} camera`} style={{ width: "100%", borderRadius: 10, display: "block" }} />
              : <div className="hw-stage-empty">{s.error ? `No picture: ${s.error}` : <Loader2 className="spin" size={20} />}</div>}
          </div>
        ))}
      </div>
      <label className="hw-check" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} /> Pause the pictures (the system keeps measuring)
      </label>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><h3>What the system reads now</h3><span className="pill warn">behaviour: prototype</span></div>
        {!horse ? <p className="muted">Give a horse this camera&apos;s stall ({cam.stall}) on the Horses page to see its readings here.</p> : (
          <div className="hw-facts">
            <div><span><Thermometer size={13} /> Eye temperature</span><b>{v.body_temp_c ? `${v.body_temp_c.value.toFixed(1)} °C · ${ago(v.body_temp_c.ts)}${v.body_temp_c.calibrated === false ? " · not aimed" : ""}` : "not read yet — the head has not been in the thermal view"}</b></div>
            <div><span><Wind size={13} /> Breathing</span><b>{v.respiratory_rate_bpm ? `${Math.round(v.respiratory_rate_bpm.value)} /min · ${ago(v.respiratory_rate_bpm.ts)}${b?.breathing?.regularity != null ? ` · regularity ${b.breathing.regularity.toFixed(2)}` : ""}` : "no rate yet — needs 30 s with the head still"}</b></div>
            <div><span><Activity size={13} /> Activity</span><b>{v.activity_index ? `${v.activity_index.value.toFixed(2)} · ${ago(v.activity_index.ts)}` : "no reading yet"}</b></div>
            <div><span><Moon size={13} /> Resting</span><b>{b?.resting ? `lying ${b.resting.lyingTodayMin} min in 24 h, ${b.resting.bouts24h} bouts` : b?.inactive ? `still ${b.inactive.todayMin} min in 24 h · lying: learning` : "no reading yet"}</b></div>
            <div><span>Vices</span><b>{[b?.weaving && `weaving ${b.weaving.minutes24h ?? b.weaving.count24h} min`, b?.boxWalking && `box walking ${b.boxWalking.minutes24h} min`, b?.headTossing && `head tossing ${b.headTossing.minutes24h} min`].filter(Boolean).join(" · ") || "none seen"}</b></div>
            <div><span>Urination / manure</span><b>{`${b?.urination?.count24h ?? 0} / ${b?.excretion?.count24h ?? 0} in 24 h`}</b></div>
          </div>
        )}
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Readings arrive once a minute from the edge agent; this panel refreshes every 15 s.</p>
      </div>
    </>
  );
}
