"use client";
import { useState } from "react";
import { IconUsers } from "./icons";
import { Dialog } from "./Dialog";
import { useSelection } from "./Selection";
import { useDashboardUI } from "./DashboardUI";
import { requestJson } from "./requests";

export type Assignee = { email: string; name: string | null };
type Result = { assignee: string; requested: number; assigned: number; reassigned: number; skipped: number; skippedNoPhone: number; capped: boolean };
export function AssignButton({ entity, total, assignees }: { entity: "record" | "call"; total: number; assignees: Assignee[] }) {
  const selection = useSelection();
  const { pending, refresh, notify } = useDashboardUI();
  const [open, setOpen] = useState(false);
  const [selIds, setSelIds] = useState<string[]>([]);
  const [scope, setScope] = useState<"selected" | "all">("all");
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [reassign, setReassign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const count = scope === "selected" ? selIds.length : total;
  const label = entity === "record" ? "record" : "call";
  function openModal() {
    setSelIds(selection.ids);
    setScope(!selection.allMatching && selection.ids.length ? "selected" : "all");
    setError(""); setResult(null); setOpen(true);
  }
  async function submit() {
    if (!assignee || !count || busy) return;
    setBusy(true); setError("");
    try {
      const filters = Object.fromEntries(new URLSearchParams(location.search)); delete filters.page;
      const data: Result = await requestJson("/api/assignments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entity_type: entity, assignee, note: note.trim() || undefined, reassign, ...(scope === "selected" ? { ids: selIds } : { filters }) }) });
      setResult(data);
      notify(`Assigned ${data.assigned} ${label}(s) to ${assignee}.`);
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't assign this work. Try again."); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="btn-assign" onClick={openModal} disabled={!total || !assignees.length || pending} title={!assignees.length ? "No active users — add them under Team" : `Assign ${selection.count} ${label}(s)`}><IconUsers size={15} />Assign</button>
    {open && <Dialog title={<><IconUsers size={16} />Assign {label}s</>} onClose={() => setOpen(false)} busy={busy}>
      {result ? <>
        <div className="modal-body"><p className="assign-done">Assigned <strong>{result.assigned.toLocaleString()}</strong> {label}(s) to <strong>{result.assignee}</strong>.</p><ul className="assign-summary">
          {result.reassigned > 0 && <li>{result.reassigned} taken from a previous owner</li>}
          {result.skipped > 0 && <li className="warn">{result.skipped} skipped — already assigned{reassign ? " to this person" : " (enable reassign to take them over)"}</li>}
          {result.skippedNoPhone > 0 && <li className="warn">{result.skippedNoPhone} left out — no phone number to call</li>}
          {result.capped && <li className="warn">Assignment limit reached. Narrow the filters to assign the remaining work.</li>}
        </ul></div><div className="modal-foot"><a href={`/dashboard/assignments?assignee=${encodeURIComponent(result.assignee)}`}>View assignments</a><span className="spacer" /><button type="button" className="btn-primary" onClick={() => setOpen(false)}>Done</button></div>
      </> : <>
        <div className="modal-body"><fieldset disabled={busy} className="plain-fieldset">
          <div className="assign-scope">
            <label className={scope === "selected" ? "active" : undefined}><input type="radio" name="assign-scope" checked={scope === "selected"} disabled={!selIds.length} onChange={() => { setScope("selected"); selection.setAllMatching(false); }} />{selIds.length} selected on this page</label>
            <label className={scope === "all" ? "active" : undefined}><input type="radio" name="assign-scope" checked={scope === "all"} onChange={() => { setScope("all"); selection.setAllMatching(true); }} />All {total.toLocaleString()} matching the current filters</label>
          </div>
          <label className="assign-field"><span>Assign to</span><select value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Choose someone…</option>{assignees.map(a => <option key={a.email} value={a.email}>{a.name ? `${a.name} — ${a.email}` : a.email}</option>)}</select></label>
          <label className="assign-field"><span>Note (optional)</span><input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. verify area + rent before adding to DB" /></label>
          <label className="assign-check"><input type="checkbox" checked={reassign} onChange={e => setReassign(e.target.checked)} />Reassign rows already owned by someone else</label>
        </fieldset>{error && <p className="assign-error" role="alert">{error}</p>}</div>
        <div className="modal-foot"><span className="muted">{count.toLocaleString()} {label}(s)</span><span className="spacer" /><button type="button" className="btn-text" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn-primary" disabled={busy || !assignee || !count} onClick={submit}>{busy ? "Assigning…" : `Assign ${count.toLocaleString()}`}</button></div>
      </>}
    </Dialog>}
  </>;
}
