"use client";
import { useCallback, useId, useState, type DragEvent } from "react";
import type { Board, BoardCard, BoardColumn } from "@/lib/board";
import { BOARD_PAGE_SIZE, boardHref, type BoardFilters, type ColumnLimits } from "@/lib/board-filters";
import { STRIKE_LIMIT, stageInfo, type Stage } from "@/lib/board-stages";
import { shortDate } from "@/lib/display";
import { useDashboardUI } from "../DashboardUI";
import { RequestError } from "../requests";
import { BoardPanel } from "./BoardPanel";
import { NEEDS_INPUT, requestMove, type InputStage } from "./board-requests";
import { JunkDigest } from "./JunkReview";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
// Admins see several callers' cards for one phone, so the caller is part of the identity.
const cardId = (card: BoardCard) => `${card.assignee}:${card.key}`;
const DRAG_TYPE = "application/x-callongo-card";

type Drag = { onStart: (card: BoardCard) => void; onEnd: () => void; onOver: (stage: Stage) => void; onDrop: (stage: Stage, event: DragEvent) => void;
  dragging: string | null; target: Stage | null; moving: string | null };

/** The signed-in person's own board; every card here is theirs, so cards never name a caller. */
export function BoardView({ board, proposals, filters, limits, showCalls }: {
  board: Board; proposals: { total: number; cards: BoardCard[] }; filters: BoardFilters; limits: ColumnLimits; showCalls: boolean;
}) {
  const { refresh, notify } = useDashboardUI();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [request, setRequest] = useState<{ stage: InputStage; token: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<Stage | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const cards = board.columns.flatMap(column => column.cards);
  const selected = cards.find(card => cardId(card) === selectedId) ?? null;

  const select = (id: string) => { setSelectedId(id); setRequest(null); };
  const close = useCallback(() => {
    const id = selectedId;
    setSelectedId(null); setRequest(null);
    // Return focus to the card that opened the panel, wherever it now sits.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id ?? "")}"]`)?.focus());
  }, [selectedId]);

  // Drag and drop is a shortcut for the panel's stage buttons, which stay the keyboard path.
  const drag: Drag = {
    dragging, target, moving,
    onStart: card => { setDragging(cardId(card)); setTarget(null); },
    onEnd: () => { setDragging(null); setTarget(null); },
    onOver: stage => setTarget(stage),
    onDrop: async (stage, event) => {
      const id = event.dataTransfer.getData(DRAG_TYPE) || dragging;
      setDragging(null); setTarget(null);
      const card = cards.find(candidate => cardId(candidate) === id);
      if (!card || card.stage === stage) return;
      if (NEEDS_INPUT.includes(stage)) { setSelectedId(cardId(card)); setRequest({ stage: stage as InputStage, token: Date.now() }); return; }
      setMoving(cardId(card));
      try { await requestMove(card, stage); refresh(); }
      catch (failure) {
        notify(failure instanceof Error ? failure.message : "Couldn't move the card. Try again.");
        if (failure instanceof RequestError && failure.code === "ASSIGNMENT_CONFLICT") refresh();
      } finally { setMoving(null); }
    },
  };

  return <>
    <JunkDigest total={proposals.total} cards={proposals.cards} />
    <div className={`board-body${selected ? " has-panel" : ""}${dragging ? " is-dragging" : ""}`}>
      <div className="board-scroller" role="region" aria-label="Board columns" tabIndex={0}>
        <div className="board-columns">{board.columns.map(column => <Column key={column.stage} column={column} filters={filters} limits={limits}
          selectedId={selected ? selectedId : null} onSelect={select} drag={drag} />)}</div>
      </div>
      {selected && <BoardPanel card={selected} onClose={close} request={request} showCalls={showCalls} />}
    </div>
  </>;
}

function Column({ column, filters, limits, selectedId, onSelect, drag }: {
  column: BoardColumn; filters: BoardFilters; limits: ColumnLimits; selectedId: string | null; onSelect: (id: string) => void; drag: Drag;
}) {
  const { navigate, pending } = useDashboardUI();
  const stage = stageInfo(column.stage);
  const id = useId();
  const remaining = column.total - column.cards.length;
  const accepts = (event: DragEvent) => !!drag.dragging || event.dataTransfer.types.includes(DRAG_TYPE);
  return <section id={`board-${column.stage}`} className={`board-column${drag.target === column.stage ? " drop-target" : ""}`}
    data-stage={column.stage} data-code={stage.code} aria-labelledby={`${id}-title`} aria-describedby={`${id}-count`}
    onDragOver={event => { if (!accepts(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (drag.target !== column.stage) drag.onOver(column.stage); }}
    onDrop={event => { if (!accepts(event)) return; event.preventDefault(); void drag.onDrop(column.stage, event); }}>
    <div className="board-column-head">
      <h2 id={`${id}-title`}><span className="board-code">{stage.code}</span> {stage.label}</h2>
      <span id={`${id}-count`} className="board-column-count" title={plural(column.total, "card")}>{column.total}</span>
    </div>
    <p className="board-column-hint">{stage.hint}</p>
    {column.cards.length ? <ol className="board-cards">{column.cards.map(card => <li key={cardId(card)}>
      <Card card={card} selected={cardId(card) === selectedId} moving={drag.moving === cardId(card)}
        onSelect={() => onSelect(cardId(card))} onDragStart={() => drag.onStart(card)} onDragEnd={drag.onEnd} />
    </li>)}</ol> : <p className="board-empty">No cards</p>}
    {remaining > 0 && <button type="button" className="btn-row board-more" disabled={pending}
      onClick={() => navigate(boardHref(filters, { ...limits, [column.stage]: column.limit + BOARD_PAGE_SIZE }))}>
      Show {Math.min(remaining, BOARD_PAGE_SIZE)} more
    </button>}
  </section>;
}

function Card({ card, selected, moving, onSelect, onDragStart, onDragEnd }: {
  card: BoardCard; selected: boolean; moving: boolean; onSelect: () => void; onDragStart: () => void; onDragEnd: () => void;
}) {
  const name = card.name?.trim() || "Unnamed owner";
  const meta = [card.city, card.tasks.length > 1 ? plural(card.tasks.length, "task") : null].filter(Boolean).join(" · ");
  const followUp = card.nextDueAt && !card.closed;
  return <button type="button" className={`board-card${card.closed ? " closed" : ""}${selected ? " selected" : ""}`} data-card-id={cardId(card)}
    aria-expanded={selected} aria-controls={selected ? "board-panel" : undefined} aria-busy={moving} onClick={onSelect}
    draggable={!moving} onDragEnd={onDragEnd} onDragStart={event => {
      event.dataTransfer.setData(DRAG_TYPE, cardId(card));
      event.dataTransfer.setData("text/plain", name);
      event.dataTransfer.effectAllowed = "move";
      onDragStart();
    }}>
    <span className="board-card-top">
      <strong className="board-card-name" title={name}>{name}</strong>
      {moving ? <span className="board-card-state">Moving…</span> : card.closed && <span className="board-card-state">Closed</span>}
    </span>
    <span className="board-card-phone">{card.phone || "No phone number"}</span>
    {meta && <span className="board-card-meta">{meta}</span>}
    {card.strikes > 0 && <Strikes count={card.strikes} proposed={card.proposedJunk} />}
    {(followUp || card.warehouseIds.length > 0) && <span className="board-card-foot">
      {followUp && <span className={`board-followup${card.overdue ? " overdue" : ""}`}>{card.overdue ? "Overdue · " : "Follow up "}{shortDate(card.nextDueAt)}</span>}
      {card.warehouseIds.length > 0 && <span className="board-wh" title={`Warehouse IDs: ${card.warehouseIds.join(", ")}`}>{plural(card.warehouseIds.length, "warehouse")}</span>}
    </span>}
  </button>;
}

/** Strike dots up to the limit; the written count carries the meaning, not the dots' color. */
function Strikes({ count, proposed }: { count: number; proposed: boolean }) {
  const label = count >= STRIKE_LIMIT ? `${count} strikes` : `${count} of ${STRIKE_LIMIT} strikes`;
  return <span className="board-card-strikes">
    <span className={`board-strikes${count >= STRIKE_LIMIT - 1 ? " warn" : ""}`} role="img" aria-label={label} title={label}>
      {Array.from({ length: STRIKE_LIMIT }, (_, index) => <span key={index} className={index < count ? "on" : undefined} />)}
      <span className="board-strikes-count" aria-hidden="true">{Math.min(count, 99)}/{STRIKE_LIMIT}</span>
    </span>
    {proposed && <span className="board-proposed">Proposed for Junk</span>}
  </span>;
}
