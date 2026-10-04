"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Moon, Thermometer, Wind } from "lucide-react";
import { Status } from "../data/mock";
import { useStable } from "../store";
import { useAuth } from "../auth";
import { RecycleBinButton } from "./RecycleBin";
import { unusualColor, unusualWord } from "./HorseCare";
import { StatusPill, MonitoringPill, isBlind, riskScore, riskBand, details } from "../components/ui";

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
  const { user, authRequired } = useAuth();
  const isAdmin = !authRequired || user?.role === "admin";
  const [filter, setFilter] = useState<Status | "all">("all");
  const [sort, setSort] = useState<"attention" | "stall" | "name">("attention");
  // Attention: urgent, then watch, then the most unusual against its own normal.
  const RANK: Record<Status, number> = { urgent: 0, watch: 1, calm: 2 };
  const list = horses.filter((h) => filter === "all" || h.status === filter).sort((a, b) =>
    sort === "name" ? a.name.localeCompare(b.name)
    : sort === "stall" ? a.stall.localeCompare(b.stall, undefined, { numeric: true })
    : RANK[a.status] - RANK[b.status] || (b.unusual?.score ?? -1) - (a.unusual?.score ?? -1) || a.name.localeCompare(b.name));

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
        <span className="flex center" style={{ gap: 10 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {list.length} of {horses.length} horses
          </span>
          <div className="field" style={{ margin: 0 }}>
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort horses" style={{ padding: "6px 10px" }}>
              <option value="attention">Needs attention first</option>
              <option value="stall">By stall</option>
              <option value="name">By name</option>
            </select>
          </div>
          {isAdmin && <RecycleBinButton />}
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
              {details(h.breed, h.sex, h.age)}
            </div>
            {h.unusual && h.unusual.score != null && (
              <div style={{ fontSize: 12, marginTop: 6 }} title={h.unusual.reasons.join(", ")}>
                <span className="muted">Today: </span>
                <b style={{ color: unusualColor(h.unusual.score) }}>{h.unusual.score}/10 {unusualWord(h.unusual.score)}</b>
                {h.unusual.reasons[0] && <span className="muted"> · {h.unusual.reasons[0]}</span>}
              </div>
            )}
            {h.mareAndFoal && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Mare and foal</div>}
            <div className="metrics">
              <div className="m">
                <b title={h.vitals?.calibrated === false ? "Camera not aimed — reading unreliable" : undefined}
                   style={h.vitals?.calibrated === false ? { color: "var(--text-secondary)" } : undefined}>
                  {h.vitals?.calibrated === false ? "not aimed" : h.vitals?.bodyTempC != null ? `${h.vitals.bodyTempC.toFixed(1)}°`
                    : h.bodyTemp?.camera?.learning ? <span style={{ fontSize: 12 }}>learning</span> : "—"}
                </b>
                <span title="Body temperature by the thermal camera, from this horse's own normal eye temperature">
                  <Thermometer size={11} style={{ verticalAlign: "-1px" }} /> body temp
                </span>
              </div>
              <div className="m">
                <b style={h.vitals?.calibrated === false ? { color: "var(--text-secondary)" } : undefined}>
                  {h.vitals?.respRateBpm == null ? "—" : h.vitals.calibrated === false ? "—" : Math.round(h.vitals.respRateBpm)}
                </b>
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
