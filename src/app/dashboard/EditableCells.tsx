"use client";

import { useState } from "react";

type Props = {
  id: string;
  callStatus: string | null;
  calledBy: string | null;
  addedToDb: boolean;
  whId: string | null;
  calledByOptions: string[];
};

type Patch = Partial<{
  call_status: string;
  called_by: string;
  added_to_db: boolean;
  wh_id: string;
}>;

export function EditableCells({ id, callStatus, calledBy, addedToDb, whId, calledByOptions }: Props) {
  const [callStatusV, setCallStatus] = useState(callStatus ?? "");
  const [calledByV, setCalledBy] = useState(calledBy ?? "");
  const [addedV, setAdded] = useState(addedToDb);
  const [whIdV, setWhId] = useState(whId ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save(patch: Patch) {
    setState("saving");
    try {
      const res = await fetch(`/api/calls/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      setState(res.ok ? "saved" : "error");
      if (res.ok) window.setTimeout(() => setState("idle"), 800);
    } catch {
      setState("error");
    }
  }

  const cls = state === "saving" ? "saving" : state === "error" ? "err" : "";

  return (
    <>
      <td className={`edit ${cls}`}>
        <input
          className="cell-input"
          value={callStatusV}
          onChange={(e) => setCallStatus(e.target.value)}
          onBlur={(e) => { if (e.target.value !== (callStatus ?? "")) save({ call_status: e.target.value }); }}
        />
      </td>
      <td className={`edit ${cls}`}>
        <select
          className="cell-input"
          value={calledByV}
          onChange={(e) => { setCalledBy(e.target.value); save({ called_by: e.target.value }); }}
        >
          <option value=""></option>
          {calledByOptions.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </td>
      <td className={`edit center ${cls}`}>
        <input
          type="checkbox"
          checked={addedV}
          onChange={(e) => { setAdded(e.target.checked); save({ added_to_db: e.target.checked }); }}
        />
      </td>
      <td className={`edit ${cls}`}>
        <input
          className="cell-input"
          value={whIdV}
          onChange={(e) => setWhId(e.target.value)}
          onBlur={(e) => { if (e.target.value !== (whId ?? "")) save({ wh_id: e.target.value }); }}
        />
      </td>
    </>
  );
}
