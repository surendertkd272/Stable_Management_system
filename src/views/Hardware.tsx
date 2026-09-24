"use client";

// Hardware integration — register the stall cameras, prove the site server can
// talk to them, and aim their temperature ROIs at the eye and nostril.
//
// Everything that touches a camera goes through the site server (the browser
// cannot reach the barn LAN, and must never hold camera passwords). The optics
// planner is pure datasheet maths and works anywhere, including the demo.
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  Camera as CameraIcon, Plus, PlugZap, Crosshair, Pencil, Trash2, CheckCircle2, XCircle,
  Loader2, Wifi, WifiOff, Info, Zap, Ruler, ScanLine,
} from "lucide-react";
import * as api from "../data/api";
import type { Camera, CameraInput, CameraTemps } from "../data/api";
import { SC_IT6420_HB_V2 as SPEC, assessOptics, lensesFor, variants } from "../../server/hardware-spec.mjs";
import { Modal, Sparkline } from "../components/ui";
import { useStable, useToast } from "../store";
import { useAuth } from "../auth";

type Rois = Pick<NonNullable<Camera["rois"]>, "eye" | "nostril">;

// Where the edge agent points ROIs on an uncalibrated camera — frame centre.
const DEFAULT_ROIS: Rois = { eye: { x: 5000, y: 5000 }, nostril: { x0: 4200, y0: 5200, x1: 5800, y1: 6400 } };

const blank = (stall = ""): CameraInput => ({
  name: "", stall, host: "", httpPort: 80, https: false, rtspPort: 554, modbusPort: 502,
  username: "admin", password: "", variant: "640", thermalLens: "13", visibleLens: "4",
  distanceM: 3.5, emissivity: 0.98,
});

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "never");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------------- //
export default function Hardware() {
  const { user, authRequired } = useAuth();
  const { horses } = useStable();
  const notify = useToast();
  const role = user?.role ?? (authRequired ? null : "admin");
  const isAdmin = role === "admin";

  const [cams, setCams] = useState<Camera[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<{ cam?: Camera } | null>(null);
  const [calibrating, setCalibrating] = useState<Camera | null>(null);
  const [probing, setProbing] = useState<string | null>(null);
  const [openProbe, setOpenProbe] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (api.demoMode) {
      setCams([]);
      return;
    }
    const r = await api.listCameras();
    if (r.ok) {
      setCams(r.data as Camera[]);
      setLoadError("");
    } else setLoadError(r.error);
  }, []);

  useEffect(() => {
    load();
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

  const probe = async (cam: Camera) => {
    setProbing(cam.id);
    const r = await api.probeCamera(cam.id);
    setProbing(null);
    if (!r.ok) return notify(`Test failed: ${r.error}`);
    notify(r.data.ok ? `${cam.name}: camera answered` : `${cam.name}: camera not reachable`);
    setOpenProbe(cam.id);
    load();
  };

  const remove = async (cam: Camera) => {
    if (!confirm(`Remove ${cam.name}? Its ROIs stay on the camera itself.`)) return;
    const r = await api.deleteCamera(cam.id);
    if (!r.ok) return notify(`Could not remove: ${r.error}`);
    notify(`${cam.name} removed`);
    load();
  };

  const list = cams ?? [];
  const online = list.filter((c) => c.lastProbe?.ok).length;
  const calibrated = list.filter((c) => c.rois && !c.rois.stale).length;
  const stalls = Array.from(new Set(horses.map((h) => h.stall).filter((s) => s && s !== "—"))).sort();

  return (
    <>
      {api.demoMode && (
        <div className="row watch" style={{ marginBottom: 18 }}>
          <Info size={18} style={{ flexShrink: 0 }} />
          <span>
            This is the public demo, which cannot reach barn cameras. Camera registration, connection
            tests and ROI calibration run on the site server (<code>npm start</code> on the stable&apos;s
            network). The optics planner below works here.
          </span>
        </div>
      )}

      {/* summary */}
      <div className="grid cols-4" style={{ marginBottom: 22 }}>
        <Stat icon={<CameraIcon size={20} />} label="Cameras registered" value={cams ? String(list.length) : "—"} />
        <Stat icon={<Wifi size={20} />} label="Answered last test" value={cams ? `${online}/${list.length}` : "—"} />
        <Stat icon={<Crosshair size={20} />} label="ROIs calibrated" value={cams ? `${calibrated}/${list.length}` : "—"} />
        <Stat
          icon={<Zap size={20} />}
          label={`PoE budget (≤${SPEC.power.maxW} W each)`}
          value={cams ? `${list.length * SPEC.power.maxW} W` : "—"}
        />
      </div>

      <div className="flex between center wrap" style={{ marginBottom: 14, gap: 12 }}>
        <h3 className="section-title" style={{ margin: 0 }}>
          Thermal cameras · {SPEC.model}
        </h3>
        {isAdmin && !api.demoMode && (
          <button className="btn-primary" onClick={() => setEditing({})}>
            <Plus size={16} /> Add camera
          </button>
        )}
      </div>

      {loadError && (
        <div className="row urgent" style={{ marginBottom: 14 }}>
          <XCircle size={18} /> <span>Could not load cameras: {loadError}</span>
        </div>
      )}

      {cams && list.length === 0 && !api.demoMode && (
        <div className="card" style={{ textAlign: "center", padding: 40, marginBottom: 22 }}>
          <CameraIcon size={30} color="var(--text-secondary)" />
          <p style={{ marginTop: 10, fontWeight: 600, color: "var(--ink)" }}>No cameras registered yet</p>
          <p className="muted" style={{ fontSize: 13, maxWidth: 520, margin: "6px auto 0" }}>
            Add each stall camera with its IP address and login. The server will test the connection,
            then you can aim its temperature ROIs at the horse&apos;s eye and nostril.
          </p>
        </div>
      )}

      <div className="grid cols-2" style={{ marginBottom: 26, alignItems: "start" }}>
        {list.map((cam) => (
          <CameraCard
            key={cam.id}
            cam={cam}
            isAdmin={isAdmin}
            probing={probing === cam.id}
            showProbe={openProbe === cam.id}
            onToggleProbe={() => setOpenProbe(openProbe === cam.id ? null : cam.id)}
            onProbe={() => probe(cam)}
            onEdit={() => setEditing({ cam })}
            onCalibrate={() => setCalibrating(cam)}
            onRemove={() => remove(cam)}
          />
        ))}
      </div>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <PlannerCard />
        <DatasheetCard />
      </div>

      {editing && (
        <CameraForm
          cam={editing.cam}
          stalls={stalls}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            setEditing(null);
            notify(editing.cam ? `${c.name} updated` : `${c.name} added — test the connection next`);
            load();
          }}
        />
      )}

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
function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
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

function StatusPill({ cam }: { cam: Camera }) {
  if (!cam.lastProbe) return <span className="pill muted">Not tested</span>;
  return cam.lastProbe.ok ? (
    <span className="pill ok">
      <Wifi size={12} /> Online
    </span>
  ) : (
    <span className="pill alert">
      <WifiOff size={12} /> Unreachable
    </span>
  );
}

function CameraCard(props: {
  cam: Camera; isAdmin: boolean; probing: boolean; showProbe: boolean;
  onToggleProbe: () => void; onProbe: () => void; onEdit: () => void; onCalibrate: () => void; onRemove: () => void;
}) {
  const { cam } = props;
  const v = SPEC.thermal[cam.variant];
  const optics = assessOptics(cam.variant, cam.thermalLens, cam.distanceM);
  const dev = cam.lastProbe?.device;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>{cam.name}</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Stall {cam.stall || "—"}
          </span>
        </div>
        <StatusPill cam={cam} />
      </div>

      <div className="hw-facts">
        <div>
          <span>Optics</span>
          <b>
            {cam.variant} ({v?.resolution.join("×")}) · {cam.thermalLens} mm thermal · {cam.visibleLens} mm visible
          </b>
        </div>
        <div>
          <span>Network</span>
          <b>
            {cam.https ? "https" : "http"}://{cam.host}:{cam.httpPort} · RTSP {cam.rtspPort} · Modbus {cam.modbusPort}
          </b>
        </div>
        <div>
          <span>Mounting</span>
          <b>
            {cam.distanceM} m · emissivity {cam.emissivity}
          </b>
        </div>
        {dev && (
          <div>
            <span>Device</span>
            <b>{[dev.Model || dev.DeviceName, dev.DeviceSN && `S/N ${dev.DeviceSN}`, dev.FWVersion].filter(Boolean).join(" · ")}</b>
          </div>
        )}
        {optics && (
          <div>
            <span>Pixels on target</span>
            <b>
              nostril {optics.targets.nostril.px.toFixed(0)} px{" "}
              <Verdict v={optics.targets.nostril.verdict} /> · eye {optics.targets.eye.px.toFixed(0)} px{" "}
              <Verdict v={optics.targets.eye.verdict} />
            </b>
          </div>
        )}
      </div>

      <div className={`row ${cam.rois && !cam.rois.stale ? "calm" : "watch"}`} style={{ margin: "14px 0 0", padding: "10px 14px" }}>
        <Crosshair size={16} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 12.5 }}>
          {!cam.rois
            ? "Not calibrated — the edge agent falls back to frame-centre ROIs, which only read the horse if its eye and nostril happen to be there."
            : cam.rois.stale
              ? "Re-calibrate: the camera was moved or its optics changed since the ROIs were aimed."
              : `ROIs aimed and pushed to the camera ${when(cam.rois.pushedAt)}.`}
        </span>
      </div>

      {props.isAdmin && !api.demoMode && (
        <div className="flex gap-sm wrap" style={{ marginTop: 14 }}>
          <button className="btn-ghost accent" onClick={props.onProbe} disabled={props.probing}>
            {props.probing ? <Loader2 size={15} className="spin" /> : <PlugZap size={15} />}
            {props.probing ? "Testing…" : "Test connection"}
          </button>
          <button className="btn-ghost" onClick={props.onCalibrate}>
            <Crosshair size={15} /> Calibrate ROIs
          </button>
          <button className="btn-ghost" onClick={props.onEdit}>
            <Pencil size={15} /> Edit
          </button>
          <button className="btn-ghost" onClick={props.onRemove} title="Remove camera">
            <Trash2 size={15} />
          </button>
        </div>
      )}

      {cam.lastProbe && (
        <div style={{ marginTop: 12 }}>
          <button className="sub" style={{ color: "var(--accent)", fontWeight: 600 }} onClick={props.onToggleProbe}>
            {props.showProbe ? "Hide" : "Show"} last test · {when(cam.lastProbe.at)}
          </button>
          {props.showProbe && (
            <ul className="hw-steps">
              {cam.lastProbe.steps.map((s) => (
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
          )}
        </div>
      )}
    </div>
  );
}

function Verdict({ v }: { v: "good" | "marginal" | "insufficient" }) {
  const cls = v === "good" ? "ok" : v === "marginal" ? "warn" : "alert";
  return <span className={`pill ${cls}`} style={{ fontSize: 10.5, padding: "1px 7px" }}>{v}</span>;
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
// Add / edit
// --------------------------------------------------------------------------- //
function CameraForm({ cam, stalls, onClose, onSaved }: {
  cam?: Camera; stalls: string[]; onClose: () => void; onSaved: (c: Camera) => void;
}) {
  const [f, setF] = useState<CameraInput>(() =>
    cam
      ? {
          name: cam.name, stall: cam.stall, host: cam.host, httpPort: cam.httpPort, https: cam.https,
          rtspPort: cam.rtspPort, modbusPort: cam.modbusPort, username: cam.username, password: "",
          variant: cam.variant, thermalLens: cam.thermalLens, visibleLens: cam.visibleLens,
          distanceM: cam.distanceM, emissivity: cam.emissivity,
        }
      : blank(stalls[0] ?? ""),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof CameraInput>(k: K, v: CameraInput[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true);
    setErrors([]);
    const payload = { ...f };
    if (cam && !payload.password) delete payload.password;   // blank = keep the stored one
    const r = cam ? await api.updateCamera(cam.id, payload) : await api.createCamera(payload);
    setBusy(false);
    if (r.ok) onSaved(r.data);
    else setErrors(r.details ?? [r.error]);
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={cam ? `Edit ${cam.name}` : "Add a camera"}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />} {cam ? "Save" : "Add camera"}
          </button>
        </>
      }
    >
      <div className="grid cols-2" style={{ gap: 20, alignItems: "start" }}>
        <div>
          <div className="grid cols-2" style={{ gap: 10 }}>
            <div className="field">
              <label>Name</label>
              <input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Stall A-04 thermal" />
            </div>
            <div className="field">
              <label>Stall</label>
              <input list="hw-stalls" value={f.stall} onChange={(e) => set("stall", e.target.value)} placeholder="A-04" />
              <datalist id="hw-stalls">
                {stalls.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          </div>

          <p className="hw-legend">Network</p>
          <div className="grid cols-2" style={{ gap: 10 }}>
            <div className="field">
              <label>IP address</label>
              <input value={f.host} onChange={(e) => set("host", e.target.value.trim())} placeholder="192.168.1.102" />
            </div>
            <div className="field">
              <label>HTTP port</label>
              <input type="number" value={f.httpPort} onChange={(e) => set("httpPort", Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Username</label>
              <input value={f.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                value={f.password}
                onChange={(e) => set("password", e.target.value)}
                autoComplete="new-password"
                placeholder={cam?.hasPassword ? "unchanged" : ""}
              />
            </div>
            <div className="field">
              <label>RTSP port</label>
              <input type="number" value={f.rtspPort} onChange={(e) => set("rtspPort", Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Modbus/TCP port</label>
              <input type="number" value={f.modbusPort} onChange={(e) => set("modbusPort", Number(e.target.value))} />
            </div>
          </div>
          <label className="hw-check">
            <input type="checkbox" checked={f.https} onChange={(e) => set("https", e.target.checked)} /> Use HTTPS (camera
            certificates are self-signed; the site LAN is trusted)
          </label>

          <p className="hw-legend">Optics and mounting</p>
          <div className="grid cols-2" style={{ gap: 10 }}>
            <div className="field">
              <label>Thermal variant</label>
              <select
                value={f.variant}
                onChange={(e) => {
                  const v = e.target.value as CameraInput["variant"];
                  setF((x) => ({ ...x, variant: v, thermalLens: SPEC.thermal[v].defaultLens }));
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
              <select value={f.thermalLens} onChange={(e) => set("thermalLens", e.target.value)}>
                {lensesFor(f.variant).map((l) => (
                  <option key={l} value={l}>
                    {l} mm
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Visible lens</label>
              <select value={f.visibleLens} onChange={(e) => set("visibleLens", e.target.value)}>
                {SPEC.visible.lenses.map((l) => (
                  <option key={l} value={l}>
                    {l} mm
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Distance to horse (m)</label>
              <input type="number" min={0.5} max={30} step={0.1} value={f.distanceM} onChange={(e) => set("distanceM", Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Emissivity</label>
              <input type="number" min={0.01} max={1} step={0.01} value={f.emissivity} onChange={(e) => set("emissivity", Number(e.target.value))} />
            </div>
          </div>

          {errors.length > 0 && (
            <div className="row urgent" style={{ marginTop: 12, alignItems: "flex-start" }}>
              <XCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{errors.join(" · ")}</span>
            </div>
          )}
        </div>

        <div>
          <p className="hw-legend" style={{ marginTop: 0 }}>
            Will this read the horse?
          </p>
          <OpticsPanel variant={f.variant} lens={f.thermalLens} distanceM={f.distanceM} />
        </div>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------- //
// ROI calibration
// --------------------------------------------------------------------------- //
function CalibrateModal({ cam, onClose }: { cam: Camera; onClose: () => void }) {
  const notify = useToast();
  const [thermal, setThermal] = useState<{ url?: string; error?: string } | null>(null);
  const [visible, setVisible] = useState<{ url?: string; error?: string } | null>(null);
  const [rois, setRois] = useState<Rois>(cam.rois ? { eye: cam.rois.eye, nostril: cam.rois.nostril } : DEFAULT_ROIS);
  const [mode, setMode] = useState<"eye" | "nostril">("eye");
  const [busy, setBusy] = useState(false);
  const [pushed, setPushed] = useState<string | null>(null);
  const [temps, setTemps] = useState<CameraTemps | null>(null);
  const [watch, setWatch] = useState<number[] | null>(null);
  const [watching, setWatching] = useState(false);

  const loadSnapshots = useCallback(async () => {
    setThermal(null);
    setVisible(null);
    const [t, v] = await Promise.all([api.fetchSnapshot(cam.id, 0), api.fetchSnapshot(cam.id, 1)]);
    setThermal(t);
    setVisible(v);
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
    const r = await api.pushRois(cam.id, rois);
    setBusy(false);
    if (!r.ok) return notify(`Camera rejected the ROIs: ${r.error}`);
    setPushed(r.data.rois.pushedAt ?? new Date().toISOString());
    setWatch(null);
    notify("ROIs pushed to the camera");
    readTemps();
  };

  // Breathing shows as a slow oscillation in the nostril box's average. One
  // reading can't show it; twenty seconds can.
  const watchBreathing = async () => {
    setWatching(true);
    const series: number[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await api.readCameraTemps(cam.id);
      if (r.ok && r.data.nostril?.avgC != null) {
        series.push(r.data.nostril.avgC);
        setWatch([...series]);
        setTemps(r.data);
      }
      await sleep(1000);
    }
    setWatching(false);
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
            <div className="hw-stage-empty">Thermal snapshot failed: {thermal.error}</div>
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
