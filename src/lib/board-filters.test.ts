import { describe, expect, it } from "vitest";
import { BOARD_PAGE_SIZE, BOARD_MAX_CARDS, boardHref, hasBoardCriteria, nextColumnLimit, parseBoardFilters, parseColumnLimits } from "./board-filters";

const employee = { isAdmin: false };
const admin = { isAdmin: true };
const batch = "4b8f7e2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";

describe("board filters", () => {
  it("keeps multi-select values, trims search and drops empty values", () => {
    expect(parseBoardFilters({ q: "  Gowda  ", city: ["Hoskote", "Bengaluru", "Hoskote", " "], region: "Karnataka", assigned_by: "Admin@Eval.test" }, employee))
      .toEqual({ q: "Gowda", city: ["Hoskote", "Bengaluru"], region: ["Karnataka"], assigned_by: ["admin@eval.test"] });
  });

  it("only lets admins filter by assignee", () => {
    expect(parseBoardFilters({ assignee: "Priya@Eval.test" }, admin)).toEqual({ assignee: ["priya@eval.test"] });
    expect(parseBoardFilters({ assignee: "priya@eval.test" }, employee)).toEqual({});
  });

  it("accepts assignment batch IDs and the no-batch choice, ignoring anything else", () => {
    expect(parseBoardFilters({ batch: [batch.toUpperCase(), "none", "B-0142", "drop table"] }, employee)).toEqual({ batch: [batch, "none"] });
  });

  it("filters by work type and follow-up state like My Work's quick filters", () => {
    expect(parseBoardFilters({ type: "call", follow_up: "overdue" }, employee)).toEqual({ type: "call", follow_up: "overdue" });
    expect(parseBoardFilters({ type: "listing", follow_up: "soon" }, employee)).toEqual({});
  });

  it("accepts only the documented last-updated windows", () => {
    expect(parseBoardFilters({ updated: "7d" }, employee)).toEqual({ updated: "7d" });
    expect(parseBoardFilters({ updated: "2y" }, employee)).toEqual({});
  });

  it("reports whether any criteria narrow the board", () => {
    expect(hasBoardCriteria({})).toBe(false);
    expect(hasBoardCriteria({ employee: "priya@eval.test" })).toBe(false);
    expect(hasBoardCriteria({ city: ["Delhi"] })).toBe(true);
  });

  it("leaves employee selection to the server's authorized perspective resolver", () => {
    for (const viewer of [admin, employee]) {
      expect(parseBoardFilters({ employee: "priya@eval.test", q: "Owner" }, viewer)).toEqual({ q: "Owner" });
    }
  });
});

describe("column limits", () => {
  it("defaults every column to one page and grows in whole pages up to a ceiling", () => {
    expect(BOARD_PAGE_SIZE).toBe(50);
    expect(parseColumnLimits({})).toEqual({});
    expect(parseColumnLimits({ rnr_cards: "100", junk_cards: "75" })).toEqual({ rnr: 100, junk: 100 });
    expect(parseColumnLimits({ inbound_cards: String(BOARD_MAX_CARDS * 4) })).toEqual({ inbound: BOARD_MAX_CARDS });
  });

  it("ignores unknown columns and non-numeric or small values", () => {
    expect(parseColumnLimits({ "2A_cards": "100", rnr_cards: "lots", inbound_cards: "10", rejected_cards: "-50" })).toEqual({});
  });

  it("scrolling to a column's end asks for one more page while cards remain", () => {
    expect(nextColumnLimit(50, 56)).toBe(100);
    expect(nextColumnLimit(100, 312)).toBe(150);
    expect(nextColumnLimit(BOARD_MAX_CARDS - BOARD_PAGE_SIZE, 900)).toBe(BOARD_MAX_CARDS);
  });

  it("stops when every card is shown or the column reaches the ceiling", () => {
    expect(nextColumnLimit(50, 50)).toBeNull();
    expect(nextColumnLimit(100, 56)).toBeNull();
    expect(nextColumnLimit(50, 0)).toBeNull();
    // At the ceiling a further request would parse back to the same limit and load nothing.
    expect(nextColumnLimit(BOARD_MAX_CARDS, BOARD_MAX_CARDS + 1)).toBeNull();
  });
});

describe("board links", () => {
  it("round-trips filters and column limits through the URL", () => {
    const href = boardHref({ city: ["Hoskote", "Delhi"], batch: ["none"], updated: "24h" }, { rnr: 100 });
    expect(href).toBe("/dashboard/board?city=Hoskote&city=Delhi&batch=none&updated=24h&rnr_cards=100");
    const params = Object.fromEntries([...new URLSearchParams(href.split("?")[1]).keys()].map(key => [key, new URLSearchParams(href.split("?")[1]).getAll(key)]));
    expect(parseBoardFilters(params, admin)).toEqual({ city: ["Hoskote", "Delhi"], batch: ["none"], updated: "24h" });
    expect(parseColumnLimits(params)).toEqual({ rnr: 100 });
  });

  it("omits default limits and empty filters", () => {
    expect(boardHref({}, { inbound: 50 })).toBe("/dashboard/board");
  });

  it("retains the authorized employee when a column grows", () => {
    expect(boardHref({ employee: "priya@eval.test", type: "record" }, { inbound: 100 }))
      .toBe("/dashboard/board?employee=priya%40eval.test&type=record&inbound_cards=100");
  });
});
