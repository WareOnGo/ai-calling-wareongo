"use client";
import { useCallback, useId, useState } from "react";
import type { Board, BoardCard, BoardColumn } from "@/lib/board";
import { BOARD_PAGE_SIZE, boardHref, type BoardFilters, type ColumnLimits } from "@/lib/board-filters";
import { stageInfo } from "@/lib/board-stages";
import { shortDate } from "@/lib/display";
import { useDashboardUI } from "../DashboardUI";
import { BoardPanel } from "./BoardPanel";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
// Admins see several callers' cards for one phone, so the caller is part of the identity.
const cardId = (card: BoardCard) => `${card.assignee}:${card.key}`;

export function BoardView({ board, filters, limits, isAdmin }: { board: Board; filters: BoardFilters; limits: ColumnLimits; isAdmin: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = board.columns.flatMap(column => column.cards).find(card => cardId(card) === selectedId) ?? null;
  const close = useCallback(() => {
    const id = selectedId;
    setSelectedId(null);
    // Return focus to the card that opened the panel, wherever it now sits.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id ?? "")}"]`)?.focus());
  }, [selectedId]);
  return <>
    <nav className="board-strip" aria-label="Cards per stage">{board.columns.map(column => {
      const stage = stageInfo(column.stage);
      return <a key={column.stage} className="board-strip-item" data-stage={column.stage} data-code={stage.code} href={`#board-${column.stage}`}
        onClick={event => { event.preventDefault(); document.getElementById(`board-${column.stage}`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" }); }}>
        <span className="board-code">{stage.code}</span><span className="board-strip-label">{stage.short}</span><span className="board-strip-count">{column.total}</span>
      </a>;
    })}</nav>
    <div className={`board-body${selected ? " has-panel" : ""}`}>
      <div className="board-scroller" role="region" aria-label="Board columns" tabIndex={0}>
        <div className="board-columns">{board.columns.map(column => <Column key={column.stage} column={column} filters={filters} limits={limits}
          isAdmin={isAdmin} selectedId={selected ? selectedId : null} onSelect={setSelectedId} />)}</div>
      </div>
      {selected && <BoardPanel card={selected} onClose={close} />}
    </div>
  </>;
}

function Column({ column, filters, limits, isAdmin, selectedId, onSelect }: {
  column: BoardColumn; filters: BoardFilters; limits: ColumnLimits; isAdmin: boolean; selectedId: string | null; onSelect: (id: string) => void;
}) {
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
    {column.cards.length ? <ol className="board-cards">{column.cards.map(card => <li key={cardId(card)}>
      <Card card={card} isAdmin={isAdmin} selected={cardId(card) === selectedId} onSelect={() => onSelect(cardId(card))} />
    </li>)}</ol> : <p className="board-empty">No cards</p>}
    {remaining > 0 && <button type="button" className="btn-row board-more" disabled={pending}
      onClick={() => navigate(boardHref(filters, { ...limits, [column.stage]: column.limit + BOARD_PAGE_SIZE }))}>
      Show {Math.min(remaining, BOARD_PAGE_SIZE)} more
    </button>}
  </section>;
}

function Card({ card, isAdmin, selected, onSelect }: { card: BoardCard; isAdmin: boolean; selected: boolean; onSelect: () => void }) {
  const name = card.name?.trim() || "Unnamed owner";
  const meta = [card.city, card.tasks.length > 1 ? plural(card.tasks.length, "task") : null].filter(Boolean).join(" · ");
  const followUp = card.nextDueAt && !card.closed;
  return <button type="button" className={`board-card${card.closed ? " closed" : ""}${selected ? " selected" : ""}`} data-card-id={cardId(card)}
    aria-expanded={selected} aria-controls={selected ? "board-panel" : undefined} onClick={onSelect}>
    <span className="board-card-top">
      <strong className="board-card-name" title={name}>{name}</strong>
      {card.closed && <span className="board-card-state">Closed</span>}
    </span>
    <span className="board-card-phone">{card.phone || "No phone number"}</span>
    {meta && <span className="board-card-meta">{meta}</span>}
    {(followUp || card.warehouseIds.length > 0 || isAdmin) && <span className="board-card-foot">
      {followUp && <span className={`board-followup${card.overdue ? " overdue" : ""}`}>{card.overdue ? "Overdue · " : "Follow up "}{shortDate(card.nextDueAt)}</span>}
      {card.warehouseIds.length > 0 && <span className="board-wh" title={`Warehouse IDs: ${card.warehouseIds.join(", ")}`}>{plural(card.warehouseIds.length, "warehouse")}</span>}
      {isAdmin && <span className="board-card-assignee" title={card.assignee}>{card.assigneeName || card.assignee}</span>}
    </span>}
  </button>;
}
