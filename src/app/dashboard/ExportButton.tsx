"use client";
import { useState } from "react";
import { useSelection } from "./Selection";
import { useDashboardUI } from "./DashboardUI";
import { Dialog } from "./Dialog";
import { IconDownload } from "./icons";

export function ExportButton({ entity }: { entity: "calls" | "raw" }) {
  const { ids, allMatching, total } = useSelection();
  const { pending, notify } = useDashboardUI();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scope, setScope] = useState<"selected" | "matching">("matching");
  const count = scope === "selected" ? ids.length : total;
  async function download() {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams(location.search);
      // Selection comes from this dialog, never stale IDs or paging in the URL.
      for (const key of ["ids", "page", "records_page", "calls_page"]) params.delete(key);
      if (scope === "selected") params.set("ids", ids.join(","));
      const res = await fetch(`/api/${entity}/export?${params}`, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(res.status === 401 ? "Your sign-in expired. Sign in again to export." : "Couldn't prepare the CSV. Please retry.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `bolna-${entity}.csv`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      setOpen(false); notify("CSV prepared. Your download has started.");
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't prepare the CSV."); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="btn-export" disabled={!total || pending} onClick={() => { setError(""); setScope(ids.length && !allMatching ? "selected" : "matching"); setOpen(true); }}><IconDownload size={15} />Export CSV</button>
    {open && <Dialog title="Export CSV" onClose={() => setOpen(false)} busy={busy}>
      <div className="modal-body">
        <fieldset className="plain-fieldset" disabled={busy}>
          <legend className="sr-only">Rows to export</legend>
          <div className="assign-scope">
            <label className={scope === "selected" ? "active" : undefined}><input type="radio" name="export-scope" checked={scope === "selected"} disabled={!ids.length} onChange={() => setScope("selected")} />{ids.length.toLocaleString()} selected rows on this page</label>
            <label className={scope === "matching" ? "active" : undefined}><input type="radio" name="export-scope" checked={scope === "matching"} onChange={() => setScope("matching")} />All {total.toLocaleString()} matching rows</label>
          </div>
        </fieldset>
        <p>Download <strong>{count.toLocaleString()}</strong> {scope === "selected" ? "selected rows" : "rows matching the current filters"}?</p>
        {scope === "matching" && <p className="muted">Includes every page of the current filtered results.</p>}
        {error && <p className="assign-error" role="alert">{error}</p>}
      </div>
      <div className="modal-foot"><span className="spacer" /><button type="button" className="btn-text" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn-primary" disabled={busy || !count} onClick={download}>{busy ? "Preparing CSV…" : error ? "Retry download" : "Download CSV"}</button></div>
    </Dialog>}
  </>;
}
