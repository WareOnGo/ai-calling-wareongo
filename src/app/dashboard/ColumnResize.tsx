"use client";

import { useEffect } from "react";

// Client-side resizable columns. Measures the current column widths, switches the
// table to fixed layout backed by a <colgroup>, and adds drag handles to each
// header cell. Widths persist in localStorage. Works alongside the DB-collapse
// (collapsed .db-col columns are hidden via the colgroup).
const KEY = "sheet-col-widths-v4";

export function ColumnResize() {
  useEffect(() => {
    const table = document.querySelector("table.sheet") as HTMLTableElement | null;
    const headRow = table?.querySelector("tr.colheads") as HTMLTableRowElement | null;
    if (!table || !headRow) return;

    const ths = Array.from(headRow.children) as HTMLElement[]; // [rowgutter, ...columns]

    // Restore saved widths if they match the current column count, else measure.
    // IMPORTANT: measure with the DB group expanded, otherwise the hidden columns
    // measure as 0px and get locked to zero width.
    let widths: number[] | null = null;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (Array.isArray(saved) && saved.length === ths.length && saved.every((w) => w > 0)) {
        widths = saved;
      }
    } catch { /* ignore */ }

    if (!widths) {
      // Expand every collapsed group first, else its hidden columns measure as 0px.
      const collapsed = Array.from(table.classList).filter((c) => c.endsWith("-collapsed"));
      collapsed.forEach((c) => table.classList.remove(c));
      // +20px padding so columns are a little roomier than their content by default.
      widths = ths.map((th, i) =>
        Math.max(i === 0 ? 46 : 60, Math.round(th.getBoundingClientRect().width) + (i === 0 ? 0 : 20)),
      );
      collapsed.forEach((c) => table.classList.add(c));
    }

    // (Re)build the colgroup, mirroring each header cell's class so CSS can target
    // the matched-dataset columns for collapse.
    table.querySelector("colgroup")?.remove();
    const colgroup = document.createElement("colgroup");
    ths.forEach((th, i) => {
      const col = document.createElement("col");
      col.style.width = `${widths![i]}px`;
      if (th.className) col.className = th.className;
      colgroup.appendChild(col);
    });
    table.insertBefore(colgroup, table.firstChild);
    table.classList.add("resizable");
    const cols = Array.from(colgroup.children) as HTMLElement[];

    const save = () =>
      localStorage.setItem(KEY, JSON.stringify(widths));

    let active: { idx: number; startX: number; startW: number } | null = null;
    const handles: HTMLElement[] = [];

    ths.forEach((th, i) => {
      if (i === 0) return; // skip the row-number gutter
      const handle = document.createElement("div");
      handle.className = "col-resizer";
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        active = { idx: i, startX: e.clientX, startW: widths![i] };
        document.body.style.cursor = "col-resize";
      });
      // don't let a resize on the green "DB" header also toggle the collapse
      handle.addEventListener("click", (e) => e.stopPropagation());
      th.appendChild(handle);
      handles.push(handle);
    });

    function onMove(e: MouseEvent) {
      if (!active) return;
      const w = Math.max(40, Math.round(active.startW + (e.clientX - active.startX)));
      widths![active.idx] = w;
      cols[active.idx].style.width = `${w}px`;
    }
    function onUp() {
      if (!active) return;
      active = null;
      document.body.style.cursor = "";
      try { save(); } catch { /* ignore */ }
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      handles.forEach((h) => h.remove());
    };
  }, []);

  return null;
}
