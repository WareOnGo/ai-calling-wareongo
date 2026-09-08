"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { Autosave, type Values } from "@/lib/autosave";
import { useDashboardUI } from "./DashboardUI";
import { requestJson } from "./requests";

export function useAutosave<T extends Values>(id: string, url: string, initial: T, rollback: (keyof T)[] = []) {
  const { reportSave, viewStorageKey } = useDashboardUI();
  const ref = useRef<Autosave<T> | null>(null);
  if (!ref.current) ref.current = new Autosave(initial, async patch => {
    await requestJson(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  }, rollback);
  const queue = ref.current;
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const storageKey = `${viewStorageKey}:draft:${id}`;
  useEffect(() => {
    // Tab-scoped recovery also covers browser Back/Forward, which bypasses links.
    // Never send a recovered draft until the caller explicitly saves it.
    try {
      const draft: unknown = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (draft && typeof draft === 'object' && !Array.isArray(draft)) {
        for (const [key, value] of Object.entries(draft)) if (key in queue.getSnapshot().values && typeof value === typeof queue.getSnapshot().values[key]) queue.set(key, value as T[string]);
      }
    } catch { /* Storage is optional; in-place recovery still works. */ }
    const persist = () => {
      try { if (queue.getSnapshot().dirty) sessionStorage.setItem(storageKey, JSON.stringify(queue.getDraft())); else sessionStorage.removeItem(storageKey); }
      catch { /* Storage can be disabled. */ }
    };
    persist();
    return queue.subscribe(persist);
  }, [queue, storageKey]);
  const initialKey = JSON.stringify(initial);
  useEffect(() => { queue.reconcile(JSON.parse(initialKey)); }, [queue, initialKey]);
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
