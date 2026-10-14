"use client";
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { useDashboardUI } from "./DashboardUI";
import { FILTER_LABELS as labels, filterLabel, filterValue } from "./filter-labels";
import { filterValues,searchQuery,searchValues,type SearchValues } from "@/lib/filter-values";
import { filterFormSnapshot, filterRangeError } from "./filter-form-state";
import { SavedViews } from "./SavedViews";

const FilterPanelContext = createContext<{id:string;error:string} | undefined>(undefined);
export const useFilterPanelId = () => useContext(FilterPanelContext)?.id;
export const useFilterError = () => useContext(FilterPanelContext)?.error;

export function FilterForm({ action, applied, children, className = "", preserveKeys = [], labels: customLabels, formatValue = filterValue, viewTools, actions, savedViews = true, onApply }: { action: string; applied: SearchValues; children: React.ReactNode; className?: string; preserveKeys?: string[]; labels?: Record<string, string>; formatValue?: (key: string, value: string) => string; viewTools?: React.ReactNode; actions?: React.ReactNode; savedViews?: boolean; onApply?: (values: SearchValues) => void }) {
  const panelId = useId();
  const { navigate, pending, transitioning } = useDashboardUI();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = useRef("");
  const serialize = filterFormSnapshot;
  useEffect(() => {if(formRef.current) initial.current = serialize(formRef.current);}, []);
  const [dirty, setDirty] = useState(false);
  const [validationError, setValidationError] = useState("");
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
  const active = Object.entries(applied).flatMap(([key,v]) => ({...labels, ...customLabels})[key]?filterValues(v).map(value=>[key,value] as const):[]);
  const labelFor = (key: string) => customLabels?.[key] || filterLabel(key, action);
  function apply(params: URLSearchParams) {
    if (onApply) onApply(searchValues(params));
    else navigate(action + (params.size ? `?${params}` : ""));
  }
  function remove(key?:string,value?:string) {
    const next:SearchValues={};
    for(const [k,v] of Object.entries(applied))if(!["page","records_page","calls_page"].includes(k)&&(key||preserveKeys.includes(k)))next[k]=k===key?filterValues(v).filter(item=>item!==value):v;
    apply(searchQuery(next));
  }
  return <FilterPanelContext.Provider value={{id:panelId,error:validationError}}>
    <form ref={formRef} noValidate className={`filterbar records-toolbar ${className}${active.length ? " has-filters" : ""}${dirty ? " has-changes" : ""}`} method="GET" action={action} onReset={e => {
      setValidationError("");
      const form = e.currentTarget;
      form.querySelector<HTMLDialogElement>('.filter-panel[open]')?.close();
      // Native reset also clears an unapplied draft when the URL is already empty.
      requestAnimationFrame(() => { if (form.isConnected) form.dispatchEvent(new Event('input', { bubbles: true })); });
      remove();
    }} onInput={e => {if ((e.target as HTMLElement).closest("dialog:not(.filter-panel)")) return; setValidationError(""); setDirty(serialize(e.currentTarget) !== initial.current);}} onSubmit={e => {
      e.preventDefault();
      const form=e.currentTarget;
      const range=filterRangeError(form);
      const invalid=Array.from(form.elements).find((element):element is HTMLInputElement | HTMLSelectElement =>
        (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) && element.willValidate && !element.validity.valid);
      const field=invalid || (range ? form.elements.namedItem(range.field) as HTMLInputElement : null);
      if(field) {
        setValidationError(invalid?.validationMessage || range!.message);
        const panel=field.closest<HTMLDialogElement>('.filter-panel');
        if(panel && !panel.open) panel.showModal();
        const tab=field.closest('section[aria-labelledby]')?.getAttribute('aria-labelledby');
        if(tab) document.getElementById(tab)?.click();
        requestAnimationFrame(()=>field.focus());
        return;
      }
      setValidationError("");
      const params = new URLSearchParams();
      new FormData(e.currentTarget).forEach((value,key) => { if (String(value).trim()) params.append(key, String(value).trim()); });
      e.currentTarget.querySelector<HTMLDialogElement>('.filter-panel[open]')?.close();
      apply(params);
    }} aria-busy={pending}><div className="toolbar-search">{children}</div>{(viewTools || savedViews) && <div className="toolbar-view">{viewTools}{savedViews && <SavedViews path={action} applied={applied}/>}</div>}{actions && <div className="toolbar-actions">{actions}</div>}</form>
    {(active.length > 0 || dirty || transitioning) && <div className="applied-filters" aria-label="Applied filters">
      {active.map(([key,value]) => <button type="button" className="filter-tag" key={`${key}:${value}`} disabled={pending} onClick={() => remove(key,value)} aria-label={`Remove ${labelFor(key)} filter: ${value}`}>{labelFor(key)}: {formatValue(key, value!)}<span aria-hidden="true">×</span></button>)}
      {active.length > 0 && <button type="button" className="btn-text" disabled={pending} onClick={() => remove()}>Clear filters</button>}
      <span className="muted" role="status">{transitioning ? "Updating results…" : dirty ? "Changes ready to apply" : ""}</span>
    </div>}
  </FilterPanelContext.Provider>;
}
