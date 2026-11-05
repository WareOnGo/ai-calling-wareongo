"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { BoardCard, BoardTask } from "@/lib/board";
import type { TimelineEvent } from "@/lib/board-timeline";
import { JUNK_REASONS, REJECTION_REASONS, STAGES, STRIKE_LIMIT, stageInfo, type Stage } from "@/lib/board-stages";
import { dateTime } from "@/lib/display";
import { area, rent, resultClass } from "@/lib/employee-display";
import { dispositionLabel } from "@/lib/manual-dispositions";
import { useDashboardUI } from "../DashboardUI";
import { requestJson, RequestError } from "../requests";
import { requestMove, sendJson as send, taskRefs as refsOf, type InputStage } from "./board-requests";
import { CopyText } from "../CopyText";
import { RecordDetails } from "../RecordDetails";
import { AiCallStatus } from "../my/AiCallStatus";
import { AssignmentBrief } from "../my/AssignmentBrief";
import { WorkContext } from "../my/WorkContext";
// The date picker chooses a day; follow-ups are due at 10:00 IST that day.
const followUpAt = (day: string) => `${day}T10:00:00+05:30`;
const istDay = (value: string | null) => value ? new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "";

/** `request` opens the panel at a stage's input step, e.g. after a card is dropped on Junk. */
export function BoardPanel({ card, onClose, request }: { card: BoardCard; onClose: () => void; request?: { stage: InputStage; token: number } | null }) {
  const { refresh } = useDashboardUI();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // The stage chosen in the dropdown; a move happens only when it is confirmed.
  const [target, setTarget] = useState<Stage>(request?.stage ?? card.stage);
  // After a confirmed move, until the refreshed card arrives with its new stage.
  const [moved, setMoved] = useState<Stage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const current = moved ?? card.stage;
  const tasks = [...card.tasks].sort((a, b) => (a.entity === b.entity ? 0 : a.entity === "record" ? -1 : 1) || Number(a.id) - Number(b.id));
  const openTasks = tasks.filter(task => task.state === "open");
  const version = card.tasks.map(task => `${task.id}:${task.revision}`).join(",");

  useEffect(() => { heading.current?.focus(); setError(""); setNote(""); }, [card.key]);
  useEffect(() => { setTarget(request?.stage ?? card.stage); setMoved(null); }, [card.key, card.stage, request?.token, request?.stage]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(""); setNote("");
    try { await action(); refresh(); }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't save the change. Try again.");
      // A conflict means newer data exists; reload it so the next attempt uses it.
      if (failure instanceof RequestError && failure.code === "ASSIGNMENT_CONFLICT") refresh();
    } finally { setBusy(false); }
  }
  const move = (stage: Stage, extra: { reason?: string | null; wh_id?: string | null } = {}) =>
    run(async () => { await requestMove(card, stage, extra); setMoved(stage); });

  return <aside id="board-panel" className="board-panel" aria-labelledby={titleId} aria-busy={busy}
    onKeyDown={event => { if (event.key !== "Escape") return; event.stopPropagation(); if (target !== current) setTarget(current); else onClose(); }}>
    <header className="board-panel-head">
      <div className="board-panel-identity">
        <h2 id={titleId} ref={heading} tabIndex={-1}>{card.name?.trim() || "Unnamed owner"}</h2>
        <div className="board-panel-phone">{card.phone ? <CopyText value={card.phone} label="phone number" /> : <span className="muted">No phone number</span>}</div>
        <p className="board-panel-meta">{[card.city, card.region, card.closed ? "Closed" : null,
          card.strikes ? `${card.strikes} of ${STRIKE_LIMIT} strikes` : null].filter(Boolean).join(" · ")}</p>
      </div>
      <button type="button" className="modal-close" aria-label="Close lead" onClick={onClose}>×</button>
    </header>

    <div className="board-panel-body">
      {/* Choosing a stage never moves the card by itself: arrow keys change a closed
          select, so the move waits for an explicit confirmation. */}
      <div className="board-stage-picker" data-stage={target}>
        <label className="board-field"><span>Stage</span>
          <select aria-label="Stage" value={target} disabled={busy} onChange={event => { setTarget(event.target.value as Stage); setError(""); }}>
            {STAGES.map(option => <option key={option.slug} value={option.slug}>{option.code} {option.label}</option>)}
          </select>
        </label>
        {target !== current && <MoveForm key={target} stage={target} card={card} busy={busy} onCancel={() => setTarget(current)} onMove={extra => move(target, extra)} />}
      </div>
      {error && <p className="board-panel-error" role="alert">{error}</p>}
      {openTasks.length > 0 && <div className="board-panel-calls">
        <button type="button" className="btn secondary" disabled={busy} onClick={() => run(async () => {
          const result = await send("/api/board/no-answer", "POST", { tasks: refsOf(card.tasks) }) as { logged: number; strikes: number };
          setNote(result.logged ? `Logged. ${result.strikes} of ${STRIKE_LIMIT} strikes.` : "Already counted today. Strikes count days, not calls.");
        })}>Log a no-answer call</button>
        <p className="board-panel-note" role="status">{note}</p>
      </div>}

      {openTasks.length > 0 && <FollowUp key={`${card.key}:${version}`} card={card} busy={busy}
        onSave={day => run(() => send("/api/board/follow-up", "POST", { tasks: refsOf(openTasks), next_due_at: day ? followUpAt(day) : null }))} />}

      <section className="board-panel-section" aria-labelledby={`${titleId}-tasks`}>
        <h3 id={`${titleId}-tasks`}>Tasks on this number</h3>
        {tasks.map(task => <TaskSection key={task.id} task={task} onSaved={refresh} />)}
      </section>

      <Timeline taskIds={card.tasks.map(task => task.id)} version={version} labelledBy={`${titleId}-timeline`} />
    </div>
  </aside>;
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
    {reasons && <fieldset>
      <legend>{stage === "junk" ? "Why is this lead junk?" : "Reason (optional)"}</legend>
      {stage === "rejected" && <label><input type="radio" name="reason" value="" checked={!reason} onChange={() => setReason("")} />No reason given</label>}
      {Object.entries(reasons).map(([value, label]) => <label key={value}><input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} />{label}</label>)}
    </fieldset>}
    {stage === "warehouse_created" && <div className="board-field">
      <label htmlFor={fieldId}>Warehouse ID</label>
      <input id={fieldId} type="text" inputMode="numeric" autoComplete="off" value={whId} onChange={event => setWhId(event.target.value)} aria-describedby={`${fieldId}-hint`} />
      <small id={`${fieldId}-hint`}>{card.warehouseIds.length > 1 ? `This number matches warehouses ${card.warehouseIds.join(", ")}. Enter the one this lead created.` : "The ID of the listing this lead created."}</small>
    </div>}
    <div className="board-move-actions">
      <button type="button" className="btn-text" onClick={onCancel}>Cancel</button>
      <button type="submit" className="btn-primary" disabled={busy || !ready}>Move to {info.short}</button>
    </div>
  </form>;
}

function FollowUp({ card, busy, onSave }: { card: BoardCard; busy: boolean; onSave: (day: string | null) => void }) {
  const [day, setDay] = useState(istDay(card.nextDueAt));
  return <form className="board-panel-section board-followup-form" onSubmit={event => { event.preventDefault(); onSave(day || null); }}>
    <label className="board-field"><span>Next follow-up</span><input type="date" value={day} onChange={event => setDay(event.target.value)} /></label>
    <div className="board-move-actions">
      {card.nextDueAt && <button type="button" className="btn-text" disabled={busy} onClick={() => onSave(null)}>Clear</button>}
      <button type="submit" className="btn secondary" disabled={busy || day === istDay(card.nextDueAt)}>Save follow-up</button>
    </div>
  </form>;
}

const KIND: Record<BoardTask["entity"], { title: string; noun: string }> = {
  record: { title: "Listing", noun: "listing" }, call: { title: "AI follow-up", noun: "AI follow-up" },
};
// The same area wording as My Work: carpet, then built-up, then the listing's own area.
const areaText = (task: BoardTask) => task.carpetArea ? `${area(task.carpetArea)} carpet`
  : task.builtUpArea ? `${area(task.builtUpArea)} built-up` : area(task.listingArea);

/** Everything My Work shows for a task, with its notes editable here. */
function TaskSection({ task, onSaved }: { task: BoardTask; onSaved: () => void }) {
  const saved = task.remarks ?? "";
  const [notes, setNotes] = useState(saved);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const notesId = useId();
  // Take newer server notes only while there is no unsaved local draft.
  const baseline = useRef(saved);
  useEffect(() => {
    if (notes === baseline.current) setNotes(saved);
    baseline.current = saved;
  }, [saved]); // Only a new saved value should replace the field; typing must not.
  const kind = KIND[task.entity];
  async function save() {
    setSaving(true); setStatus("");
    try { await send(`/api/board/tasks/${task.id}`, "PATCH", { revision: task.revision, remarks: notes }); setStatus("Saved"); onSaved(); }
    catch (failure) { setStatus(failure instanceof Error ? failure.message : "Couldn't save notes."); }
    finally { setSaving(false); }
  }
  const details = (label: string, section: "Overview" | "AI activity" | "Manual activity") =>
    <RecordDetails id={task.entityId} entity={task.entity} label={label} initialSection={section} className="btn-row" ariaLabel={`${label} for this ${kind.noun}`} />;
  return <section className="board-task" aria-label={kind.title}>
    <div className="board-task-head"><h4>{kind.title}</h4>{details("Details", "Overview")}</div>
    {task.name && <p className="board-task-meta">{task.name}</p>}
    <WorkContext context={{ city: task.city, area: areaText(task), rent: rent(task.rent) }} />
    <AssignmentBrief id={task.id} note={task.note} assignedBy={task.assignedBy} name={task.assignedByName} assignedAt={task.assignedAt} />
    <div className="board-task-calls">
      <div className="board-task-ai"><AiCallStatus result={task.aiResult} count={task.aiCount} />{task.aiCount > 0 && details("AI calls", "AI activity")}</div>
      <div className="board-task-manual">
        <span>{task.manualCalls ? `${task.manualCalls} manual ${task.manualCalls === 1 ? "call" : "calls"} · last: ${dispositionLabel(task.disposition)}${task.lastAttemptAt ? `, ${dateTime(task.lastAttemptAt)}` : ""}` : "No manual calls logged"}</span>
        {details("Manual calls", "Manual activity")}
      </div>
    </div>
    <dl className="board-task-facts">
      <div><dt>Result</dt><dd><span className={`pill ${task.outcome ? `pill-${resultClass(task.outcome)}` : "pill-none"}`}>{task.outcome || "Not called yet"}</span></dd></div>
      <div><dt>In DB?</dt><dd>{task.addedToDb ? "Added" : "Not yet"}</dd></div>
      <div><dt>WH ID</dt><dd>{task.whId?.trim() || "—"}</dd></div>
      <div><dt>Finished?</dt><dd>{task.state === "done" ? "Done" : "Open"}</dd></div>
    </dl>
    <label className="board-field-label" htmlFor={notesId}>Your notes</label>
    <textarea id={notesId} className="board-notes" rows={2} value={notes} placeholder="What did the owner say?" onChange={event => { setNotes(event.target.value); setStatus(""); }} />
    <div className="board-move-actions">
      <span role="status" className="board-task-status">{status}</span>
      <button type="button" className="btn secondary" disabled={saving || notes === saved} onClick={save}>Save notes</button>
    </div>
  </section>;
}

function Timeline({ taskIds, version, labelledBy }: { taskIds: string[]; version: string; labelledBy: string }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState("");
  const query = taskIds.map(id => `task=${encodeURIComponent(id)}`).join("&");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    requestJson<{ events: TimelineEvent[] }>(`/api/board/timeline?${query}`, { signal: controller.signal })
      .then(result => setEvents(result.events))
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Couldn't load the timeline."); });
    return () => controller.abort();
  }, [query, version]);
  return <section className="board-panel-section" aria-labelledby={labelledBy}>
    <h3 id={labelledBy}>Timeline</h3>
    <ol className="board-timeline" aria-busy={events === null}>
      {error ? <li className="board-panel-error">{error}</li>
        : events === null ? <li className="muted">Loading timeline…</li>
        : events.length === 0 ? <li className="muted">No activity yet</li>
        : events.map((event, index) => <li key={`${event.at}:${event.kind}:${index}`} data-kind={event.kind}>
          <span className="board-timeline-text">{event.text}</span>
          <span className="board-timeline-meta"><time dateTime={event.at}>{dateTime(event.at)}</time> · {event.actorName}</span>
        </li>)}
    </ol>
  </section>;
}
