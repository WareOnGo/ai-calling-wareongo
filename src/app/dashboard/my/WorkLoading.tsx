"use client";
import { useSearchParams } from "next/navigation";
import { parseWorkFilters } from "@/lib/employee-work-filters";
import { WorkColumns, WorkHeaders, WorkStatusBar, WorkResultSummary, WorkLegend } from "./WorkTableStructure";
import { WorkFilters } from "./WorkFilters";
import { WorkContext } from "./WorkContext";
import { AiCallStatus } from "./AiCallStatus";
import { IconClipboard } from "../icons";
function Placeholder({ width = "70%", height = 10, className = "" }: { width?: number | string; height?: number; className?: string }) {
  return <span className={`skeleton ${className}`} style={{ width, height }} />;
}

function LoadingWork() {
  const params = useSearchParams();
  const filters = parseWorkFilters(Object.fromEntries(params.entries()));
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
            <td className="edit-cell edit-first"><Placeholder width="100%" height={31} /></td>
            <td className="edit-cell notes-cell"><Placeholder width="100%" height={58} /></td>
            <td className="edit-cell center"><Placeholder width={48} height={14} /></td>
            <td className="edit-cell"><Placeholder width="100%" height={31} /></td>
            <td className="edit-cell"><Placeholder width="100%" height={28} /></td>
          </tr>)}</tbody>
        </table></div>
      </section>)}
    </div>
  </>;
}

export function WorkLoading() {
  return <><span className="sr-only" role="status">Loading My Work…</span>
    <div className="loading-page" data-loading-view="my" aria-hidden="true" inert>
      <div className="page-title"><span className="pt-icon"><IconClipboard size={18}/></span>My Work<span className="title-sub"><Placeholder width={62}/></span><span className="freshness"><span className="loading-timestamp"><Placeholder width="100%"/></span><button type="button" className="btn-row" disabled>Refresh</button></span></div>
      <LoadingWork/>
    </div></>;
}
