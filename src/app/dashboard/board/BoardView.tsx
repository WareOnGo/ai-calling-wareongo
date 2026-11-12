"use client";
import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from "react";
import type { Board, BoardCard, BoardColumn, BoardFilterOptions } from "@/lib/board";
import { BOARD_MAX_CARDS, BOARD_PAGE_SIZE, boardHref, boardSearchValues, nextColumnLimit, type BoardFilters, type ColumnLimits } from "@/lib/board-filters";
import { STRIKE_LIMIT, stageInfo, type Stage } from "@/lib/board-stages";
import { shortDate } from "@/lib/display";
import { useDashboardUI } from "../DashboardUI";
import { RequestError } from "../requests";
import { BoardPanel } from "./BoardPanel";
import { NEEDS_INPUT, cardId, requestMove, type InputStage } from "./board-requests";
import { JunkDigest } from "./JunkReview";
import { BoardEmployeePerspective } from "./BoardEmployeePerspective";
import { BoardFilters as Filters } from "./BoardFilters";
import type { WorkEmployee } from "../my/EmployeePerspective";
import { useBoardEntryConfirmation } from "./BoardEntryConfirmation";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
// Admins see several callers' cards for one phone, so the caller is part of the identity.
const DRAG_TYPE = "application/x-callongo-card";

type Drag = { onStart: (card: BoardCard) => void; onEnd: () => void; onOver: (stage: Stage) => void; onDrop: (stage: Stage, event: DragEvent) => void;
  dragging: string | null; target: Stage | null; moving: string | null; disabled: boolean };

/** Keyed by the selected person: entry confirmations survive filters, but never person changes. */
export function BoardView({ board, proposals, filters, limits, showCalls, employees, options }: {
  board: Board; proposals: { total: number; cards: BoardCard[] }; filters: BoardFilters; limits: ColumnLimits; showCalls: boolean;
  employees?: WorkEmployee[]; options: BoardFilterOptions;
}) {
  const { refresh, notify, navigate, hasDrafts } = useDashboardUI();
  const employee = employees?.find(person => person.email === filters.employee);
  const readOnly = !!filters.employee && !employee;
  const { confirmEntry, confirmation } = useBoardEntryConfirmation(employee);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [request, setRequest] = useState<{ stage: InputStage; token: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<Stage | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const cards = board.columns.flatMap(column => column.cards);
  const selected = cards.find(card => cardId(card) === selectedId) ?? null;

  // Columns page independently. Every request merges into one set of limits, so
  // two columns reaching their end together both grow; neither URL replaces the
  // other's. The set starts over when the filters change.
  const wanted = useRef<{ filters: string; limits: ColumnLimits }>({ filters: "", limits: {} });
  const filterKey = JSON.stringify(filters);
  const grow = useCallback((stage: Stage, limit: number) => {
    if (wanted.current.filters !== filterKey) wanted.current = { filters: filterKey, limits: {} };
    const asked = Math.max(limits[stage] ?? BOARD_PAGE_SIZE, wanted.current.limits[stage] ?? 0);
    if (asked >= limit) return;
    wanted.current.limits = { ...wanted.current.limits, [stage]: limit };
    const merged: ColumnLimits = { ...limits };
    for (const [key, value] of Object.entries(wanted.current.limits) as [Stage, number][]) merged[key] = Math.max(merged[key] ?? 0, value);
    navigate(boardHref(filters, merged), { replace: true });
  }, [filters, filterKey, limits, navigate]);

  const select = (id: string) => {
    if (hasDrafts()) { notify("Save or discard the notes before changing leads."); return; }
    setSelectedId(id); setRequest(null);
  };
  const close = useCallback(() => {
    if (hasDrafts()) { notify("Save or discard the notes before closing this lead."); return; }
    const id = selectedId;
    setSelectedId(null); setRequest(null);
    // Return focus to the card that opened the panel, wherever it now sits.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id ?? "")}"]`)?.focus());
  }, [selectedId, hasDrafts, notify]);

  // Drag and drop is a shortcut for the panel's stage buttons, which stay the keyboard path.
  const drag: Drag = {
    dragging, target, moving, disabled: readOnly,
    onStart: card => { if (readOnly || hasDrafts()) return; setDragging(cardId(card)); setTarget(null); },
    onEnd: () => { setDragging(null); setTarget(null); },
    onOver: stage => setTarget(stage),
    onDrop: async (stage, event) => {
      if (readOnly || hasDrafts()) return;
      const id = event.dataTransfer.getData(DRAG_TYPE) || dragging;
      setDragging(null); setTarget(null);
      const card = cards.find(candidate => cardId(candidate) === id);
      if (!card || card.stage === stage) return;
      if (NEEDS_INPUT.includes(stage)) { setSelectedId(cardId(card)); setRequest({ stage: stage as InputStage, token: Date.now() }); return; }
      if (!(await confirmEntry(card))) return;
      setMoving(cardId(card));
      try { await requestMove(card, stage, {}, filters.employee); refresh(); }
      catch (failure) {
        notify(failure instanceof Error ? failure.message : "Couldn't move the card. Try again.");
        if (failure instanceof RequestError && failure.code === "ASSIGNMENT_CONFLICT") refresh();
      } finally { setMoving(null); }
    },
  };

  return <>
    {employees && <BoardEmployeePerspective employees={employees} filters={filters} />}
    <Filters applied={boardSearchValues(filters)} options={options} />
    <JunkDigest total={proposals.total} cards={proposals.cards} readOnly={readOnly} employee={filters.employee} confirmEntry={confirmEntry} />
    <div className={`board-body${selected ? " has-panel" : ""}${dragging ? " is-dragging" : ""}`}>
      <div className="board-scroller" role="region" aria-label="Board columns" tabIndex={0}>
        <div className="board-columns">{board.columns.map(column => <Column key={column.stage} column={column} onGrow={grow}
          selectedId={selected ? selectedId : null} onSelect={select} drag={drag} />)}</div>
      </div>
      {selected && <BoardPanel card={selected} onClose={close} request={request} showCalls={showCalls} employee={filters.employee} readOnly={readOnly} confirmEntry={confirmEntry} />}
    </div>
    {confirmation}
  </>;
}

function Column({ column, onGrow, selectedId, onSelect, drag }: {
  column: BoardColumn; onGrow: (stage: Stage, limit: number) => void; selectedId: string | null; onSelect: (id: string) => void; drag: Drag;
}) {
  const { pending } = useDashboardUI();
  const stage = stageInfo(column.stage);
  const id = useId();
  const remaining = column.total - column.cards.length;
  // Reaching the end of the list loads this column's next page in place; the URL
  // is replaced, so Back leaves the board rather than unloading cards page by page.
  const next = nextColumnLimit(column.limit, column.total);
  const { list, end, near } = useNearEnd(next !== null);
  useEffect(() => { if (near && next !== null && !pending) onGrow(column.stage, next); }, [near, next, pending, onGrow, column.stage]);
  const accepts = (event: DragEvent) => !drag.disabled && (!!drag.dragging || event.dataTransfer.types.includes(DRAG_TYPE));
  return <section id={`board-${column.stage}`} className={`board-column${drag.target === column.stage ? " drop-target" : ""}`}
    data-stage={column.stage} data-code={stage.code} aria-labelledby={`${id}-title`} aria-describedby={`${id}-count`}
    onDragOver={event => { if (!accepts(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (drag.target !== column.stage) drag.onOver(column.stage); }}
    onDrop={event => { if (!accepts(event)) return; event.preventDefault(); void drag.onDrop(column.stage, event); }}>
    <div className="board-column-head">
      <h2 id={`${id}-title`}><span className="board-code">{stage.code}</span> {stage.label}</h2>
      <span id={`${id}-count`} className="board-column-count" title={plural(column.total, "card")}>{column.total}</span>
    </div>
    <p className="board-column-hint">{stage.hint}</p>
    {column.cards.length ? <ol ref={list} className="board-cards">{column.cards.map(card => <li key={cardId(card)}>
      <Card card={card} selected={cardId(card) === selectedId} moving={drag.moving === cardId(card)} readOnly={drag.disabled}
        onSelect={() => onSelect(cardId(card))} onDragStart={() => drag.onStart(card)} onDragEnd={drag.onEnd} />
    </li>)}{next !== null && <li ref={end} className="board-cards-end" aria-hidden="true" />}</ol> : <p className="board-empty">No cards</p>}
    {remaining > 0 && <p className="board-column-progress" role="status">
      {next === null ? `Showing the first ${BOARD_MAX_CARDS} of ${column.total}. Search or filter to find the rest.`
        : near && pending ? "Loading more cards…" : `Showing ${column.cards.length} of ${column.total}`}
    </p>}
  </section>;
}

/**
 * Whether the end of a scrolling list is within 240px of view. The list scrolls
 * on its own, so it is the observer's root; keyboard focus scrolls it as well.
 */
function useNearEnd(enabled: boolean) {
  const list = useRef<HTMLOListElement>(null);
  const end = useRef<HTMLLIElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!enabled || !list.current || !end.current) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root: list.current, rootMargin: "0px 0px 240px 0px" });
    observer.observe(end.current);
    return () => { observer.disconnect(); setNear(false); };
  }, [enabled]);
  return { list, end, near: enabled && near };
}

function Card({ card, selected, moving, readOnly, onSelect, onDragStart, onDragEnd }: {
  card: BoardCard; selected: boolean; moving: boolean; readOnly: boolean; onSelect: () => void; onDragStart: () => void; onDragEnd: () => void;
}) {
  const name = card.name?.trim() || "Unnamed owner";
  const meta = [card.city, card.tasks.length > 1 ? plural(card.tasks.length, "task") : null].filter(Boolean).join(" · ");
  const followUp = card.nextDueAt && !card.closed;
  return <button type="button" className={`board-card${card.closed ? " closed" : ""}${selected ? " selected" : ""}`} data-card-id={cardId(card)}
    aria-expanded={selected} aria-controls={selected ? "board-panel" : undefined} aria-busy={moving} onClick={onSelect}
    draggable={!readOnly && !moving} onDragEnd={readOnly ? undefined : onDragEnd} onDragStart={readOnly ? undefined : event => {
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
