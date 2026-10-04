"use client";
// The setup check before a calibration is saved: is the horse really where the
// boxes are? (server/setup-check.mjs) Required items must pass to save without
// a warning — the idea from handheld gait apps, which will not record until
// the eye and withers are in view.
import { CheckCircle2, Circle, XCircle, Loader2 } from "lucide-react";
import type { SetupItem } from "../data/api";

export function SetupChecklist({ items, busy = false, onRun, at, title = "Setup check" }: {
  items: SetupItem[] | null; busy?: boolean; onRun?: () => void; at?: string | null; title?: string;
}) {
  return (
    <div className="card" style={{ padding: 12, marginTop: 10 }}>
      <div className="flex" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ fontSize: 13 }}>{title}</b>
        {onRun && <span className="muted" style={{ fontSize: 12 }}>{items ? `read ${at ? new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""} — is the horse where the boxes are?` : "with the horse in place, before saving"}</span>}
        <div className="grow" />
        {onRun && <button className="btn-ghost" disabled={busy} onClick={onRun}>{busy ? <Loader2 className="spin" size={14} /> : null} {items ? "Check again" : "Check setup"}</button>}
      </div>
      {items && (
        <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
          {items.map((i) => (
            <div key={i.key} className="flex" style={{ gap: 6, alignItems: "flex-start", fontSize: 12.5 }}>
              {i.ok ? <CheckCircle2 size={15} color="var(--positive)" /> : i.required ? <XCircle size={15} color="var(--alert)" /> : <Circle size={15} color="var(--text-secondary)" />}
              <span><b>{i.label}</b>{i.required ? "" : " (optional)"} — <span className="muted">{i.detail}</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The first required items that failed, for the "save anyway?" question. */
export const failing = (items: SetupItem[] | null) =>
  items ? items.filter((i) => i.required && !i.ok).map((i) => `• ${i.label}: ${i.detail}`).join("\n") : "the setup check has not been run";
