"use client";
import { useId, useRef, useState, type ReactNode } from "react";
import { ApplyButton } from "./ApplyButton";
import { useFilterPanelId, useFilterError } from "./FilterForm";

// This dialog stays inside its filter form, including while closed. Native form
// association preserves every value across categories and search-only submits.
export function FilterPanel({ groups }: { groups: { label: string; content: ReactNode; count?: number }[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [active, setActive] = useState(0);
  const id = useId();
  const panelId = useFilterPanelId();
  const error = useFilterError();
  return <dialog ref={ref} id={panelId} className="app-dialog modal details-drawer filter-panel" aria-labelledby={id}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
    }}>
    <div className="modal-head"><h2 id={id} className="modal-title">Filters</h2><button type="button" className="modal-close" aria-label="Close filters" onClick={() => ref.current?.close()}>×</button></div>
    <p className="filter-panel-hint">Choose filters, then apply your changes.</p>
    {error && <p className="filter-validation" role="alert">{error}</p>}
    {groups.length > 1 && <div className="filter-categories" role="tablist" aria-label="Filter categories">{groups.map((group, index) => <button type="button" role="tab" key={group.label}
      id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} aria-selected={index === active} tabIndex={index === active ? 0 : -1}
      onClick={() => setActive(index)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % groups.length : event.key === 'ArrowLeft' ? (index + groups.length - 1) % groups.length : event.key === 'Home' ? 0 : event.key === 'End' ? groups.length - 1 : null;
        if (next !== null) { event.preventDefault(); setActive(next); document.getElementById(`${id}-tab-${next}`)?.focus(); }
      }}>{group.label}{!!group.count && <span>{group.count}</span>}</button>)}</div>}
    <div className="modal-body filter-panel-body">{groups.map((group, index) => <section key={group.label} id={`${id}-panel-${index}`} role={groups.length > 1 ? 'tabpanel' : undefined}
      aria-labelledby={groups.length > 1 ? `${id}-tab-${index}` : undefined} hidden={active !== index}>
      <h3 className={groups.length > 1 ? "sr-only" : undefined}>{group.label}</h3><div className="filter-fields">{group.content}</div>
    </section>)}</div>
    <div className="modal-foot"><button type="reset" className="btn-text">Clear all filters</button><span className="spacer" /><button type="button" className="btn secondary" onClick={() => ref.current?.close()}>Close</button><ApplyButton primary /></div>
  </dialog>;
}
