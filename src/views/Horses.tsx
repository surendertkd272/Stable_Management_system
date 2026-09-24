"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Moon, Thermometer, Wind } from "lucide-react";
import { Status } from "../data/mock";
import { useStable } from "../store";
import { StatusPill, MonitoringPill, isBlind, riskScore, riskBand } from "../components/ui";

const FILTERS: { key: Status | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "urgent", label: "Needs attention" },
  { key: "watch", label: "Watch" },
  { key: "calm", label: "Calm" },
];

export default function Horses() {
  const router = useRouter();
  const nav = (to: string) => router.push(to);
  const { horses } = useStable();
  const [filter, setFilter] = useState<Status | "all">("all");
  const list = horses.filter((h) => filter === "all" || h.status === filter);

  return (
    <>
      <div className="flex between center wrap" style={{ marginBottom: 18, gap: 12 }}>
        <div className="tabs">
          {FILTERS.map((f) => (
            <button key={f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 13 }}>
          {list.length} of {horses.length} horses
        </span>
      </div>

      <div className="grid cols-3">
        {list.map((h) => (
          <div key={h.id} className="horse-card" onClick={() => nav(`/horses/${h.id}`)}>
            <div className="photo" style={{ backgroundImage: `url(${h.photo})` }}>
              <div className="status">
                {isBlind(h.monitoring) ? <MonitoringPill monitoring={h.monitoring} /> : <StatusPill status={h.status} />}
              </div>
            </div>
            <div className="flex between center">
              <h4>{h.name}</h4>
              <span className="muted" style={{ fontSize: 12 }}>
                {h.stall}
              </span>
            </div>
            <div className="meta">
              {h.breed} · {h.sex} · {h.age}
            </div>
            <div className="metrics">
              <div className="m">
                <b>{h.vitals?.bodyTempC == null ? "—" : `${h.vitals.bodyTempC.toFixed(1)}°`}</b>
                <span>
                  <Thermometer size={11} style={{ verticalAlign: "-1px" }} /> temp
                </span>
              </div>
              <div className="m">
                <b>{h.vitals?.respRateBpm == null ? "—" : Math.round(h.vitals.respRateBpm)}</b>
                <span>
                  <Wind size={11} style={{ verticalAlign: "-1px" }} /> resp
                </span>
              </div>
              <div className="m">
                <b>{h.rest ?? "—"}</b>
                <span>
                  <Moon size={11} style={{ verticalAlign: "-1px" }} /> rest
                </span>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              {h.monitoring === "no-data" || h.monitoring === "offline" ? (
                <>
                  <div className="flex between" style={{ fontSize: 11, marginBottom: 4 }}>
                    <span className="muted">Predictive risk</span>
                    <span style={{ color: "var(--text-secondary)", fontWeight: 700 }}>
                      not assessable
                    </span>
                  </div>
                  <div className="progress" style={{ height: 6 }}>
                    <i
                      style={{
                        width: "100%",
                        background:
                          "repeating-linear-gradient(135deg, var(--border) 0 6px, transparent 6px 12px)",
                      }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex between" style={{ fontSize: 11, marginBottom: 4 }}>
                    <span className="muted">Predictive risk</span>
                    <span style={{ color: riskBand(riskScore(h)).color, fontWeight: 700 }}>
                      {riskScore(h)} · {riskBand(riskScore(h)).label}
                    </span>
                  </div>
                  <div className="progress" style={{ height: 6 }}>
                    <i style={{ width: `${riskScore(h)}%`, background: riskBand(riskScore(h)).color }} />
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
