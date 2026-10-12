"use client";
import { AiTimeline } from "./AiTimeline";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { RawRow } from "@/lib/raw";
import type { CallRow } from "@/lib/calls";
import type { AssignmentHistoryRow } from "@/lib/assignments";
import type { ManualAttempt } from "@/lib/manual-attempts";
import { DISPOSITION_LABELS,type Disposition } from "@/lib/manual-dispositions";
import { area, dateTime, rent } from "@/lib/display";
import { ResultBadge } from "./ResultBadge";
import { Dialog } from "./Dialog";
import { CopyText } from "./CopyText";
import { requestJson } from "./requests";

export function RecordDetails({ id, entity, label = "Details", aiBatch,aiScope }: { aiBatch?:string;aiScope?:"contact"|"execution";id: string; entity: "call" | "record"; label?: string }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="btn-row details-trigger" onClick={() => setOpen(true)} aria-label={`${label} for ${entity}`}>{label}</button>{open && <DetailContents aiBatch={aiBatch} aiScope={aiScope} initialAi={label==="AI timeline"} id={id} entity={entity} onClose={() => setOpen(false)} />}</>;
}
function DetailContents({ id, entity, onClose,initialAi,aiBatch,aiScope }: { aiBatch?:string;aiScope?:"contact"|"execution";initialAi:boolean;id: string; entity: "call" | "record"; onClose: () => void }) {
  const tabs = ["Overview", "AI activity", "Manual activity"] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>(initialAi ? "AI activity" : "Overview");
  const [aiVisited, setAiVisited] = useState(initialAi);
  const tabId = useId(), body = useRef<HTMLDivElement>(null), tabList = useRef<HTMLDivElement>(null);
  function selectTab(value: (typeof tabs)[number]) {
    setTab(value); if (value === "AI activity") setAiVisited(true);
    body.current?.scrollTo({ top: 0 });
  }
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
  const result = r ? entity === "record" ? r.last_availability : r.availability : null;
  const notes = r ? entity === "record" ? r.last_notes : r.notes : null;
  const transcript = r ? entity === "record" ? r.last_transcript : r.transcript : null;
  const callFacts = r ? { "AI result": <ResultBadge value={result} empty="No AI result"/>, "Call connection": entity === "record" ? r.last_status : r.status, "Last call": dateTime(entity === "record" ? r.last_called_at : r.call_created_at) } : {};
  return <Dialog drawer wide className="record-details-dialog" title={r?.owner_name || "Record details"} onClose={onClose}>
    {r && <><div className="detail-contact-bar"><div><span className="detail-label">Phone</span><CopyText value={phone} label="phone number" /></div>{phone && <a className="btn-row" href={`tel:${phone}`}>Call number</a>}</div>
      <div className="detail-tabs" ref={tabList} role="tablist" aria-label="Record details sections" onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        selectTab(tabs[next]); tabList.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next].focus();
      }}>{tabs.map((value, index) => <button type="button" role="tab" key={value} id={`${tabId}-tab-${index}`} aria-controls={`${tabId}-panel-${index}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => selectTab(value)}>{value}</button>)}</div>
    </>}
    <div className="modal-body detail-body" ref={body}>
      {error ? <div role="alert"><p>{error}</p><button type="button" className="btn" onClick={() => setAttempt(n => n + 1)}>Retry</button></div> : !r ? <div role="status"><p>Loading details…</p>{[1,2,3,4].map(i => <p className="skeleton detail-skeleton" key={i} />)}</div> : <>
        <div className="detail-panel" role="tabpanel" id={`${tabId}-panel-0`} aria-labelledby={`${tabId}-tab-0`} hidden={tab !== "Overview"}>
          <section className="detail-section" aria-label="Property"><h3>Property</h3><Facts values={{ "Location": entity === "record" ? [r.city,r.state].filter(Boolean).join(", ") : r.db_area || r.raw_city,
            ...(entity === "record" ? { "Size": area(r.area_sqft) } : { "Built-up area": area(r.built_up_area_sqft), "Carpet area": area(r.carpet_area_sqft), "Listing area": area(r.raw_area_sqft) }), "Rent": rent(entity === "record" ? r.rent : r.expected_rent) }} />
            {r.address && <div className="detail-address"><span className="detail-label">Address</span><p>{r.address}</p></div>}
          </section>
          <section className="detail-section" aria-label="Latest AI call"><div className="detail-section-heading"><h3>Latest AI call</h3><button type="button" className="btn-text" onClick={() => { selectTab("AI activity"); tabList.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].focus(); }}>View AI activity</button></div><Facts values={callFacts} /></section>
          {!!data?.relatedListings?.length && <details className="detail-section detail-listings"><summary>Source listings sharing this contact <span>{data.relatedListings.length}{data.relatedListingsCapped ? "+" : ""}</span></summary>
            <p className="detail-description">These may describe different properties. Calling is grouped by phone; each listing is preserved.</p>
            {data.relatedListings.map(listing => <article className="detail-listing" key={listing.id}><div className="detail-section-heading"><strong>{listing.owner_name || "Unnamed owner"}</strong><span className="detail-source">{listing.source}</span></div><Facts values={{ "Location": [listing.city,listing.state].filter(Boolean).join(", "), "Size": area(listing.area_sqft) }} />{listing.address && <p className="detail-listing-address">{listing.address}</p>}</article>)}
            {data.relatedListingsCapped && <p className="detail-description">Showing the first 100 related listings.</p>}
          </details>}
          {r.raw_matches?.length ? <details className="detail-section detail-listings"><summary>Matched listings <span>{r.raw_matches.length}</span></summary>{r.raw_matches.map((m,i) => <article className="detail-listing" key={i}><strong>{m.owner_name || "Unnamed owner"}</strong><Facts values={{ "Property type": m.warehouse_type, "Location": [m.city,m.state].filter(Boolean).join(", "), "Size": area(m.area_sqft) }} />{m.address && <p>{m.address}</p>}</article>)}</details> : null}
        </div>
        <div className="detail-panel" role="tabpanel" id={`${tabId}-panel-1`} aria-labelledby={`${tabId}-tab-1`} hidden={tab !== "AI activity"}>
          <section className="detail-section"><h3>Latest call details</h3><Facts values={{ ...callFacts, ...(entity === "call" && r.called_by ? { "Legacy Called By": r.called_by } : {}) }} />
            <div className="detail-evidence"><h4>AI notes</h4><p className="detail-text">{notes || "No AI notes available."}</p></div>
            {audio && <div className="detail-evidence"><h4>Recording</h4><audio controls preload="none" src={audio} onError={() => setAudioFailed(true)} />{audioFailed && <p role="alert">Couldn't play this recording. <a href={audio} target="_blank" rel="noreferrer">Open recording</a></p>}</div>}
            {transcript ? <details className="detail-evidence"><summary>Transcript</summary><p className="detail-text transcript">{transcript}</p></details> : <p className="detail-description">{audio ? "No transcript available." : "No recording or transcript available."}</p>}
            {!audio && transcript && <p className="detail-description">No recording available.</p>}
          </section>
          <div className="detail-section">{aiVisited && <AiTimeline initialBatch={aiBatch} initialScope={aiScope} entity={entity} id={id} initialOpen />}</div>
          {r.calls_history?.length ? <details className="detail-section detail-listings"><summary>Latest execution records <span>{r.calls_history.length}</span></summary>{r.calls_history.map((h,i) => <div className="detail-history" key={i}><strong>{dateTime(h.at)}</strong><p>{h.status || "Unknown"} · <ResultBadge value={h.availability}/></p></div>)}</details> : null}
        </div>
        <div className="detail-panel" role="tabpanel" id={`${tabId}-panel-2`} aria-labelledby={`${tabId}-tab-2`} hidden={tab !== "Manual activity"}>
        <section className="detail-section"><h3>Manual calls <span className="detail-count">{data!.manual.total}</span></h3><p className="detail-description">Caller-recorded attempts for this listing/execution. Corrections preserve the original; note edits are not calls.</p>
          {data!.manual.rows.length?data!.manual.rows.map(event=><div className="detail-history" key={event.id}><strong>{dateTime(event.occurred_at)}</strong> · {DISPOSITION_LABELS[event.disposition as Disposition]}{event.superseded&&<span> · superseded by a correction</span>}{event.corrects_id&&<span> · correction</span>}<p>{event.assignee}{event.actor!==event.assignee?` · recorded by ${event.actor}`:""} · <ResultBadge value={event.outcome} empty="No new result"/></p>{event.notes&&<p>{event.notes}</p>}{event.next_due_at&&<p>Follow-up due: {dateTime(event.next_due_at)}</p>}{event.duration_seconds!==null&&<p>Reported duration: {event.duration_seconds}s</p>}</div>):<p>No recorded manual attempts. Older notes or completion records are not proof of an attempt.</p>}
          {data!.manual.pages>1&&<nav aria-label="Manual history pages"><button type="button" disabled={manualPage<=1} onClick={()=>setManualPage(p=>p-1)}>Previous attempts</button><span> {data!.manual.page} / {data!.manual.pages} </span><button type="button" disabled={manualPage>=data!.manual.pages} onClick={()=>setManualPage(p=>p+1)}>Next attempts</button></nav>}
        </section>
        <section className="detail-section"><h3>Verification history <span className="detail-count">{data!.historyTotal}</span></h3>{data!.history.length ? data!.history.map(h => <div className="detail-history" key={h.id}><strong>{h.assignee_name || h.assignee}</strong> · {h.state === 'dropped' ? 'unassigned' : h.state}<p>{dateTime(h.assigned_at)} · <ResultBadge value={h.outcome} empty="No result yet"/></p>{h.note && <p>Brief: {h.note}</p>}{h.remarks && <p className="detail-text">{h.remarks}</p>}<p>Staff-recorded onboarding: {h.added_to_db && h.wh_id ? "Yes" : "Not yet"}{h.wh_id ? ` · ${h.wh_id}` : ""}</p></div>) : <p className="muted">No verification history yet.</p>}{data!.historyTotal > data!.history.length && <p className="muted">Showing the latest {data!.history.length} of {data!.historyTotal} assignments.</p>}</section>
        </div>
      </>}
    </div>
    <div className="modal-foot"><button type="button" className="btn-text" onClick={onClose}>Close details</button></div>
  </Dialog>;
}

function Facts({ values }: { values: Record<string, ReactNode> }) {
  return <dl className="detail-facts">{Object.entries(values).map(([label, value]) => <div key={label} className={label === "Last call" ? "detail-fact-wide" : undefined}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl>;
}
