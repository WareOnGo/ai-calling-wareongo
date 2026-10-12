"use client";
import { useEffect } from "react";
import { useSelection } from "./Selection";
import { useDashboardUI } from "./DashboardUI";

export function GridInteractivity() {
  const { root } = useSelection();
  const { notify, pending } = useDashboardUI();
  useEffect(() => {
    const element = root.current;
    if (!element || pending) return;
    let selected: HTMLTableCellElement | null = null;
    const visible = (cell: HTMLTableCellElement) => !cell.classList.contains('rownum') && cell.getClientRects().length > 0;
    const tables = [...element.querySelectorAll<HTMLTableElement>('table.sheet')];
    tables.forEach(table => { const cell = [...table.querySelectorAll<HTMLTableCellElement>('tbody td')].find(visible); if (cell) cell.tabIndex = 0; });
    function select(cell: HTMLTableCellElement) {
      if (selected) { selected.classList.remove('selected'); selected.tabIndex = -1; }
      tables.forEach(table => table.querySelectorAll<HTMLTableCellElement>('td[tabindex="0"]').forEach(c => {c.tabIndex = -1;}));
      selected = cell; cell.classList.add('selected'); cell.tabIndex = 0; cell.focus({preventScroll:true}); cell.scrollIntoView({block:'nearest',inline:'nearest'});
    }
    const click = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button,input,select,textarea,a,dialog')) return;
      const cell = target.closest<HTMLTableCellElement>('table.sheet tbody td'); if (cell && visible(cell)) select(cell);
    };
    const focus = (e: FocusEvent) => { const target = e.target as HTMLElement; if (target.matches('table.sheet tbody td')) { if (selected && selected !== target) {selected.classList.remove('selected');selected.tabIndex=-1;} selected = target as HTMLTableCellElement; selected.classList.add('selected'); } };
    const key = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('dialog') || !target.closest('table.sheet')) return;
      if (target.matches('input,textarea,select,button,a')) { if (e.key === 'Escape') { const cell=target.closest<HTMLTableCellElement>('td'); if (cell) {e.preventDefault();select(cell);} } return; }
      if (!selected?.isConnected) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) { e.preventDefault(); try {await navigator.clipboard.writeText(selected.innerText.trim());notify('Copied to clipboard');} catch {notify("Couldn't copy. Select the text and copy it manually.");} return; }
      if (e.key === 'Enter' || e.key === 'F2') { const input=selected.querySelector<HTMLElement>('input,select,textarea,button,a'); if(input){e.preventDefault();input.focus();} return; }
      const row=selected.parentElement as HTMLTableRowElement;
      let next: HTMLTableCellElement | undefined;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const cells=[...row.cells].filter(visible); next=cells[cells.indexOf(selected)+(e.key === 'ArrowRight'?1:-1)]; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { const rows=[...row.closest('tbody')!.rows]; const nextRow=rows[rows.indexOf(row)+(e.key === 'ArrowDown'?1:-1)]; next=nextRow?.cells[selected.cellIndex]; }
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {e.preventDefault();if(next&&visible(next))select(next);}
    };
    element.addEventListener('click',click); element.addEventListener('focusin',focus); element.addEventListener('keydown',key);
    return () => { if (selected) { selected.classList.remove('selected'); selected.tabIndex = -1; } element.removeEventListener('click',click);element.removeEventListener('focusin',focus);element.removeEventListener('keydown',key); };
  }, [notify, pending, root]);
  return null;
}
