// Mock data for the BSV EquiCare frontend prototype.
// No backend — everything here is illustrative sample content.

export type Status = "calm" | "watch" | "urgent";

export interface Horse {
  id: string;
  name: string;
  breed: string;
  age: string;
  sex: "Mare" | "Stallion" | "Gelding" | "Foal";
  stall: string;
  owner: string;
  photo: string;
  status: Status;
  statusNote: string;
  rest: string; // daily rest
  water: number; // visits
  outside: string; // time outside box
  stress: "Low" | "Medium" | "High";
  baselineProgress: number; // 0-100
}

const img = (seed: string) =>
  `https://images.unsplash.com/${seed}?auto=format&fit=crop&w=600&q=70`;

export const horses: Horse[] = [
  {
    id: "zarina",
    name: "Zarina",
    breed: "Marwari",
    age: "7 yr",
    sex: "Mare",
    stall: "A-04",
    owner: "Bharat Sports Venture",
    photo: img("photo-1553284965-83fd3e82fa5a"),
    status: "urgent",
    statusNote: "Repeated lying-up cycling since 02:10 — colic pattern",
    rest: "4h 10m",
    water: 3,
    outside: "1h 05m",
    stress: "High",
    baselineProgress: 100,
  },
  {
    id: "shaan",
    name: "Shaan",
    breed: "Thoroughbred",
    age: "5 yr",
    sex: "Stallion",
    stall: "B-01",
    owner: "Bharat Sports Venture",
    photo: img("photo-1534773728080-33d31da27ae5"),
    status: "watch",
    statusNote: "Lower water intake vs baseline",
    rest: "6h 32m",
    water: 5,
    outside: "3h 20m",
    stress: "Medium",
    baselineProgress: 100,
  },
  {
    id: "noor",
    name: "Noor",
    breed: "Marwari",
    age: "9 yr",
    sex: "Mare",
    stall: "A-07",
    owner: "R. Singh",
    photo: img("photo-1598974357801-cbca100e65d3"),
    status: "watch",
    statusNote: "Foaling due in 6 days — pre-foaling watch",
    rest: "7h 05m",
    water: 7,
    outside: "2h 40m",
    stress: "Low",
    baselineProgress: 100,
  },
  {
    id: "raja",
    name: "Raja",
    breed: "Kathiawari",
    age: "11 yr",
    sex: "Gelding",
    stall: "C-02",
    owner: "Equestrian Club",
    photo: img("photo-1557374800-8ba4ccd60e9d"),
    status: "calm",
    statusNote: "Within baseline across all signals",
    rest: "7h 48m",
    water: 8,
    outside: "4h 10m",
    stress: "Low",
    baselineProgress: 100,
  },
  {
    id: "meher",
    name: "Meher",
    breed: "Thoroughbred",
    age: "4 yr",
    sex: "Mare",
    stall: "B-05",
    owner: "Bharat Sports Venture",
    photo: img("photo-1593179449458-e0d43d512551"),
    status: "calm",
    statusNote: "Resting normally",
    rest: "8h 12m",
    water: 9,
    outside: "3h 55m",
    stress: "Low",
    baselineProgress: 74,
  },
  {
    id: "sultan",
    name: "Sultan",
    breed: "Arabian",
    age: "6 yr",
    sex: "Stallion",
    stall: "C-06",
    owner: "Bharat Sports Venture",
    photo: img("photo-1606107869722-d5cbadabe2f0"),
    status: "calm",
    statusNote: "Within baseline",
    rest: "7h 20m",
    water: 7,
    outside: "4h 30m",
    stress: "Low",
    baselineProgress: 100,
  },
  {
    id: "laila",
    name: "Laila",
    breed: "Marwari",
    age: "8 yr",
    sex: "Mare",
    stall: "A-09",
    owner: "Bharat Sports Venture",
    photo: img("photo-1601726429844-acd8b1385972"),
    status: "urgent",
    statusNote: "Active labour since 02:05 — birth alarm on",
    rest: "2h 30m",
    water: 4,
    outside: "0h 30m",
    stress: "High",
    baselineProgress: 100,
  },
];

export interface Alert {
  id: string;
  horse: string;
  type: string;
  severity: "alert" | "warn" | "ok";
  time: string;
  detail: string;
  acknowledged: boolean;
}

export const alerts: Alert[] = [
  {
    id: "a1",
    horse: "Zarina",
    type: "Early colic pattern",
    severity: "alert",
    time: "02:18 · just now",
    detail:
      "Repeated lying-down/standing cycling, rolling and restlessness well above baseline for the last 4 hours.",
    acknowledged: false,
  },
  {
    id: "a2",
    horse: "Noor",
    type: "Pre-foaling activity",
    severity: "warn",
    time: "01:40 · 38 min ago",
    detail: "Mild restlessness and frequent position changes — consistent with approaching foaling.",
    acknowledged: false,
  },
  {
    id: "a3",
    horse: "Shaan",
    type: "Low water intake",
    severity: "warn",
    time: "Yesterday · 21:05",
    detail: "Water-area visits 40% below this horse's learned baseline over 24h.",
    acknowledged: true,
  },
  {
    id: "a4",
    horse: "Raja",
    type: "Highlight captured",
    severity: "ok",
    time: "Yesterday · 17:22",
    detail: "A nice rolling-and-shake moment in turnout — saved to Highlights.",
    acknowledged: true,
  },
  {
    id: "a5",
    horse: "Meher",
    type: "Baseline learning",
    severity: "ok",
    time: "Yesterday · 09:00",
    detail: "Calibration 74% complete — alerts will sharpen over the next few days.",
    acknowledged: true,
  },
  {
    id: "a6",
    horse: "Laila",
    type: "Foaling labour detected",
    severity: "alert",
    time: "02:05 · just now",
    detail: "Labour behaviour detected — birth alarm active. Post-foaling milestones now being watched.",
    acknowledged: false,
  },
];

export interface Mare {
  id: string;
  name: string;
  stage: string;
  daysToDue: number;
  status: "watch" | "labour" | "tracking";
  note: string;
  stallion: string;
}

export const breedingMares: Mare[] = [
  {
    id: "noor",
    name: "Noor",
    stage: "Day 334 of gestation",
    daysToDue: 6,
    status: "watch",
    note: "Mammary development started · milk-calcium test recommended nightly",
    stallion: "Sultan",
  },
  {
    id: "zarina",
    name: "Zarina",
    stage: "Day 281 of gestation",
    daysToDue: 59,
    status: "tracking",
    note: "30-day heartbeat scan confirmed · next check at day 300",
    stallion: "Shaan",
  },
  {
    id: "laila",
    name: "Laila",
    stage: "Day 340 of gestation",
    daysToDue: 0,
    status: "labour",
    note: "Labour behaviour detected at 02:05 — birth alarm active",
    stallion: "Sultan",
  },
];

export interface DiaryEntry {
  id: string;
  horse: string;
  category: string;
  note: string;
  date: string;
  icon: "feed" | "vet" | "farrier" | "travel" | "deworm";
}

export const diary: DiaryEntry[] = [
  {
    id: "d1",
    horse: "Zarina",
    category: "Travel",
    note: "Transported back from regional show (4h float).",
    date: "Yesterday",
    icon: "travel",
  },
  {
    id: "d2",
    horse: "Shaan",
    category: "Feed change",
    note: "Switched to new oat batch — monitoring intake.",
    date: "2 days ago",
    icon: "feed",
  },
  {
    id: "d3",
    horse: "Noor",
    category: "Vet visit",
    note: "Pre-foaling check — all normal, mammary developing.",
    date: "3 days ago",
    icon: "vet",
  },
  {
    id: "d4",
    horse: "Raja",
    category: "Farrier",
    note: "Full set, no issues. Next visit in 6 weeks.",
    date: "5 days ago",
    icon: "farrier",
  },
  {
    id: "d5",
    horse: "Meher",
    category: "Deworming",
    note: "Routine deworming administered.",
    date: "1 week ago",
    icon: "deworm",
  },
];

// ---- health scheduling (vaccinations, deworming, farrier, vet, dental) ----
export interface HealthTask {
  id: string;
  horse: string;
  type: string;
  due: string; // ISO yyyy-mm-dd
  notes: string;
  done: boolean;
  icon: "vaccine" | "deworm" | "farrier" | "vet" | "dental";
}

const DAY_MS = 86400000;
// Seed dates are relative to first load so "overdue / due soon" looks live.
const isoIn = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

export const healthTasks: HealthTask[] = [
  { id: "h1", horse: "Zarina", type: "Vaccination", due: isoIn(-12), notes: "Annual tetanus + EHV booster overdue", done: false, icon: "vaccine" },
  { id: "h2", horse: "Shaan", type: "Farrier", due: isoIn(-2), notes: "Full set — check near-fore", done: false, icon: "farrier" },
  { id: "h3", horse: "Noor", type: "Vet check", due: isoIn(1), notes: "Pre-foaling check", done: false, icon: "vet" },
  { id: "h4", horse: "Raja", type: "Deworming", due: isoIn(4), notes: "Rotational wormer", done: false, icon: "deworm" },
  { id: "h5", horse: "Meher", type: "Dental", due: isoIn(9), notes: "Routine rasp / float", done: false, icon: "dental" },
  { id: "h6", horse: "Sultan", type: "Vaccination", due: isoIn(21), notes: "Influenza booster", done: false, icon: "vaccine" },
  { id: "h7", horse: "Raja", type: "Farrier", due: isoIn(-20), notes: "Trim — completed on schedule", done: true, icon: "farrier" },
];

// ---- feed & nutrition (per-horse daily ration) ----
export interface FeedItem {
  id: string;
  horse: string;
  feed: string;
  amount: string;
  slot: "Morning" | "Midday" | "Evening" | "Free-choice";
  kind: "forage" | "concentrate" | "supplement";
}

export const feedItems: FeedItem[] = [
  { id: "f1", horse: "Zarina", feed: "Oaten hay", amount: "3 kg", slot: "Morning", kind: "forage" },
  { id: "f2", horse: "Zarina", feed: "Performance mix", amount: "1.5 kg", slot: "Morning", kind: "concentrate" },
  { id: "f3", horse: "Zarina", feed: "Electrolytes", amount: "30 g", slot: "Morning", kind: "supplement" },
  { id: "f4", horse: "Zarina", feed: "Lucerne", amount: "2 kg", slot: "Midday", kind: "forage" },
  { id: "f5", horse: "Zarina", feed: "Performance mix", amount: "1.5 kg", slot: "Evening", kind: "concentrate" },
  { id: "f6", horse: "Zarina", feed: "Joint supplement", amount: "25 g", slot: "Evening", kind: "supplement" },
  { id: "f7", horse: "Zarina", feed: "Meadow hay", amount: "ad lib", slot: "Free-choice", kind: "forage" },
  { id: "f8", horse: "Shaan", feed: "Oaten hay", amount: "3 kg", slot: "Morning", kind: "forage" },
  { id: "f9", horse: "Shaan", feed: "Cool mix", amount: "1 kg", slot: "Morning", kind: "concentrate" },
  { id: "f10", horse: "Shaan", feed: "Cool mix", amount: "1 kg", slot: "Evening", kind: "concentrate" },
  { id: "f11", horse: "Shaan", feed: "Biotin", amount: "20 g", slot: "Evening", kind: "supplement" },
  { id: "f12", horse: "Noor", feed: "Lucerne", amount: "3 kg", slot: "Morning", kind: "forage" },
  { id: "f13", horse: "Noor", feed: "Broodmare mix", amount: "2 kg", slot: "Morning", kind: "concentrate" },
  { id: "f14", horse: "Noor", feed: "Calcium supplement", amount: "40 g", slot: "Morning", kind: "supplement" },
  { id: "f15", horse: "Noor", feed: "Broodmare mix", amount: "2 kg", slot: "Evening", kind: "concentrate" },
];

// ---- billing (invoices with GST + UPI) ----
export interface Invoice {
  id: string;
  number: string;
  owner: string;
  horse: string;
  desc: string;
  amount: number; // subtotal, ex-GST (₹)
  gst: number; // percent
  issued: string; // ISO yyyy-mm-dd
  dueDate: string; // ISO yyyy-mm-dd
  paid: boolean;
  method?: "UPI" | "Bank" | "Cash";
}

export const invoices: Invoice[] = [
  { id: "i1", number: "INV-1001", owner: "Bharat Sports Venture", horse: "Zarina", desc: "Monthly livery & training", amount: 45000, gst: 18, issued: isoIn(-10), dueDate: isoIn(5), paid: false },
  { id: "i2", number: "INV-1002", owner: "R. Singh", horse: "Noor", desc: "Livery + pre-foaling care", amount: 38000, gst: 18, issued: isoIn(-25), dueDate: isoIn(-10), paid: true, method: "UPI" },
  { id: "i3", number: "INV-1003", owner: "Equestrian Club", horse: "Raja", desc: "Monthly livery", amount: 22000, gst: 18, issued: isoIn(-40), dueDate: isoIn(-10), paid: false },
  { id: "i4", number: "INV-1004", owner: "Bharat Sports Venture", horse: "Shaan", desc: "Farrier + vet recharge", amount: 8500, gst: 18, issued: isoIn(-3), dueDate: isoIn(12), paid: false },
  { id: "i5", number: "INV-1005", owner: "Bharat Sports Venture", horse: "—", desc: "Stud fee — Sultan × Laila", amount: 60000, gst: 18, issued: isoIn(-50), dueDate: isoIn(-20), paid: true, method: "Bank" },
];

// stat-card sparkline series
export const series = {
  monitored: [5, 6, 6, 6, 7, 7, 7],
  rest: [6.2, 6.8, 7.1, 6.5, 7.4, 7.0, 6.9],
  water: [6, 7, 5, 8, 7, 9, 7],
  outside: [3.1, 2.8, 3.4, 4.0, 3.6, 4.1, 3.9],
  alerts: [3, 1, 2, 4, 1, 2, 5],
};

// Lay horses out on the yard map in an adaptive grid (% positions),
// so newly added horses are placed automatically.
export interface YardSlot {
  id: string;
  name: string;
  stall: string;
  status: Status;
  x: number;
  y: number;
}

export function yardSlots(
  list: { id: string; name: string; stall: string; status: Status }[]
): YardSlot[] {
  const cols = 3;
  const xs = [6, 36, 66];
  const rows = Math.max(1, Math.ceil(list.length / cols));
  const yStep = rows > 1 ? Math.min(32, 78 / (rows - 1)) : 0;
  return list.map((h, i) => ({
    id: h.id,
    name: h.name,
    stall: h.stall,
    status: h.status,
    x: xs[i % cols],
    y: rows > 1 ? Math.round(6 + Math.floor(i / cols) * yStep) : 40,
  }));
}

// featured highlight clip shown on the dashboard
export const highlight = {
  horse: "Raja",
  title: "Raja in the paddock",
  caption: "A clip of Raja having a roll and a shake in turnout — saved yesterday at 17:22.",
  time: "Yesterday · 17:22",
};
