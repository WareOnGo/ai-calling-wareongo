import { STAGES } from "@/lib/board-stages";

// Same geometry as the loaded board, so the columns do not jump when data arrives.
export default function Loading() {
  return <><span className="sr-only" role="status">Loading the board…</span>
    <div className="loading-page board-loading" data-loading-view="board" aria-hidden="true" inert>
      <header className="records-header"><div className="records-heading"><div className="records-heading-top">
        <h1 className="page-title">Board</h1><span className="title-sub"><span className="skeleton skeleton-inline" style={{ width: 56, height: 14 }} /></span>
      </div></div></header>
      <div className="filterbar records-toolbar"><div className="toolbar-search"><span className="skeleton" style={{ width: 260, height: 32 }} /></div></div>
      <div className="board-scroller"><div className="board-columns">{STAGES.map(stage => <section key={stage.slug} className="board-column" data-stage={stage.slug}>
        <div className="board-column-head"><h2><span className="board-code">{stage.code}</span> {stage.label}</h2></div>
        <ol className="board-cards">{[0, 1, 2].map(index => <li key={index}><div className="board-card"><span className="skeleton" style={{ width: "70%", height: 14 }} /><span className="skeleton" style={{ width: "50%", height: 12 }} /></div></li>)}</ol>
      </section>)}</div></div>
    </div></>;
}
