"use client";

// Behaviour guide — what each horse behaviour pattern may mean, from
// open-access veterinary sources (server/knowledge.mjs). Static data, so it is
// imported directly and works without a backend. Each entry also says what
// EquiCare can observe today, so nobody mistakes a reference for a detector.
import { useMemo, useState } from "react";
import { BookOpen, ExternalLink, AlertTriangle, Search } from "lucide-react";
import { knowledge } from "../../server/knowledge.mjs";

type Pattern = (typeof PATTERNS)[number];
const { groups: GROUPS, patterns: PATTERNS, sources: SOURCES, gaps: GAPS, compiled } = knowledge();

const SPEC: Record<string, { text: string; cls: string }> = {
  strong: { text: "Strong sign", cls: "alert" },
  weak: { text: "Weak alone — look for clusters", cls: "warn" },
  normal: { text: "Normal / context", cls: "ok" },
};
const STATUS: Record<string, { text: string; cls: string }> = {
  measured: { text: "Measured by the camera", cls: "ok" },
  prototype: { text: "From the camera video", cls: "ok" },
  label: { text: "Not detected yet — label on footage", cls: "muted" },
  sensor: { text: "Needs another sensor", cls: "muted" },
  not_visible: { text: "Camera cannot see this", cls: "muted" },
};

type Source = { title: string; url: string; kind: string; access?: string };
/** Studies by author and year; manuals and extension pages by publisher and page. */
const short = (s: Source) => {
  const [who, what] = s.title.split(" — ");
  return s.kind === "vet manual" || s.kind === "extension" ? `${who}: ${(what || "").replace(/ \(.*\)$/, "")}` : who;
};

function Entry({ p }: { p: Pattern }) {
  const spec = SPEC[p.specificity];
  const st = STATUS[p.equicare.status];
  return (
    <div className="card" style={{ padding: 16 }} id={p.id}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15.5, flex: "1 1 200px" }}>{p.name}</h3>
        <span className={`pill ${spec.cls}`}>{spec.text}</span>
      </div>
      <p style={{ margin: "0 0 6px", fontSize: 13 }}><b>Looks like:</b> {p.looks}</p>
      <p style={{ margin: "0 0 6px", fontSize: 13 }}><b>May mean:</b> {p.means}</p>
      {p.confuse && p.confuse !== "—" && <p style={{ margin: "0 0 6px", fontSize: 13 }}><b>Don&apos;t confuse with:</b> {p.confuse}</p>}
      {p.threshold && (
        <p style={{ margin: "0 0 6px", fontSize: 12.5, color: "var(--text-secondary)" }}>
          <AlertTriangle size={12} style={{ verticalAlign: -1 }} /> {p.threshold.text}
          {p.threshold.ours && " (EquiCare's setting.)"}
        </p>
      )}
      <div style={{ background: "var(--surface-muted)", borderRadius: 10, padding: "8px 10px", margin: "8px 0", fontSize: 12.5 }}>
        <span className={`pill ${st.cls}`} style={{ marginRight: 6 }}>{st.text}</span>
        {p.equicare.how}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-secondary)", display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
        {p.sources.map((id: string) => {
          const s = SOURCES[id as keyof typeof SOURCES] as Source;
          return (
            <a key={id} href={s.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }} title={s.title}>
              {short(s)}{s.access === "abstract" ? " (abstract)" : ""} <ExternalLink size={10} />
            </a>
          );
        })}
      </div>
    </div>
  );
}

export default function Guide() {
  const [group, setGroup] = useState<string>("all");
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return PATTERNS.filter((p) => (group === "all" || p.group === group)
      && (!s || `${p.name} ${p.looks} ${p.means} ${p.confuse}`.toLowerCase().includes(s)));
  }, [group, q]);

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <BookOpen size={20} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13 }}>
            What each behaviour may mean, from {Object.keys(SOURCES).length} open-access veterinary sources
            (Merck Veterinary Manual, peer-reviewed studies, university extension). A reference for staff and
            labellers — <b>not a diagnosis</b>. Each entry says whether EquiCare observes it today.
            <span style={{ color: "var(--text-secondary)" }}> Compiled {compiled}.</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <div className="theme-toggle guide-tabs" style={{ flexWrap: "wrap", borderRadius: 14 }}>
          <button className={group === "all" ? "on" : ""} onClick={() => setGroup("all")}>All</button>
          {GROUPS.map((g) => (
            <button key={g.key} className={group === g.key ? "on" : ""} onClick={() => setGroup(g.key)}>{g.name}</button>
          ))}
        </div>
        <div className="field" style={{ margin: 0, flex: "1 1 200px", position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "var(--text-secondary)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. rolling, urinate" style={{ paddingLeft: 30 }} />
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 380px), 1fr))" }}>
        {shown.map((p) => <Entry key={p.id} p={p} />)}
      </div>
      {!shown.length && <p style={{ color: "var(--text-secondary)" }}>Nothing matches.</p>}

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>What no open-access source tells us</h3>
        <p style={{ fontSize: 13, marginTop: 0 }}>Where EquiCare needs one of these numbers, it compares each horse with its own normal, and the number is ours to review with a vet.</p>
        <ul style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
          {GAPS.map((g) => <li key={g}>{g}</li>)}
        </ul>
      </div>
    </div>
  );
}
