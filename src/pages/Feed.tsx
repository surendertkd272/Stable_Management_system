import { useEffect, useState } from "react";
import { Leaf, Wheat, Pill, Plus, X, Sun, Sunset, CloudSun, Infinity as InfinityIcon } from "lucide-react";
import { FeedItem } from "../data/mock";
import { useStable, useToast } from "../store";
import { getHorseDetail } from "../data/api";
import { Sparkline } from "../components/ui";
import { Modal } from "../components/ui";

const KIND_ICON: Record<FeedItem["kind"], React.ReactNode> = {
  forage: <Leaf size={16} />,
  concentrate: <Wheat size={16} />,
  supplement: <Pill size={16} />,
};

const KINDS: FeedItem["kind"][] = ["forage", "concentrate", "supplement"];
const SLOTS: { slot: FeedItem["slot"]; icon: React.ReactNode }[] = [
  { slot: "Morning", icon: <Sun size={16} /> },
  { slot: "Midday", icon: <CloudSun size={16} /> },
  { slot: "Evening", icon: <Sunset size={16} /> },
  { slot: "Free-choice", icon: <InfinityIcon size={16} /> },
];

/** Last value of a series, 0 when empty. */
const last = (a: number[]) => (a.length ? a[a.length - 1] : 0);

export default function Feed() {
  const { horses, feed, addFeed, removeFeed } = useStable();
  const notify = useToast();
  const [horseName, setHorseName] = useState(horses[0]?.name ?? "");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ feed: string; amount: string; slot: FeedItem["slot"]; kind: FeedItem["kind"] }>({
    feed: "",
    amount: "",
    slot: "Morning",
    kind: "forage",
  });

  const horse = horses.find((h) => h.name === horseName) ?? horses[0];
  const mine = feed.filter((f) => f.horse === horse?.name);

  // Planned rations are only half the picture. What the horse actually ATE —
  // and especially what it refused — is the earliest illness signal we have,
  // so surface the measured intake alongside the plan when sensors report it.
  const [actual, setActual] = useState<{
    intake: number[]; refusal: number[]; latestIntake?: number; latestRefusal?: number;
  } | null>(null);

  useEffect(() => {
    if (!horse) return;
    let stop = false;
    getHorseDetail(horse.id).then((d) => {
      if (stop || !d) return;
      const intake = d.charts?.feed_intake_g ?? [];
      const refusal = d.charts?.feed_refusal_g ?? [];
      if (!intake.some((v) => v > 0)) { setActual(null); return; }   // no feed sensor yet
      setActual({
        intake, refusal,
        latestIntake: d.vitals?.feed_intake_g?.value,
        latestRefusal: d.vitals?.feed_refusal_g?.value,
      });
    });
    return () => { stop = true; };
  }, [horse?.id]);
  const supplements = mine.filter((f) => f.kind === "supplement").length;

  const save = () => {
    if (!form.feed.trim()) {
      notify("Feed name is required");
      return;
    }
    addFeed({
      horse: horse.name,
      feed: form.feed.trim(),
      amount: form.amount.trim() || "—",
      slot: form.slot,
      kind: form.kind,
    });
    notify(`${form.feed.trim()} added to ${horse.name}'s ration`);
    setForm({ ...form, feed: "", amount: "" });
    setOpen(false);
  };

  return (
    <>
      <div className="flex between center wrap" style={{ marginBottom: 18, gap: 12 }}>
        <div className="flex gap-sm wrap">
          {horses.map((h) => (
            <button
              key={h.id}
              className={h.name === horse?.name ? "btn-ghost accent" : "btn-ghost"}
              onClick={() => setHorseName(h.name)}
            >
              {h.name}
            </button>
          ))}
        </div>
        <button className="btn-primary" onClick={() => setOpen(true)}>
          <Plus size={16} /> Add feed item
        </button>
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <div className="flex between center wrap" style={{ gap: 12 }}>
          <div className="flex gap-md center">
            <div className="chip">
              <Wheat size={20} />
            </div>
            <div>
              <b style={{ fontSize: 17, color: "var(--ink)", fontFamily: "var(--font-display)" }}>
                {horse?.name} — daily ration
              </b>
              <p className="muted" style={{ fontSize: 13 }}>
                {mine.length} items across the day · {supplements} supplement{supplements === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <span className="pill muted">{horse?.breed} · {horse?.sex}</span>
        </div>
      </div>

      {/* Measured intake — only rendered when a feed sensor is actually
          reporting. Refusal is the signal that matters clinically. */}
      {actual && (
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="card-head">
            <h3>Measured intake</h3>
            <span className="pill accent">from feeder</span>
          </div>
          <div className="grid cols-2" style={{ gap: 16 }}>
            <div>
              <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Eaten today</p>
              <b style={{ fontSize: 22, color: "var(--ink)", fontFamily: "var(--font-display)" }}>
                {(last(actual.intake) / 1000).toFixed(1)} kg
              </b>
              <Sparkline data={actual.intake} />
            </div>
            <div>
              <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Refused today</p>
              <b
                style={{
                  fontSize: 22,
                  fontFamily: "var(--font-display)",
                  color: last(actual.refusal) > 500 ? "var(--alert)" : "var(--ink)",
                }}
              >
                {(last(actual.refusal) / 1000).toFixed(1)} kg
              </b>
              <Sparkline data={actual.refusal} type="bar" color="var(--alert)" />
            </div>
          </div>
          {last(actual.refusal) > 500 && (
            <p style={{ fontSize: 13, marginTop: 12, color: "var(--alert)" }}>
              Refusal is above normal for {horse?.name} — a horse going off its feed is often
              the earliest sign of illness. Worth a check.
            </p>
          )}
        </div>
      )}

      {mine.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <Wheat size={30} color="var(--text-faint)" />
          <p style={{ marginTop: 10, fontWeight: 600, color: "var(--ink)" }}>No ration set</p>
          <p className="muted" style={{ fontSize: 13 }}>Add feed items to build {horse?.name}'s daily plan.</p>
        </div>
      )}

      <div className="stack">
        {SLOTS.map(({ slot, icon }) => {
          const items = mine.filter((f) => f.slot === slot);
          if (items.length === 0) return null;
          return (
            <div className="card" key={slot}>
              <div className="card-head">
                <h3 className="flex gap-sm center" style={{ display: "flex" }}>
                  {icon} {slot}
                </h3>
                <span className="sub">{items.length} item{items.length === 1 ? "" : "s"}</span>
              </div>
              {items.map((f) => (
                <div className="row" key={f.id} style={{ marginBottom: 8, padding: "12px 14px" }}>
                  <div className="chip sm">{KIND_ICON[f.kind]}</div>
                  <div className="grow">
                    <div className="flex between center wrap" style={{ gap: 8 }}>
                      <b style={{ fontSize: 14 }}>{f.feed}</b>
                      <span className="pill muted" style={{ textTransform: "capitalize" }}>
                        {f.kind}
                      </span>
                    </div>
                    <span>{f.amount}</span>
                  </div>
                  <button
                    className="icon-btn"
                    title="Remove"
                    style={{ width: 34, height: 34, flexShrink: 0 }}
                    onClick={() => {
                      removeFeed(f.id);
                      notify(`Removed ${f.feed}`);
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 18, lineHeight: 1.5 }}>
        Ration changes logged here can be cross-posted to the Care Diary so the AI can explain a restless night after a
        feed switch instead of raising a false alarm.
      </p>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Add feed item · ${horse?.name}`}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              <Plus size={16} /> Add item
            </button>
          </>
        }
      >
        <div className="field">
          <label>Feed</label>
          <input
            value={form.feed}
            onChange={(e) => setForm({ ...form, feed: e.target.value })}
            placeholder="e.g. Performance mix"
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Amount</label>
            <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="2 kg" />
          </div>
          <div className="field">
            <label>Kind</label>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as FeedItem["kind"] })}>
              {KINDS.map((k) => (
                <option key={k} value={k} style={{ textTransform: "capitalize" }}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Feeding slot</label>
          <select value={form.slot} onChange={(e) => setForm({ ...form, slot: e.target.value as FeedItem["slot"] })}>
            {SLOTS.map((s) => (
              <option key={s.slot} value={s.slot}>
                {s.slot}
              </option>
            ))}
          </select>
        </div>
      </Modal>
    </>
  );
}
