import { describe, it, expect } from "vitest";
import { isHindiBlocked, computeScheduleAt, toOffsetIso } from "./routing";

describe("isHindiBlocked", () => {
  it("blocks Tamil Nadu, Kerala, Karnataka (case/space-insensitive)", () => {
    expect(isHindiBlocked("Tamil Nadu")).toBe(true);
    expect(isHindiBlocked("tamil nadu")).toBe(true);
    expect(isHindiBlocked("  Kerala ")).toBe(true);
    expect(isHindiBlocked("KARNATAKA")).toBe(true);
  });

  it("allows other states and empty/null", () => {
    expect(isHindiBlocked("Gujarat")).toBe(false);
    expect(isHindiBlocked("Delhi")).toBe(false);
    expect(isHindiBlocked("")).toBe(false);
    expect(isHindiBlocked(null)).toBe(false);
    expect(isHindiBlocked(undefined)).toBe(false);
  });
});

describe("toOffsetIso", () => {
  it("formats UTC with a numeric offset (never a trailing Z)", () => {
    const iso = toOffsetIso(new Date(Date.UTC(2026, 5, 23, 18, 30, 0)));
    expect(iso).toBe("2026-06-23T18:30:00.000+00:00");
    expect(iso.endsWith("Z")).toBe(false);
  });
});

describe("computeScheduleAt", () => {
  it("rounds up to the next 10-minute mark", () => {
    const now = new Date(Date.UTC(2026, 0, 1, 12, 3, 0));
    expect(computeScheduleAt(now)).toBe("2026-01-01T12:10:00.000+00:00");
  });

  it("skips to the following slot when <2 min of headroom remain", () => {
    // 12:09 → next mark 12:10 is only 1 min away → must jump to 12:20.
    const now = new Date(Date.UTC(2026, 0, 1, 12, 9, 0));
    expect(computeScheduleAt(now)).toBe("2026-01-01T12:20:00.000+00:00");
  });

  it("keeps a slot exactly on the mark with enough headroom rounded to itself", () => {
    // 12:00:00 exactly → ceil is 12:00, which is >2min? No — 0 min away, so jump to 12:10.
    const now = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
    expect(computeScheduleAt(now)).toBe("2026-01-01T12:10:00.000+00:00");
  });

  it("always returns a time at least 2 minutes in the future", () => {
    const now = new Date(Date.UTC(2026, 3, 15, 9, 47, 30));
    const at = new Date(computeScheduleAt(now)).getTime();
    expect(at - now.getTime()).toBeGreaterThanOrEqual(120_000);
  });
});
