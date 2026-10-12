"use client";
import { searchValues, filterValues } from "@/lib/filter-values";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useDashboardUI } from "./DashboardUI";
import { HubCards } from "./HubCards";
import { WorkColumns, WorkHeaders, WorkLegend, WorkStatusBar, WorkResultSummary } from "./my/WorkTableStructure";
import { WorkFilters } from "./my/WorkFilters";
import { WorkContext } from "./my/WorkContext";
import { AiCallStatus } from "./my/AiCallStatus";
import { parseWorkFilters } from "@/lib/work-filters";
import { TeamAccessNote } from "./team/TeamStructure";
import { AiReviewNotice, AssignmentNotices, CallGridHint } from "./GridNotices";
import { WalletBalance } from "./WalletBalance";
import { AssignmentColumns, AssignmentHeaders, AssignmentStats } from "./assignments/AssignmentStructure";
import { AssignmentFilters } from "./assignments/AssignmentFilters";
import { FILTER_LABELS, filterLabel, filterValue } from "./filter-labels";
import {
  ASSIGNMENT_COLUMNS, callColumns, RAW_COLUMNS,
  defaultColumnWidth, readColumnPreferences,
} from "./sheet-columns";
import { IconClipboard, IconDataset, IconDownload, IconFilter, IconPhone, IconPhoneOutgoing, IconPlus, IconUsers } from "./icons";

type View = "calls" | "raw" | "my" | "team" | "assignments" | "home";
const TITLES = { calls: "Call Analytics", raw: "Raw Dataset", my: "My Work", team: "Team", assignments: "Assignments", home: "Dashboard" };

function Placeholder({ width = "70%", height = 10, className = "" }: { width?: number | string; height?: number; className?: string }) {
  return <span className={`skeleton ${className}`} style={{ width, height }} />;
}

function LoadingTitle({ view }: { view: Exclude<View, "home"> }) {
  const Icon = view === "calls" ? IconPhone : view === "raw" ? IconDataset : view === "team" ? IconUsers : IconClipboard;
  return <div className="page-title">
    <span className="pt-icon"><Icon size={18} /></span>{TITLES[view]}
    {(view === "my" || view === "team") && <span className="title-sub"><Placeholder width={view === "my" ? 62 : 77} /></span>}
    {view === "raw" && <button type="button" className="btn-row" disabled>Recent batches</button>}
    <span className="freshness"><span className="loading-timestamp"><Placeholder width="100%" /></span><button type="button" className="btn-row" disabled>Refresh</button></span>
  </div>;
}

function LoadingFilters({ view, admin }: { view: "calls" | "raw" | "assignments"; admin: boolean }) {
  const params = useSearchParams();
  const active = [...params.entries()].filter(([key, value]) => value && FILTER_LABELS[key]);
  const count = active.filter(([key]) => key !== "q").length;
  return <>
    <div className="filterbar">
      <div className="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <input disabled value={params.get("q") || ""} placeholder={`Search ${view === "raw" ? "records" : view}…`} />
      </div>
      <button type="button" className={`filters-toggle${count ? " active" : ""}`} disabled><IconFilter size={15} />Filters{count > 0 && <span className="fbadge">{count}</span>}</button>
      <button type="button" className="btn apply-button" disabled>Apply</button>
      {view !== "assignments" && <details className="column-menu"><summary>Columns</summary></details>}
      <span className="spacer" />
      {view !== "assignments" && <button type="button" className="btn-export" disabled><IconDownload size={15} />Export CSV</button>}
      {view !== "assignments" && admin && <button type="button" className="btn-assign" disabled><IconUsers size={15} />Assign</button>}
      {view === "raw" && <button type="button" className="btn-export btn-dispatch" disabled><IconPhoneOutgoing size={15} />Queue for calling</button>}
      <a className="btn-text">Reset</a>
      <details className="column-menu views-menu"><summary>Views</summary></details>
    </div>
    {active.length > 0 && <div className="applied-filters">
      {active.map(([key, value]) => <button type="button" className="filter-tag" key={`${key}:${value}`} disabled>{filterLabel(key, `/dashboard/${view}`)}: {filterValue(key, value)}<span>×</span></button>)}
      <button type="button" className="btn-text" disabled>Clear filters</button>
    </div>}
  </>;
}

function LoadingPager() {
  return <div className="pager">
    <Placeholder width={100} />
    <div className="pages"><button disabled>«</button><button disabled>‹</button><button disabled><Placeholder width={10} /></button><button disabled>›</button><button disabled>»</button></div>
  </div>;
}

function LoadingSheet({ view, admin }: { view: "calls" | "raw"; admin: boolean }) {
  const columns = view === "calls" ? callColumns(admin) : RAW_COLUMNS;
  const selectable = view === "raw" || admin;
  const labels = ["Row", ...(selectable ? ["Select"] : []), ...columns];
  const [preferences, setPreferences] = useState<{ widths: number[]; hiddenColumns: string[] } | null>(null);
  const key = `${view}:${admin}`;
  useEffect(() => {
    const path = `/dashboard/${view}`;
    const preferences = readColumnPreferences(path, labels);
    setPreferences(preferences);
    const initialStyles = document.getElementById(`loading-column-styles-${view}`);
    if (initialStyles) initialStyles.textContent = "";
    // Labels only change with view/role.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  function columnClass(label: string) {
    if (label === "Row") return "rowgutter";
    if (label === "Select") return "selcol";
    return preferences?.hiddenColumns.includes(label) ? "column-hidden" : "";
  }
  return <div className="gridwrap">
    <table className="sheet resizable loading-sheet">
      <colgroup>{labels.map((label, index) => <col key={label} className={columnClass(label)} style={{ width: preferences?.widths[index] ?? defaultColumnWidth(label) }} />)}</colgroup>
      <thead><tr className="colheads">{labels.map(label => <th key={label} className={columnClass(label)}>
        {label === "Row" ? null : label === "Select" ? <input type="checkbox" className="selall" disabled /> : label}
      </th>)}</tr></thead>
      <tbody>{Array.from({ length: 10 }, (_, row) => <tr className="skeleton-row" key={row}>
        {labels.map((label, index) => <td key={label} className={label === "Row" ? "rownum" : columnClass(label)}>
          {label === "Row" || label === "Select" || label === "Added" ? <Placeholder width={label === "Row" ? 10 : 13} height={label === "Row" ? 10 : 13} /> : <Placeholder width={`${55 + ((row + index) % 3) * 15}%`} />}
        </td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

function LoadingWork() {
  const params = useSearchParams();
  const filters = parseWorkFilters(searchValues(new URLSearchParams(params)));
  const sections = [["record", "Listings to call"], ["call", "AI calls to follow up"]].filter(([entity]) => !filters.type || filters.type === entity);
  return <>
    <WorkStatusBar filters={filters} loading />
    <WorkFilters filters={filters} loading />
    <WorkResultSummary filters={filters} loading />
    <WorkLegend />
    <div className="stacked work-content">
      {sections.map(([,title]) => <section className="worklist" key={title}>
        <h2 className="section-head">{title}<span className="count"><Placeholder width={65} /></span></h2>
        <div className="gridwrap"><table className="sheet task-sheet loading-work">
          <WorkColumns /><WorkHeaders />
          <tbody>{Array.from({ length: 2 }, (_, row) => <tr className="skeleton-row" key={row}>
            <td className="rownum"><Placeholder width={10} /></td>
            <td className="who"><div className="work-person-heading"><span className="who-name"><Placeholder width="85%" height={14} /></span><span className="btn-row details-trigger loading-detail-button">Details</span></div><WorkContext loading /><div className="work-assignment-note"><span className="work-note-label"><IconClipboard size={12} />Assigner&apos;s note</span><span className="brief"><Placeholder width="90%" /></span></div><div className="work-assigned-meta"><Placeholder width="65%" /><Placeholder width={35} /></div></td>
            <td className="work-phone"><Placeholder width="90%" /><AiCallStatus loading /></td>
            <td data-label="Result" className="edit-cell edit-first"><Placeholder width="100%" height={31} /></td>
            <td data-label="Your notes" className="edit-cell notes-cell"><Placeholder width="100%" height={58} /></td>
            <td data-label="In DB?" className="edit-cell center"><Placeholder width={48} height={14} /></td>
            <td data-label="WH ID" className="edit-cell"><Placeholder width="100%" height={31} /></td>
            <td data-label="Finished?" className="edit-cell"><Placeholder width="100%" height={28} /></td>
          </tr>)}</tbody>
        </table></div>
      </section>)}
    </div>
  </>;
}

function LoadingTeam() {
  return <div className="team-page"><section className="team-report" aria-hidden="true"><h2>Team performance</h2><div className="team-range"><Placeholder width={155} height={35}/><Placeholder width={155} height={35}/><Placeholder width={100} height={35}/></div><Placeholder width="80%"/><div className="team-report-grid" style={{height:210,marginTop:16}}><Placeholder width="100%" height={200}/></div><Placeholder width="100%" height={42}/></section><div className="team">
    <TeamAccessNote />
    <button type="button" className="btn-primary add-trigger" disabled><IconPlus size={15} />Add someone</button>
    {[
      ["Admins", "Full access — can assign work and manage this list."],
      ["Employees", "See only the work assigned to them."],
      ["No access", "Cannot sign in. Their past work is kept."],
    ].map(([title, hint]) => <section className="people-group" key={title}>
      <h2 className="group-head">{title}<span className="count"><Placeholder width={10} /></span><span className="group-hint">{hint}</span></h2>
      <ul className="people">{Array.from({ length: title === "Employees" ? 2 : 1 }, (_, index) => <li className="person skeleton-row" key={index}>
        <span className="avatar skeleton" />
        <span className="person-id"><span className="person-name"><Placeholder width={115} height={15} /></span><span className="person-email"><Placeholder width={150} /></span></span>
        <span className="person-load"><Placeholder width={65} height={title === "Employees" ? 18 : 14} /></span>
        <span className="person-role"><Placeholder width="100%" height={33} /></span>
        <span className="switch"><Placeholder width="100%" height={17} /></span>
      </li>)}</ul>
    </section>)}
  </div></div>;
}

function LoadingAssignments() {
  const params = useSearchParams();
  const applied = searchValues(new URLSearchParams(params));
  const [columns,setColumns]=useState<ReturnType<typeof readColumnPreferences>|null>(null);
  useEffect(()=>setColumns(readColumnPreferences("/dashboard/assignments",["Row",...ASSIGNMENT_COLUMNS])),[]);
  return <>
    <AssignmentStats assignee={applied.assignee} state={applied.state} loading />
    <AssignmentFilters applied={applied} loading />
    {Object.entries(applied).some(([key, value]) => value && FILTER_LABELS[key]) && <div className="applied-filters">{Object.entries(applied).flatMap(([key,values]) => FILTER_LABELS[key]?filterValues(values).map(value=>[key,value]):[]).map(([key, value]) => <button type="button" className="filter-tag" key={`${key}:${value}`} disabled>{filterLabel(key, "/dashboard/assignments")}: {filterValue(key, value)}<span>×</span></button>)}<button type="button" className="btn-text" disabled>Clear filters</button></div>}
    <AssignmentNotices />
    <div className="assignment-summary"><Placeholder width={135} /><span>Newest first</span></div>
    <div className="gridwrap"><table className="sheet log-sheet assignment-sheet loading-log">
      <AssignmentColumns widths={columns?.widths} hidden={columns?.hiddenColumns}/><AssignmentHeaders hidden={columns?.hiddenColumns}/>
      <tbody>{Array.from({ length: 10 }, (_, row) => <tr className="skeleton-row" key={row}>
        <td className="rownum"><Placeholder width={10} /></td>{ASSIGNMENT_COLUMNS.map(label => <td key={label} className={`${columns?.hiddenColumns.includes(label)?"column-hidden ":""}${label === "Assignee" ? "assignment-person" : label === "Actions" ? "actions" : ""}`}>{label === "Assignee" ? <><span className="assignee-name"><Placeholder width={110} height={14} /></span><span className="assignee-email"><Placeholder width={140} /></span></> : <Placeholder width={label === "Who" || label === "Notes" || label === "Brief" ? "80%" : label === "Phone" ? 120 : 45} />}</td>)}
      </tr>)}</tbody>
    </table></div>
    <LoadingPager />
  </>;
}

export function GridLoading({ view }: { view: View }) {
  const { isAdmin } = useDashboardUI();
  return <>
    <span className="sr-only" role="status">Loading {TITLES[view]}…</span>
    <div className="loading-page" data-loading-view={view} aria-hidden="true" inert>
      {view === "home" ? <HubCards isAdmin={isAdmin} loading /> : <>
        <LoadingTitle view={view} />
        {view === "raw" && <WalletBalance placeholder />}
        {view === "calls" && <AiReviewNotice count="…" />}
        {view === "my" ? <LoadingWork /> : view === "team" ? <LoadingTeam /> : view === "assignments" ? <LoadingAssignments /> : <>
          <LoadingFilters view={view} admin={isAdmin} />
          {(view === "raw" || isAdmin) && <div className="selection-summary">Select rows for bulk actions</div>}
          {view === "calls" && <CallGridHint />}
          <LoadingSheet view={view} admin={isAdmin} />
          <LoadingPager />
        </>}
      </>}
    </div>
  </>;
}
