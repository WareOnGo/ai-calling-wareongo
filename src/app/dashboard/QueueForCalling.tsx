"use client";

import { useCallback, useMemo, useState } from "react";
import { IconPhoneOutgoing, IconDownload, IconX, IconAlert, IconPlus } from "./icons";
import {
  type CallCat,
  type QueueSel as Sel,
  PROPERTY_TYPE,
  CALLED_CATS,
  CAT_TAG_LABEL,
  buildCsv,
  dedupByNumber,
} from "@/lib/queue";
import { Dialog } from "./Dialog";
import { useSelection } from "./Selection";
import { useDashboardUI } from "./DashboardUI";
import { BatchActivity } from "./BatchActivity";
import { requestJson } from "./requests";
import { dateTime } from "@/lib/display";
import { isHindiBlocked } from "@/lib/routing";

type DispatchResult = {
  batchId: string;
  bolnaBatchId: string;
  scheduledAt: string;
  callable: number;
  heldRegion: number;
  skippedNoNumber: number;
};

// Selection + "Queue for calling" flow for the raw dataset grid.
//
// Per-row checkboxes (input.rowsel) and the header select-all (input.selall) are
// rendered server-side in raw/page.tsx; this client component wires them up via
// event delegation (survives grid re-renders, same pattern as GridInteractivity).
// Each row checkbox carries the Bolna call fields (and a call category) as data-*.
//
// Two selection scopes:
//   • header select-all → all rows on the CURRENT page (DOM-based, instant)
//   • "Select all N matching" banner → every record matching the filters across
//     ALL pages (fetched from /api/raw/queue)
//
// The modal previews the CSV that would go to Bolna and DEDUPS by phone number.
// Already-called numbers are NOT blocked — instead the modal warns how many are in
// the batch, broken down by last outcome (dead / unclear / available / unavailable),
// with a per-category toggle. Sending requires explicit confirmation before live calls.
// Pure preprocessing (dedup, CSV, classification) lives in @/lib/queue (unit-tested).

function readPageSelection(): Sel[] {
  const boxes = document.querySelectorAll<HTMLInputElement>("tbody input.rowsel:checked");
  return Array.from(boxes).map((b) => ({
    id: b.dataset.id ?? "",
    name: b.dataset.name ?? "",
    contact: b.dataset.contact ?? "",
    area: b.dataset.area ?? "",
    state: b.dataset.state ?? "",
    cat: (b.dataset.cat ?? "") as CallCat,
    queued: b.dataset.queued === "1",
  }));
}

export function QueueForCalling() {
  const { total, ids, allMatching, hasSelection } = useSelection();
  const { pending, refresh, notify } = useDashboardUI();
  const [uncertain, setUncertain] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Sel[]>([]);   // deduped rows (full set for the modal)
  const [offCats, setOffCats] = useState<Set<CallCat>>(new Set()); // called categories toggled OFF
  const [matchingCount, setMatchingCount] = useState(0);
  const [noPhone, setNoPhone] = useState(0);
  const [rawCount, setRawCount] = useState(0);   // pre-dedup count
  const [capped, setCapped] = useState(false);

  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false); // "are you sure — live calls" step
  const [result, setResult] = useState<DispatchResult | null>(null); // set on successful dispatch

  const openModal = useCallback(async () => {
    if (uncertain) { setOpen(true); return; }
    setRows([]); setRawCount(0); setMatchingCount(0); setNoPhone(0);
    setError(null);
    setResult(null);       // clear any prior dispatch result
    setConfirming(false);
    setOffCats(new Set()); // fresh toggle state each time the modal opens
    if (allMatching) {
      setLoading(true);
      setOpen(true);
      try {
        const data: { rows: (Omit<Sel, "contact"> & { contact: string | null })[]; capped: boolean; total: number; skippedNoPhone: number } = await requestJson(`/api/raw/queue${window.location.search}`);
        const norm: Sel[] = data.rows.map((r) => ({ ...r, contact: r.contact ?? "", state: r.state ?? "", queued: !!r.queued }));
        setRawCount(norm.length); setMatchingCount(data.total); setNoPhone(data.skippedNoPhone);
        setRows(dedupByNumber(norm));
        setCapped(data.capped);
      } catch {
        setError("Couldn't load the full set. Try again.");
      } finally {
        setLoading(false);
      }
    } else {
      const sel = readPageSelection();
      if (sel.length === 0) return;
      setRawCount(sel.length); setMatchingCount(sel.length);
      setRows(dedupByNumber(sel));
      setCapped(false);
      setOpen(true);
    }
  }, [allMatching, uncertain]);

  // Category counts across ALL called rows (stable — chips stay visible when toggled off).
  const catCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) if (r.cat) m[r.cat] = (m[r.cat] ?? 0) + 1;
    return m;
  }, [rows]);
  const presentCats = CALLED_CATS.filter((c) => catCounts[c.key]);
  // The live batch = deduped rows minus rows whose category is toggled off.
  const active = useMemo(() => rows.filter((r) => !(r.cat && offCats.has(r.cat))), [rows, offCats]);
  const withContact = active.filter((r) => r.contact.trim());
  const calledInBatch = active.filter((r) => r.cat).length;
  const calledTotal = rows.filter((r) => r.cat).length;

  const toggleCat = useCallback((cat: CallCat) => {
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
    setOffCats(allOff ? new Set() : new Set(presentCats.map((c) => c.key)));
  }, [allOff, presentCats]);

  // Hard safeguards, mirrored from the server so the modal counts match what gets sent:
  //  • region: TN/Kerala/Karnataka held back from the Hindi agent
  //  • already-queued: numbers already in a live (sending/scheduled) batch are skipped
  const routable = withContact.filter((r) => !isHindiBlocked(r.state));
  const heldRegion = withContact.length - routable.length;
  const callable = routable.filter((r) => !r.queued);
  const alreadyQueued = routable.length - callable.length;

  // Download exports every previewed row that has a number — including held-back /
  // already-queued ones — since a manual CSV is exactly what you'd hand off elsewhere
  // (e.g. TN/KL/KA to an English agent). "Send to Bolna" still only sends `callable`.
  const download = useCallback(() => {
    const blob = new Blob([buildCsv(withContact)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bolna-queue.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [withContact]);

  // "Send to Bolna" — LIVE. Places real calls. Server re-fetches numbers by id, so we
  // only send ids + a filters snapshot + confirm:true. Guarded by a two-step confirm.
  const dispatch = useCallback(async () => {
    if (sending || uncertain) return;
    setSending(true);
    setError(null);
    try {
      const params = new URLSearchParams(window.location.search);
      const filters = Object.fromEntries(params.entries());
      const res = await fetch("/api/raw/dispatch", {
        method: "POST",
        signal: AbortSignal.timeout(120000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: callable.map((r) => r.id), filters, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `dispatch failed (${res.status})`);
      setResult(data as DispatchResult);
      setConfirming(false);
      notify(`Batch scheduled: ${data.callable} calls. View it in Recent batches.`);
      refresh();
    } catch {
      setError("The batch could not be confirmed. Check Recent batches before preparing another call batch.");
      setUncertain(true); setConfirming(false);
      refresh();
    } finally {
      setSending(false);
    }
  }, [callable, sending, uncertain, notify, refresh]);

  const btnCount = allMatching ? total : ids.length;
  const dupes = rawCount - rows.length;
  const missing = active.length - withContact.length;
  return (
    <>
      <button
        type="button"
        className="btn-export"
        onClick={openModal}
        disabled={(!hasSelection && !uncertain) || pending}
        title={btnCount === 0 ? "Select records to queue" : `Queue ${btnCount} record(s) for a Bolna batch`}
      >
        <IconPhoneOutgoing size={15} /> Queue for calling
        {btnCount > 0 ? <span className="fbadge">{btnCount.toLocaleString()}</span> : null}
      </button>

      {open && (
        <Dialog wide title={<><IconPhoneOutgoing size={16} />Queue for calling</>} onClose={() => setOpen(false)} busy={sending || loading}>
            {!result && (
              <p className="modal-sub">
                <strong>{matchingCount.toLocaleString()} records → {rawCount.toLocaleString()} with numbers → {rows.length.toLocaleString()} unique numbers → {callable.length.toLocaleString()} calls</strong>
                {dupes > 0 ? <span className="warn"> {dupes.toLocaleString()} duplicate number(s) removed.</span> : null}
                {missing + noPhone > 0 ? <span className="warn"> {(missing + noPhone).toLocaleString()} row(s) have no number and will be skipped.</span> : null}
                {alreadyQueued > 0 ? <span className="warn"> {alreadyQueued.toLocaleString()} already queued in a live batch — skipped.</span> : null}
                {capped ? <span className="warn"> Showing the first {rows.length.toLocaleString()} — narrow filters to include the rest.</span> : null}
              </p>
            )}

            {!loading && !result && calledTotal > 0 && (
              <div className="called-warn">
                <div className="cw-head">
                  <IconAlert size={16} />
                  <span>
                    <strong>{calledInBatch.toLocaleString()}</strong> already-called number(s) still in this batch
                    {calledInBatch < calledTotal ? ` (${(calledTotal - calledInBatch).toLocaleString()} excluded)` : ""}.
                    Toggle a category to exclude or re-include it:
                  </span>
                </div>
                <div className="cat-chips">
                  {presentCats.map((c) => {
                    const off = offCats.has(c.key);
                    return (
                      <button
                        key={c.key}
                        type="button"
                        className={`cat-chip cat-${c.key}${off ? " off" : ""}`}
                        aria-pressed={!off}
                        disabled={sending}
                        onClick={() => toggleCat(c.key)}
                      >
                        {c.label} · {catCounts[c.key].toLocaleString()}
                        {off ? <IconPlus size={12} /> : <IconX size={12} />}
                      </button>
                    );
                  })}
                  <button type="button" className="btn-text cw-all" disabled={sending} onClick={toggleAllCalled}>
                    {allOff ? "Re-include all called" : "Exclude all called"}
                  </button>
                </div>
              </div>
            )}

            {!loading && !result && heldRegion > 0 && (
              <div className="held-warn">
                <div className="cw-head">
                  <IconAlert size={16} />
                  <span>
                    <strong>{heldRegion.toLocaleString()}</strong> number(s) are in non-Hindi regions
                    (Tamil Nadu / Kerala / Karnataka) and are <strong>excluded from calling</strong> — the Hindi
                    agent can&apos;t serve them yet. They&apos;re marked <span className="cat-tag cat-held">held</span> below
                    and are included in the CSV download so you can route them to an English agent.
                  </span>
                </div>
              </div>
            )}

            <div className="modal-body">
              {result ? (
                <div className="dispatch-ok">
                  <div className="ok-badge">✓</div>
                  <div className="ok-title">Batch scheduled — {result.callable.toLocaleString()} call(s)</div>
                  <p className="muted">
                    Sent to Bolna as batch <code>{result.bolnaBatchId.slice(0, 8)}</code>, scheduled for{" "}
                    {dateTime(result.scheduledAt)}.
                    {result.heldRegion > 0 ? ` ${result.heldRegion.toLocaleString()} held back for region routing.` : ""}
                  </p>
                  <p className="muted" style={{ fontSize: 12 }}>
                    Calls will begin at the scheduled time. Follow their results in Recent batches.
                  </p>
                </div>
              ) : loading ? (
                <div className="grid-loading" role="status" style={{ margin: 0, border: "none" }}>
                  <span className="spinner" aria-hidden="true" />
                  <span className="muted">Loading all matching records…</span>
                </div>
              ) : error ? (
                <div role="alert" className="assign-error"><p>{error}</p>{uncertain ? <BatchActivity /> : <button type="button" className="btn-row" onClick={openModal}>Retry loading</button>}</div>
              ) : active.length === 0 ? (
                <p className="muted" style={{ padding: 16 }}>No records left in the batch.</p>
              ) : (
                <table className="preview">
                  <thead>
                    <tr>{["Name", "Property type", "Phone number", "Area"].map((h) => <th key={h}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {active.map((r) => {
                      const held = isHindiBlocked(r.state);
                      const skip = !r.contact.trim() || held || r.queued;
                      return (
                        <tr key={r.id} className={skip ? "row-skip" : undefined}>
                          <td>
                            {r.name}
                            {r.cat ? <span className={`cat-tag cat-${r.cat}`}>{CAT_TAG_LABEL[r.cat]}</span> : null}
                            {held ? <span className="cat-tag cat-held">held</span> : null}
                            {r.queued ? <span className="cat-tag cat-queued">queued</span> : null}
                          </td>
                          <td>{PROPERTY_TYPE}</td>
                          <td>{r.contact || <span className="muted">—</span>}</td>
                          <td>{r.area}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="modal-foot">
              {result ? (
                <>
                  <span className="spacer" />
                  <BatchActivity /><button type="button" className="btn-primary" onClick={() => setOpen(false)}>Done</button>
                </>
              ) : confirming ? (
                <>
                  <span className="confirm-msg">
                    <IconAlert size={15} /> Place <strong>{callable.length.toLocaleString()}</strong> live call(s)? Phones will ring.
                  </span>
                  <span className="spacer" />
                  <button type="button" className="btn-text" onClick={() => setConfirming(false)} disabled={sending}>Back</button>
                  <button type="button" className="btn-danger" disabled={sending} onClick={dispatch}>
                    {sending ? <span className="spinner spinner-sm" aria-hidden="true" /> : <IconPhoneOutgoing size={15} />}
                    {sending ? " Sending…" : " Yes, place calls"}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn-text" onClick={download} disabled={loading || sending || withContact.length === 0}>
                    <IconDownload size={15} /> Download CSV ({withContact.length.toLocaleString()})
                  </button>
                  <span className="spacer" />
                  <button type="button" className="btn-text" disabled={loading || sending} onClick={() => setOpen(false)}>Cancel</button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={loading || sending || !!error || uncertain || callable.length === 0}
                    title="Send this batch to Bolna (live calls)"
                    onClick={() => setConfirming(true)}
                  >
                    <IconPhoneOutgoing size={15} /> Send to Bolna ({callable.length.toLocaleString()})
                  </button>
                </>
              )}
            </div>
        </Dialog>
      )}
    </>
  );
}
