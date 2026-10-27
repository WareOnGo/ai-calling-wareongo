"use client";
import { useState } from "react";
import type { AssigneeWorkload } from "@/lib/users";
import type { Assignee } from "./AssignButton";

export function CallerPicker({ people, selected, workloads, allocation, onChange }: {
  people: Assignee[]; selected: string[]; workloads: AssigneeWorkload[];
  allocation?: Record<string, number>; onChange: (selected: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const matches = people.filter(person => `${person.name || ""} ${person.email}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <fieldset className="caller-picker">
    <legend>Choose callers <span>{selected.length} selected</span></legend>
    {people.length > 6 && <label className="caller-search">Find a caller<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name or email" /></label>}
    <div className="caller-list">
      {matches.map(person => {
        const checked = selected.includes(person.email);
        const workload = workloads.find(item => item.email === person.email);
        const calls = allocation?.[person.email] || 0;
        return <label className={`caller-choice${checked ? " is-selected" : ""}`} key={person.email}>
          <input type="checkbox" checked={checked} aria-label={person.name ? `${person.name} (${person.email})` : person.email}
            onChange={event => onChange(event.target.checked ? [...selected, person.email] : selected.filter(email => email !== person.email))} />
          <span className="caller-identity"><strong>{person.name || person.email}</strong>{person.name && <span>{person.email}</span>}</span>
          <span className="caller-metrics">{checked && allocation && <span className="caller-share">{calls.toLocaleString()} {calls === 1 ? "call" : "calls"}</span>}
            {workload && <small>{workload.open} open · {workload.done_today} done today</small>}</span>
        </label>;
      })}
      {!matches.length && <p className="muted">No callers match your search.</p>}
    </div>
    <p className="caller-help" role="status">{selected.length < 2 ? "Choose at least 2 callers to split the calls." : "New calls are shared as evenly as possible."}</p>
  </fieldset>;
}
