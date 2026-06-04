import { useState } from "react";
import { Syringe, Pill, Hammer, Stethoscope, Bone, Plus, Check, CalendarClock, AlertTriangle } from "lucide-react";
import { HealthTask } from "../data/mock";
import { useStable, useToast } from "../store";
import { Modal } from "../components/ui";

const ICON: Record<HealthTask["icon"], React.ReactNode> = {
  vaccine: <Syringe size={18} />,
  deworm: <Pill size={18} />,
  farrier: <Hammer size={18} />,
  vet: <Stethoscope size={18} />,
  dental: <Bone size={18} />,
};

const TYPES: { type: string; icon: HealthTask["icon"] }[] = [
  { type: "Vaccination", icon: "vaccine" },
  { type: "Deworming", icon: "deworm" },
  { type: "Farrier", icon: "farrier" },
  { type: "Vet check", icon: "vet" },
  { type: "Dental", icon: "dental" },
];

const todayIso = () => new Date().toISOString().slice(0, 10);
const DAY = 86400000;
const daysUntil = (iso: string) =>
  Math.round((new Date(iso + "T00:00:00").getTime() - new Date(todayIso() + "T00:00:00").getTime()) / DAY);

type Status = "overdue" | "soon" | "upcoming" | "done";
const statusOf = (t: HealthTask): Status => {
  if (t.done) return "done";
  const d = daysUntil(t.due);
  if (d < 0) return "overdue";
  if (d <= 7) return "soon";
  return "upcoming";
};

const dueLabel = (t: HealthTask) => {
  if (t.done) return "Completed";
  const d = daysUntil(t.due);
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  if (d < 0) return `${-d}d overdue`;
  return `Due in ${d}d`;
};

const FILTERS: { key: Status | "all"; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "overdue", label: "Overdue" },
  { key: "done", label: "Done" },
  { key: "all", label: "All" },
];

export default function Health() {
  const { horses, health, addHealth, toggleHealth } = useStable();
  const notify = useToast();
  const [filter, setFilter] = useState<Status | "all">("upcoming");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ horse: horses[0]?.name ?? "", type: "Vaccination", due: todayIso(), notes: "" });

  const overdue = health.filter((t) => statusOf(t) === "overdue").length;
  const dueWeek = health.filter((t) => statusOf(t) === "soon").length;
  const completed = health.filter((t) => t.done).length;

  const list = health
    .filter((t) => {
      const s = statusOf(t);
      if (filter === "all") return true;
      if (filter === "upcoming") return s === "upcoming" || s === "soon";
      return s === filter;
    })
    .sort((a, b) => (a.done === b.done ? a.due.localeCompare(b.due) : a.done ? 1 : -1));

  const save = () => {
    const icon = TYPES.find((t) => t.type === form.type)?.icon ?? "vet";
    addHealth({ horse: form.horse, type: form.type, due: form.due, notes: form.notes.trim(), icon });
    notify(`${form.type} scheduled for ${form.horse}`);
    setForm({ ...form, notes: "" });
    setOpen(false);
  };

  return (
    <>
      {/* summary */}
      <div className="grid cols-3" style={{ marginBottom: 22 }}>
        <SummaryCard icon={<AlertTriangle size={20} />} tone="alert" value={overdue} label="Overdue" />
        <SummaryCard icon={<CalendarClock size={20} />} tone="warn" value={dueWeek} label="Due this week" />
        <SummaryCard icon={<Check size={20} />} tone="ok" value={completed} label="Completed" />
      </div>

      <div className="flex between center wrap" style={{ marginBottom: 18, gap: 12 }}>
        <div className="tabs">
          {FILTERS.map((f) => (
            <button key={f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <button className="btn-primary" onClick={() => setOpen(true)}>
          <Plus size={16} /> Schedule task
        </button>
      </div>

      {list.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <Check size={32} color="var(--positive)" />
          <p style={{ marginTop: 10, fontWeight: 600, color: "var(--ink)" }}>Nothing here</p>
          <p className="muted" style={{ fontSize: 13 }}>No tasks match this filter.</p>
        </div>
      )}

      {list.map((t) => {
        const s = statusOf(t);
        return (
          <div
            key={t.id}
            className={`row ${s === "overdue" ? "urgent" : s === "soon" ? "watch" : "calm"}`}
            style={{ alignItems: "center", padding: "14px 16px", opacity: t.done ? 0.62 : 1 }}
          >
            <div className={`sev-chip ${s === "overdue" ? "alert" : s === "soon" ? "warn" : "ok"}`}>{ICON[t.icon]}</div>
            <div className="grow">
              <div className="flex between center wrap" style={{ gap: 8 }}>
                <b style={{ textDecoration: t.done ? "line-through" : "none" }}>
                  {t.type} · {t.horse}
                </b>
                <span
                  className={`pill ${s === "overdue" ? "alert" : s === "soon" ? "warn" : s === "done" ? "ok" : "muted"}`}
                >
                  {dueLabel(t)}
                </span>
              </div>
              <span>
                {t.notes ? `${t.notes} · ` : ""}
                {new Date(t.due + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </div>
            <button
              className={t.done ? "btn-ghost" : "btn-ghost accent"}
              onClick={() => toggleHealth(t.id)}
              style={{ flexShrink: 0 }}
            >
              {t.done ? "Undo" : <><Check size={14} /> Mark done</>}
            </button>
          </div>
        );
      })}

      <p className="muted" style={{ fontSize: 12, marginTop: 18, lineHeight: 1.5 }}>
        Scheduling is preventive-care planning only — clinical decisions stay with your vet. Reminders would be delivered
        on WhatsApp alongside incident alerts.
      </p>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Schedule a health task"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              <Plus size={16} /> Schedule
            </button>
          </>
        }
      >
        <div className="field-row">
          <div className="field">
            <label>Horse</label>
            <select value={form.horse} onChange={(e) => setForm({ ...form, horse: e.target.value })}>
              {horses.map((h) => (
                <option key={h.id} value={h.name}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Type</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.type}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Due date</label>
          <input type="date" value={form.due} min={todayIso()} onChange={(e) => setForm({ ...form, due: e.target.value })} />
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="e.g. Annual tetanus + EHV booster"
          />
        </div>
      </Modal>
    </>
  );
}

function SummaryCard({
  icon,
  tone,
  value,
  label,
}: {
  icon: React.ReactNode;
  tone: "alert" | "warn" | "ok";
  value: number;
  label: string;
}) {
  const color = tone === "alert" ? "var(--alert)" : tone === "warn" ? "var(--warn)" : "var(--positive)";
  return (
    <div className="card">
      <div className="flex gap-md center">
        <div className={`sev-chip ${tone}`}>{icon}</div>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 700, color }}>{value}</div>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}
