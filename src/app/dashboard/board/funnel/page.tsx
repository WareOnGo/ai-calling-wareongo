import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import type { SearchValues } from "@/lib/filter-values";
import { boardFilterOptions } from "@/lib/board";
import { loadFunnel, type FunnelCounts } from "@/lib/board-funnel";
import { boardHref, boardSearchValues, parseBoardFilters } from "@/lib/board-filters";
import { STAGES } from "@/lib/board-stages";
import { BoardHeader } from "../BoardHeader";
import { BoardFilters } from "../BoardFilters";

export const dynamic = "force-dynamic";

const percent = (value: number) => `${Math.round(value * 100)}%`;

// Admin roll-up of the same cards the board shows, plus finished work in every stage.
export default async function FunnelPage({ searchParams }: { searchParams: Promise<SearchValues> }) {
  const user = await requireAdmin();
  const filters = parseBoardFilters(await searchParams, user);
  delete filters.q; // The funnel has no free-text search.
  const [{ rows, totals }, options] = await Promise.all([loadFunnel(user, filters), boardFilterOptions(user)]);
  return <>
    <BoardHeader view="funnel" isAdmin />
    <BoardFilters applied={boardSearchValues(filters)} options={options} isAdmin action="/dashboard/board/funnel" search={false} />
    <div className="funnel-page">
      <dl className="funnel-kpis">
        <Kpi label="Total leads" value={String(totals.leads)} note="One per caller and phone" />
        <Kpi label="Reached warehouse ID" value={percent(totals.reachedWarehouse)} note={`${totals.warehouseLeads} ${totals.warehouseLeads === 1 ? "lead" : "leads"}`} />
        <Kpi label="Warehouse IDs created" value={String(totals.warehouseIdCount)} note="Each ID counted once" />
        <Kpi label="Awaiting details" value={String(totals.awaiting)} note="Confirmed available; follow up" />
      </dl>
      {rows.length ? <div className="funnel-table-wrap" role="region" aria-label="Funnel by caller" tabIndex={0}>
        <table className="funnel-table">
          <thead><tr>
            <th scope="col">Caller</th>
            {STAGES.map(stage => <th key={stage.slug} scope="col" className="num" data-stage={stage.slug} title={stage.label}><span className="board-code">{stage.code}</span> {stage.short}</th>)}
            <th scope="col" className="num">Leads</th><th scope="col" className="num">To warehouse</th><th scope="col" className="num">Warehouse IDs</th><th scope="col">Funnel mix</th>
          </tr></thead>
          <tbody>{rows.map(row => <tr key={row.assignee}>
            <th scope="row"><Link href={boardHref({ assignee: [row.assignee] })} title={row.assignee}>{row.name || row.assignee}</Link></th>
            <Counts stages={row.stages} leads={row.leads} reached={row.reachedWarehouse} ids={row.warehouseIdCount} />
          </tr>)}</tbody>
          <tfoot><tr>
            <th scope="row">All callers</th>
            <Counts stages={totals.stages} leads={totals.leads} reached={totals.reachedWarehouse} ids={totals.warehouseIdCount} />
          </tr></tfoot>
        </table>
      </div> : <p className="board-empty">No leads match these filters.</p>}
      <p className="funnel-note">Credit for a warehouse ID goes to the caller whose lead reached stage 4.</p>
    </div>
  </>;
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="funnel-kpi"><dt>{label}</dt><dd>{value}</dd><dd className="funnel-kpi-note">{note}</dd></div>;
}

function Counts({ stages, leads, reached, ids }: { stages: FunnelCounts; leads: number; reached: number; ids: number }) {
  return <>
    {STAGES.map(stage => <td key={stage.slug} className="num">{stages[stage.slug]}</td>)}
    <td className="num funnel-leads">{leads}</td><td className="num">{percent(reached)}</td><td className="num">{ids}</td>
    {/* Decorative: every segment's number is already in the row. */}
    <td><span className="funnel-mix" aria-hidden="true">{STAGES.map(stage => stages[stage.slug] > 0 &&
      <span key={stage.slug} data-stage={stage.slug} style={{ flexGrow: stages[stage.slug] }} />)}</span></td>
  </>;
}
