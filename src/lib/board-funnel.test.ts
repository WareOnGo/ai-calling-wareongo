import { describe, expect, it } from "vitest";
import { funnelRow, funnelTotals, type FunnelCounts } from "./board-funnel";

const counts = (values: Partial<FunnelCounts> = {}): FunnelCounts => ({
  inbound: 0, rnr: 0, rejected: 0, awaiting_details: 0, details_collected: 0, warehouse_created: 0, junk: 0, ...values,
});

describe("funnel arithmetic", () => {
  it("totals a caller's leads across every stage and the share that reached a warehouse ID", () => {
    const row = funnelRow({ assignee: "a@x.test", name: "A", stages: counts({ inbound: 4, rnr: 3, rejected: 1, warehouse_created: 2 }), warehouseIds: ["77", "3120", "3121"] });
    expect(row).toMatchObject({ leads: 10, reachedWarehouse: 0.2, warehouseIdCount: 3 });
  });

  it("reports no conversion rather than dividing by zero", () => {
    expect(funnelRow({ assignee: "b@x.test", name: null, stages: counts(), warehouseIds: [] })).toMatchObject({ leads: 0, reachedWarehouse: 0 });
  });

  it("sums stages across callers but counts each warehouse ID once", () => {
    const rows = [
      funnelRow({ assignee: "a@x.test", name: "A", stages: counts({ inbound: 2, awaiting_details: 3, warehouse_created: 1 }), warehouseIds: ["77"] }),
      funnelRow({ assignee: "b@x.test", name: "B", stages: counts({ rnr: 1, warehouse_created: 3 }), warehouseIds: ["77", "88", "99"] }),
    ];
    expect(funnelTotals(rows)).toEqual({
      stages: counts({ inbound: 2, rnr: 1, awaiting_details: 3, warehouse_created: 4 }),
      leads: 10, warehouseLeads: 4, reachedWarehouse: 0.4, warehouseIdCount: 3, awaiting: 3,
    });
  });
});
