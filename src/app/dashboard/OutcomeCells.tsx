"use client";

import { useState } from "react";
import { OUTCOMES } from "@/lib/scope";

// Editable cells for an assignment (the unit of work). Used on the employee's
// "My Work" grids, where a manually-dialled listing has no bolna_call_logs row —
// the outcome has to land on the assignment itself.
//
// Deliberately the same optimistic save-on-change pattern as EditableCells: PATCH
// per field, brief saved/error state, no form submit.

type Props = {
  assignmentId: string;   // bigint from pg — a URL segment, never arithmetic
  outcome: string | null;
  remarks: string | null;
  attempts: number;
  state?: string;
};

export function OutcomeCells({ assignmentId, outcome, remarks, attempts, state = "open" }: Props) {
  const [outcomeV, setOutcome] = useState(outcome ?? "");
  const [remarksV, setRemarks] = useState(remarks ?? "");
  const [attemptsV, setAttempts] = useState(attempts);
  const [stateV, setState] = useState(state);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // `rollback` runs if the request fails. Callers that own a controlled input update
  // their state BEFORE calling this (optimistically) and hand us the undo, so the
  // control tracks the click immediately instead of snapping back until the server
  // answers — a round trip during which a checkbox visibly un-ticks itself.
  async function patch(body: Record<string, unknown>, rollback?: () => void) {
    setSave("saving");
    try {
      const res = await fetch(`/api/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      // Trust the server's echo for anything it computes (attempts increments
      // server-side); the optimistic value stands otherwise.
      if (typeof data.attempts === "number") setAttempts(data.attempts);
      if (typeof data.state === "string") setState(data.state);
      setSave("saved");
      window.setTimeout(() => setSave("idle"), 800);
    } catch {
      rollback?.();
      setSave("error");
    }
  }

  const cls = save === "saving" ? "saving" : save === "error" ? "err" : "";

  return (
    <>
      <td className={`edit ${cls}`}>
        <select
          className="cell-input"
          value={outcomeV}
          onChange={(e) => { setOutcome(e.target.value); patch({ outcome: e.target.value }); }}
        >
          <option value="">—</option>
          {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </td>
      <td className={`edit ${cls}`}>
        <input
          className="cell-input"
          value={remarksV}
          placeholder="what they said…"
          onChange={(e) => setRemarks(e.target.value)}
          onBlur={() => remarksV !== (remarks ?? "") && patch({ remarks: remarksV })}
        />
      </td>
      <td className="edit">
        {/* "I tried" — server-side increment so two tabs can't clobber the count. */}
        <button type="button" className="btn-attempt" onClick={() => patch({ log_attempt: true })}>
          {attemptsV > 0 ? `${attemptsV}×` : "log"}
        </button>
      </td>
      <td className={`edit ${cls}`}>
        <label className="done-check">
          <input
            type="checkbox"
            checked={stateV === "done"}
            onChange={(e) => {
              const prev = stateV;
              const next = e.target.checked ? "done" : "open";
              setState(next);                              // optimistic
              patch({ state: next }, () => setState(prev)); // undo if it fails
            }}
          />
          Done
        </label>
      </td>
    </>
  );
}
