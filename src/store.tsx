// In-memory app store for the prototype (no backend).
// Seeds from mock data, then lets the UI add horses / diary notes and
// acknowledge alerts so buttons produce real, visible changes.
import { createContext, useCallback, useContext, useState, ReactNode } from "react";
import {
  horses as seedHorses,
  alerts as seedAlerts,
  diary as seedDiary,
  Horse,
  Alert,
  DiaryEntry,
} from "./data/mock";

const DEFAULT_PHOTO =
  "https://images.unsplash.com/photo-1598974357801-cbca100e65d3?auto=format&fit=crop&w=600&q=70";

let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

type NewHorse = Pick<Horse, "name" | "breed" | "age" | "sex" | "stall" | "owner">;
type NewDiary = Pick<DiaryEntry, "horse" | "category" | "note" | "icon">;

interface StableCtx {
  horses: Horse[];
  alerts: Alert[];
  diary: DiaryEntry[];
  addHorse: (h: NewHorse) => void;
  addDiary: (d: NewDiary) => void;
  acknowledge: (id: string) => void;
}

const Ctx = createContext<StableCtx | null>(null);

export function StableProvider({ children }: { children: ReactNode }) {
  const [horses, setHorses] = useState<Horse[]>(seedHorses);
  const [alerts, setAlerts] = useState<Alert[]>(seedAlerts);
  const [diary, setDiary] = useState<DiaryEntry[]>(seedDiary);

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

  const acknowledge = useCallback((id: string) => {
    setAlerts((list) => list.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
  }, []);

  return (
    <Ctx.Provider value={{ horses, alerts, diary, addHorse, addDiary, acknowledge }}>
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
