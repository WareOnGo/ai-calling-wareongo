// Board write requests shared by the panel and drag and drop, so both move a
// card the same way: its open tasks (or all tasks of a finished card) with
// their current revisions.
import type { BoardCard, BoardTask } from "@/lib/board";
import { movableTasks, type Stage } from "@/lib/board-stages";
import { requestJson } from "../requests";

export const NEEDS_INPUT: readonly Stage[] = ["rejected", "junk", "warehouse_created"];
export type InputStage = "rejected" | "junk" | "warehouse_created";

export const sendJson = (url: string, method: string, body: unknown) =>
  requestJson(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const taskRefs = (tasks: BoardTask[]) => tasks.map(task => ({ id: task.id, revision: task.revision }));

export function requestMove(card: BoardCard, stage: Stage, extra: { reason?: string | null; wh_id?: string | null } = {}) {
  return sendJson("/api/board/move", "POST", { tasks: taskRefs(movableTasks(card.tasks)), stage, ...extra });
}
