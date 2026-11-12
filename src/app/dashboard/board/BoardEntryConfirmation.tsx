"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardCard } from "@/lib/board";
import type { WorkEmployee } from "../my/EmployeePerspective";
import { Dialog } from "../Dialog";
import { cardId } from "./board-requests";

export type ConfirmBoardEntry = (card: BoardCard) => Promise<boolean>;
/** Owned by BoardView, which is remounted when the selected employee changes. */
export function useBoardEntryConfirmation(employee?: WorkEmployee) {
  const confirmed = useRef(new Set<string>());
  const pending = useRef<{ key: string; resolve: (accepted: boolean) => void; trigger: HTMLElement | null } | null>(null);
  const [entry, setEntry] = useState<BoardCard | null>(null);

  const confirmEntry: ConfirmBoardEntry = useCallback(card => {
    if (!employee) return Promise.resolve(true);
    // A card stays the same entry across revisions, stages and task filters.
    const key = cardId(card);
    if (confirmed.current.has(key)) return Promise.resolve(true);
    if (pending.current) return Promise.resolve(false);
    return new Promise<boolean>(resolve => {
      pending.current = { key, resolve, trigger: document.activeElement as HTMLElement | null };
      setEntry(card);
    });
  }, [employee]);

  const finish = (accepted: boolean) => {
    const request = pending.current;
    if (!request) return;
    pending.current = null;
    if (accepted) confirmed.current.add(request.key);
    setEntry(null);
    request.resolve(accepted);
    // A notes save was waiting on the dialog. Let its controls unlock before
    // restoring focus when the admin cancels.
    if (!accepted) requestAnimationFrame(() => { if (request.trigger?.isConnected) request.trigger.focus(); });
  };
  useEffect(() => () => { pending.current?.resolve(false); pending.current = null; }, []);

  const confirmation = entry && employee ? <Dialog title="Edit this entry?" onClose={() => finish(false)}>
    <div className="modal-body">
      <p>Save changes to <strong>{entry.name?.trim() || "Unnamed owner"}</strong>{entry.phone && <> ({entry.phone})</>} in <strong>{employee.name || employee.email}</strong>&apos;s work?</p>
      <p>You can continue editing this entry without confirming again. Changes will be recorded as your edits, and the work stays assigned to this employee.</p>
    </div>
    <div className="modal-foot">
      <button type="button" className="btn secondary" onClick={() => finish(false)}>Cancel</button>
      <button type="button" className="btn" onClick={() => finish(true)}>Confirm and save</button>
    </div>
  </Dialog> : null;
  return { confirmEntry, confirmation };
}
