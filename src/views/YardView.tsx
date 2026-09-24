"use client";

import { useRouter } from "next/navigation";
import { yardSlots, Status } from "../data/mock";
import { useStable } from "../store";
import { statusColor, StatusPill } from "../components/ui";

const RANK: Record<Status, number> = { urgent: 0, watch: 1, calm: 2 };

export default function YardView() {
  const router = useRouter();
  const nav = (to: string) => router.push(to);
  const { horses } = useStable();
  const isBlind = (m?: string) => m === "no-data" || m === "offline";
  // A stall we cannot see ranks alongside the urgent ones: it is not a calm
  // horse, it is an unknown one, and triage is exactly where that must show.
  const ranked = [...horses].sort(
    (a, b) =>
      Number(isBlind(b.monitoring)) - Number(isBlind(a.monitoring)) ||
      RANK[a.status] - RANK[b.status],
  );
  const silent = horses.filter((h) => isBlind(h.monitoring)).length;

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
            <span className="pill muted">No data</span>
          </div>
        </div>
        <div className="yardmap" style={{ minHeight: 320 }}>
          {yardSlots(horses).map((s) => {
            // A stall we are not hearing from must not wear a status colour —
            // on this map a silent box looked identical to a watched one.
            const blind = s.monitoring === "no-data" || s.monitoring === "offline";
            return (
              <div
                key={s.id}
                className={`stall${blind ? " blind" : ""}`}
                style={{ left: `${s.x}%`, top: `${s.y}%`, cursor: "pointer" }}
                title={blind ? `${s.name} — no live sensor data` : s.name}
                onClick={() => nav(`/horses/${s.id}`)}
              >
                <span
                  className="ind"
                  style={{ background: blind ? "var(--text-faint)" : statusColor(s.status) }}
                />
                {s.stall} · {s.name}
              </div>
            );
          })}
        </div>
        {/* This used to assert "Night-vision cameras cover all 6 boxes" — a
            fixed claim about installed hardware, on a yard with 7 horses and,
            today, one camera. Report what is actually reporting instead. */}
        <p className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>
          Tap any stall to open the horse.{" "}
          {silent === 0
            ? `All ${horses.length} boxes are reporting.`
            : `${horses.length - silent} of ${horses.length} boxes reporting — ${silent} hatched ${
                silent === 1 ? "stall has" : "stalls have"
              } no live sensor data.`}
        </p>
      </div>
    </div>
  );
}
