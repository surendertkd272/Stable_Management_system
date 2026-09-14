import { useState } from "react";
import { AlertTriangle, Droplet, Sparkles, Activity, Check, Bell, Wind, Repeat, Moon } from "lucide-react";
import { useStable } from "../store";

const ICON: Record<string, React.ReactNode> = {
  "Early colic pattern": <AlertTriangle size={19} />,
  "Pre-foaling activity": <Sparkles size={19} />,
  "Low water intake": <Droplet size={19} />,
  "Highlight captured": <Activity size={19} />,
  "Baseline learning": <Activity size={19} />,
  "Labour logged by staff": <Sparkles size={19} />,
  "Respiratory pattern": <Wind size={19} />,
  "Stable vice": <Repeat size={19} />,
  "Low lying-down time": <Moon size={19} />,
};

export default function Alerts() {
  const { alerts: list, acknowledge: ack } = useStable();
  const [tab, setTab] = useState<"open" | "all">("open");

  const shown = tab === "open" ? list.filter((a) => !a.acknowledged) : list;
  const open = list.filter((a) => !a.acknowledged).length;
  // "All clear" must not mean "no OPEN alert" if some horses have simply
  // never been heard from — that is not a clean baseline, it is a gap the
  // monitoring-gap rule already raised as its own alert. Only claim calm when
  // every one of those has actually been acknowledged too.
  const silentUnacked = list.some((a) => !a.acknowledged && a.type === "No monitoring data");

  return (
    <>
      <div className="flex between center wrap" style={{ marginBottom: 18, gap: 12 }}>
        <div className="tabs">
          <button className={tab === "open" ? "on" : ""} onClick={() => setTab("open")}>
            Open ({open})
          </button>
          <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>
            All ({list.length})
          </button>
        </div>
        {/* This claimed a manager -> on-call -> vet chain that the backend
            does not run (server/notify.mjs sends one flat webhook per alert,
            deliberately not that chain — see its own header comment). */}
        <span className="pill muted">
          <Bell size={13} /> Delivered via webhook
        </span>
      </div>

      {shown.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <Check size={32} color="var(--positive)" />
          <p style={{ marginTop: 10, fontWeight: 600, color: "var(--ink)" }}>
            {silentUnacked ? "No behavioural alerts" : "All clear"}
          </p>
          <p className="muted" style={{ fontSize: 13 }}>
            {silentUnacked
              ? "But check the Horses page — some stalls have never sent a reading, which will not show up here as a behaviour alert."
              : "No open alerts — every reporting horse is within baseline."}
          </p>
        </div>
      )}

      {shown.map((a) => (
        <div
          key={a.id}
          className={`row ${a.severity === "alert" ? "urgent" : a.severity === "warn" ? "watch" : "calm"}`}
          style={{ alignItems: "flex-start", padding: "16px 18px" }}
        >
          <div className={`sev-chip ${a.severity}`}>{ICON[a.type] ?? <Bell size={19} />}</div>
          <div className="grow">
            <div className="flex between center wrap" style={{ gap: 8 }}>
              <b>
                {a.type} · {a.horse}
              </b>
              <span className="muted" style={{ fontSize: 12 }}>
                {a.time}
              </span>
            </div>
            <span style={{ marginTop: 4 }}>{a.detail}</span>
          </div>
          <div style={{ flexShrink: 0 }}>
            {a.acknowledged ? (
              <span className="pill ok">
                <Check size={13} /> Acknowledged
              </span>
            ) : (
              <button className="btn-ghost accent" onClick={() => ack(a.id)}>
                Acknowledge
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Third instance of the same overclaim on this one page (the pill and
          the empty state carried it too) — the backend delivers one flat
          webhook per alert, not an escalation chain. See notify.mjs. */}
      <p className="muted" style={{ fontSize: 12, marginTop: 18, lineHeight: 1.5 }}>
        EquiCare provides behavioural context, not diagnosis. Each new alert is delivered once,
        by webhook, to whatever you have connected — it does not yet chase an unacknowledged
        alert up a chain on its own.
      </p>
    </>
  );
}
