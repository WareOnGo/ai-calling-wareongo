"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { Autosave, type Values } from "@/lib/autosave";
import { useDashboardUI } from "./DashboardUI";
import { requestJson } from "./requests";

export function useAutosave<T extends Values>(id: string, url: string, initial: T, rollback: (keyof T)[] = [], initialRevision = 0) {
  const { reportSave, viewStorageKey } = useDashboardUI();
  const version = useRef(initialRevision);
  const ref = useRef<Autosave<T> | null>(null);
  if (!ref.current) ref.current = new Autosave(initial, async patch => {
    if (version.current < 0) throw new Error("This recovered draft predates version checks. Copy your changes, discard this draft, then refresh.");
    const result = await requestJson(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...patch, revision: version.current }) });
    version.current = result.revision;
  }, rollback);
  const queue = ref.current;
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const storageKey = `${viewStorageKey}:draft:${id}`;
  useEffect(() => {
    // Tab-scoped recovery also covers browser Back/Forward, which bypasses links.
    // Never send a recovered draft until the caller explicitly saves it.
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      const draft = stored?.values ?? stored;
      if (draft && typeof draft === 'object' && !Array.isArray(draft)) {
        version.current = Number.isInteger(stored.revision) ? stored.revision : -1;
        for (const [key, value] of Object.entries(draft)) if (key in queue.getSnapshot().values && typeof value === typeof queue.getSnapshot().values[key]) queue.set(key, value as T[string]);
      }
    } catch { /* Storage is optional; in-place recovery still works. */ }
    const persist = () => {
      try { if (queue.getSnapshot().dirty) sessionStorage.setItem(storageKey, JSON.stringify({ values: queue.getDraft(), revision: version.current })); else sessionStorage.removeItem(storageKey); }
      catch { /* Storage can be disabled. */ }
    };
    persist();
    return queue.subscribe(persist);
  }, [queue, storageKey]);
  const initialKey = JSON.stringify(initial);
  useEffect(() => { if (!queue.getSnapshot().dirty) version.current = initialRevision; queue.reconcile(JSON.parse(initialKey)); }, [queue, initialKey, initialRevision]);
  useEffect(() => {
    const report = () => { const current = queue.getSnapshot(); reportSave(id, { dirty: current.dirty, status: current.status, label: id, retry: queue.retry, discard: queue.discard }); };
    report();
    const unsubscribe = queue.subscribe(report);
    return () => {unsubscribe();reportSave(id, null);};
  }, [id, queue, reportSave]);
  return { ...snapshot, set: queue.set.bind(queue), flush: () => queue.flush(), retry: queue.retry };
}

export function SaveStatus({ id, status, error, retry }: { id: string; status: string; error: string; retry: () => void }) {
  return <span id={`save-${id}`} className={`save-status ${status}`} role="status" aria-live="polite">
    {status === "saving" ? "Saving…" : status === "error" ? <><span>{error || "Couldn't save."}</span> <button type="button" onClick={retry}>Retry</button>{error.includes('sign-in expired') && <> · <a href="/" target="_blank" rel="noreferrer">Sign in again</a></>}</> : status === "dirty" ? "Not saved yet" : status === "saved" ? "Saved" : null}
  </span>;
}
