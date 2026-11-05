"use client";
import { useState } from "react";
import type { BoardCard } from "@/lib/board";
import { STRIKE_LIMIT } from "@/lib/board-stages";
import { useDashboardUI } from "../DashboardUI";
import { Dialog } from "../Dialog";
import { requestMove, sendJson, taskRefs } from "./board-requests";

const cardId = (card: BoardCard) => `${card.assignee}:${card.key}`;
const inDays = (days: number) => new Date(Date.now() + days * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export const leads = (count: number) => `${count} lead${count === 1 ? "" : "s"}`;

/** The daily digest: five-strike cards wait here until a person confirms or keeps trying. */
export function JunkDigest({ total, cards }: { total: number; cards: BoardCard[] }) {
  const [open, setOpen] = useState(false);
  if (!total && !open) return null;
  return <>
    {total > 0 && <section className="board-digest" aria-label="Junk proposals">
      <p>{leads(total)} {total === 1 ? "has" : "have"} {STRIKE_LIMIT} strikes and {total === 1 ? "is" : "are"} proposed for Junk. Nothing moves until you confirm.</p>
      <button type="button" className="btn secondary" onClick={() => setOpen(true)}>Review {leads(total)}</button>
    </section>}
    {open && <JunkReview cards={cards} total={total} onClose={() => setOpen(false)} />}
  </>;
}

function JunkReview({ cards, total, onClose }: { cards: BoardCard[]; total: number; onClose: () => void }) {
  const { refresh } = useDashboardUI();
  // Decided cards leave the list at once; the board refreshes behind the dialog.
  const [decided, setDecided] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const remaining = cards.filter(card => !decided.includes(cardId(card)));
  async function decide(card: BoardCard, action: () => Promise<unknown>) {
    setBusy(cardId(card)); setError("");
    try { await action(); setDecided(current => [...current, cardId(card)]); refresh(); }
    catch (failure) { setError(`${card.name || "This lead"}: ${failure instanceof Error ? failure.message : "Couldn't save the decision."}`); }
    finally { setBusy(null); }
  }
  return <Dialog title="Review Junk proposals" wide onClose={onClose} busy={!!busy}>
    <div className="modal-body board-review">
      <p className="board-review-intro">These leads had no answer on {STRIKE_LIMIT} different days. Move them to Junk, or choose when to try again.</p>
      {error && <p className="board-panel-error" role="alert">{error}</p>}
      {remaining.length ? <ul className="board-proposals">{remaining.map(card => <Proposal key={cardId(card)} card={card} busy={busy === cardId(card)}
        onJunk={() => decide(card, () => requestMove(card, "junk", { reason: "owner_unresponsive" }))}
        onKeep={day => decide(card, () => sendJson("/api/board/follow-up", "POST", { tasks: taskRefs(card.tasks.filter(task => task.state === "open")), next_due_at: `${day}T10:00:00+05:30` }))} />)}
      </ul> : <p className="board-empty">No leads waiting for review.</p>}
      {total > cards.length && <p className="board-review-intro">Showing the first {cards.length} of {total}. The rest appear as these are decided.</p>}
    </div>
    <div className="modal-foot"><span className="spacer" /><button type="button" className="btn secondary" onClick={onClose}>Close</button></div>
  </Dialog>;
}

function Proposal({ card, busy, onJunk, onKeep }: { card: BoardCard; busy: boolean; onJunk: () => void; onKeep: (day: string) => void }) {
  const [day, setDay] = useState(inDays(3));
  const name = card.name?.trim() || "Unnamed owner";
  return <li className="board-proposal" aria-busy={busy}>
    <div className="board-proposal-lead">
      <strong>{name}</strong>
      <span>{[card.phone, card.city].filter(Boolean).join(" · ")}</span>
      <span className="board-proposal-strikes">{card.strikes} strikes</span>
    </div>
    <div className="board-proposal-actions">
      <label className="board-field"><span>Try again on</span><input type="date" value={day} min={inDays(0)} onChange={event => setDay(event.target.value)} /></label>
      <button type="button" className="btn secondary" disabled={busy || !day} aria-label={`Keep trying ${name}`} onClick={() => onKeep(day)}>Keep trying</button>
      <button type="button" className="btn-primary" disabled={busy} aria-label={`Move ${name} to Junk`} onClick={onJunk}>Move to Junk</button>
    </div>
  </li>;
}
