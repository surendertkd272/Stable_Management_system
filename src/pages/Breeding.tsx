import { useNavigate } from "react-router-dom";
import { Baby, Heart, Stethoscope, Clock, CheckCircle2, Circle } from "lucide-react";
import { breedingMares } from "../data/mock";

export default function Breeding() {
  const nav = useNavigate();

  return (
    <>
      {/* foaling watch cards */}
      <h3 className="section-title">Foaling watch</h3>
      <div className="grid cols-3" style={{ marginBottom: 28 }}>
        {breedingMares.map((m) => {
          const labour = m.status === "labour";
          return (
            <div key={m.id} className={`foaling ${labour ? "labour" : ""}`}>
              <div className="card-head">
                <h3>{m.name}</h3>
                {labour ? (
                  <span className="pill alert">Labour</span>
                ) : m.status === "watch" ? (
                  <span className="pill warn">Watch</span>
                ) : (
                  <span className="pill muted">Tracking</span>
                )}
              </div>
              <div className="countdown" style={{ color: labour ? "var(--alert)" : "var(--ink)" }}>
                {labour ? "NOW" : `${m.daysToDue}d`}
              </div>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                {labour ? "to foaling" : "until due"} · {m.stage}
              </p>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
                {m.note}
              </p>
              <div className="flex gap-sm" style={{ marginTop: 14 }}>
                <span className="pill accent">
                  <Heart size={12} /> by {m.stallion}
                </span>
                {labour && <span className="pill alert">Birth alarm</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* post-foaling monitoring checklist (the riskiest hours) */}
      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="card-head">
            <h3>Post-foaling monitoring · Laila</h3>
            <span className="pill alert">Live</span>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
            The riskiest hours are right after birth. The AI watches each milestone and flags anything that stalls.
          </p>
          {[
            { t: "Foal stands", s: "within ~1–2 h", done: false, alert: false },
            { t: "Foal nursing", s: "first nurse", done: false, alert: false },
            { t: "Placenta passed", s: "within ~3 h", done: false, alert: true },
            { t: "Mare accepts foal", s: "no aggression", done: false, alert: false },
            { t: "Mare colic check", s: "post-foaling", done: false, alert: false },
          ].map((it, i) => (
            <div className="tl-item" key={i}>
              <div className={`tl-dot ${it.alert ? "alert" : "pending"}`} />
              <div className="tl-body">
                <b>{it.t}</b>
                <span>
                  {it.s}
                  {it.alert ? " · watch closely" : ""}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* veterinary milestones */}
        <div className="card">
          <div className="card-head">
            <h3>Veterinary milestones · Zarina</h3>
            <Stethoscope size={18} color="var(--text-secondary)" />
          </div>
          {[
            { t: "Twin-check scan", s: "Day 14–16 · done", done: true },
            { t: "Heartbeat scan", s: "Day 25–30 · done", done: true },
            { t: "Mid-term check", s: "Day 300 · scheduled", done: false },
            { t: "Pre-foaling prep", s: "Day 320 · mammary, waxing-up", done: false },
            { t: "Milk-calcium test", s: "nightly near term", done: false },
          ].map((it, i) => (
            <div className="row" key={i} style={{ marginBottom: 8, padding: "12px 14px" }}>
              {it.done ? (
                <CheckCircle2 size={18} color="var(--positive)" />
              ) : (
                <Circle size={18} color="var(--text-faint)" />
              )}
              <div className="grow">
                <b style={{ fontSize: 14 }}>{it.t}</b>
                <span>{it.s}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* newborn foal baseline note */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="flex gap-md center wrap">
          <div className="chip">
            <Baby size={20} />
          </div>
          <div className="grow">
            <b style={{ fontSize: 15, color: "var(--ink)" }}>Newborn foal baseline</b>
            <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              Foals nurse frequently and sleep in short bursts — they get their own baseline, not an adult one. A sudden
              drop in nursing frequency or activity is one of the highest-value early-warning signals.
            </p>
          </div>
          <div className="flex gap-sm">
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--ink)" }}>—</div>
              <span className="muted" style={{ fontSize: 11 }}>
                <Clock size={11} /> awaiting birth
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
