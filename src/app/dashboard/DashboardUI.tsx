"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Dialog } from "./Dialog";

type Save = { dirty: boolean; status: string; label: string; retry: () => void; discard: () => void };
type UI = {
  pending: boolean;
  navigate: (href: string) => void;
  refresh: () => void;
  notify: (text: string) => void;
  reportSave: (id: string, save: Save | null) => void;
  hasDrafts: () => boolean;
  viewStorageKey: string;
  isAdmin: boolean;
};
const Context = createContext<UI | null>(null);
export function useDashboardUI() {
  const value = useContext(Context);
  if (!value) throw new Error("DashboardUI is required");
  return value;
}

export function DashboardUI({ children, header, userEmail, isAdmin }: { children: React.ReactNode; header?: React.ReactNode; userEmail: string; isAdmin: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const saves = useRef(new Map<string, Save>());
  const [saveList, setSaveList] = useState<[string, Save][]>([]);
  const [message, setMessage] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const waiting = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((text: string) => {
    setMessage(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 6000);
  }, []);
  const hasDrafts = useCallback(() => [...saves.current.values()].some(s => s.dirty), []);
  const canLeave = useCallback((destination: string) => {
    if (!hasDrafts()) return true;
    const dirty = [...saves.current.values()].filter(s => s.dirty);
    if (dirty.every(s => s.status === 'saving')) { waiting.current = destination; return false; }
    notify("Finish saving your changes before leaving or refreshing. Your drafts are still here.");
    return false;
  }, [hasDrafts, notify]);
  const navigate = useCallback((href: string) => {
    if (canLeave(href)) startTransition(() => router.push(href, { scroll: false }));
  }, [router, canLeave]);
  const refresh = useCallback(() => {
    if (canLeave('refresh')) startTransition(() => router.refresh());
  }, [router, canLeave]);
  const reportSave = useCallback((id: string, save: Save | null) => {
    if (save) saves.current.set(id, save); else saves.current.delete(id);
    setSaveList([...saves.current.entries()]);
  }, []);
  useEffect(() => {
    if (!waiting.current) return;
    if (saveList.some(([,s]) => s.status === 'error')) {waiting.current = null;notify("Couldn't save before leaving. Your drafts are still here; retry the changes.");return;}
    if (hasDrafts()) return;
    const destination = waiting.current; waiting.current = null;
    startTransition(() => destination === 'refresh' ? router.refresh() : router.push(destination, {scroll:false}));
  }, [saveList, hasDrafts, router, notify]);
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => { if (hasDrafts()) { e.preventDefault(); e.returnValue = ""; } };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
      if (!a || a.target === "_blank" || a.download || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const url = new URL(a.href, location.href);
      if (url.origin === location.origin && url.pathname.startsWith('/dashboard')) {
        e.preventDefault(); e.stopPropagation();
        navigate(url.pathname + url.search + url.hash);
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", onClick, true); };
  }, [hasDrafts, navigate]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const failed = saveList.filter(([, s]) => s.status === "error");
  const saving = saveList.some(([, s]) => s.status === "saving");
  const dirty = saveList.filter(([, s]) => s.dirty);
  return <Context.Provider value={{ pending, navigate, refresh, notify, reportSave, hasDrafts, isAdmin, viewStorageKey: `dashboard-views:${userEmail}` }}>
    {header}
    {pending && <div className="navigation-progress" role="status"><span />Updating results…</div>}
    {(saveList.length > 0 || pathname === "/dashboard/calls" || pathname === "/dashboard/my") && <div className={`sheet-save-status${failed.length ? " has-error" : ""}`} role="status" aria-live="polite">
      {!saveList.length ? "Edits save automatically" : failed.length ? <>{failed.length} {failed.length === 1 ? "row hasn't" : "rows haven't"} saved. Your drafts are still here.
        <button type="button" onClick={() => failed.forEach(([, s]) => s.retry())}>Retry</button>
        <button type="button" onClick={() => document.getElementById(`save-${failed[0][0]}`)?.scrollIntoView({ block: "center", inline: "nearest" })}>Show change</button>
        <button type="button" disabled={saving} onClick={() => setDiscardOpen(true)}>Discard unsaved changes…</button>
      </> : saving ? "Saving changes…" : dirty.length ? <>Unsaved changes<button type="button" onClick={() => dirty.forEach(([, s]) => s.retry())}>Save changes</button><button type="button" onClick={() => setDiscardOpen(true)}>Discard…</button></> : "All changes saved"}
    </div>}
    <div className="dashboard-content dash-main" aria-busy={pending} data-page={pathname}>{children}</div>
    <div className="notification-region" role="status" aria-live="polite">{message && <div className="snackbar">{message}<button type="button" onClick={() => setMessage("")} aria-label="Dismiss notification">×</button></div>}</div>
    {discardOpen && <Dialog title="Discard unsaved changes?" onClose={() => setDiscardOpen(false)} busy={saving}>
      <div className="modal-body"><p>This removes the unsaved edits in {dirty.length} {dirty.length === 1 ? 'row' : 'rows'}. Successfully saved changes will stay.</p></div>
      <div className="modal-foot"><button className="btn secondary" onClick={() => setDiscardOpen(false)}>Keep editing</button><button className="btn" disabled={saving} onClick={() => {dirty.forEach(([, s]) => s.discard());setDiscardOpen(false);notify('Unsaved changes discarded');}}>Discard changes</button></div>
    </Dialog>}
  </Context.Provider>;
}

export function Freshness({ updatedAt }: { updatedAt: string }) {
  const { pending, refresh } = useDashboardUI();
  return <span className="freshness">Updated {new Date(updatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST
    <button type="button" className="btn-row" disabled={pending} onClick={refresh}>{pending ? "Refreshing…" : "Refresh"}</button>
  </span>;
}
