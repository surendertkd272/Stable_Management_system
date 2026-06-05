import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Heart, IndianRupee, Bell, FileText, CalendarClock, Lock } from "lucide-react";
import { useStable } from "../store";
import { StatusPill, riskScore, riskBand } from "../components/ui";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const todayIso = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

export default function Portal() {
  const nav = useNavigate();
  const { horses, invoices, health, alerts } = useStable();
  const owners = Array.from(new Set(horses.map((h) => h.owner)));
  const [owner, setOwner] = useState(owners[0] ?? "");

  const myHorses = horses.filter((h) => h.owner === owner);
  const myNames = new Set(myHorses.map((h) => h.name));
  const myInvoices = invoices.filter((i) => i.owner === owner);
  const myHealth = health
    .filter((t) => !t.done && myNames.has(t.horse))
    .sort((a, b) => a.due.localeCompare(b.due));
  const myAlerts = alerts.filter((a) => myNames.has(a.horse) && !a.acknowledged);
  const outstanding = myInvoices
    .filter((i) => !i.paid)
    .reduce((s, i) => s + i.amount * (1 + i.gst / 100), 0);

  return (
    <>
      {/* "viewing as" owner switch — stands in for owner login */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="flex between center wrap" style={{ gap: 12 }}>
          <div className="flex gap-md center">
            <div className="chip">
              <Lock size={18} />
            </div>
            <div>
              <b style={{ fontSize: 15, color: "var(--ink)" }}>Owner portal — read-only</b>
              <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                Each owner signs in to see only their own horses, reports and invoices. Preview the view here.
              </p>
            </div>
          </div>
          <div className="flex gap-sm wrap">
            {owners.map((o) => (
              <button key={o} className={o === owner ? "btn-ghost accent" : "btn-ghost"} onClick={() => setOwner(o)}>
                {o}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* summary */}
      <div className="grid cols-3" style={{ marginBottom: 22 }}>
        <Summary icon={<Heart size={20} />} tone="ok" value={String(myHorses.length)} label="My horses" />
        <Summary icon={<IndianRupee size={20} />} tone="warn" value={inr(outstanding)} label="Outstanding balance" />
        <Summary icon={<Bell size={20} />} tone={myAlerts.length ? "alert" : "ok"} value={String(myAlerts.length)} label="Open alerts" />
      </div>

      {/* my horses */}
      <h3 className="section-title">My horses</h3>
      <div className="grid cols-3" style={{ marginBottom: 28 }}>
        {myHorses.map((h) => {
          const r = riskScore(h);
          const b = riskBand(r);
          return (
            <div key={h.id} className="card">
              <div
                className="photo"
                style={{
                  height: 120,
                  borderRadius: "var(--radius-inner)",
                  backgroundImage: `url(${h.photo})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  marginBottom: 12,
                }}
              />
              <div className="flex between center">
                <b style={{ fontSize: 16, color: "var(--ink)" }}>{h.name}</b>
                <StatusPill status={h.status} />
              </div>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                {h.breed} · {h.sex} · Stall {h.stall}
              </p>
              <div className="flex between center" style={{ fontSize: 11, margin: "12px 0 4px" }}>
                <span className="muted">Predictive risk</span>
                <span style={{ color: b.color, fontWeight: 700 }}>
                  {r} · {b.label}
                </span>
              </div>
              <div className="progress" style={{ height: 6 }}>
                <i style={{ width: `${r}%`, background: b.color }} />
              </div>
              <div className="flex gap-sm" style={{ marginTop: 14 }}>
                <button className="btn-ghost" style={{ flex: 1 }} onClick={() => nav(`/horses/${h.id}`)}>
                  Profile
                </button>
                <button className="btn-ghost accent" style={{ flex: 1 }} onClick={() => nav(`/reports?horse=${h.id}`)}>
                  <FileText size={14} /> Report
                </button>
              </div>
            </div>
          );
        })}
        {myHorses.length === 0 && (
          <p className="muted" style={{ fontSize: 13 }}>
            No horses registered to {owner}.
          </p>
        )}
      </div>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        {/* upcoming care */}
        <div className="card">
          <div className="card-head">
            <h3>Upcoming care</h3>
            <CalendarClock size={18} color="var(--text-secondary)" />
          </div>
          {myHealth.length === 0 && (
            <p className="muted" style={{ fontSize: 13 }}>
              Nothing scheduled.
            </p>
          )}
          {myHealth.map((t) => {
            const overdue = t.due < todayIso();
            return (
              <div className="row" key={t.id} style={{ marginBottom: 8, padding: "12px 14px" }}>
                <div className="grow">
                  <b style={{ fontSize: 14 }}>
                    {t.type} · {t.horse}
                  </b>
                  <span>{t.notes}</span>
                </div>
                <span className={`pill ${overdue ? "alert" : "muted"}`}>{fmtDate(t.due)}</span>
              </div>
            );
          })}
        </div>

        {/* invoices */}
        <div className="card">
          <div className="card-head">
            <h3>Invoices</h3>
            <IndianRupee size={18} color="var(--text-secondary)" />
          </div>
          {myInvoices.length === 0 && (
            <p className="muted" style={{ fontSize: 13 }}>
              No invoices.
            </p>
          )}
          {myInvoices.map((i) => {
            const total = i.amount * (1 + i.gst / 100);
            const overdue = !i.paid && i.dueDate < todayIso();
            return (
              <div className="row" key={i.id} style={{ marginBottom: 8, padding: "12px 14px" }}>
                <div className="grow">
                  <b style={{ fontSize: 14 }}>
                    {i.number} · {i.desc}
                  </b>
                  <span>{inr(total)} incl. GST</span>
                </div>
                <span className={`pill ${i.paid ? "ok" : overdue ? "alert" : "warn"}`}>
                  {i.paid ? `Paid · ${i.method}` : overdue ? "Overdue" : "Due"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 18, lineHeight: 1.5 }}>
        This is a preview of the owner-facing view. In production each owner authenticates and is scoped to their own
        data only — no owner can see another's horses, reports or billing.
      </p>
    </>
  );
}

function Summary({
  icon,
  tone,
  value,
  label,
}: {
  icon: React.ReactNode;
  tone: "alert" | "warn" | "ok";
  value: string;
  label: string;
}) {
  const color = tone === "alert" ? "var(--alert)" : tone === "warn" ? "var(--warn)" : "var(--positive)";
  return (
    <div className="card">
      <div className="flex gap-md center">
        <div className={`sev-chip ${tone}`}>{icon}</div>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, color }}>{value}</div>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}
