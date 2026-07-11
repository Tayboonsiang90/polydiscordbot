import { describe, expect, it } from "vitest";
import {
  extractCdcMeaslesAsOfDate,
  extractCdcMeaslesCounterFromHtml,
  extractCdcMeaslesCounterFromJson,
  formatCdcMeaslesValue,
  shouldAlertOnCdcMeaslesChange
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

  it("includes concurrent tracked Polymarket markets without making them the alert key", () => {
    const base = formatCdcMeaslesValue({ totalCases: 1893, asOfDate: "May 14, 2026" });
    const withMarkets = formatCdcMeaslesValue({ totalCases: 1893, asOfDate: "May 14, 2026" }, [
      {
        url: "https://polymarket.com/event/measles-cases-in-uptspt-by-july-31-20260630182033696",
        slug: "measles-cases-in-uptspt-by-july-31-20260630182033696",
        startAt: "2026-07-01T05:43:50.874Z",
        endAt: "2099-07-31T23:59:00.000Z",
        addedAt: "2026-07-11T00:00:00.000Z"
      },
      {
        url: "https://polymarket.com/event/measles-cases-in-us-in-2026",
        slug: "measles-cases-in-us-in-2026",
        startAt: "2025-12-01T17:57:05.432Z",
        endAt: "2099-12-31T00:00:00.000Z",
        addedAt: "2026-07-11T00:00:00.000Z"
      }
    ]);

    expect(withMarkets).toContain("Tracked Polymarket markets:");
    expect(withMarkets).toContain("measles-cases-in-uptspt-by-july-31-20260630182033696");
    expect(withMarkets).toContain("measles-cases-in-us-in-2026");
    expect(shouldAlertOnCdcMeaslesChange(base, withMarkets)).toBe(false);
    expect(shouldAlertOnCdcMeaslesChange(base, withMarkets.replace("Total cases: 1,893", "Total cases: 1,894"))).toBe(true);
  });
});
