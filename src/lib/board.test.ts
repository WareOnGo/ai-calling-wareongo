import { describe, expect, it } from "vitest";
import { boardWhere, ownWork } from "./board";

describe("whose work the board shows", () => {
  it("is always the signed-in person's own work, for admins too, like My Work", () => {
    expect(ownWork({ email: "admin@eval.test", isAdmin: true })).toEqual({ email: "admin@eval.test", isAdmin: false });
    const params: unknown[] = [];
    expect(boardWhere(ownWork({ email: "Admin@Eval.test", isAdmin: true }), { assignee: ["raj@eval.test"] }, params).task).toContain("a.assignee = $1");
    expect(params).toEqual(["admin@eval.test"]);
  });
});

const employee = { email: "Priya@Eval.test", isAdmin: false };
const admin = { email: "admin@eval.test", isAdmin: true };

describe("board query scope", () => {
  it("restricts employees to their own assignments with a bound, lowercased email", () => {
    const params: unknown[] = [];
    const { task } = boardWhere(employee, {}, params);
    expect(task).toContain("a.assignee = $1");
    expect(params).toEqual(["priya@eval.test"]);
  });

  it("never applies an assignee filter on behalf of an employee", () => {
    const params: unknown[] = [];
    boardWhere(employee, { assignee: ["other@eval.test"] }, params);
    expect(params).toEqual(["priya@eval.test"]);
  });

  it("lets admins see everyone unless they choose assignees", () => {
    const open: unknown[] = [];
    expect(boardWhere(admin, {}, open).task).not.toContain("a.assignee");
    expect(open).toEqual([]);
    const chosen: unknown[] = [];
    expect(boardWhere(admin, { assignee: ["raj@eval.test"] }, chosen).task).toContain("a.assignee = any($1::text[])");
    expect(chosen).toEqual([["raj@eval.test"]]);
  });

  it("hides dropped work and finished work outside the terminal stages", () => {
    const { task } = boardWhere(admin, {}, []);
    expect(task).toContain("a.state <> 'dropped'");
    expect(task).toContain("a.state = 'open' or a.stage in ('rejected','warehouse_created','junk')");
  });

  it("can include finished work in every stage for the funnel, still without dropped work", () => {
    const { task } = boardWhere(admin, {}, [], { includeFinished: true });
    expect(task).toContain("a.state <> 'dropped'");
    expect(task).not.toContain("a.stage in");
  });

  it("matches work without a batch when the no-batch choice is selected", () => {
    const params: unknown[] = [];
    expect(boardWhere(admin, { batch: ["none"] }, params).task).toContain("a.batch_id is null");
  });

  it("binds search text as a literal substring, escaping LIKE wildcards", () => {
    const params: unknown[] = [];
    const { context } = boardWhere(admin, { q: "50%_off" }, params);
    expect(context).toContain("ilike");
    expect(params).toContain("50\\%\\_off");
  });

  it("binds the work type and uses fixed follow-up predicates", () => {
    const params: unknown[] = [];
    const { task } = boardWhere(admin, { type: "record", follow_up: "overdue" }, params);
    expect(task).toContain("a.entity_type = $1");
    expect(params).toEqual(["record"]);
    expect(task).toContain("a.next_due_at < now()");
    expect(boardWhere(admin, { follow_up: "upcoming" }, []).task).toContain("a.next_due_at >= now()");
    expect(boardWhere(admin, { follow_up: "none" }, []).task).toContain("a.next_due_at is null");
  });

  it("uses fixed intervals for the last-updated window", () => {
    const params: unknown[] = [];
    boardWhere(admin, { updated: "24h" }, params);
    expect(params).toContain("24 hours");
  });
});
