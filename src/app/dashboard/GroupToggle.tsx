"use client";
import { useEffect, useRef, useState } from "react";

// Green clickable group header. Clicking toggles a `${group}-collapsed` class on
// the table; CSS then shows/hides that group's `.${group}-col` columns.
export function GroupToggle({ group, label }: { group: string; label: string }) {
  const ref = useRef<HTMLTableCellElement>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const key = `sheet-groups:${location.pathname}:${group}`;
    let value = false;
    try { value = localStorage.getItem(key) === "true"; } catch { /* unavailable storage */ }
    setExpanded(value);
    ref.current?.closest("table")?.classList.toggle(`${group}-collapsed`, !value);
    const reset = () => { setExpanded(false); ref.current?.closest("table")?.classList.add(`${group}-collapsed`); };
    document.addEventListener("reset-columns", reset);
    return () => document.removeEventListener("reset-columns", reset);
  }, [group]);
  return (
    <th
      ref={ref}
      className={`${group}-toggle grp-toggle grp-toggle-head`}
      title="Show / hide these columns"
    >
      <button type="button" className="grp-head-inner" aria-expanded={expanded} onClick={() => {
        const value = !expanded; setExpanded(value);
        ref.current?.closest("table")?.classList.toggle(`${group}-collapsed`, !value);
        try { localStorage.setItem(`sheet-groups:${location.pathname}:${group}`, String(value)); } catch { /* unavailable storage */ }
        document.dispatchEvent(new Event("columns-changed"));
      }}>
        {label}<span className="grp-caret" />
      </button>
    </th>
  );
}
