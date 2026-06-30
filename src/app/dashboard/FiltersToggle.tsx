"use client";

import { IconFilter } from "./icons";

// Toggles the `.filters-open` class on the parent <form>, revealing the filters
// row below the search. `count` shows how many filters are currently active.
export function FiltersToggle({ count }: { count: number }) {
  return (
    <button
      type="button"
      className={`filters-toggle${count ? " active" : ""}`}
      aria-label="Toggle filters"
      onClick={(e) => e.currentTarget.closest("form")?.classList.toggle("filters-open")}
    >
      <IconFilter size={15} /> Filters
      {count ? <span className="fbadge">{count}</span> : null}
    </button>
  );
}
