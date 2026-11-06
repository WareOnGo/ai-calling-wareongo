import { describe, expect, it } from "vitest";
import { STAGES, STAGE_SLUGS, TERMINAL_STAGES, isStage, isTerminal, stageInfo, planMove, movableTasks, MoveError, type TaskSnapshot } from "./board-stages";

describe("which tasks a card move touches", () => {
  it("moves only open tasks while any are open, so finished listings are not reopened by accident", () => {
    const tasks = [{ id: "1", state: "open" }, { id: "2", state: "done" }, { id: "3", state: "open" }];
    expect(movableTasks(tasks).map(t => t.id)).toEqual(["1", "3"]);
  });
  it("moves every task of a finished card", () => {
    expect(movableTasks([{ id: "1", state: "done" }, { id: "2", state: "done" }]).map(t => t.id)).toEqual(["1", "2"]);
  });
});

const task = (overrides: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
  stage: "inbound", state: "open", outcome: null, wh_id: null, added_to_db: false, disposition: null, warehouseIds: [], ...overrides,
});
const moveError = (fn: () => unknown) => { try { fn(); } catch (error) { return error as MoveError; } throw new Error("expected a MoveError"); };

describe("board stages", () => {
  it("lists the seven PRD columns in board order with codes", () => {
    expect(STAGES.map(stage => [stage.slug, stage.code])).toEqual([
      ["inbound", "1"], ["rnr", "2A"], ["rejected", "2B"], ["awaiting_details", "2C"],
      ["details_collected", "3"], ["warehouse_created", "4"], ["junk", "5"],
    ]);
    expect(STAGE_SLUGS).toHaveLength(7);
    expect(stageInfo("rnr").label).toBe("RnR");
  });

  it("treats 2B, 4 and 5 as the stages that end a task", () => {
    expect([...TERMINAL_STAGES]).toEqual(["rejected", "warehouse_created", "junk"]);
    expect(isTerminal("junk")).toBe(true);
    expect(isTerminal("details_collected")).toBe(false);
  });

  it("recognises only known stage slugs", () => {
    expect(isStage("rnr")).toBe(true);
    for (const value of ["2A", "RNR", "", null, undefined, 4]) expect(isStage(value)).toBe(false);
  });
});

describe("planning a stage move", () => {
  it("keeps open work open and records the result each stage implies", () => {
    expect(planMove(task(), { stage: "awaiting_details" })).toMatchObject({ stage: "awaiting_details", state: "open", outcome: "Available", complete: false, reopen: false });
    expect(planMove(task({ outcome: "Available" }), { stage: "details_collected" })).toMatchObject({ outcome: "Available" });
    expect(planMove(task(), { stage: "rnr" })).toMatchObject({ outcome: "Unclear", logNoAnswer: true });
  });

  it("leaves the result alone when moving back to Inbound", () => {
    expect(planMove(task({ stage: "rnr", outcome: "Unclear" }), { stage: "inbound" })).toMatchObject({ outcome: "Unclear", state: "open" });
  });

  it("logs a no-answer attempt only when a card enters RnR", () => {
    expect(planMove(task({ stage: "inbound" }), { stage: "rnr" }).logNoAnswer).toBe(true);
    expect(planMove(task({ stage: "rnr" }), { stage: "awaiting_details" }).logNoAnswer).toBe(false);
  });

  it("completes a task moved to Rejected and clears its follow-up date", () => {
    expect(planMove(task({ stage: "rnr" }), { stage: "rejected" })).toMatchObject({
      state: "done", outcome: "Unavailable", complete: true, clearFollowUp: true, disposition: null,
    });
  });

  it("accepts an optional rejection reason from the call vocabulary", () => {
    expect(planMove(task(), { stage: "rejected", reason: "leased_out" }).disposition).toBe("leased_out");
    expect(moveError(() => planMove(task(), { stage: "rejected", reason: "invalid_number" }))).toMatchObject({ code: "INVALID_REASON", field: "reason" });
  });

  it("requires a reason to move a card to Junk and records a matching closure", () => {
    expect(moveError(() => planMove(task(), { stage: "junk" }))).toMatchObject({ code: "REASON_REQUIRED", field: "reason" });
    expect(planMove(task(), { stage: "junk", reason: "invalid_number" })).toMatchObject({
      state: "done", disposition: "invalid_number", closureReason: "invalid_number_verified", outcome: null,
    });
    expect(planMove(task({ outcome: "Unclear" }), { stage: "junk", reason: "owner_unresponsive" })).toMatchObject({
      disposition: "owner_unresponsive", closureReason: "exhausted", outcome: "Unclear",
    });
  });

  it("rejects reasons on stages that take none", () => {
    expect(moveError(() => planMove(task(), { stage: "awaiting_details", reason: "leased_out" }))).toMatchObject({ code: "REASON_NOT_ALLOWED" });
  });

  it("requires a positive integer warehouse ID for stage 4 and marks it added to the DB", () => {
    expect(moveError(() => planMove(task(), { stage: "warehouse_created" }))).toMatchObject({ code: "WAREHOUSE_ID_REQUIRED", field: "wh_id" });
    expect(moveError(() => planMove(task(), { stage: "warehouse_created", whId: "WH-12" }))).toMatchObject({ code: "INVALID_WAREHOUSE_ID", field: "wh_id" });
    expect(moveError(() => planMove(task(), { stage: "warehouse_created", whId: "012" }))).toMatchObject({ code: "INVALID_WAREHOUSE_ID" });
    expect(planMove(task(), { stage: "warehouse_created", whId: " 4521 " })).toMatchObject({
      state: "done", outcome: "Available", whId: "4521", addedToDb: true, complete: true,
    });
  });

  it("reuses a saved warehouse ID or the only warehouse matched to the phone", () => {
    expect(planMove(task({ wh_id: "77" }), { stage: "warehouse_created" }).whId).toBe("77");
    expect(planMove(task({ warehouseIds: [3120] }), { stage: "warehouse_created" }).whId).toBe("3120");
    expect(moveError(() => planMove(task({ warehouseIds: [3120, 3121] }), { stage: "warehouse_created" }))).toMatchObject({ code: "WAREHOUSE_ID_REQUIRED" });
    expect(planMove(task({ warehouseIds: [3120, 3121] }), { stage: "warehouse_created", whId: "3121" }).whId).toBe("3121");
  });

  it("does not let a legacy non-numeric reference satisfy stage 4", () => {
    expect(moveError(() => planMove(task({ wh_id: "NA" }), { stage: "warehouse_created" }))).toMatchObject({ code: "WAREHOUSE_ID_REQUIRED" });
  });

  it("reopens finished work moved back to an open stage and clears its closure", () => {
    const plan = planMove(task({ stage: "rejected", state: "done", outcome: "Unavailable", disposition: "leased_out" }), { stage: "awaiting_details" });
    expect(plan).toMatchObject({ state: "open", reopen: true, complete: false, outcome: "Available", closureReason: null, disposition: null });
  });

  it("keeps a retry disposition when an open card moves between open stages", () => {
    expect(planMove(task({ stage: "rnr", disposition: "no_answer" }), { stage: "awaiting_details" }).disposition).toBe("no_answer");
  });

  it("treats a move to the current stage as unchanged", () => {
    expect(planMove(task({ stage: "rnr", outcome: "Unclear" }), { stage: "rnr" }).unchanged).toBe(true);
    expect(planMove(task({ stage: "rejected", state: "done", outcome: "Unavailable" }), { stage: "rejected", reason: "leased_out" }).unchanged).toBe(false);
  });

  it("still records the stage's result on a task already in that stage without it", () => {
    // e.g. backfilled to 2C from callback remarks with no result saved
    const plan = planMove(task({ stage: "awaiting_details", outcome: null }), { stage: "awaiting_details" });
    expect(plan).toMatchObject({ unchanged: false, outcome: "Available" });
  });

  it("clears the warehouse ID and the In DB mark when a card leaves stage 4", () => {
    const created = task({ stage: "warehouse_created", state: "done", outcome: "Available", wh_id: "9876", added_to_db: true });
    expect(planMove(created, { stage: "details_collected" })).toMatchObject({ whId: null, addedToDb: false, reopen: true, leavesWarehouse: true });
    expect(planMove(created, { stage: "junk", reason: "invalid_number" })).toMatchObject({ whId: null, addedToDb: false, reopen: false, leavesWarehouse: true });
    expect(planMove(created, { stage: "warehouse_created" })).toMatchObject({ whId: "9876", addedToDb: true, leavesWarehouse: false });
  });

  it("keeps warehouse fields saved elsewhere when the task was never in stage 4", () => {
    expect(planMove(task({ stage: "inbound", wh_id: "1234", added_to_db: true }), { stage: "rnr" }))
      .toMatchObject({ whId: "1234", addedToDb: true, leavesWarehouse: false });
  });
});
