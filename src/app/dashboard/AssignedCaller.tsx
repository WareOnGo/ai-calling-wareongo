export function AssignedCaller({ current, previous, state, people }: {
  current: string | null; previous: string | null; state: string | null;
  people: { email: string; name: string | null }[];
}) {
  if (current) return <span>{current}</span>;
  if (state === "done" && previous) {
    const name = people.find(person => person.email === previous)?.name || previous;
    return <div className="assignment-attribution" title={`Last assigned to ${previous}. This assignment is completed; no active assignment.`}>
      <span>{name}</span><span className="record-meta">Assignment completed</span>
    </div>;
  }
  return <span className="muted">Unassigned</span>;
}
