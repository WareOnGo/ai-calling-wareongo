"use client";

import { useState } from "react";
import { type QueueSel, type CallCat, CAT_TAG_LABEL, normNum } from "@/lib/queue";
import { routeLanguage, LANGUAGE_LABELS, type CallLanguage, type RoutingMode } from "@/lib/routing";
import { ResultBadge } from "./ResultBadge";

const PAGE_SIZE = 25;

export function QueueContacts({ rows, excluded, routingMode, availableLanguages }: {
  rows: QueueSel[]; excluded: Set<CallCat>; routingMode: RoutingMode; availableLanguages: CallLanguage[];
}) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  return <details className="queue-disclosure queue-contacts">
    <summary>Review contacts <span>{rows.length.toLocaleString()}</span></summary>
    <ul className="queue-contact-list" aria-label="Contact review">
      {rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map(row => {
        const owner = row.owners?.find(person => person.state === "open");
        const language = routeLanguage(row.state, routingMode);
        // Match assembleBatch's precedence so the reason explains the count.
        const reason = owner ? `Assigned to ${owner.name || owner.email}`
          : row.cat && excluded.has(row.cat) ? "Excluded by outcome"
          : !language || !availableLanguages.includes(language) ? "Agent unavailable"
          : row.queued ? "Already queued"
          : !/^\d{10}$/.test(normNum(row.contact)) ? "No usable number" : null;
        return <li key={row.id} className="queue-contact">
          <div><strong>{row.name || "Unnamed contact"}</strong><span className="queue-contact-phone">{row.contact || "No phone number"}</span>
            <small>{[row.area, language && LANGUAGE_LABELS[language]].filter(Boolean).join(" · ")}{row.cat && <> · {row.cat === 'dead' ? 'AI: no-answer' : <ResultBadge prefix="AI: " value={CAT_TAG_LABEL[row.cat]}/>}</>}</small>
          </div>
          <span className={`queue-contact-status${reason ? "" : " is-ready"}`}>{reason || "Ready to call"}</span>
        </li>;
      })}
    </ul>
    {pages > 1 && <nav className="queue-contact-pages" aria-label="Contact review pages">
      <button type="button" className="btn-row" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous contacts</button>
      <span>{current} / {pages}</span>
      <button type="button" className="btn-row" disabled={current === pages} onClick={() => setPage(current + 1)}>Next contacts</button>
    </nav>}
  </details>;
}
