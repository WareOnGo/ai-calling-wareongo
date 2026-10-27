"use client";
import { useState } from 'react';
import { dateTime, personName, shortDate } from '@/lib/display';
import { AssignmentBatchModal } from './AssignmentBatchModal';

export function AssigneeCard({ id, name, email, assignedBy, assignedByName, assignedAt }: {
  id: string; name: string | null; email: string; assignedBy: string; assignedByName: string | null; assignedAt: string;
}) {
  const person = personName(name, email);
  const [open, setOpen] = useState(false);
  return <><button type="button" className="assignee-card" aria-haspopup="dialog" aria-label={`View assignment batch for ${person}`} title="View assignment batch" onClick={() => setOpen(true)}>
    <span className="assignee-name">{person}</span>
    <span className="assignee-attribution">Assigned by {personName(assignedByName, assignedBy)} on <time dateTime={assignedAt} title={dateTime(assignedAt)}>{shortDate(assignedAt)}</time></span>
  </button>{open && <AssignmentBatchModal id={id} onClose={() => setOpen(false)}/>}</>;
}

export function AssigneeCardSkeleton() {
  return <span className="assignee-card" aria-hidden="true">
    <span className="assignee-name"><span className="skeleton" style={{ width: 100, height: 14 }}/></span>
    <span className="assignee-attribution"><span className="skeleton" style={{ width: 180, maxWidth: '100%', height: 10 }}/></span>
  </span>;
}
