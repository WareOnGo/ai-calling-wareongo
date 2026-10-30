"use client";

import { IconFilter } from "./icons";
import { useFilterPanelId } from "./FilterForm";

// Open a focused filter panel without moving the results beneath the toolbar.
export function FiltersToggle({ count, disabled = false }: { count: number; disabled?: boolean }) {
  const panelId = useFilterPanelId();
  return (
    <button
      type="button"
      disabled={disabled}
      className={`filters-toggle${count ? " active" : ""}`}
      aria-label="Toggle filters"
      aria-haspopup="dialog"
      aria-controls={panelId}
      onClick={event => {
        const trigger = event.currentTarget;
        const panel = trigger.closest('form')?.querySelector<HTMLDialogElement>('.filter-panel');
        if (!panel) return;
        panel.showModal();
        panel.addEventListener('close', () => { if (trigger.isConnected) trigger.focus({ preventScroll: true }); }, { once: true });
      }}
    >
      <IconFilter size={15} /> Filters
      {count ? <span className="fbadge">{count}</span> : null}
    </button>
  );
}
