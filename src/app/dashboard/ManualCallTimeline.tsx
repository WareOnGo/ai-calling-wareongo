import type { ManualCallHistory } from "@/lib/manual-attempts";
import { DISPOSITION_LABELS, type Disposition } from "@/lib/manual-dispositions";
import { dateTime, personName } from "@/lib/display";
import { ResultBadge } from "./ResultBadge";

export function ManualCallTimeline({ history, onPage }: { history: ManualCallHistory; onPage: (page: number) => void }) {
  const sources=[history.imported ? `${history.imported} Callyzer ${history.imported === 1 ? "call" : "calls"}` : null,
    history.logged ? `${history.logged} manual ${history.logged === 1 ? "entry" : "entries"}` : null].filter(Boolean);
  return <section className="detail-section manual-call-history" aria-label="Manual call history">
    <div className="detail-section-heading"><h3>Call history <span className="detail-count">{history.total} {history.total === 1 ? "entry" : "entries"}</span></h3></div>
    {!!sources.length && <p className="detail-description">{sources.join(" · ")}. Newest first.</p>}
    <p className="detail-description">Callyzer calls match this contact's phone numbers. Shared numbers may cover several listings, and device uploads may have gaps. Manual entries may describe the same calls.</p>
    {history.rows.length ? <ol className="attempt-list" aria-label="Manual call timeline">{history.rows.map(event => <li className="attempt-item" key={`${event.source}:${event.id}`}>
      <span className="attempt-dot" aria-hidden="true"/>
      <article className="attempt-card">
        <div className="attempt-heading"><strong>{event.source === "callyzer" ? `${event.call_type} call` : DISPOSITION_LABELS[event.disposition as Disposition]}</strong><span className={`manual-history-source${event.source === "callyzer" ? " is-imported" : ""}`}>{event.source === "callyzer" ? "Callyzer" : "Manual entry"}</span></div>
        <time className="attempt-time" dateTime={event.occurred_at}>{dateTime(event.occurred_at)}</time>
        {event.source === "callyzer" ? <>
          <p className="attempt-meta">{event.assignee ? personName(event.caller_name,event.assignee) : "Unlinked caller"} · {event.call_method === "PhoneCall" ? "Phone" : "WhatsApp"} · {event.call_mode.toLowerCase()}</p>
          <p className="attempt-meta">{event.client_number || "Number unavailable"} · {event.duration_seconds === null ? "Duration unknown" : `Duration: ${event.duration_seconds}s`}</p>
          <details className="manual-history-info"><summary>Call details</summary>
            <p>Caller: {event.assignee || event.employee_number}</p>
            <p>Uploaded: {event.provider_synced_at ? dateTime(event.provider_synced_at) : "Unknown"}</p>
          </details>
        </> : <>
          <p className="attempt-meta">{event.assignee}{event.actor !== event.assignee ? ` · recorded by ${event.actor}` : ""} · <ResultBadge value={event.outcome} empty="No new result"/></p>
          {event.superseded && <p className="manual-history-correction">Superseded by a correction</p>}{event.corrects_id && <p className="manual-history-correction">Correction to a previous staff log</p>}
          {event.notes && <p className="attempt-notes">{event.notes}</p>}
          {event.next_due_at && <p className="attempt-meta">Follow-up due: {dateTime(event.next_due_at)}</p>}
          {event.duration_seconds !== null && <p className="attempt-meta">Reported duration: {event.duration_seconds}s</p>}
        </>}
      </article>
    </li>)}</ol> : <p className="history-empty">No recorded or imported calls for this contact. Older notes and completion records are not proof of a call.</p>}
    {history.pages > 1 && <nav aria-label="Manual history pages"><button type="button" className="btn-row" disabled={history.page <= 1} onClick={() => onPage(history.page-1)}>Previous attempts</button><span>{history.page} / {history.pages}</span><button type="button" className="btn-row" disabled={history.page >= history.pages} onClick={() => onPage(history.page+1)}>Next attempts</button></nav>}
  </section>;
}
