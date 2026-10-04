"use client";
// Deleting a horse, and the recycle bin: a deleted horse waits 30 days with
// all its readings and can be restored; after that it is deleted for good
// (server/recycle.mjs). Administrators only.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import * as api from "../data/api";
import type { BinHorse } from "../data/api";
import { Modal } from "../components/ui";
import { useStable, useToast } from "../store";

export function DeleteHorseButton({ id, name }: { id: string; name: string }) {
  const { removeHorse } = useStable();
  const notify = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const err = await removeHorse(id);
    setBusy(false);
    if (err) { notify(err); return; }
    notify(`${name} moved to the recycle bin — restorable for 30 days`);
    router.push("/horses");
  };
  return (
    <>
      <button className="btn-ghost" onClick={() => setOpen(true)}><Trash2 size={15} /> Delete horse</button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title={`Delete ${name}?`}
          footer={<><button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={busy} onClick={go}><Trash2 size={15} /> Move to recycle bin</button></>}>
          <p style={{ fontSize: 13.5, marginTop: 0 }}>
            {name} leaves the horse list and its stall is freed. For 30 days it stays in the recycle bin with all its readings and can
            be restored. After 30 days it is deleted for good, with its readings.
          </p>
        </Modal>
      )}
    </>
  );
}

export function RecycleBinButton() {
  const { refreshHorses } = useStable();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<BinHorse[] | null>(null);
  const [confirmPurge, setConfirmPurge] = useState<BinHorse | null>(null);
  const load = useCallback(() => api.listBin().then((r) => setRows(r.ok ? r.data : [])), []);
  useEffect(() => { load(); }, [load]);
  const restore = async (b: BinHorse) => {
    const r = await api.restoreHorse(b.id);
    if (!r.ok) { notify(r.error); return; }
    notify(r.data.stallFreed ? `${b.name} restored — stall ${r.data.stallFreed.stall} is now ${r.data.stallFreed.nowWith}'s, so give ${b.name} a stall` : `${b.name} restored`);
    await refreshHorses();
    load();
  };
  const purge = async (b: BinHorse) => {
    const r = await api.purgeHorse(b.id);
    setConfirmPurge(null);
    if (!r.ok) { notify(r.error); return; }
    notify(`${b.name} deleted for good (${r.data.deletedReadings} readings)`);
    load();
  };
  const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <>
      <button className="btn-ghost" onClick={() => { setOpen(true); load(); }}><Trash2 size={15} /> Recycle bin{rows?.length ? ` (${rows.length})` : ""}</button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="Recycle bin" wide>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Deleted horses stay here for 30 days with all their readings, then are deleted for good.</p>
          {!rows?.length ? <p className="muted">The recycle bin is empty.</p> : (
            <div style={{ display: "grid", gap: 8 }}>
              {rows.map((b) => (
                <div key={b.id} className="card flex" style={{ padding: 10, gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  {b.photo && <div style={{ width: 54, height: 40, borderRadius: 8, backgroundSize: "cover", backgroundPosition: "center", backgroundImage: `url(${b.photo})` }} />}
                  <div className="grow" style={{ minWidth: 180 }}>
                    <b>{b.name}</b> <span className="muted" style={{ fontSize: 12.5 }}>· stall {b.stall ?? "—"} · {b.readings} readings</span>
                    <div className="muted" style={{ fontSize: 12 }}>Deleted {when(b.deletedAt)} by {b.deletedBy} · {b.daysLeft} day{b.daysLeft === 1 ? "" : "s"} left</div>
                  </div>
                  <button className="btn-primary" onClick={() => restore(b)}><RotateCcw size={15} /> Restore</button>
                  <button className="btn-ghost" onClick={() => setConfirmPurge(b)}><Trash2 size={15} /> Delete now</button>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
      {confirmPurge && (
        <Modal open onClose={() => setConfirmPurge(null)} title={`Delete ${confirmPurge.name} for good?`}
          footer={<><button className="btn-ghost" onClick={() => setConfirmPurge(null)}>Cancel</button>
            <button className="btn-primary" onClick={() => purge(confirmPurge)}><Trash2 size={15} /> Delete for good</button></>}>
          <p style={{ fontSize: 13.5, marginTop: 0 }}>{confirmPurge.name} and its {confirmPurge.readings} readings are deleted now. This cannot be undone.</p>
        </Modal>
      )}
    </>
  );
}
