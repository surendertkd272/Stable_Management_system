import { useNavigate } from "react-router-dom";
import {
  Activity,
  Droplet,
  Moon,
  Bell,
  Play,
  ChevronRight,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { StatCard, RadialGauge, Sparkline, statusColor } from "../components/ui";
import { horses, series, stallLayout, breedingMares } from "../data/mock";

export default function Dashboard() {
  const nav = useNavigate();
  const focus = horses[0]; // Zarina — needs attention
  const labourMare = breedingMares.find((m) => m.status === "labour");

  return (
    <div className="dash-grid">
      {/* top row: 3 stat cards */}
      <StatCard
        icon={<Activity size={20} />}
        label="Horses monitored"
        value="6"
        delta={0}
        spark={series.monitored}
        sparkType="bar"
      />
      <StatCard
        icon={<Moon size={20} />}
        label="Avg daily rest"
        value="6.9"
        unit="h"
        delta={4}
        spark={series.rest}
      />
      <StatCard
        icon={<Droplet size={20} />}
        label="Avg water visits"
        value="7.2"
        delta={-6}
        spark={series.water}
        sparkType="bar"
        sparkColor="var(--accent-strong)"
      />

      {/* focus horse profile card */}
      <div className="card span-1">
        <div className="card-head">
          <h3>Needs attention</h3>
          <span className="pill alert">Live</span>
        </div>
        <div
          className="photo"
          style={{
            height: 120,
            borderRadius: "var(--radius-inner)",
            backgroundImage: `url(${focus.photo})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div style={{ marginTop: 14 }}>
          <div className="flex between center">
            <b style={{ fontSize: 18, color: "var(--ink)" }}>{focus.name}</b>
            <span className="muted" style={{ fontSize: 12.5 }}>
              Stall {focus.stall}
            </span>
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
            {focus.breed} · {focus.sex} · {focus.age}
          </p>
          <div
            className="row urgent"
            style={{ marginTop: 14, marginBottom: 0, background: "var(--alert-soft)", borderColor: "transparent" }}
          >
            <AlertTriangle size={18} color="var(--alert)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, color: "var(--alert)", fontWeight: 600 }}>{focus.statusNote}</span>
          </div>
          <button className="btn-ghost accent" style={{ width: "100%", marginTop: 14 }} onClick={() => nav(`/horses/${focus.id}`)}>
            Open horse profile
          </button>
        </div>
      </div>

      {/* incident timeline (wider) */}
      <div className="card span-1">
        <div className="card-head">
          <h3>Incident timeline · {focus.name}</h3>
          <span className="sub">Tonight</span>
        </div>
        <div className="timeline">
          {[
            { t: "First restlessness", s: "01:42 · pacing in box", k: "done" },
            { t: "Repeated lying-up cycling", s: "02:10 · 4× above baseline", k: "alert" },
            { t: "Alert sent (WhatsApp)", s: "02:18 · to manager + owner", k: "alert" },
            { t: "Awaiting acknowledgement", s: "escalates to vet in 4 min", k: "pending" },
          ].map((it, i) => (
            <div className="tl-item" key={i}>
              <div className={`tl-dot ${it.k}`} />
              <div className="tl-body">
                <b>{it.t}</b>
                <span>{it.s}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* stress gauge */}
      <div className="card span-1">
        <div className="card-head">
          <h3>Stress level</h3>
          <span className="pill alert">High</span>
        </div>
        <RadialGauge value={82} display="High" label={`${focus.name} · 5-min macro-movement`} color="var(--alert)" />
      </div>

      {/* highlights feature card */}
      <div className="feature span-1">
        <div>
          <span className="pill" style={{ background: "rgba(255,255,255,0.22)", color: "#fff" }}>
            Highlights
          </span>
          <h3 style={{ marginTop: 12 }}>Raja's turnout moment</h3>
          <p>A shareable glimpse of the secret stable life — saved yesterday at 17:22.</p>
        </div>
        <button className="play">
          <Play size={20} fill="currentColor" />
        </button>
        <div className="thumb">
          <Play size={34} color="#fff" fill="#fff" />
        </div>
      </div>

      {/* yard map / triage preview (tall, full height right) */}
      <div className="card span-1 row-span-2">
        <div className="card-head">
          <h3>Yard map</h3>
          <button className="sub" style={{ color: "var(--accent)", fontWeight: 600 }} onClick={() => nav("/yard")}>
            Open <ChevronRight size={13} style={{ verticalAlign: "-2px" }} />
          </button>
        </div>
        <div className="yardmap">
          {stallLayout.map((s) => (
            <div
              key={s.id}
              className="stall"
              style={{ left: `${s.x}%`, top: `${s.y}%` }}
              title={s.name}
            >
              <span className="ind" style={{ background: statusColor(s.status as any) }} />
              {s.name}
            </div>
          ))}
          <div className="stall" style={{ left: "6%", top: "82%", border: "none", background: "transparent", boxShadow: "none", color: "var(--text-secondary)" }}>
            Barn A · B · C — 6 boxes monitored
          </div>
        </div>
        <div className="flex gap-sm" style={{ marginTop: 14, flexWrap: "wrap" }}>
          <span className="pill ok">3 calm</span>
          <span className="pill warn">2 watch</span>
          <span className="pill alert">1 urgent</span>
        </div>
      </div>

      {/* foaling watch card */}
      <div className={`foaling span-2 ${labourMare ? "labour" : ""}`}>
        <div className="card-head">
          <h3>Foaling watch</h3>
          {labourMare ? <span className="pill alert">Labour detected</span> : <span className="pill warn">In season</span>}
        </div>
        <div className="flex between center wrap" style={{ gap: 20 }}>
          <div>
            <p className="muted" style={{ fontSize: 13 }}>
              {labourMare?.name} · sired by {labourMare?.stallion}
            </p>
            <div className="countdown" style={{ color: "var(--alert)" }}>
              NOW
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
              {labourMare?.note}
            </p>
          </div>
          <div className="flex gap-md center">
            <div style={{ textAlign: "center" }}>
              <div className="flex center" style={{ gap: 6, color: "var(--text-secondary)", fontSize: 12 }}>
                <Clock size={14} /> Next due
              </div>
              <b style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--ink)" }}>Noor · 6d</b>
            </div>
            <button className="btn-ghost accent" onClick={() => nav("/breeding")}>
              Open foaling watch
            </button>
          </div>
        </div>
      </div>

      {/* weekly alerts mini */}
      <div className="card span-1">
        <div className="card-head">
          <h3>Alerts this week</h3>
          <Bell size={17} color="var(--text-secondary)" />
        </div>
        <div className="value" style={{ fontSize: 40, fontFamily: "var(--font-display)", fontWeight: 700 }}>
          18
        </div>
        <div className="flex between center" style={{ marginTop: 8 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>14 resolved · 4 open</span>
          <Sparkline data={series.alerts} type="bar" color="var(--alert)" />
        </div>
      </div>
    </div>
  );
}
