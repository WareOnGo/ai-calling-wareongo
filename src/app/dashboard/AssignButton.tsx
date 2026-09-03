"use client";

import { useEffect, useState } from "react";
import { IconUsers, IconX } from "./icons";

// "Assign" — sits next to Export CSV on both grids and behaves the same way:
// checked rows win, otherwise the whole filtered set.
//
// Unlike the export (a GET navigation) this POSTs, and for the "all matching"
// scope it sends the FILTERS rather than ids or a count, so the server re-resolves
// the row set itself. Same rule as Bolna dispatch: the client picks the target,
// the server decides the rows.
//
// Scope lives inside the modal as a radio pair rather than a page-level
// "select all N" banner — the raw grid already has one of those for queue-for-
// calling, and a second banner would be ambiguous.

export type Assignee = { email: string; name: string | null };

type Result = {
  assignee: string;
  requested: number;
  assigned: number;
  reassigned: number;
  skipped: number;
  skippedNoPhone: number;
  capped: boolean;
};

export function AssignButton({
  entity,
  total,
  assignees,
}: {
  entity: "record" | "call";
  total: number;
  assignees: Assignee[];
}) {
  const [open, setOpen] = useState(false);
  const [selIds, setSelIds] = useState<string[]>([]);
  const [scope, setScope] = useState<"selected" | "all">("all");
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [reassign, setReassign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const label = entity === "record" ? "record" : "call";

  function openModal() {
    const boxes = document.querySelectorAll<HTMLInputElement>("tbody input.rowsel:checked");
    const ids = Array.from(boxes).map((b) => b.dataset.id ?? "").filter(Boolean);
    setSelIds(ids);
    setScope(ids.length > 0 ? "selected" : "all");
    setError(null);
    setResult(null);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const count = scope === "selected" ? selIds.length : total;

  async function submit() {
    if (!assignee || count === 0) return;
    setBusy(true);
    setError(null);
    try {
      // "all matching" → hand over the current query string as filters and let the
      // server resolve it; "selected" → the explicit ids.
      const filters = Object.fromEntries(new URLSearchParams(window.location.search));
      delete filters.page; // the assignment spans every page of the filtered set
      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entity_type: entity,
          assignee,
          note: note.trim() || undefined,
          reassign,
          ...(scope === "selected" ? { ids: selIds } : { filters }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setResult(data as Result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assign failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        // NOT btn-export: it shares that button's geometry via the CSS selector list,
        // but a button that assigns work should not claim the export class.
        className="btn-assign"
        onClick={openModal}
        disabled={total === 0 || assignees.length === 0}
        title={
          assignees.length === 0
            ? "No active users — add them under Team"
            : total === 0
              ? `No ${label}s to assign`
              : `Assign ${label}s (selected rows, or all if none selected)`
        }
      >
        <IconUsers size={15} /> Assign
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal confirm-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title"><IconUsers size={16} /> Assign {label}s</div>
              <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="Close">
                <IconX size={16} />
              </button>
            </div>

            {result ? (
              <>
                <div className="modal-body">
                  <p className="assign-done">
                    Assigned <strong>{result.assigned.toLocaleString()}</strong> {label}(s) to{" "}
                    <strong>{result.assignee}</strong>.
                  </p>
                  <ul className="assign-summary">
                    {result.reassigned > 0 && (
                      <li>{result.reassigned.toLocaleString()} taken from a previous owner</li>
                    )}
                    {result.skipped > 0 && (
                      <li className="warn">
                        {result.skipped.toLocaleString()} skipped — already assigned
                        {reassign ? " to this person" : " (tick “reassign” to take them over)"}
                      </li>
                    )}
                    {result.skippedNoPhone > 0 && (
                      <li className="warn">
                        {result.skippedNoPhone.toLocaleString()} left out — no phone number to call
                      </li>
                    )}
                    {result.capped && <li className="warn">Capped at the per-assign limit — run it again for the rest.</li>}
                  </ul>
                </div>
                <div className="modal-foot">
                  <span className="spacer" />
                  <button type="button" className="btn-primary" onClick={() => { setOpen(false); location.reload(); }}>
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="modal-body">
                  <div className="assign-scope">
                    <label className={scope === "selected" ? "active" : undefined}>
                      <input
                        type="radio"
                        checked={scope === "selected"}
                        disabled={selIds.length === 0}
                        onChange={() => setScope("selected")}
                      />
                      {selIds.length.toLocaleString()} selected on this page
                    </label>
                    <label className={scope === "all" ? "active" : undefined}>
                      <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} />
                      All {total.toLocaleString()} matching the current filters
                    </label>
                  </div>

                  <label className="assign-field">
                    <span>Assign to</span>
                    <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                      <option value="">Choose someone…</option>
                      {assignees.map((a) => (
                        <option key={a.email} value={a.email}>
                          {a.name ? `${a.name} — ${a.email}` : a.email}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="assign-field">
                    <span>Note (optional)</span>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="e.g. verify area + rent before adding to DB"
                    />
                  </label>

                  <label className="assign-check">
                    <input type="checkbox" checked={reassign} onChange={(e) => setReassign(e.target.checked)} />
                    Reassign rows already owned by someone else
                  </label>

                  {error && <p className="assign-error">{error}</p>}
                </div>
                <div className="modal-foot">
                  <span className="muted">{count.toLocaleString()} {label}(s)</span>
                  <span className="spacer" />
                  <button type="button" className="btn-text" onClick={() => setOpen(false)}>Cancel</button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy || !assignee || count === 0}
                    onClick={submit}
                  >
                    {busy ? "Assigning…" : `Assign ${count.toLocaleString()}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
