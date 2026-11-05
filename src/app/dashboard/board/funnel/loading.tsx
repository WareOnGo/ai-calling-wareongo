// Same header and KPI geometry as the loaded funnel.
export default function Loading() {
  return <><span className="sr-only" role="status">Loading the funnel…</span>
    <div className="loading-page" data-loading-view="funnel" aria-hidden="true" inert>
      <header className="records-header"><div className="records-heading"><div className="records-heading-top"><h1 className="page-title">Funnel by caller</h1></div></div></header>
      <div className="funnel-page">
        <dl className="funnel-kpis">{["Total leads", "Reached warehouse ID", "Warehouse IDs created", "Awaiting details"].map(label =>
          <div key={label} className="funnel-kpi"><dt>{label}</dt><dd><span className="skeleton" style={{ width: 48, height: 24 }} /></dd></div>)}</dl>
        <span className="skeleton" style={{ width: "100%", height: 160 }} />
      </div>
    </div></>;
}
