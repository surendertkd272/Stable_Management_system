import { useState } from "react";
import {
  Baby,
  Heart,
  Stethoscope,
  Clock,
  CheckCircle2,
  Circle,
  Plus,
  Sparkles,
  Snowflake,
  CalendarClock,
  Minus,
} from "lucide-react";
import { breedingMares, Covering } from "../data/mock";
import { useStable, useToast } from "../store";
import { Modal } from "../components/ui";

type Tab = "foaling" | "mares" | "stallions";

const fmtDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export default function Breeding() {
  const [tab, setTab] = useState<Tab>("foaling");
  return (
    <>
      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={tab === "foaling" ? "on" : ""} onClick={() => setTab("foaling")}>
          Foaling watch
        </button>
        <button className={tab === "mares" ? "on" : ""} onClick={() => setTab("mares")}>
          Mare cycle
        </button>
        <button className={tab === "stallions" ? "on" : ""} onClick={() => setTab("stallions")}>
          Stallions
        </button>
      </div>
      {tab === "foaling" && <Foaling />}
      {tab === "mares" && <Mares />}
      {tab === "stallions" && <Stallions />}
    </>
  );
}

/* ---------------- Foaling watch (existing) ---------------- */
function Foaling() {
  return (
    <>
      <h3 className="section-title">Foaling watch</h3>
      <div className="grid cols-3" style={{ marginBottom: 28 }}>
        {breedingMares.map((m) => {
          const labour = m.status === "labour";
          return (
            <div key={m.id} className={`foaling ${labour ? "labour" : ""}`}>
              <div className="card-head">
                <h3>{m.name}</h3>
                {labour ? (
                  <span className="pill alert">Labour</span>
                ) : m.status === "watch" ? (
                  <span className="pill warn">Watch</span>
                ) : (
                  <span className="pill muted">Tracking</span>
                )}
              </div>
              <div className="countdown" style={{ color: labour ? "var(--alert)" : "var(--ink)" }}>
                {labour ? "NOW" : `${m.daysToDue}d`}
              </div>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                {labour ? "to foaling" : "until due"} · {m.stage}
              </p>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
                {m.note}
              </p>
              <div className="flex gap-sm" style={{ marginTop: 14 }}>
                <span className="pill accent">
                  <Heart size={12} /> by {m.stallion}
                </span>
                {labour && <span className="pill alert">Birth alarm</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="card-head">
            <h3>Post-foaling monitoring · Laila</h3>
            <span className="pill alert">Live</span>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
            The riskiest hours are right after birth. The AI watches each milestone and flags anything that stalls.
          </p>
          {[
            { t: "Foal stands", s: "within ~1–2 h", alert: false },
            { t: "Foal nursing", s: "first nurse", alert: false },
            { t: "Placenta passed", s: "within ~3 h", alert: true },
            { t: "Mare accepts foal", s: "no aggression", alert: false },
            { t: "Mare colic check", s: "post-foaling", alert: false },
          ].map((it, i) => (
            <div className="tl-item" key={i}>
              <div className={`tl-dot ${it.alert ? "alert" : "pending"}`} />
              <div className="tl-body">
                <b>{it.t}</b>
                <span>
                  {it.s}
                  {it.alert ? " · watch closely" : ""}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Veterinary milestones · Zarina</h3>
            <Stethoscope size={18} color="var(--text-secondary)" />
          </div>
          {[
            { t: "Twin-check scan", s: "Day 14–16 · done", done: true },
            { t: "Heartbeat scan", s: "Day 25–30 · done", done: true },
            { t: "Mid-term check", s: "Day 300 · scheduled", done: false },
            { t: "Pre-foaling prep", s: "Day 320 · mammary, waxing-up", done: false },
            { t: "Milk-calcium test", s: "nightly near term", done: false },
          ].map((it, i) => (
            <div className="row" key={i} style={{ marginBottom: 8, padding: "12px 14px" }}>
              {it.done ? (
                <CheckCircle2 size={18} color="var(--positive)" />
              ) : (
                <Circle size={18} color="var(--text-faint)" />
              )}
              <div className="grow">
                <b style={{ fontSize: 14 }}>{it.t}</b>
                <span>{it.s}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="flex gap-md center wrap">
          <div className="chip">
            <Baby size={20} />
          </div>
          <div className="grow">
            <b style={{ fontSize: 15, color: "var(--ink)" }}>Newborn foal baseline</b>
            <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              Foals nurse frequently and sleep in short bursts — they get their own baseline, not an adult one. A sudden
              drop in nursing frequency or activity is one of the highest-value early-warning signals.
            </p>
          </div>
          <div className="flex gap-sm">
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--ink)" }}>—</div>
              <span className="muted" style={{ fontSize: 11 }}>
                <Clock size={11} /> awaiting birth
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------------- Mare cycle / covering log ---------------- */
const RESULTS: Covering["result"][] = ["Open", "Covered", "In foal", "Not pregnant"];
const resultTone = (r: Covering["result"]) =>
  r === "In foal" ? "ok" : r === "Covered" ? "accent" : r === "Not pregnant" ? "alert" : "warn";

function Mares() {
  const { horses, stallions, coverings, addCovering } = useStable();
  const notify = useToast();
  const mares = horses.filter((h) => h.sex === "Mare");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    mare: mares[0]?.name ?? "",
    stallion: stallions[0]?.name ?? "—",
    method: "Natural" as Covering["method"],
    date: new Date().toISOString().slice(0, 10),
    result: "Covered" as Covering["result"],
    note: "",
  });
  const estrus = coverings.filter((c) => c.result === "Open");

  const save = () => {
    addCovering({ ...form, note: form.note.trim() });
    notify(`Covering logged for ${form.mare}`);
    setForm({ ...form, note: "" });
    setOpen(false);
  };

  return (
    <>
      {estrus.length > 0 && (
        <div className="card" style={{ marginBottom: 18, borderColor: "var(--warn)" }}>
          <div className="flex gap-md center">
            <div className="sev-chip warn">
              <Sparkles size={18} />
            </div>
            <div className="grow">
              <b style={{ fontSize: 14.5, color: "var(--ink)" }}>Estrus flagged by behaviour AI</b>
              <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                {estrus.map((e) => e.mare).join(", ")} showing patterns consistent with heat — good window to plan
                covering or AI.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex between center wrap" style={{ marginBottom: 16, gap: 12 }}>
        <h3 className="section-title" style={{ margin: 0 }}>
          Covering & cycle log
        </h3>
        <button className="btn-primary" onClick={() => setOpen(true)}>
          <Plus size={16} /> Log covering
        </button>
      </div>

      {coverings.map((c) => (
        <div className="row" key={c.id} style={{ alignItems: "center", padding: "14px 16px" }}>
          <div className="sev-chip ok">
            <Heart size={18} />
          </div>
          <div className="grow">
            <div className="flex between center wrap" style={{ gap: 8 }}>
              <b>
                {c.mare} {c.stallion !== "—" ? `× ${c.stallion}` : ""}
              </b>
              <span className={`pill ${resultTone(c.result)}`}>{c.result}</span>
            </div>
            <span>
              {c.method} · {fmtDate(c.date)}
              {c.note ? ` · ${c.note}` : ""}
            </span>
          </div>
        </div>
      ))}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Log a covering"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              <Plus size={16} /> Log
            </button>
          </>
        }
      >
        <div className="field-row">
          <div className="field">
            <label>Mare</label>
            <select value={form.mare} onChange={(e) => setForm({ ...form, mare: e.target.value })}>
              {mares.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Stallion</label>
            <select value={form.stallion} onChange={(e) => setForm({ ...form, stallion: e.target.value })}>
              <option value="—">— (none)</option>
              {stallions.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Method</label>
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as Covering["method"] })}>
              <option value="Natural">Natural</option>
              <option value="AI">AI</option>
            </select>
          </div>
          <div className="field">
            <label>Result</label>
            <select value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value as Covering["result"] })}>
              {RESULTS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Date</label>
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>
        <div className="field">
          <label>Note</label>
          <textarea
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="e.g. 30-day scan booked"
          />
        </div>
      </Modal>
    </>
  );
}

/* ---------------- Stallion management ---------------- */
function Stallions() {
  const { stallions, addStallion, adjustStraws } = useStable();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    breed: "",
    nextCollection: new Date().toISOString().slice(0, 10),
    bse: "Passed",
    straws: "0",
    note: "",
  });

  const save = () => {
    if (!form.name.trim()) {
      notify("Stallion name is required");
      return;
    }
    addStallion({
      name: form.name.trim(),
      breed: form.breed.trim() || "—",
      nextCollection: form.nextCollection,
      bse: form.bse.trim() || "—",
      straws: Number(form.straws) || 0,
      note: form.note.trim(),
    });
    notify(`${form.name.trim()} added`);
    setForm({ ...form, name: "", breed: "", note: "" });
    setOpen(false);
  };

  return (
    <>
      <div className="flex between center wrap" style={{ marginBottom: 16, gap: 12 }}>
        <h3 className="section-title" style={{ margin: 0 }}>
          Stallions
        </h3>
        <button className="btn-primary" onClick={() => setOpen(true)}>
          <Plus size={16} /> Add stallion
        </button>
      </div>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        {stallions.map((s) => (
          <div className="card" key={s.id}>
            <div className="card-head">
              <h3>
                {s.name} <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>· {s.breed}</span>
              </h3>
              <span className={`pill ${s.bse.toLowerCase().includes("pass") ? "ok" : "muted"}`}>BSE: {s.bse}</span>
            </div>

            <div className="setting-row" style={{ padding: "12px 0" }}>
              <div className="info">
                <b style={{ fontSize: 13.5 }}>
                  <CalendarClock size={13} style={{ verticalAlign: "-2px" }} /> Next collection
                </b>
                <span>{fmtDate(s.nextCollection)}</span>
              </div>
            </div>

            <div className="setting-row" style={{ padding: "12px 0" }}>
              <div className="info">
                <b style={{ fontSize: 13.5 }}>
                  <Snowflake size={13} style={{ verticalAlign: "-2px" }} /> Frozen AI straws
                </b>
                <span>In-stock inventory for artificial insemination</span>
              </div>
              <div className="flex gap-sm center">
                <button
                  className="icon-btn"
                  style={{ width: 32, height: 32 }}
                  onClick={() => adjustStraws(s.id, -1)}
                  title="Use one"
                >
                  <Minus size={15} />
                </button>
                <b style={{ fontFamily: "var(--font-display)", fontSize: 18, minWidth: 26, textAlign: "center" }}>
                  {s.straws}
                </b>
                <button
                  className="icon-btn"
                  style={{ width: 32, height: 32 }}
                  onClick={() => adjustStraws(s.id, 1)}
                  title="Add one"
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>

            {s.note && (
              <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
                {s.note}
              </p>
            )}
          </div>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a stallion"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              <Plus size={16} /> Add
            </button>
          </>
        }
      >
        <div className="field-row">
          <div className="field">
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Badal" />
          </div>
          <div className="field">
            <label>Breed</label>
            <input value={form.breed} onChange={(e) => setForm({ ...form, breed: e.target.value })} placeholder="Marwari" />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Next collection</label>
            <input
              type="date"
              value={form.nextCollection}
              onChange={(e) => setForm({ ...form, nextCollection: e.target.value })}
            />
          </div>
          <div className="field">
            <label>AI straws in stock</label>
            <input type="number" value={form.straws} onChange={(e) => setForm({ ...form, straws: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>Breeding soundness exam</label>
          <input value={form.bse} onChange={(e) => setForm({ ...form, bse: e.target.value })} placeholder="Passed" />
        </div>
        <div className="field">
          <label>Note</label>
          <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Fertility / temperament notes" />
        </div>
      </Modal>
    </>
  );
}
