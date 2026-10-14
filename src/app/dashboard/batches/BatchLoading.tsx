"use client";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { searchValues } from "@/lib/filter-values";
import { BatchFilters } from "./BatchFilters";
import { BatchMemberFilters } from "./BatchMemberFilters";
import { RecordsHeader } from "../RecordsHeader";
import { WalletBalance } from "../WalletBalance";
import { ContactCardSkeleton } from "../ContactCard";

const Skeleton = ({ width = "70%", height = 12 }: { width?: string | number; height?: number }) => <span className="skeleton" style={{ width, height }}/>;

export function BatchLoading() {
  const path = usePathname().split("/"), search = useSearchParams();
  const detail = !!path[4], manual = (path[3] || search.get("kind")) === "manual";
  const title = detail ? (path[4] === "legacy" ? "Legacy / no recorded batch" : `${manual ? "Manual" : "AI"} batch ${path[4].slice(0, 8)}`) : "Batches";
  return <><span className="sr-only" role="status">Loading {detail ? "batch details" : "batches"}…</span>
    <div className="loading-page" data-loading-view={detail ? "batch-detail" : "batches"} aria-hidden="true" inert>
      {detail && <div className="batch-breadcrumb">← Back to {manual ? "manual" : "AI"} batches</div>}
      <RecordsHeader title={title} meta={detail ? <p className="batch-lead"><Skeleton width={260}/></p> : !manual ? <WalletBalance compact placeholder/> : undefined}
        actions={<span className="freshness"><Skeleton width={140}/><button className="btn-row" disabled>Refresh</button></span>}
        tabs={!detail && <nav className="batch-tabs" aria-label="Batch type"><Link href="/dashboard/batches?kind=ai" aria-current={!manual ? "page" : undefined}>AI batches</Link><Link href="/dashboard/batches?kind=manual" aria-current={manual ? "page" : undefined}>Manual batches</Link></nav>}/>
      {detail ? <>
        <div className="batch-detail-tools"><span className="batch-metadata">Batch information</span><Skeleton width={170}/></div>
        <div className="batch-metrics">{(manual ? ["Workload", "Outcomes", "Follow-up & review"] : ["Call progress", "Latest results", "Needs attention"]).map(title => <section className="batch-metric-group" key={title}><h2>{title}</h2><div>{Array.from({ length: manual && title === "Follow-up & review" ? 4 : 3 }, (_, i) => <div className="stat" key={i}><Skeleton width={40} height={24}/><Skeleton width="90%"/></div>)}</div></section>)}</div>
        <div className="batch-context-row"><Skeleton width={270}/></div><BatchMemberFilters path={path.join("/")} applied={searchValues(new URLSearchParams(search.toString()))} kind={manual?"manual":"ai"} options={{states:[],callers:[],owners:[]}} /><div className="batch-results-heading"><Skeleton width={180}/></div>
        <div className="gridwrap batch-grid"><table className="sheet"><thead><tr>{["Contact", ...(manual ? ["Original caller / current owner", "Allocation"] : []), manual ? "State" : "Call status", manual ? "Manual result" : "AI result", "Recorded attempts"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{Array.from({ length: 6 }, (_, row) => <tr key={row}>{Array.from({ length: manual ? 6 : 4 }, (_, col) => <td key={col}>{col === 0 ? <ContactCardSkeleton metadata/> : <Skeleton/>}</td>)}</tr>)}</tbody></table></div>
      </> : <>
        <BatchFilters applied={searchValues(new URLSearchParams(search.toString()))} kind={manual ? "manual" : "ai"} people={[]} />
        <div className="batch-results-heading"><Skeleton width={180}/></div>
        <div className="batch-catalog">{Array.from({ length: 6 }, (_, index) => <article className="batch-card" key={index}><h2><Skeleton width="80%" height={18}/></h2><p className="batch-card-context"><Skeleton width={70}/></p><div className="batch-card-progress"><Skeleton width="90%"/><Skeleton width="100%" height={5}/></div><dl className="batch-card-facts">{["Created", "Scheduled", "Created by"].map(label => <div key={label}><dt>{label}</dt><dd><Skeleton width="90%"/></dd></div>)}</dl><div className="batch-card-foot"><Skeleton width={100}/><Skeleton width={80}/></div></article>)}</div>
      </>}
    </div>
  </>;
}
