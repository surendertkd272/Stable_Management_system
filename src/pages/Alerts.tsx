import { useState } from "react";
import { AlertTriangle, Droplet, Sparkles, Activity, Check, Bell } from "lucide-react";
import { alerts as seed, Alert } from "../data/mock";

const ICON: Record<string, React.ReactNode> = {
  "Early colic pattern": <AlertTriangle size={19} />,
  "Pre-foaling activity": <Sparkles size={19} />,
  "Low water intake": <Droplet size={19} />,
  "Highlight captured": <Activity size={19} />,
  "Baseline learning": <Activity size={19} />,
  "Foaling labour detected": <Sparkles size={19} />,
};

export default function Alerts() {
  const [list, setList] = useState<Alert[]>(seed);
  const [tab, setTab] = useState<"open" | "all">("open");

  const ack = (id: string) =>
    setList((l) => l.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));

  const shown = tab === "open" ? list.filter((a) => !a.acknowledged) : list;
  const open = list.filter((a) => !a.acknowledged).length;

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
        <span className="pill warn">
          <Bell size={13} /> Auto-escalation on
        </span>
      </div>

      {shown.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <Check size={32} color="var(--positive)" />
          <p style={{ marginTop: 10, fontWeight: 600, color: "var(--ink)" }}>All clear</p>
          <p className="muted" style={{ fontSize: 13 }}>
            No open alerts — every horse is within baseline.
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

      <p className="muted" style={{ fontSize: 12, marginTop: 18, lineHeight: 1.5 }}>
        EquiCare provides behavioural context, not diagnosis. Alerts that aren't acknowledged within the set window
        escalate automatically: manager → on-call → vet.
      </p>
    </>
  );
}
