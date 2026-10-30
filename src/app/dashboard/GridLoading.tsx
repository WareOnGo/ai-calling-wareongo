"use client";
import { searchValues, filterValues } from "@/lib/filter-values";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useDashboardUI } from "./DashboardUI";
import { HubCards } from "./HubCards";
import { WorkLoading } from "./my/WorkLoading";
import { ContactCardSkeleton } from "./ContactCard";
import { TeamLoading } from "./team/TeamLoading";
import { AiReviewNotice } from "./GridNotices";
import { WalletBalance } from "./WalletBalance";
import { RecordsHeader } from "./RecordsHeader";
import { RecordsPagination } from "./RecordsPagination";
import { AssignmentColumns, AssignmentHeaders, AssignmentStats, AssignmentSummary } from "./assignments/AssignmentStructure";
import { AssignmentFilters } from "./assignments/AssignmentFilters";
import { AssigneeCardSkeleton } from "./assignments/AssigneeCard";
import { FILTER_LABELS, filterLabel, filterValue } from "./filter-labels";
import {
  ASSIGNMENT_COLUMNS, callColumns, RAW_COLUMNS,
  defaultColumnWidth, readColumnPreferences,
} from "./sheet-columns";
import { IconClipboard, IconDataset, IconDownload, IconFilter, IconPhone, IconPhoneOutgoing, IconUsers } from "./icons";

type View = "calls" | "raw" | "my" | "team" | "assignments" | "home";
const TITLES = { calls: "AI Calls", raw: "Raw Dataset", my: "My Work", team: "Team", assignments: "Assignments", home: "Dashboard" };

function Placeholder({ width = "70%", height = 10, className = "" }: { width?: number | string; height?: number; className?: string }) {
  return <span className={`skeleton ${className}`} style={{ width, height }} />;
}

function LoadingTitle({ view }: { view: Exclude<View, "home"> }) {
  const Icon = view === "calls" ? IconPhone : view === "raw" ? IconDataset : view === "team" ? IconUsers : IconClipboard;
  return <RecordsHeader title={TITLES[view]} icon={<Icon size={18}/>} status={view === "my" ? <Placeholder width={62}/> : undefined} meta={view === "raw" ? <WalletBalance placeholder compact/> : view === "calls" ? <AiReviewNotice count="…"/> : undefined} actions={<>{view === "raw" && <button type="button" className="btn-row" disabled>Recent batches</button>}<span className="freshness"><span className="loading-timestamp"><Placeholder width="100%"/></span><button type="button" className="btn-row" disabled>Refresh</button></span></>}/>;
}

function LoadingFilters({ view, admin }: { view: "calls" | "raw" | "assignments"; admin: boolean }) {
  const params = useSearchParams();
  const active = [...params.entries()].filter(([key, value]) => value && FILTER_LABELS[key]);
  const count = new Set(active.filter(([key]) => key !== "q").map(([key])=>key)).size;
  return <>
    <div className={`filterbar records-toolbar${active.length ? " has-filters" : ""}`}>
      <div className="toolbar-search">
      <div className="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <input disabled value={params.get("q") || ""} placeholder={`Search ${view === "raw" ? "records" : view}…`} />
      </div>
      <button type="button" className={`filters-toggle${count ? " active" : ""}`} disabled><IconFilter size={15} />Filters{count > 0 && <span className="fbadge">{count}</span>}</button>
      <button type="button" className="btn apply-button" disabled>Apply</button>
      <a className="btn-text toolbar-reset">Reset</a>
      </div>
      <div className="toolbar-view">
      {view !== "assignments" && <details className="column-menu"><summary>Columns</summary></details>}
      <details className="column-menu views-menu"><summary>Views</summary></details>
      </div>
      <div className="toolbar-actions">
      {view !== "assignments" && <button type="button" className="btn-export" disabled><IconDownload size={15} />Export CSV</button>}
      {view !== "assignments" && admin && <button type="button" className="btn-assign" disabled><IconUsers size={15} />Assign</button>}
      {view === "raw" && <button type="button" className="btn-export btn-dispatch" disabled><IconPhoneOutgoing size={15} />Queue for calling</button>}
      </div>
    </div>
    {active.length > 0 && <div className="applied-filters">
      {active.map(([key, value]) => <button type="button" className="filter-tag" key={`${key}:${value}`} disabled>{filterLabel(key, `/dashboard/${view}`)}: {filterValue(key, value)}<span>×</span></button>)}
      <button type="button" className="btn-text" disabled>Clear filters</button>
    </div>}
  </>;
}

function LoadingPager() {
  return <RecordsPagination page={1} pages={1} total={0} pageSize={50} applied={{}} empty="Loading results…"/>;
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
          {label === "Row" || label === "Select" ? <Placeholder width={label === "Row" ? 10 : 13} height={label === "Row" ? 10 : 13} /> : label === "Contact" ? <ContactCardSkeleton metadata={view === "calls"} /> : <Placeholder width={`${55 + ((row + index) % 3) * 15}%`} />}
        </td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

function LoadingAssignments() {
  const params = useSearchParams();
  const applied = searchValues(new URLSearchParams(params));
  const [columns,setColumns]=useState<ReturnType<typeof readColumnPreferences>|null>(null);
  useEffect(()=>setColumns(readColumnPreferences("/dashboard/assignments",["Select",...ASSIGNMENT_COLUMNS])),[]);
  return <>
    <AssignmentStats applied={applied} assignee={applied.assignee} state={applied.state} loading />
    <AssignmentFilters applied={applied} loading />
    {Object.entries(applied).some(([key, value]) => value && FILTER_LABELS[key]) && <div className="applied-filters">{Object.entries(applied).flatMap(([key,values]) => FILTER_LABELS[key]?filterValues(values).map(value=>[key,value]):[]).map(([key, value]) => <button type="button" className="filter-tag" key={`${key}:${value}`} disabled>{filterLabel(key, "/dashboard/assignments")}: {filterValue(key, value)}<span>×</span></button>)}<button type="button" className="btn-text" disabled>Clear filters</button></div>}
    <AssignmentSummary><Placeholder width={135} /></AssignmentSummary>
    <div className="gridwrap"><table className="sheet log-sheet assignment-sheet loading-log">
      <AssignmentColumns widths={columns?.widths} hidden={columns?.hiddenColumns}/><AssignmentHeaders hidden={columns?.hiddenColumns}/>
      <tbody>{Array.from({ length: 10 }, (_, row) => <tr className="skeleton-row" key={row}>
        <td className="selcol"><input type="checkbox" disabled/></td>{ASSIGNMENT_COLUMNS.map(label => <td key={label} className={`${columns?.hiddenColumns.includes(label)?"column-hidden ":""}${label === "Assignee" ? "assignment-person" : label === "Actions" ? "actions" : ""}`}>{label === "Assignee" ? <AssigneeCardSkeleton /> : label === "Contact" ? <ContactCardSkeleton /> : <Placeholder width={label === "Notes" || label === "Brief" ? "80%" : 45} />}</td>)}
      </tr>)}</tbody>
    </table></div>
    <LoadingPager />
  </>;
}

export function GridLoading({ view }: { view: View }) {
  const { isAdmin } = useDashboardUI();
  if (view === "my") return <WorkLoading/>;
  if (view === "team") return <TeamLoading/>;
  return <>
    <span className="sr-only" role="status">Loading {TITLES[view]}…</span>
    <div className="loading-page" data-loading-view={view} aria-hidden="true" inert>
      {view === "home" ? <HubCards isAdmin={isAdmin} loading /> : <>
        <LoadingTitle view={view} />
        {view === "assignments" ? <LoadingAssignments /> : <>
          <LoadingFilters view={view} admin={isAdmin} />
          {(view === "raw" || isAdmin) && <div className="selection-summary">Select rows for bulk actions</div>}
          <LoadingSheet view={view} admin={isAdmin} />
          <LoadingPager />
        </>}
      </>}
    </div>
  </>;
}
