import { describe, expect, it } from "vitest";
import {
  extractLatestFinalizedOrnnB200Point,
  extractLatestFinalizedOrnnB200Value,
  extractOrnnB200Points
} from "../src/integrations/ornnB200Index.js";

describe("ORNN B200 index parsing", () => {
  const sampleData = {
    success: true,
    gpu_type: "B200",
    data: [
      { timestamp: "2026-05-07T20:00:00.000Z", index_value: 3.41 },
      { timestamp: "2026-05-08T20:00:00.000Z", index_value: "3.55" },
      { timestamp: "2026-05-09T20:00:00.000Z", index_value: 3.62 }
    ]
  };

  it("extracts B200 index history points", () => {
    expect(extractOrnnB200Points(sampleData)).toEqual([
      { date: "2026-05-07", indexValue: 3.41, publishedAt: "2026-05-07T20:00:00.000Z" },
      { date: "2026-05-08", indexValue: 3.55, publishedAt: "2026-05-08T20:00:00.000Z" },
      { date: "2026-05-09", indexValue: 3.62, publishedAt: "2026-05-09T20:00:00.000Z" }
    ]);
  });

  it("uses the second latest data point as the finalized daily value", () => {
    expect(extractLatestFinalizedOrnnB200Point(sampleData)).toEqual({
      date: "2026-05-08",
      indexValue: 3.55,
      publishedAt: "2026-05-08T20:00:00.000Z",
      finalizedByDate: "2026-05-09"
    });
  });

  it("formats the stable monitor value", () => {
    expect(extractLatestFinalizedOrnnB200Value(sampleData)).toBe(
      [
        "Metric: ORNN B200 Index",
        "Date: 2026-05-08",
        "Index Value: 3.55",
        "Finalized by: 2026-05-09",
        "Published at: 2026-05-08T20:00:00.000Z",
        "Resolution: https://dashboard.ornnai.com"
      ].join("\n")
    );
  });
});
