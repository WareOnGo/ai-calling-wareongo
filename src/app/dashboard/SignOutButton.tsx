"use client";
import { useState } from "react";
import { useDashboardUI } from "./DashboardUI";
import { requestJson } from "./requests";
export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const { hasDrafts, notify } = useDashboardUI();
  async function signOut() {
    if (hasDrafts()) { notify("Save or discard your unsaved changes before signing out."); return; }
    setBusy(true);
    try { await requestJson("/api/auth/logout", { method: "POST" }); window.location.href = "/"; }
    catch { notify("Couldn't sign out. Please try again."); setBusy(false); }
  }
  return <button className="btn secondary" onClick={signOut} disabled={busy} style={{padding:"6px 12px"}}>{busy ? "Signing out…" : "Sign out"}</button>;
}
