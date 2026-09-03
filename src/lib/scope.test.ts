import { describe, it, expect } from "vitest";
import {
  assignmentScope,
  currentAssignmentLateral,
  isOutcome,
  isAssignmentState,
  type Viewer,
} from "@/lib/scope";

const admin: Viewer = { email: "boss@co.com", isAdmin: true };
const emp: Viewer = { email: "Priya@Co.com", isAdmin: false };

describe("assignmentScope", () => {
  it("returns null for an admin and consumes no parameter", () => {
    const params: unknown[] = [];
    expect(assignmentScope(admin, "call", "x.id", params)).toBeNull();
    expect(params).toEqual([]);
  });

  it("scopes an employee to their own assignments", () => {
    const params: unknown[] = [];
    const sql = assignmentScope(emp, "record", "r.id", params);
    expect(sql).toContain("exists");
    expect(sql).toContain("a.entity_type = 'record'");
    expect(sql).toContain("a.entity_id = r.id");
    expect(params).toEqual(["priya@co.com"]); // lower-cased to match the stored email
  });

  it("numbers its placeholder from the existing params, not from 1", () => {
    const params: unknown[] = ["already", "there"];
    const sql = assignmentScope(emp, "call", "c.id", params);
    expect(sql).toContain("$3");
    expect(params).toHaveLength(3);
  });

  it("shows finished work but hides rows an admin took away", () => {
    // 'done' stays visible so an employee can review or untick it; only an admin
    // unassigning them (state='dropped') removes a row from their view.
    const sql = assignmentScope(emp, "call", "c.id", [])!;
    expect(sql).toContain("a.state <> 'dropped'");
    expect(sql).not.toContain("a.state = 'open'");
  });

  it("emits the entity type as a literal, never a caller-controlled string", () => {
    // The union is closed, so this can't be an injection vector — assert both arms.
    expect(assignmentScope(emp, "call", "c.id", [])).toContain("'call'");
    expect(assignmentScope(emp, "record", "r.id", [])).toContain("'record'");
  });
});

describe("currentAssignmentLateral", () => {
  it("prefers the open assignment over an older finished one", () => {
    const sql = currentAssignmentLateral("record", "r.id");
    expect(sql).toContain("order by (a.state = 'open') desc, a.assigned_at desc");
    expect(sql).toContain("limit 1");
  });

  it("ignores dropped assignments, matching the visibility scope", () => {
    expect(currentAssignmentLateral("call", "base.id")).toContain("a.state <> 'dropped'");
  });
});

describe("value guards", () => {
  it("accepts only the shared AI/human outcome vocabulary", () => {
    expect(isOutcome("Available")).toBe(true);
    expect(isOutcome("Unavailable")).toBe(true);
    expect(isOutcome("Unclear")).toBe(true);
    expect(isOutcome("available")).toBe(false); // case matters — matches llm_availability
    expect(isOutcome("Maybe")).toBe(false);
    expect(isOutcome(null)).toBe(false);
  });

  it("accepts only real assignment states", () => {
    expect(isAssignmentState("open")).toBe(true);
    expect(isAssignmentState("done")).toBe(true);
    expect(isAssignmentState("dropped")).toBe(true);
    expect(isAssignmentState("deleted")).toBe(false);
  });
});
