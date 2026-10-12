"use client";
import { useEffect, useRef, useState } from "react";
import { CONNECTED_DISPOSITIONS, DISPOSITION_LABELS, DISPOSITIONS, RETRY_DISPOSITIONS, type Disposition } from "@/lib/manual-dispositions";
import type { ManualAttempt, ManualAttemptInput } from "@/lib/manual-attempts";
import { dateTime } from "@/lib/display";
import { Dialog } from "./Dialog";
import { requestJson, RequestError } from "./requests";
import { useDashboardUI } from "./DashboardUI";

const localIST = (date: Date) => date.toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }).replace(" ", "T").slice(0, 16);
type Props = {
  assignmentId: string; revision: number; intent: "log" | "complete"; onClose: () => void;
  onRecorded: (minimumRevision: number) => void;
  existingOutcome: string; existingWhId: string; existingRemarks: string; existingAddedToDb: boolean;
  lastDisposition?: string | null;
};

export function ManualAttemptDialog({ assignmentId, revision, intent, onClose, onRecorded, existingOutcome, existingWhId, existingRemarks, existingAddedToDb, lastDisposition }: Props) {
  const { refresh, notify } = useDashboardUI();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [errorField,setErrorField] = useState<string|undefined>();
  const [id, setId] = useState(() => crypto.randomUUID()), [at, setAt] = useState(() => localIST(new Date()));
  const [due, setDue] = useState(""), [duration, setDuration] = useState("");
  // Completion assistance asks what actually happened; it never invents a call.
  const [disposition, setDisposition] = useState<Disposition | "">(intent === "complete" ? "" : "connected");
  const [outcome, setOutcome] = useState(""), [notes, setNotes] = useState("");
  const [correcting, setCorrecting] = useState(false), [corrects, setCorrects] = useState("");
  const [complete, setComplete] = useState(intent === "complete");
  const [whId, setWhId] = useState(existingWhId), [closure, setClosure] = useState("");
  const [addedToDb,setAddedToDb] = useState(existingAddedToDb);
  const [explanation, setExplanation] = useState(existingRemarks);
  const [events, setEvents] = useState<ManualAttempt[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true), [historyError, setHistoryError] = useState(""), [historyRetry, setHistoryRetry] = useState(0);
  const [dirty, setDirty] = useState(false), [discarding, setDiscarding] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const retry = RETRY_DISPOSITIONS.includes(disposition);
  const conversation = CONNECTED_DISPOSITIONS.includes(disposition);
  const finishing = complete && !!disposition && !retry && !correcting;
  const keptOutcome = correcting ? events.find(event => event.id === corrects)?.outcome : existingOutcome;
  const effectiveOutcome = outcome || existingOutcome;
  const needsExplanation = finishing && (effectiveOutcome === "Unclear" || disposition === "invalid_number");

  useEffect(()=>{
    // The failed request's fieldset must be enabled before focus can move.
    const name=errorField==='remarks'?'completion_notes':errorField==='manual_attempt'?'disposition':errorField;
    if(!busy&&error&&name)form.current?.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();
  },[busy,error,errorField]);

  useEffect(() => {
    const controller = new AbortController(); setHistoryLoading(true); setHistoryError("");
    requestJson<{ rows: ManualAttempt[] }>(`/api/assignments/${assignmentId}/attempts`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setEvents(data.rows); })
      .catch(() => { if (!controller.signal.aborted) setHistoryError("Couldn't load previous calls. You can still log a new call."); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [assignmentId, historyRetry]);

  function changed() { setDirty(true); setId(crypto.randomUUID()); setError(""); }
  function chooseDisposition(value: Disposition | "") {
    changed(); setDisposition(value);
    if (!RETRY_DISPOSITIONS.includes(value)) setDue("");
    if (!CONNECTED_DISPOSITIONS.includes(value)) { setOutcome(""); setDuration(""); }
    // Choosing a retry never silently becomes a completion on a later change.
    if (RETRY_DISPOSITIONS.includes(value)) setComplete(false);
  }
  function correction(key: string) {
    const event = events.find(e => e.id === key); if (!event) return;
    changed(); setCorrects(key); setAt(localIST(new Date(event.occurred_at)));
    setDisposition(event.disposition as Disposition); setOutcome(""); setNotes("");
    setDue(event.next_due_at ? localIST(new Date(event.next_due_at)) : "");
    setDuration(CONNECTED_DISPOSITIONS.includes(event.disposition) && event.duration_seconds !== null ? String(event.duration_seconds) : "");
    setComplete(false);
  }
  function switchMode(value: boolean) {
    setCorrecting(value); setCorrects(""); setNotes(""); setOutcome(""); setDue(""); setDuration("");
    setAt(localIST(new Date())); setDisposition(value || intent === "complete" ? "" : "connected");
    setComplete(false); changed();
  }
  function close() { if (dirty) setDiscarding(true); else onClose(); }
  async function save() {
    if (!disposition || (correcting && !corrects)) return;
    setBusy(true); setError("");
    try {
      const completion: ManualAttemptInput["completion"] = finishing ? {
        ...(effectiveOutcome === "Available" ? { wh_id: whId, added_to_db: addedToDb } : {}),
        ...(needsExplanation ? { remarks: explanation, closure_reason: disposition === "invalid_number" ? "invalid_number_verified" : closure as "resolved" | "escalated" } : {}),
      } : undefined;
      await requestJson(`/api/assignments/${assignmentId}/attempts`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, revision, occurred_at: new Date(`${at}:00+05:30`).toISOString(), disposition,
          ...(conversation && outcome ? { outcome } : {}), notes,
          next_due_at: retry && due ? new Date(`${due}:00+05:30`).toISOString() : null,
          duration_seconds: conversation && duration !== "" ? Number(duration) : null,
          ...(correcting ? { corrects_id: corrects } : {}), ...(completion ? { completion } : {}),
        }),
      });
      onRecorded(revision+1); onClose(); notify(finishing ? "Call saved and task marked done." : correcting ? "Call corrected. The original stays in history." : retry ? "Call saved. Task stays open for follow-up." : "Call saved. Task remains open."); refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save the call");
      setErrorField(cause instanceof RequestError ? cause.field : undefined);
    } finally { setBusy(false); }
  }
  return <Dialog title={correcting ? "Correct a logged call" : intent === "complete" ? "Log the call to finish this task" : "Log manual call"} onClose={close} busy={busy}>
    <form ref={form} className="manual-attempt-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="modal-body">
        {discarding ? <div role="alert"><p>Your call has not been saved.</p><button type="button" className="btn" onClick={() => setDiscarding(false)}>Keep editing</button> <button type="button" className="btn-text" onClick={onClose}>Discard call</button></div> : <>
          {intent === "complete" && !correcting && <p className="call-guidance">{lastDisposition ? `Last logged call: ${DISPOSITION_LABELS[lastDisposition as Disposition] || lastDisposition}.` : "No manual call has been logged yet."} {existingOutcome ? `The saved result is ${existingOutcome}. ` : ""}Record the conversation that confirms the result, or correct the earlier call if it was logged incorrectly. Changing Result or WH ID alone does not record a call.</p>}
          <p className="muted">Log a call you made. All times are in India (IST).</p>
          {historyError && <p role="alert" className="assign-error">{historyError} <button type="button" className="btn-row" disabled={historyLoading || busy} onClick={() => setHistoryRetry(n => n + 1)}>Retry history</button></p>}
          <fieldset className="plain-fieldset" disabled={busy}>
            {correcting ? <>
              <button type="button" className="btn-text" onClick={() => switchMode(false)}>Log a new call instead</button>
              <p className="muted">Use this only to fix a mistake in an existing call. It will not count as another attempt.</p>
              <label className="assign-field"><span>Call to correct</span><select required value={corrects} onChange={event => correction(event.target.value)}><option value="">Choose a previous call…</option>{events.map(event => <option key={event.id} value={event.id}>{dateTime(event.occurred_at)} · {DISPOSITION_LABELS[event.disposition as Disposition]}</option>)}</select></label>
            </> : !!events.length && <button type="button" className="btn-text" onClick={() => switchMode(true)}>Correct an earlier call</button>}
            {(!correcting || corrects) && <>
              <label className="assign-field"><span>What happened?</span><select name="disposition" required value={disposition} onChange={event => chooseDisposition(event.target.value as Disposition)}><option value="">Choose what happened…</option>{DISPOSITIONS.map(value => <option key={value} value={value}>{DISPOSITION_LABELS[value]}</option>)}</select></label>
              <label className="assign-field"><span>Attempt time (IST)</span><input type="datetime-local" required value={at} onChange={event => { changed(); setAt(event.target.value); }} /></label>
              {conversation && <label className="assign-field"><span>Manual result</span><select name="outcome" value={outcome} required={finishing && !effectiveOutcome} onChange={event => { changed(); setOutcome(event.target.value); }}><option value="">{keptOutcome ? `Keep ${correcting ? "recorded" : "saved"} result — ${keptOutcome}` : "No new result"}</option>{["Available", "Unavailable", "Unclear"].map(value => <option key={value}>{value}</option>)}</select></label>}
              {!!disposition && !conversation && <p className="call-guidance">{disposition === "invalid_number" ? "Record how you verified the number. This does not establish warehouse availability." : "No conversation took place. You do not need a warehouse result or conversation duration."} {existingOutcome && `The saved ${existingOutcome} result will stay unchanged.`}</p>}
              {retry && <>
                <p className="call-guidance">This task stays open. {disposition === "callback" || disposition === "awaiting_confirmation" ? "Choose when to follow up." : "Schedule the next call if you know when. Without a date it appears under Due now / needs scheduling."}</p>
                <label className="assign-field"><span>Next follow-up (IST){disposition === "callback" || disposition === "awaiting_confirmation" ? "" : " — optional"}</span><input type="datetime-local" required={disposition === "callback" || disposition === "awaiting_confirmation"} min={at} value={due} onChange={event => { changed(); setDue(event.target.value); }} /></label>
              </>}
              {conversation && <label className="assign-field"><span>Reported duration (seconds, optional)</span><input type="number" min="0" max="86400" step="1" value={duration} onChange={event => { changed(); setDuration(event.target.value); }} /><small>Time spent speaking; leave blank if unknown.</small></label>}
              <label className="assign-field"><span>{correcting ? "Why is this correction needed?" : "Call notes (optional)"}</span><textarea value={notes} required={correcting} minLength={correcting ? 10 : undefined} onChange={event => { changed(); setNotes(event.target.value); }} /></label>
              {!!disposition && !retry && !correcting && <label className="assign-check call-complete"><input type="checkbox" checked={complete} onChange={event => { changed(); setComplete(event.target.checked); }} />Also mark this task done</label>}
              {finishing && effectiveOutcome === "Available" && <label className="assign-field"><span>Warehouse ID</span><input name="wh_id" inputMode="numeric" pattern="[1-9][0-9]*" required value={whId} onChange={event => { changed(); setWhId(event.target.value); }} placeholder="e.g. 12345" /><small>Use the warehouse's positive integer ID.</small></label>}
              {finishing && effectiveOutcome === "Available" && <label className="assign-check"><input type="checkbox" checked={addedToDb} onChange={event=>{changed();setAddedToDb(event.target.checked);}}/>Warehouse has been added to the database</label>}
              {needsExplanation && <>
                {disposition !== "invalid_number" && <label className="assign-field"><span>Why can this Unclear task be closed?</span><select required value={closure} onChange={event => { changed(); setClosure(event.target.value); }}><option value="">Choose a reason…</option><option value="resolved">No further action needed</option><option value="escalated">Escalated to an admin</option></select></label>}
                <label className="assign-field"><span>{disposition === "invalid_number" ? "How did you verify the invalid number?" : "Completion explanation"}</span><textarea name="completion_notes" required minLength={10} value={explanation} onChange={event => { changed(); setExplanation(event.target.value); }} /><small>This will be saved as the task's notes.</small></label>
              </>}
            </>}
          </fieldset>
          {error && <p role="alert" className="assign-error">{error}</p>}
        </>}
      </div>
      {!discarding && <div className="modal-foot"><button type="button" className="btn-text" disabled={busy} onClick={close}>Cancel</button><button type="submit" className="btn-primary" disabled={busy || !disposition || correcting && !corrects}>{busy ? "Saving…" : finishing ? correcting ? "Save correction and mark done" : "Record call and mark done" : correcting ? "Save correction" : retry ? "Record call — keep open" : "Record attempt"}</button></div>}
    </form>
  </Dialog>;
}
