import { describe, expect, it } from "vitest";
import { makeToken, verifyToken, SESSION_MAX_AGE } from "./session";
import { jsonBody, bigintId } from "./api";
import { toCallFilters, toRawFilters } from "./filters";
import { csvCell } from "./csv";
import { csvCell as providerCell } from "./queue";
import { currentAssignmentLateral } from "./scope";
import { executionsFinished } from "./batch-reconciliation";
import { z } from "zod";

describe("API boundaries", () => {
  it.each([null, [], { added_to_db: "false" }, { added_to_db: 0 }])("rejects malformed patch %j", async body => {
    await expect(jsonBody(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }), z.object({ added_to_db: z.boolean() }).strict())).rejects.toThrow();
  });
  it("preserves false and bigint IDs without lossy numeric conversion", () => {
    expect(bigintId.parse("9007199254740993")).toBe("9007199254740993");
    expect(() => bigintId.parse("9223372036854775808")).toThrow();
    expect(() => bigintId.parse("0")).toThrow();
    expect(bigintId.safeParse("not-a-number").success).toBe(false);
    expect(toRawFilters({ has_phone: "false" }).has_phone).toBe(false);
  });
  it.each([{ min_area: "NaN" }, { min_area: "Infinity" }, { min_area: [] }, { min_area: 10, max_area: 5 }])("rejects invalid area filters %j", value => {
    expect(() => toRawFilters(value)).toThrow();
  });
  it("validates calendar dates and includes warehouse type", () => {
    expect(() => toCallFilters({ date_from: "2026-02-31" })).toThrow();
    expect(toRawFilters({ warehouse_type: "warehouse" }).warehouse_type).toBe("warehouse");
  });
});

describe("signed sessions", () => {
  const secret = "test-signing-key";
  it("expires on the server and rejects tampering and legacy signatures", () => {
    const token = makeToken("TEST@example.com", secret, 1000);
    expect(verifyToken(token, secret, 1001)).toBe("test@example.com");
    expect(verifyToken(token, secret, 1000 + SESSION_MAX_AGE)).toBeNull();
    expect(verifyToken(token, "another-key", 1001)).toBeNull();
    expect(verifyToken(token + "x", secret, 1001)).toBeNull();
    expect(verifyToken("test@example.com.signature", secret, 1001)).toBeNull();
    expect(verifyToken(token, secret, 1)).toBeNull();
  });
});

describe("spreadsheet exports", () => {
  it.each(["=1+1", "+919876543210", "-1+2", "@SUM(A1)", " \t=HYPERLINK(1)", "\tunsafe", "\runsafe"])("neutralizes %j", value => {
    expect(csvCell(value).replace(/^"/, "").startsWith("'")).toBe(true);
  });
  it("quotes cells without changing provider upload values", () => {
    expect(csvCell('hello,"there"')).toBe('"hello,""there"""');
    expect(providerCell("+919876543210")).toBe("+919876543210");
  });
});

it("projects only the viewer's own assignment while retaining historical visibility", () => {
  const params: unknown[] = ["filter"];
  expect(currentAssignmentLateral("call", "c.id", { email: "A@EXAMPLE.COM", isAdmin: false }, params)).toContain("a.assignee = $2");
  expect(params).toEqual(["filter", "a@example.com"]);
});

it("does not release numbers while calls or automatic retries remain", () => {
  const phone = "9876543210", telephony_data = { to_number: `+91${phone}` };
  expect(executionsFinished([phone], [{ status: "no-answer", telephony_data, retry_count: 1 }])).toBe(false);
  expect(executionsFinished([phone], [{ status: "no-answer", telephony_data, retry_count: 3 }])).toBe(true);
  expect(executionsFinished([phone], [{ status: "completed", telephony_data }, { status: "scheduled", telephony_data }])).toBe(false);
  expect(executionsFinished([phone, "8888888888"], [{ status: "completed", telephony_data }])).toBe(false);
  expect(executionsFinished([phone], [{ status: "completed", telephony_data }])).toBe(true);
});
