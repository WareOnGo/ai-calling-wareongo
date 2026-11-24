"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkItem } from "@/lib/employee-work";
import type { WorkEmployee } from "./EmployeePerspective";
import { Dialog } from "./classic/Dialog";

export type ConfirmWorkRow = (work: WorkItem) => Promise<boolean>;

// Match the beta board: confirm the first save for an entry, then remember it
// through filters and refresh. WorkLists remounts when the employee changes.
export function useWorkRowConfirmation(employee: WorkEmployee | undefined, viewKey: string) {
  const confirmed = useRef(new Set<string>());
  const pending = useRef<{ work: WorkItem; resolve: (accepted: boolean) => void }[]>([]);
  const [entry, setEntry] = useState<WorkItem | null>(null);
  const confirmRow: ConfirmWorkRow = useCallback(work => {
    if (!employee || confirmed.current.has(work.id)) return Promise.resolve(true);
    return new Promise<boolean>(resolve => {
      // The shared Save changes action requests several rows at once.
      pending.current.push({ work, resolve });
      if (pending.current.length === 1) setEntry(work);
    });
  }, [employee]);

  function finish(accepted: boolean) {
    const request = pending.current[0];
    if (!request || request.work !== entry) return;
    pending.current.shift();
    if (accepted) confirmed.current.add(request.work.id);
    setEntry(pending.current[0]?.work ?? null);
    request.resolve(accepted);
  }
  useEffect(() => {
    // Browser Back/Forward can replace the rows while a confirmation is open.
    // Cancel every pending save, but retain confirmations already granted here.
    setEntry(null);
    return () => { pending.current.splice(0).forEach(request => request.resolve(false)); };
  }, [viewKey]);

  const confirmation = entry && employee ? <Dialog key={entry.id} title="Edit this entry?" onClose={() => finish(false)}>
    <div className="modal-body">
      <p>Save changes to the {entry.entity === "call" ? "AI follow-up" : "listing"} for <strong>{entry.who?.trim() || "Unnamed owner"}</strong>{entry.phone && <> ({entry.phone})</>} in <strong>{employee.name || employee.email}</strong>&apos;s work?</p>
      <p>You can continue editing this row without confirming again. Changes will be recorded as your edits, and the work stays assigned to this employee.</p>
    </div>
    <div className="modal-foot">
      <button type="button" className="btn secondary" onClick={() => finish(false)}>Cancel</button>
      <button type="button" className="btn" onClick={() => finish(true)}>Confirm and save</button>
    </div>
  </Dialog> : null;
  return { confirmRow, confirmation };
}
