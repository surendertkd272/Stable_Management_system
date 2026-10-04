"use client";
// Alert rules staff set themselves (server/staff-rules.mjs): "alert me when …",
// for one horse or all, on top of EquiCare's own alerts. Built as a sentence,
// tried on the last 7 days before saving, so a rule that would ring every
// night is seen before it does.
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Pencil, Trash2, FlaskConical, Loader2, BellRing } from "lucide-react";
import * as api from "../data/api";
import type { RuleDraft, RuleMeasure, RuleTest, StaffRule } from "../data/api";
import { useStable, useToast } from "../store";
import { useAuth } from "../auth";
import { Modal } from "../components/ui";

const WINDOWS = [15, 30, 60, 120, 180, 240, 360, 420, 480, 720, 1440];
const span = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);
const two = (n: number) => String(n).padStart(2, "0");
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const blank = (horse = "*"): RuleDraft => ({ horse, measure: "lie_downs", op: "more", value: 4, windowMin: 420, hours: null, level: "watch", name: "", note: "" });

export default function Rules() {
  const params = useSearchParams();
  const { horses } = useStable();
  const notify = useToast();
  const { user, authRequired } = useAuth();
  const [rules, setRules] = useState<StaffRule[] | null>(null);
  const [measures, setMeasures] = useState<RuleMeasure[]>([]);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<{ id: string | null; draft: RuleDraft } | null>(
    params.get("horse") ? { id: null, draft: blank(params.get("horse")!) } : null);
  const [gone, setGone] = useState<StaffRule | null>(null);

  const load = useCallback(async () => {
    const r = await api.listRules();
    if (r.ok) { setRules(r.data.rules); setMeasures(r.data.measures); } else setErr(r.error);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const mine = (r: StaffRule) => !authRequired || user?.role === "admin" || r.createdBy === user?.username;
  const toggle = async (r: StaffRule) => {
    const res = await api.patchRule(r.id, { enabled: !r.enabled });
    if (!res.ok) { notify(res.error); return; }
    notify(res.data.enabled ? "Rule on" : "Rule paused");
    load();
  };
  const remove = async () => {
    if (!gone) return;
    const res = await api.deleteRule(gone.id);
    setGone(null);
    if (!res.ok) { notify(res.error); return; }
    notify("Rule deleted");
    load();
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="flex between center wrap" style={{ gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13.5, maxWidth: 720 }}>
            Your own alerts, on top of EquiCare&apos;s — for one horse or all of them. Each rule is checked every minute against
            what the camera measured. A watch note goes to the Alerts page (and a text to the first person in the call chain, if
            that is on); an urgent rule calls the chain.
          </p>
          <button className="btn-primary" onClick={() => setEdit({ id: null, draft: blank() })}><Plus size={15} /> New rule</button>
        </div>
      </div>

      {edit && measures.length > 0 && (
        <RuleForm key={edit.id ?? "new"} id={edit.id} start={edit.draft} measures={measures} horses={horses.map((h) => ({ id: h.id, name: h.name }))}
          onClose={() => setEdit(null)} onSaved={(r) => { setEdit(null); notify(`Saved: ${r.name}`); load(); }} />
      )}

      {err && <div className="card">Could not load the rules: {err}</div>}
      {!rules && !err && <div className="card"><Loader2 className="spin" size={18} /></div>}
      {rules && !rules.length && !edit && (
        <div className="card muted" style={{ fontSize: 13.5 }}>
          No rules yet. For example: a horse on box rest — “urgent if he lies down more than 4 times in 7 hours, between 22:00 and
          05:00”; or all horses — “a watch note if a horse eats at the hay less than 60 minutes in 8 hours”.
        </div>
      )}
      <div style={{ display: "grid", gap: 10 }}>
        {rules?.map((r) => (
          <div key={r.id} className="card" style={{ padding: 16, opacity: r.enabled ? 1 : 0.62 }}>
            <div className="flex between center wrap" style={{ gap: 10 }}>
              <div className="flex center wrap" style={{ gap: 8 }}>
                <b style={{ fontSize: 15 }}>{r.name}</b>
                <span className="pill muted">{r.horseName}</span>
                <span className={`pill ${r.level === "urgent" ? "alert" : "warn"}`}>{r.level === "urgent" ? "Urgent — calls the chain" : "Watch note"}</span>
                {!r.enabled && <span className="pill muted">paused</span>}
                {r.firingNow.length > 0 && <span className="pill alert"><BellRing size={12} /> now: {r.firingNow.join(", ")}</span>}
              </div>
              {mine(r) && (
                <div className="flex center" style={{ gap: 6 }}>
                  <button className={`switch ${r.enabled ? "on" : ""}`} onClick={() => toggle(r)} aria-pressed={r.enabled} title={r.enabled ? "Pause" : "Turn on"}><i /></button>
                  <button className="btn-ghost" onClick={() => setEdit({ id: r.id, draft: { horse: r.horse, measure: r.measure, op: r.op, value: r.value, windowMin: r.windowMin, hours: r.hours, level: r.level, name: r.name, note: r.note } })}><Pencil size={14} /> Edit</button>
                  <button className="btn-ghost" onClick={() => setGone(r)}><Trash2 size={14} /></button>
                </div>
              )}
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 13.5 }}>Alert when {r.text}.</p>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              Set by {r.createdBy} on {when(r.createdAt)}{r.note ? ` — ${r.note}` : ""}
            </p>
          </div>
        ))}
      </div>

      <Modal open={!!gone} onClose={() => setGone(null)} title={`Delete “${gone?.name}”?`}
        footer={<><button className="btn-ghost" onClick={() => setGone(null)}>Cancel</button><button className="btn-primary" onClick={remove}><Trash2 size={15} /> Delete rule</button></>}>
        <p style={{ fontSize: 13.5, marginTop: 0 }}>Its alerts stop. EquiCare&apos;s own alerts are not affected. To stop it for a while instead, pause it with its switch.</p>
      </Modal>
    </>
  );
}

function RuleForm({ id, start, measures, horses, onClose, onSaved }: {
  id: string | null; start: RuleDraft; measures: RuleMeasure[]; horses: { id: string; name: string }[];
  onClose: () => void; onSaved: (r: StaffRule) => void;
}) {
  const notify = useToast();
  const [d, setD] = useState<RuleDraft>(start);
  const [test, setTest] = useState<RuleTest | null>(null);
  const [busy, setBusy] = useState<"" | "test" | "save">("");
  const m = measures.find((x) => x.key === d.measure) ?? measures[0];
  const set = (p: Partial<RuleDraft>) => { setD({ ...d, ...p }); setTest(null); };
  const isReading = m.kind === "reading";
  const unit = m.unit === "times" ? "times" : m.unit;

  const run = async () => {
    setBusy("test");
    const r = await api.testRule(d);
    setBusy("");
    if (!r.ok) { notify(r.error); return; }
    setTest(r.data);
  };
  const save = async () => {
    setBusy("save");
    const r = id ? await api.patchRule(id, d) : await api.createRule(d);
    setBusy("");
    if (!r.ok) { notify(r.error); return; }
    onSaved(r.data);
  };
  const often = test?.horses.some((h) => h.week.days >= 4);

  return (
    <div className="card" style={{ marginBottom: 14, border: "1px solid var(--accent)" }}>
      <h3 style={{ marginTop: 0 }}>{id ? "Change rule" : "New rule"}</h3>
      <div className="flex wrap" style={{ gap: 10, alignItems: "end" }}>
        <div className="field" style={{ margin: 0, minWidth: 170 }}>
          <label>Horse</label>
          <select value={d.horse} onChange={(e) => set({ horse: e.target.value })}>
            <option value="*">All horses</option>
            {horses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0, minWidth: 260 }}>
          <label>Alert when</label>
          <select value={d.measure} onChange={(e) => { const nm = measures.find((x) => x.key === e.target.value)!; set({ measure: nm.key, value: Math.min(d.value, nm.max) }); }}>
            {measures.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>is</label>
          <select value={d.op} onChange={(e) => set({ op: e.target.value as "more" | "less" })}>
            <option value="more">{isReading ? "above" : "more than"}</option>
            <option value="less">{isReading ? "below" : "less than"}</option>
          </select>
        </div>
        <div className="field" style={{ margin: 0, width: 130 }}>
          <label>{unit || "value"}</label>
          <input type="number" min={0} max={m.max} step={isReading ? (m.max <= 1 ? 0.01 : 0.1) : 1} value={d.value}
            onChange={(e) => set({ value: Number(e.target.value) })} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>in</label>
          <select value={d.windowMin} onChange={(e) => set({ windowMin: Number(e.target.value) })}>
            {WINDOWS.map((w) => <option key={w} value={w}>{isReading ? `the last ${span(w)}` : span(w)}</option>)}
          </select>
        </div>
      </div>

      <div className="flex wrap" style={{ gap: 10, alignItems: "end", marginTop: 10 }}>
        <label className="flex center" style={{ gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={!!d.hours} onChange={(e) => set({ hours: e.target.checked ? { from: 22, to: 5 } : null })} />
          Only between
        </label>
        {d.hours && (
          <>
            <div className="field" style={{ margin: 0 }}>
              <select value={d.hours.from} onChange={(e) => set({ hours: { ...d.hours!, from: Number(e.target.value) } })}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{two(h)}:00</option>)}
              </select>
            </div>
            <span style={{ fontSize: 13, paddingBottom: 10 }}>and</span>
            <div className="field" style={{ margin: 0 }}>
              <select value={d.hours.to} onChange={(e) => set({ hours: { ...d.hours!, to: Number(e.target.value) } })}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{two(h)}:00</option>)}
              </select>
            </div>
          </>
        )}
        <div className="field" style={{ margin: 0, marginLeft: "auto" }}>
          <label>Then</label>
          <select value={d.level} onChange={(e) => set({ level: e.target.value as "watch" | "urgent" })}>
            <option value="watch">a watch note</option>
            <option value="urgent">urgent — call the chain</option>
          </select>
        </div>
      </div>

      <div className="flex wrap" style={{ gap: 10, marginTop: 10 }}>
        <div className="field" style={{ margin: 0, flex: "1 1 220px" }}>
          <label>Name (optional)</label>
          <input value={d.name ?? ""} maxLength={60} placeholder={`${m.label} ${d.op === "more" ? "over" : "under"} ${d.value}`} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="field" style={{ margin: 0, flex: "2 1 320px" }}>
          <label>Why (shown with the alert)</label>
          <input value={d.note ?? ""} maxLength={200} placeholder="e.g. box rest after colic surgery — vet's orders" onChange={(e) => set({ note: e.target.value })} />
        </div>
      </div>

      {test && (
        <div className="row" style={{ marginTop: 12, display: "block", background: often ? "var(--warn-soft)" : "var(--surface-muted)", borderColor: "transparent" }}>
          <b style={{ fontSize: 13 }}>Alert when {test.text}.</b>
          {test.horses.map((h) => (
            <div key={h.horse} style={{ fontSize: 12.5, marginTop: 4 }}>
              <b>{h.horse}:</b>{" "}
              {h.week.fired
                ? `would have alerted in ${h.week.fired} of the last ${h.week.checks} hours, on ${h.week.days} day${h.week.days === 1 ? "" : "s"} (last ${when(h.week.last!.at)}, ${h.week.last!.value}).`
                : h.week.judged ? `would not have alerted in the last 7 days (judged ${h.week.judged} of ${h.week.checks} hours).`
                  : "not enough camera data in the last 7 days to judge it."}{" "}
              <span className="muted">Now: {h.now.judged ? `${h.now.value ?? "—"} — ${h.now.fires ? "alerting" : "fine"}` : `not judged (${h.now.why})`}.</span>
            </div>
          ))}
          {often && <p style={{ fontSize: 12.5, margin: "6px 0 0" }}>This would alert on most days — a higher number or a longer time keeps it for the nights that matter.</p>}
        </div>
      )}

      <div className="flex" style={{ gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-ghost" disabled={!!busy} onClick={run}>{busy === "test" ? <Loader2 className="spin" size={14} /> : <FlaskConical size={14} />} Try on the last 7 days</button>
        <button className="btn-primary" disabled={!!busy} onClick={save}>{busy === "save" ? <Loader2 className="spin" size={14} /> : null} {id ? "Save changes" : "Save rule"}</button>
      </div>
    </div>
  );
}
