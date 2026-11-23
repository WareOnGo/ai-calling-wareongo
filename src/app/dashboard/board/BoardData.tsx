"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { BoardSnapshot } from "@/lib/board";
import { boardSearchValues, type BoardFilters, type ColumnLimits } from "@/lib/board-filters";
import { searchQuery } from "@/lib/filter-values";
import { useDashboardUI } from "../DashboardUI";
import { requestJson } from "../requests";

export type BoardWrite = (url: string, method: string, body: unknown) => Promise<unknown>;
type Value = { data: BoardSnapshot; updatedAt: string; write: BoardWrite; busy: boolean };
const Context = createContext<Value | null>(null);
// Only a timestamp is retained across mounts. Back/Forward can restore an RSC
// payload from before a save; reload that view on return, not on every save.
// Both timestamps come from the server so the browser clock does not matter.
let lastBoardWriteAt = "";
export function useBoardData() {
  const value = useContext(Context);
  if (!value) throw new Error("BoardData provider is required");
  return value;
}

/** Saves return one authoritative snapshot: no second page request, option reads,
 * or guessed stages/counts. Serialize this view's writes to prevent an older
 * response replacing a newer one. Other callers/cards still use database locks. */
export function BoardData({ data, updatedAt, filters, limits, children }: {
  data: BoardSnapshot; updatedAt: string; filters: BoardFilters; limits: ColumnLimits; children: ReactNode;
}) {
  const { refresh, notify, pending } = useDashboardUI();
  const [state, setState] = useState({ source: data, data, updatedAt, needsRefresh: updatedAt < lastBoardWriteAt });
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const source = useRef(data);
  source.current = data;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Navigation/manual refresh replaces the snapshot without remounting entry
  // confirmations or notes. A late save response cannot overwrite another view.
  if (state.source !== data) setState({ source: data, data, updatedAt, needsRefresh: updatedAt < lastBoardWriteAt });
  useEffect(() => { if (state.needsRefresh) refresh(); }, [state.source, state.needsRefresh, refresh]);

  const write: BoardWrite = async (url, method, body) => {
    if (inFlight.current || state.needsRefresh) throw new Error("Wait for the board to update before saving another change.");
    inFlight.current = true; setSaving(true);
    const startedWith = data;
    try {
      const response = await requestJson<{ boardView?: BoardSnapshot; boardSavedAt?: string; boardRefreshFailed?: boolean }>(
        url + (filters.employee ? `?${new URLSearchParams({ employee: filters.employee })}` : ""),
        { method, headers: { "Content-Type": "application/json", "X-Board-View": searchQuery(boardSearchValues(filters, limits)).toString() }, body: JSON.stringify(body) });
      if (response.boardSavedAt && response.boardSavedAt > lastBoardWriteAt) lastBoardWriteAt = response.boardSavedAt;
      if (mounted.current) {
        if (source.current === startedWith && response.boardView) {
          setState({ source: startedWith, data: response.boardView, updatedAt: response.boardSavedAt ?? updatedAt, needsRefresh: false });
        } else {
          // The write already succeeded. Keep that fact separate from a failed
          // snapshot read and require fresh revisions before another edit.
          setState(current => ({ ...current, needsRefresh: true }));
          if (!response.boardView) notify("Saved. Refreshing the board to load the latest changes.");
        }
      }
      return response;
    } finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  };
  return <Context.Provider value={{ data: state.data, updatedAt: state.updatedAt, write, busy: saving || pending || state.needsRefresh }}>{children}</Context.Provider>;
}
