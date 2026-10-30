"use client";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { AssignmentBatchPreview } from '@/lib/assignment-batch-preview';
import { dateTime, personName, shortDate } from '@/lib/display';
import { allocationLabel } from '@/lib/manual-dispositions';
import { Dialog } from '../Dialog';
import { ResultBadge } from '../ResultBadge';
import { requestJson } from '../requests';

export function AssignmentBatchModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<AssignmentBatchPreview | null>(null);
  const [page, setPage] = useState(1), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController(); setError(''); setLoading(true);
    requestJson<AssignmentBatchPreview>(`/api/assignments/${id}/batch?page=${page}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setData(value); body.current?.scrollTo({ top: 0 }); } })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, page, retry]);
  const assignment = data?.assignment, batch = data?.batch, members = data?.members;
  const name = (email: string | null | undefined) => email ? personName(data?.names[email], email) : 'Unassigned';
  return <Dialog wide className="assignment-batch-modal" title={data && !batch ? 'Assignment details' : 'Assignment batch'} onClose={onClose}>
    <div className="modal-body" ref={body} aria-busy={loading}>
      {error ? <p role="alert">{error} <button type="button" className="btn-row" onClick={() => setRetry(value => value + 1)}>Retry batch details</button></p> : loading ? <p role="status" className="muted">Loading assignment details…</p> : assignment && <>
        <p className="assignment-batch-lead">Assigned by <strong>{name(batch?.created_by || assignment.assigned_by)}</strong> on <time dateTime={batch?.created_at || assignment.assigned_at} title={dateTime(batch?.created_at || assignment.assigned_at)}>{shortDate(batch?.created_at || assignment.assigned_at)}</time></p>
        <p className="assignment-batch-people">{batch ? (batch.assignees || []).map(name).join(', ') : name(assignment.assignee)} · {assignment.entity_type === 'record' ? 'Raw Dataset' : 'AI Calls'}</p>
        {assignment.note && <section className="assignment-batch-brief"><h3>Assignment brief</h3><p>{assignment.note}</p></section>}
        {batch && members ? <>
          <div className="assignment-batch-progress" aria-label="Batch progress"><strong>{members.metrics.assigned} assignments</strong><span>{members.metrics.open} open</span><span>{members.metrics.done + members.metrics.quality} done</span>{members.metrics.dropped > 0 && <span>{members.metrics.dropped} unassigned</span>}</div>
          {members.metrics.quality > 0 && <p className="assignment-batch-review">{members.metrics.quality} completed {members.metrics.quality === 1 ? 'assignment needs' : 'assignments need'} review.</p>}
          <h3 className="assignment-batch-list-heading">Records in this batch <span>{members.total.toLocaleString()}</span></h3>
          <ul className="assignment-batch-members" aria-label="Batch records">{members.rows.map(member => <li key={member.member_id}>
            <div className="assignment-batch-contact"><strong>{member.name || 'Unnamed contact'}</strong><span>{member.phone || 'No phone recorded'}{member.city && <> · {member.city}</>}</span></div>
            <div className="assignment-batch-member-state"><span>{name(member.assignee)}</span>{member.assignment_id ? <span className={`pill pill-${member.state}`}>{member.state === 'dropped' ? 'unassigned' : member.state}</span> : <span className="muted">{allocationLabel(member.disposition)}</span>}
              {member.current_owner && member.current_owner !== member.assignee && <small>Now with {name(member.current_owner)}</small>}
            </div>
          </li>)}</ul>
          {!members.rows.length && <p className="muted">No records in this batch.</p>}
        </> : <>
          <p className="assignment-batch-legacy">This assignment has no recorded batch.</p>
          <div className="assignment-batch-single"><div><strong>{assignment.subject || 'Unnamed contact'}</strong><p>{assignment.phone || 'No phone recorded'}</p></div><div><span className={`pill pill-${assignment.state}`}>{assignment.state === 'dropped' ? 'unassigned' : assignment.state}</span>{assignment.state === 'done' && <span className="record-meta">{assignment.completed_at ? `Done on ${shortDate(assignment.completed_at)}` : 'Completion date not recorded'}</span>}</div></div>
          {assignment.outcome && <p className="assignment-batch-result">Manual result <ResultBadge value={assignment.outcome}/></p>}
          {assignment.remarks && <p className="detail-text">{assignment.remarks}</p>}
        </>}
      </>}
    </div>
    <div className="modal-foot">
      {members && members.pages > 1 && <nav className="assignment-batch-pagination" aria-label="Batch record pages"><button type="button" className="btn-row" disabled={loading || !!error || members.page <= 1} onClick={() => setPage(members.page - 1)}>Previous records</button><span>Page {members.page} of {members.pages}</span><button type="button" className="btn-row" disabled={loading || !!error || members.page >= members.pages} onClick={() => setPage(members.page + 1)}>Next records</button></nav>}
      {batch ? <Link className="btn-text" href={`/dashboard/batches/manual/${batch.id}`} onClick={event => { if (event.defaultPrevented) onClose(); }}>Open full batch</Link> : assignment && <Link className="btn-text" href={`/dashboard/assignments?${new URLSearchParams({ assignee: assignment.assignee })}`} onClick={event => { if (event.defaultPrevented) onClose(); }}>View this caller’s assignments</Link>}
      <span className="spacer"/><button type="button" className="btn" onClick={onClose}>Close</button>
    </div>
  </Dialog>;
}
