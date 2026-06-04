import { useNavigate } from "react-router-dom";
import { horses, stallLayout, Status } from "../data/mock";
import { statusColor, StatusPill } from "../components/ui";

const RANK: Record<Status, number> = { urgent: 0, watch: 1, calm: 2 };

export default function YardView() {
  const nav = useNavigate();
  const ranked = [...horses].sort((a, b) => RANK[a.status] - RANK[b.status]);

  return (
    <div className="grid cols-2" style={{ alignItems: "start" }}>
      {/* triage list */}
      <div>
        <h3 className="section-title">Triage — who needs attention first</h3>
        {ranked.map((h, i) => (
          <div
            key={h.id}
            className={`row ${h.status === "urgent" ? "urgent" : h.status === "watch" ? "watch" : "calm"}`}
            onClick={() => nav(`/horses/${h.id}`)}
            style={{ cursor: "pointer" }}
          >
            <div
              className="chip sm"
              style={{ background: "var(--surface-muted)", color: "var(--ink)", fontFamily: "var(--font-display)", fontWeight: 700 }}
            >
              {i + 1}
            </div>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                backgroundImage: `url(${h.photo})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                flexShrink: 0,
              }}
            />
            <div className="grow">
              <div className="flex between center wrap" style={{ gap: 8 }}>
                <b>
                  {h.name} · {h.stall}
                </b>
                <StatusPill status={h.status} />
              </div>
              <span>{h.statusNote}</span>
            </div>
          </div>
        ))}
      </div>

      {/* map */}
      <div className="card">
        <div className="card-head">
          <h3>Stall layout</h3>
          <div className="flex gap-sm">
            <span className="pill ok">Calm</span>
            <span className="pill warn">Watch</span>
            <span className="pill alert">Urgent</span>
          </div>
        </div>
        <div className="yardmap" style={{ minHeight: 320 }}>
          {stallLayout.map((s) => (
            <div
              key={s.id}
              className="stall"
              style={{ left: `${s.x}%`, top: `${s.y}%`, cursor: "pointer" }}
              onClick={() => {
                const h = horses.find((x) => x.stall === s.id);
                if (h) nav(`/horses/${h.id}`);
              }}
            >
              <span className="ind" style={{ background: statusColor(s.status as Status) }} />
              {s.id} · {s.name}
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>
          Tap any stall to open the horse. Night-vision cameras cover all 6 boxes; foaling stalls have a second angle.
        </p>
      </div>
    </div>
  );
}
