"use client";
import { useEffect, useState } from "react";
import type { RawRow } from "@/lib/raw";
import type { CallRow } from "@/lib/calls";
import { dateTime } from "@/lib/display";
import { requestJson } from "../requests";
import { ResultBadge } from "../ResultBadge";
import { Transcript } from "../Transcript";

/**
 * The saved AI call summary from the call logs: result, notes, recording and
 * transcript. The panel's AI history offers it when no provider attempts exist,
 * as the full record does, using the same endpoint and markup.
 */
export function SavedAiSummary({ entity, id }: { entity: "record" | "call"; id: string }) {
  const [row, setRow] = useState<(RawRow & CallRow) | null>(null);
  const [error, setError] = useState("");
  const [audioFailed, setAudioFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    requestJson<{ row: RawRow & CallRow }>(`/api/details/${entity}/${encodeURIComponent(id)}?section=overview`, { signal: controller.signal })
      .then(value => setRow(value.row))
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Couldn't load the saved summary."); });
    return () => controller.abort();
  }, [entity, id]);
  if (error) return <p role="alert">{error}</p>;
  if (!row) return <p role="status" className="history-loading">Loading the saved summary…</p>;
  const record = entity === "record";
  const audio = record ? row.last_recording_url : row.recording_url;
  const transcript = record ? row.last_transcript : row.transcript;
  const status = record ? row.last_status : row.status;
  return <section className="detail-section ai-saved-summary" aria-label="Saved AI summary">
    <div className="detail-section-heading"><h3>{record ? "Saved AI summary" : "Selected call"}</h3><ResultBadge value={record ? row.last_availability : row.availability} empty="No AI result" /></div>
    <p className="ai-saved-meta">{dateTime(record ? row.last_called_at : row.call_created_at)}{status ? ` · ${status}` : ""}</p>
    <div className="detail-evidence"><h4>AI notes</h4><p className="detail-text">{(record ? row.last_notes : row.notes) || "No AI notes available."}</p></div>
    {audio && <div className="detail-evidence"><h4>Recording</h4><audio controls preload="none" src={audio} onError={() => setAudioFailed(true)} />
      {audioFailed && <p role="alert">Couldn&apos;t play this recording. <a href={audio} target="_blank" rel="noreferrer">Open recording</a></p>}</div>}
    {transcript ? <details className="detail-evidence"><summary>Transcript</summary><Transcript text={transcript} /></details>
      : <p className="detail-description">No transcript available.</p>}
  </section>;
}
