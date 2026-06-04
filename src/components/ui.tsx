import { ReactNode } from "react";
import { TrendingUp, TrendingDown, X } from "lucide-react";
import type { Status } from "../data/mock";

/* ---------- modal ---------- */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} title="Close" style={{ width: 36, height: 36 }}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Sparkline (hand-rolled SVG, no chart dep) ---------- */
export function Sparkline({
  data,
  color = "var(--accent)",
  type = "line",
  w = 96,
  h = 36,
}: {
  data: number[];
  color?: string;
  type?: "line" | "bar";
  w?: number;
  h?: number;
}) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pad = 3;

  if (type === "bar") {
    const bw = (w - pad * 2) / data.length - 3;
    return (
      <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {data.map((d, i) => {
          const bh = ((d - min) / range) * (h - pad * 2) + 4;
          const x = pad + i * ((w - pad * 2) / data.length);
          return (
            <rect
              key={i}
              x={x}
              y={h - bh - pad}
              width={bw}
              height={bh}
              rx={2.5}
              fill={color}
              opacity={i === data.length - 1 ? 1 : 0.45}
            />
          );
        })}
      </svg>
    );
  }

  const pts = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((d - min) / range) * (h - pad * 2);
    return [x, y];
  });
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
  const area = `${path} L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h} Z`;

  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path d={area} fill={color} opacity={0.12} />
      <path d={path} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={3} fill={color} />
    </svg>
  );
}

/* ---------- Radial gauge (two segmented arcs vs baseline) ---------- */
export function RadialGauge({
  value,
  label,
  display,
  color = "var(--accent)",
}: {
  value: number; // 0-100
  label: string;
  display: string;
  color?: string;
}) {
  const r = 58;
  const c = 2 * Math.PI * r;
  const startAt = 0.7; // leave a gap at the bottom
  const arc = c * startAt;
  const filled = (value / 100) * arc;

  return (
    <div className="gauge-wrap">
      <svg width={150} height={150} viewBox="0 0 150 150">
        <g transform="rotate(135 75 75)">
          <circle
            cx={75}
            cy={75}
            r={r}
            fill="none"
            stroke="var(--surface-inset)"
            strokeWidth={12}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${c}`}
          />
          <circle
            cx={75}
            cy={75}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={12}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${c}`}
          />
        </g>
        <text x={75} y={72} textAnchor="middle" className="gauge-center" fill="var(--ink)">
          {display}
        </text>
        <text x={75} y={92} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">
          vs baseline
        </text>
      </svg>
      <div className="gauge-label">{label}</div>
    </div>
  );
}

/* ---------- status pill ---------- */
const STATUS_MAP: Record<Status, { cls: string; label: string }> = {
  calm: { cls: "ok", label: "Calm" },
  watch: { cls: "warn", label: "Watch" },
  urgent: { cls: "alert", label: "Needs attention" },
};
export function StatusPill({ status }: { status: Status }) {
  const s = STATUS_MAP[status];
  return <span className={`pill ${s.cls}`}>{s.label}</span>;
}

export const statusColor = (s: Status) =>
  s === "urgent" ? "var(--alert)" : s === "watch" ? "var(--warn)" : "var(--positive)";

/* ---------- delta ---------- */
export function Delta({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span className={`delta ${up ? "up" : "down"}`}>
      {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
      {up ? "+" : ""}
      {value}%
    </span>
  );
}

/* ---------- stat card ---------- */
export function StatCard({
  icon,
  label,
  value,
  unit,
  delta,
  spark,
  sparkType = "line",
  sparkColor,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit?: string;
  delta?: number;
  spark: number[];
  sparkType?: "line" | "bar";
  sparkColor?: string;
}) {
  return (
    <div className="card stat">
      <div className="top">
        <div className="chip">{icon}</div>
        {delta !== undefined && <Delta value={delta} />}
      </div>
      <div className="value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      <div className="foot">
        <span className="label">{label}</span>
        <Sparkline data={spark} type={sparkType} color={sparkColor} />
      </div>
    </div>
  );
}
