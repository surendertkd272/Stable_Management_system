"use client";

import { useT } from "../i18n";
import { useState } from "react";
import { AlertTriangle, Droplet, Sparkles, Activity, Check, Bell, Wind, Repeat, Moon, ThumbsUp, ThumbsDown, Thermometer } from "lucide-react";
import { useStable, useToast } from "../store";
import * as api from "../data/api";
import type { Verdict } from "../data/api";
import type { Alert } from "../data/mock";

const ICON: Record<string, React.ReactNode> = {
  "Early colic pattern": <AlertTriangle size={19} />,
  "Pre-foaling activity": <Sparkles size={19} />,
  "Low water intake": <Droplet size={19} />,
  "Highlight captured": <Activity size={19} />,
  "Baseline learning": <Activity size={19} />,
  "Labour logged by staff": <Sparkles size={19} />,
  "Respiratory pattern": <Wind size={19} />,
  "Stable vice": <Repeat size={19} />,
  "Low lying-down time": <Moon size={19} />,
  "Possible fever": <Thermometer size={19} />,
  "Body temperature rising": <Thermometer size={19} />,
  "Hardly lying down": <Moon size={19} />,
};

const VERDICT: Record<Verdict, string> = { right: "Marked right", wrong: "Marked wrong", unsure: "Marked unsure" };

export default function Alerts() {
  const { alerts: list, acknowledge: ack } = useStable();
  const { t } = useT();
  const notify = useToast();
  const [tab, setTab] = useState<"open" | "all">("open");
  const [marks, setMarks] = useState<Record<string, Verdict>>({});
  // Was it right? Counted per kind of alert on the Accuracy page — how the
  // stable learns which alerts to trust (and ends a silent trial).
  const mark = async (a: Alert, verdict: Verdict) => {
    const r = await api.alertVerdict(a.id, { verdict, type: a.type, horse: a.horse });
    if (!r.ok) { notify(r.error); return; }
    setMarks((m) => ({ ...m, [a.id]: verdict }));
    ack(a.id);
    notify(verdict === "right" ? "Marked right — thank you" : verdict === "wrong" ? "Marked wrong — it counts against this kind of alert" : "Marked unsure");
  };

  const shown = tab === "open" ? list.filter((a) => !a.acknowledged) : list;
  const open = list.filter((a) => !a.acknowledged).length;
  // "All clear" must not mean "no OPEN alert" if some horses have simply
  // never been heard from — that is not a clean baseline, it is a gap the
  // monitoring-gap rule already raised as its own alert. Only claim calm when
  // every one of those has actually been acknowledged too.
  const silentUnacked = list.some((a) => !a.acknowledged && a.type === "No monitoring data");

  return (
    <>
      <div className="flex between center wrap" style={{ marginBottom: 18, gap: 12 }}>
        <div className="tabs">
          <button className={tab === "open" ? "on" : ""} onClick={() => setTab("open")}>
            {t("Open")} ({open})
          </button>
          <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>
            {t("All")} ({list.length})
          </button>
        </div>
        {/* Delivery (instant, escalation, digest) is set in Settings and run
            by the server (server/notify.mjs). */}
        <span className="pill muted">
          <Bell size={13} /> {t("Delivery: see Settings")}
        </span>
      </div>

      {shown.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <Check size={32} color="var(--positive)" />
          <p style={{ marginTop: 10, fontWeight: 600, color: "var(--ink)" }}>
            {t(silentUnacked ? "No behavioural alerts" : "All clear")}
          </p>
          <p className="muted" style={{ fontSize: 13 }}>
            {silentUnacked
              ? "But check the Horses page — some stalls have never sent a reading, which will not show up here as a behaviour alert."
              : "No open alerts — every reporting horse is within baseline."}
          </p>
        </div>
      )}

      {shown.map((a) => (
        <div
          key={a.id}
          className={`row ${a.severity === "alert" ? "urgent" : a.severity === "warn" ? "watch" : "calm"}`}
          style={{ alignItems: "flex-start", padding: "16px 18px" }}
        >
          <div className={`sev-chip ${a.severity}`}>{ICON[a.type] ?? <Bell size={19} />}</div>
          <div className="grow">
            <div className="flex between center wrap" style={{ gap: 8 }}>
              <b>
                {t(a.type)} · {a.horse}
              </b>
              <span className="muted" style={{ fontSize: 12 }}>
                {a.time}
              </span>
            </div>
            <span style={{ marginTop: 4 }}>{a.detail}</span>
          </div>
          <div style={{ flexShrink: 0, display: "grid", gap: 6, justifyItems: "end" }}>
            {a.acknowledged ? (
              <span className="pill ok">
                <Check size={13} /> {t("Acknowledged")}
              </span>
            ) : (
              <button className="btn-ghost accent" onClick={() => ack(a.id)}>
                {t("Acknowledge")}
              </button>
            )}
            {(marks[a.id] ?? a.verdict) ? (
              <span className={`pill ${(marks[a.id] ?? a.verdict) === "wrong" ? "warn" : "muted"}`}>{VERDICT[(marks[a.id] ?? a.verdict)!]}</span>
            ) : a.horse !== "Stable" && a.severity !== "ok" && (
              <span className="flex center" style={{ gap: 4, fontSize: 12 }}>
                <span className="muted">Right?</span>
                <button className="btn-ghost" style={{ padding: "3px 8px" }} title="The horse showed what the alert said" onClick={() => mark(a, "right")}><ThumbsUp size={13} /></button>
                <button className="btn-ghost" style={{ padding: "3px 8px" }} title="Nothing was wrong with the horse" onClick={() => mark(a, "wrong")}><ThumbsDown size={13} /></button>
              </span>
            )}
          </div>
        </div>
      ))}

      {/* Third instance of the same overclaim on this one page (the pill and
          the empty state carried it too) — the backend delivers one flat
          webhook per alert, not an escalation chain. See notify.mjs. */}
      <p className="muted" style={{ fontSize: 12, marginTop: 18, lineHeight: 1.5 }}>
        EquiCare provides behavioural context, not diagnosis. Who is called, and when an unacknowledged
        alert goes up the chain, is set in Settings. Marking each alert right or wrong after looking at
        the horse shows, per kind of alert, how often it is right (Accuracy checks).
      </p>
    </>
  );
}
