import { describe, it, expect } from "vitest";
import {
  deriveCat,
  normNum,
  dedupByNumber,
  csvCell,
  buildCsv,
  CSV_HEADERS,
  type QueueSel,
} from "./queue";

// Helper to build a selection row with sensible defaults.
function sel(over: Partial<QueueSel> = {}): QueueSel {
  return { id: "1", name: "Amit", contact: "+919876543210", area: "Rajkot", state: "Gujarat", cat: "", queued: false, ...over };
}

describe("deriveCat", () => {
  it("returns '' when there are no calls (numeric 0)", () => {
    expect(deriveCat(0, null)).toBe("");
  });

  // Regression: pg returns count(*) as a string, so "0" is truthy. deriveCat must
  // coerce it — otherwise every uncalled record was mislabeled "dead".
  it("returns '' when call_count is the string \"0\"", () => {
    expect(deriveCat("0", null)).toBe("");
    expect(deriveCat("0", "")).toBe("");
  });

  it("treats null/undefined call_count as uncalled", () => {
    expect(deriveCat(null, null)).toBe("");
    expect(deriveCat(undefined, undefined)).toBe("");
  });

  it("maps a determined availability to its category (case-insensitive)", () => {
    expect(deriveCat(1, "Available")).toBe("available");
    expect(deriveCat("2", "UNAVAILABLE")).toBe("unavailable");
    expect(deriveCat(3, "unclear")).toBe("unclear");
  });

  it("classifies a called record with no availability as 'dead'", () => {
    expect(deriveCat(1, null)).toBe("dead");
    expect(deriveCat("5", "")).toBe("dead");
    expect(deriveCat(1, "garbage-status")).toBe("dead");
  });
});

describe("normNum", () => {
  it("strips non-digits and keeps the last 10 (drops +91 / leading 0)", () => {
    expect(normNum("+91 98765 43210")).toBe("9876543210");
    expect(normNum("098765-43210")).toBe("9876543210");
    expect(normNum("9876543210")).toBe("9876543210");
  });

  it("returns short numbers as-is, and '' for empty/null", () => {
    expect(normNum("12345")).toBe("12345");
    expect(normNum("")).toBe("");
    expect(normNum(null)).toBe("");
    expect(normNum(undefined)).toBe("");
  });
});

describe("dedupByNumber", () => {
  it("collapses numbers that normalize to the same 10 digits, keeping the first", () => {
    const rows = [
      sel({ id: "a", contact: "+919876543210", name: "First" }),
      sel({ id: "b", contact: "09876543210", name: "Second" }),   // same number, 0-prefix
      sel({ id: "c", contact: "98765 43210", name: "Third" }),    // same number, spaces
      sel({ id: "d", contact: "+919999999999", name: "Other" }),
    ];
    const out = dedupByNumber(rows);
    expect(out.map((r) => r.id)).toEqual(["a", "d"]);
    expect(out[0].name).toBe("First"); // first occurrence wins
  });

  it("keeps every row that has no number (never silently drops them)", () => {
    const rows = [sel({ id: "a", contact: "" }), sel({ id: "b", contact: "" })];
    expect(dedupByNumber(rows).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("preserves order and returns a new array", () => {
    const rows = [sel({ id: "x", contact: "111" }), sel({ id: "y", contact: "222" })];
    const out = dedupByNumber(rows);
    expect(out).not.toBe(rows);
    expect(out.map((r) => r.id)).toEqual(["x", "y"]);
  });
});

describe("csvCell", () => {
  it("passes plain values through unquoted", () => {
    expect(csvCell("Amit")).toBe("Amit");
    expect(csvCell("9876543210")).toBe("9876543210");
  });

  it("quotes and escapes values with commas, quotes, or newlines", () => {
    expect(csvCell("Rajkot, Gujarat")).toBe('"Rajkot, Gujarat"');
    expect(csvCell('Amit "AJ" Shah')).toBe('"Amit ""AJ"" Shah"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("buildCsv", () => {
  it("emits a BOM, the fixed header, and one row per record in order", () => {
    const csv = buildCsv([
      sel({ name: "Amit", contact: "9876543210", area: "Rajkot" }),
      sel({ name: "Bina", contact: "9123456780", area: "Delhi" }),
    ]);
    const lines = csv.split("\r\n");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines[0]).toBe("﻿" + CSV_HEADERS.join(","));
    expect(lines[1]).toBe("Amit,warehouse,9876543210,Rajkot");
    expect(lines[2]).toBe("Bina,warehouse,9123456780,Delhi");
    expect(lines).toHaveLength(3);
  });

  it("hardcodes property_type to 'warehouse' and escapes fields", () => {
    const csv = buildCsv([sel({ name: "Shah, Amit", contact: "9876543210", area: "Rajkot" })]);
    expect(csv.split("\r\n")[1]).toBe('"Shah, Amit",warehouse,9876543210,Rajkot');
  });

  it("produces a header-only file for an empty batch", () => {
    expect(buildCsv([])).toBe("﻿" + CSV_HEADERS.join(","));
  });
});
