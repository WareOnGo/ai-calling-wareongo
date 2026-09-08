"use client";
import { useEffect, useState } from "react";
import type { RawRow } from "@/lib/raw";
import type { CallRow } from "@/lib/calls";
import type { AssignmentHistoryRow } from "@/lib/assignments";
import { area, dateTime, rent } from "@/lib/display";
import { Dialog } from "./Dialog";
import { CopyText } from "./CopyText";
import { requestJson } from "./requests";

export function RecordDetails({ id, entity, label = "Details" }: { id: string; entity: "call" | "record"; label?: string }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="btn-row details-trigger" onClick={() => setOpen(true)} aria-label={`${label} for ${entity}`}>{label}</button>{open && <DetailContents id={id} entity={entity} onClose={() => setOpen(false)} />}</>;
}
function DetailContents({ id, entity, onClose }: { id: string; entity: "call" | "record"; onClose: () => void }) {
  const [data, setData] = useState<{ row: RawRow & CallRow; history: AssignmentHistoryRow[]; historyTotal: number } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [audioFailed, setAudioFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    requestJson(`/api/details/${entity}/${encodeURIComponent(id)}`, { signal: controller.signal }).then(setData).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [entity, id, attempt]);
  const r = data?.row;
  const phone = r ? entity === "record" ? r.phone : r.call_type === "inbound" ? r.from_number : r.to_number : null;
  const audio = r ? entity === "record" ? r.last_recording_url : r.recording_url : null;
  return <Dialog drawer wide title={r?.owner_name || "Record details"} onClose={onClose}>
    <div className="modal-body detail-body">
      {error ? <div role="alert"><p>{error}</p><button type="button" className="btn" onClick={() => setAttempt(n => n + 1)}>Retry</button></div> : !r ? <div role="status"><p>Loading details…</p>{[1,2,3,4].map(i => <p className="skeleton detail-skeleton" key={i} />)}</div> : <>
        <div className="detail-phone"><CopyText value={phone} label="phone number" />{phone && <a className="btn-row" href={`tel:${phone}`}>Call number</a>}</div>
        <dl className="detail-facts">{Object.entries({ "Location": entity === "record" ? [r.city,r.state].filter(Boolean).join(", ") : r.db_area || r.raw_city, "Size": area(entity === "record" ? r.area_sqft : r.built_up_area_sqft || r.raw_area_sqft), "Rent": rent(entity === "record" ? r.rent : r.expected_rent), "AI result": entity === "record" ? r.last_availability : r.availability, "Call connection": entity === "record" ? r.last_status : r.status, "Last call": dateTime(entity === "record" ? r.last_called_at : r.call_created_at) }).map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{v || "—"}</dd></div>)}</dl>
        {r.address && <section><h3>Address</h3><p>{r.address}</p></section>}
        <section><h3>AI notes</h3><p className="detail-text">{(entity === "record" ? r.last_notes : r.notes) || "No AI notes available."}</p></section>
        <section><h3>Recording</h3>{audio ? <><audio controls preload="none" src={audio} onError={() => setAudioFailed(true)} />{audioFailed && <p role="alert">Couldn't play this recording. <a href={audio} target="_blank" rel="noreferrer">Open recording</a></p>}</> : <p className="muted">No recording available.</p>}</section>
        <section><h3>Transcript</h3><p className="detail-text transcript">{(entity === "record" ? r.last_transcript : r.transcript) || "No transcript available."}</p></section>
        {r.raw_matches?.length ? <section><h3>Matched listings</h3>{r.raw_matches.map((m,i) => <div className="detail-history" key={i}><strong>{m.owner_name || "Unnamed owner"}</strong><p>{[m.warehouse_type,m.city,m.state,area(m.area_sqft)].filter(Boolean).join(" · ")}</p><p>{m.address}</p></div>)}</section> : null}
        {r.calls_history?.length ? <section><h3>Call history</h3>{r.calls_history.map((h,i) => <p key={i}>{dateTime(h.at)} · {h.status || "Unknown"} · {h.availability || "No result"}</p>)}</section> : null}
        <section><h3>Verification history</h3>{data!.history.length ? data!.history.map(h => <div className="detail-history" key={h.id}><strong>{h.assignee_name || h.assignee}</strong> · {h.state === 'dropped' ? 'unassigned' : h.state}<p>{dateTime(h.assigned_at)} · {h.outcome || "No result yet"}</p>{h.note && <p>Brief: {h.note}</p>}{h.remarks && <p className="detail-text">{h.remarks}</p>}<p>Verified in DB: {h.added_to_db ? "Yes" : "Not yet"}{h.wh_id ? ` · ${h.wh_id}` : ""}</p></div>) : <p className="muted">No verification history yet.</p>}{data!.historyTotal > data!.history.length && <p className="muted">Showing the latest {data!.history.length} of {data!.historyTotal} assignments.</p>}</section>
      </>}
    </div>
    <div className="modal-foot"><button type="button" className="btn-text" onClick={onClose}>Close details</button></div>
  </Dialog>;
}
