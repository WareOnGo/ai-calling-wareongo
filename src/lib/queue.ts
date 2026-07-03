// Pure preprocessing logic for the "queue for calling" flow — number normalization,
// dedup, CSV building, and already-called classification. Kept framework-free (no
// React, no pg) so it can be shared by the client modal (QueueForCalling) and the
// server page, and unit-tested in isolation. See src/lib/queue.test.ts.

export type CallCat = "" | "dead" | "unclear" | "available" | "unavailable";

// One record staged for a Bolna call. `cat` flags an already-called number by its
// last outcome ("" = never called). `state` drives region/language routing. `queued`
// is true when the number is already in a live (sending/scheduled) batch.
export type QueueSel = {
  id: string; name: string; contact: string; area: string; state: string;
  cat: CallCat; queued: boolean;
};

// The Bolna batch CSV shape (mirrors the manual Rajkot/Delhi exports).
export const PROPERTY_TYPE = "warehouse";
export const CSV_HEADERS = ["name", "property_type", "contact_number", "area"] as const;

// Display metadata for the already-called categories, in warning-banner order.
export const CALLED_CATS: { key: Exclude<CallCat, "">; label: string }[] = [
  { key: "dead", label: "No answer" },
  { key: "unclear", label: "Unclear" },
  { key: "available", label: "Available" },
  { key: "unavailable", label: "Unavailable" },
];

// Short label for the inline tag next to an owner's name ("dead" reads as "no-answer").
export const CAT_TAG_LABEL: Record<Exclude<CallCat, "">, string> = {
  dead: "no-answer",
  unclear: "unclear",
  available: "available",
  unavailable: "unavailable",
};

// Classify a record's call history into a category. Mirrors the SQL CASE in
// getRawQueueRows so page-scope (DOM) and cross-page (fetched) selections tag
// identically. `callCount` may arrive as a string ("0") from pg — coerce it, since
// a non-empty string is otherwise truthy and would misfire the "fresh" check.
export function deriveCat(
  callCount: number | string | null | undefined,
  lastAvailability: string | null | undefined,
): CallCat {
  if (!Number(callCount)) return ""; // never called
  const a = (lastAvailability ?? "").toLowerCase();
  if (a === "available" || a === "unavailable" || a === "unclear") return a;
  return "dead"; // called but no availability determined (didn't connect)
}

// CSV cell with Excel-safe quoting.
export function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function buildCsv(rows: QueueSel[]): string {
  const lines = [
    CSV_HEADERS.join(","),
    ...rows.map((r) => [r.name, PROPERTY_TYPE, r.contact, r.area].map(csvCell).join(",")),
  ];
  return "﻿" + lines.join("\r\n"); // BOM so Excel reads UTF-8
}

// Normalize a phone number for dedup: digits only, last 10 (drops +91 / 0 prefixes).
export function normNum(s: string | null | undefined): string {
  const d = (s ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

// Dedup by normalized number, keeping the first occurrence. Rows with no number
// pass through (they'll be shown as skipped downstream, not silently dropped).
export function dedupByNumber(rows: QueueSel[]): QueueSel[] {
  const seen = new Set<string>();
  const out: QueueSel[] = [];
  for (const r of rows) {
    const key = normNum(r.contact);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(r);
  }
  return out;
}
