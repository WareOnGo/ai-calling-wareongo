"use client";
import { useEffect, useState } from "react";
import type { AllocationPreview, AssignSummary } from "@/lib/assignment-allocation";
import type { AssigneeWorkload } from "@/lib/users";
import { IconUsers } from "./icons";
import { Dialog } from "./Dialog";
import { useSelection } from "./Selection";
import { useDashboardUI } from "./DashboardUI";
import { requestJson } from "./requests";
import { AllocationRecords } from "./AllocationRecords";
export type Assignee = { email: string; name: string | null };
type Preview = AllocationPreview & { workloads: AssigneeWorkload[] };
export function AssignButton({ entity, total, assignees }: { entity: "record" | "call"; total: number; assignees: Assignee[] }) {
  const selection = useSelection(), { pending, refresh, notify } = useDashboardUI();
  const [open, setOpen] = useState(false), [selIds, setSelIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<Record<string, string | string[]>>({});
  const [scope, setScope] = useState<"selected" | "all">("all"), [assignee, setAssignee] = useState("");
  const [roundRobin, setRoundRobin] = useState(false), [callers, setCallers] = useState<string[]>([]);
  const [note, setNote] = useState(""), [reassign, setReassign] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [preview, setPreview] = useState<Preview | null>(null), [previewPage, setPreviewPage] = useState(0);
  const [result, setResult] = useState<AssignSummary | null>(null), [intentKey, setIntentKey] = useState("");
  const [retry, setRetry] = useState(0);
  const count = scope === "selected" ? selIds.length : total, label = entity === "record" ? "record" : "call";
  const people = roundRobin ? callers : [assignee].filter(Boolean);
  const request = { entity_type: entity, ...(roundRobin ? { assignees: callers } : { assignee }), reassign, ...(scope === "selected" ? { ids: selIds } : { filters }) };
  const requestText = JSON.stringify(request);
  function change() { setIntentKey(crypto.randomUUID()); setResult(null); setPreview(null); setPreviewPage(0); }
  function openModal() {
    const params = new URLSearchParams(location.search), f: Record<string, string | string[]> = {};
    for (const key of new Set(params.keys())) if (key !== "page") { const values = params.getAll(key); f[key] = values.length === 1 ? values[0] : values; }
    setFilters(f); setSelIds(selection.ids); setScope(!selection.allMatching && selection.ids.length ? "selected" : "all");
    setAssignee(assignee || assignees[0]?.email || ""); setError(""); change(); setOpen(true);
  }
  useEffect(() => {
    if (!open || result || !people.length) return;
    let active = true; const controller = new AbortController(); setPreview(null);
    requestJson<Preview>("/api/assignments/preview", { method: "POST", headers: { "content-type": "application/json" }, body: requestText, signal: controller.signal })
      .then(data => { if (active) { setPreview(data); setError(""); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "Couldn't load the preview"); });
    return () => { active = false; controller.abort(); };
  // The serialized selection includes every input that changes allocation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, result, requestText, retry]);
  async function submit() {
    if (!preview || busy) return; setBusy(true); setError("");
    try {
      const data = await requestJson<AssignSummary>("/api/assignments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...request, note: note.trim() || undefined, intentKey, previewHash: preview.previewHash }) });
      setResult(data); notify(`Assigned ${data.assigned} ${label}(s).`); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't assign this work. Try again."); setPreview(null); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="btn-assign" onClick={openModal} disabled={!total || !assignees.length || pending} title={!assignees.length ? "No active users — add them under Team" : `Assign ${selection.count} ${label}(s)`}><IconUsers size={15} />Assign</button>
    {open && <Dialog className="assignment-dialog" title={<><IconUsers size={16} />Assign {label}s</>} onClose={() => setOpen(false)} busy={busy}>
      {result ? <>
        <div className="modal-body"><p className="assign-done">Assigned <strong>{result.assigned.toLocaleString()}</strong> {label}(s){Object.keys(result.perCaller).length === 1 && <> to <strong>{Object.keys(result.perCaller)[0]}</strong></>}.</p>
          <ul className="assign-summary">
            {Object.entries(result.perCaller).map(([email, n]) => <li key={email}>{email}: {n} new tasks</li>)}
            {result.reassigned > 0 && <li>{result.reassigned} taken from a previous owner</li>}
            {result.skippedOwned > 0 && <li>{result.skippedOwned} skipped — a linked phone already has a caller</li>}
            {result.duplicateContacts > 0 && <li>{result.duplicateContacts} duplicate calling targets grouped by phone. Source listings are preserved.</li>}
            {result.skippedNoPhone > 0 && <li>{result.skippedNoPhone} left out — no phone number to call</li>}
            {result.capped && <li>Assignment limit reached. Narrow the filters for remaining work.</li>}
          </ul></div>
        <div className="modal-foot"><a href={`/dashboard/batches/manual/${result.batchId}`}>View this assignment batch</a><span className="spacer" /><button type="button" className="btn-primary" onClick={() => setOpen(false)}>Done</button></div>
      </> : <>
        <div className="modal-body"><fieldset disabled={busy} className="plain-fieldset">
          <div className="assign-scope">
            <label className={scope === "selected" ? "active" : undefined}><input type="radio" name="assign-scope" checked={scope === "selected"} disabled={!selIds.length} onChange={() => { change(); setScope("selected"); selection.setAllMatching(false); }} />{selIds.length} selected on this page</label>
            <label className={scope === "all" ? "active" : undefined}><input type="radio" name="assign-scope" checked={scope === "all"} onChange={() => { change(); setScope("all"); selection.setAllMatching(true); }} />All {total.toLocaleString()} matching the current filters</label>
          </div>

          {roundRobin ? <fieldset><legend>Callers — distributes new tasks evenly</legend>{assignees.map(person => {
            const w = preview?.workloads.find(w => w.email === person.email);
            return <label className="assign-check" key={person.email}><input type="checkbox" checked={callers.includes(person.email)} onChange={e => { change(); setCallers(e.target.checked ? [...callers, person.email] : callers.filter(email => email !== person.email)); }} />{person.name || person.email}{w && ` · ${w.open} open · ${w.done_today} done today`}</label>;
          })}</fieldset> : <label className="assign-field"><span>Assign to</span><select value={assignee} onChange={e => { change(); setAssignee(e.target.value); }}><option value="">Choose someone…</option>{assignees.map(person => { const w = preview?.workloads.find(w => w.email === person.email); return <option key={person.email} value={person.email}>{person.name ? `${person.name} — ${person.email}` : person.email}{w ? ` · ${w.open} open · ${w.done_today} done today` : ""}</option>; })}</select></label>}
          <label className="assign-field"><span>Note (optional)</span><input value={note} onChange={e => { setNote(e.target.value); setIntentKey(crypto.randomUUID()); }} placeholder="e.g. verify area + rent before adding to DB" /></label>
          <details className="assignment-options"><summary>Assignment options</summary><label className="assign-distribution"><input type="checkbox" checked={roundRobin} onChange={e => { change(); setRoundRobin(e.target.checked); if (!callers.length) setCallers([assignee].filter(Boolean)); }} />Round-robin across selected callers</label><label className="assign-check"><input type="checkbox" checked={reassign} onChange={e => { change(); setReassign(e.target.checked); }} />Reassign rows already owned by someone else</label></details>
        </fieldset>
          {!preview && !error && people.length > 0 && <p role="status">Checking ownership and caller workloads…</p>}
          {preview && <section aria-label="Assignment preview" className="assignment-preview">
            <div className="allocation-summary"><strong>{preview.eligible} eligible</strong> of {preview.requested} rows</div>
            <div className="allocation-impact">{preview.owned > 0 && <span>{preview.owned} kept with current owners</span>}{preview.duplicateContacts > 0 && <span>{preview.duplicateContacts} duplicate targets</span>}{preview.missingPhone > 0 && <span>{preview.missingPhone} missing valid phone</span>}</div>
            {Object.entries(preview.perCaller).map(([email, n]) => <p className="allocation-recipient" key={email}>New work for {email}: <strong>{n}</strong></p>)}
            {preview.capped && <p role="status">Preview limited to 20,000 rows. Narrow your filters.</p>}
            <details className="allocation-inspection"><summary>Inspect selected records and planned actions</summary>
              <details className="evidence-details allocation-audit"><summary>AI and ownership breakdown</summary>
            <p>{preview.uniquePhones} unique phones · {preview.validPhones} rows with valid phones</p>
            <p>{preview.owned} kept with current owners · {preview.duplicateContacts} duplicate targets · {preview.missingPhone} missing valid phone</p>
            <p>{preview.completedHistory} with completed history. AI history: {Object.entries(preview.aiResults).map(([result, n]) => `${result}: ${n}`).join("; ") || "none"}. These sets can overlap.</p>
            <p>AI connection status: {Object.entries(preview.aiStatuses).map(([status,n])=>`${status}: ${n}`).join("; ")||"No execution records"}. Counts refer to selected rows with execution history, not confirmed dials.</p>
            {Object.entries(preview.ownerCounts).map(([email, n]) => <p key={email}>Currently owned by {email}: {n} selected rows</p>)}
            {Object.entries(preview.completedOwners).map(([email,n]) => <p key={`completed-${email}`}>Completed episodes by {email}: {n}</p>)}
              </details>
              <AllocationRecords items={preview.items.slice(previewPage * 50, previewPage * 50 + 50)} />
              <div className="allocation-pagination">              <button type="button" disabled={previewPage === 0} onClick={() => setPreviewPage(p => p - 1)}>Previous records</button><span> Page {previewPage + 1} of {Math.max(1, Math.ceil(preview.items.length / 50))} </span><button type="button" disabled={(previewPage + 1) * 50 >= preview.items.length} onClick={() => setPreviewPage(p => p + 1)}>Next records</button></div>
            </details>
          </section>}
          {error && <p className="assign-error" role="alert">{error} <button type="button" disabled={busy} onClick={() => setRetry(n => n + 1)}>Refresh preview</button></p>}</div>
        <div className="modal-foot"><span className="muted">{count.toLocaleString()} {label}(s)</span><span className="spacer" /><button type="button" className="btn-text" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn-primary" disabled={busy || !preview || !preview.eligible || !count || !people.length} onClick={submit}>{busy ? "Assigning…" : `Assign ${preview?.eligible ?? count}`}</button></div>
      </>}
    </Dialog>}
  </>;
}
