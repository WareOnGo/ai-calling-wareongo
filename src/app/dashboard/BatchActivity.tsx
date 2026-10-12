"use client";
import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { requestJson } from "./requests";
import { dateTime } from "@/lib/display";

type Batch = { last_error: string | null; resolution_note: string | null; id: string; agent_label: string; dispatch_request_id: string | null; created_by: string; scheduled_at: string | null; created_at: string; state: string; callable: number; held_region: number; results_received: number; bolna_batch_id: string | null };
export function BatchActivity() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ batches: Batch[]; updatedAt: string } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let running = false;
    const load = async () => {
      if (running || controller.signal.aborted) return;
      running = true; setLoading(true); setError("");
      try { setData(await requestJson('/api/batches', { signal: controller.signal })); }
      catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Couldn't load batches."); }
      finally { running = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [open, attempt]);
  return <><button type="button" className="btn-row" onClick={() => setOpen(true)}>Recent batches</button>
    {open && <Dialog wide title="Recent calling batches" onClose={() => setOpen(false)}>
      <div className="modal-body batch-list">
        <p className="muted">Latest 20 batches across the team. Updates every 15 seconds while open.</p>
        {error && <p role="alert" className="assign-error">{error}</p>}
        {loading && !data && <p role="status">Loading batches…</p>}
        {data && !data.batches.length && <p>No calls have been queued yet.</p>}
        {data?.batches.map(b => <article className="detail-history" key={b.id}><strong>{b.state === "scheduled" ? "Scheduled" : b.state === "sending" ? "Sending — awaiting confirmation" : b.state === "failed" ? "Dispatch needs attention" : b.state}</strong><span className="muted"> · {b.callable} calls</span>
          <p>{b.agent_label} agent · {dateTime(b.scheduled_at || b.created_at)}</p><p>{b.results_received} call results received · {b.created_by}</p>{b.held_region > 0 && <p>{b.held_region} held for region routing</p>}
          {b.state === "failed" && <p className="row-error">Check the calling service before sending these numbers again.</p>}
          {b.last_error && <p className="row-error">{b.last_error}</p>}
          {b.resolution_note && <p>{b.resolution_note}</p>}
          <small>Batch {b.bolna_batch_id || b.id}</small>
          {!["completed", "canceled"].includes(b.state) && <BatchResolution batch={b} onResolved={() => setAttempt(n => n + 1)} />}</article>)}
      </div>
      <div className="modal-foot"><span className="muted">{data ? `Updated ${dateTime(data.updatedAt)}` : ""}</span><span className="spacer" /><button type="button" className="btn-row" disabled={loading} onClick={() => setAttempt(n => n + 1)}>{loading ? "Refreshing…" : "Refresh batches"}</button></div>
    </Dialog>}
  </>;
}

function BatchResolution({ batch, onResolved }: { batch: Batch; onResolved: () => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false), [error, setError] = useState("");
  const [state, setState] = useState<"completed" | "canceled">("completed");
  async function act(body: object) {
    setBusy(true); setError("");
    try { await requestJson(`/api/batches/${batch.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) }); onResolved(); setOpen(false); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update batch"); }
    finally { setBusy(false); }
  }
  return <div>
    {batch.bolna_batch_id && <button type="button" className="btn-row" disabled={busy} onClick={() => act({ action: "reconcile" })}>Check Bolna status</button>}
    <button type="button" className="btn-row" disabled={busy} onClick={() => setOpen(v => !v)}>Resolve batch</button>
    {open && <fieldset disabled={busy}>
      <legend>Release this batch’s reserved numbers</legend>
      <p>Verify in Bolna that all calls and retries have finished or been canceled.</p>
      <label>Outcome <select value={state} onChange={e => setState(e.target.value as typeof state)}><option value="completed">Completed</option><option value="canceled">Canceled</option></select></label>
      <label>Verification note <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} /></label>
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I verified that no calls or retries remain pending.</label>
      <button type="button" className="btn-row" disabled={!confirmed || note.trim().length < 10} onClick={() => act({ action: "resolve", state, note, confirmedNoPendingCalls: true })}>Save resolution</button>
    </fieldset>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
