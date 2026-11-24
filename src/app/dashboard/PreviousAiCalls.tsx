"use client";

import { CALLED_CATS, type CallCat, type CalledCat } from "@/lib/queue";

export function PreviousAiCalls({ counts, total, included, unit, excluded, disabled, onChange }: {
  counts: Partial<Record<CalledCat, number>>; total: number; included?: number;
  unit: "contacts" | "records"; excluded: ReadonlySet<CallCat>; disabled: boolean;
  onChange: (categories: Set<CallCat>) => void;
}) {
  if (!total) return null;
  const present = CALLED_CATS.filter(category => counts[category.key]);
  const allOff = present.every(category => excluded.has(category.key));
  const overlapping = present.reduce((sum, category) => sum + (counts[category.key] || 0), 0) > total;
  return <section className="previous-ai-calls" aria-label="Previous AI calls">
    <div className="previous-ai-heading">
      <h3>Previous AI calls <span>{total.toLocaleString()} {total === 1 ? unit.slice(0, -1) : unit}</span></h3>
      <button type="button" className="btn-row" disabled={disabled}
        onClick={() => onChange(allOff ? new Set() : new Set(present.map(category => category.key)))}>
        {allOff ? "Re-include all called" : "Exclude all called"}
      </button>
    </div>
    <p aria-live="polite">{included === undefined ? "Updating selection…" : `${included.toLocaleString()} included in this batch.`} Uncheck outcomes to exclude them.</p>
    <div className="queue-outcomes">{present.map(category => <label key={category.key}>
      <input type="checkbox" checked={!excluded.has(category.key)} disabled={disabled} onChange={() => {
        const next = new Set(excluded);
        if (next.has(category.key)) next.delete(category.key); else next.add(category.key);
        onChange(next);
      }} />
      <span>{category.label}</span><small>{counts[category.key]?.toLocaleString()}</small>
    </label>)}</div>
    {overlapping && <p>Shared numbers can appear in more than one outcome. Excluding any matching outcome excludes the contact.</p>}
  </section>;
}
