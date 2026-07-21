"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconPhoneOutgoing, IconDownload, IconX, IconAlert, IconPlus } from "./icons";
import {
  type CallCat,
  type QueueSel as Sel,
  PROPERTY_TYPE,
  CSV_HEADERS,
  CALLED_CATS,
  CAT_TAG_LABEL,
  buildCsv,
  dedupByNumber,
} from "@/lib/queue";
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
// with a per-category toggle. Sending is a stub (not wired yet).
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

export function QueueForCalling({ total, pageRows }: { total: number; pageRows: number }) {
  const [pageCount, setPageCount] = useState(0);           // checked rows on this page
  const [pageSelectable, setPageSelectable] = useState(0); // selectable (has-phone) rows on this page
  const [allMatching, setAllMatching] = useState(false);   // "all across pages" scope

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Sel[]>([]);   // deduped rows (full set for the modal)
  const [offCats, setOffCats] = useState<Set<CallCat>>(new Set()); // called categories toggled OFF
  const [rawCount, setRawCount] = useState(0);   // pre-dedup count
  const [capped, setCapped] = useState(false);

  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false); // "are you sure — live calls" step
  const [result, setResult] = useState<DispatchResult | null>(null); // set on successful dispatch

  // Keep the button count in sync with the checkboxes, and drive select-all.
  useEffect(() => {
    function sync() {
      const all = document.querySelectorAll<HTMLInputElement>("tbody input.rowsel:not(:disabled)");
      const checked = document.querySelectorAll<HTMLInputElement>("tbody input.rowsel:checked");
      setPageCount(checked.length);
      setPageSelectable(all.length);
      const selall = document.querySelector<HTMLInputElement>("thead input.selall");
      if (selall) {
        selall.checked = all.length > 0 && checked.length === all.length;
        selall.indeterminate = checked.length > 0 && checked.length < all.length;
      }
    }

    function onChange(e: Event) {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (t.classList.contains("selall")) {
        const on = t.checked;
        document
          .querySelectorAll<HTMLInputElement>("tbody input.rowsel:not(:disabled)")
          .forEach((b) => (b.checked = on));
        setAllMatching(false); // any manual box change drops the cross-page scope
        sync();
      } else if (t.classList.contains("rowsel")) {
        setAllMatching(false);
        sync();
      }
    }

    document.addEventListener("change", onChange);
    sync(); // initial (e.g. after a page nav)
    return () => document.removeEventListener("change", onChange);
  }, []);

  const openModal = useCallback(async () => {
    setError(null);
    setResult(null);       // clear any prior dispatch result
    setConfirming(false);
    setOffCats(new Set()); // fresh toggle state each time the modal opens
    if (allMatching) {
      setLoading(true);
      setOpen(true);
      try {
        const res = await fetch(`/api/raw/queue${window.location.search}`);
        if (!res.ok) throw new Error(String(res.status));
        const data: { rows: (Omit<Sel, "contact"> & { contact: string | null })[]; capped: boolean } = await res.json();
        const norm: Sel[] = data.rows.map((r) => ({ ...r, contact: r.contact ?? "", state: r.state ?? "", queued: !!r.queued }));
        setRawCount(norm.length);
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
      setRawCount(sel.length);
      setRows(dedupByNumber(sel));
      setCapped(false);
      setOpen(true);
    }
  }, [allMatching]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

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
    setSending(true);
    setError(null);
    try {
      const params = new URLSearchParams(window.location.search);
      const filters = Object.fromEntries(params.entries());
      const res = await fetch("/api/raw/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: callable.map((r) => r.id), filters, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `dispatch failed (${res.status})`);
      setResult(data as DispatchResult);
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "dispatch failed");
    } finally {
      setSending(false);
    }
  }, [callable]);

  const btnCount = allMatching ? total : pageCount;
  const dupes = rawCount - rows.length;
  const missing = active.length - withContact.length;
  // Offer cross-page select once the whole page is selected and more pages exist.
  const offerAll = !allMatching && pageSelectable > 0 && pageCount === pageSelectable && total > pageRows;

  return (
    <>
      <button
        type="button"
        className="btn-export"
        onClick={openModal}
        disabled={btnCount === 0}
        title={btnCount === 0 ? "Select records to queue" : `Queue ${btnCount} record(s) for a Bolna batch`}
      >
        <IconPhoneOutgoing size={15} /> Queue for calling
        {btnCount > 0 ? <span className="fbadge">{btnCount.toLocaleString()}</span> : null}
      </button>

      {offerAll && (
        <button type="button" className="btn-text selectall-link" onClick={() => setAllMatching(true)}>
          Select all {total.toLocaleString()} matching
        </button>
      )}
      {allMatching && (
        <span className="selectall-note">
          All {total.toLocaleString()} matching selected
          <button type="button" className="btn-text" onClick={() => setAllMatching(false)}>Clear</button>
        </span>
      )}

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">
                <IconPhoneOutgoing size={16} /> Queue for calling
                {!loading ? ` — ${active.length.toLocaleString()} record(s)` : ""}
              </div>
              <button type="button" className="modal-close" aria-label="Close" onClick={() => setOpen(false)}>
                <IconX size={16} />
              </button>
            </div>

            {!result && (
              <p className="modal-sub">
                CSV preview of the batch that will be sent to Bolna.
                {dupes > 0 ? <span className="warn"> {dupes.toLocaleString()} duplicate number(s) removed.</span> : null}
                {missing > 0 ? <span className="warn"> {missing.toLocaleString()} row(s) have no number and will be skipped.</span> : null}
                {heldRegion > 0 ? <span className="warn"> {heldRegion.toLocaleString()} held back (TN/Kerala/Karnataka — no English agent yet).</span> : null}
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
                        onClick={() => toggleCat(c.key)}
                      >
                        {c.label} · {catCounts[c.key].toLocaleString()}
                        {off ? <IconPlus size={12} /> : <IconX size={12} />}
                      </button>
                    );
                  })}
                  <button type="button" className="btn-text cw-all" onClick={toggleAllCalled}>
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
                    {new Date(result.scheduledAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.
                    {result.heldRegion > 0 ? ` ${result.heldRegion.toLocaleString()} held back for region routing.` : ""}
                  </p>
                  <p className="muted" style={{ fontSize: 12 }}>
                    Calls will begin at the scheduled time. Results flow back in via the webhook.
                  </p>
                </div>
              ) : loading ? (
                <div className="grid-loading" style={{ margin: 0, border: "none" }}>
                  <span className="spinner" aria-hidden="true" />
                  <span className="muted">Loading all matching records…</span>
                </div>
              ) : error ? (
                <p className="muted" style={{ padding: 16 }}>{error}</p>
              ) : active.length === 0 ? (
                <p className="muted" style={{ padding: 16 }}>No records left in the batch.</p>
              ) : (
                <table className="preview">
                  <thead>
                    <tr>{CSV_HEADERS.map((h) => <th key={h}>{h}</th>)}</tr>
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
                  <button type="button" className="btn-primary" onClick={() => setOpen(false)}>Done</button>
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
                  <button type="button" className="btn-text" onClick={() => setOpen(false)}>Cancel</button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={loading || callable.length === 0}
                    title="Send this batch to Bolna (live calls)"
                    onClick={() => setConfirming(true)}
                  >
                    <IconPhoneOutgoing size={15} /> Send to Bolna ({callable.length.toLocaleString()})
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
