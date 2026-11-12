"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { BoardCard, BoardTask } from "@/lib/board";
import type { TimelineEvent } from "@/lib/board-timeline";
import { JUNK_REASONS, REJECTION_REASONS, STAGES, STRIKE_LIMIT, stageInfo, type Stage } from "@/lib/board-stages";
import { dateTime, personName, shortDate } from "@/lib/display";
import { area, rent, resultClass } from "@/lib/employee-display";
import { dispositionLabel } from "@/lib/manual-dispositions";
import { useDashboardUI } from "../DashboardUI";
import { requestJson, RequestError } from "../requests";
import { followUpAt, istDay, requestMove, sendJson as send, taskRefs as refsOf, type InputStage } from "./board-requests";
import { CopyText } from "../CopyText";
import { RecordDetails } from "../RecordDetails";
import { RecordDetails as EmployeeRecordDetails } from "../my/classic/RecordDetails";
import { SavedAiSummary } from "./SavedAiSummary";
import { AiCallStatus } from "../my/AiCallStatus";
import { AiTimeline } from "../AiTimeline";
import { ManualCallTimeline } from "../ManualCallTimeline";
import type { ManualCallHistory } from "@/lib/manual-attempts";
import { IconX } from "../icons";
import type { ConfirmBoardEntry } from "./BoardEntryConfirmation";

// The panel reads top-down: who the lead is, the next step, the selected task
// (its notes, details and calls), then the card's activity.

// The date picker chooses a day; follow-ups are due at 10:00 IST that day.
/** A short IST date and time for lists; the full timestamp stays in the tooltip. */
const when = (value: string) => new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
/** A person's name, or their account handle rather than a full email address. */
const who = (name: string | null | undefined, email: string | null) => email?.includes("@") ? personName(name, email) : name || email || "Unknown";

const KIND: Record<BoardTask["entity"], { title: string; noun: string }> = {
  record: { title: "Listing", noun: "listing" }, call: { title: "AI follow-up", noun: "AI follow-up" },
};
// The same area wording as My Work: carpet, then built-up, then the listing's own area.
const areaText = (task: BoardTask) => task.carpetArea ? `${area(task.carpetArea)} carpet`
  : task.builtUpArea ? `${area(task.builtUpArea)} built-up` : area(task.listingArea);
/** The lead's size: the first task, listings first, with a recorded area. */
const sizeOf = (tasks: BoardTask[]) => tasks.map(areaText).find(value => value !== "—") ?? null;
// Listings first, then AI follow-ups, each oldest first.
const taskOrder = (tasks: BoardTask[]) => [...tasks].sort((a, b) => (a.entity === b.entity ? 0 : a.entity === "record" ? -1 : 1) || Number(a.id) - Number(b.id));

/** `request` opens the panel at a stage's input step, e.g. after a card is dropped on Junk. */
export function BoardPanel({ card, onClose, request, showCalls, employee, readOnly, confirmEntry }: {
  card: BoardCard; onClose: () => void; request?: { stage: InputStage; token: number } | null;
  /** Manual and Callyzer call records are for admins only. */
  showCalls: boolean;
  employee?: string;
  readOnly: boolean;
  confirmEntry: ConfirmBoardEntry;
}) {
  const { refresh, pending, hasDrafts, notify } = useDashboardUI();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // The stage chosen in the dropdown; a move happens only when it is confirmed.
  const [target, setTarget] = useState<Stage>(request?.stage ?? card.stage);
  // After a confirmed move, until the refreshed card arrives with its new stage.
  const [moved, setMoved] = useState<Stage | null>(null);
  const [saving, setSaving] = useState(false);
  // Locked while a write is in flight and until the refreshed card arrives, so the
  // next action never sends a revision the server has already moved past.
  const busy = saving || pending;
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const tasks = taskOrder(card.tasks);
  const [selected, setSelected] = useState(tasks[0].id);
  const task = tasks.find(candidate => candidate.id === selected) ?? tasks[0];
  const openTasks = tasks.filter(candidate => candidate.state === "open");
  const current = moved ?? card.stage;
  const stage = stageInfo(card.stage);
  const version = card.tasks.map(candidate => `${candidate.id}:${candidate.revision}`).join(",");

  // Opening another card starts fresh: focus its name and show its first task.
  // Keyed on the card alone, so a refresh of the same card keeps the chosen task.
  useEffect(() => { heading.current?.focus(); setError(""); setNote(""); setSelected(taskOrder(card.tasks)[0].id); }, [card.key]);
  useEffect(() => { setTarget(request?.stage ?? card.stage); setMoved(null); }, [card.key, card.stage, request?.token, request?.stage]);

  async function run(action: () => Promise<unknown>) {
    if (readOnly) return;
    if (hasDrafts()) { notify("Save or discard the notes before changing this lead."); return; }
    if (!(await confirmEntry(card))) return;
    setSaving(true); setError(""); setNote("");
    try { await action(); refresh(); }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't save the change. Try again.");
      // A conflict means newer data exists; reload it so the next attempt uses it.
      if (failure instanceof RequestError && failure.code === "ASSIGNMENT_CONFLICT") refresh();
    } finally { setSaving(false); }
  }
  /** Notes save through the same lock; the field reports its own outcome. */
  async function saveNotes(target: BoardTask, remarks: string) {
    if (readOnly || !(await confirmEntry(card))) return false;
    setSaving(true);
    try { await send(`/api/board/tasks/${target.id}`, "PATCH", { revision: target.revision, remarks }, employee); return true; }
    finally { setSaving(false); }
  }
  const move = (to: Stage, extra: { reason?: string | null; wh_id?: string | null } = {}) =>
    run(async () => { await requestMove(card, to, extra, employee); setMoved(to); });
  const logNoAnswer = () => run(async () => {
    const result = await send("/api/board/no-answer", "POST", { tasks: refsOf(card.tasks) }, employee) as { logged: number; strikes: number };
    setNote(result.logged ? `Logged. ${result.strikes} of ${STRIKE_LIMIT} strikes.` : "Already counted today. Strikes count days, not calls.");
  });

  return <aside id="board-panel" className="board-panel" aria-labelledby={titleId} aria-busy={busy}
    onKeyDown={event => { if (event.key !== "Escape") return; event.stopPropagation(); if (target !== current) setTarget(current); else onClose(); }}>
    <header className="board-panel-head">
      <div className="board-panel-identity">
        <h2 id={titleId} ref={heading} tabIndex={-1}>{card.name?.trim() || "Unnamed owner"}</h2>
        <div className="board-panel-phone">{card.phone ? <CopyText value={card.phone} label="phone number" /> : <span className="muted">No phone number</span>}</div>
        <dl className="board-keyfacts">
          <KeyFact label="City" value={card.city} />
          <KeyFact label="State" value={card.region} />
          <KeyFact label="Size" value={sizeOf(tasks)} />
        </dl>
        <p className="board-panel-status">
          <span className="board-code" data-stage={card.stage}>{stage.code}</span> {stage.label}
          {card.closed && <span> · Closed</span>}
          {card.strikes > 0 && <span> · {card.strikes} of {STRIKE_LIMIT} strikes</span>}
          {card.nextDueAt && !card.closed && <span className={card.overdue ? "board-status-overdue" : undefined}> · {card.overdue ? "Overdue since" : "Follow up"} {shortDate(card.nextDueAt)}</span>}
        </p>
      </div>
      <button type="button" className="board-panel-close" aria-label="Close lead" title="Close" onClick={onClose}><IconX size={18} /></button>
    </header>

    <div className="board-panel-body">
      {!readOnly && <Section title="Next step" id={`${titleId}-next`}>
        <div className="board-steps">
          {/* Choosing a stage never moves the card by itself: arrow keys change a closed
              select, so the move waits for an explicit confirmation. */}
          <label className="board-step-label" htmlFor={`${titleId}-stage`}>Stage</label>
          <div className="board-step board-stage-picker" data-stage={target}>
            <select id={`${titleId}-stage`} aria-label="Stage" value={target} disabled={busy} onChange={event => { setTarget(event.target.value as Stage); setError(""); }}>
              {STAGES.map(option => <option key={option.slug} value={option.slug}>{option.code} {option.label}</option>)}
            </select>
            {target !== current && <MoveForm key={target} stage={target} card={card} busy={busy} onCancel={() => setTarget(current)} onMove={extra => move(target, extra)} />}
          </div>
          {openTasks.length > 0 && <FollowUp key={`${card.key}:${version}`} id={`${titleId}-follow-up`} card={card} busy={busy}
            onSave={day => run(() => send("/api/board/follow-up", "POST", { tasks: refsOf(openTasks), next_due_at: day ? followUpAt(day) : null }, employee))} />}
          {openTasks.length > 0 && <>
            <span className="board-step-label">Call</span>
            <div className="board-step board-step-inline">
              <button type="button" className="btn-row" disabled={busy} onClick={logNoAnswer}>Log a no-answer call</button>
              <p className="board-panel-note" role="status">{note}</p>
            </div>
          </>}
        </div>
        {error && <p className="board-panel-error" role="alert">{error}</p>}
      </Section>}

      {tasks.length > 1 && <TaskTabs tasks={tasks} selected={task.id} onSelect={id => {
        if (hasDrafts()) { notify("Save or discard the notes before changing tasks."); return; }
        setSelected(id);
      }} idPrefix={titleId} />}
      <div className="board-task" key={task.id} {...(tasks.length > 1 ? { role: "tabpanel", id: `${titleId}-task`, "aria-labelledby": `${titleId}-tab-${task.id}` } : {})}>
        <TaskDetails task={task} idPrefix={`${titleId}-${task.id}`} busy={busy} onSaveNotes={remarks => saveNotes(task, remarks)} showCalls={showCalls} employee={employee} readOnly={readOnly} />
      </div>

      <Timeline taskIds={card.tasks.map(candidate => candidate.id)} version={version} labelledBy={`${titleId}-activity`} employee={employee} />
    </div>
  </aside>;
}

/** City, state and size: the facts a caller needs before dialling, labelled and prominent. */
function KeyFact({ label, value }: { label: string; value: string | null }) {
  return <div><dt>{label}</dt><dd>{value?.trim() || <span className="board-keyfact-missing">Not recorded</span>}</dd></div>;
}

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return <section className="board-panel-section" aria-labelledby={id}><h3 id={id}>{title}</h3>{children}</section>;
}

/** Tasks that share the card's phone, one at a time. Arrow keys move between tabs. */
function TaskTabs({ tasks, selected, onSelect, idPrefix }: { tasks: BoardTask[]; selected: string; onSelect: (id: string) => void; idPrefix: string }) {
  // Numbered within their kind: Listing, AI follow-up 1, AI follow-up 2.
  const titles = tasks.map(task => {
    const same = tasks.filter(other => other.entity === task.entity);
    return KIND[task.entity].title + (same.length > 1 ? ` ${same.indexOf(task) + 1}` : "");
  });
  return <div className="board-task-tabs" role="tablist" aria-label="Tasks on this number">{tasks.map((task, index) =>
    <button key={task.id} type="button" role="tab" id={`${idPrefix}-tab-${task.id}`} aria-controls={`${idPrefix}-task`} aria-selected={task.id === selected}
      tabIndex={task.id === selected ? 0 : -1} onClick={() => onSelect(task.id)} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % tasks.length : event.key === "ArrowLeft" ? (index + tasks.length - 1) % tasks.length : null;
        if (next === null) return;
        event.preventDefault(); onSelect(tasks[next].id); document.getElementById(`${idPrefix}-tab-${tasks[next].id}`)?.focus();
      }}>{titles[index]}{task.state === "done" && <span className="board-tab-note"> · Finished</span>}</button>)}
  </div>;
}

/** Everything My Work shows for one task, grouped: instructions, your notes, details, calls. */
function TaskDetails({ task, idPrefix, busy, onSaveNotes, showCalls, employee, readOnly }: {
  task: BoardTask; idPrefix: string; busy: boolean; onSaveNotes: (remarks: string) => Promise<boolean>; showCalls: boolean; employee?: string; readOnly: boolean;
}) {
  const kind = KIND[task.entity];
  const assigner = who(task.assignedByName, task.assignedBy);
  // Admins get the full record; employees get My Work's details view, which has no
  // manual or Callyzer call history.
  const fullRecord = showCalls
    ? <RecordDetails id={task.entityId} entity={task.entity} label="Open full record" className="btn-row" ariaLabel={`Details for this ${kind.noun}`} />
    : <EmployeeRecordDetails id={task.entityId} entity={task.entity} employee={employee} label="Open full record" ariaLabel={`Details for this ${kind.noun}`} />;
  const areaValue = areaText(task), rentValue = rent(task.rent);
  return <>
    {task.note?.trim() && <Brief note={task.note} label={`Note from ${assigner}`} />}
    {readOnly ? <Section title="Employee notes" id={`${idPrefix}-notes`}><p className="detail-text">{task.remarks || "No notes yet"}</p></Section>
      : <Notes task={task} id={`${idPrefix}-notes`} busy={busy} onSave={onSaveNotes} employee={employee} />}
    <Section title={`${kind.title} details`} id={`${idPrefix}-details`}>
      <dl className="board-facts">
        <Fact label="Assigned"><span title={dateTime(task.assignedAt)}>{assigner} · {shortDate(task.assignedAt)}</span></Fact>
        {task.city && <Fact label="City">{task.city}</Fact>}
        {areaValue !== "—" && <Fact label="Area">{areaValue}</Fact>}
        {rentValue !== "—" && <Fact label="Rent">{rentValue}</Fact>}
        <Fact label="Result"><span className={`pill ${task.outcome ? `pill-${resultClass(task.outcome)}` : "pill-none"}`}>{task.outcome || "Not called yet"}</span></Fact>
        <Fact label="In DB?">{task.addedToDb ? "Added" : "Not yet"}</Fact>
        <Fact label="WH ID">{task.whId?.trim() || "—"}</Fact>
        <Fact label="Finished?">{task.state === "done" ? "Done" : "Open"}</Fact>
      </dl>
      <div className="board-section-foot">{fullRecord}</div>
    </Section>
    <Calls task={task} idPrefix={idPrefix} showCalls={showCalls} employee={employee} />
  </>;
}

/**
 * AI and manual call summaries whose full history expands in place, so the caller
 * never leaves the panel. Uses the same timelines as the full record.
 */
function Calls({ task, idPrefix, showCalls, employee }: { task: BoardTask; idPrefix: string; showCalls: boolean; employee?: string }) {
  const [open, setOpen] = useState<{ ai: boolean; manual: boolean }>({ ai: false, manual: false });
  const toggle = (which: "ai" | "manual", label: string) => <button type="button" className="btn-row" aria-expanded={open[which]} aria-controls={`${idPrefix}-${which}-calls`}
    onClick={() => setOpen(current => ({ ...current, [which]: !current[which] }))}>{open[which] ? `Hide ${label}` : `Show ${label}`}</button>;
  return <Section title="Calls" id={`${idPrefix}-calls`}>
    <dl className="board-facts">
      <Fact label="AI calls"><span className="board-fact-row"><AiCallStatus result={task.aiResult} count={task.aiCount} />{task.aiCount > 0 && toggle("ai", "AI calls")}</span></Fact>
      {showCalls && <Fact label="Manual calls"><span className="board-fact-row">
        <span>{task.manualCalls ? <>{task.manualCalls} logged · last: {dispositionLabel(task.disposition)}{task.lastAttemptAt && <>, <time dateTime={task.lastAttemptAt} title={dateTime(task.lastAttemptAt)}>{when(task.lastAttemptAt)}</time></>}</> : "None logged"}</span>
        {toggle("manual", "manual calls")}
      </span></Fact>}
    </dl>
    {open.ai && <div id={`${idPrefix}-ai-calls`} className="board-call-history">
      <AiTimeline entity={task.entity} id={task.entityId} employee={employee} initialOpen><SavedAiSummary entity={task.entity} id={task.entityId} employee={employee} /></AiTimeline>
    </div>}
    {showCalls && open.manual && <div id={`${idPrefix}-manual-calls`} className="board-call-history"><ManualHistory key={task.revision} task={task} /></div>}
  </Section>;
}

/** Logged calls and Callyzer calls for the task, from the same endpoint as the full record. */
function ManualHistory({ task }: { task: BoardTask }) {
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<ManualCallHistory | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    requestJson<{ manual: ManualCallHistory }>(`/api/details/${task.entity}/${encodeURIComponent(task.entityId)}?section=manual&manual_page=${page}`, { signal: controller.signal })
      .then(value => setHistory(value.manual))
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Couldn't load manual calls."); });
    return () => controller.abort();
  }, [task.entity, task.entityId, page]);
  if (error) return <p className="board-panel-error" role="alert">{error}</p>;
  if (!history) return <p className="muted" role="status">Loading manual calls…</p>;
  return <ManualCallTimeline history={history} onPage={setPage} />;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

/** The assigner's instructions, shown before anything else about the task. */
function Brief({ note, label }: { note: string; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const long = note.length > 160 || note.split("\n").length > 3;
  return <div className="board-brief">
    <p className="board-brief-label">{label}</p>
    <p id={id} className={`board-brief-text${long && !expanded ? " clamped" : ""}`}>{note}</p>
    {long && <button type="button" className="btn-text" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "Read full note"}</button>}
  </div>;
}

function Notes({ task, id, busy, onSave, employee }: { task: BoardTask; id: string; busy: boolean; onSave: (remarks: string) => Promise<boolean>; employee?: string }) {
  const { reportSave, refresh } = useDashboardUI();
  const saved = task.remarks ?? "";
  const [notes, setNotes] = useState(saved);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [conflict, setConflict] = useState(false);
  // Take newer server notes only while there is no unsaved local draft.
  const baseline = useRef(saved);
  useEffect(() => {
    if (notes === baseline.current) setNotes(saved);
    baseline.current = saved;
  }, [saved]); // Only a new saved value should replace the field; typing must not.
  const dirty = notes.trim() !== baseline.current;
  const saveId = `board-notes-${task.id}-${employee || "me"}`;
  const actions = useRef({ save: () => {}, discard: () => {} });
  function discard() {
    setNotes(saved); baseline.current = saved; setStatus(""); setFailed(false); setConflict(false);
    reportSave(saveId, null);
    if (conflict) refresh();
  }
  async function save() {
    const value = notes.trim();
    setSaving(true); setStatus(""); setFailed(false);
    try {
      if (!(await onSave(value))) return;
      baseline.current = value; setNotes(value); setStatus("Saved"); setConflict(false);
      reportSave(saveId, null); refresh();
    }
    catch (failure) {
      setFailed(true); setConflict(failure instanceof RequestError && failure.code === "ASSIGNMENT_CONFLICT");
      setStatus(failure instanceof Error ? failure.message : "Couldn't save notes.");
    }
    finally { setSaving(false); }
  }
  actions.current = { save, discard };
  // An employee switch, filter or refresh must not discard an admin's draft.
  useEffect(() => {
    if (!employee) return;
    reportSave(saveId, dirty || saving ? { dirty: true, status: saving ? "saving" : failed ? "error" : "dirty", label: "Employee notes",
      retry: () => actions.current.save(), discard: () => actions.current.discard() } : null);
  }, [employee, saveId, dirty, saving, failed, reportSave]);
  useEffect(() => () => { if (employee) reportSave(saveId, null); }, [employee, saveId, reportSave]);
  return <Section title={employee ? "Employee notes" : "Your notes"} id={id}>
    <textarea aria-labelledby={id} className="board-notes" rows={3} value={notes} disabled={busy || saving} placeholder="What did the owner say?" onChange={event => { setNotes(event.target.value); setStatus(""); setFailed(false); }} />
    <div className="board-move-actions">
      <span role="status" className="board-task-status">{status}</span>
      {employee && (dirty || conflict) && <button type="button" className="btn-text" disabled={busy || saving} onClick={discard}>{conflict ? "Discard draft and reload" : "Discard draft"}</button>}
      <button type="button" className="btn secondary" disabled={busy || saving || !dirty || (!!employee && conflict)} onClick={save}>Save notes</button>
    </div>
  </Section>;
}

function MoveForm({ stage, card, busy, onCancel, onMove }: {
  stage: Stage; card: BoardCard; busy: boolean; onCancel: () => void; onMove: (extra: { reason?: string | null; wh_id?: string | null }) => void;
}) {
  const reasons = stage === "junk" ? JUNK_REASONS : stage === "rejected" ? REJECTION_REASONS : null;
  const [reason, setReason] = useState("");
  const [whId, setWhId] = useState(card.warehouseIds.length === 1 ? card.warehouseIds[0] : "");
  const fieldId = useId();
  const info = stageInfo(stage);
  const ready = stage === "junk" ? !!reason : stage === "warehouse_created" ? !!whId.trim() : true;
  return <form className="board-move-form" onSubmit={event => {
    event.preventDefault();
    if (ready) onMove(stage === "warehouse_created" ? { wh_id: whId.trim() } : { reason: reason || null });
  }}>
    {reasons && <fieldset disabled={busy}>
      <legend>{stage === "junk" ? "Why is this lead junk?" : "Reason (optional)"}</legend>
      {stage === "rejected" && <label><input type="radio" name="reason" value="" checked={!reason} onChange={() => setReason("")} />No reason given</label>}
      {Object.entries(reasons).map(([value, label]) => <label key={value}><input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} />{label}</label>)}
    </fieldset>}
    {stage === "warehouse_created" && <div className="board-field">
      <label htmlFor={fieldId}>Warehouse ID</label>
      <input id={fieldId} type="text" inputMode="numeric" autoComplete="off" value={whId} disabled={busy} onChange={event => setWhId(event.target.value)} aria-describedby={`${fieldId}-hint`} />
      <small id={`${fieldId}-hint`}>{card.warehouseIds.length > 1 ? `This number matches warehouses ${card.warehouseIds.join(", ")}. Enter the one this lead created.` : "The ID of the listing this lead created."}</small>
    </div>}
    <div className="board-move-actions">
      <button type="button" className="btn-text" onClick={onCancel}>Cancel</button>
      <button type="submit" className="btn-primary" disabled={busy || !ready}>Move to {info.short}</button>
    </div>
  </form>;
}

function FollowUp({ id, card, busy, onSave }: { id: string; card: BoardCard; busy: boolean; onSave: (day: string | null) => void }) {
  const [day, setDay] = useState(istDay(card.nextDueAt));
  return <>
    <label className="board-step-label" htmlFor={id}>Next follow-up</label>
    <form className="board-step board-step-inline" onSubmit={event => { event.preventDefault(); onSave(day || null); }}>
      <input id={id} className="board-date" type="date" value={day} disabled={busy} onChange={event => setDay(event.target.value)} />
      <button type="submit" className="btn-row" disabled={busy || day === istDay(card.nextDueAt)} aria-label="Save follow-up">Save</button>
      {card.nextDueAt && <button type="button" className="btn-text" disabled={busy} onClick={() => onSave(null)}>Clear</button>}
    </form>
  </>;
}

function Timeline({ taskIds, version, labelledBy, employee }: { taskIds: string[]; version: string; labelledBy: string; employee?: string }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState("");
  const query = taskIds.map(id => `task=${encodeURIComponent(id)}`).join("&") + (employee ? `&employee=${encodeURIComponent(employee)}` : "");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    requestJson<{ events: TimelineEvent[] }>(`/api/board/timeline?${query}`, { signal: controller.signal })
      .then(result => setEvents(result.events))
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Couldn't load the activity."); });
    return () => controller.abort();
  }, [query, version]);
  return <Section title="Activity" id={labelledBy}>
    <ol className="board-timeline" aria-busy={events === null}>
      {error ? <li className="board-panel-error">{error}</li>
        : events === null ? <li className="muted">Loading activity…</li>
        : events.length === 0 ? <li className="muted">No activity yet</li>
        : events.map((event, index) => <li key={`${event.at}:${event.kind}:${index}`} data-kind={event.kind}>
          <span className="board-timeline-text">{event.text}</span>
          <span className="board-timeline-meta"><time dateTime={event.at} title={dateTime(event.at)}>{when(event.at)}</time> · {who(event.actorName, event.actor)}</span>
        </li>)}
    </ol>
  </Section>;
}
