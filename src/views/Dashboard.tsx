"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Droplet,
  Moon,
  Bell,
  Play,
  ChevronRight,
  AlertTriangle,
  Clock,
  Thermometer,
  Wind,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { StatCard, RadialGauge, Sparkline, statusColor, Modal, riskScore, riskBand } from "../components/ui";
import { yardSlots, breedingMares, highlight } from "../data/mock";
import { useStable } from "../store";
import { getCoverage, type CoverageRow } from "../data/api";

/** One yard-wide average. Says "needs <sensor>" rather than showing a zero. */
function YardAvg({
  icon,
  label,
  value,
  unit,
  need,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  unit?: string;
  need: string;
}) {
  return (
    <div className="setting-row" style={{ alignItems: "center" }}>
      <div className="info">
        <b style={{ fontSize: 13 }}>
          {value === null ? (
            <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>Not measured</span>
          ) : (
            <>
              {value.toFixed(1)}
              {unit && <small style={{ fontSize: 11, marginLeft: 2 }}>{unit}</small>}
            </>
          )}
        </b>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          {icon} {value === null ? `${label} · needs ${need}` : label}
        </span>
      </div>
    </div>
  );
}

/** Mean of the values a metric actually has, ignoring days with no sensor. */
function avg(xs: (number | null)[]): number | null {
  const v = xs.filter((n): n is number => n !== null && Number.isFinite(n));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export default function Dashboard() {
  const router = useRouter();
  const nav = (to: string) => router.push(to);
  const { horses, series, alerts } = useStable();
  // Lead with whoever actually needs attention, not whoever happens to be first.
  const rank = { urgent: 0, watch: 1, calm: 2 } as Record<string, number>;
  const focus = [...horses].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))[0];
  // A "labour detected NOW" banner is the loudest claim on this screen. It may
  // only appear when something actually detected it: a mare flagged in the
  // breeding records AND a live alert to back it. Foaling has no sensor yet,
  // so on a camera-only install this correctly stays quiet and shows the due
  // list instead of a red alarm nobody raised.
  const flaggedMare = breedingMares.find((m) => m.status === "labour");
  const labourAlert = alerts.find(
    (a) => /foal|labour|labor/i.test(`${a.type} ${a.detail}`) && a.severity === "alert",
  );
  const labourMare = flaggedMare && labourAlert ? flaggedMare : undefined;
  const nextDue = [...breedingMares].sort((a, b) => a.daysToDue - b.daysToDue)[0];
  const count = (s: string) => horses.filter((h) => h.status === s).length;
  const [clip, setClip] = useState(false);
  const star = horses.find((h) => h.name === highlight.horse) ?? horses[0];
  const blindness = (h: (typeof horses)[number]) =>
    h.monitoring === "no-data" ? 2 : h.monitoring === "offline" ? 1 : 0;
  const topRisk = [...horses]
    .sort((a, b) => blindness(b) - blindness(a) || riskScore(b) - riskScore(a))
    .slice(0, 3);

  // What the cameras are actually telling us right now.
  // Only aimed cameras count: an un-aimed one reads coat or wall, and a single
  // 31 °C "body temperature" would drag the yard average into hypothermia.
  const aimed = horses.filter((h) => h.vitals?.calibrated !== false);
  const unaimed = horses.filter((h) => h.vitals?.calibrated === false).length;
  const temps = aimed.map((h) => h.vitals?.bodyTempC).filter((n): n is number => n != null);
  const resps = aimed.map((h) => h.vitals?.respRateBpm).filter((n): n is number => n != null);
  const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  const avgResp = resps.length ? resps.reduce((a, b) => a + b, 0) / resps.length : null;

  // Reporting health. A horse we stopped hearing from is the failure mode that
  // matters most: silence must never be mistaken for a calm horse.
  const reporting = horses.filter((h) => (h.monitoring ?? "live") === "live").length;
  const silent = horses.length - reporting;

  const avgRest = avg(series.rest ?? []);
  const avgWater = avg(series.water ?? []);

  const weekAlerts = alerts.length;
  const openAlerts = alerts.filter((a) => !a.acknowledged).length;

  // Honest coverage: how much of the client's 12 points has a live source today.
  const [coverage, setCoverage] = useState<CoverageRow[] | null>(null);
  useEffect(() => {
    let stop = false;
    getCoverage().then((r) => !stop && setCoverage(r));
    return () => {
      stop = true;
    };
  }, []);

  const points = new Map<number, { live: boolean; model: boolean }>();
  for (const r of coverage ?? []) {
    const p = points.get(r.point) ?? { live: false, model: false };
    if (r.status === "available") p.live = true;
    if (r.status === "model-pending") p.model = true;
    points.set(r.point, p);
  }
  const livePoints = [...points.values()].filter((p) => p.live).length;
  const modelPoints = [...points.values()].filter((p) => !p.live && p.model).length;

  // Incidents for the focus horse, from real alerts — never invented.
  const focusAlerts = alerts
    .filter((a) => a.horse === focus?.name)
    .slice(0, 4);

  return (
    <div className="dash-grid">
      {/* top row: 3 stat cards */}
      <StatCard
        icon={<Activity size={20} />}
        label={silent ? `Reporting now · ${silent} silent` : "Horses reporting now"}
        value={`${reporting}/${horses.length}`}
        spark={series.monitored ?? []}
        sparkType="bar"
      />
      <StatCard
        icon={<Thermometer size={20} />}
        label={unaimed ? `Avg body temperature · ${unaimed} un-aimed camera${unaimed > 1 ? "s" : ""} excluded` : "Avg body temperature"}
        value={avgTemp === null ? null : avgTemp.toFixed(1)}
        unit="°C"
        spark={series.bodyTemp ?? []}
        missingNote="no camera reading yet"
      />
      <StatCard
        icon={<Wind size={20} />}
        label="Avg respiratory rate"
        value={avgResp === null ? null : avgResp.toFixed(0)}
        unit="bpm"
        spark={series.respRate ?? []}
        sparkColor="var(--accent-strong)"
        missingNote="no camera reading yet"
      />

      {/* focus horse profile card */}
      <div className="card span-1">
        <div className="card-head">
          <h3>Needs attention</h3>
          {/* This card is chosen purely by status, and silence itself raises a
              "watch"/"urgent" status via the monitoring-gap rule — so it was
              possible (and, in the camera-only demo, the normal case) to show
              a horse we have never heard from with a "Live" badge sitting
              directly above a "No sensor data has ever been received" banner. */}
          {(focus.monitoring ?? "live") === "live" ? (
            <span className="pill alert">Live</span>
          ) : (
            <span className="pill muted">No data</span>
          )}
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
      <div className="card span-1 fill">
        <div className="card-head">
          <h3>Incident timeline · {focus.name}</h3>
          <span className="sub">{focusAlerts.length ? "Recent" : "Clear"}</span>
        </div>
        <div className="fill-body">
        {focusAlerts.length === 0 ? (
          <p className="muted" style={{ fontSize: 12.5, padding: "18px 0" }}>
            No incidents recorded for {focus.name}. This panel shows real alerts as they
            fire — it stays empty rather than showing an example.
          </p>
        ) : (
          <div className="timeline">
            {focusAlerts.map((a) => (
              <div className="tl-item" key={a.id}>
                <div className={`tl-dot ${a.severity === "alert" ? "alert" : a.acknowledged ? "done" : "pending"}`} />
                <div className="tl-body">
                  <b>{a.type}</b>
                  <span>
                    {a.time} · {a.detail}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>

      {/* stress gauge */}
      <div className="card span-1 fill">
        <div className="card-head">
          <h3>Stress level</h3>
          <span className={`pill ${focus.stress === null ? "muted" : focus.stress === "High" ? "alert" : focus.stress === "Medium" ? "warn" : "ok"}`}>
            {focus.stress ?? "no sensor"}
          </span>
        </div>
        <div className="fill-body">
        <RadialGauge
          value={focus.stress === null ? 0 : focus.stress === "High" ? 82 : focus.stress === "Medium" ? 52 : 22}
          display={focus.stress ?? "—"}
          label={
            focus.stress === null
              ? `${focus.name} · needs an activity sensor`
              : `${focus.name} · 5-min macro-movement`
          }
          color={
            focus.stress === null
              ? "var(--text-secondary)"
              : focus.stress === "High"
                ? "var(--alert)"
                : focus.stress === "Medium"
                  ? "var(--warn)"
                  : "var(--positive)"
          }
        />
        </div>
      </div>

      {/* highlights feature card */}
      <div className="feature span-1">
        <div>
          <span className="pill" style={{ background: "rgba(255,255,255,0.22)", color: "#fff" }}>
            Highlights
          </span>
          <h3 style={{ marginTop: 12 }}>{highlight.title}</h3>
          <p>{highlight.caption}</p>
        </div>
        <button className="play" onClick={() => setClip(true)} title="Play highlight">
          <Play size={20} fill="currentColor" />
        </button>
        <button
          className="thumb"
          onClick={() => setClip(true)}
          title="Play highlight"
          style={{ backgroundImage: `url(${star.photo})` }}
        >
          <Play size={34} color="#fff" fill="#fff" />
        </button>
      </div>

      {/* yard map / triage preview (tall, full height right) */}
      <div className="card span-1">
        <div className="card-head">
          <h3>Yard map</h3>
          <button className="sub" style={{ color: "var(--accent)", fontWeight: 600 }} onClick={() => nav("/yard")}>
            Open <ChevronRight size={13} style={{ verticalAlign: "-2px" }} />
          </button>
        </div>
        <div className="yardmap">
          {yardSlots(horses).map((s) => (
            <div
              key={s.id}
              className="stall"
              style={{ left: `${s.x}%`, top: `${s.y}%`, cursor: "pointer" }}
              title={s.name}
              onClick={() => nav(`/horses/${s.id}`)}
            >
              <span className="ind" style={{ background: statusColor(s.status) }} />
              {s.name}
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Barn A · B · C — {horses.length} boxes monitored
        </p>
        <div className="flex gap-sm" style={{ marginTop: 14, flexWrap: "wrap" }}>
          <span className="pill ok">{count("calm")} calm</span>
          <span className="pill warn">{count("watch")} watch</span>
          <span className="pill alert">{count("urgent")} urgent</span>
        </div>
      </div>

      {/* weekly alerts mini */}
      <div className="card span-1 fill">
        <div className="card-head">
          <h3>Alerts this week</h3>
          <Bell size={17} color="var(--text-secondary)" />
        </div>
        <div className="fill-body">
          <div className="flex between center">
            <div>
              <div style={{ fontSize: 40, fontFamily: "var(--font-display)", fontWeight: 700, color: "var(--ink)", lineHeight: 1 }}>
                {weekAlerts}
              </div>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {weekAlerts - openAlerts} acknowledged · {openAlerts} open
              </span>
            </div>
            <Sparkline
              data={(series.alerts ?? []).filter((n): n is number => n !== null)}
              type="bar"
              color="var(--alert)"
            />
          </div>

          {/* Breakdown by severity — what is actually open matters more than
              the total, and an unacknowledged urgent is the one to act on. */}
          <div style={{ marginTop: 18 }}>
            {([
              { k: "alert", label: "Urgent", color: "var(--alert)" },
              { k: "warn", label: "Watch", color: "var(--warn)" },
              { k: "ok", label: "Informational", color: "var(--positive)" },
            ] as const).map((row) => {
              const n = alerts.filter((a) => a.severity === row.k).length;
              const open = alerts.filter((a) => a.severity === row.k && !a.acknowledged).length;
              const pct = weekAlerts ? (n / weekAlerts) * 100 : 0;
              return (
                <div key={row.k} style={{ marginBottom: 10 }}>
                  <div className="flex between center" style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{row.label}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
                      {n}
                      {open > 0 && (
                        <em style={{ fontStyle: "normal", color: row.color, marginLeft: 5 }}>{open} open</em>
                      )}
                    </span>
                  </div>
                  <div className="progress" style={{ height: 5 }}>
                    <i style={{ width: `${pct}%`, background: row.color }} />
                  </div>
                </div>
              );
            })}
          </div>

          <button
            className="btn-ghost accent"
            style={{ width: "100%", marginTop: 4 }}
            onClick={() => nav("/alerts")}
          >
            Review alerts
          </button>
        </div>
      </div>

      {/* foaling watch card */}
      <div className={`foaling span-2 ${labourMare ? "labour" : ""}`}>
        <div className="card-head">
          <h3>Foaling watch</h3>
          {labourMare ? (
            <span className="pill alert">Labour detected</span>
          ) : (
            <span className="pill muted">Monitoring by records only</span>
          )}
        </div>
        <div className="flex between center wrap" style={{ gap: 20 }}>
          <div>
            {labourMare ? (
              <>
                <p className="muted" style={{ fontSize: 13 }}>
                  {labourMare.name} · sired by {labourMare.stallion}
                </p>
                <div className="countdown" style={{ color: "var(--alert)" }}>
                  NOW
                </div>
                <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                  {labourMare.note}
                </p>
              </>
            ) : (
              <>
                <p className="muted" style={{ fontSize: 13 }}>
                  {breedingMares.length} {breedingMares.length === 1 ? "mare" : "mares"} in foal · no
                  labour signs detected
                </p>
                <div className="countdown" style={{ color: "var(--ink)" }}>
                  {!nextDue ? "—" : nextDue.daysToDue <= 0 ? "Due now" : `${nextDue.daysToDue}d`}
                </div>
                <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                  {nextDue ? `${nextDue.name} · ${nextDue.stage}` : "No mares currently in foal"}
                </p>
                {/* the rest of the book, so the panel carries the whole picture
                    rather than one mare and a stretch of empty card */}
                <div className="flex gap-sm" style={{ marginTop: 14, flexWrap: "wrap" }}>
                  {breedingMares.slice(0, 4).map((m) => (
                    <span key={m.id} className="pill muted" style={{ fontSize: 11.5 }}>
                      {m.name} · {m.daysToDue <= 0 ? "due" : `${m.daysToDue}d`}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="flex gap-md center">
            {labourMare && nextDue && (
              <div style={{ textAlign: "center" }}>
                <div className="flex center" style={{ gap: 6, color: "var(--text-secondary)", fontSize: 12 }}>
                  <Clock size={14} /> Next due
                </div>
                <b style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--ink)" }}>
                  {nextDue.name} · {nextDue.daysToDue}d
                </b>
              </div>
            )}
            <button className="btn-ghost accent" onClick={() => nav("/breeding")}>
              Open foaling watch
            </button>
          </div>
        </div>
      </div>

      {/* predictive risk radar */}
      <div className="card span-1">
        <div className="card-head">
          <h3>Risk radar</h3>
          <button className="sub" style={{ color: "var(--accent)", fontWeight: 600 }} onClick={() => nav("/horses")}>
            All
          </button>
        </div>
        {topRisk.map((h) => {
          // A horse we have never heard from is not low-risk, it is unknown.
          // Scoring it "36 · Low" is the same mistake as reading silence as calm.
          const blind = h.monitoring === "no-data" || h.monitoring === "offline";
          const r = riskScore(h);
          const b = riskBand(r);
          return (
            <div key={h.id} onClick={() => nav(`/horses/${h.id}`)} style={{ cursor: "pointer", marginBottom: 12 }}>
              <div className="flex between center" style={{ marginBottom: 4 }}>
                <b style={{ fontSize: 13.5, color: "var(--ink)" }}>{h.name}</b>
                <span
                  style={{
                    color: blind ? "var(--text-secondary)" : b.color,
                    fontWeight: 700,
                    fontSize: 12.5,
                  }}
                >
                  {blind ? "no data" : `${r} · ${b.label}`}
                </span>
              </div>
              <div className="progress" style={{ height: 7 }}>
                {blind ? (
                  <i
                    style={{
                      width: "100%",
                      background:
                        "repeating-linear-gradient(135deg, var(--border) 0 6px, transparent 6px 12px)",
                    }}
                  />
                ) : (
                  <i style={{ width: `${r}%`, background: b.color }} />
                )}
              </div>
            </div>
          );
        })}
        <p className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
          Model estimate — context, not diagnosis.
        </p>
      </div>

      {/* what this install actually measures — the honest answer, from the
          backend's own taxonomy so it cannot drift from what we really support */}
      <div className="card span-3">
        <div className="card-head">
          <h3>What we monitor here</h3>
          <button className="sub" style={{ color: "var(--accent)", fontWeight: 600 }} onClick={() => nav("/settings")}>
            Detail <ChevronRight size={13} style={{ verticalAlign: "-2px" }} />
          </button>
        </div>

        {coverage && (
          <>
            <div className="flex center gap-sm" style={{ marginBottom: 10 }}>
              <ShieldCheck size={17} color="var(--positive)" />
              <b style={{ fontSize: 15, color: "var(--ink)" }}>
                {livePoints} of {points.size} monitoring points live
              </b>
              {modelPoints > 0 && <span className="pill muted">{modelPoints} awaiting model</span>}
            </div>
            <div className="progress" style={{ height: 7, marginBottom: 16 }}>
              <i style={{ width: `${(livePoints / Math.max(1, points.size)) * 100}%`, background: "var(--positive)" }} />
            </div>
          </>
        )}

        <div className="grid cols-3" style={{ gap: 10 }}>
          <YardAvg icon={<Moon size={15} />} label="Avg daily rest" value={avgRest} unit="h" need="IMU" />
          <YardAvg icon={<Droplet size={15} />} label="Avg water visits" value={avgWater} need="flow meter" />
          <YardAvg
            icon={<Sun size={15} />}
            label="Avg time outside"
            value={avg(series.outside ?? [])}
            unit="h"
            need="turnout model"
          />
        </div>
      </div>

      <Modal open={clip} onClose={() => setClip(false)} title={highlight.title} wide>
        <div className="cam" style={{ backgroundImage: `url(${star.photo})` }}>
          <span className="live" style={{ background: "rgba(0,0,0,0.55)" }}>
            HIGHLIGHT
          </span>
          <span className="ts">{highlight.time}</span>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
          {highlight.caption}
        </p>
      </Modal>
    </div>
  );
}
