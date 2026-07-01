import { describe, expect, it } from "vitest";
import { extractPolymarketStatusValue, type PolymarketStatusComponentsResponse, type PolymarketStatusSummaryResponse } from "../src/integrations/polymarketStatus.js";

const summary: PolymarketStatusSummaryResponse = {
  page: {
    name: "Polymarket",
    url: "https://status.polymarket.com",
    status: "ONEUNDERMAINTENANCE"
  },
  activeMaintenances: [
    {
      id: "maintenance-1",
      name: "Scheduled maintenance - Trading release",
      start: "2026-07-01T04:00:00.000Z",
      status: "INPROGRESS",
      duration: 60,
      url: "https://status.polymarket.com/maintenance-1",
      updatedAt: "2026-07-01T04:01:27.807Z"
    }
  ]
};

const components: PolymarketStatusComponentsResponse = {
  components: [
    {
      id: "website",
      name: "Website",
      status: "OPERATIONAL",
      order: 1,
      activeMaintenances: []
    },
    {
      id: "clob",
      name: "CLOB API",
      status: "UNDERMAINTENANCE",
      order: 2,
      activeMaintenances: [
        {
          id: "maintenance-1",
          name: "Scheduled maintenance - Trading release",
          start: "2026-07-01T04:00:00.000Z",
          end: "2026-07-01T05:00:00.000Z",
          status: "INPROGRESS",
          url: "https://status.polymarket.com/maintenance-1"
        }
      ]
    }
  ]
};

describe("Polymarket status adapter", () => {
  it("formats page, component, and active maintenance changes", () => {
    const value = extractPolymarketStatusValue(summary, components);

    expect(value).toContain("Page status: one component under maintenance (ONEUNDERMAINTENANCE)");
    expect(value).toContain("Website: operational (OPERATIONAL)");
    expect(value).toContain("CLOB API: under maintenance (UNDERMAINTENANCE)");
    expect(value).toContain("Scheduled maintenance - Trading release\nStatus: in progress (INPROGRESS)");
    expect(value).toContain("Components: CLOB API");
    expect(value).toContain("Link: https://status.polymarket.com/maintenance-1");
  });

  it("formats a stable no-maintenance status", () => {
    const value = extractPolymarketStatusValue(
      {
        page: {
          name: "Polymarket",
          url: "https://status.polymarket.com",
          status: "OPERATIONAL"
        },
        activeMaintenances: []
      },
      {
        components: [{ name: "Website", status: "OPERATIONAL", order: 1, activeMaintenances: [] }]
      }
    );

    expect(value).toContain("Page status: operational (OPERATIONAL)");
    expect(value).toContain("Active maintenances:\nnone");
  });

  it("throws when required API fields are missing", () => {
    expect(() => extractPolymarketStatusValue({}, components)).toThrow("Could not find Polymarket status page summary");
    expect(() => extractPolymarketStatusValue(summary, {})).toThrow("Could not find Polymarket status components");
  });
});
