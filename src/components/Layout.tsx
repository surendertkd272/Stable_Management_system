"use client";

import { ReactNode, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  LogOut,
  Plus,
  Menu,
  X,
  CalendarClock,
  Wheat,
  Receipt,
  UserCircle,
  LucideIcon,
} from "lucide-react";
import { useTheme } from "../theme";
import { useAuth } from "../auth";
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
  {
    title: "Business",
    items: [
      { to: "/billing", label: "Billing", icon: Receipt },
      { to: "/portal", label: "Owner Portal", icon: UserCircle },
    ],
  },
];

function Rail({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, set } = useTheme();
  const { alerts } = useStable();
  const openAlerts = alerts.filter((a) => !a.acknowledged).length;

  const pathname = usePathname() ?? "/";
  // `end` = exact match (the dashboard); otherwise a section stays highlighted
  // on its sub-pages, e.g. /horses/zarina keeps "Horses" active.
  const isActive = (to: string, end?: boolean) =>
    end ? pathname === to : pathname === to || pathname.startsWith(to + "/");

  const item = (n: NavItem) => (
    <Link
      key={n.to}
      href={n.to}
      className={`nav-item${isActive(n.to, n.end) ? " active" : ""}`}
      onClick={onClose}
    >
      <n.icon size={19} />
      {n.label}
      {n.to === "/alerts" && openAlerts > 0 && <span className="count">{openAlerts}</span>}
    </Link>
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
        <Link
          href="/settings"
          className={`nav-item${isActive("/settings") ? " active" : ""}`}
          onClick={onClose}
        >
          <Settings size={19} />
          Settings
        </Link>
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
        <UserBlock />
      </div>
    </aside>
  );
}

/** Signed-in user + sign-out. Falls back to the demo profile when the backend
 *  is open (standalone prototype), where there is nobody to sign out. */
function UserBlock() {
  const { user, authRequired, signOut } = useAuth();
  const initials = (user?.name ?? "Surender Y.")
    .split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const roleLabel = user
    ? { admin: "Administrator", staff: "Yard Staff", owner: "Owner" }[user.role]
    : "Yard Manager";

  return (
    <div className="profile">
      <div className="avatar">{initials}</div>
      <div className="meta">
        <b>{user?.name ?? "Surender Y."}</b>
        <span>{roleLabel}</span>
      </div>
      {authRequired && user && (
        <button className="icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out">
          <LogOut size={16} />
        </button>
      )}
    </div>
  );
}

const EMPTY = { name: "", breed: "", age: "", sex: "Mare" as Horse["sex"], stall: "", owner: "Bharat Sports Venture" };

function TopBar() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const nav = (to: string) => router.push(to);
  const { horses, alerts, health, invoices, addHorse } = useStable();
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
  const unpaidInvoices = invoices.filter((i) => !i.paid).length;
  const barnCount = new Set(horses.map((h) => h.stall[0])).size || 1;
  const reportingCount = horses.filter((h) => (h.monitoring ?? "live") === "live").length;

  // "all cameras online" was stated unconditionally. A horse that stopped
  // reporting is the one thing a monitoring header must never paper over.
  const silent = horses.filter((h) => h.monitoring && h.monitoring !== "live").length;
  const feedState = silent
    ? `${silent} ${silent === 1 ? "horse is" : "horses are"} not reporting`
    : "all sensors reporting";

  const titles: Record<string, { h1: string; p: string }> = {
    "/": {
      h1: "Welcome back, Surender",
      p: `${needAttention} ${needAttention === 1 ? "horse needs" : "horses need"} attention today · ${feedState}`,
    },
    // Both used to be constants: "3 barns" (this yard's Add-horse button sits
    // one click away and can introduce a 4th with nothing to update it), and
    // "monitored" asserted for every horse when most have no sensor at all.
    // "escalation active" is the same overclaim as the Alerts page pill —
    // notify.mjs delivers a single flat webhook per alert, not the
    // manager -> on-call -> vet chain the Settings toggle describes.
    "/horses": {
      h1: "Horses",
      p: `${horses.length} horses across ${barnCount} ${barnCount === 1 ? "barn" : "barns"} · ${reportingCount} reporting`,
    },
    "/alerts": { h1: "Alerts", p: `${openAlerts} unacknowledged` },
    "/yard": { h1: "Yard View", p: "Ranked by who needs attention first" },
    "/breeding": { h1: "Breeding", p: `${breedingMares.length} mares in foal · ${inLabour} in active labour` },
    "/reports": { h1: "Reports", p: "Vet-ready 7 & 30-day summaries" },
    // Matches the corrected line on the Care Diary card itself — the rule
    // engine does not read diary entries, so this used to promise the same
    // thing in two places that the code does not do.
    "/diary": { h1: "Care Diary", p: "Context for whoever reviews an alert" },
    "/health": {
      h1: "Health Scheduling",
      p: `${overdueHealth} overdue · vaccinations, deworming, farrier & vet visits`,
    },
    "/feed": { h1: "Feed & Nutrition", p: "Daily rations & supplements per horse" },
    "/billing": { h1: "Billing", p: `${unpaidInvoices} unpaid · invoices, GST & UPI payments` },
    "/portal": { h1: "Owner Portal", p: "Scoped read-only view of each owner's horses" },
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
