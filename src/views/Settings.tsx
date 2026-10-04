"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Globe, RotateCcw, CheckCircle2, Clock } from "lucide-react";
import { useTheme } from "../theme";
import { useStable, useToast } from "../store";
import { getCoverage, type CoverageRow } from "../data/api";
import * as api from "../data/api";
import { useT } from "../i18n";
import { useAuth } from "../auth";

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
  const { lang, setLang, t } = useT();
  const { user, authRequired } = useAuth();
  const isAdmin = !authRequired || user?.role === "admin";

  // Settings live on the server, so what this page shows is what the server
  // does (server/settings.mjs, server/notify.mjs).
  const [st, setSt] = useState<api.SiteSettings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [sens, setSens] = useState(50);
  useEffect(() => {
    if (!api.apiConfigured) return setLoadError("demo mode — no server, so nothing here can be saved");
    api.getSettings().then((r) => {
      if (r.ok) { setSt(r.data); setSens(r.data.sensitivity); } else setLoadError(r.error);
    });
  }, []);
  const save = async (patch: unknown, done?: string) => {
    const r = await api.patchSettings(patch);
    if (!r.ok) return notify(`Not saved: ${r.error}`);
    setSt(r.data);
    setSens(r.data.sensitivity);
    if (done) notify(done);
  };

  // An alert switch is a safety control. For a point with no data source,
  // the alert can never fire — say so instead of offering a switch.
  const [coverage, setCoverage] = useState<CoverageRow[] | null>(null);
  useEffect(() => {
    let stop = false;
    getCoverage().then((r) => !stop && setCoverage(r));
    return () => {
      stop = true;
    };
  }, []);
  const sourceStatus = new Map((coverage ?? []).map((r) => [r.source, r.status]));
  const readiness = (source: string, need: string) => {
    if (!coverage) return undefined;
    const s2 = sourceStatus.get(source);
    if (s2 === "available" || s2 === "prototype") return undefined;
    return s2 === "model-pending" ? "model not trained yet" : `needs ${need}`;
  };
  const off = !st || !isAdmin;
  const d = st?.delivery;

  return (
    <div className="grid cols-2" style={{ alignItems: "start" }}>
      {/* appearance */}
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>{t("Appearance")}</h3>
        <div className="setting-row">
          <div className="info">
            <b>{t("Theme")}</b>
            <span>Dark mode is the primary night-time view — most critical events happen after dark.</span>
          </div>
          <div className="theme-toggle" style={{ width: 180 }}>
            <button className={theme === "light" ? "on" : ""} onClick={() => set("light")}>
              <Sun size={15} /> {t("Light")}
            </button>
            <button className={theme === "dark" ? "on" : ""} onClick={() => set("dark")}>
              <Moon size={15} /> {t("Dark")}
            </button>
          </div>
        </div>
        <div className="setting-row">
          <div className="info">
            <b>{t("Interface language")}</b>
            <span>Hindi for grooms on the overnight shift: menus, alert titles, the horse page and the dashboard. Longer alert explanations stay in English. Remembered on this device.</span>
          </div>
          <div className="theme-toggle" style={{ width: 180 }}>
            <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>
              <Globe size={15} /> English
            </button>
            <button className={lang === "hi" ? "on" : ""} onClick={() => setLang("hi")}>
              हिंदी
            </button>
          </div>
        </div>
      </div>

      {/* delivery */}
      <div className="card">
        <h3 style={{ marginBottom: 4 }}>{t("Alert delivery")}</h3>
        {loadError ? <p className="muted" style={{ fontSize: 12.5 }}>{loadError}</p> : !st ? <p className="muted">Loading…</p> : (
          <>
            {st.notify.transport === "log-only" && (
              <div className="row watch" style={{ padding: "8px 12px", marginBottom: 10 }}>
                <span style={{ fontSize: 12 }}>No webhook is configured on the server, so alerts are logged, not sent. Set
                  NOTIFY_WEBHOOK_URL to a WhatsApp gateway, Slack or n8n; the recipients below go with each message.</span>
              </div>
            )}
            {!isAdmin && <p className="muted" style={{ fontSize: 12 }}>Only an administrator can change these.</p>}
            <Row label="Instant alerts" desc="Each new alert, once, to the manager (WhatsApp or other gateway, through the webhook)."
              on={d!.instant} flip={() => !off && save({ delivery: { instant: !d!.instant } })} />
            <Row label="Daily digest" desc={`Every horse's status and open alerts, each morning at ${String(d!.digestHour).padStart(2, "0")}:00.`}
              on={d!.digest} flip={() => !off && save({ delivery: { digest: !d!.digest } })} />
            {d!.digest && (
              <div className="field" style={{ maxWidth: 200 }}>
                <label>Digest time</label>
                <select disabled={off} value={d!.digestHour} onChange={(e) => save({ delivery: { digestHour: Number(e.target.value) } })}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                </select>
              </div>
            )}
            <Row label="Auto-escalation"
              desc={`An urgent alert nobody acknowledges goes to the on-call person after ${d!.escalateAfterMin} min, and to the vet after ${2 * d!.escalateAfterMin} min.`}
              on={d!.escalation} flip={() => !off && save({ delivery: { escalation: !d!.escalation } })} />
            {d!.escalation && (
              <div className="field" style={{ maxWidth: 200 }}>
                <label>Escalate after</label>
                <select disabled={off} value={d!.escalateAfterMin} onChange={(e) => save({ delivery: { escalateAfterMin: Number(e.target.value) } })}>
                  {[5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
                </select>
              </div>
            )}
            <Recipients value={d!.recipients} disabled={off} onSave={(recipients) => save({ delivery: { recipients } }, "Recipients saved")} />
            <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
              Sent so far: {st.notify.notified} alerts, {st.notify.escalated} escalations, {st.notify.digests} digests
              {st.notify.failed ? ` · ${st.notify.failed} failed` : ""}.
            </p>
          </>
        )}
      </div>

      {/* alert groups */}
      <div className="card">
        <h3 style={{ marginBottom: 4 }}>{t("Send these alerts")}</h3>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          Switching a group off stops SENDING it — it still shows on the Alerts page. Greyed rows have no data
          source here yet and cannot fire.
        </p>
        {st && ([
          ["temperature", "Temperature", "Eye temperature against the horse's own baseline.", readiness("thermal_camera", "thermal camera")],
          ["breathing", "Breathing", "Resting breathing rate from the nostril or flank.", readiness("thermal_camera", "thermal camera")],
          ["casting", "Possibly cast", "Down with repeated struggling and not getting up (from the camera).", readiness("visible_video", "camera")],
          ["colic", "Colic signs", "Repeated lying down/up, rolling, long flat lying, less manure (camera watch notes; the colic alarm itself needs the IMU tag).", readiness("visible_video", "camera")],
          ["activity", "Activity unusual", "Well above or below this horse's own normal.", readiness("visible_video", "camera")],
          ["vices", "Stable vices", "New or increased weaving, box walking, head tossing (crib-biting not detected yet).", readiness("visible_video", "camera")],
          ["sleep", "Sleep / lying", "Little lying at night; low lying time.", readiness("visible_video", "camera")],
          ["elimination", "Urination", "No urination seen for a long time.", readiness("visible_video", "camera")],
          ["lameness", "Gait & lameness", "Movement asymmetry.", readiness("imu_optical", "IMU tag")],
          ["water", "Low water intake", "Below this horse's own normal.", readiness("flow_meter", "flow meter")],
          ["monitoring", "Monitoring & devices", "A camera not aimed, a device or edge box not reporting.", undefined],
        ] as const).map(([k, label, desc, blocked]) => (
          <Row key={k} label={label} desc={desc} on={st.send[k]} blocked={blocked}
            flip={() => !off && save({ send: { [k]: !st.send[k] } })} />
        ))}
        {!st && <p className="muted" style={{ fontSize: 12.5 }}>{loadError || "Loading…"}</p>}
        <Row label="Respiratory (audio)" desc="Coughing and abnormal breathing sounds." on={false} flip={() => {}} blocked={readiness("optical_audio", "microphone")} />
        <Row label="Birth alarm" desc="Foaling behaviour — no foaling detector is built yet." on={false} flip={() => {}} blocked="not built yet" />
      </div>

      {/* sensitivity + privacy */}
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>{t("Sensitivity & calibration")}</h3>
        <div className="setting-row" style={{ display: "block" }}>
          <div className="info" style={{ marginBottom: 12 }}>
            <b>Activity sensitivity — {sens}%</b>
            <span>
              Moves only the &quot;Activity unusual&quot; watch note: at {sens}% it fires above ×{activityBand(sens).hi} or
              below ×{activityBand(sens).lo} of the horse&apos;s own normal. Clinical thresholds (temperature, breathing) never move with a slider.
            </span>
          </div>
          <input
            type="range" min={0} max={100} value={sens} disabled={off}
            onChange={(e) => setSens(Number(e.target.value))}
            onPointerUp={() => st && sens !== st.sensitivity && save({ sensitivity: sens }, "Sensitivity saved")}
            onKeyUp={() => st && sens !== st.sensitivity && save({ sensitivity: sens })}
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
            <span>Recording is off unless switched on per camera. The edge box then keeps clips until they fill 100 GB and deletes the oldest (about 10 days at 0.4 GB an hour).</span>
          </div>
          <span className="pill muted">100 GB</span>
        </div>
        <div className="setting-row">
          <div className="info">
            <b>Staff privacy consent</b>
            <span>
              Cameras record people too. {st?.privacy.consentAt
                ? `Recorded by ${st.privacy.consentBy} on ${new Date(st.privacy.consentAt).toLocaleDateString()}.`
                : "Not recorded yet — confirm once every staff member working in camera view has agreed."}
            </span>
          </div>
          {st?.privacy.consentAt ? (
            <span className="pill ok">On file</span>
          ) : (
            <button className="btn-ghost" disabled={off} onClick={() => save({ privacy: { confirmConsent: true } }, "Consent recorded")}>
              Record consent
            </button>
          )}
        </div>
        <div className="setting-row">
          <div className="info">
            <b>Reset demo data</b>
            <span>Restore the original sample horses, alerts and diary — clears anything you&apos;ve added.</span>
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

/** Same bands as server/settings.mjs activityBands (50 = 2.0 / 0.4). */
function activityBand(s: number) {
  const x = Math.max(0, Math.min(100, s)) / 100;
  const hi = x <= 0.5 ? 3.0 - 2.0 * x : 2.0 - 1.0 * (x - 0.5);
  const lo = x <= 0.5 ? 0.25 + 0.3 * x : 0.4 + 0.3 * (x - 0.5);
  return { hi: Math.round(hi * 100) / 100, lo: Math.round(lo * 100) / 100 };
}

function Recipients({ value, disabled, onSave }: {
  value: api.SiteSettings["delivery"]["recipients"]; disabled: boolean; onSave: (v: api.SiteSettings["delivery"]["recipients"]) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const dirty = JSON.stringify(v) !== JSON.stringify(value);
  return (
    <div style={{ marginTop: 10 }}>
      <div className="field-row">
        {([["manager", "Manager"], ["onCall", "On-call"], ["vet", "Vet"]] as const).map(([k, label]) => (
          <div className="field" key={k} style={{ marginBottom: 8 }}>
            <label>{label}</label>
            <input disabled={disabled} value={v[k]} placeholder="+91 …" onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          </div>
        ))}
      </div>
      {dirty && <button className="btn-primary" onClick={() => onSave(v)}>Save recipients</button>}
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
    { labels: string[]; available: boolean; prototype: boolean; modelPending: boolean; sources: Set<string> }
  >();
  for (const r of rows) {
    const p =
      points.get(r.point) ??
      { labels: [], available: false, prototype: false, modelPending: false, sources: new Set<string>() };
    p.labels.push(r.label);
    if (r.status === "available") p.available = true;
    if (r.status === "model-pending") p.modelPending = true;
    if (r.status === "prototype") p.prototype = true;
    p.sources.add(r.source.replace(/_/g, " "));
    points.set(r.point, p);
  }
  const ordered = [...points.entries()].sort((a, b) => a[0] - b[0]);
  const liveCount = ordered.filter(([, p]) => p.available).length;
  const modelCount = ordered.filter(([, p]) => !p.available && !p.prototype && p.modelPending).length;
  const protoCount = ordered.filter(([, p]) => !p.available && p.prototype).length;

  return (
    <div className="card" style={{ gridColumn: "1 / -1" }}>
      <div className="card-head">
        <h3>Monitoring coverage</h3>
        <span className="pill accent">
          {liveCount} of {ordered.length} points sourced
          {protoCount > 0 && ` · ${protoCount} from camera video`}
          {modelCount > 0 && ` · ${modelCount} awaiting model`}
        </span>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: -4, marginBottom: 14 }}>
        Which of the 12 monitoring points have a live data source today. "Model" means the
        camera is installed but the vision model for that point still needs labelled footage;
        "from camera video" means the camera produces it today from its video; "pending" means the sensor itself is not procured yet. The software already carries
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
            <span className={`pill ${p.available || p.prototype ? "ok" : "muted"}`}>
              {p.available ? (
                <>
                  <CheckCircle2 size={13} /> live
                </>
              ) : p.prototype ? (
                <>
                  <CheckCircle2 size={13} /> from video
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
