import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Moon, Droplet, Sun as SunIcon } from "lucide-react";
import { horses, Status } from "../data/mock";
import { StatusPill } from "../components/ui";

const FILTERS: { key: Status | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "urgent", label: "Needs attention" },
  { key: "watch", label: "Watch" },
  { key: "calm", label: "Calm" },
];

export default function Horses() {
  const nav = useNavigate();
  const [filter, setFilter] = useState<Status | "all">("all");
  const list = horses.filter((h) => filter === "all" || h.status === filter);

  return (
    <>
      <div className="flex between center wrap" style={{ marginBottom: 18, gap: 12 }}>
        <div className="tabs">
          {FILTERS.map((f) => (
            <button key={f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 13 }}>
          {list.length} of {horses.length} horses
        </span>
      </div>

      <div className="grid cols-3">
        {list.map((h) => (
          <div key={h.id} className="horse-card" onClick={() => nav(`/horses/${h.id}`)}>
            <div className="photo" style={{ backgroundImage: `url(${h.photo})` }}>
              <div className="status">
                <StatusPill status={h.status} />
              </div>
            </div>
            <div className="flex between center">
              <h4>{h.name}</h4>
              <span className="muted" style={{ fontSize: 12 }}>
                {h.stall}
              </span>
            </div>
            <div className="meta">
              {h.breed} · {h.sex} · {h.age}
            </div>
            <div className="metrics">
              <div className="m">
                <b>{h.rest}</b>
                <span>
                  <Moon size={11} style={{ verticalAlign: "-1px" }} /> rest
                </span>
              </div>
              <div className="m">
                <b>{h.water}</b>
                <span>
                  <Droplet size={11} style={{ verticalAlign: "-1px" }} /> water
                </span>
              </div>
              <div className="m">
                <b>{h.outside}</b>
                <span>
                  <SunIcon size={11} style={{ verticalAlign: "-1px" }} /> outside
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
