"use client";
import {useAutosave,SaveStatus} from './useAutosave';
import {useDashboardUI} from './DashboardUI';
type Props={canEdit:boolean;revision:number;id:string;assignmentId:string|null;remarks:string|null;addedToDb:boolean;whId:string|null;legacyWhId?:string|null;legacyAdded?:boolean};
export function EditableCells({canEdit,revision,id,assignmentId,remarks,addedToDb,whId,legacyWhId,legacyAdded}:Props){
 const {pending}=useDashboardUI();
 const key=`call-assignment-${id}`;
 const save=useAutosave(key,`/api/assignments/${assignmentId}`,{remarks:remarks??'',added_to_db:addedToDb,wh_id:whId??''},['added_to_db'],revision);
 const disabled=pending||!canEdit||!assignmentId,cls=save.status==='error'?'err':save.status==='saving'?'saving':'';
 return <>
  <td className={`edit ${cls}`}><input disabled={disabled} className="cell-input" aria-label="Manual follow-up notes" value={save.values.remarks} onChange={e=>save.set('remarks',e.target.value)} onBlur={save.flush}/>{!assignmentId&&<small>Assign for manual follow-up</small>}<SaveStatus id={key} {...save}/></td>
  <td className={`edit center ${cls}`}><input disabled={disabled} type="checkbox" aria-label="Team marked warehouse added to database" checked={save.values.added_to_db} onChange={e=>save.set('added_to_db',e.target.checked,true)}/></td>
  <td className={`edit ${cls}`}><input disabled={disabled} className="cell-input" aria-label="Team warehouse ID" inputMode="numeric" pattern="[1-9][0-9]*" value={save.values.wh_id} onChange={e=>save.set('wh_id',e.target.value)} onBlur={save.flush}/>{(legacyWhId||legacyAdded)&&<small className="legacy-reference">Legacy call: {legacyWhId||'ID missing'}{legacyAdded?' · Added':''}</small>}</td>
 </>;
}
