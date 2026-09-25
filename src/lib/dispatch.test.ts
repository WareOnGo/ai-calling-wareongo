import { describe, it, expect } from "vitest";
import { assembleBatch, batchFileName } from "./dispatch";
import type { QueueSel } from "./queue";

function sel(over: Partial<QueueSel> = {}): QueueSel {
  return { id: "1", name: "Amit", contact: "+919876543210", area: "Rajkot", state: "Gujarat", cat: "", queued: false, ...over };
}

describe("assembleBatch", () => {
  it("dedups by number before assembling", () => {
    const s = assembleBatch([
      sel({ id: "a", contact: "+919876543210" }),
      sel({ id: "b", contact: "09876543210" }), // same number
      sel({ id: "c", contact: "9111111111" }),
    ]);
    expect(s.total).toBe(2);
    expect(s.callable.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("excludes the requested already-called categories", () => {
    const s = assembleBatch(
      [
        sel({ id: "fresh", contact: "9000000001", cat: "" }),
        sel({ id: "dead", contact: "9000000002", cat: "dead" }),
        sel({ id: "avail", contact: "9000000003", cat: "available" }),
      ],
      ["dead", "available"],
    );
    expect(s.excludedByCat).toBe(2);
    expect(s.callable.map((r) => r.id)).toEqual(["fresh"]);
    expect(s.excludedCats.sort()).toEqual(["available", "dead"]);
  });

  it("never excludes fresh (uncalled) rows even if odd cats are passed", () => {
    const s = assembleBatch([sel({ id: "fresh", cat: "" })], ["dead"]);
    expect(s.callable.map((r) => r.id)).toEqual(["fresh"]);
  });

  it("ignores unknown category strings", () => {
    const s = assembleBatch([sel({ id: "a", cat: "available" })], ["bogus" as never]);
    expect(s.excludedByCat).toBe(0);
    expect(s.callable.map((r) => r.id)).toEqual(["a"]);
  });

  it("holds back TN/Kerala/Karnataka from the (Hindi-only) batch", () => {
    const s = assembleBatch([
      sel({ id: "guj", contact: "9000000001", state: "Gujarat" }),
      sel({ id: "tn", contact: "9000000002", state: "Tamil Nadu" }),
      sel({ id: "kl", contact: "9000000003", state: "Kerala" }),
      sel({ id: "ka", contact: "9000000004", state: "karnataka" }), // case-insensitive
      sel({ id: "dl", contact: "9000000005", state: "Delhi" }),
    ]);
    expect(s.heldRegion).toBe(3);
    expect(s.callable.map((r) => r.id)).toEqual(["guj", "dl"]);
  });

  it("skips numbers already queued in a live batch", () => {
    const s = assembleBatch([
      sel({ id: "fresh", contact: "9000000001", queued: false }),
      sel({ id: "q1", contact: "9000000002", queued: true }),
      sel({ id: "q2", contact: "9000000003", queued: true }),
    ]);
    expect(s.alreadyQueued).toBe(2);
    expect(s.callable.map((r) => r.id)).toEqual(["fresh"]);
  });

  it("counts held-region and already-queued separately (no double-count)", () => {
    const s = assembleBatch([
      sel({ id: "ok", contact: "9000000001" }),
      sel({ id: "tn", contact: "9000000002", state: "Tamil Nadu" }),
      sel({ id: "q", contact: "9000000003", queued: true }),
    ]);
    expect(s.heldRegion).toBe(1);
    expect(s.alreadyQueued).toBe(1);
    expect(s.callable.map((r) => r.id)).toEqual(["ok"]);
  });

  it("does not double-count a held row as skipped-no-number", () => {
    const s = assembleBatch([sel({ id: "tn", contact: "9000000002", state: "Tamil Nadu" })]);
    expect(s.heldRegion).toBe(1);
    expect(s.skippedNoNumber).toBe(0);
    expect(s.callable).toEqual([]);
  });

  it("counts rows with no number as skipped, not callable", () => {
    const s = assembleBatch([
      sel({ id: "ok", contact: "9000000001" }),
      sel({ id: "nonum", contact: "" }),
    ]);
    expect(s.skippedNoNumber).toBe(1);
    expect(s.callable.map((r) => r.id)).toEqual(["ok"]);
  });

  it("handles an empty candidate set", () => {
    const s = assembleBatch([]);
    expect(s).toMatchObject({ total: 0, excludedByCat: 0, skippedNoNumber: 0 });
    expect(s.callable).toEqual([]);
  });
});

describe("batchFileName", () => {
  const AT = "2026-07-03T12:10:00.000+00:00"; // 17:40 IST, same day

  it("names by single city + IST execution date", () => {
    expect(batchFileName([sel({ area: "Rajkot" })], AT)).toBe("Rajkot-2026-07-03.csv");
  });

  it("ranks cities by frequency, most-called first", () => {
    const rows = [sel({ area: "Delhi" }), sel({ area: "Rajkot" }), sel({ area: "Rajkot" })];
    expect(batchFileName(rows, AT)).toBe("Rajkot-Delhi-2026-07-03.csv");
  });

  it("caps at 3 cities and appends +N for the rest (ties broken alphabetically)", () => {
    const rows = ["Rajkot", "Delhi", "Surat", "Pune", "Mumbai"].map((area) => sel({ area }));
    expect(batchFileName(rows, AT)).toBe("Delhi-Mumbai-Pune+2-2026-07-03.csv");
  });

  it("frequency beats alphabetical: a high-count city leads regardless of name", () => {
    const rows = [sel({ area: "Surat" }), sel({ area: "Surat" }), sel({ area: "Ahmedabad" })];
    expect(batchFileName(rows, AT)).toBe("Surat-Ahmedabad-2026-07-03.csv");
  });

  it("strips spaces/punctuation from city names", () => {
    expect(batchFileName([sel({ area: "New Delhi" })], AT)).toBe("NewDelhi-2026-07-03.csv");
  });

  it("rolls the date into IST (late-UTC crosses midnight)", () => {
    // 2026-07-02T20:00Z + 5:30 = 2026-07-03T01:30 IST → next day.
    expect(batchFileName([sel({ area: "Delhi" })], "2026-07-02T20:00:00.000+00:00")).toBe("Delhi-2026-07-03.csv");
  });

  it("falls back to 'batch' when no city is present", () => {
    expect(batchFileName([sel({ area: "" })], AT)).toBe("batch-2026-07-03.csv");
  });
});

describe("multi-agent planning", () => {
  const both = { availableLanguages: ["hindi", "english"] as const };
  it("automatically splits the three English regions from other and unknown states", () => {
    const states = ["Tamil Nadu", " Kerala ", "KARNATAKA", "Delhi", ""];
    const result = assembleBatch(states.map((state, index) => sel({ id: String(index), contact: `900000000${index}`, state })), [], both);
    expect(result.groups.english.map(row => row.state)).toEqual(states.slice(0, 3));
    expect(result.groups.hindi.map(row => row.state)).toEqual(states.slice(3));
    expect(result.callable).toHaveLength(5);
    expect(result.heldRegion).toBe(0);
  });
  it("supports English override and preserves the Hindi region guard", () => {
    const rows = [sel(), sel({ id: "south", contact: "9000000002", state: "Karnataka" })];
    expect(assembleBatch(rows, [], { ...both, mode: "english" }).groups.english).toHaveLength(2);
    const hindi = assembleBatch(rows, [], { ...both, mode: "hindi" });
    expect(hindi.groups.hindi).toHaveLength(1);
    expect(hindi.heldRegion).toBe(1);
  });
  it("holds records when their agent is missing instead of falling back to the wrong language", () => {
    const result = assembleBatch([sel({ state: "Tamil Nadu" })], [], { availableLanguages: ["hindi"] });
    expect(result.heldRegion).toBe(1);
    expect(result.groups.hindi).toEqual([]);
    expect(result.groups.english).toEqual([]);
  });
  it("deduplicates globally before splitting and respects existing reservations", () => {
    const result = assembleBatch([sel(), sel({ id: "duplicate", state: "Kerala" }),
      sel({ id: "reserved", contact: "9000000002", state: "Kerala", queued: true })], [], both);
    expect(result.callable).toHaveLength(1);
    expect(result.groups.hindi).toHaveLength(1);
    expect(result.groups.english).toHaveLength(0);
    expect(result.alreadyQueued).toBe(1);
  });
  it("excludes invalid numbers and excluded outcomes for both agents", () => {
    const result = assembleBatch([sel({ contact: "123" }), sel({ id: "excluded", contact: "9000000002", state: "Kerala", cat: "dead" })], ["dead"], both);
    expect(result.callable).toEqual([]);
    expect(result.skippedNoNumber).toBe(1);
    expect(result.excludedByCat).toBe(1);
  });
});
