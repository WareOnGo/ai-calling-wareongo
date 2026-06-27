"use client";

import { useEffect, useState } from "react";

// Adds Google-Sheets-like cell interaction to the grid: click to select a cell
// (blue outline), arrow keys to move, Ctrl/Cmd+C to copy the selected cell.
// Attaches via event delegation on document so it survives table re-renders.
export function GridInteractivity() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let selected: HTMLTableCellElement | null = null;

    const isData = (td: Element | null): td is HTMLTableCellElement =>
      !!td && td.tagName === "TD" && !td.classList.contains("rownum");

    function select(td: HTMLTableCellElement) {
      if (selected) selected.classList.remove("selected");
      selected = td;
      td.classList.add("selected");
    }

    function onClick(e: MouseEvent) {
      const td = (e.target as HTMLElement).closest("table.sheet tbody td");
      if (isData(td)) select(td);
    }

    async function copySelected() {
      if (!selected) return;
      try {
        await navigator.clipboard.writeText(selected.innerText.trim());
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      } catch {
        /* clipboard blocked — ignore */
      }
    }

    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select";

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        // Copy the cell only if one is selected and the user isn't selecting text
        if (selected && !typing && !window.getSelection()?.toString()) copySelected();
        return;
      }

      if (typing || !selected) return;
      const deltas: Record<string, [number, number]> = {
        ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowUp: [-1, 0], ArrowDown: [1, 0],
      };
      const d = deltas[e.key];
      if (!d) return;
      e.preventDefault();

      const row = selected.parentElement as HTMLTableRowElement;
      const table = row.closest("table");
      if (!table) return;
      const rows = Array.from(table.querySelectorAll("tbody tr"));
      const ri = rows.indexOf(row);
      const nextRow = rows[ri + d[0]] as HTMLTableRowElement | undefined;
      if (!nextRow) return;
      const target = nextRow.cells[selected.cellIndex + d[1]] ?? nextRow.cells[selected.cellIndex];
      if (isData(target)) select(target);
    }

    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return copied ? <div className="copy-toast">Copied to clipboard</div> : null;
}
