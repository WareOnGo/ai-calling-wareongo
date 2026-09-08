"use client";
import { useEffect, useState } from "react";
import { readColumnPreferences } from "./sheet-columns";
import { usePathname } from "next/navigation";

export function ColumnResize() {
  const path = usePathname();
  const [revision, setRevision] = useState(0);
  const [options, setOptions] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    const table = document.querySelector<HTMLTableElement>("table.sheet");
    const headers = table ? [...table.querySelectorAll<HTMLTableCellElement>("tr.colheads th")] : [];
    if (!table || !headers.length) return;
    const labels = headers.map((th, i) => th.textContent?.trim() || (i === 0 ? "Row" : "Select"));
    const key = `sheet-col-widths-v6:${path}`;
    const preferences = readColumnPreferences(path, labels);
    const widths = preferences.widths;
    let hiddenColumns = preferences.hiddenColumns;
    const locked = new Set(['Row','Select','Owner','Number','Phone']);
    setHidden(hiddenColumns);
    setOptions(labels.filter((name,i) => !locked.has(name) && !headers[i].matches('.call-col,.db-col,.calls-col')));
    table.querySelector('colgroup')?.remove();
    const colgroup = document.createElement('colgroup');
    labels.forEach((name,i) => { const col = document.createElement('col'); col.className = headers[i].className; col.style.width = `${widths[i]}px`; colgroup.append(col); headers[i].dataset.column = name; });
    table.prepend(colgroup); table.classList.add('resizable');
    const cols = [...colgroup.children] as HTMLElement[];
    const rows = [...table.rows];
    const pinEnd = labels.findIndex(name => name === 'Number' || name === 'Phone');
    const sync = () => {
      let left = 0;
      headers.forEach((th,i) => {
        for (const row of rows) { const cell = row.cells[i]; if (!cell || cell.colSpan > 1) continue; cell.classList.toggle('column-hidden', hiddenColumns.includes(labels[i])); if (i <= pinEnd) { cell.classList.add('frozen-cell'); cell.style.setProperty('--frozen-left', `${left}px`); } }
        cols[i].classList.toggle('column-hidden', hiddenColumns.includes(labels[i]));
        if (i <= pinEnd) left += th.getBoundingClientRect().width;
      });
    };
    const persist = () => { try { localStorage.setItem(key, JSON.stringify(Object.fromEntries(labels.map((name,i) => [name,widths[i]])))); } catch { /* unavailable */ } };
    let active: { idx: number; x: number; width: number } | null = null;
    const handles = headers.map((th,i) => {
      if (i === 0 || labels[i] === 'Select') return null;
      const handle = document.createElement('span'); handle.className = 'col-resizer'; handle.tabIndex = 0;
      handle.setAttribute('role','separator'); handle.setAttribute('aria-orientation','vertical'); handle.setAttribute('aria-label', `Resize ${labels[i]} column`); handle.setAttribute('aria-valuenow', String(widths[i]));
      handle.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); active = { idx:i, x:e.clientX, width:widths[i] }; document.body.style.cursor = 'col-resize'; });
      handle.addEventListener('click', e => e.stopPropagation());
      handle.addEventListener('keydown', e => { if (!['ArrowLeft','ArrowRight'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); widths[i] = Math.max(60,widths[i]+(e.key === 'ArrowRight' ? 10 : -10)); cols[i].style.width = `${widths[i]}px`; handle.setAttribute('aria-valuenow',String(widths[i])); sync(); persist(); });
      th.append(handle); return handle;
    });
    const move = (e: PointerEvent) => { if (!active) return; widths[active.idx] = Math.max(60, active.width + e.clientX-active.x); cols[active.idx].style.width = `${widths[active.idx]}px`; handles[active.idx]?.setAttribute('aria-valuenow',String(widths[active.idx])); sync(); };
    const up = () => { if (!active) return; active = null; document.body.style.cursor = ''; persist(); };
    const visibility = (e: Event) => { hiddenColumns = (e as CustomEvent<string[]>).detail; sync(); };
    const observer = new ResizeObserver(sync); observer.observe(table);
    sync();
    document.addEventListener('pointermove',move); document.addEventListener('pointerup',up); document.addEventListener('columns-changed',sync); document.addEventListener('column-visibility',visibility);
    return () => { observer.disconnect(); handles.forEach(h => h?.remove()); document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); document.removeEventListener('columns-changed',sync); document.removeEventListener('column-visibility',visibility); document.body.style.cursor = ''; };
  }, [path, revision]);
  function toggle(name: string) { const next = hidden.includes(name) ? hidden.filter(n => n !== name) : [...hidden,name]; setHidden(next); try { localStorage.setItem(`sheet-hidden:${path}`,JSON.stringify(next)); } catch { /* unavailable */ } document.dispatchEvent(new CustomEvent('column-visibility',{detail:next})); }
  function reset() { try { for (const key of [`sheet-col-widths-v6:${path}`,`sheet-col-widths-v5:${path}`,`sheet-hidden:${path}`,...['call','calls','db'].map(g => `sheet-groups:${path}:${g}`)]) localStorage.removeItem(key); } catch { /* unavailable */ } document.dispatchEvent(new Event('reset-columns')); setRevision(n => n+1); }
  return <details className="column-menu"><summary>Columns</summary><div className="column-options">{options.map(name => <label key={name}><input type="checkbox" checked={!hidden.includes(name)} onChange={() => toggle(name)} />{name}</label>)}<button type="button" className="btn-row" onClick={reset}>Reset columns</button></div></details>;
}
