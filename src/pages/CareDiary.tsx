import { useState } from "react";
import { Truck, Wheat, Stethoscope, Hammer, Pill, Plus, Sparkles } from "lucide-react";
import { diary as seed, DiaryEntry } from "../data/mock";

const ICON: Record<DiaryEntry["icon"], React.ReactNode> = {
  travel: <Truck size={18} />,
  feed: <Wheat size={18} />,
  vet: <Stethoscope size={18} />,
  farrier: <Hammer size={18} />,
  deworm: <Pill size={18} />,
};

export default function CareDiary() {
  const [entries] = useState<DiaryEntry[]>(seed);

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
          <button className="btn-primary">
            <Plus size={16} /> New record
          </button>
        </div>
      </div>

      <h3 className="section-title">Recent records</h3>
      {entries.map((d) => (
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
    </>
  );
}
