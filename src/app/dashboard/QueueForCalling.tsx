"use client";
import { searchValues } from "@/lib/filter-values";

import { QueueContacts } from "./QueueContacts";
import { WalletBalance } from "./WalletBalance";
import { useCallback, useMemo, useState, useRef } from "react";
import { IconPhoneOutgoing, IconDownload, IconAlert } from "./icons";
import {
  type CallCat,
  type QueueSel as Sel,
  PROPERTY_TYPE,
  CALLED_CATS,
  buildCsv,
  dedupByNumber,
} from "@/lib/queue";
import { Dialog } from "./Dialog";
import { useSelection } from "./Selection";
import { useDashboardUI } from "./DashboardUI";
import { BatchActivity } from "./BatchActivity";
import { requestJson } from "./requests";
import { dateTime } from "@/lib/display";
import { LANGUAGE_LABELS, CALL_LANGUAGES, type CallLanguage, type RoutingMode } from "@/lib/routing";
import { assembleBatch } from "@/lib/dispatch-plan";
import type { DispatchResult } from "@/lib/dispatch-service";

// Selection + "Queue for calling" flow for the raw dataset grid.
//
// Per-row checkboxes (input.rowsel) and the header select-all (input.selall) are
// rendered server-side in raw/page.tsx; this client component wires them up via
// event delegation (survives table re-renders).
// Both scopes load current phone and ownership metadata from the server.
//
// Two selection scopes:
//   • header select-all → all rows on the CURRENT page (server-verified preview)
//   • "Select all N matching" banner → every record matching the filters across
//     ALL pages (fetched from /api/raw/queue)
//
// The modal leads with the eligible count; contact review and selection accounting
// remain available in disclosures. Previously called categories can be excluded.
// Sending requires explicit confirmation before live calls.
// Pure preprocessing (dedup, CSV, classification) lives in @/lib/queue (unit-tested).

export function QueueForCalling({ availableLanguages }: { availableLanguages: CallLanguage[] }) {
  const { total, ids, allMatching, hasSelection } = useSelection();
  const { pending, refresh, notify } = useDashboardUI();
  const intent = useRef<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Sel[]>([]);   // deduped rows (full set for the modal)
  const [previewIds,setPreviewIds]=useState<string[]>([]);
  const [offCats, setOffCats] = useState<Set<CallCat>>(new Set()); // called categories toggled OFF
  const [matchingCount, setMatchingCount] = useState(0);
  const [noPhone, setNoPhone] = useState(0);
  const [rawCount, setRawCount] = useState(0);   // pre-dedup count
  const [capped, setCapped] = useState(false);
  const [routingMode, setRoutingMode] = useState<RoutingMode>("auto");

  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false); // "are you sure — live calls" step
  const [result, setResult] = useState<DispatchResult | null>(null); // set on successful dispatch

  const openModal = useCallback(async () => {
    if (uncertain) { setOpen(true); return; }
    intent.current = crypto.randomUUID();
    setRows([]); setRawCount(0); setMatchingCount(0); setNoPhone(0);
    setError(null);
    setResult(null);       // clear any prior dispatch result
    setConfirming(false);
    setOffCats(new Set()); // fresh toggle state each time the modal opens
    setLoading(true);setOpen(true);
    try {
      const data:{rows:Sel[];capped:boolean;total:number;skippedNoPhone:number}=await requestJson(allMatching?`/api/raw/queue${window.location.search}`:'/api/raw/queue',allMatching?undefined:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ids})});
      setPreviewIds(data.rows.map(row=>row.id));setRawCount(data.rows.length);setMatchingCount(data.total);setNoPhone(data.skippedNoPhone);setRows(dedupByNumber(data.rows));setCapped(data.capped);
    } catch {setError("Couldn't load the calling preview. Try again.");} finally {setLoading(false);}
  }, [allMatching,uncertain,ids]);

  // Category counts stay stable while outcomes are excluded or re-included.
  const catCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) if (r.cat) m[r.cat] = (m[r.cat] ?? 0) + 1;
    return m;
  }, [rows]);
  const presentCats = CALLED_CATS.filter((c) => catCounts[c.key]);
  const calledTotal = rows.filter((r) => r.cat).length;

  const toggleCat = useCallback((cat: CallCat) => {
    setConfirming(false);
    setOffCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);
  const allOff = presentCats.length > 0 && presentCats.every((c) => offCats.has(c.key));
  const toggleAllCalled = useCallback(() => {
    // If everything's already excluded, re-include all; otherwise exclude all.
    setConfirming(false);
    setOffCats(allOff ? new Set() : new Set(presentCats.map((c) => c.key)));
  }, [allOff, presentCats]);

  // Use the same routing and validation as the server. Dedup happens before splitting.
  const summary = assembleBatch(rows, [...offCats], { mode: routingMode, availableLanguages });
  const { heldRegion, callable, alreadyQueued, groups } = summary;
  const plannedLanguages = CALL_LANGUAGES.filter(language => groups[language].length > 0);
  const routeSummary = plannedLanguages.map(language => `${groups[language].length.toLocaleString()} ${LANGUAGE_LABELS[language]}`).join(" + ");

  // CSV and live dispatch use the same eligibility and ownership rules.
  const download = useCallback(async () => {
    setLoading(true);setError(null);
    try{
    const fresh=await requestJson<{rows:Sel[]}>('/api/raw/queue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ids:previewIds})});
    setRows(dedupByNumber(fresh.rows));
    const eligible=assembleBatch(fresh.rows,[...offCats],{mode:routingMode,availableLanguages}).callable;
    if(!eligible.length){setError('No eligible contacts remain. Ownership and calling reservations were checked again; no CSV was exported.');return;}
    const blob = new Blob([buildCsv(eligible)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bolna-queue.csv";
    a.click();
    URL.revokeObjectURL(url);
    }catch{setError('Could not verify the current calling selection. Try loading the preview again.');}
    finally{setLoading(false);}
  }, [previewIds,offCats,routingMode,availableLanguages]);

  // "Send to Bolna" — LIVE. Places real calls. Server re-fetches numbers by id, so we
  // only send ids + a filters snapshot + confirm:true. Guarded by a two-step confirm.
  const dispatch = useCallback(async () => {
    if (sending || uncertain) return;
    setSending(true);
    setError(null);
    let mayHaveDispatched = true;
    try {
      const params = new URLSearchParams(window.location.search);
      const filters = searchValues(params);
      const res = await fetch("/api/raw/dispatch", {
        method: "POST",
        signal: AbortSignal.timeout(120000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: previewIds, excludeCats: [...offCats], routingMode, intentKey: intent.current, filters, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        mayHaveDispatched = ![400, 401, 403, 409, 422, 503].includes(res.status);
        throw new Error(data?.error ?? `dispatch failed (${res.status})`);
      }
      if (!Array.isArray(data.batches) || !data.batches.length) throw new Error("Missing batch confirmation");
      setResult(data as DispatchResult);
      setUncertain(!data.scheduled);
      setConfirming(false);
      notify(data.scheduled ? `${data.batches.length} batch(es) scheduled: ${data.callable} calls.` : "Some batches need confirmation. Review each batch in Recent batches.");
      refresh();
    } catch (cause) {
      setError(mayHaveDispatched ? "The batches could not be confirmed. Check Recent batches before preparing another call batch." : cause instanceof Error ? cause.message : "Unable to prepare these calls.");
      setUncertain(mayHaveDispatched); setConfirming(false);
      refresh();
    } finally {
      setSending(false);
    }
  }, [previewIds, offCats, routingMode, sending, uncertain, notify, refresh]);

  const btnCount = allMatching ? total : ids.length;
  const dupes = rawCount - rows.length;
  const missing = summary.skippedNoNumber;
  const showLanguage = callable.length > 0 || heldRegion > 0 || summary.excludedByCat > 0;
  const skipped = [
    [alreadyQueued, "already queued"],
    [summary.humanOwned, "assigned to callers"],
    [heldRegion, "held for language"],
    [summary.excludedByCat, "excluded by outcome"],
    [missing + noPhone, "without a usable number"],
  ].filter(([count]) => Number(count) > 0);
  const languageSettings = <div className="queue-language">
    <label><span>Call language</span><select aria-label="Call language" value={routingMode} disabled={sending || uncertain || loading}
      onChange={event => { setRoutingMode(event.target.value as RoutingMode); intent.current = crypto.randomUUID(); setConfirming(false); }}>
      <option value="auto">Automatic — by state</option>
      <option value="hindi" disabled={!availableLanguages.includes("hindi")}>Hindi only</option>
      <option value="english" disabled={!availableLanguages.includes("english")}>English only</option>
    </select></label>
    <details className="queue-routing"><summary>Routing rules</summary><p>{routingMode === "auto" ? "Tamil Nadu, Kerala and Karnataka → English. Other or unspecified states → Hindi."
      : routingMode === "hindi" ? "Tamil Nadu, Kerala and Karnataka remain excluded from Hindi calls." : "All callable records will use the English agent."}</p></details>
  </div>;
  return <>
    <button type="button" className="btn-export btn-dispatch" onClick={openModal} disabled={(!hasSelection && !uncertain) || pending}
      title={btnCount === 0 ? "Select records to queue" : `Queue ${btnCount} record(s) for a Bolna batch`}>
      <IconPhoneOutgoing size={15} /> Queue for calling
      {btnCount > 0 ? <span className="fbadge">{btnCount.toLocaleString()}</span> : null}
    </button>
    {open && <Dialog wide className="queue-dialog" title={<><IconPhoneOutgoing size={16} />Queue for calling</>} onClose={() => setOpen(false)} busy={sending || loading}>
      <div className="modal-body queue-body">
        {result ? <div className="dispatch-ok">
          <div className="ok-badge">{result.scheduled ? "✓" : "!"}</div>
          <div className="ok-title">{result.scheduled ? "Batches scheduled" : "Batches need review"} — {result.callable.toLocaleString()} call(s)</div>
          {result.batches.map(batch => <article className="detail-history" key={batch.batchId}>
            <strong>{batch.agentLabel} · {batch.callable.toLocaleString()} calls</strong>
            <p>{batch.scheduled ? `Scheduled for ${dateTime(batch.scheduledAt)}` : `Status: ${batch.state} — check Recent batches before retrying.`}</p>
            <small>Batch {batch.bolnaBatchId || batch.batchId}</small>
          </article>)}
          {result.heldRegion > 0 && <p className="muted">{result.heldRegion.toLocaleString()} held for language routing.</p>}
          {!result.scheduled && <p role="alert" className="warn">Already scheduled batches will continue. Review the other batches individually in Recent batches.</p>}
        </div> : loading ? <div className="grid-loading" role="status" style={{ margin: 0, border: "none" }}>
          <span className="spinner" aria-hidden="true" /><span className="muted">Loading all matching records…</span>
        </div> : <>
          {error && <div role="alert" className="assign-error"><p>{error}</p>{uncertain ? <BatchActivity /> : <button type="button" className="btn-row" onClick={openModal}>Retry loading</button>}</div>}
          {(!error || rows.length > 0) && <>
            <section className="queue-overview" aria-label="Calling summary" aria-live="polite">
              <h2>{callable.length > 0 ? <><span>{callable.length.toLocaleString()}</span> ready to call</> : "No contacts ready to call"}</h2>
              <p>{matchingCount.toLocaleString()} {matchingCount === 1 ? "record" : "records"} selected{plannedLanguages.length > 0 && <> · {routeSummary}</>}</p>
              {skipped.length > 0 && <ul className="queue-skipped">{skipped.map(([count, label]) => <li key={label}><strong>{Number(count).toLocaleString()}</strong> {label}</li>)}</ul>}
              {callable.length === 0 && <p className="queue-next-step">{alreadyQueued > 0 ? "Queued contacts will continue in their existing batches."
                : heldRegion > 0 ? "Review the call language to include contacts with an available agent."
                : summary.excludedByCat > 0 ? "Review the previous outcomes below to include contacts again."
                : summary.humanOwned > 0 ? "Contacts with open manual assignments are held automatically."
                : "Choose records with a usable phone number to prepare a batch."}</p>}
              {alreadyQueued > 0 && <BatchActivity />}
              {capped && <p className="queue-limit">Showing the first {rows.length.toLocaleString()} — narrow filters to include the rest.</p>}
            </section>
            {showLanguage && languageSettings}
            {calledTotal > 0 && <details className="queue-disclosure queue-previous">
              <summary>Previous AI calls <span>{calledTotal.toLocaleString()} {calledTotal === 1 ? "contact" : "contacts"}</span></summary>
              <p>Choose which previous outcomes to include. Queued contacts and open manual assignments stay excluded.</p>
              <div className="queue-outcomes">{presentCats.map(category => <label key={category.key}>
                <input type="checkbox" checked={!offCats.has(category.key)} disabled={sending || uncertain} onChange={() => toggleCat(category.key)} />
                <span>{category.label}</span><small>{catCounts[category.key].toLocaleString()}</small>
              </label>)}</div>
              <button type="button" className="btn-text" disabled={sending || uncertain} onClick={toggleAllCalled}>{allOff ? "Re-include all called" : "Exclude all called"}</button>
            </details>}
            {rows.length > 0 && <QueueContacts rows={rows} excluded={offCats} routingMode={routingMode} availableLanguages={availableLanguages} />}
            <details className="queue-disclosure queue-audit">
              <summary>Selection details</summary>
              <dl className="queue-counts">
                <div><dt>Records selected</dt><dd>{matchingCount.toLocaleString()}</dd></div>
                <div><dt>With numbers</dt><dd>{rawCount.toLocaleString()}</dd></div>
                <div><dt>Unique contacts</dt><dd>{rows.length.toLocaleString()}</dd></div>
                {dupes > 0 && <div><dt>Duplicate numbers removed</dt><dd>{dupes.toLocaleString()}</dd></div>}
              </dl>
              <p>Shared primary/alternate numbers are grouped before dispatch. Property type: {PROPERTY_TYPE}.</p>
              {rows.some(row => row.owners?.length || row.aiCalls) && <section aria-label="Calling ownership preview">
                {summary.humanOwned > 0 && <p><strong>{summary.humanOwned} contacts held for open human assignments</strong></p>}
                {rows.some(row => row.aiCalls) && <p>{rows.filter(row => row.aiCalls).length} contacts previously called by AI.</p>}
                {[...new Set(rows.flatMap(row => (row.owners || []).map(owner => owner.email)))].map(email => {
                  const owned = rows.filter(row => row.owners?.some(owner => owner.email === email));
                  const person = owned[0]?.owners?.find(owner => owner.email === email);
                  return <p key={email}>{owned.length} contacts assigned to {person?.name || email}: {[...new Set(owned.flatMap(row => row.owners?.filter(owner => owner.email === email).map(owner => `${owner.state}${owner.outcome ? ' · ' + owner.outcome : ''}`) || []))].join('; ')}</p>;
                })}
              </section>}
              {!showLanguage && languageSettings}
            </details>
            <WalletBalance compact />
          </>}
        </>}
      </div>
      <div className="modal-foot">
        {result ? <><span className="spacer" /><BatchActivity /><button type="button" className="btn-primary" onClick={() => setOpen(false)}>Done</button></>
          : confirming ? <>
            <span className="confirm-msg"><IconAlert size={15} /> Place <strong>{routeSummary}</strong> calls in {plannedLanguages.length} batch(es)? Phones will ring.</span>
            {callable.some(row => row.cat) && <span className="queue-repeat-confirm">Includes {callable.filter(row => row.cat).length} previously called contacts.</span>}
            <span className="spacer" /><button type="button" className="btn-text" onClick={() => setConfirming(false)} disabled={sending}>Back</button>
            <button type="button" className="btn-danger" disabled={sending} onClick={dispatch}>
              {sending ? <span className="spinner spinner-sm" aria-hidden="true" /> : <IconPhoneOutgoing size={15} />}{sending ? " Sending…" : " Yes, place calls"}
            </button>
          </> : callable.length === 0 ? <><span className="spacer" /><button type="button" className="btn secondary" disabled={loading || sending} onClick={() => setOpen(false)}>Close</button></>
          : <>
            <button type="button" className="btn-text queue-download" onClick={download} disabled={loading || sending || uncertain}><IconDownload size={15} /> Download CSV ({callable.length.toLocaleString()})</button>
            <span className="spacer" /><button type="button" className="btn-text" disabled={loading || sending} onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={loading || sending || !!error || uncertain} title="Send this batch to Bolna (live calls)" onClick={() => setConfirming(true)}>
              <IconPhoneOutgoing size={15} /> Send to Bolna ({callable.length.toLocaleString()})
            </button>
          </>}
      </div>
    </Dialog>}
  </>;
}
