"use client";

// App store. Reads sensor-derived data (horses/alerts/series) from the backend
// when one is reachable and writes user-authored records through to it; falls
// back entirely to mock seeds + localStorage when no backend is configured, so
// the standalone prototype keeps working unchanged.
import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import * as api from "./data/api";
import {
  horses as seedHorses,
  alerts as seedAlerts,
  diary as seedDiary,
  healthTasks as seedHealth,
  feedItems as seedFeed,
  invoices as seedInvoices,
  coverings as seedCoverings,
  stallions as seedStallions,
  series as seedSeries,
  Horse,
  Alert,
  DiaryEntry,
  HealthTask,
  FeedItem,
  Invoice,
  Covering,
  Stallion,
} from "./data/mock";

const DEFAULT_PHOTO =
  "https://images.unsplash.com/photo-1598974357801-cbca100e65d3?auto=format&fit=crop&w=600&q=70";

let seq = 0;
const nextId = (p: string) => `${p}-${Date.now()}-${++seq}`;

// Bump when the seed data shape changes, to discard stale persisted state.
const STORE_VERSION = "v1";
const key = (name: string) => `bsv-${name}-${STORE_VERSION}`;

function load<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key(name));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function persist<T>(name: string, value: T) {
  try {
    localStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    /* storage full or unavailable — stay in-memory */
  }
}

type NewHorse = Pick<Horse, "name" | "breed" | "age" | "sex" | "stall" | "owner">;
type NewDiary = Pick<DiaryEntry, "horse" | "category" | "note" | "icon">;
type NewHealth = Pick<HealthTask, "horse" | "type" | "due" | "notes" | "icon">;
type NewFeed = Pick<FeedItem, "horse" | "feed" | "amount" | "slot" | "kind">;
type NewInvoice = Pick<Invoice, "owner" | "horse" | "desc" | "amount" | "gst" | "dueDate">;
type NewCovering = Pick<Covering, "mare" | "stallion" | "method" | "date" | "result" | "note">;
type NewStallion = Pick<Stallion, "name" | "breed" | "nextCollection" | "bse" | "straws" | "note">;

interface StableCtx {
  horses: Horse[];
  alerts: Alert[];
  diary: DiaryEntry[];
  health: HealthTask[];
  feed: FeedItem[];
  invoices: Invoice[];
  coverings: Covering[];
  stallions: Stallion[];
  series: typeof seedSeries;
  addHorse: (h: NewHorse) => void;
  addDiary: (d: NewDiary) => void;
  addHealth: (t: NewHealth) => void;
  toggleHealth: (id: string) => void;
  addFeed: (f: NewFeed) => void;
  removeFeed: (id: string) => void;
  addInvoice: (inv: NewInvoice) => void;
  markPaid: (id: string, method: Invoice["method"]) => void;
  addCovering: (c: NewCovering) => void;
  addStallion: (s: NewStallion) => void;
  adjustStraws: (id: string, delta: number) => void;
  acknowledge: (id: string) => void;
  reset: () => void;
}

const Ctx = createContext<StableCtx | null>(null);

export function StableProvider({ children }: { children: ReactNode }) {
  const [horses, setHorses] = useState<Horse[]>(() => load("horses", seedHorses));
  const [alerts, setAlerts] = useState<Alert[]>(() => load("alerts", seedAlerts));
  const [diary, setDiary] = useState<DiaryEntry[]>(() => load("diary", seedDiary));
  const [health, setHealth] = useState<HealthTask[]>(() => load("health", seedHealth));
  const [feed, setFeed] = useState<FeedItem[]>(() => load("feed", seedFeed));
  const [invoices, setInvoices] = useState<Invoice[]>(() => load("invoices", seedInvoices));
  const [coverings, setCoverings] = useState<Covering[]>(() => load("coverings", seedCoverings));
  const [stallions, setStallions] = useState<Stallion[]>(() => load("stallions", seedStallions));
  const [series, setSeries] = useState<typeof seedSeries>(seedSeries);

  useEffect(() => persist("horses", horses), [horses]);
  useEffect(() => persist("alerts", alerts), [alerts]);

  // Live data: when the edge/cloud backend is reachable, sensor-derived horses
  // and alerts come from it (polled); otherwise we keep the mock seeds so the
  // standalone demo still works. Management data below stays local for now.
  useEffect(() => {
    let stop = false;
    // one-time hydration of user-authored collections (horses/alerts/series
    // are polled separately below, since the backend derives those)
    (async () => {
      const [d, he, f, inv, cov, st] = await Promise.all([
        api.getEntities<DiaryEntry>("diary"),
        api.getEntities<HealthTask>("health"),
        api.getEntities<FeedItem>("feed"),
        api.getEntities<Invoice>("invoices"),
        api.getEntities<Covering>("coverings"),
        api.getEntities<Stallion>("stallions"),
      ]);
      if (stop) return;
      if (d?.length) setDiary(d);
      if (he?.length) setHealth(he);
      if (f?.length) setFeed(f);
      if (inv?.length) setInvoices(inv);
      if (cov?.length) setCoverings(cov);
      if (st?.length) setStallions(st);
    })();

    const poll = async () => {
      const [h, a, s] = await Promise.all([api.getHorses(), api.getAlerts(), api.getSeries()]);
      if (stop) return;
      if (h && h.length) setHorses(h);
      if (a) setAlerts(a);
      if (s) setSeries((prev) => ({ ...prev, ...s }));
    };
    poll();
    const t = setInterval(poll, 15000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  useEffect(() => persist("diary", diary), [diary]);
  useEffect(() => persist("health", health), [health]);
  useEffect(() => persist("feed", feed), [feed]);
  useEffect(() => persist("invoices", invoices), [invoices]);
  useEffect(() => persist("coverings", coverings), [coverings]);
  useEffect(() => persist("stallions", stallions), [stallions]);

  const addHorse = useCallback((h: NewHorse) => {
    // Send the id we generate rather than letting the server mint its own:
    // otherwise a later patch/delete would reference an id the server never
    // saw, 404, and the record would reappear on the next reload.
    const id = nextId("horse");
    api.createEntity("horses", { ...h, id });
    setHorses((list) => [
      ...list,
      {
        ...h,
        id,
        photo: DEFAULT_PHOTO,
        status: "calm",
        statusNote: "New arrival — baseline calibrating",
        rest: "—",
        water: 0,
        outside: "—",
        stress: "Low",
        baselineProgress: 0,
      },
    ]);
  }, []);

  const addDiary = useCallback((d: NewDiary) => {
    const id = nextId("diary");
    const row = { ...d, id, date: "Just now" };
    api.createEntity("diary", row);
    setDiary((list) => [row, ...list]);
  }, []);

  const addHealth = useCallback((t: NewHealth) => {
    const row = { ...t, id: nextId("health"), done: false };
    api.createEntity("health", row);
    setHealth((list) => [...list, row]);
  }, []);

  const toggleHealth = useCallback((id: string) => {
    setHealth((list) => {
      const next = list.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
      const row = next.find((t) => t.id === id);
      if (row) api.patchEntity("health", id, { done: row.done });
      return next;
    });
  }, []);

  const addFeed = useCallback((f: NewFeed) => {
    const row = { ...f, id: nextId("feed") };
    api.createEntity("feed", row);
    setFeed((list) => [...list, row]);
  }, []);

  const removeFeed = useCallback((id: string) => {
    api.deleteEntity("feed", id);
    setFeed((list) => list.filter((f) => f.id !== id));
  }, []);

  const addInvoice = useCallback((inv: NewInvoice) => {
    setInvoices((list) => {
      const row = {
        ...inv,
        id: nextId("inv"),
        number: `INV-${1001 + list.length}`,
        issued: new Date().toISOString().slice(0, 10),
        paid: false,
      };
      api.createEntity("invoices", row);
      return [row, ...list];
    });
  }, []);

  const markPaid = useCallback((id: string, method: Invoice["method"]) => {
    api.patchEntity("invoices", id, { paid: true, method });
    setInvoices((list) => list.map((inv) => (inv.id === id ? { ...inv, paid: true, method } : inv)));
  }, []);

  const addCovering = useCallback((c: NewCovering) => {
    const row = { ...c, id: nextId("cov") };
    api.createEntity("coverings", row);
    setCoverings((list) => [row, ...list]);
  }, []);

  const addStallion = useCallback((s: NewStallion) => {
    const row = { ...s, id: nextId("st") };
    api.createEntity("stallions", row);
    setStallions((list) => [...list, row]);
  }, []);

  const adjustStraws = useCallback((id: string, delta: number) => {
    setStallions((list) => {
      const next = list.map((s) =>
        s.id === id ? { ...s, straws: Math.max(0, s.straws + delta) } : s
      );
      const row = next.find((s) => s.id === id);
      if (row) api.patchEntity("stallions", id, { straws: row.straws });
      return next;
    });
  }, []);

  const acknowledge = useCallback((id: string) => {
    setAlerts((list) => list.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
    api.ackAlert(id); // best-effort; no-op when no backend configured
  }, []);

  const reset = useCallback(() => {
    setHorses(seedHorses);
    setAlerts(seedAlerts);
    setDiary(seedDiary);
    setHealth(seedHealth);
    setFeed(seedFeed);
    setInvoices(seedInvoices);
    setCoverings(seedCoverings);
    setStallions(seedStallions);
  }, []);

  return (
    <Ctx.Provider
      value={{
        horses,
        alerts,
        diary,
        health,
        feed,
        invoices,
        coverings,
        stallions,
        series,
        addHorse,
        addDiary,
        addHealth,
        toggleHealth,
        addFeed,
        removeFeed,
        addInvoice,
        markPaid,
        addCovering,
        addStallion,
        adjustStraws,
        acknowledge,
        reset,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useStable() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStable must be used within StableProvider");
  return c;
}

/* ---------- lightweight toast system ---------- */
type Toast = { id: number; msg: string };
const ToastCtx = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((msg: string) => {
    const id = ++seq;
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
