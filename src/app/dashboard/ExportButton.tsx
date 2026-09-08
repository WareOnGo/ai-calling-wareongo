"use client";
import { useState } from "react";
import { useSelection } from "./Selection";
import { useDashboardUI } from "./DashboardUI";
import { Dialog } from "./Dialog";
import { IconDownload } from "./icons";

export function ExportButton({ entity }: { entity: "calls" | "raw" }) {
  const { ids, allMatching, count } = useSelection();
  const { pending, notify } = useDashboardUI();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams(location.search); params.delete("page");
      if (ids.length && !allMatching) { params.set("ids", ids.join(",")); }
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
    <button type="button" className="btn-export" disabled={!count || pending} onClick={() => { setError(""); setOpen(true); }}><IconDownload size={15} />Export CSV</button>
    {open && <Dialog title="Export CSV" onClose={() => setOpen(false)} busy={busy}>
      <div className="modal-body"><p>Download <strong>{count.toLocaleString()}</strong> {ids.length && !allMatching ? "selected rows" : "rows matching the current filters"}?</p>{error && <p className="assign-error" role="alert">{error}</p>}</div>
      <div className="modal-foot"><span className="spacer" /><button type="button" className="btn-text" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={download}>{busy ? "Preparing CSV…" : error ? "Retry download" : "Download CSV"}</button></div>
    </Dialog>}
  </>;
}
