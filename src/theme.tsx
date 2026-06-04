import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "light" | "dark";
type Ctx = { theme: Theme; toggle: () => void; set: (t: Theme) => void };

const ThemeCtx = createContext<Ctx>({ theme: "light", toggle: () => {}, set: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("bsv-theme") as Theme | null;
    return saved ?? "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("bsv-theme", theme);
  }, [theme]);

  return (
    <ThemeCtx.Provider
      value={{ theme, toggle: () => setTheme((t) => (t === "light" ? "dark" : "light")), set: setTheme }}
    >
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);
