// In-memory app store for the prototype (no backend).
// Seeds from mock data, then lets the UI add horses / diary notes and
// acknowledge alerts so buttons produce real, visible changes.
import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import {
  horses as seedHorses,
  alerts as seedAlerts,
  diary as seedDiary,
  healthTasks as seedHealth,
  feedItems as seedFeed,
  invoices as seedInvoices,
  Horse,
  Alert,
  DiaryEntry,
  HealthTask,
  FeedItem,
  Invoice,
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

interface StableCtx {
  horses: Horse[];
  alerts: Alert[];
  diary: DiaryEntry[];
  health: HealthTask[];
  feed: FeedItem[];
  invoices: Invoice[];
  addHorse: (h: NewHorse) => void;
  addDiary: (d: NewDiary) => void;
  addHealth: (t: NewHealth) => void;
  toggleHealth: (id: string) => void;
  addFeed: (f: NewFeed) => void;
  removeFeed: (id: string) => void;
  addInvoice: (inv: NewInvoice) => void;
  markPaid: (id: string, method: Invoice["method"]) => void;
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

  useEffect(() => persist("horses", horses), [horses]);
  useEffect(() => persist("alerts", alerts), [alerts]);
  useEffect(() => persist("diary", diary), [diary]);
  useEffect(() => persist("health", health), [health]);
  useEffect(() => persist("feed", feed), [feed]);
  useEffect(() => persist("invoices", invoices), [invoices]);

  const addHorse = useCallback((h: NewHorse) => {
    setHorses((list) => [
      ...list,
      {
        ...h,
        id: nextId("horse"),
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
    setDiary((list) => [{ ...d, id: nextId("diary"), date: "Just now" }, ...list]);
  }, []);

  const addHealth = useCallback((t: NewHealth) => {
    setHealth((list) => [...list, { ...t, id: nextId("health"), done: false }]);
  }, []);

  const toggleHealth = useCallback((id: string) => {
    setHealth((list) => list.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }, []);

  const addFeed = useCallback((f: NewFeed) => {
    setFeed((list) => [...list, { ...f, id: nextId("feed") }]);
  }, []);

  const removeFeed = useCallback((id: string) => {
    setFeed((list) => list.filter((f) => f.id !== id));
  }, []);

  const addInvoice = useCallback((inv: NewInvoice) => {
    setInvoices((list) => [
      {
        ...inv,
        id: nextId("inv"),
        number: `INV-${1001 + list.length}`,
        issued: new Date().toISOString().slice(0, 10),
        paid: false,
      },
      ...list,
    ]);
  }, []);

  const markPaid = useCallback((id: string, method: Invoice["method"]) => {
    setInvoices((list) => list.map((inv) => (inv.id === id ? { ...inv, paid: true, method } : inv)));
  }, []);

  const acknowledge = useCallback((id: string) => {
    setAlerts((list) => list.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
  }, []);

  const reset = useCallback(() => {
    setHorses(seedHorses);
    setAlerts(seedAlerts);
    setDiary(seedDiary);
    setHealth(seedHealth);
    setFeed(seedFeed);
    setInvoices(seedInvoices);
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
        addHorse,
        addDiary,
        addHealth,
        toggleHealth,
        addFeed,
        removeFeed,
        addInvoice,
        markPaid,
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
