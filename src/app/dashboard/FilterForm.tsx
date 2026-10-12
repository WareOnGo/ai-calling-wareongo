"use client";
import { useEffect, useRef, useState } from "react";
import { useDashboardUI } from "./DashboardUI";
import { FILTER_LABELS as labels, filterLabel, filterValue } from "./filter-labels";
import { filterValues,searchQuery,type SearchValues } from "@/lib/filter-values";
import { SavedViews } from "./SavedViews";


export function FilterForm({ action, applied, children, className = "", preserveKeys = [], labels: customLabels, formatValue = filterValue, viewTools, actions }: { action: string; applied: SearchValues; children: React.ReactNode; className?: string; preserveKeys?: string[]; labels?: Record<string, string>; formatValue?: (key: string, value: string) => string; viewTools?: React.ReactNode; actions?: React.ReactNode }) {
  const { navigate, pending, transitioning } = useDashboardUI();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = useRef("");
  const serialize = (form: HTMLFormElement) => JSON.stringify([...new FormData(form).entries()]);
  useEffect(() => {if(formRef.current) initial.current = serialize(formRef.current);}, []);
  const [dirty, setDirty] = useState(false);
  useEffect(()=>{
    const form=formRef.current;
    // Keep menus anchored to their own controls without extending the page on
    // narrow screens. Recalculate when wrapping or scrolling changes the anchor.
    const positionMenus=()=>{
      for(const panel of form?.querySelectorAll<HTMLElement>('details.filter-multi[open] .multi-options')??[]){
        panel.style.removeProperty('--filter-menu-offset');
        const rect=panel.getBoundingClientRect(),width=document.documentElement.clientWidth;
        const left=Math.max(8,Math.min(rect.left,width-rect.width-8));
        panel.style.setProperty('--filter-menu-offset',`${left-rect.left}px`);
      }
      for(const panel of form?.querySelectorAll<HTMLElement>('details.column-menu[open] > .column-options')??[]){
        panel.style.removeProperty('--column-menu-offset');
        const anchor=panel.parentElement!.querySelector('summary')!.getBoundingClientRect();
        const below=innerHeight-anchor.bottom-12,above=anchor.top-12;
        const opensAbove=below<180&&above>below;
        panel.dataset.side=opensAbove?'above':'below';
        panel.style.setProperty('--column-menu-height',`${Math.max(0,Math.min(360,opensAbove?above:below))}px`);
        const rect=panel.getBoundingClientRect(),width=document.documentElement.clientWidth;
        const left=Math.max(12,Math.min(rect.left,width-rect.width-12));
        panel.style.setProperty('--column-menu-offset',`${left-rect.left}px`);
      }
    };
    const close=(event:PointerEvent|KeyboardEvent)=>{
      if(event instanceof KeyboardEvent&&event.key!=="Escape")return;
      for(const menu of form?.querySelectorAll<HTMLDetailsElement>("details.column-menu[open],details.filter-multi[open]")??[]){
        if(event instanceof KeyboardEvent||!menu.contains(event.target as Node)){
          const restoreFocus=event instanceof KeyboardEvent&&menu.contains(document.activeElement);
          menu.open=false;
          if(restoreFocus){event.preventDefault();menu.querySelector('summary')?.focus({preventScroll:true});}
        }
      }
    };
    document.addEventListener("pointerdown",close);document.addEventListener("keydown",close);
    form?.addEventListener('toggle',positionMenus,true);window.addEventListener('resize',positionMenus);document.addEventListener('scroll',positionMenus,true);
    return()=>{document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",close);form?.removeEventListener('toggle',positionMenus,true);window.removeEventListener('resize',positionMenus);document.removeEventListener('scroll',positionMenus,true);};
  },[]);
  const active = Object.entries(applied).flatMap(([key,v]) => (customLabels || labels)[key]?filterValues(v).map(value=>[key,value] as const):[]);
  const labelFor = (key: string) => customLabels?.[key] || filterLabel(key, action);
  function remove(key?:string,value?:string) {
    const next:SearchValues={};
    for(const [k,v] of Object.entries(applied))if(!["page","records_page","calls_page"].includes(k)&&(key||preserveKeys.includes(k)))next[k]=k===key?filterValues(v).filter(item=>item!==value):v;
    const params=searchQuery(next);navigate(action+(params.size?`?${params}`:""));
  }
  return <>
    <form ref={formRef} className={`filterbar ${className}${active.length ? " has-filters" : ""}${dirty ? " has-changes" : ""}${viewTools ? " records-toolbar" : ""}`} method="GET" action={action} onChange={e => {if ((e.target as HTMLElement).closest("dialog:not(.filter-panel)")) return; setDirty(serialize(e.currentTarget) !== initial.current);}} onSubmit={e => {
      e.preventDefault();
      const params = new URLSearchParams();
      new FormData(e.currentTarget).forEach((value,key) => { if (String(value).trim()) params.append(key, String(value).trim()); });
      e.currentTarget.querySelector<HTMLDialogElement>('.filter-panel[open]')?.close();
      navigate(action + (params.size ? `?${params}` : ""));
    }} aria-busy={pending}>{viewTools ? <><div className="toolbar-search">{children}</div><div className="toolbar-view">{viewTools}<SavedViews path={action} applied={applied}/></div>{actions && <div className="toolbar-actions">{actions}</div>}</> : <>{children}<SavedViews path={action} applied={applied}/></>}</form>
    {(active.length > 0 || dirty || transitioning) && <div className="applied-filters" aria-label="Applied filters">
      {active.map(([key,value]) => <button type="button" className="filter-tag" key={`${key}:${value}`} disabled={pending} onClick={() => remove(key,value)} aria-label={`Remove ${labelFor(key)} filter: ${value}`}>{labelFor(key)}: {formatValue(key, value!)}<span aria-hidden="true">×</span></button>)}
      {active.length > 0 && <button type="button" className="btn-text" disabled={pending} onClick={() => remove()}>Clear filters</button>}
      <span className="muted" role="status">{transitioning ? "Updating results…" : dirty ? "Changes ready to apply" : ""}</span>
    </div>}
  </>;
}
