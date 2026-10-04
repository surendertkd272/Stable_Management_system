"use client";
// One camera, several stalls: set up a camera that watches two (or more)
// horses at once — zoomed out for everyone's behaviour, zoomed in on each
// horse's head in turn for its eye temperature, breathing and face.
//
//   1. Zoom control: ONVIF (moves and zooms both lenses), or a fixed camera.
//   2. Wide view: move the camera so every stall is in the picture, save the
//      position, and draw each stall on the colour and thermal pictures
//      (plus its hay and floor, optional).
//   3. A close-up per horse: zoom onto the head, save, draw eye and nostril.
//   4. How often to zoom in. Save: the edge box runs it (edge/multistall.py).
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import * as api from "../data/api";
import type { PtzProfile, RoiBox, ThermalCamera, ZoomSetup as Setup, ZoomView, ZoomZone } from "../data/api";
import { Modal } from "../components/ui";
import { SetupChecklist, failing } from "./SetupChecklist";
import { useToast } from "../store";

type Snap = { url?: string; error?: string };
type Lens = "both" | "colour" | "thermal";
type DrawKey = "colour" | "thermal" | "hay" | "colourFloor" | "floor" | "eye" | "nostril";
const ON_THERMAL: DrawKey[] = ["thermal", "floor", "eye", "nostril"];
const LABEL: Record<DrawKey, string> = {
  colour: "stall area", thermal: "stall area", hay: "hay", colourFloor: "floor · manure & wet bedding",
  floor: "floor · warm patches", eye: "eye · hottest", nostril: "nostril · breathing",
};

const empty = (cam: ThermalCamera): Setup => ({
  ptz: { protocol: "onvif", port: cam.httpPort || 80 },
  schedule: { closeEveryMin: 5 },
  views: [{ id: "wide", kind: "wide", position: null, zones: [{ stall: cam.stall, colour: { x0: 0, y0: 0, x1: 5000, y1: 10000 } }] }],
});

export default function ZoomSetupModal({ cam, stalls, onClose }: { cam: ThermalCamera; stalls: string[]; onClose: () => void }) {
  const notify = useToast();
  const [setup, setSetup] = useState<Setup>(() => empty(cam));
  const [tab, setTab] = useState<string>("wide");                    // "wide" | "close:<stall>"
  const [zoneIdx, setZoneIdx] = useState(0);
  const [draw, setDraw] = useState<DrawKey>("colour");
  const [profiles, setProfiles] = useState<PtzProfile[]>([]);
  const [lensOf, setLensOf] = useState<{ colour: string; thermal: string }>({ colour: "", thermal: "" });
  const [lens, setLens] = useState<Lens>("both");
  const [ptzError, setPtzError] = useState("");
  const [thermal, setThermal] = useState<Snap | null>(null);
  const [colour, setColour] = useState<Snap | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // what is stored already
  useEffect(() => {
    api.getZoomSetup(cam.id).then((r) => {
      if (r.ok && alive.current && r.data.views?.length) setSetup({ ptz: r.data.ptz, views: r.data.views, schedule: r.data.schedule });
    });
  }, [cam.id]);

  const swap = (set: (fn: (s: Snap | null) => Snap | null) => void, next: Snap) =>
    set((prev) => {
      if (prev?.url && next.url && prev.url !== next.url) URL.revokeObjectURL(prev.url);
      return next.url ? next : { ...prev, error: next.error };
    });
  const refresh = useCallback(async () => {
    const t = await api.fetchSnapshot(cam.id, 0);
    if (alive.current) swap(setThermal, t);
    const v = await api.fetchSnapshot(cam.id, 1);
    if (alive.current) swap(setColour, v);
  }, [cam.id]);
  useEffect(() => { refresh(); const t = setInterval(refresh, 2500); return () => clearInterval(t); }, [refresh]);

  // ---- zoom control ------------------------------------------------------- //
  const zooms = setup.ptz !== null;
  const connect = async () => {
    setPtzError("");
    const r = await api.ptzInfo(cam.id);
    if (!r.ok) { setPtzError(r.error); return; }
    const ps = r.data.profiles.filter((p) => p.ptz);
    setProfiles(r.data.profiles);
    const find = (re: RegExp) => ps.find((p) => re.test(`${p.name} ${p.source}`))?.token;
    setLensOf({
      colour: find(/colou?r|visible|optical|main|1$/i) || ps[0]?.token || "",
      thermal: find(/therm|ir|lwir|2$/i) || ps[1]?.token || ps[0]?.token || "",
    });
    if (!ps.length) setPtzError("the camera answers, but none of its streams can be moved or zoomed over ONVIF");
  };
  const lenses = (): string[] => {
    const l = lens === "both" ? [lensOf.colour, lensOf.thermal] : [lensOf[lens]];
    return [...new Set(l.filter(Boolean))];
  };
  const nudge = async (pan: number, tilt: number, zoom: number) => {
    if (!lenses().length) { setPtzError("connect to the zoom control first"); return; }
    setBusy(true);
    for (const p of lenses()) {
      const r = await api.ptzAction(cam.id, { action: "nudge", profile: p, pan, tilt, zoom, seconds: 0.35 });
      if (!r.ok) { setPtzError(r.error); break; }
    }
    setBusy(false);
    refresh();
  };
  /** Saves where each lens is now as a preset on the camera; the view keeps the tokens. */
  const savePosition = async () => {
    const both = [...new Set([lensOf.colour, lensOf.thermal].filter(Boolean))];
    if (!both.length) { setPtzError("connect to the zoom control first"); return; }
    setBusy(true);
    const moves: api.PtzMove[] = [];
    for (const p of both) {
      const name = `EquiCare ${tab === "wide" ? "wide" : tab.replace("close:", "close ")}`.slice(0, 40);
      const r = await api.ptzAction(cam.id, { action: "save", profile: p, name });
      if (!r.ok || !r.data.token) { setPtzError(r.ok ? "the camera did not return a preset number" : r.error); setBusy(false); return; }
      moves.push({ profile: p, preset: r.data.token });
    }
    setBusy(false);
    setView(tab, (v) => ({ ...v, position: { moves, settleS: 4 } }));
    notify(`Position saved for the ${tab === "wide" ? "wide view" : `close-up of stall ${tab.slice(6)}`}`);
  };
  const goTo = async (v: ZoomView) => {
    if (!v.position?.moves.length) return;
    setBusy(true);
    for (const m of v.position.moves) {
      const r = m.preset ? await api.ptzAction(cam.id, { action: "goto", profile: m.profile, preset: m.preset })
        : await api.ptzAction(cam.id, { action: "absolute", profile: m.profile, pan: m.pan ?? undefined, tilt: m.tilt ?? undefined, zoom: m.zoom ?? undefined });
      if (!r.ok) { setPtzError(r.error); break; }
    }
    setBusy(false);
    setTimeout(refresh, 1500);
  };

  // ---- the views ---------------------------------------------------------- //
  const wide = setup.views.find((v) => v.kind === "wide") as Extract<ZoomView, { kind: "wide" }>;
  const zones = wide?.zones ?? [];
  const view = setup.views.find((v) => v.id === tab) ?? wide;
  const setView = (id: string, fn: (v: ZoomView) => ZoomView) =>
    setSetup((s) => ({ ...s, views: s.views.map((v) => (v.id === id ? fn(v) : v)) }));
  const setZone = (i: number, fn: (z: ZoomZone) => ZoomZone) =>
    setView("wide", (v) => (v.kind === "wide" ? { ...v, zones: v.zones.map((z, k) => (k === i ? fn(z) : z)) } : v));
  const addStall = () => {
    const used = new Set(zones.map((z) => z.stall));
    const next = stalls.find((s) => !used.has(s)) ?? `stall ${zones.length + 1}`;
    setView("wide", (v) => (v.kind === "wide" ? { ...v, zones: [...v.zones, { stall: next, colour: { x0: 5000, y0: 0, x1: 10000, y1: 10000 } }] } : v));
    setZoneIdx(zones.length);
  };
  const removeStall = (i: number) => {
    const stall = zones[i]?.stall;
    setSetup((s) => ({ ...s, views: s.views.filter((v) => !(v.kind === "close" && v.stall === stall))
      .map((v) => (v.kind === "wide" ? { ...v, zones: v.zones.filter((_, k) => k !== i) } : v)) }));
    setZoneIdx(0);
  };
  const addClose = (stall: string) => {
    const id = `close:${stall}`;
    if (!setup.views.some((v) => v.id === id))
      setSetup((s) => ({ ...s, views: [...s.views, { id, kind: "close", stall, position: null,
        rois: { eye: { x0: 4300, y0: 3300, x1: 5300, y1: 4100 }, nostril: { x0: 4500, y0: 6800, x1: 5700, y1: 7800 } } }] }));
    setTab(id);
    setDraw("eye");
  };

  // the box being drawn, and every box shown on each picture
  const zone = zones[zoneIdx];
  const boxesFor = (picture: "colour" | "thermal"): { key: string; box: RoiBox; label: string; active: boolean; kind: string }[] => {
    const out = [];
    if (view.kind === "wide") {
      zones.forEach((z, i) => {
        const area = picture === "colour" ? z.colour : z.thermal;
        if (area) out.push({ key: `${i}:${picture}`, box: area, label: `stall ${z.stall}`, active: i === zoneIdx && draw === picture, kind: "stall" });
        const r = z.rois || {};
        const keys: DrawKey[] = picture === "colour" ? ["hay", "colourFloor"] : ["floor"];
        for (const k of keys) {
          const b = r[k as "hay" | "colourFloor" | "floor"];
          if (b) out.push({ key: `${i}:${k}`, box: b, label: `${z.stall} · ${LABEL[k]}`, active: i === zoneIdx && draw === k, kind: "floor" });
        }
      });
    } else if (picture === "thermal") {
      for (const k of ["eye", "nostril"] as const) {
        const b = view.rois[k];
        if (b) out.push({ key: k, box: b, label: LABEL[k], active: draw === k, kind: k === "eye" ? "eye" : "" });
      }
    }
    return out;
  };
  const drawingOn = (picture: "colour" | "thermal") => (ON_THERMAL.includes(draw) ? "thermal" : "colour") === picture;
  const onBox = (b: RoiBox) => {
    if (view.kind === "close") setView(view.id, (v) => (v.kind === "close" ? { ...v, rois: { ...v.rois, [draw]: b } } : v));
    else if (zone) setZone(zoneIdx, (z) => (draw === "colour" ? { ...z, colour: b } : draw === "thermal" ? { ...z, thermal: b } : { ...z, rois: { ...z.rois, [draw]: b } }));
  };

  // What must be in place before saving (static), and the live check of the
  // close-up the camera is at (eye and nostril on the horse's head).
  const [live, setLive] = useState<{ items: api.SetupItem[]; ready: boolean; at: string } | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const runLive = async () => {
    if (view.kind !== "close") return;
    setLiveBusy(true);
    const r = await api.setupChecklist(cam.id, { eye: view.rois.eye, nostril: view.rois.nostril });
    setLiveBusy(false);
    if (r.ok) setLive(r.data); else notify(`Setup check: ${r.error}`);
  };
  useEffect(() => { setLive(null); }, [tab]);
  const staticItems: api.SetupItem[] = [
    ...(zooms ? [{ key: "wide", label: "Wide view position saved", ok: Boolean(wide?.position?.moves.length), required: true, detail: wide?.position?.moves.length ? "saved" : "zoom out so every stall is in view, then save the position" }] : []),
    ...zones.map((z) => ({ key: `zone-${z.stall}`, label: `Stall ${z.stall} drawn on the colour picture`, ok: Boolean(z.colour), required: true, detail: z.colour ? "drawn" : "draw it" })),
    ...zones.map((z) => ({ key: `zt-${z.stall}`, label: `Stall ${z.stall} drawn on the thermal picture`, ok: Boolean(z.thermal), required: false, detail: z.thermal ? "drawn" : "optional — needed for warm floor patches" })),
    ...(zooms ? zones.map((z) => {
      const v = setup.views.find((x) => x.kind === "close" && x.stall === z.stall);
      const ok = Boolean(v && v.position?.moves.length && v.kind === "close" && v.rois.eye);
      return { key: `close-${z.stall}`, label: `Close-up of ${z.stall}: position saved, eye box drawn`, ok, required: false,
        detail: ok ? "ready" : "without it this horse has no eye temperature or nostril breathing" };
    }) : []),
  ];
  const save = async () => {
    const missing = staticItems.filter((i) => i.required && !i.ok);
    if (missing.length && !confirm(`Not ready yet:\n${failing(missing)}\n\nSave anyway?`)) return;
    setErrors([]);
    setBusy(true);
    const r = await api.putZoomSetup(cam.id, setup);
    setBusy(false);
    if (!r.ok) { setErrors(r.details?.length ? r.details : [r.error]); return; }
    notify("Saved — the edge box starts watching each stall within a minute");
    onClose();
  };
  const remove = async () => {
    if (!confirm("Remove the several-stall setup? The camera goes back to watching its own stall only.")) return;
    const r = await api.deleteZoomSetup(cam.id);
    if (r.ok) { notify("Back to one stall"); onClose(); } else setErrors([r.error]);
  };

  const drawKeys: DrawKey[] = view.kind === "wide" ? ["colour", "thermal", "hay", "colourFloor", "floor"] : ["eye", "nostril"];
  return (
    <Modal open onClose={onClose} wide title={`Several stalls · ${cam.name}`}
      footer={
        <>
          {cam.views?.length ? <button className="btn-ghost" onClick={remove}>Back to one stall</button> : null}
          <div className="grow" />
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy} onClick={save}>Save setup</button>
        </>
      }>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        One camera, a report for each horse. Zoomed out it follows every horse&apos;s behaviour; every few minutes it zooms onto one
        horse&apos;s head for eye temperature, breathing and face recognition. A camera without zoom that sees two stalls works too —
        choose <b>Fixed camera</b> and draw the stalls.
      </p>

      {/* 1. zoom control */}
      <div className="card" style={{ padding: 12, marginBottom: 10 }}>
        <div className="flex" style={{ flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <b style={{ fontSize: 13 }}>Zoom control</b>
          <select value={zooms ? "onvif" : "none"} onChange={(e) => setSetup((s) => ({ ...s, ptz: e.target.value === "none" ? null : { protocol: "onvif", port: s.ptz?.port ?? 80 } }))}>
            <option value="onvif">Moves and zooms (ONVIF)</option>
            <option value="none">Fixed camera (no zoom)</option>
          </select>
          {zooms && (
            <>
              <label className="muted" style={{ fontSize: 12.5 }}>port <input type="number" style={{ width: 70 }} value={setup.ptz!.port}
                onChange={(e) => setSetup((s) => ({ ...s, ptz: { ...s.ptz!, port: Number(e.target.value) } }))} /></label>
              <button className="btn-ghost" onClick={connect}>Connect</button>
              {profiles.length > 0 && (
                <span className="muted" style={{ fontSize: 12.5 }}>
                  colour lens <select value={lensOf.colour} onChange={(e) => setLensOf((l) => ({ ...l, colour: e.target.value }))}>
                    {profiles.filter((p) => p.ptz).map((p) => <option key={p.token} value={p.token}>{p.name || p.token}</option>)}</select>
                  {" "}thermal lens <select value={lensOf.thermal} onChange={(e) => setLensOf((l) => ({ ...l, thermal: e.target.value }))}>
                    {profiles.filter((p) => p.ptz).map((p) => <option key={p.token} value={p.token}>{p.name || p.token}</option>)}</select>
                </span>
              )}
            </>
          )}
        </div>
        {ptzError && <div style={{ color: "var(--warn)", fontSize: 12.5, marginTop: 6 }}>⚠ {ptzError}</div>}
        {zooms && lensOf.colour && (
          <div className="flex" style={{ flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8 }}>
            <select value={lens} onChange={(e) => setLens(e.target.value as Lens)} title="Which lens the buttons move">
              <option value="both">both lenses</option><option value="colour">colour lens</option><option value="thermal">thermal lens</option>
            </select>
            <button className="btn-ghost" disabled={busy} onClick={() => nudge(-0.5, 0, 0)}>◀</button>
            <button className="btn-ghost" disabled={busy} onClick={() => nudge(0, 0.5, 0)}>▲</button>
            <button className="btn-ghost" disabled={busy} onClick={() => nudge(0, -0.5, 0)}>▼</button>
            <button className="btn-ghost" disabled={busy} onClick={() => nudge(0.5, 0, 0)}>▶</button>
            <button className="btn-ghost" disabled={busy} onClick={() => nudge(0, 0, -0.5)}>zoom −</button>
            <button className="btn-ghost" disabled={busy} onClick={() => nudge(0, 0, 0.5)}>zoom +</button>
            <button className="btn-primary" disabled={busy} onClick={savePosition}>
              Save this position as the {tab === "wide" ? "wide view" : `close-up of ${tab.slice(6)}`}
            </button>
            {view.position?.moves.length ? <button className="btn-ghost" disabled={busy} onClick={() => goTo(view)}>Go to saved position</button> : null}
          </div>
        )}
      </div>

      {/* 2–3. views */}
      <div className="flex" style={{ flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        <button className={tab === "wide" ? "btn-primary" : "btn-ghost"} onClick={() => { setTab("wide"); setDraw("colour"); }}>
          Wide view {wide?.position?.moves.length || !zooms ? "✓" : ""}
        </button>
        {zooms && zones.map((z) => {
          const id = `close:${z.stall}`, v = setup.views.find((x) => x.id === id);
          return (
            <button key={id} className={tab === id ? "btn-primary" : "btn-ghost"} onClick={() => addClose(z.stall)}>
              Close-up {z.stall} {v?.position?.moves.length ? "✓" : v ? "" : "+"}
            </button>
          );
        })}
      </div>

      {view.kind === "wide" && (
        <div className="flex" style={{ flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>Stall</span>
          {zones.map((z, i) => (
            <span key={i} className="flex" style={{ gap: 4, alignItems: "center" }}>
              <button className={i === zoneIdx ? "btn-primary" : "btn-ghost"} onClick={() => setZoneIdx(i)}>{z.stall}</button>
              {i === zoneIdx && (
                <>
                  <select value={z.stall} onChange={(e) => setZone(i, (x) => ({ ...x, stall: e.target.value }))} title="Which stall this part of the picture is">
                    {[...new Set([z.stall, ...stalls])].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {zones.length > 1 && <button className="btn-ghost" onClick={() => removeStall(i)}>remove</button>}
                </>
              )}
            </span>
          ))}
          {zones.length < 6 && <button className="btn-ghost" onClick={addStall}>+ stall</button>}
        </div>
      )}
      <div className="flex" style={{ flexWrap: "wrap", gap: 6, marginBottom: 8, alignItems: "center" }}>
        <span className="muted" style={{ fontSize: 12.5 }}>Draw</span>
        {drawKeys.map((k) => (
          <button key={k} className={draw === k ? "btn-primary" : "btn-ghost"} onClick={() => setDraw(k)}>
            {k === "colour" ? "stall · colour picture" : k === "thermal" ? "stall · thermal picture" : LABEL[k]}
          </button>
        ))}
      </div>

      <div className="grid cols-2" style={{ gap: 10 }}>
        {(["thermal", "colour"] as const).map((pic) => {
          const snap = pic === "thermal" ? thermal : colour;
          return (
            <div key={pic}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{pic === "thermal" ? "Thermal" : "Colour"}{drawingOn(pic) ? " — drag to draw" : ""}</div>
              {snap?.url
                ? <BoxStage src={snap.url} boxes={boxesFor(pic)} drawing={drawingOn(pic)} onBox={onBox} />
                : <div className="card muted" style={{ padding: 30, textAlign: "center", fontSize: 12.5 }}>{snap?.error ?? "loading…"}</div>}
            </div>
          );
        })}
      </div>

      <div className="flex" style={{ gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        {zooms && (
          <label style={{ fontSize: 13 }}>Zoom onto a horse every{" "}
            <input type="number" min={2} max={120} style={{ width: 60 }} value={setup.schedule.closeEveryMin}
              onChange={(e) => setSetup((s) => ({ ...s, schedule: { closeEveryMin: Number(e.target.value) } }))} /> minutes
            <span className="muted" style={{ fontSize: 12 }}> — {zones.length} horses: each is zoomed in on about every {setup.schedule.closeEveryMin * Math.max(1, zones.length)} min; other horses are not watched for that minute</span>
          </label>
        )}
      </div>
      <SetupChecklist title="Ready to save?" items={staticItems} />
      {view.kind === "close" && (
        <SetupChecklist title={`Live check · close-up of ${view.stall}`} items={live?.items ?? null} at={live?.at} busy={liveBusy} onRun={runLive} />
      )}
      {errors.length > 0 && (
        <div className="card" style={{ marginTop: 10, padding: 10, borderColor: "var(--warn)" }}>
          {errors.map((e) => <div key={e} style={{ fontSize: 12.5, color: "var(--warn)" }}>⚠ {e}</div>)}
        </div>
      )}
    </Modal>
  );
}

/** A picture with named boxes; dragging draws the active one. */
function BoxStage({ src, boxes, drawing, onBox }: {
  src: string; boxes: { key: string; box: RoiBox; label: string; active: boolean; kind: string }[]; drawing: boolean; onBox: (b: RoiBox) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [live, setLive] = useState<RoiBox | null>(null);
  const clamp = (v: number) => Math.max(0, Math.min(10000, Math.round(v)));
  const at = (e: RPointerEvent) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: clamp(((e.clientX - r.left) / r.width) * 10000), y: clamp(((e.clientY - r.top) / r.height) * 10000) };
  };
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    start.current = at(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const p = at(e), s = start.current;
    setLive({ x0: Math.min(s.x, p.x), y0: Math.min(s.y, p.y), x1: Math.max(s.x, p.x), y1: Math.max(s.y, p.y) });
  };
  const up = () => {
    if (start.current && live && live.x1 - live.x0 >= 100 && live.y1 - live.y0 >= 100) onBox(live);
    start.current = null;
    setLive(null);
  };
  const style = (b: RoiBox) => ({ left: `${b.x0 / 100}%`, top: `${b.y0 / 100}%`, width: `${(b.x1 - b.x0) / 100}%`, height: `${(b.y1 - b.y0) / 100}%` });
  return (
    <div ref={stage} className="hw-stage" style={{ cursor: drawing ? "crosshair" : "default" }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Camera view" draggable={false} />
      {boxes.map((b) => (
        <div key={b.key} className={`hw-box ${b.kind === "floor" ? "floor" : b.kind === "eye" ? "eye" : ""} ${b.active ? "active" : ""}`} style={style(b.box)}>
          <span>{b.label}</span>
        </div>
      ))}
      {live && <div className="hw-box active" style={style(live)} />}
    </div>
  );
}
