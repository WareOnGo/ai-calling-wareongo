"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { useDashboardUI } from "./DashboardUI";

type View = { name: string; query: string };
export function SavedViews({ path, applied }: { path: string; applied: Record<string, string | undefined> }) {
  const { viewStorageKey, navigate, pending, notify } = useDashboardUI();
  const key = `${viewStorageKey}:${path}`;
  const menu = useRef<HTMLDetailsElement>(null);
  const [views, setViews] = useState<View[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => { try { const stored: unknown = JSON.parse(localStorage.getItem(key) || '[]'); if (Array.isArray(stored)) setViews(stored.filter(v => typeof v?.name === 'string' && typeof v?.query === 'string').slice(0, 20)); } catch { /* Browser storage is optional. */ } }, [key]);
  function persist(next: View[]) {
    try { localStorage.setItem(key, JSON.stringify(next)); setViews(next); return true; }
    catch { notify("Couldn't save this view in your browser. Check your browser storage settings."); return false; }
  }
  function save() {
    if (!name.trim()) return;
    const params = new URLSearchParams();
    for (const [k,v] of Object.entries(applied)) if (v && !['page','records_page','calls_page','ids'].includes(k)) params.set(k,v);
    if (persist([...views.filter(v => v.name !== name.trim()), {name:name.trim(), query:params.toString()}].slice(-20))) { setOpen(false); setName(''); notify('View saved in this browser'); }
  }
  function go(query: string) { if (menu.current) menu.current.open = false; navigate(path + (query ? `?${query}` : '')); }
  const quick: View[] = path.endsWith('/my') ? [{name:'Still to do',query:'view=open'}, {name:'Not called yet',query:'view=open&outcome=none'}, {name:'Oldest open work',query:'view=open&sort=oldest'}] : path.endsWith('/raw') ? [{name:'Not called', query:'called=no'}, {name:'Unassigned', query:'assignee=none'}] : path.endsWith('/calls') ? [{name:'Needs AI review', query:'needs_review=1'}] : [{name:'Open assignments',query:'state=open'}, {name:'Completed',query:'state=done'}];
  return <>
    <details ref={menu} className="column-menu views-menu"><summary>Views</summary><div className="column-options">
      {quick.map(v => <button className="view-option btn-text" key={v.name} type="button" disabled={pending} onClick={() => go(v.query)}>{v.name}</button>)}
      <span className="view-label">Saved in this browser</span>
      {!views.length && <span className="muted">Save filters you use often.</span>}
      {views.map(v => <span className="view-option" key={v.name}><button className="btn-text" type="button" disabled={pending} onClick={() => go(v.query)}>{v.name}</button><button className="btn-text" type="button" aria-label={`Delete view ${v.name}`} onClick={() => persist(views.filter(item => item.name !== v.name))}>×</button></span>)}
      <button type="button" className="btn-row" disabled={pending} onClick={() => {setOpen(true); if(menu.current) menu.current.open=false;}}>Save current filters…</button>
    </div></details>
    {open && <Dialog title="Save current filters" onClose={() => setOpen(false)}><div className="modal-body"><label className="fld">View name<input autoFocus maxLength={40} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => {if(e.key === 'Enter'){e.preventDefault();save();}}} placeholder="e.g. Delhi follow-ups" /></label><p className="muted">Saves the applied filters for this account in this browser. Using an existing name replaces that view.</p></div><div className="modal-foot"><button type="button" className="btn secondary" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn" disabled={!name.trim()} onClick={save}>Save view</button></div></Dialog>}
  </>;
}
