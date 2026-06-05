import { ReactNode, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
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
  CalendarClock,
  Wheat,
  LucideIcon,
} from "lucide-react";
import { useTheme } from "../theme";
import { useStable, useToast } from "../store";
import { breedingMares, Horse } from "../data/mock";
import { Modal } from "./ui";

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Monitoring",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/horses", label: "Horses", icon: Heart },
      { to: "/alerts", label: "Alerts", icon: Bell },
      { to: "/yard", label: "Yard View", icon: Map },
      { to: "/breeding", label: "Breeding", icon: Sparkles },
    ],
  },
  {
    title: "Records",
    items: [
      { to: "/reports", label: "Reports", icon: FileText },
      { to: "/diary", label: "Care Diary", icon: NotebookPen },
    ],
  },
  {
    title: "Operations",
    items: [
      { to: "/health", label: "Health Scheduling", icon: CalendarClock },
      { to: "/feed", label: "Feed & Nutrition", icon: Wheat },
    ],
  },
];

function Rail({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, set } = useTheme();
  const { alerts } = useStable();
  const openAlerts = alerts.filter((a) => !a.acknowledged).length;

  const item = (n: NavItem) => (
    <NavLink key={n.to} to={n.to} end={n.end} className="nav-item" onClick={onClose}>
      <n.icon size={19} />
      {n.label}
      {n.to === "/alerts" && openAlerts > 0 && <span className="count">{openAlerts}</span>}
    </NavLink>
  );

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
        {SECTIONS.map((sec) => (
          <div key={sec.title}>
            <div className="nav-section">{sec.title}</div>
            {sec.items.map(item)}
          </div>
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

const EMPTY = { name: "", breed: "", age: "", sex: "Mare" as Horse["sex"], stall: "", owner: "Bharat Sports Venture" };

function TopBar() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const { horses, alerts, health, addHorse } = useStable();
  const notify = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(EMPTY);

  const openAlerts = alerts.filter((a) => !a.acknowledged).length;
  const needAttention = horses.filter((h) => h.status === "urgent").length;
  const inLabour = breedingMares.filter((m) => m.status === "labour").length;
  const todayIso = new Date().toISOString().slice(0, 10);
  const overdueHealth = health.filter((t) => !t.done && t.due < todayIso).length;

  const titles: Record<string, { h1: string; p: string }> = {
    "/": {
      h1: "Welcome back, Surender",
      p: `${needAttention} ${needAttention === 1 ? "horse needs" : "horses need"} attention today · all cameras online`,
    },
    "/horses": { h1: "Horses", p: `${horses.length} horses monitored across 3 barns` },
    "/alerts": { h1: "Alerts", p: `${openAlerts} unacknowledged · escalation active` },
    "/yard": { h1: "Yard View", p: "Ranked by who needs attention first" },
    "/breeding": { h1: "Breeding", p: `${breedingMares.length} mares in foal · ${inLabour} in active labour` },
    "/reports": { h1: "Reports", p: "Vet-ready 7 & 30-day summaries" },
    "/diary": { h1: "Care Diary", p: "Every record makes the AI smarter" },
    "/health": {
      h1: "Health Scheduling",
      p: `${overdueHealth} overdue · vaccinations, deworming, farrier & vet visits`,
    },
    "/feed": { h1: "Feed & Nutrition", p: "Daily rations & supplements per horse" },
    "/settings": { h1: "Settings", p: "Alerts, sensitivity, account & privacy" },
  };

  const base = "/" + (pathname.split("/")[1] || "");
  const t = titles[base] ?? titles["/"];

  const matches = query.trim()
    ? horses.filter((h) => h.name.toLowerCase().includes(query.trim().toLowerCase()))
    : horses;

  const saveHorse = () => {
    if (!form.name.trim() || !form.breed.trim()) {
      notify("Name and breed are required");
      return;
    }
    addHorse({
      name: form.name.trim(),
      breed: form.breed.trim(),
      age: form.age.trim() || "—",
      sex: form.sex,
      stall: form.stall.trim() || "—",
      owner: form.owner.trim() || "Bharat Sports Venture",
    });
    notify(`${form.name.trim()} added to the yard`);
    setForm(EMPTY);
    setAddOpen(false);
    nav("/horses");
  };

  return (
    <header className="topbar">
      <div className="greeting">
        <h1>{t.h1}</h1>
        <p>{t.p}</p>
      </div>
      <div className="topbar-actions">
        <button className="icon-btn" title="Search horses" onClick={() => setSearchOpen(true)}>
          <Search size={19} />
        </button>
        <button className="icon-btn" title="Messages" onClick={() => notify("No new messages")}>
          <MessageCircle size={19} />
        </button>
        <button className="icon-btn" title="Notifications" onClick={() => nav("/alerts")}>
          <Bell size={19} />
          {openAlerts > 0 && <span className="dot" />}
        </button>
        <button className="btn-primary" onClick={() => setAddOpen(true)}>
          <Plus size={17} /> Add horse
        </button>
      </div>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a horse"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={saveHorse}>
              <Plus size={16} /> Add horse
            </button>
          </>
        }
      >
        <div className="field">
          <label>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Badal" />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Breed</label>
            <input value={form.breed} onChange={(e) => setForm({ ...form, breed: e.target.value })} placeholder="Marwari" />
          </div>
          <div className="field">
            <label>Age</label>
            <input value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} placeholder="5 yr" />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Sex</label>
            <select value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value as Horse["sex"] })}>
              <option>Mare</option>
              <option>Stallion</option>
              <option>Gelding</option>
              <option>Foal</option>
            </select>
          </div>
          <div className="field">
            <label>Stall</label>
            <input value={form.stall} onChange={(e) => setForm({ ...form, stall: e.target.value })} placeholder="A-10" />
          </div>
        </div>
        <div className="field">
          <label>Owner</label>
          <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} />
        </div>
      </Modal>

      <Modal open={searchOpen} onClose={() => setSearchOpen(false)} title="Find a horse">
        <div className="field">
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name…" />
        </div>
        {matches.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No horses match “{query}”.</p>}
        {matches.map((h) => (
          <div
            key={h.id}
            className="row"
            style={{ cursor: "pointer" }}
            onClick={() => {
              setSearchOpen(false);
              setQuery("");
              nav(`/horses/${h.id}`);
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                backgroundImage: `url(${h.photo})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                flexShrink: 0,
              }}
            />
            <div className="grow">
              <b>{h.name}</b>
              <span>
                {h.breed} · {h.sex} · Stall {h.stall}
              </span>
            </div>
          </div>
        ))}
      </Modal>
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
        <TopBar />
        {children}
      </main>
    </div>
  );
}
