import { describe, expect, it } from "vitest";
import { extractLatestBasedRevenuePoint, extractLatestBasedRevenueValue } from "../src/integrations/basedRevenue.js";

const sampleDuneResponse = {
  result: {
    rows: [
      { day: "2026-05-07T00:00:00.000Z", "Cumulative Revenue": 12500.55 },
      { day: "2026-05-08T00:00:00.000Z", "Cumulative Revenue": "$13,250.75" }
    ]
  }
};

describe("Based revenue adapter", () => {
  it("extracts the latest cumulative revenue point", () => {
    expect(extractLatestBasedRevenuePoint(sampleDuneResponse)).toEqual({
      date: "2026-05-08",
      cumulativeRevenue: 13250.75
    });
  });

  it("formats the latest cumulative revenue as a stable monitor value", () => {
    const value = extractLatestBasedRevenueValue(sampleDuneResponse);
    expect(value).toContain("Metric: Based cumulative revenue");
    expect(value).toContain("Date: 2026-05-08");
    expect(value).toContain("Cumulative Revenue: $13,250.75");
    expect(value).toContain("Resolution: https://dune.com/datadashboards/based-statistics");
  });

  it("throws when no cumulative revenue rows are present", () => {
    expect(() => extractLatestBasedRevenuePoint({ result: { rows: [] } })).toThrow(
      "Could not find Based cumulative revenue rows"
    );
  });
});
