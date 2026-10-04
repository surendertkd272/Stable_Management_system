"use client";
// What happened to each horse, as events a person can check: a short clip
// (slowed down if wanted, with a box where the system measured), a verdict —
// normal / watch / call the vet — what to do next, the behaviour-guide entry
// that explains it, and buttons to say the system was right or not. Confirmed
// events become training labels; wrong ones are kept as corrections.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, X, Info, Loader2, Download, Turtle } from "lucide-react";
import * as api from "../data/api";
import type { HorseEvent } from "../data/api";
import { useStable, useToast } from "../store";

const VERDICT: Record<HorseEvent["verdict"], { cls: string; text: string }> = {
  vet: { cls: "alert", text: "Call the vet" },
  watch: { cls: "warn", text: "Watch" },
  normal: { cls: "ok", text: "Normal" },
};
const WINDOWS = [{ h: 12, l: "12 h" }, { h: 24, l: "24 h" }, { h: 72, l: "3 days" }, { h: 168, l: "7 days" }];
const time = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Events() {
  const { horses } = useStable();
  const notify = useToast();
  const params = useSearchParams();
  const [horse, setHorse] = useState(params.get("horse") ?? "");
  const [hours, setHours] = useState(24);
  const [show, setShow] = useState<"all" | "check" | "unreviewed">("check");
  const [events, setEvents] = useState<HorseEvent[] | null>(null);
  const [err, setErr] = useState("");
  const [ticket, setTicket] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr("");
    const r = await api.listEvents({ horse: horse || undefined, from: new Date(Date.now() - hours * 3600e3).toISOString() });
    if (r.ok) setEvents(r.data); else setErr(r.error);
  }, [horse, hours]);
  useEffect(() => { setEvents(null); load(); }, [load]);
  useEffect(() => { api.footageTicket().then((r) => r.ok && setTicket(r.data.ticket)); }, []);

  const shown = useMemo(() => (events ?? []).filter((e) => show === "all" || (show === "check" ? e.verdict !== "normal" : !e.review)), [events, show]);
  const counts = useMemo(() => ({
    vet: (events ?? []).filter((e) => e.verdict === "vet").length, watch: (events ?? []).filter((e) => e.verdict === "watch").length,
    normal: (events ?? []).filter((e) => e.verdict === "normal").length, unreviewed: (events ?? []).filter((e) => !e.review).length,
  }), [events]);

  const review = async (e: HorseEvent, verdict: "confirmed" | "wrong", note: string) => {
    const r = await api.reviewEvent(e, verdict, note);
    if (!r.ok) { notify(r.details?.[0] ?? r.error); return false; }
    notify(verdict === "confirmed" ? (r.data.trainingLabel ? "Confirmed — added to the training labels" : "Confirmed") : "Correction saved — thank you");
    load();
    return true;
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
        <div className="field" style={{ margin: 0, minWidth: 180 }}>
          <label>Horse</label>
          <select value={horse} onChange={(e) => setHorse(e.target.value)}>
            <option value="">All horses</option>
            {horses.map((h) => <option key={h.id} value={h.id}>{h.name} · {h.stall}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Last</label>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {WINDOWS.map((w) => <option key={w.h} value={w.h}>{w.l}</option>)}
          </select>
        </div>
        <div className="tabs">
          <button className={show === "check" ? "on" : ""} onClick={() => setShow("check")}>To check ({counts.vet + counts.watch})</button>
          <button className={show === "unreviewed" ? "on" : ""} onClick={() => setShow("unreviewed")}>Not reviewed ({counts.unreviewed})</button>
          <button className={show === "all" ? "on" : ""} onClick={() => setShow("all")}>All ({(events ?? []).length})</button>
        </div>
        <div className="grow" />
        <a className="btn-ghost" href={api.eventReviewsCsvUrl()} onClick={async (ev) => {
          ev.preventDefault();
          const res = await fetch(api.eventReviewsCsvUrl(), { headers: { Authorization: `Bearer ${api.getToken() ?? ""}` } });
          const a = document.createElement("a"); a.href = URL.createObjectURL(await res.blob()); a.download = "equicare-event-reviews.csv"; a.click();
        }}><Download size={15} /> Reviews (CSV)</a>
      </div>

      {err && <div className="card">Could not load the events: {err}</div>}
      {!events && !err && <div className="card muted"><Loader2 className="spin" size={15} /> Loading…</div>}
      {events && !shown.length && (
        <div className="card muted">{show === "check" ? "Nothing to check in this window — no event needs a look." : "No events in this window."}</div>
      )}
      <div style={{ display: "grid", gap: 10 }}>
        {shown.map((e) => (
          <EventCard key={e.id} e={e} ticket={ticket} open={open === e.id} onOpen={() => setOpen(open === e.id ? null : e.id)} onReview={review} showHorse={!horse} />
        ))}
      </div>
    </div>
  );
}

function EventCard({ e, ticket, open, onOpen, onReview, showHorse }: {
  e: HorseEvent; ticket: string; open: boolean; onOpen: () => void; showHorse: boolean;
  onReview: (e: HorseEvent, v: "confirmed" | "wrong", note: string) => Promise<boolean>;
}) {
  const v = VERDICT[e.verdict];
  const [slow, setSlow] = useState(false);
  const [note, setNote] = useState(e.review?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [vidErr, setVidErr] = useState(false);
  const mark = e.stream === "thermal" ? (e.box ?? e.where) : null;
  const src = ticket && e.camera && e.video ? api.clipUrl(ticket, { camera: e.camera, at: e.at, stream: e.stream, stall: e.stall, mark, slow }) : null;
  const act = async (verdict: "confirmed" | "wrong") => { setBusy(true); await onReview(e, verdict, note); setBusy(false); };
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="flex" style={{ flexWrap: "wrap", gap: 10, alignItems: "center", cursor: "pointer" }} onClick={onOpen}>
        <span className={`pill ${v.cls}`}>{v.text}</span>
        <b style={{ fontSize: 14.5 }}>{e.title}</b>
        {showHorse && <span className="muted" style={{ fontSize: 13 }}>{e.horseName}</span>}
        <span className="muted" style={{ fontSize: 13 }}>{time(e.at)}</span>
        {e.detail && <span className="muted" style={{ fontSize: 12.5 }}>· {e.detail}</span>}
        {e.prototype && <span className="pill muted" title="A prototype camera measure — not yet validated on horses">prototype</span>}
        <div className="grow" />
        {e.review && <span className={`pill ${e.review.verdict === "confirmed" ? "ok" : "muted"}`}>{e.review.verdict === "confirmed" ? "confirmed" : "corrected"} · {e.review.by}</span>}
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 13 }}><b>What to do:</b> {e.next}</p>
      {open && (
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 14 }}>
          <div>
            {src && !vidErr ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video key={src} src={src} controls autoPlay muted playsInline style={{ width: "100%", borderRadius: 10, background: "#000" }} onError={() => setVidErr(true)} />
            ) : (
              <div className="card muted" style={{ padding: 24, textAlign: "center", fontSize: 12.5 }}>
                {!e.camera ? "No camera behind this event." : !e.video || vidErr ? "No recording covers this moment (switch on Record video for the camera)." : "Loading…"}
              </div>
            )}
            <div className="flex" style={{ gap: 8, marginTop: 6, alignItems: "center", fontSize: 12.5 }}>
              <label className="flex" style={{ gap: 4, alignItems: "center" }}><input type="checkbox" checked={slow} onChange={(x) => setSlow(x.target.checked)} /> <Turtle size={13} /> half speed</label>
              <span className="muted">10 s before to 20 s after{mark ? " · orange box: where it was measured" : ""}</span>
            </div>
          </div>
          <div>
            {e.pattern && (
              <p style={{ marginTop: 0, fontSize: 13 }}><Info size={13} style={{ verticalAlign: -2 }} /> <Link href={`/guide#${e.pattern}`}>What this behaviour means, with sources</Link></p>
            )}
            <div className="field" style={{ margin: 0 }}>
              <label>Your note {e.review ? "" : "(needed if it is not right)"}</label>
              <textarea rows={3} maxLength={500} value={note} placeholder="e.g. 'he was rolling after his bath, not colic'" onChange={(x) => setNote(x.target.value)} />
            </div>
            <div className="flex" style={{ gap: 8, marginTop: 8 }}>
              <button className="btn-primary" disabled={busy} onClick={() => act("confirmed")}><Check size={15} /> Right</button>
              <button className="btn-ghost" disabled={busy} onClick={() => act("wrong")}><X size={15} /> Not right</button>
            </div>
            <small className="muted" style={{ display: "block", marginTop: 6 }}>
              Your answer teaches the system: a confirmed lying-down, vice or dropping becomes a training label; a correction is kept so the detector learns what it is not.
            </small>
          </div>
        </div>
      )}
    </div>
  );
}
