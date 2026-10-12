"use client";

import { IconFilter } from "./icons";

// Open a focused filter panel without moving the results beneath the toolbar.
export function FiltersToggle({ count, label = "Filters" }: { count: number; label?: string }) {
  return (
    <button
      type="button"
      className={`filters-toggle${count ? " active" : ""}`}
      aria-label="Toggle filters"
      aria-haspopup="dialog"
      aria-controls="filters-panel"
      onClick={event => {
        const trigger = event.currentTarget;
        const panel = trigger.closest('form')?.querySelector<HTMLDialogElement>('.filter-panel');
        if (!panel) return;
        panel.showModal();
        panel.addEventListener('close', () => { if (trigger.isConnected) trigger.focus({ preventScroll: true }); }, { once: true });
      }}
    >
      <IconFilter size={15} /> {label}
      {count ? <span className="fbadge">{count}</span> : null}
    </button>
  );
}
