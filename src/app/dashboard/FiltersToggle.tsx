"use client";

import { IconFilter } from "./icons";
import { useState } from "react";

// Toggles the `.filters-open` class on the parent <form>, revealing the filters
// row below the search. `count` shows how many filters are currently active.
export function FiltersToggle({ count, label = "Filters" }: { count: number; label?: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      className={`filters-toggle${count ? " active" : ""}`}
      aria-label="Toggle filters"
      aria-expanded={expanded}
      aria-controls="filters-panel"
      onClick={(e) => { setExpanded(!expanded); e.currentTarget.closest("form")?.classList.toggle("filters-open", !expanded); }}
    >
      <IconFilter size={15} /> {label}
      {count ? <span className="fbadge">{count}</span> : null}
    </button>
  );
}
