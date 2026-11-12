// Board write requests shared by the panel and drag and drop, so both move a
// card the same way: its open tasks (or all tasks of a finished card) with
// their current revisions.
import type { BoardCard, BoardTask } from "@/lib/board";
import { movableTasks, type Stage } from "@/lib/board-stages";
import { requestJson } from "../requests";

export const NEEDS_INPUT: readonly Stage[] = ["rejected", "junk", "warehouse_created"];
export type InputStage = "rejected" | "junk" | "warehouse_created";

export const sendJson = (url: string, method: string, body: unknown, employee?: string) =>
  requestJson(url + (employee ? `?${new URLSearchParams({ employee })}` : ""), { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const taskRefs = (tasks: BoardTask[]) => tasks.map(task => ({ id: task.id, revision: task.revision }));

/** A card's identity on the board: one per caller and phone. */
export const cardId = (card: BoardCard) => `${card.assignee}:${card.key}`;
/** Follow-ups are due at 10:00 IST on the chosen day. */
export const followUpAt = (day: string) => `${day}T10:00:00+05:30`;
/** A timestamp's IST calendar day as YYYY-MM-DD, for date inputs. */
export const istDay = (value: string | null) => value ? new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "";
/** The IST calendar day `days` from now as YYYY-MM-DD. */
export const istDayIn = (days: number) => istDay(new Date(Date.now() + days * 86400_000).toISOString());

export function requestMove(card: BoardCard, stage: Stage, extra: { reason?: string | null; wh_id?: string | null } = {}, employee?: string) {
  return sendJson("/api/board/move", "POST", { tasks: taskRefs(movableTasks(card.tasks)), stage, ...extra }, employee);
}
