"use client";

import { useState } from "react";
import { IconDownload } from "./icons";

// Full raw-dataset CSV export (mirrors the Call Analytics export, but for raw_records).
// Respects the grid's checkbox selection: if any rows are checked, only those export;
// otherwise the whole filtered set exports. Either way it confirms the count first,
// since an unfiltered export can be tens of thousands of rows.
export function RawExportButton({ total }: { total: number }) {
  const [confirming, setConfirming] = useState(false);
  const [selIds, setSelIds] = useState<string[]>([]);

  const open = () => {
    const boxes = document.querySelectorAll<HTMLInputElement>("tbody input.rowsel:checked");
    setSelIds(Array.from(boxes).map((b) => b.dataset.id ?? "").filter(Boolean));
    setConfirming(true);
  };

  const count = selIds.length > 0 ? selIds.length : total;

  const doExport = () => {
    // Content-Disposition: attachment → the browser downloads without navigating away.
    const href =
      selIds.length > 0
        ? `/api/raw/export?ids=${encodeURIComponent(selIds.join(","))}`
        : `/api/raw/export${window.location.search}`;
    window.location.href = href;
    setConfirming(false);
  };

  return (
    <>
      <button
        type="button"
        className="btn-export"
        onClick={open}
        disabled={total === 0}
        title={total === 0 ? "No records to export" : "Export to CSV (selected rows, or all if none selected)"}
      >
        <IconDownload size={15} /> Export CSV
      </button>

      {confirming && (
        <div className="modal-backdrop" onClick={() => setConfirming(false)}>
          <div className="modal confirm-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title"><IconDownload size={16} /> Export CSV</div>
            </div>
            <p className="modal-sub" style={{ padding: "12px 18px 18px" }}>
              You&apos;re about to download <strong>{count.toLocaleString()}</strong>{" "}
              {selIds.length > 0 ? "selected record(s)" : "record(s) matching the current filters"}. Are you sure?
            </p>
            <div className="modal-foot">
              <span className="spacer" />
              <button type="button" className="btn-text" onClick={() => setConfirming(false)}>No</button>
              <button type="button" className="btn-primary" onClick={doExport}>
                <IconDownload size={15} /> Yes, download
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
