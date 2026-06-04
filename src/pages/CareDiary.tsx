import { useState } from "react";
import { Truck, Wheat, Stethoscope, Hammer, Pill, Plus, Sparkles } from "lucide-react";
import { DiaryEntry } from "../data/mock";
import { useStable, useToast } from "../store";
import { Modal } from "../components/ui";

const ICON: Record<DiaryEntry["icon"], React.ReactNode> = {
  travel: <Truck size={18} />,
  feed: <Wheat size={18} />,
  vet: <Stethoscope size={18} />,
  farrier: <Hammer size={18} />,
  deworm: <Pill size={18} />,
};

const CATEGORY: { icon: DiaryEntry["icon"]; label: string }[] = [
  { icon: "feed", label: "Feed change" },
  { icon: "vet", label: "Vet visit" },
  { icon: "farrier", label: "Farrier" },
  { icon: "travel", label: "Travel" },
  { icon: "deworm", label: "Deworming" },
];

export default function CareDiary() {
  const { horses, diary, addDiary } = useStable();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [horse, setHorse] = useState(horses[0]?.name ?? "");
  const [icon, setIcon] = useState<DiaryEntry["icon"]>("feed");
  const [note, setNote] = useState("");

  const save = () => {
    if (!note.trim()) return;
    const category = CATEGORY.find((c) => c.icon === icon)?.label ?? "Note";
    addDiary({ horse, category, note: note.trim(), icon });
    notify(`Record added for ${horse}`);
    setNote("");
    setOpen(false);
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="flex between center wrap" style={{ gap: 12 }}>
          <div className="flex gap-md center">
            <div className="chip">
              <Sparkles size={20} />
            </div>
            <div>
              <b style={{ fontSize: 15, color: "var(--ink)" }}>Every record makes the AI smarter</b>
              <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                Logging travel, feed changes, farrier and vet visits lets EquiCare explain away a restless night instead
                of firing a false alarm.
              </p>
            </div>
          </div>
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> New record
          </button>
        </div>
      </div>

      <h3 className="section-title">Recent records</h3>
      {diary.map((d) => (
        <div className="row" key={d.id}>
          <div className="chip sm">{ICON[d.icon]}</div>
          <div className="grow">
            <div className="flex between center wrap" style={{ gap: 8 }}>
              <b>
                {d.category} · {d.horse}
              </b>
              <span className="muted" style={{ fontSize: 12 }}>
                {d.date}
              </span>
            </div>
            <span>{d.note}</span>
          </div>
        </div>
      ))}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New care record"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              <Plus size={16} /> Add record
            </button>
          </>
        }
      >
        <div className="field">
          <label>Horse</label>
          <select value={horse} onChange={(e) => setHorse(e.target.value)}>
            {horses.map((h) => (
              <option key={h.id} value={h.name}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
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
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What happened? e.g. Switched to new hay batch, monitoring intake."
          />
        </div>
      </Modal>
    </>
  );
}
