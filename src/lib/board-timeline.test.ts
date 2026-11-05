import { describe, expect, it } from "vitest";
import { timelineEvents, type AuditRow, type AttemptRow } from "./board-timeline";

const base = { task_id: "7", actor: "priya@eval.test", actor_name: "Priya Eval" };
const audit = (at: string, before: Record<string, unknown>, after: Record<string, unknown>, extra: Partial<AuditRow> = {}): AuditRow =>
  ({ ...base, at, before_values: { stage: "inbound", state: "open", remarks: null, next_due_at: null, outcome: null, wh_id: null, ...before },
    after_values: { stage: "inbound", state: "open", remarks: null, next_due_at: null, outcome: null, wh_id: null, ...after }, ...extra });

describe("card timeline events", () => {
  it("describes stage moves by code and label", () => {
    expect(timelineEvents([audit("2026-11-05T10:00:00Z", {}, { stage: "rnr", outcome: "Unclear" })], [])).toEqual([
      { taskId: "7", at: "2026-11-05T10:00:00Z", kind: "stage", text: "Moved to 2A RnR", actor: "priya@eval.test", actorName: "Priya Eval" },
    ]);
  });

  it("does not repeat the result a stage move implies, but reports other field changes in the same edit", () => {
    const events = timelineEvents([audit("2026-11-05T10:00:00Z", {}, { stage: "rejected", state: "done", outcome: "Unavailable", remarks: "leased out" })], []);
    expect(events.map(event => event.kind)).toEqual(["notes", "stage"]);
  });

  it("labels the backfill as the system placing the card from earlier notes", () => {
    const [event] = timelineEvents([audit("2026-11-05T10:00:00Z", { stage: null }, { stage: "rejected" }, { actor: "stage-backfill", actor_name: null })], []);
    expect(event).toMatchObject({ text: "Placed in 2B Unavailable / rejected from earlier notes", actorName: "System" });
  });

  it("reports notes, follow-up dates, results, completion and warehouse IDs edited outside a stage move", () => {
    const events = timelineEvents([
      audit("2026-11-05T10:05:00Z", {}, { remarks: "call after Diwali", next_due_at: "2026-11-10T04:30:00+00:00" }),
      audit("2026-11-05T10:04:00Z", { remarks: "x" }, { remarks: "" }),
      audit("2026-11-05T10:03:00Z", {}, { outcome: "Available", state: "done", wh_id: "4521" }, { actor: "warehouse-contact-sync", actor_name: null }),
    ], []);
    expect(events.map(({ kind, text, actorName }) => [kind, text, actorName])).toEqual([
      ["notes", "call after Diwali", "Priya Eval"],
      ["follow_up", "Follow-up set for 10 Nov 2026, 10:00 am IST", "Priya Eval"],
      ["notes", "Notes cleared", "Priya Eval"],
      ["result", "Result set to Available", "Warehouse sync"],
      ["state", "Marked done", "Warehouse sync"],
      ["warehouse", "Warehouse ID 4521", "Warehouse sync"],
    ]);
  });

  it("merges logged calls and orders everything newest first, calls before the move they caused", () => {
    const attempts: AttemptRow[] = [{ ...base, at: "2026-11-05T10:00:00Z", disposition: "no_answer", outcome: null, notes: null }];
    const events = timelineEvents([
      audit("2026-11-05T10:00:00Z", {}, { stage: "rnr", outcome: "Unclear" }),
      audit("2026-11-05T11:00:00Z", { stage: "rnr" }, { stage: "rnr", remarks: "rang twice" }),
    ], attempts);
    expect(events.map(event => [event.kind, event.text])).toEqual([["notes", "rang twice"], ["call", "No answer / RNR"], ["stage", "Moved to 2A RnR"]]);
  });

  it("ignores edits that change nothing a caller would see", () => {
    expect(timelineEvents([audit("2026-11-05T10:00:00Z", { revision: 1 }, { revision: 2 })], [])).toEqual([]);
  });
});
