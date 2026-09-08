"use client";
import { useState } from "react";
import { useDashboardUI } from "./DashboardUI";
import { requestJson } from "./requests";

export function UnassignButton({ id, who }: { id: string; who: string }) {
  const { refresh, notify, pending } = useDashboardUI();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function go() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await requestJson(`/api/assignments/${id}`, { method: "DELETE" });
      setDone(true); notify(`Work unassigned from ${who}.`); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't unassign this work."); }
    finally { setBusy(false); }
  }
  if (done) return <span className="muted" role="status">Unassigned</span>;
  if (!confirming) return <button type="button" className="btn-row" disabled={pending} onClick={() => setConfirming(true)} title={`Take this back from ${who}`}>Unassign</button>;
  return <span className="confirm-inline"><button type="button" className="btn-row danger" disabled={busy} onClick={go}>{busy ? "Unassigning…" : error ? "Retry" : "Confirm"}</button><button type="button" className="btn-row" disabled={busy} onClick={() => { setConfirming(false); setError(""); }}>Cancel</button>{error && <span className="row-error" role="alert">{error}</span>}</span>;
}
