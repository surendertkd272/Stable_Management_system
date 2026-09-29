"use client";

// Live view — the camera's two pictures, refreshing, beside what the system is
// reading from them right now, with a practice-session timer that opens the
// session report for exactly that window.
//
// Pictures are live video: browsers cannot play RTSP, so the site server turns
// the camera's streams into JPEG frames (server/live-video.mjs), well under a
// second behind. Where that is not available the page shows a snapshot every
// couple of seconds instead. Only for people to watch: the edge agent reads
// the video itself.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Play, Square, FileText, Loader2, CircleDot, Thermometer, Wind, Activity, Moon } from "lucide-react";
import Link from "next/link";
import * as api from "../data/api";
import { useStable } from "../store";
import { ZoomImage, WHOLE, type ZoomView } from "../components/Zoom";

type Snap = { url?: string; error?: string; at?: number; live?: boolean };
const SESSION_KEY = (cam: string) => `bsv-session-start:${cam}`;
const SESSION_STALE_MS = 24 * 3600 * 1000;
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
      // Open the camera that is working: a camera replaced by another one
      // stays listed (switched off) for its history.
      const on = list.filter((c) => c.enabled !== false);
      const pick = on.find((c) => c.status?.state === "online") ?? on[0] ?? list[0];
      if (pick) setCamId(pick.id);
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

/** One of the camera's two pictures: live video while the server can give it,
 *  otherwise a snapshot every couple of seconds (and live video tried again
 *  now and then). Its own component, so 25 frames a second redraw only it. */
function LivePicture({ camId, name, paused, view, onView }: {
  camId: string; name: "Thermal" | "Colour"; paused: boolean; view: ZoomView; onView: (v: ZoomView) => void;
}) {
  const [snap, setSnap] = useState<Snap>({});
  useEffect(() => {
    if (paused) return;
    const ctl = new AbortController();
    const which = name === "Thermal" ? "thermal" : "colour";
    let shown: string | undefined;
    const show = (url: string, live: boolean) => {
      setSnap({ url, at: Date.now(), live });
      if (shown) URL.revokeObjectURL(shown);
      shown = url;
    };
    (async () => {
      let liveAgainAt = 0;
      while (!ctl.signal.aborted) {
        if (document.visibilityState !== "visible") { await sleep(1000); continue; }
        if (Date.now() >= liveAgainAt) {
          const n = await api.readLive(camId, which, ctl.signal, (jpeg) => show(URL.createObjectURL(jpeg), true));
          if (ctl.signal.aborted) break;
          // The stream ended after showing video: reconnect. No video at all:
          // snapshots for a while before trying again.
          if (n > 0) { await sleep(500); continue; }
          liveAgainAt = Date.now() + 15000;
        }
        const s = await api.fetchSnapshot(camId, which === "thermal" ? 0 : 1);
        if (ctl.signal.aborted) { if (s.url) URL.revokeObjectURL(s.url); break; }
        if (s.url) show(s.url, false);
        else setSnap((prev) => ({ ...prev, error: s.error }));
        await sleep(2000);
      }
    })();
    return () => ctl.abort();
  }, [camId, name, paused]);

  const age = snap.at ? Math.round((Date.now() - snap.at) / 1000) : null;
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="flex between center" style={{ marginBottom: 6 }}>
        <b style={{ fontSize: 13 }}><Camera size={13} /> {name}</b>
        <span className="muted" style={{ fontSize: 11.5 }}>
          {snap.live && age !== null && age < 3 ? <><CircleDot size={11} style={{ color: "var(--danger, #d33)" }} /> live</> : age !== null ? `${age} s ago` : ""}
          {snap.error ? ` · ${snap.error}` : ""}
        </span>
      </div>
      {snap.url
        ? <ZoomImage src={snap.url} alt={`${name} camera`} view={view} onView={onView} />
        : <div className="hw-stage-empty">{snap.error ? `No picture: ${snap.error}` : <Loader2 className="spin" size={20} />}</div>}
    </div>
  );
}

function CameraLive({ cam, horse }: { cam: api.ThermalCamera; horse: { id: string; name: string } | null }) {
  const [paused, setPaused] = useState(false);
  // Zoom: one view for both pictures (they show about the same area), unless unlinked.
  const [linked, setLinked] = useState(true);
  const [views, setViews] = useState<{ Thermal: ZoomView; Colour: ZoomView }>({ Thermal: WHOLE, Colour: WHOLE });
  const setView = useCallback((name: "Thermal" | "Colour") => (v: ZoomView) =>
    setViews((prev) => (linked ? { Thermal: v, Colour: v } : { ...prev, [name]: v })), [linked]);
  const onThermal = useMemo(() => setView("Thermal"), [setView]);
  const onColour = useMemo(() => setView("Colour"), [setView]);
  const [detail, setDetail] = useState<api.HorseDetail | null>(null);
  const [status, setStatus] = useState<api.DeviceStatus | null>(cam.status);
  const [start, setStart] = useState<string | null>(null);
  const [, tick] = useState(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    try {
      // A start from over a day ago is an earlier session left running, not
      // this one: drop it, so its report is not mixed into the next.
      const s = localStorage.getItem(SESSION_KEY(cam.id));
      if (s && !(Date.now() - Date.parse(s) < SESSION_STALE_MS)) localStorage.removeItem(SESSION_KEY(cam.id));
      else setStart(s);
    } catch { /* not remembered */ }
  }, [cam.id]);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

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
          {status?.warnings?.map((w) => (
            <div key={w} style={{ fontSize: 12.5, color: "var(--warn)", marginTop: 2 }}>⚠ {w}</div>
          ))}
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
        {(["Thermal", "Colour"] as const).map((name) => (
          <LivePicture key={name} camId={cam.id} name={name} paused={paused}
            view={views[name]} onView={name === "Thermal" ? onThermal : onColour} />
        ))}
      </div>
      <div className="flex" style={{ flexWrap: "wrap", gap: "4px 18px", marginTop: 8 }}>
        <label className="hw-check">
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} /> Pause the pictures (the system keeps measuring)
        </label>
        <label className="hw-check">
          <input type="checkbox" checked={linked} onChange={(e) => { setLinked(e.target.checked); if (e.target.checked) setViews((p) => ({ Thermal: p.Colour, Colour: p.Colour })); }} />
          Zoom both pictures together
        </label>
      </div>
      <p className="muted" style={{ fontSize: 11.5, margin: "4px 0 0" }}>
        Zoom: scroll or pinch on a picture (or use +), drag to move, double-click to zoom in. Zooming changes only this view — not what is
        recorded or measured.
      </p>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><h3>What the system reads now</h3><span className="pill warn">behaviour: prototype</span></div>
        {!horse ? <p className="muted">Give a horse this camera&apos;s stall ({cam.stall}) on the Horses page to see its readings here.</p> : (
          <div className="hw-facts">
            <div><span><Thermometer size={13} /> Eye temperature</span><b>{v.body_temp_c ? `${v.body_temp_c.value.toFixed(1)} °C · ${ago(v.body_temp_c.ts)}${v.body_temp_c.calibrated === false ? " · not aimed" : ""}` : "not read yet — the head has not been in the thermal view"}</b></div>
            <div><span><Wind size={13} /> Breathing</span><b>{v.respiratory_rate_bpm ? `${Math.round(v.respiratory_rate_bpm.value)} /min · ${ago(v.respiratory_rate_bpm.ts)}${b?.breathing?.regularity != null ? ` · regularity ${b.breathing.regularity.toFixed(2)}` : ""}` : "no rate yet — needs 30 s with the head still"}
              {v.breathing_check && v.breathing_check.value === 0 && v.breathing_check.detail && (!v.respiratory_rate_bpm || v.breathing_check.ts > v.respiratory_rate_bpm.ts) && (
                <span className="muted" style={{ display: "block", fontWeight: 400, fontSize: 12 }}>last minute: no rate — {v.breathing_check.detail} ({ago(v.breathing_check.ts)})</span>
              )}</b></div>
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
