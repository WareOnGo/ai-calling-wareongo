"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { readColumnPreferences } from "./sheet-columns";
import { useSelection } from "./Selection";
import { useDashboardUI } from "./DashboardUI";

export function ColumnChooser() {
  const { root } = useSelection();
  const { pending } = useDashboardUI();
  const path = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const [revision, setRevision] = useState(0);
  const [options, setOptions] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    if (pending) return;
    const element = root.current;
    const table = element?.querySelector<HTMLTableElement>("table.sheet");
    if (!element || !table) return;
    const headers = [...table.querySelectorAll<HTMLTableCellElement>("tr.colheads th")];
    const labels = headers.map((th, i) => th.dataset.column || (i === 0 ? "Row" : "Select"));
    const preferences = readColumnPreferences(path, labels);
    const locked = new Set(['Row', 'Select', 'Contact', 'Assignee', 'Actions']);
    setHidden(preferences.hiddenColumns);
    setOptions(labels.filter(name => !locked.has(name)));

    table.querySelector('colgroup')?.remove();
    const columns = document.createElement('colgroup');
    labels.forEach((name, i) => {
      const col = document.createElement('col');
      col.className = headers[i].className;
      col.style.width = `${preferences.widths[i]}px`;
      columns.append(col);
      headers[i].dataset.column = name;
    });
    table.prepend(columns);
    const sync = (hiddenColumns: string[]) => {
      labels.forEach((name, i) => {
        for (const row of [...table.rows]) {
          const cell = row.cells[i];
          if (cell && cell.colSpan === 1) cell.classList.toggle('column-hidden', hiddenColumns.includes(name));
        }
        columns.children[i].classList.toggle('column-hidden', hiddenColumns.includes(name));
      });
    };
    sync(preferences.hiddenColumns);
    // Retain the shared fixed-layout class used by the loading view.
    table.classList.add('resizable');
    const visibility = (event: Event) => sync((event as CustomEvent<string[]>).detail);
    element.addEventListener('column-visibility', visibility);
    return () => element.removeEventListener('column-visibility', visibility);
  }, [path, revision, root, pending]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);

  function toggle(name: string, visible: boolean) {
    const next = visible ? hidden.filter(value => value !== name) : [...new Set([...hidden, name])];
    setHidden(next);
    try { localStorage.setItem(`dashboard-hidden-v1:${path}`, JSON.stringify(next)); } catch { /* optional storage */ }
    root.current?.dispatchEvent(new CustomEvent('column-visibility', { detail: next }));
  }
  function reset() {
    try {
      for (const key of [`dashboard-hidden-v1:${path}`, `sheet-hidden:${path}`, `sheet-col-widths-v6:${path}`, `sheet-col-widths-v5:${path}`, ...['call', 'calls', 'db'].map(group => `sheet-groups:${path}:${group}`)]) localStorage.removeItem(key);
    } catch { /* optional storage */ }
    setRevision(value => value + 1);
    if (menu.current) menu.current.open = false;
  }
  return <details ref={menu} className="column-menu" onKeyDown={event => {
    if (event.key === 'Escape' && menu.current?.open) {
      event.stopPropagation(); menu.current.open = false; menu.current.querySelector('summary')?.focus();
    }
  }}>
    <summary>Columns</summary>
    <div className="column-options">{options.map(name => <label key={name}><input type="checkbox" checked={!hidden.includes(name)} onChange={event => toggle(name, event.target.checked)} />{name}</label>)}<button type="button" className="btn-row" onClick={reset}>Reset columns</button></div>
  </details>;
}
