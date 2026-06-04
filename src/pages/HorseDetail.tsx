import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ChevronLeft, Moon, Droplet, Sun, Activity, Heart, Play, Plus } from "lucide-react";
import { series, DiaryEntry } from "../data/mock";
import { useStable, useToast } from "../store";
import { StatusPill, RadialGauge, Sparkline, Delta, Modal } from "../components/ui";

const CATEGORY: { icon: DiaryEntry["icon"]; label: string }[] = [
  { icon: "feed", label: "Feed change" },
  { icon: "vet", label: "Vet visit" },
  { icon: "farrier", label: "Farrier" },
  { icon: "travel", label: "Travel" },
  { icon: "deworm", label: "Deworming" },
];

export default function HorseDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { horses, alerts, diary, addDiary } = useStable();
  const notify = useToast();
  const [cam, setCam] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [icon, setIcon] = useState<DiaryEntry["icon"]>("vet");
  const [clock, setClock] = useState("");
  const horse = horses.find((h) => h.id === id);

  useEffect(() => {
    if (!cam) return;
    const tick = () => setClock(new Date().toLocaleTimeString());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [cam]);

  if (!horse) {
    return (
      <div className="card">
        <p>Horse not found.</p>
        <Link to="/horses" className="back-link">
          <ChevronLeft size={16} /> Back to horses
        </Link>
      </div>
    );
  }

  const horseAlerts = alerts.filter((a) => a.horse === horse.name);
  const horseDiary = diary.filter((d) => d.horse === horse.name);

  const saveNote = () => {
    if (!note.trim()) return;
    const category = CATEGORY.find((c) => c.icon === icon)?.label ?? "Note";
    addDiary({ horse: horse.name, category, note: note.trim(), icon });
    notify(`Diary note added for ${horse.name}`);
    setNote("");
    setNoteOpen(false);
  };
  const stressVal = horse.stress === "High" ? 82 : horse.stress === "Medium" ? 52 : 22;
  const stressColor =
    horse.stress === "High" ? "var(--alert)" : horse.stress === "Medium" ? "var(--warn)" : "var(--positive)";

  return (
    <>
      <button className="back-link" onClick={() => nav(-1)}>
        <ChevronLeft size={16} /> Back
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
              <StatusPill status={horse.status} />
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
                background: horse.status === "calm" ? "var(--positive-soft)" : "var(--warn-soft)",
                borderColor: "transparent",
              }}
            >
              <Heart size={17} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{horse.statusNote}</span>
            </div>
            <div className="flex gap-sm" style={{ marginTop: 16, flexWrap: "wrap" }}>
              <button className="btn-primary" onClick={() => setCam(true)}>
                <Play size={16} /> Live camera
              </button>
              <button className="btn-ghost" onClick={() => nav(`/reports?horse=${horse.id}`)}>
                Generate vet report
              </button>
              <button className="btn-ghost" onClick={() => setNoteOpen(true)}>
                Add diary note
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* metric cards */}
      <div className="grid cols-4" style={{ marginBottom: 24 }}>
        <MetricCard icon={<Moon size={18} />} label="Daily rest" value={horse.rest} delta={4} spark={series.rest} />
        <MetricCard
          icon={<Droplet size={18} />}
          label="Water visits"
          value={String(horse.water)}
          delta={-6}
          spark={series.water}
          type="bar"
        />
        <MetricCard icon={<Sun size={18} />} label="Time outside box" value={horse.outside} delta={9} spark={series.outside} />
        <MetricCard
          icon={<Activity size={18} />}
          label="Activity index"
          value={horse.stress}
          delta={horse.stress === "Low" ? -3 : 12}
          spark={series.alerts}
          type="bar"
          color={stressColor}
        />
      </div>

      <div className="grid cols-3">
        {/* stress gauge */}
        <div className="card">
          <div className="card-head">
            <h3>Stress level</h3>
            <span className={`pill ${horse.stress === "High" ? "alert" : horse.stress === "Medium" ? "warn" : "ok"}`}>
              {horse.stress}
            </span>
          </div>
          <RadialGauge value={stressVal} display={horse.stress} label="5-min macro-movement" color={stressColor} />
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
          <div className="flex between" style={{ marginTop: 18, fontSize: 12.5 }}>
            <span className="muted">Started 14 days ago</span>
            <span className="muted">{horse.baselineProgress >= 100 ? "Calibrated" : "~3 days left"}</span>
          </div>
        </div>

        {/* recent alerts */}
        <div className="card">
          <div className="card-head">
            <h3>Recent alerts</h3>
            <Link to="/alerts" className="sub" style={{ color: "var(--accent)", fontWeight: 600 }}>
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

      <Modal open={cam} onClose={() => setCam(false)} title={`Live camera · ${horse.name}`} wide>
        <div className="cam" style={{ backgroundImage: `url(${horse.photo})` }}>
          <span className="live">
            <i /> LIVE
          </span>
          <span className="ts">{clock}</span>
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
          Night-vision feed · Stall {horse.stall}. Behaviour is analysed every 5 minutes against {horse.name}'s learned
          baseline.
        </p>
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
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  delta: number;
  spark: number[];
  type?: "line" | "bar";
  color?: string;
}) {
  return (
    <div className="card stat">
      <div className="top">
        <div className="chip sm">{icon}</div>
        <Delta value={delta} />
      </div>
      <div className="value" style={{ fontSize: 30, marginTop: 12 }}>
        {value}
      </div>
      <div className="foot">
        <span className="label">{label}</span>
        <Sparkline data={spark} type={type} color={color} w={70} h={28} />
      </div>
    </div>
  );
}
