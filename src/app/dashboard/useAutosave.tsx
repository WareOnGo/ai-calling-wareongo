"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { Autosave, type Values } from "@/lib/autosave";
import { useDashboardUI } from "./DashboardUI";
import { requestJson, RequestError } from "./requests";

type ConflictRecovery<T> = { review: () => void; unavailable: () => void; values: (row: T) => T };

export function useAutosave<T extends Values>(id: string, url: string, initial: T, rollback: (keyof T)[] = [], initialRevision = 0, validationDrafts: (keyof T)[] = [], recovery?: ConflictRecovery<T>) {
  const { reportSave, viewStorageKey } = useDashboardUI();
  const recoveryRef = useRef(recovery); recoveryRef.current = recovery;
  const baselineKnown = useRef(true);
  const version = useRef(initialRevision);
  const ref = useRef<Autosave<T> | null>(null);
  if (!ref.current) ref.current = new Autosave(initial, async patch => {
    const recover = recoveryRef.current;
    if (version.current < 0) throw new RequestError(recover ? "This recovered draft needs review before saving." : "This recovered draft predates version checks. Copy your changes, discard this draft, then refresh.", undefined, "ASSIGNMENT_CONFLICT");
    const baseline = baselineKnown.current ? ref.current!.getBaseline() : null;
    const send = (revision: number) => requestJson<T & { revision: number }>(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...patch, revision }) });
    let result: T & { revision: number };
    try { result = await send(version.current); }
    catch (error) {
      if (!recover || !(error instanceof RequestError) || error.code !== "ASSIGNMENT_CONFLICT") throw error;
      let latest: T & { revision: number };
      try { latest = await requestJson<T & { revision: number }>(url, { cache: "no-store" }); }
      catch (readError) {
        if (readError instanceof RequestError && readError.status === 404) {
          recover.unavailable();
          throw new RequestError("This assignment is no longer available. Your draft is still here.", undefined, "ASSIGNMENT_CONFLICT");
        }
        throw error; // Keep the draft and its review action when loading fails.
      }
      const unchangedDraft = () => {
        const draft = ref.current!.getDraft();
        return Object.keys(draft).length === Object.keys(patch).length && Object.keys(draft).every(key => draft[key] === patch[key]);
      };
      if (!unchangedDraft()) throw error;
      const values = recover.values(latest);
      if (Object.keys(patch).every(key => values[key] === patch[key])) result = latest;
      else {
        // A task-state change or a competing edit needs review. Recovered drafts
        // have no trustworthy original values, so only identical saves recover.
        if (!baseline || values.state !== baseline.state || !Object.keys(patch).every(key => values[key] === baseline[key] || values[key] === patch[key])) throw error;
        result = await send(latest.revision); // One retry; a second conflict stays visible.
        if (!unchangedDraft()) throw error;
      }
    }
    version.current = result.revision;
    baselineKnown.current = true;
    return recover?.values(result);
  }, rollback, validationDrafts);
  const queue = ref.current;
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const needsReview = useCallback(() => queue.getSnapshot().code === "ASSIGNMENT_CONFLICT" && !!recoveryRef.current, [queue]);
  const retry = useCallback(() => { if (needsReview()) recoveryRef.current!.review(); else queue.retry(); }, [queue, needsReview]);
  const flush = useCallback(() => { if (needsReview()) recoveryRef.current!.review(); else void queue.flush(); }, [queue, needsReview]);
  const storageKey = `${viewStorageKey}:draft:${id}`;
  useEffect(() => {
    // Tab-scoped recovery also covers browser Back/Forward, which bypasses links.
    // Never send a recovered draft until the caller explicitly saves it.
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      const draft = stored?.values ?? stored;
      if (draft && typeof draft === 'object' && !Array.isArray(draft)) {
        baselineKnown.current = false;
        version.current = Number.isInteger(stored.revision) ? stored.revision : -1;
        for (const [key, value] of Object.entries(draft)) if (key in queue.getSnapshot().values && typeof value === typeof queue.getSnapshot().values[key]) queue.set(key, value as T[string]);
        if (!queue.getSnapshot().dirty) { version.current = initialRevision; baselineKnown.current = true; }
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
  // Reconcile the server revision before refreshed controls become interactive.
  // A quick edit after logging a call must not submit the previous revision.
  // Dirty drafts retain their original revision so conflicts remain protected.
  useLayoutEffect(() => { if (!queue.getSnapshot().dirty) { version.current = initialRevision; baselineKnown.current = true; } queue.reconcile(JSON.parse(initialKey)); }, [queue, initialKey, initialRevision]);
  useEffect(() => {
    const report = () => { const current = queue.getSnapshot(); reportSave(id, { dirty: current.dirty, status: current.status, label: id, retry, discard: queue.discard, review: needsReview() }); };
    report();
    const unsubscribe = queue.subscribe(report);
    return () => {unsubscribe();reportSave(id, null);};
  }, [id, queue, reportSave, retry, needsReview]);
  // A server refresh can advance only the revision (for example an attempt event)
  // without changing any editable value. reconcile then emits no render, so
  // consumers must receive the fresh prop revision in this render itself.
  return { ...snapshot, revision:snapshot.dirty ? version.current : Math.max(initialRevision,version.current),
    set: <K extends keyof T>(key: K, value: T[K], commit = false) => { queue.set(key, value); if (commit) flush(); },
    flush, retry, retryLabel: needsReview() ? "Review changes" : "Retry", draft: queue.getDraft(), discard: queue.discard,
    resolveConflict: (values: T, revision: number, keepDraft: boolean) => {
      if (queue.getSnapshot().status === "saving") return;
      version.current = revision;
      baselineKnown.current = true;
      queue.rebase(values, keepDraft);
      if (keepDraft) void queue.flush();
    },
  };
}

export function SaveStatus({ id, status, error, retry, retryLabel = "Retry" }: { id: string; status: string; error: string; retry: () => void; retryLabel?: string }) {
  return <span id={`save-${id}`} className={`save-status ${status}`} role="status" aria-live="polite">
    {status === "saving" ? "Saving…" : status === "error" ? <><span>{error || "Couldn't save."}</span> <button type="button" onPointerDown={e=>e.preventDefault()} onClick={e => { if (retryLabel === "Review changes") e.currentTarget.focus(); retry(); }}>{retryLabel}</button>{error.includes('sign-in expired') && <> · <a href="/" target="_blank" rel="noreferrer">Sign in again</a></>}</> : status === "dirty" ? "Not saved yet" : status === "saved" ? "Saved" : null}
  </span>;
}
