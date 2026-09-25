"use client";

// Hardware — the single place the stable's devices are registered, connected,
// tested and calibrated.
//
//   Edge boxes      the on-site computer that polls cameras and sensors. It
//                   fetches its device list from here, so what is on this page
//                   is what gets measured.
//   Thermal cameras polled by an edge box; aimed with the ROI calibrator.
//   Modbus sensors  any Modbus/TCP device, described by a register map.
//   Push devices    gateways that send their own readings with a token.
//
// Everything that touches a device goes through the site server (the browser
// cannot reach the barn LAN, and never holds a camera password or a token after
// it is first shown). The optics planner is pure datasheet maths and works
// anywhere, including the demo.
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import {
  Camera as CameraIcon, Plus, PlugZap, Crosshair, Pencil, Trash2, CheckCircle2, XCircle,
  Loader2, Wifi, Info, Ruler, ScanLine, Server, Gauge, Send, KeyRound, History, Copy,
  AlertTriangle, ShieldCheck, Power,
} from "lucide-react";
import * as api from "../data/api";
import type {
  CameraProbe, CameraTemps, Device, DeviceEvent, DeviceKind, DeviceState, EdgeBox, ModbusRegister,
  ModbusSensor, PushDevice, SensorProbe, ThermalCamera,
} from "../data/api";
import { SC_IT6420_HB_V2 as SPEC, assessOptics, lensesFor, variants } from "../../server/hardware-spec.mjs";
import { METRICS } from "../../server/contract.mjs";
import { Modal, Sparkline } from "../components/ui";
import { useStable, useToast } from "../store";
import { useAuth } from "../auth";

type Rois = Pick<NonNullable<ThermalCamera["rois"]>, "eye" | "nostril">;

// Where the edge agent points ROIs on an uncalibrated camera — frame centre.
const DEFAULT_ROIS: Rois = { eye: { x: 5000, y: 5000 }, nostril: { x0: 4200, y0: 5200, x1: 5800, y1: 6400 } };
const METRIC_KEYS = Object.keys(METRICS) as (keyof typeof METRICS)[];
const REG_TYPES: ModbusRegister["type"][] = ["uint16", "int16", "uint32", "int32", "float32"];
const REFRESH_MS = 15000;

const KIND: Record<DeviceKind, { title: string; one: string; icon: ReactNode; blurb: string }> = {
  edge_box: {
    title: "Edge boxes", one: "edge box", icon: <Server size={17} />,
    blurb: "The on-site computer that polls the cameras and sensors below. Add one first — it gets a token, and the edge agent uses it to fetch its device list from this page.",
  },
  thermal_camera: {
    title: `Thermal cameras · ${SPEC.model}`, one: "camera", icon: <CameraIcon size={17} />,
    blurb: "Each stall camera, assigned to the edge box that polls it. Test the connection, then aim its ROIs at the eye and nostril.",
  },
  modbus_sensor: {
    title: "Modbus sensors", one: "Modbus sensor", icon: <Gauge size={17} />,
    blurb: "Water meters, load cells, feeders — any Modbus/TCP device. Describe its registers from the datasheet; no code per model.",
  },
  push_device: {
    title: "Push devices", one: "push device", icon: <Send size={17} />,
    blurb: "A device or vendor gateway that sends its own readings to this server with a token, limited to the metrics you allow.",
  },
};
const KIND_ORDER: DeviceKind[] = ["edge_box", "thermal_camera", "modbus_sensor", "push_device"];

const STATE: Record<DeviceState, { cls: string; label: string }> = {
  online: { cls: "ok", label: "Online" },
  offline: { cls: "alert", label: "Offline" },
  never: { cls: "muted", label: "Never connected" },
  disabled: { cls: "muted", label: "Disabled" },
  unassigned: { cls: "warn", label: "Unassigned" },
  "edge-offline": { cls: "alert", label: "Edge box offline" },
  "needs-calibration": { cls: "warn", label: "Needs calibration" },
  error: { cls: "alert", label: "Error" },
  stale: { cls: "alert", label: "Not reporting" },
  waiting: { cls: "muted", label: "Waiting" },
  silent: { cls: "alert", label: "Silent" },
};

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "never");
const ago = (iso?: string | null) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : when(iso);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isCameraProbe = (p: CameraProbe | SensorProbe): p is CameraProbe => "steps" in p;

// --------------------------------------------------------------------------- //
export default function Hardware() {
  const { user, authRequired } = useAuth();
  const { horses } = useStable();
  const notify = useToast();
  const role = user?.role ?? (authRequired ? null : "admin");
  const isAdmin = role === "admin";

  const [devices, setDevices] = useState<Device[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<{ kind: DeviceKind; dev?: Device } | null>(null);
  const [calibrating, setCalibrating] = useState<ThermalCamera | null>(null);
  const [token, setToken] = useState<{ dev: Device; token: string } | null>(null);
  const [history, setHistory] = useState<Device | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openProbe, setOpenProbe] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (api.demoMode) {
      setDevices([]);
      return;
    }
    const r = await api.listDevices();
    if (r.ok) {
      setDevices(r.data);
      setLoadError("");
    } else setLoadError(r.error);
  }, []);

  // Status is live (edge heartbeats, readings arriving), so keep it fresh
  // while the page is open and visible.
  useEffect(() => {
    load();
    if (api.demoMode) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (role === "owner") {
    return (
      <div className="card" style={{ padding: 32 }}>
        <h3>Hardware is managed by the yard administrator</h3>
        <p className="muted" style={{ marginTop: 8 }}>
          The Owner Portal shows which cameras watch your horses and whether they are working.
        </p>
      </div>
    );
  }

  const all = devices ?? [];
  const edges = all.filter((d): d is EdgeBox => d.kind === "edge_box");
  const cams = all.filter((d): d is ThermalCamera => d.kind === "thermal_camera");
  const measuring = all.filter((d) => d.kind !== "edge_box");
  const attention = all.filter((d) => ["error", "offline", "edge-offline", "stale", "silent", "needs-calibration", "unassigned"].includes(d.status.state));
  const stalls = Array.from(new Set(horses.map((h) => h.stall).filter((s) => s && s !== "—"))).sort();

  const probe = async (dev: Device, acceptIdentity = false) => {
    setBusy(dev.id);
    const r = await api.probeDevice(dev.id, acceptIdentity);
    setBusy(null);
    if (!r.ok) return notify(`Test failed: ${r.error}`);
    notify(r.data.ok ? `${dev.name}: answered` : `${dev.name}: test failed — see the steps`);
    setOpenProbe(dev.id);
    load();
  };

  const remove = async (dev: Device) => {
    const note = dev.kind === "thermal_camera" ? " Its ROIs stay on the camera itself." : "";
    if (!confirm(`Remove ${dev.name}?${note}`)) return;
    let r = await api.deleteDevice(dev.id);
    if (!r.ok && r.status === 409) {
      if (!confirm(`${r.error}. Remove the edge box anyway? Those devices will be unassigned and stop being polled.`)) return;
      r = await api.deleteDevice(dev.id, true);
    }
    if (!r.ok) return notify(`Could not remove: ${r.error}`);
    notify(`${dev.name} removed`);
    load();
  };

  const toggle = async (dev: Device) => {
    const r = await api.updateDevice(dev.id, { enabled: !dev.enabled });
    if (!r.ok) return notify(`Could not update: ${r.error}`);
    notify(`${dev.name} ${dev.enabled ? "disabled" : "enabled"}`);
    load();
  };

  const rotate = async (dev: Device) => {
    if (dev.hasToken && !confirm(`Issue a new token for ${dev.name}? The current one stops working immediately — the device must be updated with the new one.`)) return;
    const r = await api.rotateToken(dev.id);
    if (!r.ok) return notify(`Could not issue a token: ${r.error}`);
    setToken({ dev, token: r.data.token });
    load();
  };

  const actions = (dev: Device): CardActions => ({
    isAdmin,
    busy: busy === dev.id,
    showProbe: openProbe === dev.id,
    onToggleProbe: () => setOpenProbe(openProbe === dev.id ? null : dev.id),
    onProbe: (accept?: boolean) => probe(dev, accept),
    onEdit: () => setEditing({ kind: dev.kind, dev }),
    onRemove: () => remove(dev),
    onToggle: () => toggle(dev),
    onToken: () => rotate(dev),
    onHistory: () => setHistory(dev),
    onCalibrate: dev.kind === "thermal_camera" ? () => setCalibrating(dev) : undefined,
  });

  const canEdit = isAdmin && !api.demoMode;

  return (
    <>
      {api.demoMode && (
        <div className="row watch" style={{ marginBottom: 18 }}>
          <Info size={18} style={{ flexShrink: 0 }} />
          <span>
            This is the public demo, which cannot reach barn hardware. Devices are registered, tested and calibrated
            on the site server (<code>npm start</code> on the stable&apos;s network). The optics planner below works
            here.
          </span>
        </div>
      )}

      <div className="grid cols-4" style={{ marginBottom: 22 }}>
        <Stat icon={<Server size={20} />} label="Edge boxes online"
          value={devices ? `${edges.filter((e) => e.status.state === "online").length}/${edges.length}` : "—"} />
        <Stat icon={<Wifi size={20} />} label="Devices reporting"
          value={devices ? `${measuring.filter((d) => d.status.state === "online").length}/${measuring.length}` : "—"} />
        <Stat icon={<Crosshair size={20} />} label="Cameras calibrated"
          value={devices ? `${cams.filter((c) => c.rois && !c.rois.stale).length}/${cams.length}` : "—"} />
        <Stat icon={<AlertTriangle size={20} />} label="Need attention" value={devices ? String(attention.length) : "—"} />
      </div>

      {loadError && (
        <div className="row urgent" style={{ marginBottom: 14 }}>
          <XCircle size={18} /> <span>Could not load devices: {loadError}</span>
        </div>
      )}

      {devices && !api.demoMode && <SetupGuide devices={all} />}

      {KIND_ORDER.map((kind) => {
        const rows = all.filter((d) => d.kind === kind);
        return (
          <section key={kind} style={{ marginBottom: 26 }}>
            <div className="flex between center wrap" style={{ marginBottom: 6, gap: 12 }}>
              <h3 className="section-title flex center gap-sm" style={{ margin: 0 }}>
                {KIND[kind].icon} {KIND[kind].title}
              </h3>
              {canEdit && (
                <button className="btn-primary" onClick={() => setEditing({ kind })}>
                  <Plus size={16} /> Add {KIND[kind].one}
                </button>
              )}
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 12, maxWidth: 760 }}>{KIND[kind].blurb}</p>
            {devices && rows.length === 0 && !api.demoMode && (
              <div className="card muted" style={{ padding: 18, fontSize: 13 }}>No {KIND[kind].one}s registered.</div>
            )}
            <div className="grid cols-2" style={{ alignItems: "start" }}>
              {rows.map((dev) => (
                <DeviceCard key={dev.id} dev={dev} all={all} a={actions(dev)} />
              ))}
            </div>
          </section>
        );
      })}

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <PlannerCard />
        <DatasheetCard />
      </div>

      {editing && (
        <DeviceForm
          kind={editing.kind}
          dev={editing.dev}
          edges={edges}
          stalls={stalls}
          onClose={() => setEditing(null)}
          onSaved={(dev, tok) => {
            setEditing(null);
            notify(editing.dev ? `${dev.name} updated` : `${dev.name} added`);
            if (tok) setToken({ dev, token: tok });
            load();
          }}
        />
      )}
      {token && <TokenModal dev={token.dev} token={token.token} onClose={() => setToken(null)} />}
      {history && <HistoryModal dev={history} onClose={() => setHistory(null)} />}
      {calibrating && (
        <CalibrateModal
          cam={calibrating}
          onClose={() => {
            setCalibrating(null);
            load();
          }}
        />
      )}
    </>
  );
}

// --------------------------------------------------------------------------- //
function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="card stat">
      <div className="top">
        <div className="chip">{icon}</div>
      </div>
      <div className="value" style={{ fontSize: 32 }}>
        {value}
      </div>
      <div className="foot">
        <span className="label">{label}</span>
      </div>
    </div>
  );
}

/** The order things have to happen in, with what is already done ticked off. */
function SetupGuide({ devices }: { devices: Device[] }) {
  const edges = devices.filter((d) => d.kind === "edge_box");
  const polled = devices.filter((d) => d.kind === "thermal_camera" || d.kind === "modbus_sensor") as (ThermalCamera | ModbusSensor)[];
  const cams = devices.filter((d): d is ThermalCamera => d.kind === "thermal_camera");
  const steps: [boolean, string][] = [
    [edges.length > 0, "Add an edge box and copy its token"],
    [edges.some((e) => e.lastSeen), "Run the edge agent on it with that token"],
    [polled.length > 0 && polled.every((d) => d.edgeId), "Add cameras / sensors and assign each to an edge box"],
    [polled.length > 0 && polled.every((d) => d.lastProbe?.ok), "Test each connection from here"],
    [cams.length > 0 && cams.every((c) => c.rois && !c.rois.stale), "Calibrate each camera's ROIs"],
  ];
  if (steps.every(([done]) => done)) return null;
  return (
    <div className="card" style={{ marginBottom: 22 }}>
      <div className="card-head">
        <h3>Connecting hardware</h3>
        <span className="pill muted">{steps.filter(([d]) => d).length}/{steps.length}</span>
      </div>
      <ol className="hw-guide">
        {steps.map(([done, text], i) => (
          <li key={i} className={done ? "done" : ""}>
            {done ? <CheckCircle2 size={15} /> : <span>{i + 1}</span>}
            {text}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StatePill({ dev }: { dev: Device }) {
  const s = STATE[dev.status.state] ?? { cls: "muted", label: dev.status.state };
  return <span className={`pill ${s.cls}`} title={dev.status.detail}>{s.label}</span>;
}

type CardActions = {
  isAdmin: boolean; busy: boolean; showProbe: boolean;
  onToggleProbe: () => void; onProbe: (acceptIdentity?: boolean) => void; onEdit: () => void;
  onRemove: () => void; onToggle: () => void; onToken: () => void; onHistory: () => void;
  onCalibrate?: () => void;
};

function DeviceCard({ dev, all, a }: { dev: Device; all: Device[]; a: CardActions }) {
  const edgeName = (id: string | null) => (id ? all.find((d) => d.id === id)?.name ?? "removed" : "none");
  const bad = ["error", "offline", "edge-offline", "stale", "silent", "unassigned", "needs-calibration"].includes(dev.status.state);
  const canEdit = a.isAdmin && !api.demoMode;

  return (
    <div className="card" style={dev.enabled ? undefined : { opacity: 0.7 }}>
      <div className="card-head">
        <div>
          <h3>{dev.name}</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {dev.kind === "edge_box" ? dev.location || "on site" : `Stall ${dev.stall || "—"}`}
          </span>
        </div>
        <StatePill dev={dev} />
      </div>

      <div className={`row ${bad ? "watch" : "calm"}`} style={{ margin: "0 0 12px", padding: "8px 12px" }}>
        <span style={{ fontSize: 12.5 }}>{dev.status.detail}</span>
      </div>

      <div className="hw-facts">
        {dev.kind === "edge_box" && (
          <>
            <div><span>Agent</span><b>{dev.agent ? `v${dev.agent.version} on ${dev.agent.host || "?"} · up ${Math.round(dev.agent.uptimeS / 3600)} h` : "not yet connected"}</b></div>
            <div><span>Last check-in</span><b>{ago(dev.lastSeen)}</b></div>
            <div><span>Polls</span><b>{all.filter((d) => "edgeId" in d && d.edgeId === dev.id).map((d) => d.name).join(", ") || "nothing yet — assign devices to it"}</b></div>
            <div><span>Token</span><b>{dev.hasToken ? `issued · ends …${dev.tokenHint ?? "?"}` : "none"}</b></div>
          </>
        )}
        {dev.kind === "thermal_camera" && <CameraFacts cam={dev} edge={edgeName(dev.edgeId)} />}
        {dev.kind === "modbus_sensor" && (
          <>
            <div><span>Edge box</span><b>{edgeName(dev.edgeId)}</b></div>
            <div><span>Address</span><b>{dev.host}:{dev.port} · unit {dev.unitId} · FC{dev.function} · {dev.addressing}</b></div>
            <div><span>Registers</span><b>{dev.registers.map((r) => `${r.name} @${r.address} → ${METRICS[r.metric as keyof typeof METRICS]?.label ?? r.metric}${r.mode === "counter" ? " (counter)" : ""}`).join(" · ")}</b></div>
            <div><span>Last reading</span><b>{ago(dev.lastSeen)} · every {dev.pollSeconds} s</b></div>
          </>
        )}
        {dev.kind === "push_device" && (
          <>
            <div><span>May send</span><b>{dev.metrics.map((m) => METRICS[m as keyof typeof METRICS]?.label ?? m).join(", ")}</b></div>
            <div><span>Last reading</span><b>{ago(dev.lastSeen)}</b></div>
            <div><span>Token</span><b>{dev.hasToken ? `issued · ends …${dev.tokenHint ?? "?"}` : "none"}</b></div>
          </>
        )}
        {dev.notes && <div><span>Notes</span><b>{dev.notes}</b></div>}
      </div>

      {dev.kind === "thermal_camera" && <RoiBanner cam={dev} />}

      {canEdit && (
        <div className="flex gap-sm wrap" style={{ marginTop: 14 }}>
          {(dev.kind === "thermal_camera" || dev.kind === "modbus_sensor") && (
            <button className="btn-ghost accent" onClick={() => a.onProbe()} disabled={a.busy}>
              {a.busy ? <Loader2 size={15} className="spin" /> : <PlugZap size={15} />}
              {a.busy ? "Testing…" : dev.kind === "thermal_camera" ? "Test connection" : "Test read"}
            </button>
          )}
          {a.onCalibrate && (
            <button className="btn-ghost" onClick={a.onCalibrate}>
              <Crosshair size={15} /> Calibrate ROIs
            </button>
          )}
          {(dev.kind === "edge_box" || dev.kind === "push_device") && (
            <button className="btn-ghost" onClick={a.onToken}>
              <KeyRound size={15} /> {dev.hasToken ? "New token" : "Issue token"}
            </button>
          )}
          <button className="btn-ghost" onClick={a.onEdit}>
            <Pencil size={15} /> Edit
          </button>
          <button className="btn-ghost" onClick={a.onToggle} title={dev.enabled ? "Disable — stop polling / accepting it" : "Enable"}>
            <Power size={15} /> {dev.enabled ? "Disable" : "Enable"}
          </button>
          <button className="btn-ghost" onClick={a.onHistory} title="Change history">
            <History size={15} />
          </button>
          <button className="btn-ghost" onClick={a.onRemove} title={`Remove ${KIND[dev.kind].one}`}>
            <Trash2 size={15} />
          </button>
        </div>
      )}

      {"lastProbe" in dev && dev.lastProbe && (
        <div style={{ marginTop: 12 }}>
          <button className="sub" style={{ color: "var(--accent)", fontWeight: 600 }} onClick={a.onToggleProbe}>
            {a.showProbe ? "Hide" : "Show"} last test · {when(dev.lastProbe.at)}
          </button>
          {a.showProbe && <ProbeResult probe={dev.lastProbe} canAccept={canEdit} onAccept={() => a.onProbe(true)} />}
        </div>
      )}
    </div>
  );
}

function CameraFacts({ cam, edge }: { cam: ThermalCamera; edge: string }) {
  const v = SPEC.thermal[cam.variant];
  const optics = assessOptics(cam.variant, cam.thermalLens, cam.distanceM);
  return (
    <>
      <div><span>Edge box</span><b>{edge}</b></div>
      <div>
        <span>Network</span>
        <b>{cam.https ? "https" : "http"}://{cam.host}:{cam.httpPort} · RTSP {cam.rtspPort} · Modbus {cam.modbusPort}</b>
      </div>
      <div>
        <span>Optics</span>
        <b>{cam.variant} ({v?.resolution.join("×")}) · {cam.thermalLens} mm thermal · {cam.distanceM} m · ε {cam.emissivity}</b>
      </div>
      <div>
        <span>Identity</span>
        <b>
          {cam.identity
            ? [cam.identity.model, `S/N ${cam.identity.serial}`].filter(Boolean).join(" · ") + " — pinned; a different unit at this address is refused"
            : "not yet pinned — the first successful test records the serial number"}
        </b>
      </div>
      {optics && (
        <div>
          <span>Pixels on target</span>
          <b>
            nostril {optics.targets.nostril.px.toFixed(0)} px <Verdict v={optics.targets.nostril.verdict} /> · eye{" "}
            {optics.targets.eye.px.toFixed(0)} px <Verdict v={optics.targets.eye.verdict} />
          </b>
        </div>
      )}
    </>
  );
}

function RoiBanner({ cam }: { cam: ThermalCamera }) {
  const ok = cam.rois && !cam.rois.stale;
  return (
    <div className={`row ${ok ? "calm" : "watch"}`} style={{ margin: "14px 0 0", padding: "10px 14px" }}>
      <Crosshair size={16} style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 12.5 }}>
        {!cam.rois
          ? "Not calibrated — readings are shown greyed and never raise alerts until the ROIs are aimed at the horse."
          : cam.rois.stale
            ? "Re-calibrate: the camera was moved or its optics changed since the ROIs were aimed. Readings are held back from alerts until then."
            : `ROIs aimed ${when(cam.rois.pushedAt)}${cam.rois.verified === true ? " — read back from the camera and confirmed" : cam.rois.verified === null ? " — the camera accepted them but does not report coordinates back" : ""}.`}
      </span>
    </div>
  );
}

function ProbeResult({ probe, canAccept, onAccept }: { probe: CameraProbe | SensorProbe; canAccept: boolean; onAccept: () => void }) {
  if (!isCameraProbe(probe)) {
    return (
      <ul className="hw-steps">
        {probe.error && (
          <li className="bad">
            <XCircle size={15} />
            <div><b>Address</b><span>{probe.error}</span></div>
            <em />
          </li>
        )}
        {probe.values.map((v) => (
          <li key={v.name} className={v.ok ? "ok" : "bad"}>
            {v.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            <div>
              <b>{v.name}</b>
              <span>
                {v.ok
                  ? `${v.value?.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${v.unit ?? ""} (raw ${v.raw}) → ${METRICS[v.metric as keyof typeof METRICS]?.label ?? v.metric}`
                  : v.error}
              </span>
            </div>
            <em />
          </li>
        ))}
      </ul>
    );
  }
  const mismatch = probe.steps.find((s) => s.code === "IDENTITY_MISMATCH");
  return (
    <>
      <ul className="hw-steps">
        {probe.steps.map((s) => (
          <li key={s.name} className={s.ok ? "ok" : "bad"}>
            {s.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            <div>
              <b>{s.name}</b>
              <span>{s.detail}</span>
            </div>
            <em>{s.ms} ms</em>
          </li>
        ))}
      </ul>
      {mismatch && canAccept && (
        <div className="row watch" style={{ marginTop: 10, padding: "10px 14px", alignItems: "flex-start" }}>
          <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 12.5 }}>
            A different camera answered at this address. If you replaced the unit on purpose, accept it — its serial
            number becomes the registered one and the ROIs must be aimed again. If not, check the IP address: another
            stall&apos;s camera would put its readings on the wrong horse.
            <div style={{ marginTop: 8 }}>
              <button className="btn-ghost accent" onClick={onAccept}>
                This is the replacement camera — accept it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Verdict({ v }: { v: "good" | "marginal" | "insufficient" }) {
  const cls = v === "good" ? "ok" : v === "marginal" ? "warn" : "alert";
  return <span className={`pill ${cls}`} style={{ fontSize: 10.5, padding: "1px 7px" }}>{v}</span>;
}

// --------------------------------------------------------------------------- //
// Tokens and history
// --------------------------------------------------------------------------- //
function CopyBlock({ text }: { text: string }) {
  const notify = useToast();
  return (
    <div className="hw-code">
      <code>{text}</code>
      <button
        className="btn-ghost"
        title="Copy"
        onClick={() => navigator.clipboard?.writeText(text).then(() => notify("Copied"), () => notify("Copy failed — select the text instead"))}
      >
        <Copy size={14} />
      </button>
    </div>
  );
}

function TokenModal({ dev, token, onClose }: { dev: Device; token: string; onClose: () => void }) {
  const origin = api.serverOrigin();
  const edge = dev.kind === "edge_box";
  const example = dev.kind === "push_device" ? dev.metrics[0] : "water_ml";
  return (
    <Modal open wide onClose={onClose} title={`Token for ${dev.name}`}
      footer={<button className="btn-primary" onClick={onClose}>I have saved it</button>}>
      <div className="row urgent" style={{ marginBottom: 14, padding: "10px 14px" }}>
        <KeyRound size={16} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 12.5 }}>
          Shown once. The server keeps only a fingerprint of it — if it is lost, issue a new one.
        </span>
      </div>
      <p className="hw-legend" style={{ marginTop: 0 }}>Token</p>
      <CopyBlock text={token} />
      {edge ? (
        <>
          <p className="hw-legend">Run the edge agent on the edge box</p>
          <CopyBlock text={`python3 edge/edge_agent.py --server ${origin} --token ${token}`} />
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            The agent fetches its cameras and sensors from this page every minute, so adding, re-aiming or removing a
            device here takes effect without touching the box. Readings are buffered on disk while the server is
            unreachable. Run it as a service (systemd) so it starts on boot; the address above must be reachable from
            the edge box.
          </p>
        </>
      ) : (
        <>
          <p className="hw-legend">Send readings</p>
          <CopyBlock
            text={`curl -X POST ${origin}/ingest/readings \\\n  -H "Authorization: Bearer ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"readings":[{"metric":"${example}","value":1,"ts":"${new Date().toISOString()}"}]}'`}
          />
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Readings are attributed to stall {dev.kind === "push_device" ? dev.stall : ""} by this server; the device
            cannot choose a stall. Metrics outside its allowed list are rejected and reported in the response.
          </p>
        </>
      )}
    </Modal>
  );
}

function HistoryModal({ dev, onClose }: { dev: Device; onClose: () => void }) {
  const [events, setEvents] = useState<DeviceEvent[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.deviceEvents(dev.id).then((r) => (r.ok ? setEvents(r.data) : setError(r.error)));
  }, [dev.id]);
  return (
    <Modal open onClose={onClose} title={`History · ${dev.name}`}>
      {error && <p className="muted">Could not load: {error}</p>}
      {!events && !error && <Loader2 className="spin" size={18} />}
      {events && events.length === 0 && <p className="muted">No changes recorded.</p>}
      {events && events.length > 0 && (
        <ul className="hw-steps">
          {events.map((e) => (
            <li key={e.id} className="ok">
              <History size={15} />
              <div>
                <b>{e.action}</b>
                <span>{e.detail || "—"} · by {e.actor}</span>
              </div>
              <em>{when(e.at)}</em>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// --------------------------------------------------------------------------- //
// Optics — pure datasheet maths
// --------------------------------------------------------------------------- //
function OpticsPanel({ variant, lens, distanceM }: { variant: string; lens: string; distanceM: number }) {
  const a = assessOptics(variant, lens, distanceM);
  if (!a) return <p className="muted">Pick a variant, lens and distance.</p>;
  const f = a.footprint;
  return (
    <div className="hw-optics">
      <div className="hw-optics-row">
        <Ruler size={15} />
        <span>
          At {distanceM} m the thermal image covers <b>{f.widthM.toFixed(2)} × {f.heightM.toFixed(2)} m</b> ({f.fovH}° ×{" "}
          {f.fovV}°) — {f.pxPerCm.toFixed(2)} px/cm.
        </span>
      </div>
      {(["nostril", "eye"] as const).map((k) => {
        const t = a.targets[k];
        return (
          <div key={k} className="hw-optics-row">
            <ScanLine size={15} />
            <span>
              {t.label}: <b>{t.px.toFixed(1)} px</b> across {t.cm} cm <Verdict v={t.verdict} />
              <br />
              <small className="muted">
                needs ≥{t.need} px · stays viable up to {t.maxDistanceM.toFixed(1)} m
              </small>
            </span>
          </div>
        );
      })}
      <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
        FOV and resolution from the datasheet (Rev {SPEC.datasheetRev}); pixel thresholds are an engineering rule of
        thumb. Absolute accuracy is {SPEC.measurement.accuracy} — read temperature as a trend against the horse&apos;s own
        baseline. A wider frame keeps a moving horse in view; a tighter one gives more pixels per nostril.
      </p>
    </div>
  );
}

function PlannerCard() {
  const [variant, setVariant] = useState("640");
  const [lens, setLens] = useState("13");
  const [dist, setDist] = useState(3.5);
  return (
    <div className="card">
      <div className="card-head">
        <h3>Optics planner</h3>
        <span className="pill muted">datasheet</span>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        Will a given variant and lens resolve the nostril and eye from where the camera is mounted?
      </p>
      <div className="grid cols-3" style={{ gap: 10 }}>
        <div className="field">
          <label>Variant</label>
          <select
            value={variant}
            onChange={(e) => {
              setVariant(e.target.value);
              setLens(SPEC.thermal[e.target.value as keyof typeof SPEC.thermal].defaultLens);
            }}
          >
            {variants().map((v) => (
              <option key={v} value={v}>
                {v} ({SPEC.thermal[v].resolution.join("×")})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Thermal lens</label>
          <select value={lens} onChange={(e) => setLens(e.target.value)}>
            {lensesFor(variant).map((l) => (
              <option key={l} value={l}>
                {l} mm
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Distance (m)</label>
          <input type="number" min={0.5} max={30} step={0.1} value={dist} onChange={(e) => setDist(Number(e.target.value))} />
        </div>
      </div>
      <OpticsPanel variant={variant} lens={lens} distanceM={dist} />
    </div>
  );
}

function DatasheetCard() {
  const rows: [string, string][] = [
    ["Thermal sensor", `${SPEC.sensor}, ${SPEC.spectralUm.join("–")} µm, ${SPEC.focus.toLowerCase()} focus`],
    ["Thermal variants", variants().map((v) => `${v}: ${SPEC.thermal[v].resolution.join("×")}, lens ${Object.keys(SPEC.thermal[v].lenses).join("/")} mm`).join(" · ")],
    ["Visible", `${SPEC.visible.sensor} ${SPEC.visible.resolution.join("×")}, lens ${SPEC.visible.lenses.join("/")} mm, IR ${SPEC.visible.irRangeM} m`],
    ["Measurement", `${SPEC.measurement.rangesC.map(([a, b]) => `${a}…${b} °C`).join(" / ")} · ${SPEC.measurement.accuracy}`],
    ["ROIs per camera", `${SPEC.measurement.maxPoints} points, ${SPEC.measurement.maxAreas} areas, ${SPEC.measurement.maxLines} lines — we use 1 point (eye) + 1 area (nostril)`],
    ["Emissivity", `${SPEC.measurement.emissivity.join("–")} adjustable (0.98 for equine skin)`],
    ["Temperature output", SPEC.network.temperatureOutput.join(", ")],
    ["Network", `${SPEC.network.ethernet} · ${SPEC.network.compatibility.join(", ")} · ${SPEC.network.protocols.join(", ")}`],
    ["Power", `${SPEC.power.supply}, ≤${SPEC.power.maxW} W`],
    ["Environment", `${SPEC.environment.workingC.join("…")} °C, ${SPEC.environment.humidity}, ${SPEC.environment.protection}`],
    ["Video", SPEC.video],
  ];
  return (
    <div className="card">
      <div className="card-head">
        <h3>{SPEC.model}</h3>
        <span className="pill muted">Rev {SPEC.datasheetRev}</span>
      </div>
      <div className="hw-facts">
        {rows.map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
        Working range tops out at {SPEC.environment.workingC[1]} °C — Indian barns reach that in summer, so mount out of
        direct sun.
      </p>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Add / edit — one form, fields by kind
// --------------------------------------------------------------------------- //
type Form = Record<string, unknown> & { kind: DeviceKind; registers?: ModbusRegister[]; metrics?: string[] };

const blankRegister = (): ModbusRegister => ({
  name: "", address: 0, type: "uint16", wordOrder: "high-first", scale: 1, offset: 0, metric: "water_ml", unit: "", mode: "gauge",
});

function initialForm(kind: DeviceKind, dev: Device | undefined, stall: string, edgeId: string | null): Form {
  if (dev) {
    const { status, health, lastSeen, lastProbe, rois, identity, agent, hasPassword, hasToken, tokenHint, createdAt, updatedAt, id, ...rest } =
      dev as unknown as Record<string, unknown>;
    void status; void health; void lastSeen; void lastProbe; void rois; void identity; void agent;
    void hasPassword; void hasToken; void tokenHint; void createdAt; void updatedAt; void id;
    return { ...rest, kind, password: "" } as Form;
  }
  const common = { kind, name: "", enabled: true, notes: "" };
  switch (kind) {
    case "edge_box": return { ...common, location: "" };
    case "thermal_camera": return {
      ...common, stall, edgeId, host: "", httpPort: 80, https: false, rtspPort: 554, modbusPort: 502,
      username: "admin", password: "", variant: "640", thermalLens: "13", visibleLens: "4", distanceM: 3.5, emissivity: 0.98,
    };
    case "modbus_sensor": return {
      ...common, stall, edgeId, host: "", port: 502, unitId: 1, function: 3, addressing: "zero-based", pollSeconds: 10,
      registers: [blankRegister()],
    };
    case "push_device": return { ...common, stall, metrics: [] };
  }
}

function DeviceForm({ kind, dev, edges, stalls, onClose, onSaved }: {
  kind: DeviceKind; dev?: Device; edges: EdgeBox[]; stalls: string[];
  onClose: () => void; onSaved: (d: Device, token: string | null) => void;
}) {
  const [f, setF] = useState<Form>(() => initialForm(kind, dev, stalls[0] ?? "", edges.length === 1 ? edges[0].id : null));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const s = (k: string) => String(f[k] ?? "");
  const n = (k: string) => Number(f[k] ?? 0);

  const save = async () => {
    setBusy(true);
    setErrors([]);
    const payload: Form = { ...f };
    if (dev && !payload.password) delete payload.password;   // blank = keep the stored one
    if (kind !== "thermal_camera") delete payload.password;
    if (dev) {
      const r = await api.updateDevice(dev.id, payload);
      setBusy(false);
      if (r.ok) onSaved(r.data, null);
      else setErrors(r.details ?? [r.error]);
    } else {
      const r = await api.createDevice(payload);
      setBusy(false);
      if (r.ok) onSaved(r.data.device, r.data.token);
      else setErrors(r.details ?? [r.error]);
    }
  };

  const text = (k: string, label: string, placeholder = "", extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <div className="field">
      <label>{label}</label>
      <input value={s(k)} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} {...extra} />
    </div>
  );
  const number = (k: string, label: string, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <div className="field">
      <label>{label}</label>
      <input type="number" value={s(k)} onChange={(e) => set(k, e.target.value === "" ? "" : Number(e.target.value))} {...extra} />
    </div>
  );
  const stallField = (
    <div className="field">
      <label>Stall</label>
      <input list="hw-stalls" value={s("stall")} onChange={(e) => set("stall", e.target.value)} placeholder="A-04" />
      <datalist id="hw-stalls">
        {stalls.map((x) => <option key={x} value={x} />)}
      </datalist>
    </div>
  );
  const edgeField = (
    <div className="field">
      <label>Polled by edge box</label>
      <select value={s("edgeId")} onChange={(e) => set("edgeId", e.target.value || null)}>
        <option value="">— not assigned (nothing polls it) —</option>
        {edges.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
    </div>
  );

  const isCamera = kind === "thermal_camera";
  const title = dev ? `Edit ${dev.name}` : `Add ${KIND[kind].one}`;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />} {dev ? "Save" : `Add ${KIND[kind].one}`}
          </button>
        </>
      }
    >
      <div className={isCamera ? "grid cols-2" : ""} style={{ gap: 20, alignItems: "start" }}>
        <div>
          <div className="grid cols-2" style={{ gap: 10 }}>
            {text("name", "Name", kind === "edge_box" ? "Barn A edge" : kind === "modbus_sensor" ? "A-04 water meter" : "Stall A-04 thermal")}
            {kind === "edge_box" ? text("location", "Location", "Barn A comms cabinet") : stallField}
          </div>

          {(isCamera || kind === "modbus_sensor") && (
            <>
              <p className="hw-legend">Connection</p>
              {edges.length === 0 && (
                <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  No edge box yet — you can save this now and assign it once one is added.
                </p>
              )}
              <div className="grid cols-2" style={{ gap: 10 }}>
                {edgeField}
                {text("host", "IP address", "192.168.1.102", { onChange: (e) => set("host", e.target.value.trim()) })}
                {isCamera ? (
                  <>
                    {number("httpPort", "HTTP port")}
                    {text("username", "Username", "admin", { autoComplete: "off" })}
                    <div className="field">
                      <label>Password</label>
                      <input
                        type="password"
                        value={s("password")}
                        onChange={(e) => set("password", e.target.value)}
                        autoComplete="new-password"
                        placeholder={dev && (dev as ThermalCamera).hasPassword ? "unchanged" : ""}
                      />
                    </div>
                    {number("rtspPort", "RTSP port")}
                    {number("modbusPort", "Modbus/TCP port")}
                  </>
                ) : (
                  <>
                    {number("port", "TCP port")}
                    {number("unitId", "Unit (slave) id", { min: 0, max: 247 })}
                    <div className="field">
                      <label>Function</label>
                      <select value={n("function")} onChange={(e) => set("function", Number(e.target.value))}>
                        <option value={3}>3 — holding registers</option>
                        <option value={4}>4 — input registers</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Datasheet addresses are</label>
                      <select value={s("addressing")} onChange={(e) => set("addressing", e.target.value)}>
                        <option value="zero-based">zero-based (0 = first register)</option>
                        <option value="one-based">one-based (1 = first register, e.g. 40001-style)</option>
                      </select>
                    </div>
                    {number("pollSeconds", "Poll every (s)", { min: 1, max: 3600 })}
                  </>
                )}
              </div>
              {isCamera && (
                <label className="hw-check">
                  <input type="checkbox" checked={Boolean(f.https)} onChange={(e) => set("https", e.target.checked)} /> Use
                  HTTPS (camera certificates are self-signed; the site LAN is trusted)
                </label>
              )}
            </>
          )}

          {isCamera && (
            <>
              <p className="hw-legend">Optics and mounting</p>
              <div className="grid cols-2" style={{ gap: 10 }}>
                <div className="field">
                  <label>Thermal variant</label>
                  <select
                    value={s("variant")}
                    onChange={(e) => {
                      const v = e.target.value as ThermalCamera["variant"];
                      setF((x) => ({ ...x, variant: v, thermalLens: SPEC.thermal[v].defaultLens }));
                    }}
                  >
                    {variants().map((v) => (
                      <option key={v} value={v}>{v} ({SPEC.thermal[v].resolution.join("×")})</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Thermal lens</label>
                  <select value={s("thermalLens")} onChange={(e) => set("thermalLens", e.target.value)}>
                    {lensesFor(s("variant")).map((l) => <option key={l} value={l}>{l} mm</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Visible lens</label>
                  <select value={s("visibleLens")} onChange={(e) => set("visibleLens", e.target.value)}>
                    {SPEC.visible.lenses.map((l) => <option key={l} value={l}>{l} mm</option>)}
                  </select>
                </div>
                {number("distanceM", "Distance to horse (m)", { min: 0.5, max: 30, step: 0.1 })}
                {number("emissivity", "Emissivity", { min: 0.01, max: 1, step: 0.01 })}
              </div>
              {dev && (
                <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                  Changing the IP address, stall, lens or distance marks the ROIs for re-calibration — readings are held
                  back from alerts until the camera is aimed again.
                </p>
              )}
            </>
          )}

          {kind === "modbus_sensor" && (
            <RegisterEditor
              registers={f.registers ?? []}
              addressing={s("addressing")}
              onChange={(r) => set("registers", r)}
            />
          )}

          {kind === "push_device" && (
            <>
              <p className="hw-legend">Metrics it may send</p>
              <div className="hw-metrics">
                {METRIC_KEYS.map((m) => (
                  <label key={m} className="hw-check">
                    <input
                      type="checkbox"
                      checked={(f.metrics ?? []).includes(m)}
                      onChange={(e) =>
                        set("metrics", e.target.checked ? [...(f.metrics ?? []), m] : (f.metrics ?? []).filter((x) => x !== m))
                      }
                    />
                    {METRICS[m].label} <span className="muted">({m}, {METRICS[m].unit})</span>
                  </label>
                ))}
              </div>
            </>
          )}

          <div className="field" style={{ marginTop: 12 }}>
            <label>Notes</label>
            <input value={s("notes")} onChange={(e) => set("notes", e.target.value)} placeholder="Mounting, cabling, vendor contact…" />
          </div>
          {(kind === "edge_box" || kind === "push_device") && !dev && (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              A token is issued when you add it and shown once.
            </p>
          )}

          {errors.length > 0 && (
            <div className="row urgent" style={{ marginTop: 12, alignItems: "flex-start" }}>
              <XCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{errors.join(" · ")}</span>
            </div>
          )}
        </div>

        {isCamera && (
          <div>
            <p className="hw-legend" style={{ marginTop: 0 }}>Will this read the horse?</p>
            <OpticsPanel variant={s("variant")} lens={s("thermalLens")} distanceM={n("distanceM")} />
          </div>
        )}
      </div>
    </Modal>
  );
}

/** A Modbus register map, as it appears in a sensor's datasheet. */
function RegisterEditor({ registers, addressing, onChange }: {
  registers: ModbusRegister[]; addressing: string; onChange: (r: ModbusRegister[]) => void;
}) {
  const upd = (i: number, patch: Partial<ModbusRegister>) => onChange(registers.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const numOr = (v: string) => (v === "" ? ("" as unknown as number) : Number(v));
  return (
    <>
      <p className="hw-legend">Registers</p>
      <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        value = raw × scale + offset. Addresses are {addressing}. Use <b>counter</b> for a running total (a meter&apos;s
        total litres): the edge box reports the increase since the last poll and handles the meter resetting. Use
        &nbsp;<b>Test read</b> after saving to check the numbers against the device&apos;s own display.
      </p>
      {registers.map((r, i) => {
        const wide = r.type !== "uint16" && r.type !== "int16";
        return (
          <div key={i} className="hw-reg">
            <div className="grid cols-4" style={{ gap: 8 }}>
              <div className="field">
                <label>Name</label>
                <input value={r.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="Total litres" />
              </div>
              <div className="field">
                <label>Address</label>
                <input type="number" value={r.address} onChange={(e) => upd(i, { address: numOr(e.target.value) })} />
              </div>
              <div className="field">
                <label>Type</label>
                <select value={r.type} onChange={(e) => upd(i, { type: e.target.value as ModbusRegister["type"] })}>
                  {REG_TYPES.map((t) => <option key={t} value={t}>{t}{t === "uint16" || t === "int16" ? "" : " (2 regs)"}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Word order</label>
                <select value={r.wordOrder} disabled={!wide} onChange={(e) => upd(i, { wordOrder: e.target.value as ModbusRegister["wordOrder"] })}>
                  <option value="high-first">high word first</option>
                  <option value="low-first">low word first</option>
                </select>
              </div>
              <div className="field">
                <label>Scale</label>
                <input type="number" step="any" value={r.scale} onChange={(e) => upd(i, { scale: numOr(e.target.value) })} />
              </div>
              <div className="field">
                <label>Offset</label>
                <input type="number" step="any" value={r.offset} onChange={(e) => upd(i, { offset: numOr(e.target.value) })} />
              </div>
              <div className="field">
                <label>Feeds metric</label>
                <select value={r.metric} onChange={(e) => upd(i, { metric: e.target.value, unit: "" })}>
                  {METRIC_KEYS.map((m) => <option key={m} value={m}>{METRICS[m].label} ({METRICS[m].unit})</option>)}
                </select>
              </div>
              <div className="field">
                <label>Mode</label>
                <select value={r.mode} onChange={(e) => upd(i, { mode: e.target.value as ModbusRegister["mode"] })}>
                  <option value="gauge">gauge (current value)</option>
                  <option value="counter">counter (running total)</option>
                </select>
              </div>
            </div>
            {registers.length > 1 && (
              <button className="sub" style={{ color: "var(--alert)", marginTop: 4 }} onClick={() => onChange(registers.filter((_, j) => j !== i))}>
                Remove register
              </button>
            )}
          </div>
        );
      })}
      {registers.length < 32 && (
        <button className="btn-ghost" style={{ marginTop: 6 }} onClick={() => onChange([...registers, blankRegister()])}>
          <Plus size={15} /> Add register
        </button>
      )}
    </>
  );
}

// --------------------------------------------------------------------------- //
// ROI calibration
// --------------------------------------------------------------------------- //
function CalibrateModal({ cam, onClose }: { cam: ThermalCamera; onClose: () => void }) {
  const notify = useToast();
  const [thermal, setThermal] = useState<{ url?: string; error?: string; status?: number } | null>(null);
  const [visible, setVisible] = useState<{ url?: string; error?: string } | null>(null);
  const [rois, setRois] = useState<Rois>(cam.rois ? { eye: cam.rois.eye, nostril: cam.rois.nostril } : DEFAULT_ROIS);
  const [mode, setMode] = useState<"eye" | "nostril">("eye");
  const [busy, setBusy] = useState(false);
  const [pushed, setPushed] = useState<{ at: string; detail: string; verified: boolean | null } | null>(null);
  const [pushError, setPushError] = useState("");
  const [temps, setTemps] = useState<CameraTemps | null>(null);
  const [watch, setWatch] = useState<number[] | null>(null);
  const [watching, setWatching] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  const loadSnapshots = useCallback(async () => {
    setThermal(null);
    setVisible(null);
    // One after the other: the camera serves one session, and the server
    // serialises requests to it anyway.
    const t = await api.fetchSnapshot(cam.id, 0);
    if (!alive.current) return;
    setThermal(t);
    const v = await api.fetchSnapshot(cam.id, 1);
    if (alive.current) setVisible(v);
  }, [cam.id]);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  // release blob URLs
  useEffect(() => () => {
    if (thermal?.url) URL.revokeObjectURL(thermal.url);
  }, [thermal]);
  useEffect(() => () => {
    if (visible?.url) URL.revokeObjectURL(visible.url);
  }, [visible]);

  const readTemps = async () => {
    const r = await api.readCameraTemps(cam.id);
    if (r.ok) setTemps(r.data);
    else notify(`Could not read temperatures: ${r.error}`);
  };

  const push = async () => {
    setBusy(true);
    setPushError("");
    const r = await api.pushRois(cam.id, rois);
    setBusy(false);
    if (!r.ok) {
      setPushError(r.error);
      return notify("The ROIs were not confirmed — see the message");
    }
    setPushed({ at: r.data.rois.pushedAt ?? new Date().toISOString(), detail: r.data.verify.detail, verified: r.data.verify.verified });
    setWatch(null);
    notify("ROIs pushed to the camera");
    readTemps();
  };

  // Breathing shows as a slow oscillation in the nostril box's average. One
  // reading can't show it; twenty seconds can.
  const watchBreathing = async () => {
    setWatching(true);
    const series: number[] = [];
    for (let i = 0; i < 20 && alive.current; i++) {
      const r = await api.readCameraTemps(cam.id);
      if (r.ok && r.data.nostril?.avgC != null) {
        series.push(r.data.nostril.avgC);
        setWatch([...series]);
        setTemps(r.data);
      }
      await sleep(1000);
    }
    if (alive.current) setWatching(false);
  };

  const swing = watch && watch.length > 3 ? Math.max(...watch) - Math.min(...watch) : null;
  const eyeC = temps?.eye?.c ?? null;
  const nosMax = temps?.nostril?.maxC ?? null;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`Calibrate ROIs · ${cam.name}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn-primary" onClick={push} disabled={busy || !thermal?.url}>
            {busy ? <Loader2 size={16} className="spin" /> : <Crosshair size={16} />} Push ROIs to camera
          </button>
        </>
      }
    >
      <div className="grid cols-2" style={{ gap: 18, alignItems: "start" }}>
        <div>
          <div className="flex between center" style={{ marginBottom: 8, gap: 8 }}>
            <div className="tabs">
              <button className={mode === "eye" ? "on" : ""} onClick={() => setMode("eye")}>
                Place eye point
              </button>
              <button className={mode === "nostril" ? "on" : ""} onClick={() => setMode("nostril")}>
                Draw nostril box
              </button>
            </div>
            <button className="sub" style={{ color: "var(--accent)", fontWeight: 600 }} onClick={loadSnapshots}>
              Refresh
            </button>
          </div>
          {!thermal ? (
            <div className="hw-stage-empty">
              <Loader2 className="spin" size={22} />
            </div>
          ) : thermal.error ? (
            <div className="hw-stage-empty">
              {thermal.status === 409
                ? `A different camera is answering at this address: ${thermal.error} Close this and run “Test connection” to review it.`
                : `Thermal snapshot failed: ${thermal.error}`}
            </div>
          ) : (
            <RoiStage src={thermal.url!} rois={rois} mode={mode} onChange={setRois} />
          )}
          <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
            {mode === "eye"
              ? "Click the inner corner of the eye — usually the warmest spot on the head."
              : "Drag a box over the nostril. Breathing is read from the box's average, so keep it tight."}{" "}
            Coordinates: eye ({rois.eye.x}, {rois.eye.y}), nostril ({rois.nostril.x0}, {rois.nostril.y0})–({rois.nostril.x1},{" "}
            {rois.nostril.y1}) of 10000.
          </p>
        </div>

        <div>
          <p className="hw-legend" style={{ marginTop: 0 }}>
            Visible reference
          </p>
          {!visible ? (
            <div className="hw-stage-empty small">
              <Loader2 className="spin" size={18} />
            </div>
          ) : visible.error ? (
            <div className="hw-stage-empty small">Visible snapshot failed: {visible.error}</div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={visible.url} alt="Visible camera view" className="hw-visible" />
          )}
          <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            For orientation only. ROIs are set in thermal-sensor coordinates, and the vendor has not provided the
            visible↔thermal mapping — so aim on the thermal image.
          </p>

          <p className="hw-legend">Check the aim</p>
          {pushError && (
            <div className="row urgent" style={{ padding: "10px 14px", marginBottom: 10 }}>
              <XCircle size={16} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 12.5 }}>{pushError}</span>
            </div>
          )}
          {pushed && (
            <div className={`row ${pushed.verified === true ? "calm" : "watch"}`} style={{ padding: "10px 14px", marginBottom: 10 }}>
              {pushed.verified === true ? <CheckCircle2 size={16} style={{ flexShrink: 0 }} /> : <Info size={16} style={{ flexShrink: 0 }} />}
              <span style={{ fontSize: 12.5 }}>Pushed {when(pushed.at)} — {pushed.detail}.</span>
            </div>
          )}
          {!pushed && !temps && <p className="muted" style={{ fontSize: 12.5 }}>Push the ROIs, then read what they measure.</p>}
          {temps && (
            <div className="hw-facts">
              <div>
                <span>Eye point</span>
                <b>{eyeC != null ? `${eyeC.toFixed(1)} °C` : "no reading"}</b>
              </div>
              <div>
                <span>Nostril box</span>
                <b>
                  {temps.nostril?.avgC != null
                    ? `avg ${temps.nostril.avgC.toFixed(1)} · min ${temps.nostril.minC?.toFixed(1)} · max ${temps.nostril.maxC?.toFixed(1)} °C`
                    : "no reading"}
                </b>
              </div>
            </div>
          )}
          {eyeC != null && nosMax != null && eyeC < nosMax - 0.3 && (
            <div className="row watch" style={{ marginTop: 10, padding: "10px 14px" }}>
              <Info size={16} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 12.5 }}>
                The eye point reads cooler than the warmest part of the nostril box. The eye&apos;s inner corner is normally
                the warmest spot on the head, so the point is probably off the eye.
              </span>
            </div>
          )}
          {pushed && (
            <div className="flex gap-sm wrap" style={{ marginTop: 10 }}>
              <button className="btn-ghost" onClick={readTemps}>
                Read again
              </button>
              <button className="btn-ghost accent" onClick={watchBreathing} disabled={watching}>
                {watching ? <Loader2 size={15} className="spin" /> : <ScanLine size={15} />}
                {watching ? `Watching… ${watch?.length ?? 0}/20 s` : "Watch breathing (20 s)"}
              </button>
            </div>
          )}
          {watch && watch.length > 1 && (
            <div style={{ marginTop: 12 }}>
              <Sparkline data={watch} w={260} h={48} />
              {swing != null && !watching && (
                <p style={{ fontSize: 12.5, marginTop: 6, color: swing >= 0.3 ? "var(--positive)" : "var(--warn)" }}>
                  {swing >= 0.3
                    ? `The box average swings ${swing.toFixed(2)} °C — consistent with breathing. (A swing alone can't rule out head movement; the edge agent's rhythm check confirms it once it runs.)`
                    : `Flat (${swing.toFixed(2)} °C swing) — no breathing signal in 20 s. The box is probably off the nostril, or the horse had its head turned.`}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Thermal image with the eye point and nostril box drawn on it. Pointer events,
 *  so it works with a finger on a tablet in the barn as well as a mouse. */
function RoiStage({ src, rois, mode, onChange }: {
  src: string; rois: Rois; mode: "eye" | "nostril"; onChange: (r: Rois) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const clamp = (v: number) => Math.max(0, Math.min(10000, Math.round(v)));
  const toRat = (e: RPointerEvent) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: clamp(((e.clientX - r.left) / r.width) * 10000), y: clamp(((e.clientY - r.top) / r.height) * 10000) };
  };

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    const p = toRat(e);
    if (mode === "eye") return onChange({ ...rois, eye: p });
    start.current = p;
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange({ ...rois, nostril: { x0: p.x, y0: p.y, x1: p.x, y1: p.y } });
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const p = toRat(e), s = start.current;
    onChange({ ...rois, nostril: { x0: Math.min(s.x, p.x), y0: Math.min(s.y, p.y), x1: Math.max(s.x, p.x), y1: Math.max(s.y, p.y) } });
  };
  const up = () => {
    if (!start.current) return;
    start.current = null;
    const n = rois.nostril;
    // A click without a drag would make a zero-size box; give it a usable size.
    if (n.x1 - n.x0 < 150 || n.y1 - n.y0 < 150)
      onChange({ ...rois, nostril: { x0: clamp(n.x0 - 400), y0: clamp(n.y0 - 300), x1: clamp(n.x0 + 400), y1: clamp(n.y0 + 300) } });
  };

  const n = rois.nostril;
  return (
    <div ref={stage} className="hw-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Thermal camera view" draggable={false} />
      <div
        className="hw-box"
        style={{ left: `${n.x0 / 100}%`, top: `${n.y0 / 100}%`, width: `${(n.x1 - n.x0) / 100}%`, height: `${(n.y1 - n.y0) / 100}%` }}
      >
        <span>nostril</span>
      </div>
      <div className="hw-eye" style={{ left: `${rois.eye.x / 100}%`, top: `${rois.eye.y / 100}%` }}>
        <span>eye</span>
      </div>
    </div>
  );
}
