"use client";

import { useState } from "react";
import { useDashboardUI } from "./DashboardUI";
import { requestJson } from "./requests";

export function ViewModeToggle({ admin }: { admin: boolean }) {
  const { hasDrafts, notify, pending } = useDashboardUI();
  const [busy, setBusy] = useState(false);
  async function switchTo(mode: "admin" | "employee") {
    if (busy || pending || (mode === "admin") === admin) return;
    if (hasDrafts()) { notify("Save or discard your unsaved changes before switching views."); return; }
    setBusy(true);
    try {
      await requestJson("/api/view-mode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) });
      // A fresh document discards cached pages from the previous access scope.
      window.location.assign(mode === "employee" ? "/dashboard/my" : "/dashboard");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn't switch views. Please try again.");
      setBusy(false);
    }
  }
  return <div className="view-mode" role="group" aria-label="Dashboard view" aria-busy={busy}>
    <button type="button" aria-pressed={admin} disabled={busy || pending} onClick={() => switchTo("admin")}>Admin view</button>
    <button type="button" aria-pressed={!admin} disabled={busy || pending} onClick={() => switchTo("employee")} title="See only work assigned to your account">Employee view</button>
    {busy && <span className="sr-only" role="status">Switching view…</span>}
  </div>;
}
