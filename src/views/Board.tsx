"use client";
// The stable board: every stall at a glance — red, amber, green — for a screen
// in the stable office or the duty room. Refreshes itself every 30 seconds;
// "Full screen" hides everything else.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Maximize2, Minimize2, Thermometer, Wind, Bell } from "lucide-react";
import * as api from "../data/api";
import type { Alert, Horse } from "../data/mock";
import { useStable } from "../store";
import { isBlind } from "../components/ui";
import { unusualWord } from "./HorseCare";

const TONE = {
  urgent: { bg: "var(--alert-soft)", edge: "var(--alert)", word: "Needs attention" },
  watch: { bg: "var(--warn-soft)", edge: "var(--warn)", word: "Watch" },
  calm: { bg: "var(--positive-soft)", edge: "var(--positive)", word: "Calm" },
  blind: { bg: "var(--surface-muted)", edge: "var(--text-faint)", word: "No picture" },
} as const;

export default function Board() {
  const stable = useStable();
  const [horses, setHorses] = useState<Horse[]>(stable.horses);
  const [alerts, setAlerts] = useState<Alert[]>(stable.alerts);
  const [at, setAt] = useState(new Date());
  const [full, setFull] = useState(false);

  const load = useCallback(async () => {
    const [h, a] = await Promise.all([api.getHorses(), api.getAlerts()]);
    if (h) setHorses(h);
    if (a) setAlerts(a);
    setAt(new Date());
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    const onFs = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => { clearInterval(t); document.removeEventListener("fullscreenchange", onFs); };
  }, [load]);

  const tone = (h: Horse) => (isBlind(h.monitoring) ? "blind" : h.status);
  const order = { urgent: 0, watch: 1, blind: 2, calm: 3 };
  const list = [...horses].sort((a, b) => order[tone(a)] - order[tone(b)] || a.stall.localeCompare(b.stall, undefined, { numeric: true }));
  const count = (k: keyof typeof TONE) => horses.filter((h) => tone(h) === k).length;
  const open = (h: Horse) => alerts.filter((a) => a.horse === h.name && !a.acknowledged && a.severity !== "ok");

  return (
    <div id="stable-board" style={{ background: "var(--bg-app)", padding: full ? 24 : 0, minHeight: full ? "100vh" : undefined }}>
      <div className="flex between center wrap" style={{ gap: 12, marginBottom: 16 }}>
        <div className="flex center wrap" style={{ gap: 10 }}>
          {(["urgent", "watch", "blind", "calm"] as const).map((k) => (
            <span key={k} className="pill" style={{ background: TONE[k].bg, color: "var(--ink)", border: `1px solid ${TONE[k].edge}`, fontSize: 14, padding: "6px 12px" }}>
              <b>{count(k)}</b>&nbsp;{TONE[k].word}
            </span>
          ))}
        </div>
        <div className="flex center" style={{ gap: 10 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · refreshes every 30 s
          </span>
          <button className="btn-ghost" onClick={() => (full ? document.exitFullscreen() : document.getElementById("stable-board")?.requestFullscreen())}>
            {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />} {full ? "Exit full screen" : "Full screen"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 14 }}>
        {list.map((h) => {
          const k = tone(h), t = TONE[k], a = open(h);
          return (
            <Link key={h.id} href={`/horses/${h.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div style={{ background: t.bg, borderLeft: `8px solid ${t.edge}`, borderRadius: 14, padding: "14px 16px", minHeight: 150, display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="flex between center">
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700 }}>{h.stall}</span>
                  <span style={{ fontWeight: 700, fontSize: 13, color: t.edge === "var(--text-faint)" ? "var(--text-secondary)" : t.edge }}>{t.word}</span>
                </div>
                <div style={{ fontSize: 19, fontWeight: 700 }}>{h.name}</div>
                <div style={{ fontSize: 13, color: "var(--ink-soft)", minHeight: 34 }}>
                  {k === "blind" ? (h.lastSeen ? `Last seen ${new Date(h.lastSeen).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "Nothing received yet") : h.statusNote}
                </div>
                <div className="flex center wrap" style={{ gap: 12, fontSize: 13, marginTop: "auto" }}>
                  {h.vitals?.bodyTempC != null && h.vitals.calibrated !== false && <span><Thermometer size={13} style={{ verticalAlign: "-2px" }} /> {h.vitals.bodyTempC.toFixed(1)}°</span>}
                  {h.vitals?.respRateBpm != null && h.vitals.calibrated !== false && <span><Wind size={13} style={{ verticalAlign: "-2px" }} /> {Math.round(h.vitals.respRateBpm)}/min</span>}
                  {h.unusual?.score != null && <span>Today {h.unusual.score}/10 {unusualWord(h.unusual.score)}</span>}
                  {a.length > 0 && <span style={{ fontWeight: 700, color: "var(--alert)" }}><Bell size={13} style={{ verticalAlign: "-2px" }} /> {a.length} open</span>}
                  {h.mareAndFoal && <span>Mare and foal</span>}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
