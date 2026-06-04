import { ReactNode, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Heart,
  Bell,
  Map,
  FileText,
  NotebookPen,
  Settings,
  Sparkles,
  Search,
  MessageCircle,
  Sun,
  Moon,
  Plus,
  Menu,
  X,
} from "lucide-react";
import { useTheme } from "../theme";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/horses", label: "Horses", icon: Heart },
  { to: "/alerts", label: "Alerts", icon: Bell, count: 2 },
  { to: "/yard", label: "Yard View", icon: Map },
  { to: "/breeding", label: "Breeding", icon: Sparkles },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/diary", label: "Care Diary", icon: NotebookPen },
];

const TITLES: Record<string, { h1: string; p: string }> = {
  "/": { h1: "Welcome back, Surender", p: "1 horse needs attention today · all cameras online" },
  "/horses": { h1: "Horses", p: "6 horses monitored across 3 barns" },
  "/alerts": { h1: "Alerts", p: "2 unacknowledged · escalation active" },
  "/yard": { h1: "Yard View", p: "Ranked by who needs attention first" },
  "/breeding": { h1: "Breeding", p: "3 mares in foal · 1 in active labour" },
  "/reports": { h1: "Reports", p: "Vet-ready 7 & 30-day summaries" },
  "/diary": { h1: "Care Diary", p: "Every record makes the AI smarter" },
  "/settings": { h1: "Settings", p: "Alerts, sensitivity, account & privacy" },
};

function Rail({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, set } = useTheme();
  return (
    <aside className={`rail ${open ? "open" : ""}`}>
      <div className="rail-logo">
        <div className="mark">
          <Heart size={20} fill="currentColor" />
        </div>
        <div className="word">
          EquiCare
          <small>BHARAT SPORTS VENTURE</small>
        </div>
      </div>

      <nav className="nav">
        <div className="nav-section">Monitoring</div>
        {NAV.slice(0, 5).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="nav-item" onClick={onClose}>
            <n.icon size={19} />
            {n.label}
            {n.count && <span className="count">{n.count}</span>}
          </NavLink>
        ))}
        <div className="nav-section">Records</div>
        {NAV.slice(5).map((n) => (
          <NavLink key={n.to} to={n.to} className="nav-item" onClick={onClose}>
            <n.icon size={19} />
            {n.label}
          </NavLink>
        ))}
        <NavLink to="/settings" className="nav-item" onClick={onClose}>
          <Settings size={19} />
          Settings
        </NavLink>
      </nav>

      <div className="rail-foot">
        <div className="theme-toggle">
          <button className={theme === "light" ? "on" : ""} onClick={() => set("light")}>
            <Sun size={15} /> Light
          </button>
          <button className={theme === "dark" ? "on" : ""} onClick={() => set("dark")}>
            <Moon size={15} /> Dark
          </button>
        </div>
        <div className="profile">
          <div className="avatar">SY</div>
          <div className="meta">
            <b>Surender Y.</b>
            <span>Yard Manager</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { pathname } = useLocation();
  const base = "/" + (pathname.split("/")[1] || "");
  const t = TITLES[base] ?? TITLES["/"];
  return (
    <header className="topbar">
      <div className="greeting">
        <h1>{t.h1}</h1>
        <p>{t.p}</p>
      </div>
      <div className="topbar-actions">
        <button className="icon-btn" title="Search">
          <Search size={19} />
        </button>
        <button className="icon-btn" title="Messages">
          <MessageCircle size={19} />
        </button>
        <button className="icon-btn" title="Notifications">
          <Bell size={19} />
          <span className="dot" />
        </button>
        <button className="btn-primary">
          <Plus size={17} /> Add horse
        </button>
      </div>
    </header>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="app-shell">
      <Rail open={open} onClose={() => setOpen(false)} />
      <main className="main">
        <div className="mobile-bar">
          <button className="icon-btn" onClick={() => setOpen((o) => !o)}>
            {open ? <X size={19} /> : <Menu size={19} />}
          </button>
          <b style={{ fontFamily: "var(--font-display)" }}>EquiCare</b>
        </div>
        <TopBar onMenu={() => setOpen((o) => !o)} />
        {children}
      </main>
    </div>
  );
}
