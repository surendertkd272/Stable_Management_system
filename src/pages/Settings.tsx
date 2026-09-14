import { useEffect, useState } from "react";
import { Sun, Moon, Globe, RotateCcw, CheckCircle2, Clock } from "lucide-react";
import { useTheme } from "../theme";
import { useStable, useToast } from "../store";
import { getCoverage, type CoverageRow } from "../data/api";

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button className={`switch ${on ? "on" : ""}`} onClick={onClick} aria-pressed={on}>
      <i />
    </button>
  );
}

export default function SettingsPage() {
  const { theme, set } = useTheme();
  const { reset } = useStable();
  const notify = useToast();
  const [toggles, setToggles] = useState({
    whatsapp: true,
    digest: true,
    escalation: true,
    colic: true,
    casting: true,
    birth: true,
    water: true,
    respiratory: true,
    vice: true,
    sleep: true,
    gait: false,
    highlights: false,
  });
  const [sensitivity, setSensitivity] = useState(60);
  const [lang, setLang] = useState<"en" | "hi">("en");

  // An alert toggle is a safety control. Switching one on for a point that has
  // no sensor arms something that can never fire, and the user has no way to
  // know. Readiness comes from /api/coverage, so it tracks what the backend
  // really supports rather than a second list kept in the UI.
  const [coverage, setCoverage] = useState<CoverageRow[] | null>(null);
  useEffect(() => {
    let stop = false;
    getCoverage().then((r) => !stop && setCoverage(r));
    return () => {
      stop = true;
    };
  }, []);
  const sourceStatus = new Map((coverage ?? []).map((r) => [r.source, r.status]));
  /** What each alert needs, and whether that source can produce data today. */
  const readiness = (source: string, need: string) => {
    if (!coverage) return undefined;                     // unknown (no backend)
    const st = sourceStatus.get(source);
    if (st === "available") return undefined;            // ready — no annotation
    return st === "model-pending" ? "model not trained yet" : `needs ${need}`;
  };

  const flip = (k: keyof typeof toggles) => setToggles((t) => ({ ...t, [k]: !t[k] }));

  return (
    <div className="grid cols-2" style={{ alignItems: "start" }}>
      {/* appearance */}
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Appearance</h3>
        <div className="setting-row">
          <div className="info">
            <b>Theme</b>
            <span>Dark mode is the primary night-time view — most critical events happen after dark.</span>
          </div>
          <div className="theme-toggle" style={{ width: 180 }}>
            <button className={theme === "light" ? "on" : ""} onClick={() => set("light")}>
              <Sun size={15} /> Light
            </button>
            <button className={theme === "dark" ? "on" : ""} onClick={() => set("dark")}>
              <Moon size={15} /> Dark
            </button>
          </div>
        </div>
        <div className="setting-row">
          <div className="info">
            <b>Interface language</b>
            <span>Hindi & regional languages for grooms who are present overnight.</span>
          </div>
          <div className="tabs">
            <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>
              <Globe size={14} /> English
            </button>
            <button className={lang === "hi" ? "on" : ""} onClick={() => setLang("hi")}>
              हिंदी
            </button>
          </div>
        </div>
      </div>

      {/* delivery */}
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Alert delivery</h3>
        <Row label="WhatsApp alerts" desc="Send incident alerts to manager & owner." on={toggles.whatsapp} flip={() => flip("whatsapp")} />
        <Row label="Daily digest" desc="A morning summary of overnight activity." on={toggles.digest} flip={() => flip("digest")} />
        <Row
          label="Auto-escalation"
          desc="Unacknowledged alert → manager → on-call → vet."
          on={toggles.escalation}
          flip={() => flip("escalation")}
        />
      </div>

      {/* alert types */}
      <div className="card">
        <h3 style={{ marginBottom: 4 }}>Alert types</h3>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          Greyed-out alerts have no data source on this install yet and cannot fire. They
          switch on by themselves once their sensor or model is in place.
        </p>
        <Row label="Early colic pattern" desc="Behavioural cues vs baseline." on={toggles.colic} flip={() => flip("colic")} blocked={readiness("imu_optical", "IMU tag")} />
        <Row label="Casting detection" desc="Stuck against wall / unable to rise." on={toggles.casting} flip={() => flip("casting")} blocked={readiness("optical", "vision model")} />
        <Row label="Birth alarm" desc="Foaling behaviour from the stall camera." on={toggles.birth} flip={() => flip("birth")} blocked={readiness("optical", "vision model")} />
        <Row label="Low water intake" desc="Water-area visits below baseline." on={toggles.water} flip={() => flip("water")} blocked={readiness("flow_meter", "flow meter")} />
        <Row label="Respiratory (audio)" desc="Coughing & abnormal breathing from audio analysis." on={toggles.respiratory} flip={() => flip("respiratory")} blocked={readiness("optical_audio", "microphone")} />
        <Row label="Stable vices" desc="Weaving, box-walking, crib-biting, wind-sucking." on={toggles.vice} flip={() => flip("vice")} blocked={readiness("optical_audio", "microphone")} />
        <Row label="Sleep deprivation" desc="Chronically low lying-down / REM time." on={toggles.sleep} flip={() => flip("sleep")} blocked={readiness("imu_optical", "IMU tag")} />
        <Row label="Gait & lameness" desc="Movement asymmetry screening (beta)." on={toggles.gait} flip={() => flip("gait")} blocked={readiness("imu_optical", "IMU tag")} />
        <Row label="Highlights" desc="Save shareable stable-life moments." on={toggles.highlights} flip={() => flip("highlights")} blocked={readiness("optical", "vision model")} />
      </div>

      {/* sensitivity + privacy */}
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Sensitivity & calibration</h3>
        <div className="setting-row" style={{ display: "block" }}>
          <div className="info" style={{ marginBottom: 12 }}>
            <b>Alert sensitivity — {sensitivity}%</b>
            <span>Higher catches more but risks noise. A calibration period per horse reduces early false alarms.</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={sensitivity}
            onChange={(e) => setSensitivity(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--accent)" }}
          />
          <div className="flex between" style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 4 }}>
            <span>Calm</span>
            <span>Balanced</span>
            <span>Sensitive</span>
          </div>
        </div>
        <div className="setting-row">
          <div className="info">
            <b>Recording retention</b>
            <span>Clips kept 30 days, then auto-deleted (DPDP-aligned).</span>
          </div>
          <span className="pill muted">30 days</span>
        </div>
        <div className="setting-row">
          <div className="info">
            <b>Staff privacy consent</b>
            <span>Cameras record people too — consent logged for all staff.</span>
          </div>
          <span className="pill ok">On file</span>
        </div>
        <div className="setting-row">
          <div className="info">
            <b>Reset demo data</b>
            <span>Restore the original sample horses, alerts and diary — clears anything you've added.</span>
          </div>
          <button
            className="btn-ghost"
            onClick={() => {
              reset();
              notify("Demo data reset");
            }}
          >
            <RotateCcw size={15} /> Reset
          </button>
        </div>
      </div>

      <CoverageCard />
    </div>
  );
}

/* ---------- 12-point monitoring coverage ----------
   Honest per-point state: which of the client's 12 monitoring points are
   actually sourced today vs awaiting sensor procurement. Driven by
   /api/coverage, so it can never drift from what the backend really supports.
   Hidden entirely when no backend is configured. */
function CoverageCard() {
  const [rows, setRows] = useState<CoverageRow[] | null>(null);

  useEffect(() => {
    let stop = false;
    getCoverage().then((r) => {
      if (!stop) setRows(r);
    });
    return () => {
      stop = true;
    };
  }, []);

  if (!rows || rows.length === 0) return null;

  // group metrics under their monitoring point
  const points = new Map<
    number,
    { labels: string[]; available: boolean; modelPending: boolean; sources: Set<string> }
  >();
  for (const r of rows) {
    const p =
      points.get(r.point) ??
      { labels: [], available: false, modelPending: false, sources: new Set<string>() };
    p.labels.push(r.label);
    if (r.status === "available") p.available = true;
    if (r.status === "model-pending") p.modelPending = true;
    p.sources.add(r.source.replace(/_/g, " "));
    points.set(r.point, p);
  }
  const ordered = [...points.entries()].sort((a, b) => a[0] - b[0]);
  const liveCount = ordered.filter(([, p]) => p.available).length;
  const modelCount = ordered.filter(([, p]) => !p.available && p.modelPending).length;

  return (
    <div className="card" style={{ gridColumn: "1 / -1" }}>
      <div className="card-head">
        <h3>Monitoring coverage</h3>
        <span className="pill accent">
          {liveCount} of {ordered.length} points sourced
          {modelCount > 0 && ` · ${modelCount} awaiting model`}
        </span>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: -4, marginBottom: 14 }}>
        Which of the 12 monitoring points have a live data source today. "Model" means the
        camera is installed but the vision model for that point still needs labelled footage;
        "pending" means the sensor itself is not procured yet. The software already carries
        the data for all of them.
      </p>
      <div className="grid cols-2" style={{ gap: 10 }}>
        {ordered.map(([point, p]) => (
          <div key={point} className="setting-row" style={{ alignItems: "center" }}>
            <div className="info">
              <b>
                {point}. {[...new Set(p.labels)].join(" · ")}
              </b>
              <span>{[...p.sources].join(", ")}</span>
            </div>
            <span className={`pill ${p.available ? "ok" : "muted"}`}>
              {p.available ? (
                <>
                  <CheckCircle2 size={13} /> live
                </>
              ) : p.modelPending ? (
                <>
                  <Clock size={13} /> model
                </>
              ) : (
                <>
                  <Clock size={13} /> pending
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({
  label,
  desc,
  on,
  flip,
  blocked,
}: {
  label: string;
  desc: string;
  on: boolean;
  flip: () => void;
  /** reason this alert cannot fire yet; the toggle is then inert */
  blocked?: string;
}) {
  return (
    <div className="setting-row" style={blocked ? { opacity: 0.62 } : undefined}>
      <div className="info">
        <b>
          {label}
          {blocked && (
            <span className="pill muted" style={{ marginLeft: 8, fontSize: 10.5 }}>
              {blocked}
            </span>
          )}
        </b>
        <span>{desc}</span>
      </div>
      <Toggle on={blocked ? false : on} onClick={blocked ? () => {} : flip} />
    </div>
  );
}
