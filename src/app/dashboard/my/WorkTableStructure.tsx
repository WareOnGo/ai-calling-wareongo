import { IconPencil } from "../icons";
import Link from "next/link";
import { hasWorkCriteria, workHref, WORK_SORT_LABELS, type WorkFilters } from "@/lib/work-filters";

export function WorkColumns() {
  return <colgroup>
    <col style={{ width: 32 }} /><col style={{ width: "22%" }} />
    <col style={{ width: 170 }} /><col style={{ width: 140 }} /><col />
    <col style={{ width: 88 }} /><col style={{ width: 90 }} /><col style={{ width: 110 }} />
  </colgroup>;
}

export function WorkHeaders() {
  return <thead><tr className="colheads">
    <th className="rowgutter" aria-label="Row" /><th>Who to call</th><th>Phone / AI status</th>
    <th className="mine mine-first"><IconPencil size={12} />Result</th>
    <th className="mine">Your notes</th><th className="mine">In DB?</th>
    <th className="mine">WH ID</th><th className="mine">Finished?</th>
  </tr></thead>;
}

export function WorkLegend() {
  return <p className="legend">
    <span className="legend-sys">Assignment details</span> are read only.{" "}
    <span className="legend-mine"><IconPencil size={11} />Your updates</span> save automatically.
  </p>;
}

export function WorkStatusBar({ filters, total = 0, open = 0, loading = false }: { filters: WorkFilters; total?: number; open?: number; loading?: boolean }) {
  return <div className="work-status-bar"><nav className="work-tabs" aria-label="Work status">
    {[["all", "All", total], ["open", "Open", open], ["done", "Done", total - open]].map(([key, label, count]) => {
      const content = <>{label}<span>{loading ? <span className="skeleton skeleton-inline" style={{ width: 12, height: 10 }} /> : count.toLocaleString()}</span></>;
      return loading ? <a key={key} aria-current={(filters.view || "all") === key ? "page" : undefined}>{content}</a> : <Link key={key} href={workHref(filters, { view: key === "all" ? undefined : String(key) })} aria-current={(filters.view || "all") === key ? "page" : undefined}>{content}</Link>;
    })}
  </nav><span className="work-scope">{hasWorkCriteria(filters) ? "Counts match your filters" : "All assignments to you"}</span></div>;
}

export function WorkResultSummary({ filters, count = 0, loading = false }: { filters: WorkFilters; count?: number; loading?: boolean }) {
  return <div className="work-result-summary">
    <span>{loading ? <span className="skeleton" style={{ width: 145, height: 12 }} /> : <>{count.toLocaleString()} {filters.view ? `${filters.view} ` : ""}{count === 1 ? "assignment" : "assignments"}{hasWorkCriteria(filters) ? " matching filters" : ""}</>}</span>
    <span>{!filters.view && "Open work first · "}{WORK_SORT_LABELS[filters.sort || "newest"]}</span>
  </div>;
}
