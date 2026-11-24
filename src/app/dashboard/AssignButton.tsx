"use client";
import { useEffect, useRef, useState } from "react";
import type { AllocationPreview, AssignSummary } from "@/lib/assignment-allocation";
import type { AssigneeWorkload } from "@/lib/users";
import { IconUsers } from "./icons";
import { Dialog } from "./Dialog";
import { useSelection } from "./Selection";
import { useDashboardUI } from "./DashboardUI";
import { requestJson } from "./requests";
import { AllocationRecords } from "./AllocationRecords";
import { CallerPicker } from "./CallerPicker";
import { PreviousAiCalls } from "./PreviousAiCalls";
import type { CallCat, CalledCat } from "@/lib/queue";
export type Assignee = { email: string; name: string | null };
type Preview = AllocationPreview & { workloads: AssigneeWorkload[]; page:number;pages:number;itemTotal:number };
export function AssignButton({ entity, total, assignees }: { entity: "record" | "call"; total: number; assignees: Assignee[] }) {
  const selection = useSelection(), { pending, refresh, notify } = useDashboardUI();
  const [open, setOpen] = useState(false), [selIds, setSelIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<Record<string, string | string[]>>({});
  const [scope, setScope] = useState<"selected" | "all">("all"), [assignee, setAssignee] = useState("");
  const [split, setSplit] = useState(false), [callers, setCallers] = useState<string[]>([]);
  const [workloads, setWorkloads] = useState<AssigneeWorkload[]>([]);
  const [note, setNote] = useState(""), [reassign, setReassign] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [preview, setPreview] = useState<Preview | null>(null), [previewPage, setPreviewPage] = useState(0);
  const [result, setResult] = useState<AssignSummary | null>(null), [intentKey, setIntentKey] = useState("");
  const [retry, setRetry] = useState(0);
  const [previewLoading,setPreviewLoading]=useState(false);
  const previewCache=useRef(new Map<string,{data:Preview;at:number}>());
  const [offCats, setOffCats] = useState<Set<CallCat>>(new Set());
  const [aiHistory, setAiHistory] = useState<Pick<Preview, "aiCalled" | "aiCategories"> | null>(null);
  const count = scope === "selected" ? selIds.length : total, label = entity === "record" ? "record" : "call";
  const people = split ? callers : [assignee].filter(Boolean);
  const enoughCallers = people.length >= (split ? 2 : 1);
  const splitLabel = preview ? `Split ${preview.eligible.toLocaleString()} ${preview.eligible === 1 ? "call" : "calls"} across ${people.length} callers` : "Split calls";
  const request = { entity_type: entity, ...(split ? { assignees: callers } : { assignee }), reassign, excludeCats: [...offCats] as CalledCat[], ...(scope === "selected" ? { ids: selIds } : { filters }) };
  const requestText = JSON.stringify(request);
  function change() { previewCache.current.clear();setIntentKey(crypto.randomUUID()); setResult(null); setPreview(null); setPreviewPage(0); setError(""); }
  function openModal() {
    const params = new URLSearchParams(location.search), f: Record<string, string | string[]> = {};
    for (const key of new Set(params.keys())) if (key !== "page") { const values = params.getAll(key); f[key] = values.length === 1 ? values[0] : values; }
    setFilters(f); setSelIds(selection.ids); setScope(!selection.allMatching && selection.ids.length ? "selected" : "all");
    setAssignee(assignee || assignees[0]?.email || ""); setOffCats(new Set()); setAiHistory(null); setError(""); change(); setOpen(true);
  }
  useEffect(() => {
    if (!open || result || !people.length) return;
    let active = true; const controller = new AbortController();
    const key=`${requestText}:${previewPage}`,cached=previewCache.current.get(key);
    const accept=(data:Preview)=>{setPreview(data);setAiHistory(data);setWorkloads(data.workloads);setError('');setPreviewLoading(false);};
    if(cached&&Date.now()-cached.at<15_000){accept(cached.data);return;}
    setPreviewLoading(true);
    // Coalesce rapid caller/exclusion changes before starting another DB plan.
    const timer=setTimeout(()=>{
      requestJson<Preview>(`/api/assignments/preview?page=${previewPage+1}`, { method: "POST", headers: { "content-type": "application/json" }, body: requestText, signal: controller.signal })
        .then(data => { if (active) {
          for(const [key,value] of previewCache.current)if(value.data.previewHash!==data.previewHash)previewCache.current.delete(key);
          previewCache.current.set(key,{data,at:Date.now()});
          while(previewCache.current.size>3)previewCache.current.delete(previewCache.current.keys().next().value!);
          accept(data);
        } })
        .catch(e => { if (active) {setPreview(null);setPreviewLoading(false);setError(e instanceof Error ? e.message : "Couldn't load the preview");} });
    },150);
    return () => { active = false; clearTimeout(timer);controller.abort(); };
  // The serialized selection includes every input that changes allocation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, result, requestText, previewPage, retry]);
  async function submit() {
    if (!preview || previewLoading || busy || !enoughCallers || !preview.eligible) return; setBusy(true); setError("");
    try {
      const data = await requestJson<AssignSummary>("/api/assignments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...request, note: note.trim() || undefined, intentKey, previewHash: preview.previewHash }) });
      setResult(data); notify(`Assigned ${data.assigned} ${label}(s).`); refresh();
    } catch (e) { previewCache.current.clear();setError(e instanceof Error ? e.message : "Couldn't assign this work. Try again."); setPreview(null); }
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
            {result.skippedWarehouse > 0 && <li>{result.skippedWarehouse} skipped — numbers with warehouses already added to DB</li>}
            {result.skippedAi > 0 && <li>{result.skippedAi} excluded by AI history</li>}
            {result.duplicateContacts > 0 && <li>{result.duplicateContacts} duplicate calling targets grouped by phone. Source listings are preserved.</li>}
            {result.skippedNoPhone > 0 && <li>{result.skippedNoPhone} left out — no phone number to call</li>}
            {result.capped && <li>Assignment limit reached. Narrow the filters for remaining work.</li>}
          </ul></div>
        <div className="modal-foot"><a href={`/dashboard/batches/manual/${result.batchId}`}>View this assignment batch</a><span className="spacer" /><button type="button" className="btn-primary" onClick={() => setOpen(false)}>Done</button></div>
      </> : <>
        <div className="modal-body"><fieldset disabled={busy} className="plain-fieldset">
          <div className="assign-scope">
            <label className={scope === "selected" ? "active" : undefined}><input type="radio" name="assign-scope" checked={scope === "selected"} disabled={!selIds.length} onChange={() => { change(); setAiHistory(null); setScope("selected"); selection.setAllMatching(false); }} />{selIds.length} selected on this page</label>
            <label className={scope === "all" ? "active" : undefined}><input type="radio" name="assign-scope" checked={scope === "all"} onChange={() => { change(); setAiHistory(null); setScope("all"); selection.setAllMatching(true); }} />All {total.toLocaleString()} matching the current filters</label>
          </div>
          {aiHistory && <PreviousAiCalls counts={aiHistory.aiCategories} total={aiHistory.aiCalled} included={preview?.aiIncluded}
            unit="records" excluded={offCats} disabled={busy || !preview} onChange={categories => { change(); setOffCats(categories); }} />}
          {!preview && !error && people.length > 0 && <p role="status">Checking ownership and caller workloads…</p>}
          {preview && <section aria-label="Assignment preview" className="assignment-preview">
            {split && enoughCallers && <h3 className="allocation-split-title">{splitLabel}</h3>}
            <div className="allocation-summary"><strong>{preview.eligible} eligible</strong> of {preview.requested} rows</div>
            <ul className="allocation-notes" aria-label="Assignment summary">
              {preview.warehouseExists > 0 && <li><span className="warn" role="status"><strong>Numbers with warehouses already added to DB: {preview.warehouseNumbers}.</strong> {preview.warehouseExists} selected {preview.warehouseExists===1?'row':'rows'} excluded from assignment.<span className="allocation-note">Warehouse IDs are shown in the record preview.</span></span></li>}
              {preview.owned > 0 && <li><strong>{preview.owned} already assigned to callers</strong> — kept with current owners.</li>}
              {preview.excludedAi > 0 && <li><strong>{preview.excludedAi} excluded by AI history.</strong></li>}
              {preview.duplicateContacts > 0 && <li>{preview.duplicateContacts} duplicate {preview.duplicateContacts === 1 ? 'target' : 'targets'}</li>}
              {preview.missingPhone > 0 && <li>{preview.missingPhone} missing valid phone</li>}
              {!split && Object.entries(preview.perCaller).map(([email, n]) => <li className="allocation-recipient" key={email}>New work for {email}: <strong>{n}</strong></li>)}
              {preview.capped && <li><span role="status">Preview limited to 20,000 rows. Narrow your filters.</span></li>}
            </ul>
          </section>}
          {assignees.length > 1 && <fieldset className="assignment-mode"><legend>How should these calls be assigned?</legend><div>
            <label><input type="radio" name="assignment-mode" checked={!split} onChange={() => { change(); setSplit(false); }} />One caller</label>
            <label><input type="radio" name="assignment-mode" checked={split} onChange={() => { change(); setSplit(true); if (!callers.length) setCallers([assignee].filter(Boolean)); }} />Split across callers</label>
          </div></fieldset>}
          {split ? <CallerPicker people={assignees} selected={callers} workloads={workloads} allocation={preview?.perCaller}
            onChange={next => { change(); setCallers(next); }} />
            : <label className="assign-field"><span>Assign to</span><select value={assignee} onChange={e => { change(); setAssignee(e.target.value); }}><option value="">Choose someone…</option>{assignees.map(person => { const w = workloads.find(w => w.email === person.email); return <option key={person.email} value={person.email}>{person.name ? `${person.name} — ${person.email}` : person.email}{w ? ` · ${w.open} open · ${w.done_today} done today` : ""}</option>; })}</select></label>}
          <label className="assign-field"><span>Note (optional)</span><input value={note} onChange={e => { setNote(e.target.value); setIntentKey(crypto.randomUUID()); }} placeholder="e.g. verify area + rent before adding to DB" /></label>
          <details className="assignment-options"><summary>Assignment options</summary><label className="assign-check"><input type="checkbox" checked={reassign} onChange={e => { change(); setReassign(e.target.checked); }} />Reassign rows already owned by someone else</label></details>
        </fieldset>
          {preview && <details className="allocation-inspection"><summary>Inspect selected records and planned actions</summary>
              <details className="evidence-details allocation-audit"><summary>AI and ownership breakdown</summary>
            <p>{preview.uniquePhones} unique phones · {preview.validPhones} rows with valid phones</p>
            <p>{preview.owned} kept with current owners · {preview.duplicateContacts} duplicate targets · {preview.missingPhone} missing valid phone</p>
            <p>{preview.completedHistory} with completed history. AI history: {Object.entries(preview.aiResults).map(([result, n]) => `${result}: ${n}`).join("; ") || "none"}. These sets can overlap.</p>
            <p>AI connection status: {Object.entries(preview.aiStatuses).map(([status,n])=>`${status}: ${n}`).join("; ")||"No execution records"}. Counts refer to selected rows with execution history, not confirmed dials.</p>
            {Object.entries(preview.ownerCounts).map(([email, n]) => <p key={email}>Currently owned by {email}: {n} selected rows</p>)}
            {Object.entries(preview.completedOwners).map(([email,n]) => <p key={`completed-${email}`}>Completed episodes by {email}: {n}</p>)}
              </details>
              <AllocationRecords items={preview.items} />
              <div className="allocation-pagination">              <button type="button" disabled={previewLoading || preview.page <= 1} onClick={() => setPreviewPage(preview.page - 2)}>Previous records</button><span> Page {preview.page} of {preview.pages} {previewLoading && <span role="status">Loading records…</span>} </span><button type="button" disabled={previewLoading || preview.page >= preview.pages} onClick={() => setPreviewPage(preview.page)}>Next records</button></div>
            </details>}
          {error && <p className="assign-error" role="alert">{error} <button type="button" disabled={busy} onClick={() => {previewCache.current.clear();setRetry(n => n + 1);}}>Refresh preview</button></p>}</div>
        <div className="modal-foot"><span className="muted">{count.toLocaleString()} {label}(s)</span><span className="spacer" /><button type="button" className="btn-text" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn-primary" disabled={busy || previewLoading || !preview || !preview.eligible || !count || !enoughCallers} onClick={submit}>{busy ? "Assigning…" : split ? enoughCallers ? splitLabel : "Split calls" : `Assign ${preview?.eligible ?? count}`}</button></div>
      </>}
    </Dialog>}
  </>;
}
