"use client";
import { useCallback, useEffect, useState } from "react";
import { OUTCOMES } from "@/lib/scope";
import { IconCheck } from "../../icons";
import { useAutosave, SaveStatus } from "../../useAutosave";
import { useDashboardUI } from "../../DashboardUI";
import { AssignmentConflict, workValues } from "./AssignmentConflict";
import { WarehouseReference } from "../../WarehouseNotice";
import type { SaveSnapshot, Values } from "@/lib/autosave";

export type WorkSaveStatus = SaveSnapshot<Values>["status"];
type Props = { revision: number; assignmentId: string; contactName: string | null; phone: string | null; outcome: string | null; remarks: string | null; addedToDb: boolean; whId: string | null; state?: string; employee?: string; onStateChange?: (id: string, state: string) => void; onSaveStatusChange?: (id: string, status: WorkSaveStatus) => void; beforeSave?: () => Promise<boolean> };

// Keep the employee layout, without mounting autosave or any mutation handlers.
export function ReadOnlyOutcomeCells({ outcome, remarks, addedToDb, whId, state, warehouseIds = [], notesLabel = "Employee notes" }: Pick<Props, "outcome" | "remarks" | "addedToDb" | "whId" | "state"> & { warehouseIds?: number[]; notesLabel?: string }) {
  const done = state === "done";
  return <>
    <td className="edit-cell edit-first"><select disabled className="field field-select" aria-label="Result of the call" value={outcome || ""}><option value="">Not called yet</option>{OUTCOMES.map(value => <option key={value}>{value}</option>)}</select></td>
    <td className="edit-cell notes-cell"><textarea readOnly className="field notes-field" aria-label={notesLabel} rows={2} value={remarks || ""} placeholder="No notes yet" /></td>
    {warehouseIds.length > 0 ? <>
      <td className="edit-cell center warehouse-value-cell"><span className="warehouse-added-status" title="Matched by phone against the warehouse database"><IconCheck size={14} />Added</span></td>
      <td className="edit-cell warehouse-value-cell"><WarehouseReference ids={warehouseIds} savedId={whId} /></td>
    </> : <>
      <td className="edit-cell center"><label className="checkfield"><input disabled type="checkbox" checked={addedToDb} /><span>{addedToDb ? "Added" : "Not yet"}</span></label></td>
      <td className="edit-cell"><input readOnly className="field field-narrow" aria-label="Warehouse ID" value={whId || ""} placeholder="WH ID" /></td>
    </>}
    <td className="edit-cell"><button disabled type="button" className={`btn-done${done ? " is-done" : ""}`} aria-pressed={done}><IconCheck size={14} />{done ? "Done" : "Mark done"}</button></td>
  </>;
}

export function OutcomeCells({ revision, assignmentId, contactName, phone, outcome, remarks, addedToDb, whId, state = "open", employee, onStateChange, onSaveStatusChange, beforeSave }: Props) {
  const key = `assignment-${assignmentId}${employee ? `-${employee}` : ""}`;
  const url = `/api/my-work/assignments/${assignmentId}${employee ? `?${new URLSearchParams({ employee })}` : ""}`;
  const notesLabel = employee ? "Employee notes" : "Your notes";
  const [reviewOpen, setReviewOpen] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const markUnavailable = useCallback(() => setUnavailable(true), []);
  const { refresh, hasDrafts } = useDashboardUI();
  const save = useAutosave(key, url, { outcome: outcome ?? "", remarks: remarks ?? "", added_to_db: addedToDb, wh_id: whId ?? "", state }, ["outcome", "added_to_db", "state"], revision, [], {
    review: () => setReviewOpen(true), unavailable: markUnavailable, values: workValues,
  }, beforeSave);
  const done = save.values.state === "done";
  useEffect(() => { onStateChange?.(assignmentId, save.values.state); }, [assignmentId, save.values.state, onStateChange]);
  useEffect(() => { onSaveStatusChange?.(assignmentId, save.status); }, [assignmentId, save.status, onSaveStatusChange]);
  const cls = save.status === "saving" ? "saving" : save.status === "error" ? "err" : save.status === "saved" ? "ok" : "";
  return <>
    <td className={`edit-cell edit-first ${cls}`}><select disabled={unavailable} className="field field-select" aria-label="Result of the call" value={save.values.outcome} onChange={e => save.set("outcome", e.target.value, true)}><option value="">Not called yet</option>{OUTCOMES.map(o => <option key={o}>{o}</option>)}</select></td>
    <td className={`edit-cell notes-cell ${cls}`}>
      <textarea readOnly={unavailable} className="field notes-field" aria-label={notesLabel} rows={2} value={save.values.remarks} placeholder="What did they say?" onChange={e => save.set("remarks", e.target.value)} onBlur={unavailable || employee ? undefined : save.flush} />
      {unavailable && !save.dirty ? <span className="save-status error" role="status">This assignment is no longer available.</span> : <SaveStatus id={key} {...save} />}
      {employee && save.dirty && <div className="work-draft-actions">
        {save.status !== "error" && <button type="button" className="btn-row" disabled={unavailable || save.status === "saving"} onPointerDown={event => event.preventDefault()} onClick={event => { event.currentTarget.focus(); save.flush(); }}>Save changes</button>}
        <button type="button" className="btn-row" disabled={save.status === "saving"} onPointerDown={event => event.preventDefault()} onClick={() => { save.discard(); if (save.code === "ASSIGNMENT_CONFLICT" && !hasDrafts()) refresh(); }}>Discard draft</button>
      </div>}
    </td>
    <td className={`edit-cell center ${cls}`}><label className="checkfield" title="Your verification: this warehouse is in the database"><input disabled={unavailable} type="checkbox" checked={save.values.added_to_db} onChange={e => save.set("added_to_db", e.target.checked, true)} /><span>{save.values.added_to_db ? "Added" : "Not yet"}</span></label></td>
    <td className={`edit-cell ${cls}`}><input readOnly={unavailable} className="field field-narrow" aria-label="Warehouse ID" value={save.values.wh_id} placeholder="WH ID" onChange={e => save.set("wh_id", e.target.value)} onBlur={unavailable || employee ? undefined : save.flush} /></td>
    <td className={`edit-cell ${cls}`}><button disabled={unavailable} type="button" className={`btn-done${done ? " is-done" : ""}`} aria-pressed={done} onClick={() => save.set("state", done ? "open" : "done", true)} title={done ? "Reopen this one" : "Mark finished — it stays visible"}><IconCheck size={14} />{done ? "Done" : "Mark done"}</button></td>
    {reviewOpen && <AssignmentConflict url={url} draft={save.draft} contactName={contactName} phone={phone} notesLabel={notesLabel} onUnavailable={markUnavailable} onClose={() => setReviewOpen(false)}
      onResolve={(values, latestRevision, keepDraft) => { save.resolveConflict(values, latestRevision, keepDraft); setReviewOpen(false); }}
      onDiscard={() => { save.discard(); setReviewOpen(false); if (!hasDrafts()) refresh(); }} />}
  </>;
}
