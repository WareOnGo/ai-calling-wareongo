"use client";

import { useState } from "react";
import { OUTCOMES } from "@/lib/scope";
import { IconCheck } from "./icons";

// The employee's editable cells for one unit of work: what they found, their notes,
// whether it made it into the warehouse DB and under which id, and whether they're
// finished.
//
// There is deliberately NO attempt counter. It shipped as a click-to-increment
// button and was dropped as noise — a number nobody acted on, costing a click each
// time. The DB columns remain but are never written.
//
// `added_to_db` / `wh_id` here are the EMPLOYEE's; the same-named columns on
// bolna_call_logs stay the admin's on Call Analytics. Different owners, same split
// as called_by vs assignee.

type Props = {
  assignmentId: string;
  outcome: string | null;
  remarks: string | null;
  addedToDb: boolean;
  whId: string | null;
  state?: string;
};

export function OutcomeCells({
  assignmentId, outcome, remarks, addedToDb, whId, state = "open",
}: Props) {
  const [outcomeV, setOutcome] = useState(outcome ?? "");
  const [remarksV, setRemarks] = useState(remarks ?? "");
  const [addedV, setAdded] = useState(addedToDb);
  const [whIdV, setWhId] = useState(whId ?? "");
  const [stateV, setState] = useState(state);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // `rollback` restores optimistic state on failure, so a control tracks the click
  // immediately instead of snapping back for a round trip.
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
      if (typeof data.state === "string") setState(data.state);
      setSave("saved");
      window.setTimeout(() => setSave("idle"), 1000);
    } catch {
      rollback?.();
      setSave("error");
    }
  }

  const status = save === "saving" ? "saving" : save === "error" ? "err" : save === "saved" ? "ok" : "";
  const done = stateV === "done";

  return (
    <>
      <td className={`edit-cell edit-first ${status}`}>
        <select
          className="field field-select"
          aria-label="Result of the call"
          value={outcomeV}
          onChange={(e) => {
            const prev = outcomeV;
            setOutcome(e.target.value);
            patch({ outcome: e.target.value }, () => setOutcome(prev));
          }}
        >
          <option value="">Not called yet</option>
          {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </td>

      <td className={`edit-cell ${status}`}>
        <input
          className="field"
          aria-label="Your notes"
          value={remarksV}
          placeholder="What did they say?"
          onChange={(e) => setRemarks(e.target.value)}
          onBlur={() => remarksV !== (remarks ?? "") && patch({ remarks: remarksV })}
        />
      </td>

      <td className={`edit-cell center ${status}`}>
        <label className="checkfield" title="Tick once this warehouse is in the database">
          <input
            type="checkbox"
            checked={addedV}
            onChange={(e) => {
              const prev = addedV;
              setAdded(e.target.checked);
              patch({ added_to_db: e.target.checked }, () => setAdded(prev));
            }}
          />
          <span>{addedV ? "Added" : "Not yet"}</span>
        </label>
      </td>

      <td className={`edit-cell ${status}`}>
        <input
          className="field field-narrow"
          aria-label="Warehouse ID"
          value={whIdV}
          placeholder="WH ID"
          onChange={(e) => setWhId(e.target.value)}
          onBlur={() => whIdV !== (whId ?? "") && patch({ wh_id: whIdV })}
        />
      </td>

      <td className={`edit-cell ${status}`}>
        <button
          type="button"
          className={`btn-done${done ? " is-done" : ""}`}
          aria-pressed={done}
          onClick={() => {
            const prev = stateV;
            const next = done ? "open" : "done";
            setState(next);
            patch({ state: next }, () => setState(prev));
          }}
          title={done ? "Reopen this one" : "Mark finished — it stays visible"}
        >
          <IconCheck size={14} /> {done ? "Done" : "Mark done"}
        </button>
      </td>
    </>
  );
}
