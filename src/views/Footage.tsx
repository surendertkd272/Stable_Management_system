"use client";

// Footage & labels — the training data for real behaviour models.
//
// The edge agent records each camera switched to "record" (thermal + visible,
// 10-minute clips). Here people watch the two streams side by side and mark
// what the horse does: lying down, standing, eating, rolling, urinating… The
// labels are stored with absolute times and exported as CSV for training.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Film, Play, Pause, Download, Trash2, Loader2, Info, Rewind, FastForward, Circle } from "lucide-react";
import * as api from "../data/api";
import type { FootageClip, FootageLabel, LabelDef } from "../data/api";
import { useToast } from "../store";
import { useAuth } from "../auth";

const SPEEDS = [0.5, 1, 2, 4, 8, 16];
const t = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
const dur = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`);

export default function Footage() {
  const { user, authRequired } = useAuth();
  const role = user?.role ?? (authRequired ? null : "admin");
  const notify = useToast();
  const [clips, setClips] = useState<FootageClip[] | null>(null);
  const [cameras, setCameras] = useState<{ id: string; name: string; stall: string | null }[]>([]);
  const [camera, setCamera] = useState<string>("");
  const [clip, setClip] = useState<FootageClip | null>(null);
  const [vocab, setVocab] = useState<LabelDef[]>([]);
  const [ticket, setTicket] = useState<string>("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (api.demoMode) return setClips([]);
    const [f, v, tk] = await Promise.all([api.listFootage(), api.labelVocabulary(), api.footageTicket()]);
    if (!f.ok) return setError(f.error);
    setClips(f.data.clips);
    setCameras(f.data.cameras);
    setCamera((c) => c || f.data.cameras[0]?.id || "");
    if (v.ok) setVocab(v.data);
    if (tk.ok) setTicket(tk.data.ticket);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (role === "owner") {
    return <div className="card" style={{ padding: 32 }}><h3>Footage is for the yard&apos;s staff</h3></div>;
  }

  const camClips = (clips ?? []).filter((c) => c.camera === camera);
  const byDay = new Map<string, FootageClip[]>();
  for (const c of camClips) byDay.set(day(c.at), [...(byDay.get(day(c.at)) ?? []), c]);

  return (
    <>
      {api.demoMode && (
        <div className="row watch" style={{ marginBottom: 18 }}>
          <Info size={18} style={{ flexShrink: 0 }} />
          <span>Recordings live on the site server; the public demo has none.</span>
        </div>
      )}
      {error && <div className="row urgent" style={{ marginBottom: 14 }}>Could not load footage: {error}</div>}

      <div className="flex between center wrap" style={{ gap: 12, marginBottom: 16 }}>
        <div className="flex gap-sm center wrap">
          <div className="field" style={{ marginBottom: 0, minWidth: 220 }}>
            <label>Camera</label>
            <select value={camera} onChange={(e) => { setCamera(e.target.value); setClip(null); }}>
              {cameras.length === 0 && <option value="">no recordings yet</option>}
              {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}{c.stall ? ` · stall ${c.stall}` : ""}</option>)}
            </select>
          </div>
        </div>
        <button className="btn-ghost" onClick={async () => notify((await api.exportFootageLabels()) ? "Labels exported" : "Export failed")}>
          <Download size={15} /> Export labels (CSV)
        </button>
      </div>

      {clips && clips.length === 0 && !api.demoMode && (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <Film size={30} color="var(--text-secondary)" />
          <p style={{ marginTop: 10, fontWeight: 600, color: "var(--ink)" }}>No recordings yet</p>
          <p className="muted" style={{ fontSize: 13, maxWidth: 560, margin: "6px auto 0" }}>
            In Hardware, edit a camera and switch on <b>Record video for training</b>. The edge agent then keeps its thermal
            and visible video in 10-minute clips, which appear here to label.
          </p>
        </div>
      )}

      {camClips.length > 0 && (
        <div className="footage-grid">
          <div className="card footage-list">
            {[...byDay.entries()].map(([d, list]) => (
              <div key={d}>
                <p className="hw-legend" style={{ marginTop: 4 }}>{d}</p>
                {list.map((c) => (
                  <button key={c.id} className={`footage-clip ${clip?.id === c.id ? "on" : ""}`} onClick={() => setClip(c)}>
                    <span>{new Date(c.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–{new Date(c.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="muted">
                      {c.recording && <span className="pill alert" style={{ fontSize: 10, padding: "0 6px" }}><Circle size={8} /> rec</span>}{" "}
                      {c.labels > 0 ? `${c.labels} label${c.labels > 1 ? "s" : ""}` : ""}
                      {!c.thermal || !c.visible ? " · one stream" : ""}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div>
            {!clip ? (
              <div className="card muted" style={{ padding: 30 }}>Pick a clip on the left.</div>
            ) : (
              <ClipLabeller key={clip.id} clip={clip} vocab={vocab} ticket={ticket} onChanged={load} />
            )}
          </div>
        </div>
      )}
    </>
  );
}

// --------------------------------------------------------------------------- //
function ClipLabeller({ clip, vocab, ticket, onChanged }: {
  clip: FootageClip; vocab: LabelDef[]; ticket: string; onChanged: () => void;
}) {
  const notify = useToast();
  const master = useRef<HTMLVideoElement>(null);           // thermal if present
  const slave = useRef<HTMLVideoElement>(null);
  const [h264, setH264] = useState<{ thermal: boolean; visible: boolean }>({ thermal: false, visible: false });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [pos, setPos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [labels, setLabels] = useState<FootageLabel[]>([]);
  const [open, setOpen] = useState<{ def: LabelDef; startAt: string } | null>(null);
  const [note, setNote] = useState("");

  const mStream: "thermal" | "visible" = clip.thermal ? "thermal" : "visible";
  const sStream: "thermal" | "visible" | null = clip.thermal && clip.visible ? "visible" : null;
  const mRef = clip[mStream]!;
  const offset = sStream ? (Date.parse(clip[sStream]!.at) - Date.parse(mRef.at)) / 1000 : 0;   // slave starts this much later
  const absAt = useCallback((sec: number) => new Date(Date.parse(mRef.at) + sec * 1000).toISOString(), [mRef.at]);

  const loadLabels = useCallback(async () => {
    const r = await api.footageLabels(clip.camera, clip.at, clip.end);
    if (r.ok) setLabels(r.data);
  }, [clip.camera, clip.at, clip.end]);
  useEffect(() => {
    loadLabels();
  }, [loadLabels]);

  // Keep the second video in step with the first.
  const sync = () => {
    const m = master.current, s = slave.current;
    if (!m) return;
    setPos(m.currentTime);
    if (s && !Number.isNaN(s.duration)) {
      const want = m.currentTime - offset;
      if (want >= 0 && Math.abs(s.currentTime - want) > 0.35) s.currentTime = Math.min(want, s.duration || want);
      s.playbackRate = m.playbackRate;
      if (!m.paused && s.paused && want >= 0) s.play().catch(() => {});
      if (m.paused && !s.paused) s.pause();
    }
  };
  const toggle = () => {
    const m = master.current;
    if (!m) return;
    if (m.paused) { m.play().catch(() => {}); setPlaying(true); } else { m.pause(); setPlaying(false); }
    setTimeout(sync, 50);
  };
  const seek = (sec: number) => {
    const m = master.current;
    if (!m) return;
    m.currentTime = Math.max(0, Math.min(m.duration || sec, sec));
    setTimeout(sync, 50);
  };
  useEffect(() => {
    if (master.current) master.current.playbackRate = speed;
    if (slave.current) slave.current.playbackRate = speed;
  }, [speed]);

  const save = async (def: LabelDef, startAt: string, endAt: string | null) => {
    const r = await api.createFootageLabel({ camera: clip.camera, clip: clip.id, label: def.key, startAt, endAt, note: note.trim() || undefined });
    if (!r.ok) return notify(`Not saved: ${r.details?.join(", ") || r.error}`);
    setNote("");
    notify(`${def.name}${endAt ? ` · ${dur((Date.parse(endAt) - Date.parse(startAt)) / 1000)}` : ""} saved`);
    loadLabels();
    onChanged();
  };

  const press = (def: LabelDef) => {
    const now = absAt(master.current?.currentTime ?? 0);
    if (def.kind === "moment") return save(def, now, null);
    if (open && open.def.key === def.key) {
      setOpen(null);
      return save(def, open.startAt, now);
    }
    if (open) notify(`"${open.def.name}" was still open — ended it here`), save(open.def, open.startAt, now);
    setOpen({ def, startAt: now });
  };

  // Keyboard: space play/pause, ←/→ 5 s, label keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
      if (e.key === " ") { e.preventDefault(); toggle(); return; }
      if (e.key === "ArrowLeft") { seek((master.current?.currentTime ?? 0) - 5); return; }
      if (e.key === "ArrowRight") { seek((master.current?.currentTime ?? 0) + 5); return; }
      const def = vocab.find((v) => v.shortcut === e.key.toLowerCase());
      if (def) { e.preventDefault(); press(def); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const src = (stream: "thermal" | "visible") =>
    api.footageVideoUrl(clip.camera, stream, clip[stream]!.start, ticket, h264[stream]);
  // A browser without HEVC playback gets an H.264 copy, converted once on the server.
  const onError = (stream: "thermal" | "visible") => () => {
    if (!h264[stream]) { setH264((x) => ({ ...x, [stream]: true })); notify(`Converting the ${stream} clip for this browser…`); }
  };

  const span = Math.max(1, duration || (Date.parse(clip.end) - Date.parse(clip.at)) / 1000);
  const rel = (iso: string) => (Date.parse(iso) - Date.parse(mRef.at)) / 1000;
  const defOf = useMemo(() => new Map(vocab.map((v) => [v.key, v])), [vocab]);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>{clip.cameraName} · {t(clip.at)}</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>{clip.stall ? `Stall ${clip.stall} · ` : ""}{day(clip.at)}{clip.recording ? " · still recording" : ""}</span>
        </div>
        <span className="pill muted">{t(absAt(pos))}</span>
      </div>

      <div className="footage-videos">
        {(["thermal", "visible"] as const).map((stream) => clip[stream] && (
          <figure key={stream}>
            <video
              ref={stream === mStream ? master : slave}
              src={ticket ? src(stream) : undefined}
              muted playsInline preload="auto"
              onTimeUpdate={stream === mStream ? sync : undefined}
              onLoadedMetadata={stream === mStream ? (e) => setDuration((e.target as HTMLVideoElement).duration) : undefined}
              onPlay={stream === mStream ? () => setPlaying(true) : undefined}
              onPause={stream === mStream ? () => setPlaying(false) : undefined}
              onError={onError(stream)}
            />
            <figcaption>{stream}{h264[stream] ? " · converted" : ""}</figcaption>
          </figure>
        ))}
      </div>

      <div className="footage-timeline" onClick={(e) => {
        const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        seek(((e.clientX - r.left) / r.width) * span);
      }}>
        {labels.map((l) => {
          const a = Math.max(0, rel(l.startAt)), b = l.endAt ? Math.min(span, rel(l.endAt)) : a;
          return <i key={l.id} className={l.endAt ? "span" : "moment"} title={`${defOf.get(l.label)?.name ?? l.label} · ${t(l.startAt)}`}
            style={{ left: `${(a / span) * 100}%`, width: l.endAt ? `${Math.max(0.4, ((b - a) / span) * 100)}%` : undefined }} />;
        })}
        {open && <i className="span open" style={{ left: `${(Math.max(0, rel(open.startAt)) / span) * 100}%`, width: `${Math.max(0.4, ((pos - rel(open.startAt)) / span) * 100)}%` }} />}
        <b style={{ left: `${(pos / span) * 100}%` }} />
      </div>

      <div className="flex gap-sm center wrap" style={{ margin: "10px 0 14px" }}>
        <button className="btn-ghost" onClick={() => seek(pos - 5)} title="Back 5 s (←)"><Rewind size={15} /></button>
        <button className="btn-primary" onClick={toggle} title="Play / pause (space)">{playing ? <Pause size={15} /> : <Play size={15} />}</button>
        <button className="btn-ghost" onClick={() => seek(pos + 5)} title="Forward 5 s (→)"><FastForward size={15} /></button>
        <div className="tabs">
          {SPEEDS.map((s) => <button key={s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>{s}×</button>)}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>{dur(pos)} / {dur(span)}</span>
      </div>

      <p className="hw-legend" style={{ marginTop: 0 }}>Mark what the horse does</p>
      {open && (
        <div className="row watch" style={{ padding: "8px 12px", marginBottom: 8 }}>
          <Loader2 size={14} className="spin" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 12.5 }}><b>{open.def.name}</b> since {t(open.startAt)} — press it again (or “{open.def.shortcut}”) where it ends.</span>
        </div>
      )}
      <div className="footage-buttons">
        {vocab.map((v) => (
          <button key={v.key} className={`btn-ghost ${open?.def.key === v.key ? "accent" : ""}`} onClick={() => press(v)}
            title={v.kind === "interval" ? "Press at the start and again at the end" : "Press when it happens"}>
            <kbd>{v.shortcut}</kbd> {v.name}{v.kind === "interval" ? (open?.def.key === v.key ? " — end" : "") : ""}
          </button>
        ))}
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label>Note (optional; required for “Other”)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. head over the door, second horse visible" />
      </div>

      <p className="hw-legend">Labels in this clip</p>
      {labels.length === 0 ? <p className="muted" style={{ fontSize: 12.5 }}>None yet.</p> : (
        <ul className="hw-steps">
          {labels.map((l) => (
            <li key={l.id} className="ok" style={{ cursor: "pointer" }} onClick={() => seek(rel(l.startAt))}>
              <Film size={15} />
              <div>
                <b>{defOf.get(l.label)?.name ?? l.label}</b>
                <span>{t(l.startAt)}{l.endAt ? `–${t(l.endAt)} · ${dur((Date.parse(l.endAt) - Date.parse(l.startAt)) / 1000)}` : ""}{l.note ? ` · ${l.note}` : ""} · by {l.by}</span>
              </div>
              <em>
                <button className="btn-ghost" title="Delete" onClick={async (e) => {
                  e.stopPropagation();
                  const r = await api.deleteFootageLabel(l.id);
                  if (r.ok) { loadLabels(); onChanged(); } else notify(r.error);
                }}><Trash2 size={13} /></button>
              </em>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
