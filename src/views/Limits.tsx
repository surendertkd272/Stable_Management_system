"use client";
// What EquiCare can and cannot do, plainly — the page a careful buyer (or a
// vet corps) reads first. Built from the behaviour guide's own honesty flags
// (server/knowledge.mjs: measured / prototype / label / sensor / not visible,
// and the gaps no source answers) plus the system's known limits.
import Link from "next/link";
import { knowledge } from "../../server/knowledge.mjs";

const { patterns: PATTERNS, gaps: GAPS } = knowledge();

const LIMITS: { title: string; text: string }[] = [
  { title: "It does not diagnose", text: "EquiCare measures behaviour and temperatures and says when something changed or looks like a known warning sign. A vet decides what it means. Every alert says so." },
  { title: "Eye temperature is a trend, not a fever reading", text: "Published studies disagree by several degrees on how eye temperature relates to rectal temperature, and distance, sun and wind change it. EquiCare compares each horse with its own normal; a fever is confirmed with a thermometer." },
  { title: "Lameness is not measured by the stall camera", text: "A camera in a stall does not see the horse trot. Gait checks done with a phone app (RealHorse, Sleip) or by a vet can be entered on the horse's page and appear in its reports." },
  { title: "Lying down is sometimes missed", text: "Camera systems miss lying more than any other state (one study caught 63%). EquiCare smooths over time and lets people confirm lying on the recording; a reviewed bout is marked as such." },
  { title: "Drinking is not measured in litres", text: "The camera can see a horse at the trough but not how much it drank. Litres need a water meter." },
  { title: "Behaviour measures are prototypes", text: "Activity, lying, eating time, vices and urine/manure from video are marked 'prototype' until checked against people on enough horses — see Accuracy checks." },
  { title: "People at the stall change what is seen", text: "Horses hide discomfort while people are with them. Behaviour is not judged during visits, so a busy stall has less to judge." },
  { title: "One camera for two stalls is untested on real hardware", text: "The several-stalls (zoom camera) mode works in simulation; it has not yet run on a real zoom camera, and its temperature accuracy at each zoom step is unknown." },
  { title: "Breed and military norms do not exist yet", text: "There are no published behaviour norms for Marwari, Kathiawari or Indian country-bred horses, nor for Indian Army horses. Each horse is compared with its own normal instead." },
];

const STATUS: Record<string, { title: string; note: string }> = {
  measured: { title: "Measured by the camera", note: "read directly, with known limits" },
  prototype: { title: "Prototype camera measures", note: "working, not yet validated on horses" },
  label: { title: "Not detected yet — people mark it on the footage", note: "no detector; staff labels teach one" },
  sensor: { title: "Needs another sensor", note: "a water meter, feeder, wearable or microphone" },
  not_visible: { title: "A stall camera cannot see it", note: "needs a close-up or a person" },
};

export default function Limits() {
  const by = (s: string) => PATTERNS.filter((p: { equicare: { status: string } }) => p.equicare.status === s);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Limits of the system</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {LIMITS.map((l) => (
            <div key={l.title}><b style={{ fontSize: 14 }}>{l.title}.</b> <span style={{ fontSize: 13.5 }}>{l.text}</span></div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Each behaviour, and what EquiCare does with it</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>From the <Link href="/guide">behaviour guide</Link>, where every entry cites its sources.</p>
        {Object.entries(STATUS).map(([s, st]) => {
          const list = by(s);
          if (!list.length) return null;
          return (
            <div key={s} style={{ marginBottom: 12 }}>
              <b style={{ fontSize: 13.5 }}>{st.title}</b> <span className="muted" style={{ fontSize: 12.5 }}>— {st.note} ({list.length})</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {list.map((p: { id: string; name: string }) => <Link key={p.id} className="pill muted" href={`/guide#${p.id}`}>{p.name}</Link>)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>What nobody can measure yet</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>No published study gives these numbers. Where EquiCare needs one, it uses its own and says so.</p>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
          {GAPS.map((g: string) => <li key={g}>{g}</li>)}
        </ul>
      </div>
    </div>
  );
}
