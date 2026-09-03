"use client";

import { useState } from "react";

// Takes an open assignment back. Confirms first — the employee may already have
// called, and the work disappears from their queue the moment this lands.
export function UnassignButton({ id, who }: { id: string; who: string }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function go() {
    setBusy(true);
    try {
      const res = await fetch(`/api/assignments/${id}`, { method: "DELETE" });
      if (res.ok) location.reload();
      else setBusy(false);
    } catch { setBusy(false); }
  }

  if (!confirming) {
    return (
      <button type="button" className="btn-row" onClick={() => setConfirming(true)}
        title={`Take this back from ${who}`}>
        Unassign
      </button>
    );
  }
  return (
    <span className="confirm-inline">
      <button type="button" className="btn-row danger" disabled={busy} onClick={go}>
        {busy ? "…" : "Confirm"}
      </button>
      <button type="button" className="btn-row" onClick={() => setConfirming(false)}>Cancel</button>
    </span>
  );
}
