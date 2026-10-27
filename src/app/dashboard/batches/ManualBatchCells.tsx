import type { BatchMember } from '@/lib/batch-browser';
import { dateTime, personName, shortDate } from '@/lib/display';
import { allocationLabel, dispositionLabel } from '@/lib/manual-dispositions';
import { AssignmentNotes } from '../assignments/AssignmentNotes';
import { RecordDetails } from '../RecordDetails';
import { ResultBadge } from '../ResultBadge';

const STATUS_LABELS:Record<string,string>={open:'Open',done:'Marked done',dropped:'Unassigned',unallocated:'Not assigned'};
const CLOSURE_LABELS:Record<string,string>={resolved:'Resolved',escalated:'Escalated',invalid_number_verified:'Invalid number verified',exhausted:'Follow-ups exhausted'};

export function ManualBatchCells({ row:r }: { row:BatchMember }) {
  return <>
    <td className="batch-caller">
      <strong title={r.assignee||undefined}>{r.assignee?personName(r.assignee_name,r.assignee):'Not assigned'}</strong>
      {(r.assigned_by||r.assigned_at)&&<span className="batch-contact-city">
        {r.assigned_by?<>Assigned by {personName(r.assigned_by_name,r.assigned_by)}</>:'Assigned'}
        {r.assigned_at&&<> on <time dateTime={r.assigned_at} title={dateTime(r.assigned_at)}>{shortDate(r.assigned_at)}</time></>}
      </span>}
      <span className="batch-contact-city">Allocation: {allocationLabel(r.disposition)}</span>
      {r.current_owner&&r.current_owner!==r.assignee&&<span className="batch-contact-city" title={r.current_owner}>Now with {personName(r.current_owner_name,r.current_owner)}</span>}
      {!r.current_owner&&r.state==='dropped'&&<span className="batch-contact-city">Currently unassigned</span>}
    </td>
    <td className="batch-assignment-status">
      <span className={`pill pill-${r.state==='open'?'open':r.state==='done'?'done':'dropped'}`}>{STATUS_LABELS[r.state]||r.state}</span>
      {(r.state==='done'||r.state==='dropped')&&r.completed_at&&<span className="batch-contact-city">{r.state==='done'?'Completed':'Unassigned'} <time dateTime={r.completed_at} title={dateTime(r.completed_at)}>{shortDate(r.completed_at)}</time></span>}
      {r.state==='done'&&!r.completed_at&&<span className="batch-contact-city">Completion date not recorded</span>}
      {r.closure_reason&&<span className="batch-contact-city">Closure: {CLOSURE_LABELS[r.closure_reason]||r.closure_reason}</span>}
      {r.quality_issue&&<span className="batch-completion-issue">{r.quality_issue.replace('positive integer Warehouse ID','valid warehouse ID')}</span>}
    </td>
    <td>
      <ResultBadge value={r.outcome}/>
      {r.added_to_db!==null&&<span className="batch-contact-city">{r.added_to_db?'Marked added to DB':'Not marked added to DB'}</span>}
      {r.wh_id&&<span className="batch-contact-city">WH ID: {r.wh_id}</span>}
    </td>
    <td className="batch-caller-notes">
      <AssignmentNotes text={r.remarks}/>
      {r.note?.trim()&&<details className="batch-assignment-brief"><summary>Assignment instructions</summary><p>{r.note}</p></details>}
    </td>
    <td className="batch-call-activity">
      <span>{r.manual_disposition?dispositionLabel(r.manual_disposition):'No call status recorded'}</span>
      {r.last_attempt_at&&<span className="batch-contact-city">Last call: <time dateTime={r.last_attempt_at}>{dateTime(r.last_attempt_at)}</time></span>}
      {r.next_due_at&&<span className="batch-contact-city">{r.state==='open'?'Follow-up':'Recorded follow-up'}: <time dateTime={r.next_due_at}>{dateTime(r.next_due_at)}</time></span>}
      <span className="batch-contact-city">{r.attempts.toLocaleString()} logged {r.attempts===1?'call':'calls'}</span>
      {r.entity_id&&r.entity_type&&<RecordDetails entity={r.entity_type} id={r.entity_id} initialSection="Manual activity" label="Call history" title="Callyzer calls and staff logs for this contact"/>}
    </td>
  </>;
}
