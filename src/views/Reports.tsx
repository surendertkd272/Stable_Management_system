"use client";
// Reports: a horse over a window (the last hour, last night, a day, a week, a
// month) — built by the same server code as the session report (/api/session),
// so the Live page's "Last hour report" and this page always agree for the
// same window. The PDF is the same designed client report.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { FileText, Download, Share2, Table, Loader2, ExternalLink } from "lucide-react";
import { useStable, useToast } from "../store";
import * as api from "../data/api";
import { exportReadingsCsv, listDailyReports, downloadDailyReport, type DailyReports } from "../data/api";
import { useAuth } from "../auth";
import { FEATURES } from "../features";
import { details } from "../components/ui";
import { SessionBody, readNotes } from "./Session";

type Range = "hour" | "night" | "day" | "week" | "month";
const RANGES: { key: Range; label: string }[] = [
  { key: "hour", label: "Last hour" },
  { key: "night", label: "Last night" },
  { key: "day", label: "24 hours" },
  { key: "week", label: "7 days" },
  { key: "month", label: "30 days" },
];
const H = 3600e3;
/** The window for a range, ending now (the night: 18:00–06:00, or so far before 06:00). */
function windowOf(range: Range): { from: string; to: string } {
  const now = new Date();
  if (range === "night") {
    const morning = new Date(now); morning.setHours(6, 0, 0, 0);
    const to = now < morning ? now : morning;
    const from = new Date(morning); from.setDate(from.getDate() - 1); from.setHours(18, 0, 0, 0);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const span = { hour: H, day: 24 * H, week: 7 * 24 * H, month: 30 * 24 * H }[range];
  return { from: new Date(now.getTime() - span).toISOString(), to: now.toISOString() };
}

export default function Reports() {
  const { horses } = useStable();
  const notify = useToast();
  const params = useSearchParams();
  const [range, setRange] = useState<Range>((params.get("range") as Range) || "week");
  const [horseId, setHorseId] = useState(
    params.get("horse") ?? (horses.find((h) => h.monitoring && h.monitoring !== "no-data") ?? horses[0])?.id ?? "");
  const horse = horses.find((h) => h.id === horseId) ?? horses[0];
  const [stamp, setStamp] = useState(0);                    // "Refresh" rebuilds the window up to now
  const win = useMemo(() => windowOf(range), [range, stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  const [rep, setRep] = useState<api.SessionReport | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<"" | "pdf" | "open">("");

  useEffect(() => {
    if (!horse) return;
    let stop = false;
    setRep(null); setErr("");
    api.getSession(horse.id, win.from, win.to).then((r) => { if (!stop) (r.ok ? setRep(r.data) : setErr(r.error)); });
    return () => { stop = true; };
  }, [horse?.id, win]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!horse) {
    return <div className="card muted">No horses yet — add one with “Add horse”.</div>;
  }
  const label = RANGES.find((r) => r.key === range)!.label.toLowerCase();

  const summaryText = () => !rep ? "" : [
    `${horse.name} — EquiCare report, ${label}`,
    details(horse.breed, horse.sex, `Stall ${horse.stall}`),
    `${new Date(rep.window.from).toLocaleString("en-GB")} – ${new Date(rep.window.to).toLocaleString("en-GB")}; camera data in ${rep.coverage.minutesWithData} of ${rep.window.minutes} minutes.`,
    "",
    ...rep.points.map((p) => `${p.n}. ${p.label}: ${p.summary}`),
    "",
    rep.alerts.length ? `Open alerts: ${rep.alerts.map((a) => a.type).join("; ")}.` : "No open alerts.",
    "",
    "A screening summary from the stall camera, to support — not replace — veterinary judgement.",
  ].join("\n");

  const pdf = async () => {
    setBusy("pdf");
    const e = await api.downloadClientReportPdf(horse.id, win.from, win.to, readNotes(horse.id));
    setBusy("");
    if (e) notify(e);
  };
  const open = async () => {
    setBusy("open");
    const e = await api.openClientReport(horse.id, win.from, win.to, readNotes(horse.id));
    setBusy("");
    if (e) notify(e);
  };
  const csv = async () => {
    const days = Math.max(1, Math.ceil((Date.parse(win.to) - Date.parse(win.from)) / (24 * H)));
    notify((await exportReadingsCsv(horse.id, days)) ? `Exported ${horse.name}'s readings` : "Could not export the readings");
  };
  const share = async () => {
    const text = summaryText();
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string }) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: `${horse.name} — EquiCare report`, text }); } catch { /* cancelled */ }
    } else {
      try { await navigator.clipboard.writeText(text); notify("Report summary copied — paste it to the vet"); } catch { notify("Could not copy the summary"); }
    }
  };

  return (
    <>
      <div className="flex between center wrap" style={{ marginBottom: 18, gap: 12 }}>
        <div className="tabs">
          {RANGES.map((r) => (
            <button key={r.key} className={range === r.key ? "on" : ""} onClick={() => { setRange(r.key); setStamp((n) => n + 1); }}>{r.label}</button>
          ))}
        </div>
        <div className="flex gap-sm wrap">
          {horses.map((h) => (
            <button key={h.id} className={horseId === h.id ? "btn-ghost accent" : "btn-ghost"} onClick={() => setHorseId(h.id)}>{h.name}</button>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="flex between center wrap" style={{ gap: 12 }}>
          <div className="flex gap-md center">
            <div className="chip"><FileText size={20} /></div>
            <div>
              <b style={{ fontSize: 17, color: "var(--ink)", fontFamily: "var(--font-display)" }}>{horse.name} — {label}</b>
              <p className="muted" style={{ fontSize: 13 }}>{details(horse.breed, horse.sex, `Stall ${horse.stall}`, FEATURES.horseOwner ? `for ${horse.owner}` : null)}</p>
            </div>
          </div>
          <div className="flex gap-sm wrap">
            <button className="btn-ghost" disabled={!rep} onClick={share}><Share2 size={15} /> Share to vet</button>
            <button className="btn-ghost" onClick={csv} title="Raw readings a vet can re-analyse"><Table size={15} /> Export CSV</button>
            <button className="btn-ghost" disabled={!rep || !!busy} onClick={open}>
              {busy === "open" ? <Loader2 className="spin" size={15} /> : <ExternalLink size={15} />} Client report
            </button>
            <button className="btn-primary" disabled={!rep || !!busy} onClick={pdf}>
              {busy === "pdf" ? <Loader2 className="spin" size={15} /> : <Download size={16} />} Export PDF
            </button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
          The same report as the session report (<Link href={`/session?horse=${encodeURIComponent(horse.id)}&from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}`} style={{ color: "var(--accent)" }}>open this window there</Link>) — one set of measurements, whichever page you read it on.
        </p>
      </div>

      {err && <div className="card">Could not build the report: {err}</div>}
      {!rep && !err && <div className="card"><Loader2 className="spin" size={18} /></div>}
      {rep && <SessionBody rep={rep} title="Report" />}
      <NightlyReports />
    </>
  );
}

/** The PDFs made each morning of the night before (Settings → Nightly reports). */
function NightlyReports() {
  const { user, authRequired } = useAuth();
  const notify = useToast();
  const [d, setD] = useState<DailyReports | null>(null);
  const staff = !authRequired || user?.role === "admin" || user?.role === "staff";
  useEffect(() => { if (staff) listDailyReports().then((r) => r.ok && setD(r.data)); }, [staff]);
  if (!staff || !d) return null;
  const day = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-head">
        <h3>Nightly reports</h3>
        <span className="sub">each morning, the night 18:00–06:00</span>
      </div>
      {!d.reports.length ? (
        <p className="muted" style={{ fontSize: 13 }}>
          None yet. Turn on <Link href="/settings" style={{ color: "var(--accent)" }}>Settings → Nightly reports</Link> and a PDF for each horse watched in the night is saved every morning.
        </p>
      ) : d.reports.slice(0, 14).map((r) => (
        <div key={r.day} className="flex center wrap" style={{ gap: 8, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
          <b style={{ minWidth: 110, fontSize: 13 }}>{day(r.day)}</b>
          {r.files.map((f) => (
            <button key={f.name} className="btn-ghost" onClick={async () => { if (!(await downloadDailyReport(r.day, f.name))) notify("Could not download the report"); }}>
              <Download size={14} /> {f.name.replace(/\.pdf$/, "")}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
