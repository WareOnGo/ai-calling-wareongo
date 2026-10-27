"use client";

import { useState } from "react";
import Link from "next/link";
import type { teamDates, TeamFilters } from "@/lib/team-report";
import { countFilters, searchQuery } from "@/lib/filter-values";
import { CALLYZER_STREAMS } from "@/lib/callyzer";
import { shortDate } from "@/lib/display";
import { FilterForm } from "../FilterForm";
import { FilterPanel } from "../FilterPanel";
import { FiltersToggle } from "../FiltersToggle";
import { ApplyButton } from "../ApplyButton";
import { SelectFilter } from "../FilterFields";

export function TeamDateRange({ filters, dates, people = [], activity }: { filters: TeamFilters; dates: ReturnType<typeof teamDates>; people?: {email:string;name:string|null}[]; activity?: { activity_channel: string; activity_caller?: string } }) {
  const initial={allTime:filters.range==='all',from:filters.date_from||dates.week,to:filters.date_to||dates.today};
  const [draft,setDraft]=useState(initial);
  const {allTime}=draft;
  const applied={range:filters.range,date_from:filters.date_from,date_to:filters.date_to,person:filters.person,access:filters.access,
    activity_channel: activity?.activity_channel === 'all' ? undefined : activity?.activity_channel,activity_caller: activity?.activity_caller};
  function setPeriod(form:HTMLFormElement,all:boolean,from=draft.from,to=draft.to) {
    setDraft({allTime:all,from,to});
    requestAnimationFrame(()=>{
      if(!form.isConnected)return;
      form.dispatchEvent(new Event('input',{bubbles:true}));
    });
  }
  return <div className="team-report-filters" onReset={()=>setDraft(initial)}>
    <nav className="team-period-shortcuts" aria-label="Quick report dates">
      {[["Today",dates.today],["Last 7 days",dates.week],["This month",dates.month],["All time",""]].map(([label,from]) => <Link key={label}
        href={"/dashboard/team?" + searchQuery({...applied,range:from ? undefined : "all",date_from:from || undefined,date_to:from ? dates.today : undefined})}
        aria-current={from ? filters.range !== "all" && filters.date_from === from && filters.date_to === dates.today ? "date" : undefined : filters.range === "all" ? "date" : undefined}>{label}</Link>)}
    </nav>
    <FilterForm action="/dashboard/team" applied={applied} preserveKeys={["range","date_from","date_to","activity_caller"]} savedViews={false} labels={{range:"",date_from:"",date_to:"",person:"Caller",access:"Access",activity_channel:"Channel",activity_caller:""}}>
    {applied.activity_caller && <input type="hidden" name="activity_caller" value={applied.activity_caller}/>}
    <input type="hidden" name="range" value={allTime?'all':''}/>
    <span className="filter-context">{filters.range==='all'?'All time':<>{shortDate(`${filters.date_from}T00:00:00+05:30`)} – {shortDate(`${filters.date_to}T00:00:00+05:30`)}</>} <span className="muted">IST</span></span>
    <FiltersToggle count={countFilters(applied,["person","access","activity_channel"])}/><ApplyButton/>
    <FilterPanel groups={[
      { label: "Team", count: countFilters(applied,["person","access"]), content: <>
        <SelectFilter name="person" label="Caller" applied={applied} any="All callers" options={people.map(p=>({value:p.email,label:p.name||p.email}))} />
        <SelectFilter name="access" label="Access" applied={applied} any="All callers" options={[{value:"active",label:"Current access"},{value:"removed",label:"Access removed"}]} />
        <SelectFilter name="activity_channel" label="Call channel" applied={applied} any="All channels" options={CALLYZER_STREAMS.map(stream=>({value:stream.key,label:stream.label}))} />
        <p className="filter-explanation">Call channel filters automatic activity. Recorded outcomes use the selected dates and caller.</p>
      </> },
      { label: "Dates", content: <>
        <div className="filter-presets" role="group" aria-label="Report date presets">{[["Today",dates.today,dates.today],["Yesterday",dates.yesterday,dates.yesterday],["Last 7 days",dates.week,dates.today],["This month",dates.month,dates.today]].map(([label,from,to])=><button type="button" className="btn-row" key={label} onClick={event=>setPeriod(event.currentTarget.closest('form')!,false,from,to)}>{label}</button>)}
          <button type="button" className="btn-row" aria-pressed={allTime} onClick={event=>setPeriod(event.currentTarget.closest('form')!,!allTime)}>All time</button>
        </div>
        <label>From<input aria-label="Report from" type="date" name="date_from" value={draft.from} onChange={event=>setDraft({...draft,from:event.target.value})} disabled={allTime} required={!allTime}/></label>
        <label>To<input aria-label="Report to" type="date" name="date_to" value={draft.to} onChange={event=>setDraft({...draft,to:event.target.value})} disabled={allTime} required={!allTime}/></label>
        <p className="filter-explanation">{allTime?'Includes all recorded history, including verification with an unknown date.':'Dates include the full day in IST.'}</p>
      </> },
    ]}/>
  </FilterForm></div>;
}
