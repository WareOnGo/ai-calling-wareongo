"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useDashboardUI } from "./DashboardUI";

type Selection = { ids: string[]; allMatching: boolean; setAllMatching: (all: boolean) => void; clear: () => void; total: number; count: number; hasSelection: boolean };
const Context = createContext<Selection | null>(null);
export function useSelection() { const value = useContext(Context); if (!value) throw new Error("SelectionProvider is required"); return value; }
export function SelectionProvider({ total, children }: { total: number; children: React.ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  useEffect(() => {
    const change = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || (!t.matches('.rowsel') && !t.matches('.selall'))) return;
      const rows = [...document.querySelectorAll<HTMLInputElement>('tbody input.rowsel:not(:disabled)')];
      if (t.matches('.selall')) rows.forEach(b => b.checked = t.checked);
      setIds(rows.filter(b => b.checked).map(b => b.dataset.id!).filter(Boolean));
      setAllMatching(false);
    };
    document.addEventListener('change', change);
    return () => document.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const rows = [...document.querySelectorAll<HTMLInputElement>('tbody input.rowsel:not(:disabled)')];
    rows.forEach(b => b.checked = allMatching || ids.includes(b.dataset.id!));
    const header = document.querySelector<HTMLInputElement>('input.selall');
    if (header) { header.checked = rows.length > 0 && rows.every(b => b.checked); header.indeterminate = !header.checked && rows.some(b => b.checked); }
  }, [ids, allMatching, children]);
  const clear = () => { setIds([]); setAllMatching(false); };
  return <Context.Provider value={{ ids, allMatching, setAllMatching, clear, total, count: allMatching || !ids.length ? total : ids.length, hasSelection: allMatching || ids.length > 0 }}>{children}</Context.Provider>;
}
export function SelectionSummary() {
  const { ids, allMatching, total, clear, setAllMatching } = useSelection();
  const { pending } = useDashboardUI();
  return <div className="selection-summary" role="status">
    {allMatching ? `All ${total.toLocaleString()} matching selected` : ids.length ? `${ids.length.toLocaleString()} selected on this page` : "Select rows for bulk actions"}
    {!!ids.length && !allMatching && total > ids.length && <button type="button" disabled={pending} onClick={() => setAllMatching(true)}>Select all {total.toLocaleString()} matching</button>}
    {(allMatching || !!ids.length) && <button type="button" disabled={pending} onClick={clear}>Clear selection</button>}
  </div>;
}
