import { describe, expect, it } from "vitest";
import {
  extractLatestFinalizedOrnnH200Point,
  extractLatestFinalizedOrnnH200Value,
  extractOrnnH200Points
} from "../src/integrations/ornnH200Index.js";

describe("ORNN H200 index parsing", () => {
  const sampleData = {
    success: true,
    gpu_type: "H200",
    data: [
      { timestamp: "2026-05-07T20:00:00.000Z", index_value: 2.41 },
      { timestamp: "2026-05-08T20:00:00.000Z", index_value: "2.55" },
      { timestamp: "2026-05-09T20:00:00.000Z", index_value: 2.62 }
    ]
  };

  it("extracts H200 index history points", () => {
    expect(extractOrnnH200Points(sampleData)).toEqual([
      { date: "2026-05-07", indexValue: 2.41, publishedAt: "2026-05-07T20:00:00.000Z" },
      { date: "2026-05-08", indexValue: 2.55, publishedAt: "2026-05-08T20:00:00.000Z" },
      { date: "2026-05-09", indexValue: 2.62, publishedAt: "2026-05-09T20:00:00.000Z" }
    ]);
  });

  it("uses the second latest data point as the finalized daily value", () => {
    expect(extractLatestFinalizedOrnnH200Point(sampleData)).toEqual({
      date: "2026-05-08",
      indexValue: 2.55,
      publishedAt: "2026-05-08T20:00:00.000Z",
      finalizedByDate: "2026-05-09"
    });
  });

  it("formats the stable monitor value", () => {
    expect(extractLatestFinalizedOrnnH200Value(sampleData)).toBe(
      [
        "Metric: ORNN H200 Index",
        "Date: 2026-05-08",
        "Index Value: 2.55",
        "Finalized by: 2026-05-09",
        "Published at: 2026-05-08T20:00:00.000Z",
        "Resolution: https://dashboard.ornnai.com"
      ].join("\n")
    );
  });
});
