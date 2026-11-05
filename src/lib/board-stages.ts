// Caller board stages and the rules for moving a task between them. Framework-free
// so the same rules drive the API, the board and their unit tests.
// See docs/CALLER_BOARD.md for the PRD decisions behind these rules.
import type { Outcome } from "./scope";

export const STAGES = [
  { slug: "inbound", short: "Inbound", code: "1", label: "Inbound", hint: "New or not yet worked", terminal: false },
  { slug: "rnr", short: "RnR", code: "2A", label: "RnR", hint: "Rang, no response", terminal: false },
  { slug: "rejected", short: "Rejected", code: "2B", label: "Unavailable / rejected", hint: "Owner said no or is unavailable", terminal: true },
  { slug: "awaiting_details", short: "Awaiting", code: "2C", label: "Available, details awaited", hint: "Confirmed available; chase details", terminal: false },
  { slug: "details_collected", short: "Details", code: "3", label: "Details collected", hint: "Size, rent and specs captured", terminal: false },
  { slug: "warehouse_created", short: "Warehouse", code: "4", label: "Warehouse ID created", hint: "Listed in the warehouse DB", terminal: true },
  { slug: "junk", short: "Junk", code: "5", label: "Junk", hint: "Wrong number or no response after repeated tries", terminal: true },
] as const;

export type Stage = (typeof STAGES)[number]["slug"];
export type StageInfo = (typeof STAGES)[number];
export const STAGE_SLUGS: Stage[] = STAGES.map(stage => stage.slug);
export const TERMINAL_STAGES: readonly Stage[] = STAGES.filter(stage => stage.terminal).map(stage => stage.slug);

export const isStage = (value: unknown): value is Stage => typeof value === "string" && (STAGE_SLUGS as string[]).includes(value);
export const isTerminal = (stage: Stage) => TERMINAL_STAGES.includes(stage);
export const stageInfo = (stage: Stage): StageInfo => STAGES.find(info => info.slug === stage)!;

/** Reasons use the existing manual-call vocabulary, so reports read them unchanged. */
export const JUNK_REASONS = { invalid_number: "Wrong or invalid number", owner_unresponsive: "No response after repeated tries" } as const;
export const REJECTION_REASONS = { leased_out: "Leased out", no_property_for_rent: "No property for rent" } as const;
export type JunkReason = keyof typeof JUNK_REASONS;
export type RejectionReason = keyof typeof REJECTION_REASONS;
const CLOSURE_FOR_JUNK: Record<JunkReason, "invalid_number_verified" | "exhausted"> = { invalid_number: "invalid_number_verified", owner_unresponsive: "exhausted" };

/** What each stage says about the owner's answer; null leaves the saved result alone. */
const OUTCOME_FOR_STAGE: Record<Stage, Outcome | null> = {
  inbound: null, rnr: "Unclear", rejected: "Unavailable", awaiting_details: "Available",
  details_collected: "Available", warehouse_created: "Available", junk: null,
};

// Same rule as the database's bolna_valid_warehouse(): a positive integer, no leading zero.
const WAREHOUSE_ID = /^[1-9][0-9]{0,99}$/;

export type TaskSnapshot = {
  stage: Stage; state: "open" | "done"; outcome: string | null; wh_id: string | null;
  added_to_db: boolean; disposition: string | null; warehouseIds: number[];
};
export type MoveInput = { stage: Stage; reason?: string | null; whId?: string | null };
export type MovePlan = {
  stage: Stage; state: "open" | "done"; outcome: string | null; whId: string | null; addedToDb: boolean;
  disposition: string | null; closureReason: string | null;
  complete: boolean; reopen: boolean; clearFollowUp: boolean; logNoAnswer: boolean; unchanged: boolean;
};

export class MoveError extends Error {
  constructor(public code: string, public field: "reason" | "wh_id" | "stage", message: string) { super(message); }
}

function warehouseFor(task: TaskSnapshot, requested: string | null | undefined): string {
  const entered = requested?.trim();
  if (entered) {
    if (!WAREHOUSE_ID.test(entered)) throw new MoveError("INVALID_WAREHOUSE_ID", "wh_id", "Warehouse ID must be a positive whole number, such as 4521.");
    return entered;
  }
  const saved = task.wh_id?.trim();
  if (saved && WAREHOUSE_ID.test(saved)) return saved;
  if (task.warehouseIds.length === 1) return String(task.warehouseIds[0]);
  throw new MoveError("WAREHOUSE_ID_REQUIRED", "wh_id", task.warehouseIds.length > 1
    ? `This number matches warehouses ${task.warehouseIds.join(", ")}. Enter the one this lead created.`
    : "Enter the warehouse ID this lead created.");
}

function reasonFor(stage: Stage, reason: string | null | undefined): string | null {
  if (stage === "junk") {
    if (!reason) throw new MoveError("REASON_REQUIRED", "reason", "Choose why this lead is junk.");
    if (!Object.hasOwn(JUNK_REASONS, reason)) throw new MoveError("INVALID_REASON", "reason", "Choose one of the listed junk reasons.");
    return reason;
  }
  if (stage === "rejected") {
    if (reason && !Object.hasOwn(REJECTION_REASONS, reason)) throw new MoveError("INVALID_REASON", "reason", "Choose one of the listed rejection reasons.");
    return reason || null;
  }
  if (reason) throw new MoveError("REASON_NOT_ALLOWED", "reason", "Only Rejected and Junk take a reason.");
  return null;
}

/**
 * Work out every field a move changes. Terminal stages finish the task; moving
 * finished work to an open stage reopens it. The caller enforces ownership,
 * revisions and reopen conflicts; this function only applies the stage rules.
 */
export function planMove(task: TaskSnapshot, input: MoveInput): MovePlan {
  const terminal = isTerminal(input.stage);
  const reason = reasonFor(input.stage, input.reason);
  const state = terminal ? "done" : "open";
  const reopen = task.state === "done" && !terminal;
  const whId = input.stage === "warehouse_created" ? warehouseFor(task, input.whId) : task.wh_id;
  // A finished card keeps its reason only while it stays finished; reopened work starts clean.
  const disposition = terminal ? reason : reopen ? null : task.disposition;
  const closureReason = input.stage === "junk" ? CLOSURE_FOR_JUNK[reason as JunkReason] : null;
  const plan: MovePlan = {
    stage: input.stage, state, outcome: OUTCOME_FOR_STAGE[input.stage] ?? task.outcome, whId,
    addedToDb: input.stage === "warehouse_created" ? true : task.added_to_db,
    disposition, closureReason, complete: task.state === "open" && terminal, reopen,
    clearFollowUp: terminal, logNoAnswer: input.stage === "rnr" && task.stage !== "rnr", unchanged: false,
  };
  plan.unchanged = task.stage === input.stage && task.state === state && plan.disposition === task.disposition && plan.whId === task.wh_id;
  return plan;
}
