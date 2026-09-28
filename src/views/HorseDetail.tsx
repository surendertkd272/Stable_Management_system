"use client";

import { useT } from "../i18n";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Moon, Droplet, Sun, Activity, Heart, Play, Plus, WifiOff, Gauge, Crosshair, FlaskConical } from "lucide-react";
import { DiaryEntry } from "../data/mock";
import { useStable, useToast } from "../store";
import { getHorseDetail, type HorseDetail as HorseVitals, type HorseBehaviour } from "../data/api";
import { StatusPill, MonitoringPill, isBlind, RadialGauge, Sparkline, Delta, Modal, riskScore, riskBand } from "../components/ui";

const CATEGORY: { icon: DiaryEntry["icon"]; label: string }[] = [
  { icon: "feed", label: "Feed change" },
  { icon: "vet", label: "Vet visit" },
  { icon: "farrier", label: "Farrier" },
  { icon: "travel", label: "Travel" },
  { icon: "deworm", label: "Deworming" },
];

/** Percent change of the latest reading against the mean of the earlier ones.
 *  Returns null when there is not enough measured history to say anything —
 *  the trend badges used to be constants (+4%, -6%, +9%) typed into the JSX,
 *  which an owner reads as a real week-on-week change. */
function trend(series: (number | null)[] | undefined): number | null {
  const pts = (series ?? []).filter((n): n is number => n !== null);
  if (pts.length < 3) return null;
  const latest = pts[pts.length - 1];
  const prior = pts.slice(0, -1);
  const base = prior.reduce((a, b) => a + b, 0) / prior.length;
  if (!base) return null;
  return Math.round(((latest - base) / base) * 100);
}

// Matches BASELINE_TARGET_DAYS in server/rollup.mjs, which computes the %.
const BASELINE_DAYS = 14;

export default function HorseDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const nav = (to: string) => router.push(to);
  const { horses, alerts, diary, addDiary, series } = useStable();
  const { t } = useT();
  const notify = useToast();
  const [cam, setCam] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [icon, setIcon] = useState<DiaryEntry["icon"]>("vet");

  const [live, setLive] = useState<HorseVitals | null>(null);
  const horse = horses.find((h) => h.id === id);

  // live camera-derived vitals (points 2/3/4) when a backend is reachable
  useEffect(() => {
    if (!id) return;
    let stop = false;
    getHorseDetail(id).then((d) => {
      if (!stop && d) setLive({ vitals: d.vitals, charts: d.charts, behaviour: d.behaviour });
    });
    return () => {
      stop = true;
    };
  }, [id]);

  if (!horse) {
    return (
      <div className="card">
        <p>Horse not found.</p>
        <Link href="/horses" className="back-link">
          <ChevronLeft size={16} /> Back to horses
        </Link>
      </div>
    );
  }

  const horseAlerts = alerts.filter((a) => a.horse === horse.name);
  const horseDiary = diary.filter((d) => d.horse === horse.name);
  const risk = riskScore(horse);
  // No readings means no basis for a score. Showing one anyway is how a horse
  // nobody can see ends up presented as low risk.
  const blind = horse.monitoring === "no-data" || horse.monitoring === "offline";
  const band = riskBand(risk);

  const saveNote = () => {
    if (!note.trim()) return;
    const category = CATEGORY.find((c) => c.icon === icon)?.label ?? "Note";
    addDiary({ horse: horse.name, category, note: note.trim(), icon });
    notify(`Diary note added for ${horse.name}`);
    setNote("");
    setNoteOpen(false);
  };
  const stressVal = horse.stress === "High" ? 82 : horse.stress === "Medium" ? 52 : 22;
  // Unknown is not green. Defaulting to the "good" colour paints an un-sensed
  // horse as calm, which is the mistake this whole pass exists to remove.
  const stressColor =
    horse.stress === null
      ? "var(--text-secondary)"
      : horse.stress === "High"
        ? "var(--alert)"
        : horse.stress === "Medium"
          ? "var(--warn)"
          : "var(--positive)";

  return (
    <>
      <button className="back-link" onClick={() => router.back()}>
        <ChevronLeft size={16} /> {t("Back")}
      </button>

      {/* hero */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="flex gap-md wrap" style={{ alignItems: "stretch" }}>
          <div
            style={{
              width: 200,
              minWidth: 160,
              flex: "0 0 auto",
              borderRadius: "var(--radius-inner)",
              backgroundImage: `url(${horse.photo})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <div className="grow" style={{ minWidth: 220 }}>
            <div className="flex between center wrap" style={{ gap: 10 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--ink)" }}>{horse.name}</h2>
              <div className="flex gap-sm center wrap">
                <MonitoringPill monitoring={horse.monitoring} />
                <StatusPill status={horse.status} />
              </div>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              {horse.breed} · {horse.sex} · {horse.age} · Stall {horse.stall}
            </p>
            <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              Owner: {horse.owner}
            </p>
            <div
              className="row"
              style={{
                marginTop: 16,
                marginBottom: 0,
                background: isBlind(horse.monitoring)
                  ? "var(--alert-soft)"
                  : horse.status === "calm"
                    ? "var(--positive-soft)"
                    : "var(--warn-soft)",
                borderColor: "transparent",
              }}
            >
              {isBlind(horse.monitoring) ? <WifiOff size={17} style={{ flexShrink: 0 }} /> : <Heart size={17} style={{ flexShrink: 0 }} />}
              <span style={{ fontSize: 13, fontWeight: 600 }}>{horse.statusNote}</span>
            </div>
            {/* "last known values" only makes sense if there were any. A horse
                that has never reported has nothing stale to show — saying so
                next to four "Not measured" panels just reads as a glitch. */}
            {isBlind(horse.monitoring) && (
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {horse.monitoring === "no-data" || !horse.lastSeen
                  ? "Nothing has been received from this stall yet — check the stall's devices and the edge agent."
                  : `Figures below are the last known values and may be out of date (last reading ${new Date(
                      horse.lastSeen,
                    ).toLocaleString()}).`}
              </p>
            )}
            <div className="flex gap-sm" style={{ marginTop: 16, flexWrap: "wrap" }}>
              <button className="btn-primary" onClick={() => setCam(true)}>
                <Play size={16} /> {t("Camera reference")}
              </button>
              <button className="btn-ghost" onClick={() => nav(`/reports?horse=${horse.id}`)}>
                {t("Generate vet report")}
              </button>
              <button className="btn-ghost" onClick={() => setNoteOpen(true)}>
                {t("Add diary note")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* live vitals from the camera (points 2, 3, 4, 5). With one camera the
          thermal view catches the head only part of the day, so each card says
          when it was last read, and turns amber once that is 2 h+ ago. */}
      {live?.vitals && (live.vitals.body_temp_c || live.vitals.respiratory_rate_bpm || live.vitals.activity_index) && (
        <>
          <h3 style={{ margin: "4px 0 12px" }}>
            {t("Live vitals")} <span style={{ color: "var(--text-secondary)", fontWeight: 400, fontSize: 13 }}>· {t("camera")}</span>
          </h3>
          {(live.vitals.body_temp_c?.calibrated === false || live.vitals.respiratory_rate_bpm?.calibrated === false) && (
            <div className="row watch" style={{ marginBottom: 12, padding: "10px 14px" }}>
              <Crosshair size={16} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 12.5 }}>
                This stall&apos;s camera is not aimed at the horse, so these numbers may be of its coat or the stall wall.
                They are not used for alerts. Aim it from the Hardware page.
              </span>
            </div>
          )}
          <div className="grid cols-4" style={{ marginBottom: 24 }}>
            {live.vitals.body_temp_c ? (
              <MetricCard
                icon={<Heart size={18} />}
                label={live.vitals.body_temp_c.calibrated === false ? "Body temperature · uncalibrated" : "Body temperature"}
                muted={live.vitals.body_temp_c.calibrated === false}
                value={`${live.vitals.body_temp_c.value.toFixed(1)}°C`}
                note={readAt(live.vitals.body_temp_c.ts)}
                delta={trend(live.charts.body_temp_c)}
                spark={live.charts.body_temp_c}
              />
            ) : (
              <MetricCard icon={<Heart size={18} />} label="Body temperature" value={null} delta={null} spark={[]} />
            )}
            {live.vitals.respiratory_rate_bpm && (
              <MetricCard
                icon={<Activity size={18} />}
                label={live.vitals.respiratory_rate_bpm.calibrated === false ? "Respiratory rate · uncalibrated" : "Respiratory rate"}
                muted={live.vitals.respiratory_rate_bpm.calibrated === false}
                value={`${Math.round(live.vitals.respiratory_rate_bpm.value)} bpm`}
                note={readAt(live.vitals.respiratory_rate_bpm.ts)}
                delta={trend(live.charts.respiratory_rate_bpm)}
                spark={live.charts.respiratory_rate_bpm}
              />
            )}
            {live.vitals.activity_index && (
              <MetricCard
                icon={<Activity size={18} />}
                label={PROTOTYPE_SOURCES.has(live.vitals.activity_index.source ?? "") ? "Activity · prototype" : "Activity"}
                value={live.vitals.activity_index.value.toFixed(2)}
                note={readAt(live.vitals.activity_index.ts)}
                delta={trend(live.charts.activity_index)}
                spark={live.charts.activity_index}
                type="bar"
              />
            )}
          </div>
        </>
      )}

      {live?.behaviour && <CameraBehaviour b={live.behaviour} nostrilC={live.vitals?.nostril_temp_c?.value ?? null} />}

      {/* Behaviour cards. These plot THIS horse's series when the backend has
          it — they used to fall back to the yard-wide series, so the chart
          under one horse's rest figure was actually every horse's. */}
      <div className="grid cols-4" style={{ marginBottom: 24 }}>
        {horse.rest === null && live?.behaviour?.resting ? (
          // No lying sensor, but the camera measures lying (prototype).
          <MetricCard
            icon={<Moon size={18} />}
            label="Daily rest · camera prototype"
            value={hmm(live.behaviour.resting.lyingTodayMin)}
            delta={null}
            spark={live.charts.lying_hours ?? []}
          />
        ) : (
          <MetricCard
            icon={<Moon size={18} />}
            label="Daily rest"
            value={horse.rest}
            delta={trend(live?.charts.rest_hours)}
            spark={live?.charts.rest_hours ?? series.rest}
          />
        )}
        <MetricCard
          icon={<Droplet size={18} />}
          label="Water intake"
          value={horse.water === null ? null : String(horse.water)}
          delta={trend(live?.charts.water_ml)}
          spark={live?.charts.water_ml ?? series.water}
          type="bar"
        />
        <MetricCard
          icon={<Sun size={18} />}
          label="Time outside box"
          value={horse.outside}
          delta={null}
          spark={series.outside}
        />
        <MetricCard
          icon={<Gauge size={18} />}
          label="Stress level"
          value={horse.stress}
          delta={null}
          spark={live?.charts.activity_index ?? []}
          type="bar"
          color={stressColor}
        />
      </div>

      {/* predictive risk */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-head">
          <h3>Predictive risk score</h3>
          {blind ? (
            <span className="pill muted">not assessable</span>
          ) : (
            <span className={`pill ${band.cls}`}>{band.label} risk</span>
          )}
        </div>
        <div className="flex gap-md center wrap">
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 44,
              fontWeight: 700,
              color: blind ? "var(--text-secondary)" : band.color,
              lineHeight: 1,
            }}
          >
            {blind ? "—" : risk}
            {!blind && <small style={{ fontSize: 18, color: "var(--text-secondary)" }}>/100</small>}
          </div>
          <div className="grow" style={{ minWidth: 220 }}>
            <div className="progress" style={{ height: 10 }}>
              <i
                style={
                  blind
                    ? {
                        width: "100%",
                        background:
                          "repeating-linear-gradient(135deg, var(--border) 0 6px, transparent 6px 12px)",
                      }
                    : { width: `${risk}%`, background: band.color }
                }
              />
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              {blind
                ? "No sensor data has been received for this horse, so no score can be produced. This is not a low score — it is no score."
                : horse.stress === null
                  ? "Model estimate from the signals this install measures — no activity sensor, so stress is not a factor here. Context, not diagnosis."
                  : "Model estimate from behaviour baseline, stress trend and recent incidents — context, not diagnosis."}
            </p>
          </div>
          <div className="flex gap-sm wrap" style={{ maxWidth: 280 }}>
            {horse.status === "urgent" && <span className="pill alert">Active incident</span>}
            {/* `stress !== "Low"` was true for null too, so a horse with no
                activity sensor got a yellow warning pill reading just "stress". */}
            {horse.stress !== null && horse.stress !== "Low" && (
              <span className="pill warn">{horse.stress} stress</span>
            )}
            {horseAlerts.slice(0, 2).map((a) => (
              <span className="pill muted" key={a.id}>
                {a.type}
              </span>
            ))}
            {risk < 40 && horse.status !== "urgent" && horse.stress === "Low" && (
              <span className="pill ok">Within baseline</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid cols-3">
        {/* stress gauge */}
        <div className="card">
          <div className="card-head">
            <h3>Stress level</h3>
            <span
              className={`pill ${
                horse.stress === null
                  ? "muted"
                  : horse.stress === "High"
                    ? "alert"
                    : horse.stress === "Medium"
                      ? "warn"
                      : "ok"
              }`}
            >
              {horse.stress ?? "not measured"}
            </span>
          </div>
          <RadialGauge
            value={horse.stress === null ? 0 : stressVal}
            display={horse.stress ?? "—"}
            label={horse.stress === null ? "needs activity sensor" : "5-min macro-movement"}
            color={horse.stress === null ? "var(--text-secondary)" : stressColor}
          />
        </div>

        {/* baseline learning */}
        <div className="card">
          <div className="card-head">
            <h3>Baseline learning</h3>
            <span className="sub">{horse.baselineProgress}%</span>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            {horse.baselineProgress >= 100
              ? "Fully calibrated — alerts tuned to this horse."
              : "Calibrating — alerts will sharpen as data builds."}
          </p>
          <div className="progress">
            <i style={{ width: `${horse.baselineProgress}%` }} />
          </div>
          {/* Both figures were constants, so a horse 7% calibrated still read
              "Started 14 days ago · ~3 days left" — a 14-day baseline three
              days from done. Derive both from the progress we actually have. */}
          <div className="flex between" style={{ marginTop: 18, fontSize: 12.5 }}>
            <span className="muted">
              {(() => {
                const days = Math.round((horse.baselineProgress / 100) * BASELINE_DAYS);
                return days <= 0 ? "Started today" : `${days} of ${BASELINE_DAYS} days collected`;
              })()}
            </span>
            <span className="muted">
              {horse.baselineProgress >= 100
                ? "Calibrated"
                : `~${Math.max(1, BASELINE_DAYS - Math.round((horse.baselineProgress / 100) * BASELINE_DAYS))} days left`}
            </span>
          </div>
        </div>

        {/* recent alerts */}
        <div className="card">
          <div className="card-head">
            <h3>Recent alerts</h3>
            <Link href="/alerts" className="sub" style={{ color: "var(--accent)", fontWeight: 600 }}>
              All
            </Link>
          </div>
          {horseAlerts.length ? (
            horseAlerts.map((a) => (
              <div key={a.id} className={`tl-item`}>
                <div className={`tl-dot ${a.severity === "alert" ? "alert" : a.severity === "warn" ? "" : "done"}`} />
                <div className="tl-body">
                  <b>{a.type}</b>
                  <span>{a.time}</span>
                </div>
              </div>
            ))
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              No alerts — within baseline.
            </p>
          )}
        </div>
      </div>

      {/* care diary */}
      <h3 className="section-title" style={{ marginTop: 28 }}>
        Care diary
      </h3>
      {horseDiary.length ? (
        horseDiary.map((d) => (
          <div className="row" key={d.id}>
            <div className="chip sm">
              <Notebook />
            </div>
            <div className="grow">
              <b>{d.category}</b>
              <span>{d.note}</span>
            </div>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {d.date}
            </span>
          </div>
        ))
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>
          No care records yet for {horse.name}.
        </p>
      )}

      {/* This modal used to show a blinking LIVE badge and a ticking clock over
          a static stock photo, for every horse — including the six with no
          camera pointed at them at all. Nothing in this repo streams video
          into the browser: the backend has no snapshot/image endpoint, and
          the RTSP path (tools/camera_capture.py, mock_camera.py) runs on the
          edge box, not here. A fake LIVE feed is worse than no feed — it is
          the exact failure mode this whole audit exists to remove, just in
          video form instead of a number. Show what we actually have: the
          reference photo, labelled as one, plus the real vitals if the
          camera has sent any. */}
      <Modal open={cam} onClose={() => setCam(false)} title={`${horse.name} · Stall ${horse.stall}`} wide>
        <div className="cam" style={{ backgroundImage: `url(${horse.photo})` }}>
          <span className="live" style={{ background: "rgba(0,0,0,0.55)" }}>
            REFERENCE PHOTO
          </span>
        </div>
        {isBlind(horse.monitoring) ? (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
            No live video is wired into this dashboard yet — the camera streams to the edge box
            for on-device analysis, not to this browser. This install has also never received a
            reading from this stall, so there is nothing current to show even as numbers.
          </p>
        ) : (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
            No live video is wired into this dashboard yet — the camera streams to the edge box
            for on-device analysis, not to this browser.{" "}
            {horse.vitals?.bodyTempC != null && horse.vitals?.respRateBpm != null
              ? `Latest reading: ${horse.vitals.bodyTempC.toFixed(1)} °C, ${Math.round(
                  horse.vitals.respRateBpm,
                )} bpm.`
              : ""}
          </p>
        )}
      </Modal>

      <Modal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title={`Add diary note · ${horse.name}`}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setNoteOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={saveNote}>
              <Plus size={16} /> Add note
            </button>
          </>
        }
      >
        <div className="field">
          <label>Category</label>
          <select value={icon} onChange={(e) => setIcon(e.target.value as DiaryEntry["icon"])}>
            {CATEGORY.map((c) => (
              <option key={c.icon} value={c.icon}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Note</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened?" />
        </div>
      </Modal>
    </>
  );
}

function Notebook() {
  return <Activity size={16} />;
}

function MetricCard({
  icon,
  label,
  value,
  delta,
  spark,
  type = "line",
  color,
  muted = false,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  /** e.g. "read 3 h ago" — with one camera, vitals are read only while the head is in view */
  note?: { text: string; stale: boolean } | null;
  value: string | null;
  /** null = we have no honest basis for a trend; the badge is then omitted. */
  delta: number | null;
  /** a reading we can't vouch for (un-aimed camera): grey, not authoritative */
  muted?: boolean;
  spark: (number | null)[];
  type?: "line" | "bar";
  color?: string;
}) {
  // No sensor for this metric here. Show that plainly instead of a number:
  // a "0h 00m" rest figure would describe a horse that never lay down.
  const measured = value !== null && value !== undefined;
  const { t } = useT();
  return (
    <div className="card stat">
      <div className="top">
        <div className="chip sm">{icon}</div>
        {measured && delta !== null && <Delta value={delta} />}
      </div>
      <div
        className="value"
        style={{
          fontSize: measured ? 30 : 17,
          marginTop: 12,
          color: measured && !muted ? undefined : "var(--text-secondary)",
        }}
      >
        {measured ? value : t("Not measured")}
      </div>
      {measured && note && (
        <div style={{ fontSize: 11.5, marginTop: 2, color: note.stale ? "var(--warn)" : "var(--text-secondary)" }}>
          {note.text.replace(/^read just now$|^read (\d+) (min|h|d) ago$/, (m, n, u) => (!n ? t(m) : t("read") === "read" ? m : `${n} ${t(u)} ${t("ago")} ${t("read")}`))}
        </div>
      )}
      <div className="foot">
        <span className="label">{t(label)}</span>
        {measured && spark.filter((n) => n !== null).length > 1 ? (
          <Sparkline
            data={spark.filter((n): n is number => n !== null)}
            type={type}
            color={color}
            w={70}
            h={28}
          />
        ) : !measured ? (
          <span className="muted" style={{ fontSize: 11 }}>
            no sensor
          </span>
        ) : null}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// What the camera tells us beyond the vitals. Every line here comes from a
// prototype heuristic (thermal video / floor warm patches) and says so; a part
// with no readings says "not measured here" rather than showing zero.
// --------------------------------------------------------------------------- //
const hm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const hmm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;
const PROTOTYPE_SOURCES = new Set(["thermal_video", "visible_video"]);
/** "read 12 min ago"; stale (amber) from 2 h — the head may have left the thermal view. */
function readAt(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  const text = min < 2 ? "read just now" : min < 90 ? `read ${min} min ago` : min < 48 * 60 ? `read ${Math.round(min / 60)} h ago` : `read ${Math.round(min / 1440)} d ago`;
  return { text, stale: min >= 120 };
}

function CameraBehaviour({ b, nostrilC }: { b: HorseBehaviour; nostrilC: number | null }) {
  const { t } = useT();
  const any = b.activity || b.inactive || b.resting || b.urination || b.excretion || b.weaving || b.boxWalking || b.headTossing || b.breathing;
  if (!any) return null;
  const none = <span className="muted">not measured here</span>;
  const reg = b.breathing?.regularity;
  const events = (e: HorseBehaviour["urination"]) =>
    !e ? none : (
      <>
        <b>{e.count24h}</b> in 24 h · last {hm(e.last)}
        {!!e.baselinePerDay && <span className="muted"> · usual ~{e.baselinePerDay}/day</span>}
        {e.times.length > 0 && <span className="muted"> · {e.times.map(hm).join(", ")}</span>}
        {e.tier && <><br /><small className="muted">{e.tier} — a warm patch on the floor{e.lastHalfLifeMin != null ? `, cooled to half in ${e.lastHalfLifeMin} min` : ""}; posture not confirmed</small></>}
      </>
    );
  const vice = (v: HorseBehaviour["weaving"] | undefined, fallback: React.ReactNode) =>
    !v ? fallback : (
      <>
        <b>{v.minutes24h ?? v.count24h}</b> min in 24 h
        {v.phases24h != null && <span className="muted"> · {v.phases24h} {v.phases24h === 1 ? "episode" : "episodes"}</span>}
        <span className="muted"> · last {hm(v.last)}</span>
        {!!v.baselineMinPerDay && !v.isNew && <span className="muted"> · usual ~{v.baselineMinPerDay} min/day</span>}
        {v.isNew && <span className="pill warn" style={{ marginLeft: 6, fontSize: 10.5 }}>new</span>}
      </>
    );
  const rs = b.resting;
  const colour = b.stream === "visible_video";
  // Context from open veterinary sources (server/knowledge.mjs, /guide). Only
  // for patterns actually seen; never a diagnosis.
  const meaning: { id: string; text: string }[] = [];
  if (b.activity?.unusual === "high") meaning.push({ id: "restless", text:
    "More active than its own normal. Restlessness alone is a weak sign — horses are busy in the 20 min before a feed. " +
    "With rolling, flank watching or kicking at the belly it points to colic." });
  if (b.activity?.unusual === "low") meaning.push({ id: "dull_back_of_box", text:
    "Much quieter than its own normal. Dozing is normal, but a dull horse standing at the back of the box with its head low can be in pain." });
  if (b.weaving && b.weaving.count24h > 0) meaning.push({ id: "weaving", text:
    "Weaving is a stable vice linked to confinement, isolation and feeding routine; it peaks around meals. " +
    "It may help the horse cope, so a sudden stop is not automatically good news." });
  if (b.resting && b.resting.bouts24h >= 6) meaning.push({ id: "down_up", text:
    `${b.resting.bouts24h} lie-downs in 24 h. Going down and getting up again and again is a strong colic sign; ` +
    "adults normally lie in 2–4 bouts, mostly after midnight." });
  if (b.resting && b.resting.nightsSeen >= 3 && b.resting.lowNights >= 3) meaning.push({ id: "rem_deprivation", text:
    "Almost no lying on recent nights. Horses need 30+ min lying a day for deep sleep — except in their first 1–4 nights in a new stall." });
  if (b.headTossing && b.headTossing.count24h > 0) meaning.push({ id: "head_tossing", text:
    "Rhythmic head tossing can be a stable vice, but head shaking has medical causes too (ears, eyes, airway, pain) — worth a vet's look if it is new." });
  if (b.boxWalking && b.boxWalking.count24h > 0) meaning.push({ id: "box_walking", text:
    "Box walking: fast walking with calling means confinement distress; if it happens when a neighbour leaves, separation anxiety." });
  if (b.breathing?.band === "fast") meaning.push({ id: "resp_rate", text:
    "Fast breathing at rest. Heat, pain, fever or excitement raise it; 40–50+ breaths/min that does not settle at rest points to heat stress." });
  if (b.excretion && b.excretion.count24h < 4) meaning.push({ id: "manure_frequency", text:
    `${b.excretion.count24h} ${b.excretion.count24h === 1 ? "manure event" : "manure events"} seen in 24 h; normal is 4–13 a day and fewer droppings is a colic sign. ` +
    "The floor detector is a prototype and can miss droppings — check the stall." });
  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-head">
        <h3>{t("Behaviour from the camera")}</h3>
        <span className="pill warn" title="Produced today by heuristics whose thresholds are not yet validated on horses">
          <FlaskConical size={12} /> prototype
        </span>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 12 }}>
        {colour ? "Behaviour from the camera's colour video; breathing from the thermal view; floor events where a floor box is drawn."
          : "From the thermal camera's video and floor temperatures."}{" "}
        Shown for context and watch notes only — never used for clinical alarms until validated on horses.
      </p>
      <div className="hw-facts">
        <div>
          <span>{t("Respiration pattern")}</span>
          <b>
            {b.breathing
              ? <>{b.breathing.band === "fast" && <span className="pill warn" style={{ marginRight: 6, fontSize: 10.5 }}>fast</span>}
                  rhythm {reg == null ? "?" : reg >= 0.75 ? "regular" : reg >= 0.5 ? "somewhat irregular" : "irregular"}
                  {reg != null && <span className="muted"> ({reg.toFixed(2)})</span>}
                  {b.breathing.method && <span className="muted"> · {b.breathing.method}</span>}
                  {nostrilC != null && <span className="muted"> · nostril {nostrilC.toFixed(1)} °C</span>}</>
              : none}
          </b>
        </div>
        <div>
          <span>{t("Activity")}</span>
          <b>
            {!b.activity ? none : (
              <>
                {b.activity.now.toFixed(2)} now
                {b.activity.avg4h != null && <span className="muted"> · 4 h avg {b.activity.avg4h.toFixed(2)}</span>}
                {b.activity.baseline != null
                  ? <span className="muted"> · own normal {b.activity.baseline.toFixed(2)}</span>
                  : <span className="muted"> · learning this horse&apos;s normal (3 days)</span>}
                {b.activity.unusual && <span className="pill warn" style={{ marginLeft: 6, fontSize: 10.5 }}>unusually {b.activity.unusual}</span>}
              </>
            )}
          </b>
        </div>
        <div>
          <span>{t("Resting (still)")}</span>
          <b>
            {!b.inactive ? none : (
              <>
                {hmm(b.inactive.todayMin)} still in 24 h · longest {b.inactive.longestMin} min
                {b.inactive.periods.length > 0 && (
                  <span className="muted"> · {b.inactive.periods.slice(-4).map((p) => `${hm(p.start)}–${hm(p.end)}`).join(", ")}</span>
                )}
                <br />
                <small className="muted">Stillness, not lying down — a horse can doze standing.</small>
              </>
            )}
          </b>
        </div>
        <div>
          <span>{t("Lying down")}</span>
          <b>
            {!rs ? <span className="muted">{b.activity
                ? "learning — lying is shown once this stall's standing and lying shapes have both been seen (a few hours to days; needs the lying detector)"
                : "not measured here"}</span> : (
              <>
                {hmm(rs.lyingTodayMin)} in 24 h · {rs.bouts24h} {rs.bouts24h === 1 ? "bout" : "bouts"}
                {rs.longestBoutMin != null && <span className="muted"> · longest {rs.longestBoutMin} min</span>}
                <span className="muted"> · 00–04 h {rs.nightLyingMin} min</span>
                {rs.lateralTodayMin > 0 && <span className="muted"> · possibly flat on side {rs.lateralTodayMin} min</span>}
                {rs.rolls24h > 0 && <span className="pill warn" style={{ marginLeft: 6, fontSize: 10.5 }}>{rs.rolls24h} possible {rs.rolls24h === 1 ? "roll" : "rolls"}</span>}
              </>
            )}
          </b>
        </div>
        <div><span>{t("Urination")}</span><b>{events(b.urination)}</b></div>
        <div><span>{t("Excretion")}</span><b>{events(b.excretion)}</b></div>
        <div>
          <span>{t("Weaving")}</span>
          <b>{vice(b.weaving, b.activity ? <span className="muted">none seen</span> : none)}</b>
        </div>
        {b.boxWalking && <div><span>{t("Box walking")}</span><b>{vice(b.boxWalking, none)}</b></div>}
        {b.headTossing && <div><span>{t("Head tossing")}</span><b>{vice(b.headTossing, none)}</b></div>}
      </div>
      {meaning.length > 0 && (
        <>
          <p className="hw-legend">{t("What this may mean")}</p>
          {meaning.map((m) => (
            <p key={m.id} style={{ fontSize: 12.5, margin: "0 0 6px" }}>
              {m.text} <a href={`/guide#${m.id}`} className="muted">sources</a>
            </p>
          ))}
        </>
      )}
      <p className="muted" style={{ fontSize: 11.5, margin: "10px 0 0" }}>
        What each pattern may mean, with sources: <a href="/guide">Behaviour guide</a>.
      </p>
    </div>
  );
}
