"use client";
import { useId } from "react";
import type { Board, BoardCard, BoardColumn } from "@/lib/board";
import { BOARD_PAGE_SIZE, boardHref, type BoardFilters, type ColumnLimits } from "@/lib/board-filters";
import { stageInfo } from "@/lib/board-stages";
import { shortDate } from "@/lib/display";
import { useDashboardUI } from "../DashboardUI";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function BoardView({ board, filters, limits, isAdmin }: { board: Board; filters: BoardFilters; limits: ColumnLimits; isAdmin: boolean }) {
  return <>
    <nav className="board-strip" aria-label="Cards per stage">{board.columns.map(column => {
      const stage = stageInfo(column.stage);
      return <a key={column.stage} className="board-strip-item" data-stage={column.stage} data-code={stage.code} href={`#board-${column.stage}`}
        onClick={event => { event.preventDefault(); document.getElementById(`board-${column.stage}`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" }); }}>
        <span className="board-code">{stage.code}</span><span className="board-strip-label">{stage.short}</span><span className="board-strip-count">{column.total}</span>
      </a>;
    })}</nav>
    <div className="board-scroller" role="region" aria-label="Board columns" tabIndex={0}>
      <div className="board-columns">{board.columns.map(column => <Column key={column.stage} column={column} filters={filters} limits={limits} isAdmin={isAdmin} />)}</div>
    </div>
  </>;
}

function Column({ column, filters, limits, isAdmin }: { column: BoardColumn; filters: BoardFilters; limits: ColumnLimits; isAdmin: boolean }) {
  const { navigate, pending } = useDashboardUI();
  const stage = stageInfo(column.stage);
  const id = useId();
  const remaining = column.total - column.cards.length;
  return <section id={`board-${column.stage}`} className="board-column" data-stage={column.stage} data-code={stage.code} aria-labelledby={`${id}-title`} aria-describedby={`${id}-count`}>
    <div className="board-column-head">
      <h2 id={`${id}-title`}><span className="board-code">{stage.code}</span> {stage.label}</h2>
      <span id={`${id}-count`} className="board-column-count" title={plural(column.total, "card")}>{column.total}</span>
    </div>
    <p className="board-column-hint">{stage.hint}</p>
    {column.cards.length ? <ol className="board-cards">{column.cards.map(card => <li key={`${card.assignee}:${card.key}`}><Card card={card} isAdmin={isAdmin} /></li>)}</ol>
      : <p className="board-empty">No cards</p>}
    {remaining > 0 && <button type="button" className="btn-row board-more" disabled={pending}
      onClick={() => navigate(boardHref(filters, { ...limits, [column.stage]: column.limit + BOARD_PAGE_SIZE }))}>
      Show {Math.min(remaining, BOARD_PAGE_SIZE)} more
    </button>}
  </section>;
}

function Card({ card, isAdmin }: { card: BoardCard; isAdmin: boolean }) {
  const name = card.name?.trim() || "Unnamed owner";
  const meta = [card.city, card.tasks.length > 1 ? plural(card.tasks.length, "task") : null].filter(Boolean).join(" · ");
  return <article className={`board-card${card.closed ? " closed" : ""}`} data-card={card.key}>
    <div className="board-card-top">
      <strong className="board-card-name" title={name}>{name}</strong>
      {card.closed && <span className="board-card-state">Closed</span>}
    </div>
    <div className="board-card-phone">{card.phone || "No phone number"}</div>
    {meta && <div className="board-card-meta">{meta}</div>}
    {(card.nextDueAt && !card.closed || card.warehouseIds.length > 0 || isAdmin) && <div className="board-card-foot">
      {card.nextDueAt && !card.closed && <span className={`board-followup${card.overdue ? " overdue" : ""}`}>
        {card.overdue ? "Overdue · " : "Follow up "}{shortDate(card.nextDueAt)}
      </span>}
      {card.warehouseIds.length > 0 && <span className="board-wh" title={`Warehouse IDs: ${card.warehouseIds.join(", ")}`}>{plural(card.warehouseIds.length, "warehouse")}</span>}
      {isAdmin && <span className="board-card-assignee" title={card.assignee}>{card.assigneeName || card.assignee}</span>}
    </div>}
  </article>;
}
