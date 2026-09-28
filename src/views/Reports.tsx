"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  FileText,
  Download,
  Share2,
  Moon,
  Droplet,
  Activity,
  Sun,
  Table,
  Thermometer,
  Wind,
} from "lucide-react";
import { useStable, useToast } from "../store";
import { getSeries, exportReadingsCsv } from "../data/api";
import { Sparkline, details } from "../components/ui";

// "average of 5 days with data" — how much of the range a figure rests on.
const daysNote = (xs: (number | null)[] | undefined, range: string) => {
  const n = (xs ?? []).filter((v) => v !== null && v !== undefined).length;
  return n ? `average of ${n} of ${range} days with data` : `no data in the last ${range} days`;
};

export default function Reports() {
  const { horses, alerts, series: storeSeries } = useStable();
  const notify = useToast();
  const params = useSearchParams();
  const [range, setRange] = useState<"7" | "30">("7");
  // A horse that has reported at least once, rather than the first in the list.
  const [horseId, setHorseId] = useState(
    params.get("horse") ?? (horses.find((h) => h.monitoring && h.monitoring !== "no-data") ?? horses[0]).id);
  const horse = horses.find((h) => h.id === horseId) ?? horses[0];

  // This horse's own daily series for the range (the yard's averages used to
  // stand in, so every horse showed the same trend lines). Demo mode, with no
  // backend, keeps the bundled series.
  const [ranged, setRanged] = useState<Record<string, (number | null)[]> | null>(null);
  useEffect(() => {
    let stop = false;
    setRanged(null);
    getSeries(Number(range), horse.id).then((s) => {
      if (!stop && s) setRanged(s);
    });
    return () => {
      stop = true;
    };
  }, [range, horse.id]);
  const series: Record<string, (number | null)[]> = ranged ?? storeSeries;

  // Behaviour flags (vices, possible rolls) — only when the camera watched
  // behaviour in this range; otherwise not measured, never "0".
  const behaviourMeasured = (series.activity ?? []).some((v) => v !== null);
  const flags = behaviourMeasured ? (series.flags ?? []).reduce<number>((a, v) => a + (v ?? 0), 0) : null;
  const openAlerts = alerts.filter((a) => a.horse === horse.name && !a.acknowledged);
  const unsensed = [horse.rest === null && "rest", horse.water === null && "water visits", horse.outside === null && "time outside"].filter(Boolean);

  // What the vet summary says — every sentence from the data above.
  const facts = [
    horse.vitals?.bodyTempC != null
      ? `Latest eye-surface temperature ${horse.vitals.bodyTempC.toFixed(1)} °C${horse.vitals.calibrated === false ? " (camera not aimed — not used for alerts)" : ""}.`
      : "Body temperature was not measured.",
    horse.vitals?.respRateBpm != null ? `Latest respiratory rate ${Math.round(horse.vitals.respRateBpm)} breaths/min.` : "Respiratory rate was not measured.",
    flags === null ? `Behaviour was not measured by the camera in the last ${range} days.`
      : flags ? `${flags} behaviour flag${flags === 1 ? "" : "s"} (weaving, box walking, head tossing or a possible roll) in the last ${range} days — check them on the recording.`
        : `No behaviour flags in the last ${range} days.`,
    openAlerts.length ? `Open alerts: ${openAlerts.map((a) => a.type).join("; ")}.` : "No open alerts.",
    ...(unsensed.length ? [`No sensor for ${unsensed.join(", ")} on this install — not reported.`] : []),
  ];

  const summaryText = () =>
    [
      `${horse.name} — ${range}-day vet-ready report`,
      details(horse.breed, horse.sex, `Stall ${horse.stall}`, `Owner: ${horse.owner}`),
      ``,
      `Avg rest / night:        ${horse.rest ?? "not measured (no sensor)"}`,
      `Avg water visits / day:  ${horse.water ?? "not measured (no sensor)"}`,
      `Avg time outside box:    ${horse.outside ?? "not measured (no sensor)"}`,
      `Behaviour flags (${range}d):   ${flags ?? "not measured"}`,
      ``,
      ...facts,
      ``,
      "This summary reflects camera-observed behaviour only and is intended to support, not replace, veterinary judgement.",
    ].join("\n");

  const exportPdf = () => {
    const w = window.open("", "_blank", "width=760,height=920");
    if (!w) {
      notify("Allow pop-ups to export the report");
      return;
    }
    w.document.write(
      `<html><head><title>${horse.name} – EquiCare report</title>` +
        `<style>body{font-family:system-ui,-apple-system,sans-serif;padding:48px;color:#1c1b29;line-height:1.7}` +
        `h1{font-size:22px;margin:0 0 4px}small{color:#6b6980}pre{white-space:pre-wrap;font-family:inherit;font-size:14px;margin-top:24px}</style>` +
        `</head><body><h1>BSV EquiCare</h1><small>${range}-day behavioural report</small>` +
        `<pre>${summaryText()}</pre>` +
        `<script>window.onload=function(){window.print()}<\/script></body></html>`
    );
    w.document.close();
    notify("Opening print dialog…");
  };

  const exportCsv = async () => {
    const ok = await exportReadingsCsv(horse.id, Number(range));
    notify(ok
      ? `Exported ${range} days of ${horse.name}'s readings`
      : "Raw data export needs the backend — not available in demo mode");
  };

  const shareToVet = async () => {
    const text = summaryText();
    const navAny = navigator as Navigator & { share?: (d: { title: string; text: string }) => Promise<void> };
    if (navAny.share) {
      try {
        await navAny.share({ title: `${horse.name} — EquiCare report`, text });
        notify("Report shared");
      } catch {
        /* user cancelled the share sheet */
      }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        notify("Report summary copied to clipboard");
      } catch {
        notify("Could not copy summary");
      }
    }
  };

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
                {details(horse.breed, horse.sex, `Stall ${horse.stall}`, `generated for ${horse.owner}`)}
              </p>
            </div>
          </div>
          <div className="flex gap-sm">
            <button className="btn-ghost" onClick={shareToVet}>
              <Share2 size={15} /> Share to vet
            </button>
            <button className="btn-ghost" onClick={exportCsv} title="Raw readings a vet can re-analyse">
              <Table size={15} /> Export CSV
            </button>
            <button className="btn-primary" onClick={exportPdf}>
              <Download size={16} /> Export PDF
            </button>
          </div>
        </div>
      </div>

      {/* The camera-derived vitals lead: on a camera-only install these are the
          only clinically useful numbers in the report, and burying them under
          three "not measured" panels made the report look emptier than it is. */}
      <div className="grid cols-2" style={{ marginBottom: 24 }}>
        <ReportMetric
          icon={<Thermometer size={18} />}
          label="Body temperature"
          value={horse.vitals?.bodyTempC == null ? null : horse.vitals.bodyTempC.toFixed(1) + " °C"}
          note="Eye-surface thermal, latest reading · ±2 °C absolute"
          spark={series.bodyTemp ?? []}
        />
        <ReportMetric
          icon={<Wind size={18} />}
          label="Respiratory rate"
          value={horse.vitals?.respRateBpm == null ? null : Math.round(horse.vitals.respRateBpm) + " bpm"}
          note={
            horse.vitals?.respConfidence == null
              ? "Nostril thermal oscillation"
              : `Nostril thermal · rhythm confidence ${Math.round(horse.vitals.respConfidence * 100)}%`
          }
          spark={series.respRate ?? []}
          color="var(--accent-strong)"
        />
        <ReportMetric icon={<Moon size={18} />} label="Avg rest / night" value={horse.rest} note={daysNote(series.rest, range)} spark={series.rest ?? []} />
        <ReportMetric icon={<Droplet size={18} />} label="Avg water visits / day" value={horse.water === null ? null : String(horse.water)} note={daysNote(series.water, range)} spark={series.water ?? []} type="bar" />
        <ReportMetric icon={<Sun size={18} />} label="Avg time outside box" value={horse.outside} note={daysNote(series.outside, range)} spark={series.outside ?? []} />
        <ReportMetric icon={<Activity size={18} />} label="Behaviour flags" value={flags === null ? null : String(flags)}
          note={`${range}-day total · weaving, box walking, head tossing, possible rolls — check on the recording`}
          missing="no camera behaviour data in this period" spark={series.flags ?? []} type="bar" color="var(--alert)" />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Summary for your vet</h3>
          <span className="pill muted">Context, not diagnosis</span>
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--ink-soft)" }}>
          {facts.join(" ")}{" "}
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
  missing = "no sensor for this point yet",
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  note: string;
  missing?: string;
  spark: (number | null)[];
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
        {/* Plot only real points, and only when there are at least two. One
            reading drawn as a line invents a trend out of a single sample. */}
        {(() => {
          const pts = spark.filter((n): n is number => n !== null);
          return value !== null && pts.length > 1 ? (
            <Sparkline data={pts} type={type} color={color} w={80} h={30} />
          ) : null;
        })()}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: value === null ? 18 : 32,
          fontWeight: 700,
          color: value === null ? "var(--text-secondary)" : "var(--ink)",
          marginTop: 14,
        }}
      >
        {value ?? "Not measured"}
      </div>
      <span className="muted" style={{ fontSize: 12.5 }}>
        {value === null ? missing : note}
      </span>
    </div>
  );
}
