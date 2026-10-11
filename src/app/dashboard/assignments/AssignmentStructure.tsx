import { filterValues, searchQuery, type FilterValue } from "@/lib/filter-values";
import Link from "next/link";
import { ASSIGNMENT_COLUMNS, ASSIGNMENT_WIDTHS } from "../sheet-columns";

const WIDTHS = [32, ...ASSIGNMENT_COLUMNS.map(name => ASSIGNMENT_WIDTHS[name])];

export function AssignmentColumns({widths=WIDTHS,hidden=[]}:{widths?:number[];hidden?:string[]}={}) {
  return <colgroup>{widths.map((width,index)=><col key={index} className={hidden.includes(ASSIGNMENT_COLUMNS[index-1])?"column-hidden":undefined} style={{width}}/>)}</colgroup>;
}

export function AssignmentHeaders({hidden=[]}:{hidden?:string[]}={}) {
  return <thead><tr className="colheads"><th className="rowgutter" aria-label="Row" />{ASSIGNMENT_COLUMNS.map(label => <th key={label} data-column={label}
    className={`${hidden.includes(label)?"column-hidden ":""}${label === "Assignee" ? "assignment-person" : label === "Actions" ? "acts" : ""}`}
    title={label === "Notes" ? "Follow-up notes written by the assignee" : label === "Brief" ? "Instructions given when the work was assigned" : undefined}>{label}</th>)}</tr></thead>;
}

export function AssignmentStats({ totals, assignee, person, state, loading = false }: {
  totals?: { open: number; done: number; dropped: number; people: number };
  assignee?: FilterValue; person?: string; state?: FilterValue; loading?: boolean;
}) {
  const all = totals ? totals.open + totals.done + totals.dropped : 0;
  const cards = [
    { value: totals?.open, label: "open", state: "open" },
    { value: totals?.done, label: "done", state: "done" },
    { value: totals?.dropped, label: "unassigned", state: "dropped" },
    { value: assignee ? all : totals?.people, label: assignee ? "total assignments" : "people with open work", state: "" },
  ];
  return <>
    <p className="section-foot">{assignee ? <>All work for <strong>{person || filterValues(assignee).join(", ")}</strong></> : "Across all assignments"}</p>
    <div className="stat-row">{cards.map((card, index) => {
      const params = searchQuery({assignee});
      if (card.state) params.set("state", card.state);
      const content = <><span className="stat-n">{loading ? <span className="skeleton" style={{ width: 28, height: 22 }} /> : (card.value || 0).toLocaleString()}</span><span className="stat-l">{card.label}</span></>;
      const className = `stat${index === 3 ? " stat-quiet" : ""}${state && state === card.state ? " stat-active" : ""}`;
      return loading || (index === 3 && !assignee) ? <div className={className} key={card.label}>{content}</div> : <Link className={className} key={card.label} href={`/dashboard/assignments${params.size ? `?${params}` : ""}`} aria-current={state === card.state ? "page" : undefined}>{content}</Link>;
    })}</div>
  </>;
}
