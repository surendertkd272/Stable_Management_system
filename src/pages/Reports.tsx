import { useState } from "react";
import { FileText, Download, Share2, Moon, Droplet, Activity, Sun } from "lucide-react";
import { horses, series } from "../data/mock";
import { Sparkline } from "../components/ui";

export default function Reports() {
  const [range, setRange] = useState<"7" | "30">("7");
  const [horseId, setHorseId] = useState(horses[0].id);
  const horse = horses.find((h) => h.id === horseId)!;

  return (
    <>
      <div className="flex between center wrap" style={{ marginBottom: 18, gap: 12 }}>
        <div className="tabs">
          <button className={range === "7" ? "on" : ""} onClick={() => setRange("7")}>
            7-day
          </button>
          <button className={range === "30" ? "on" : ""} onClick={() => setRange("30")}>
            30-day
          </button>
        </div>
        <div className="flex gap-sm wrap">
          {horses.map((h) => (
            <button
              key={h.id}
              className={horseId === h.id ? "btn-ghost accent" : "btn-ghost"}
              onClick={() => setHorseId(h.id)}
            >
              {h.name}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="flex between center wrap" style={{ gap: 12 }}>
          <div className="flex gap-md center">
            <div className="chip">
              <FileText size={20} />
            </div>
            <div>
              <b style={{ fontSize: 17, color: "var(--ink)", fontFamily: "var(--font-display)" }}>
                {horse.name} — {range}-day vet-ready report
              </b>
              <p className="muted" style={{ fontSize: 13 }}>
                {horse.breed} · {horse.sex} · Stall {horse.stall} · generated for {horse.owner}
              </p>
            </div>
          </div>
          <div className="flex gap-sm">
            <button className="btn-ghost">
              <Share2 size={15} /> Share to vet
            </button>
            <button className="btn-primary">
              <Download size={16} /> Export PDF
            </button>
          </div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginBottom: 24 }}>
        <ReportMetric icon={<Moon size={18} />} label="Avg rest / night" value={horse.rest} note="Stable, within baseline" spark={series.rest} />
        <ReportMetric icon={<Droplet size={18} />} label="Avg water visits / day" value={String(horse.water)} note={range === "30" ? "Slight dip mid-month" : "Consistent"} spark={series.water} type="bar" />
        <ReportMetric icon={<Sun size={18} />} label="Avg time outside box" value={horse.outside} note="Good turnout activity" spark={series.outside} />
        <ReportMetric icon={<Activity size={18} />} label="Stress episodes" value={horse.status === "urgent" ? "5" : "1"} note={`${range}-day total`} spark={series.alerts} type="bar" color="var(--alert)" />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Summary for your vet</h3>
          <span className="pill muted">Context, not diagnosis</span>
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--ink-soft)" }}>
          Over the last {range} days, {horse.name} maintained an average nightly rest of {horse.rest} and{" "}
          {horse.water} water-area visits per day. Time outside the box averaged {horse.outside}.{" "}
          {horse.status === "urgent"
            ? "An elevated cluster of restlessness and lying-up cycling was recorded overnight and flagged as a possible early colic pattern — clinical assessment recommended."
            : "All behavioural signals stayed within this horse's learned baseline, with no incident-level deviations."}{" "}
          This summary reflects camera-observed behaviour only and is intended to support, not replace, veterinary judgement.
        </p>
      </div>
    </>
  );
}

function ReportMetric({
  icon,
  label,
  value,
  note,
  spark,
  type = "line",
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
  spark: number[];
  type?: "line" | "bar";
  color?: string;
}) {
  return (
    <div className="card">
      <div className="flex between center">
        <div className="flex gap-sm center">
          <div className="chip sm">{icon}</div>
          <span className="label" style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
            {label}
          </span>
        </div>
        <Sparkline data={spark} type={type} color={color} w={80} h={30} />
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 700, color: "var(--ink)", marginTop: 14 }}>
        {value}
      </div>
      <span className="muted" style={{ fontSize: 12.5 }}>
        {note}
      </span>
    </div>
  );
}
