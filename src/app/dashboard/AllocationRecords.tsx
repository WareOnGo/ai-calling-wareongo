import type { AllocationItem } from "@/lib/assignment-allocation";
import { dateTime } from "@/lib/display";
import { ResultBadge } from "./ResultBadge";
import { DISPOSITION_LABELS, type Disposition } from "@/lib/manual-dispositions";

const actions = { assign: "Assign", reassign: "Reassign", owned: "Keep current owner", duplicate: "Duplicate contact", missing_phone: "No valid phone" };
const disposition = (value: string | null) => value ? DISPOSITION_LABELS[value as Disposition] || value : "No recorded disposition";

export function AllocationRecords({ items }: { items: AllocationItem[] }) {
  return <div className="allocation-records">{items.map(item => <article className="allocation-record" key={item.id}>
    <div className="allocation-record-heading"><strong>{item.name || item.phones[0] || "No valid phone"}</strong><span className={`pill ${item.disposition === 'assign' || item.disposition === 'reassign' ? 'pill-open' : 'pill-dropped'}`}>{actions[item.disposition]}</span></div>
    <p className="allocation-contact">{item.phones.join(", ") || "No valid phone"}{item.assignee && <> · {item.assignee}</>}</p>
    <div className="allocation-current">{item.owners.length ? item.owners.map(owner => <p key={owner.id}>{owner.assignee} · {owner.state}<br/><ResultBadge value={owner.outcome} empty="No manual result"/> · {disposition(owner.disposition)}{owner.next_due_at && <><br/>Due {dateTime(owner.next_due_at)}</>}</p>) : "Unassigned"}</div>
    <details className="evidence-details"><summary>History and identifiers</summary>
      <dl><div><dt>Record</dt><dd>{item.id}</dd></div><div><dt>AI status / result</dt><dd>{item.ai ? <>{item.ai.status || "Unknown status"} · <ResultBadge value={item.ai.result} empty="No AI result"/><br/>{item.ai.known_attempts} known provider attempts<br/>{item.ai.scope === 'execution' ? 'Selected execution' : 'Latest contact context — may describe another property'}{item.ai.recorded_at && <><br/>Execution recorded {dateTime(item.ai.recorded_at)}</>}</> : "No AI execution history"}</dd></div>
      <div><dt>Completed manual history</dt><dd>{item.completed_by.length ? item.completed_by.map((owner, index) => <p key={index}>{owner.assignee} · {owner.count} done<br/><ResultBadge value={owner.outcome} empty="No manual result"/> · {disposition(owner.disposition)}</p>) : "No completed history"}</dd></div></dl>
    </details>
  </article>)}</div>;
}
