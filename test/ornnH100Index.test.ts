import { describe, expect, it } from "vitest";
import {
  extractLatestFinalizedOrnnH100Point,
  extractLatestFinalizedOrnnH100Value,
  extractOrnnH100Points
} from "../src/integrations/ornnH100Index.js";

describe("ORNN H100 index parsing", () => {
  const sampleData = {
    success: true,
    gpu_type: "H100",
    data: [
      { timestamp: "2026-05-07T20:00:00.000Z", index_value: 4.41 },
      { timestamp: "2026-05-08T20:00:00.000Z", index_value: "4.55" },
      { timestamp: "2026-05-09T20:00:00.000Z", index_value: 4.62 }
    ]
  };

  it("extracts H100 index history points", () => {
    expect(extractOrnnH100Points(sampleData)).toEqual([
      { date: "2026-05-07", indexValue: 4.41, publishedAt: "2026-05-07T20:00:00.000Z" },
      { date: "2026-05-08", indexValue: 4.55, publishedAt: "2026-05-08T20:00:00.000Z" },
      { date: "2026-05-09", indexValue: 4.62, publishedAt: "2026-05-09T20:00:00.000Z" }
    ]);
  });

  it("uses the second latest data point as the finalized daily value", () => {
    expect(extractLatestFinalizedOrnnH100Point(sampleData)).toEqual({
      date: "2026-05-08",
      indexValue: 4.55,
      publishedAt: "2026-05-08T20:00:00.000Z",
      finalizedByDate: "2026-05-09"
    });
  });

  it("formats the stable monitor value", () => {
    expect(extractLatestFinalizedOrnnH100Value(sampleData)).toBe(
      [
        "Metric: ORNN H100 Index",
        "Date: 2026-05-08",
        "Index Value: 4.55",
        "Finalized by: 2026-05-09",
        "Published at: 2026-05-08T20:00:00.000Z",
        "Resolution: https://dashboard.ornnai.com"
      ].join("\n")
    );
  });
});
