"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "light" | "dark";
export const THEME_KEY = "bsv-theme";
type Ctx = { theme: Theme; toggle: () => void; set: (t: Theme) => void };

const ThemeCtx = createContext<Ctx>({ theme: "light", toggle: () => {}, set: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Start from what the no-flash script in the root layout already applied, so
  // the first client render agrees with the page. Reading localStorage in the
  // initializer directly would throw during server rendering.
  const [theme, setTheme] = useState<Theme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let saved: Theme | null = null;
    try {
      saved = localStorage.getItem(THEME_KEY) as Theme | null;
    } catch {
      /* storage blocked */
    }
    if (saved === "dark" || saved === "light") setTheme(saved);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;          // don't overwrite the saved choice with the default
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage blocked */
    }
  }, [theme, ready]);

  return (
    <ThemeCtx.Provider
      value={{ theme, toggle: () => setTheme((t) => (t === "light" ? "dark" : "light")), set: setTheme }}
    >
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);
