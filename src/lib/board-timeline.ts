// Turns a card's audit history and logged calls into readable timeline events.
// Pure, so the wording and ordering are unit-tested without a database.
import { dateTime } from "./display";
import { dispositionLabel } from "./manual-dispositions";
import { isStage, stageInfo } from "./board-stages";

type Values = Record<string, unknown>;
export type AuditRow = { task_id: string; actor: string | null; actor_name: string | null; at: string; before_values: Values; after_values: Values };
export type AttemptRow = { task_id: string; actor: string | null; actor_name: string | null; at: string; disposition: string; outcome: string | null; notes: string | null };
export type TimelineKind = "notes" | "follow_up" | "call" | "stage" | "result" | "state" | "warehouse";
export type TimelineEvent = { taskId: string; at: string; kind: TimelineKind; text: string; actor: string | null; actorName: string };

// Writes by migrations (019 backfill, 021 catch-up) and jobs, not by a person.
const SYSTEM_ACTORS: Record<string, string> = { "stage-backfill": "System", "stage-sync": "System", "warehouse-contact-sync": "Warehouse sync" };
// Equal timestamps come from one transaction: show its edits, then the call, then the move it caused.
const ORDER: TimelineKind[] = ["notes", "follow_up", "call", "result", "state", "warehouse", "stage"];
const STATE_TEXT: Record<string, string> = { done: "Marked done", open: "Reopened", dropped: "Unassigned" };

const text = (value: unknown) => typeof value === "string" ? value.trim() : value == null ? "" : String(value);
const changed = (before: Values, after: Values, key: string) => text(before[key]) !== text(after[key]);
const actorName = (actor: string | null, name: string | null) => (actor && SYSTEM_ACTORS[actor]) || name || actor || "Unknown";

function auditEvents(row: AuditRow): TimelineEvent[] {
  const { before_values: before, after_values: after } = row;
  const event = (kind: TimelineKind, description: string): TimelineEvent =>
    ({ taskId: row.task_id, at: row.at, kind, text: description, actor: row.actor, actorName: actorName(row.actor, row.actor_name) });
  const events: TimelineEvent[] = [];
  const stageMoved = changed(before, after, "stage") && isStage(after.stage);
  if (stageMoved) {
    const stage = stageInfo(after.stage as Parameters<typeof stageInfo>[0]);
    events.push(event("stage", before.stage == null ? `Placed in ${stage.code} ${stage.label} from earlier notes` : `Moved to ${stage.code} ${stage.label}`));
  }
  if (changed(before, after, "remarks")) events.push(event("notes", text(after.remarks) || "Notes cleared"));
  if (changed(before, after, "next_due_at")) events.push(event("follow_up", after.next_due_at ? `Follow-up set for ${dateTime(String(after.next_due_at))}` : "Follow-up cleared"));
  // A stage move implies its result and completion; report those only for other edits.
  if (!stageMoved) {
    if (changed(before, after, "outcome")) events.push(event("result", after.outcome ? `Result set to ${text(after.outcome)}` : "Result cleared"));
    if (changed(before, after, "state") && STATE_TEXT[text(after.state)]) events.push(event("state", STATE_TEXT[text(after.state)]));
    if (changed(before, after, "wh_id")) events.push(event("warehouse", after.wh_id ? `Warehouse ID ${text(after.wh_id)}` : "Warehouse ID removed"));
  }
  return events;
}

export function timelineEvents(audit: AuditRow[], attempts: AttemptRow[]): TimelineEvent[] {
  const calls = attempts.map((attempt): TimelineEvent => ({
    taskId: attempt.task_id, at: attempt.at, kind: "call", actor: attempt.actor, actorName: actorName(attempt.actor, attempt.actor_name),
    text: [dispositionLabel(attempt.disposition), attempt.outcome, attempt.notes?.trim()].filter(Boolean).join(" · "),
  }));
  return [...audit.flatMap(auditEvents), ...calls].sort((a, b) =>
    Date.parse(b.at) - Date.parse(a.at) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}
