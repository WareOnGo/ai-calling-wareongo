"use client";

import { useEffect } from "react";

// Wires the header select-all to the per-row checkboxes on a grid that doesn't
// already have selection behaviour. The raw grid gets this from QueueForCalling;
// the calls grid mounts this instead.
//
// Event delegation on document (not per-row handlers) so it survives server
// re-renders when filters or pages change — same pattern as GridInteractivity.
export function RowSelection() {
  useEffect(() => {
    function sync() {
      const all = document.querySelectorAll<HTMLInputElement>("tbody input.rowsel:not(:disabled)");
      const checked = document.querySelectorAll<HTMLInputElement>("tbody input.rowsel:checked");
      const selall = document.querySelector<HTMLInputElement>("thead input.selall");
      if (selall) {
        selall.checked = all.length > 0 && checked.length === all.length;
        selall.indeterminate = checked.length > 0 && checked.length < all.length;
      }
    }

    function onChange(e: Event) {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (t.classList.contains("selall")) {
        const on = t.checked;
        document
          .querySelectorAll<HTMLInputElement>("tbody input.rowsel:not(:disabled)")
          .forEach((b) => (b.checked = on));
        sync();
      } else if (t.classList.contains("rowsel")) {
        sync();
      }
    }

    document.addEventListener("change", onChange);
    sync();
    return () => document.removeEventListener("change", onChange);
  }, []);

  return null;
}
