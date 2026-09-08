"use client";
import { useAutosave, SaveStatus } from "./useAutosave";

type Props = { id: string; callStatus: string | null; calledBy: string | null; addedToDb: boolean; whId: string | null; calledByOptions: string[] };
export function EditableCells({ id, callStatus, calledBy, addedToDb, whId, calledByOptions }: Props) {
  const key = `call-${id}`;
  const save = useAutosave(key, `/api/calls/${id}`, { call_status: callStatus ?? "", called_by: calledBy ?? "", added_to_db: addedToDb, wh_id: whId ?? "" }, ["called_by", "added_to_db"]);
  const cls = save.status === "error" ? "err" : save.status === "saving" ? "saving" : "";
  return <>
    <td className={`edit ${cls}`}><input className="cell-input" aria-label="Team call status" value={save.values.call_status} onChange={e => save.set("call_status", e.target.value)} onBlur={save.flush} /></td>
    <td className={`edit ${cls}`}><select className="cell-input" aria-label="Called by" value={save.values.called_by} onChange={e => save.set("called_by", e.target.value, true)}><option value="">Choose caller</option>{calledByOptions.map(o => <option key={o}>{o}</option>)}</select></td>
    <td className={`edit center ${cls}`}><input type="checkbox" aria-label="Team marked warehouse added to database" checked={save.values.added_to_db} onChange={e => save.set("added_to_db", e.target.checked, true)} /></td>
    <td className={`edit ${cls}`}><input className="cell-input" aria-label="Team warehouse ID" value={save.values.wh_id} onChange={e => save.set("wh_id", e.target.value)} onBlur={save.flush} /><SaveStatus id={key} {...save} /></td>
  </>;
}
