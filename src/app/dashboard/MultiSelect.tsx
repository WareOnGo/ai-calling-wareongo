"use client";
import { useEffect, useRef, useState } from "react";
import { filterValues, type FilterValue } from "@/lib/filter-values";

export function MultiSelect({ name, label, value, options, disabled = false }: {
  name: string; label: string; value: FilterValue; options: (string | { value: string; label: string })[]; disabled?: boolean;
}) {
  const [selected, setSelected] = useState(() => filterValues(value));
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDetailsElement>(null);
  const previous = useRef(selected);
  useEffect(() => {
    if (previous.current !== selected) ref.current?.dispatchEvent(new Event("input", { bubbles: true }));
    previous.current = selected;
  }, [selected]);
  useEffect(() => {
    const form = ref.current?.closest("form");
    const reset = () => { setSelected(filterValues(value)); setSearch(""); if (ref.current) ref.current.open = false; };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [value]);
  const items = options.map(item => typeof item === "string" ? { value: item, label: item } : item);
  for (const value of selected) if (!items.some(item => item.value === value)) items.push({ value, label: value });
  const matches = (item: { label: string; value: string }) => `${item.label} ${item.value}`.toLowerCase().includes(search.toLowerCase().trim());
  const selectionLabel = selected.length > 2 ? `${selected.length} selected` : selected.length ? items.filter(item => selected.includes(item.value)).map(item => item.label).join(", ") : "Any";
  return <div className="filter-choice"><span className="multi-caption" aria-hidden="true">{label}</span>
    <details ref={ref} className={`filter-multi chip${selected.length ? " active" : ""}`}>
      <summary aria-disabled={disabled || undefined} onClick={event => { if (disabled) event.preventDefault(); }} aria-label={`${label}${selected.length ? ` (${selected.length} selected)` : ""}`}>
        <span className="multi-control-label">{label}{selected.length ? ` (${selected.length})` : ""}</span><span className="multi-control-value" aria-hidden="true" title={selectionLabel}>{selectionLabel}</span>
      </summary>
      <fieldset aria-label={label} className="multi-options" disabled={disabled}>
        <legend>{label} — match any selected</legend>
        {items.length > 6 && <input className="multi-search" type="search" aria-label={`Find ${label.toLowerCase()} options`} placeholder="Find an option…" value={search}
          onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} />}
        {selected.length > 0 && <button type="button" className="btn-text multi-clear" onClick={() => setSelected([])}>Clear selection ({selected.length})</button>}
        {items.map(item => <label key={item.value} hidden={!matches(item)}><input type="checkbox" name={name} value={item.value} checked={selected.includes(item.value)}
          onChange={event => setSelected(current => event.target.checked ? [...current, item.value] : current.filter(value => value !== item.value))} />{item.label}</label>)}
        {!items.some(matches) && <span className="muted">{items.length ? "No matching options" : "No options available"}</span>}
      </fieldset>
    </details>
  </div>;
}
