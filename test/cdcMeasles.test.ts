import { describe, expect, it } from "vitest";
import {
  extractCdcMeaslesAsOfDate,
  extractCdcMeaslesCounterFromHtml,
  extractCdcMeaslesCounterFromJson,
  formatCdcMeaslesValue
} from "../src/integrations/cdcMeasles.js";

describe("CDC measles adapter", () => {
  it("extracts the 2026 total cases counter from CDC JSON", () => {
    expect(
      extractCdcMeaslesCounterFromJson({
        "2026": {
          total_cases: ["1,893"]
        }
      })
    ).toEqual({ totalCases: 1893 });
  });

  it("extracts the as-of date and total cases from CDC page text", () => {
    const html = `
      <p>As of May 14, 2026, 1,893 confirmed* measles cases were reported in the United States in 2026.</p>
    `;

    expect(extractCdcMeaslesAsOfDate(html)).toBe("May 14, 2026");
    expect(extractCdcMeaslesCounterFromHtml(html)).toEqual({
      totalCases: 1893,
      asOfDate: "May 14, 2026"
    });
  });

  it("formats the Discord stored value", () => {
    expect(formatCdcMeaslesValue({ totalCases: 1893, asOfDate: "May 14, 2026" })).toBe(
      [
        "Metric: CDC confirmed U.S. measles cases in 2026",
        "Total cases: 1,893",
        "As of: May 14, 2026"
      ].join("\n")
    );
  });
});
