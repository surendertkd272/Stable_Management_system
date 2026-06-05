import { useState } from "react";
import { Receipt, IndianRupee, AlertTriangle, CheckCircle2, Plus, Smartphone } from "lucide-react";
import { Invoice } from "../data/mock";
import { useStable, useToast } from "../store";
import { Modal } from "../components/ui";

const todayIso = () => new Date().toISOString().slice(0, 10);
const DAY = 86400000;
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const total = (i: Invoice) => i.amount * (1 + i.gst / 100);

type Status = "paid" | "overdue" | "due";
const statusOf = (i: Invoice): Status => (i.paid ? "paid" : i.dueDate < todayIso() ? "overdue" : "due");

const dueLabel = (i: Invoice) => {
  if (i.paid) return `Paid · ${i.method ?? "—"}`;
  const d = Math.round((new Date(i.dueDate + "T00:00:00").getTime() - new Date(todayIso() + "T00:00:00").getTime()) / DAY);
  if (d < 0) return `${-d}d overdue`;
  if (d === 0) return "Due today";
  return `Due in ${d}d`;
};

const FILTERS: { key: Status | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "due", label: "Due" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
];

export default function Billing() {
  const { horses, invoices, addInvoice, markPaid } = useStable();
  const notify = useToast();
  const [filter, setFilter] = useState<Status | "all">("all");
  const [open, setOpen] = useState(false);
  const owners = Array.from(new Set(horses.map((h) => h.owner)));
  const [form, setForm] = useState({
    owner: owners[0] ?? "",
    horse: "—",
    desc: "",
    amount: "",
    gst: "18",
    dueDate: new Date(Date.now() + 14 * DAY).toISOString().slice(0, 10),
  });

  const outstanding = invoices.filter((i) => !i.paid).reduce((s, i) => s + total(i), 0);
  const overdueCount = invoices.filter((i) => statusOf(i) === "overdue").length;
  const collected = invoices.filter((i) => i.paid).reduce((s, i) => s + total(i), 0);

  const list = invoices.filter((i) => (filter === "all" ? true : statusOf(i) === filter));

  const save = () => {
    const amount = Number(form.amount);
    if (!form.desc.trim() || !amount) {
      notify("Description and amount are required");
      return;
    }
    addInvoice({
      owner: form.owner,
      horse: form.horse,
      desc: form.desc.trim(),
      amount,
      gst: Number(form.gst) || 0,
      dueDate: form.dueDate,
    });
    notify(`Invoice raised for ${form.owner}`);
    setForm({ ...form, desc: "", amount: "" });
    setOpen(false);
  };

  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 22 }}>
        <SummaryCard icon={<IndianRupee size={20} />} tone="warn" value={inr(outstanding)} label="Outstanding" />
        <SummaryCard icon={<AlertTriangle size={20} />} tone="alert" value={String(overdueCount)} label="Overdue invoices" />
        <SummaryCard icon={<CheckCircle2 size={20} />} tone="ok" value={inr(collected)} label="Collected" />
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
          <Plus size={16} /> New invoice
        </button>
      </div>

      {list.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <Receipt size={30} color="var(--text-faint)" />
          <p style={{ marginTop: 10, fontWeight: 600, color: "var(--ink)" }}>No invoices</p>
          <p className="muted" style={{ fontSize: 13 }}>Nothing matches this filter.</p>
        </div>
      )}

      {list.map((i) => {
        const s = statusOf(i);
        return (
          <div
            key={i.id}
            className={`row ${s === "overdue" ? "urgent" : s === "due" ? "watch" : "calm"}`}
            style={{ alignItems: "center", padding: "16px 18px" }}
          >
            <div className={`sev-chip ${s === "overdue" ? "alert" : s === "due" ? "warn" : "ok"}`}>
              <Receipt size={18} />
            </div>
            <div className="grow">
              <div className="flex between center wrap" style={{ gap: 8 }}>
                <b>
                  {i.number} · {i.owner}
                </b>
                <span className={`pill ${s === "overdue" ? "alert" : s === "due" ? "warn" : "ok"}`}>{dueLabel(i)}</span>
              </div>
              <span>
                {i.desc}
                {i.horse && i.horse !== "—" ? ` · ${i.horse}` : ""} · {inr(i.amount)} + {i.gst}% GST
              </span>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0, minWidth: 110 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>
                {inr(total(i))}
              </div>
              {i.paid ? (
                <span className="pill ok" style={{ marginTop: 4 }}>
                  <CheckCircle2 size={12} /> {i.method}
                </span>
              ) : (
                <button
                  className="btn-ghost accent"
                  style={{ marginTop: 6, padding: "6px 12px" }}
                  onClick={() => {
                    markPaid(i.id, "UPI");
                    notify(`${i.number} marked paid via UPI`);
                  }}
                >
                  <Smartphone size={13} /> Record UPI
                </button>
              )}
            </div>
          </div>
        );
      })}

      <p className="muted" style={{ fontSize: 12, marginTop: 18, lineHeight: 1.5 }}>
        GST is applied per invoice and totals are shown inclusive. Payments here are recorded manually; UPI/bank
        reconciliation would connect to a payment gateway in the backend.
      </p>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New invoice"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              <Plus size={16} /> Raise invoice
            </button>
          </>
        }
      >
        <div className="field-row">
          <div className="field">
            <label>Owner</label>
            <select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Horse</label>
            <select value={form.horse} onChange={(e) => setForm({ ...form, horse: e.target.value })}>
              <option value="—">— (none)</option>
              {horses.map((h) => (
                <option key={h.id} value={h.name}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Description</label>
          <input
            value={form.desc}
            onChange={(e) => setForm({ ...form, desc: e.target.value })}
            placeholder="e.g. Monthly livery & training"
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Amount (₹, ex-GST)</label>
            <input
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="45000"
            />
          </div>
          <div className="field">
            <label>GST %</label>
            <input type="number" value={form.gst} onChange={(e) => setForm({ ...form, gst: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>Due date</label>
          <input
            type="date"
            value={form.dueDate}
            min={todayIso()}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
          />
        </div>
        {form.amount && (
          <p className="muted" style={{ fontSize: 13 }}>
            Total incl. GST: <b style={{ color: "var(--ink)" }}>{inr(Number(form.amount) * (1 + (Number(form.gst) || 0) / 100))}</b>
          </p>
        )}
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
