"use client";
import { AiTimeline } from "./AiTimeline";
import { useEffect, useState } from "react";
import type { RawRow } from "@/lib/raw";
import type { CallRow } from "@/lib/calls";
import type { AssignmentHistoryRow } from "@/lib/assignments";
import type { ManualAttempt } from "@/lib/manual-attempts";
import { DISPOSITION_LABELS,type Disposition } from "@/lib/manual-dispositions";
import { area, dateTime, rent } from "@/lib/display";
import { Dialog } from "./Dialog";
import { CopyText } from "./CopyText";
import { requestJson } from "./requests";

export function RecordDetails({ id, entity, label = "Details", aiBatch,aiScope }: { aiBatch?:string;aiScope?:"contact"|"execution";id: string; entity: "call" | "record"; label?: string }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="btn-row details-trigger" onClick={() => setOpen(true)} aria-label={`${label} for ${entity}`}>{label}</button>{open && <DetailContents aiBatch={aiBatch} aiScope={aiScope} initialAi={label==="AI timeline"} id={id} entity={entity} onClose={() => setOpen(false)} />}</>;
}
function DetailContents({ id, entity, onClose,initialAi,aiBatch,aiScope }: { aiBatch?:string;aiScope?:"contact"|"execution";initialAi:boolean;id: string; entity: "call" | "record"; onClose: () => void }) {
  const [data, setData] = useState<{ row: RawRow & CallRow; history: AssignmentHistoryRow[]; historyTotal: number; manual:{rows:ManualAttempt[];total:number;page:number;pages:number};
    relatedListings: { id: string; owner_name: string | null; city: string | null; state: string | null; area_sqft: string | null; address: string | null; source: string }[]; relatedListingsCapped: boolean } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [manualPage,setManualPage]=useState(1);
  const [audioFailed, setAudioFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    requestJson(`/api/details/${entity}/${encodeURIComponent(id)}?manual_page=${manualPage}`, { signal: controller.signal }).then(setData).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [entity, id, attempt,manualPage]);
  const r = data?.row;
  const phone = r ? entity === "record" ? r.phone : r.call_type === "inbound" ? r.from_number : r.to_number : null;
  const audio = r ? entity === "record" ? r.last_recording_url : r.recording_url : null;
  return <Dialog drawer wide title={r?.owner_name || "Record details"} onClose={onClose}>
    <div className="modal-body detail-body">
      {error ? <div role="alert"><p>{error}</p><button type="button" className="btn" onClick={() => setAttempt(n => n + 1)}>Retry</button></div> : !r ? <div role="status"><p>Loading details…</p>{[1,2,3,4].map(i => <p className="skeleton detail-skeleton" key={i} />)}</div> : <>
        <div className="detail-phone"><CopyText value={phone} label="phone number" />{phone && <a className="btn-row" href={`tel:${phone}`}>Call number</a>}</div>
        <dl className="detail-facts">{Object.entries({ "Location": entity === "record" ? [r.city,r.state].filter(Boolean).join(", ") : r.db_area || r.raw_city, ...(entity === "record" ? { "Size": area(r.area_sqft) } : { "Legacy Called By":r.called_by,"Built-up area": area(r.built_up_area_sqft), "Carpet area": area(r.carpet_area_sqft), "Listing area": area(r.raw_area_sqft) }), "Rent": rent(entity === "record" ? r.rent : r.expected_rent), "AI result": entity === "record" ? r.last_availability : r.availability, "Call connection": entity === "record" ? r.last_status : r.status, "Last call": dateTime(entity === "record" ? r.last_called_at : r.call_created_at) }).map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{v || "—"}</dd></div>)}</dl>
        {r.address && <section><h3>Address</h3><p>{r.address}</p></section>}
        {!!data?.relatedListings?.length && <section><h3>Source listings sharing this contact</h3><p className="muted">These may describe different properties. Calling is grouped by phone; each listing is preserved.</p>{data.relatedListings.map(listing => <div className="detail-history" key={listing.id}><strong>{listing.owner_name || "Unnamed owner"}</strong><p>{[listing.city,listing.state,area(listing.area_sqft),listing.source].filter(Boolean).join(" · ")}</p><p>{listing.address}</p></div>)}{data.relatedListingsCapped && <p>Showing the first 100 related listings.</p>}</section>}
        <AiTimeline initialBatch={aiBatch} initialScope={aiScope} entity={entity} id={id} initialOpen={initialAi}/>
        <section><h3>AI notes</h3><p className="detail-text">{(entity === "record" ? r.last_notes : r.notes) || "No AI notes available."}</p></section>
        <section><h3>Recording</h3>{audio ? <><audio controls preload="none" src={audio} onError={() => setAudioFailed(true)} />{audioFailed && <p role="alert">Couldn't play this recording. <a href={audio} target="_blank" rel="noreferrer">Open recording</a></p>}</> : <p className="muted">No recording available.</p>}</section>
        <section><h3>Transcript</h3><p className="detail-text transcript">{(entity === "record" ? r.last_transcript : r.transcript) || "No transcript available."}</p></section>
        {r.raw_matches?.length ? <section><h3>Matched listings</h3>{r.raw_matches.map((m,i) => <div className="detail-history" key={i}><strong>{m.owner_name || "Unnamed owner"}</strong><p>{[m.warehouse_type,m.city,m.state,area(m.area_sqft)].filter(Boolean).join(" · ")}</p><p>{m.address}</p></div>)}</section> : null}
        {r.calls_history?.length ? <section><h3>Latest execution records</h3>{r.calls_history.map((h,i) => <p key={i}>{dateTime(h.at)} · {h.status || "Unknown"} · {h.availability || "No result"}</p>)}</section> : null}
        <section><h3>Manual calls</h3><p className="muted">Caller-recorded attempts for this listing/execution. Corrections preserve the original; note edits are not calls.</p>
          {data!.manual.rows.length?data!.manual.rows.map(event=><div className="detail-history" key={event.id}><strong>{dateTime(event.occurred_at)}</strong> · {DISPOSITION_LABELS[event.disposition as Disposition]}{event.superseded&&<span> · superseded by a correction</span>}{event.corrects_id&&<span> · correction</span>}<p>{event.assignee}{event.actor!==event.assignee?` · recorded by ${event.actor}`:""} · {event.outcome||"No new result"}</p>{event.notes&&<p>{event.notes}</p>}{event.next_due_at&&<p>Follow-up due: {dateTime(event.next_due_at)}</p>}{event.duration_seconds!==null&&<p>Reported duration: {event.duration_seconds}s</p>}</div>):<p>No recorded manual attempts. Older notes or completion records are not proof of an attempt.</p>}
          {data!.manual.pages>1&&<nav aria-label="Manual history pages"><button type="button" disabled={manualPage<=1} onClick={()=>setManualPage(p=>p-1)}>Previous attempts</button><span> {data!.manual.page} / {data!.manual.pages} </span><button type="button" disabled={manualPage>=data!.manual.pages} onClick={()=>setManualPage(p=>p+1)}>Next attempts</button></nav>}
        </section>
        <section><h3>Verification history</h3>{data!.history.length ? data!.history.map(h => <div className="detail-history" key={h.id}><strong>{h.assignee_name || h.assignee}</strong> · {h.state === 'dropped' ? 'unassigned' : h.state}<p>{dateTime(h.assigned_at)} · {h.outcome || "No result yet"}</p>{h.note && <p>Brief: {h.note}</p>}{h.remarks && <p className="detail-text">{h.remarks}</p>}<p>Staff-recorded onboarding: {h.added_to_db && h.wh_id ? "Yes" : "Not yet"}{h.wh_id ? ` · ${h.wh_id}` : ""}</p></div>) : <p className="muted">No verification history yet.</p>}{data!.historyTotal > data!.history.length && <p className="muted">Showing the latest {data!.history.length} of {data!.historyTotal} assignments.</p>}</section>
      </>}
    </div>
    <div className="modal-foot"><button type="button" className="btn-text" onClick={onClose}>Close details</button></div>
  </Dialog>;
}
