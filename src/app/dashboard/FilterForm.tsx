"use client";
import { useEffect, useRef, useState } from "react";
import { useDashboardUI } from "./DashboardUI";
import { FILTER_LABELS as labels, filterLabel, filterValue } from "./filter-labels";
import { SavedViews } from "./SavedViews";


export function FilterForm({ action, applied, children, className = "", preserveKeys = [], labels: customLabels, formatValue = filterValue }: { action: string; applied: Record<string, string | undefined>; children: React.ReactNode; className?: string; preserveKeys?: string[]; labels?: Record<string, string>; formatValue?: (key: string, value: string) => string }) {
  const { navigate, pending } = useDashboardUI();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = useRef("");
  const serialize = (form: HTMLFormElement) => JSON.stringify([...new FormData(form).entries()]);
  useEffect(() => {if(formRef.current) initial.current = serialize(formRef.current);}, []);
  const [dirty, setDirty] = useState(false);
  const active = Object.entries(applied).filter(([k,v]) => !!v && !!(customLabels || labels)[k]);
  const labelFor = (key: string) => customLabels?.[key] || filterLabel(key, action);
  function remove(key?: string) {
    const params = new URLSearchParams();
    for (const [k,v] of Object.entries(applied)) if (v && k !== key && !["page", "records_page", "calls_page"].includes(k) && (key || preserveKeys.includes(k))) params.set(k,v);
    navigate(action + (params.size ? `?${params}` : ""));
  }
  return <>
    <form ref={formRef} className={`filterbar ${className}${active.length ? " has-filters" : ""}`} method="GET" action={action} onChange={e => {if ((e.target as HTMLElement).closest("dialog")) return; setDirty(serialize(e.currentTarget) !== initial.current);}} onSubmit={e => {
      e.preventDefault();
      const params = new URLSearchParams();
      new FormData(e.currentTarget).forEach((value,key) => { if (String(value).trim()) params.set(key, String(value).trim()); });
      navigate(action + (params.size ? `?${params}` : ""));
    }} aria-busy={pending}>{children}<SavedViews path={action} applied={applied} /></form>
    {(active.length > 0 || dirty || pending) && <div className="applied-filters" aria-label="Applied filters">
      {active.map(([key,value]) => <button type="button" className="filter-tag" key={key} disabled={pending} onClick={() => remove(key)} aria-label={`Remove ${labelFor(key)} filter`}>{labelFor(key)}: {formatValue(key, value!)}<span aria-hidden="true">×</span></button>)}
      {active.length > 0 && <button type="button" className="btn-text" disabled={pending} onClick={() => remove()}>Clear filters</button>}
      <span className="muted" role="status">{pending ? "Updating results…" : dirty ? "Changes ready to apply" : ""}</span>
    </div>}
  </>;
}
