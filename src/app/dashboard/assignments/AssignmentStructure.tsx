import Link from "next/link";
import { ASSIGNMENT_COLUMNS } from "../sheet-columns";

const WIDTHS = [32, 205, 290, 115, 140, 225, 174, 125, 110, 115, 80, 110, 245, 165];

export function AssignmentColumns() {
  return <colgroup>{WIDTHS.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>;
}

export function AssignmentHeaders() {
  return <thead><tr className="colheads"><th className="rowgutter" aria-label="Row" />{ASSIGNMENT_COLUMNS.map(label => <th key={label}
    className={label === "Assignee" ? "assignment-person" : label === "Actions" ? "acts" : undefined}
    title={label === "Notes" ? "Follow-up notes written by the assignee" : label === "Brief" ? "Instructions given when the work was assigned" : undefined}>{label}</th>)}</tr></thead>;
}

export function AssignmentStats({ totals, assignee, person, state, loading = false }: {
  totals?: { open: number; done: number; dropped: number; people: number };
  assignee?: string; person?: string; state?: string; loading?: boolean;
}) {
  const all = totals ? totals.open + totals.done + totals.dropped : 0;
  const cards = [
    { value: totals?.open, label: "open", state: "open" },
    { value: totals?.done, label: "done", state: "done" },
    { value: totals?.dropped, label: "unassigned", state: "dropped" },
    { value: assignee ? all : totals?.people, label: assignee ? "total assignments" : "people with open work", state: "" },
  ];
  return <>
    <p className="section-foot">{assignee ? <>All work for <strong>{person || assignee}</strong></> : "Across all assignments"}</p>
    <div className="stat-row">{cards.map((card, index) => {
      const params = new URLSearchParams();
      if (assignee) params.set("assignee", assignee);
      if (card.state) params.set("state", card.state);
      const content = <><span className="stat-n">{loading ? <span className="skeleton" style={{ width: 28, height: 22 }} /> : (card.value || 0).toLocaleString()}</span><span className="stat-l">{card.label}</span></>;
      const className = `stat${index === 3 ? " stat-quiet" : ""}${state && state === card.state ? " stat-active" : ""}`;
      return loading || (index === 3 && !assignee) ? <div className={className} key={card.label}>{content}</div> : <Link className={className} key={card.label} href={`/dashboard/assignments${params.size ? `?${params}` : ""}`} aria-current={state === card.state ? "page" : undefined}>{content}</Link>;
    })}</div>
  </>;
}
