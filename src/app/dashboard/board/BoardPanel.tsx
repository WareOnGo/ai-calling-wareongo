"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { BoardCard, BoardTask } from "@/lib/board";
import type { TimelineEvent } from "@/lib/board-timeline";
import { JUNK_REASONS, REJECTION_REASONS, STAGES, movableTasks, stageInfo, type Stage } from "@/lib/board-stages";
import { dateTime, shortDate } from "@/lib/display";
import { useDashboardUI } from "../DashboardUI";
import { requestJson, RequestError } from "../requests";
import { CopyText } from "../CopyText";
import { RecordDetails } from "../RecordDetails";

type FormStage = "rejected" | "junk" | "warehouse_created";
const NEEDS_FORM: readonly Stage[] = ["rejected", "junk", "warehouse_created"];
const send = (url: string, method: string, body: unknown) =>
  requestJson(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const refsOf = (tasks: BoardTask[]) => tasks.map(task => ({ id: task.id, revision: task.revision }));
// The date picker chooses a day; follow-ups are due at 10:00 IST that day.
const followUpAt = (day: string) => `${day}T10:00:00+05:30`;
const istDay = (value: string | null) => value ? new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "";

export function BoardPanel({ card, onClose }: { card: BoardCard; onClose: () => void }) {
  const { refresh } = useDashboardUI();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [form, setForm] = useState<FormStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stage = stageInfo(card.stage);
  const tasks = [...card.tasks].sort((a, b) => (a.entity === b.entity ? 0 : a.entity === "record" ? -1 : 1) || Number(a.id) - Number(b.id));
  const openTasks = tasks.filter(task => task.state === "open");
  const version = card.tasks.map(task => `${task.id}:${task.revision}`).join(",");

  useEffect(() => { heading.current?.focus(); setForm(null); setError(""); }, [card.key]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await action(); setForm(null); refresh(); }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't save the change. Try again.");
      // A conflict means newer data exists; reload it so the next attempt uses it.
      if (failure instanceof RequestError && failure.code === "ASSIGNMENT_CONFLICT") refresh();
    } finally { setBusy(false); }
  }
  const move = (target: Stage, extra: { reason?: string | null; wh_id?: string | null } = {}) =>
    run(() => send("/api/board/move", "POST", { tasks: refsOf(movableTasks(card.tasks)), stage: target, ...extra }));
  const choose = (target: Stage) => {
    if (target === card.stage && !NEEDS_FORM.includes(target)) return;
    if (NEEDS_FORM.includes(target)) { setForm(target as FormStage); setError(""); } else void move(target);
  };

  return <aside id="board-panel" className="board-panel" aria-labelledby={titleId} aria-busy={busy}
    onKeyDown={event => { if (event.key !== "Escape") return; event.stopPropagation(); if (form) setForm(null); else onClose(); }}>
    <header className="board-panel-head">
      <div className="board-panel-identity">
        <h2 id={titleId} ref={heading} tabIndex={-1}>{card.name?.trim() || "Unnamed owner"}</h2>
        <div className="board-panel-phone">{card.phone ? <CopyText value={card.phone} label="phone number" /> : <span className="muted">No phone number</span>}</div>
        <p className="board-panel-meta">{[card.city, card.region, card.assigneeName || card.assignee, card.closed ? "Closed" : null].filter(Boolean).join(" · ")}</p>
      </div>
      <button type="button" className="modal-close" aria-label="Close lead" onClick={onClose}>×</button>
    </header>

    <div className="board-panel-body">
      <div role="group" aria-label="Move to stage" className="board-stage-buttons" title={`Current stage: ${stage.code} ${stage.label}`}>
        {STAGES.map(option => <button key={option.slug} type="button" data-stage={option.slug} className="board-stage-button"
          aria-pressed={option.slug === card.stage} aria-expanded={NEEDS_FORM.includes(option.slug) ? form === option.slug : undefined}
          disabled={busy} onClick={() => choose(option.slug)}>
          <span className="board-code">{option.code}</span> {option.short}
        </button>)}
      </div>
      {form && <MoveForm key={form} stage={form} card={card} busy={busy} onCancel={() => setForm(null)} onMove={extra => move(form, extra)} />}
      {error && <p className="board-panel-error" role="alert">{error}</p>}

      {openTasks.length > 0 && <FollowUp key={`${card.key}:${version}`} card={card} busy={busy}
        onSave={day => run(() => send("/api/board/follow-up", "POST", { tasks: refsOf(openTasks), next_due_at: day ? followUpAt(day) : null }))} />}

      <section className="board-panel-section" aria-labelledby={`${titleId}-tasks`}>
        <h3 id={`${titleId}-tasks`}>Tasks on this number</h3>
        {tasks.map(task => <TaskNotes key={task.id} task={task} onSaved={refresh} />)}
      </section>

      <Timeline taskIds={card.tasks.map(task => task.id)} version={version} labelledBy={`${titleId}-timeline`} />
    </div>
  </aside>;
}

function MoveForm({ stage, card, busy, onCancel, onMove }: {
  stage: FormStage; card: BoardCard; busy: boolean; onCancel: () => void; onMove: (extra: { reason?: string | null; wh_id?: string | null }) => void;
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

function TaskNotes({ task, onSaved }: { task: BoardTask; onSaved: () => void }) {
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
  const kind = task.entity === "record" ? "Listing" : "AI follow-up";
  async function save() {
    setSaving(true); setStatus("");
    try { await send(`/api/board/tasks/${task.id}`, "PATCH", { revision: task.revision, remarks: notes }); setStatus("Saved"); onSaved(); }
    catch (failure) { setStatus(failure instanceof Error ? failure.message : "Couldn't save notes."); }
    finally { setSaving(false); }
  }
  return <section className="board-task">
    <div className="board-task-head"><h4>{kind}</h4><RecordDetails id={task.entityId} entity={task.entity} label="Full record" className="btn-row" ariaLabel={`Full record for this ${kind.toLowerCase()}`} /></div>
    <p className="board-task-meta">{[task.name, task.city, `Assigned ${shortDate(task.assignedAt)}`, task.state === "done" ? "Finished" : null].filter(Boolean).join(" · ")}</p>
    {task.note && <p className="board-task-brief"><span>Assigner&apos;s note</span>{task.note}</p>}
    <label className="board-field-label" htmlFor={notesId}>Notes</label>
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
