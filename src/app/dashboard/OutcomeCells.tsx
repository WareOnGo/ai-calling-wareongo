"use client";
import { useEffect } from "react";
import { OUTCOMES } from "@/lib/scope";
import { IconCheck } from "./icons";
import { useAutosave, SaveStatus } from "./useAutosave";

type Props = { assignmentId: string; outcome: string | null; remarks: string | null; addedToDb: boolean; whId: string | null; state?: string; onStateChange?: (id: string, state: string) => void };
export function OutcomeCells({ assignmentId, outcome, remarks, addedToDb, whId, state = "open", onStateChange }: Props) {
  const key = `assignment-${assignmentId}`;
  const save = useAutosave(key, `/api/assignments/${assignmentId}`, { outcome: outcome ?? "", remarks: remarks ?? "", added_to_db: addedToDb, wh_id: whId ?? "", state }, ["outcome", "added_to_db", "state"]);
  const done = save.values.state === "done";
  useEffect(() => { onStateChange?.(assignmentId, save.values.state); }, [assignmentId, save.values.state, onStateChange]);
  const cls = save.status === "saving" ? "saving" : save.status === "error" ? "err" : save.status === "saved" ? "ok" : "";
  return <>
    <td className={`edit-cell edit-first ${cls}`}><select className="field field-select" aria-label="Result of the call" value={save.values.outcome} onChange={e => save.set("outcome", e.target.value, true)}><option value="">Not called yet</option>{OUTCOMES.map(o => <option key={o}>{o}</option>)}</select></td>
    <td className={`edit-cell notes-cell ${cls}`}><textarea className="field notes-field" aria-label="Your notes" rows={2} value={save.values.remarks} placeholder="What did they say?" onChange={e => save.set("remarks", e.target.value)} onBlur={save.flush} /><SaveStatus id={key} {...save} /></td>
    <td className={`edit-cell center ${cls}`}><label className="checkfield" title="Your verification: this warehouse is in the database"><input type="checkbox" checked={save.values.added_to_db} onChange={e => save.set("added_to_db", e.target.checked, true)} /><span>{save.values.added_to_db ? "Added" : "Not yet"}</span></label></td>
    <td className={`edit-cell ${cls}`}><input className="field field-narrow" aria-label="Warehouse ID" value={save.values.wh_id} placeholder="WH ID" onChange={e => save.set("wh_id", e.target.value)} onBlur={save.flush} /></td>
    <td className={`edit-cell ${cls}`}><button type="button" className={`btn-done${done ? " is-done" : ""}`} aria-pressed={done} onClick={() => save.set("state", done ? "open" : "done", true)} title={done ? "Reopen this one" : "Mark finished — it stays visible"}><IconCheck size={14} />{done ? "Done" : "Mark done"}</button></td>
  </>;
}
