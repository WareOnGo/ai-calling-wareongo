"use client";

import { useEffect, useState } from "react";
import { requestJson, RequestError } from "../../requests";
import { Dialog } from "./Dialog";

type WorkValues = { outcome: string; remarks: string; added_to_db: boolean; wh_id: string; state: string };
type SavedWorkValues = Omit<WorkValues, "outcome" | "remarks" | "wh_id"> & { outcome: string | null; remarks: string | null; wh_id: string | null };
type Latest = { revision: number; values: WorkValues };
export const workValues = (row: SavedWorkValues): WorkValues => ({
  outcome: row.outcome ?? "", remarks: row.remarks ?? "", added_to_db: row.added_to_db,
  wh_id: row.wh_id ?? "", state: row.state,
});
const fields: { key: keyof WorkValues; label: string }[] = [
  { key: "outcome", label: "Result" }, { key: "remarks", label: "Your notes" },
  { key: "added_to_db", label: "Added to database" }, { key: "wh_id", label: "Warehouse ID" },
  { key: "state", label: "Task status" },
];
const display = (value: string | boolean | undefined) => typeof value === "boolean" ? value ? "Added" : "Not yet" : value || "Empty";

export function AssignmentConflict({ url, draft, contactName, phone, onClose, onResolve, onDiscard, onUnavailable }: {
  url: string; draft: Partial<WorkValues>; contactName: string | null; phone: string | null; onClose: () => void;
  onResolve: (values: WorkValues, revision: number, keepDraft: boolean) => void; onDiscard: () => void;
  onUnavailable: () => void;
}) {
  const [latest, setLatest] = useState<Latest | null>(null);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLatest(null); setError(""); setUnavailable(false);
    void requestJson<SavedWorkValues & { revision: number }>(url, { cache: "no-store" }).then(row => {
      if (!cancelled) setLatest({ revision: row.revision, values: workValues(row) });
    }).catch(error => {
      if (cancelled) return;
      const missing = error instanceof RequestError && error.status === 404;
      setUnavailable(missing);
      if (missing) onUnavailable();
      setError(error instanceof Error ? error.message : "Couldn't load the latest version.");
    });
    return () => { cancelled = true; };
  }, [url, attempt, onUnavailable]);

  return <Dialog title="Review unsaved changes" onClose={onClose}>
    <div className="modal-body detail-body">
      <p className="detail-text"><strong>{contactName || "Unnamed contact"}</strong><br />{phone || "No phone number"}</p>
      {!latest && !error && <p role="status">Loading the latest version…</p>}
      {error && <p role="alert">{error}</p>}
      {unavailable && <p>Your draft is below so you can copy it before discarding it.</p>}
      {latest && <p>Saving your changes replaces the saved values shown below.</p>}
      {(latest || unavailable) && fields.filter(({ key }) => key in draft).map(({ key, label }) => <section className="detail-history" key={key}>
        <h3>{label}</h3>
        {latest && <><strong>Latest saved</strong><p className="detail-text">{display(latest.values[key])}</p></>}
        <strong>Your change</strong><p className="detail-text">{display(draft[key])}</p>
      </section>)}
    </div>
    <div className="modal-foot">
      {(latest || unavailable) && <p className="confirm-msg">Discards all unsaved edits in this row.</p>}
      <button type="button" className="btn secondary" onClick={onClose}>Keep draft</button>
      {error && !unavailable && <button type="button" className="btn" onClick={() => setAttempt(n => n + 1)}>Retry loading</button>}
      {unavailable && <button type="button" className="btn secondary" onClick={onDiscard}>Discard row edits</button>}
      {latest && <>
        <button type="button" className="btn secondary" onClick={() => onResolve(latest.values, latest.revision, false)}>Discard row edits</button>
        <button type="button" className="btn" onClick={() => onResolve(latest.values, latest.revision, true)}>Save my changes</button>
      </>}
    </div>
  </Dialog>;
}
