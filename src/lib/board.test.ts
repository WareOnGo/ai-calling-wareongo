import { describe, expect, it } from "vitest";
import { boardWhere } from "./board";

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

  it("uses fixed intervals for the last-updated window", () => {
    const params: unknown[] = [];
    boardWhere(admin, { updated: "24h" }, params);
    expect(params).toContain("24 hours");
  });
});
