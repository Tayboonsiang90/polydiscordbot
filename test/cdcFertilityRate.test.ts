import { describe, expect, it } from "vitest";
import {
  extractCdcFertilityRateValue,
  extractCdcPageUpdatedAt,
  getCdcFertilityPollIntervalMinutes,
  parseCdcNatalityRows
} from "../src/integrations/cdcFertilityRate.js";

const html = `
  <html>
    <head>
      <meta property="cdc:last_updated" content="May 5, 2026">
    </head>
  </html>
`;

const csv = [
  "Year Quarter,Topic,Topic Subgroup,Indicator,Group,Rate,Unit,Significant,,,",
  "2025 Q4,Birth Rates,General Fertility Rates,15-44 years,All races and origins,53.3,\"per 1,000 population\",*,,,",
  "2026 Q1,Birth Rates,General Fertility Rates,15-44 years,All races and origins,54.1,\"per 1,000 population\", ,,,",
  "2026 Q1,Birth Rates,General Fertility Rates,15-44 years,Hispanic,63.0,\"per 1,000 population\",*,,,"
].join("\n");

describe("CDC fertility rate adapter", () => {
  it("parses quoted CDC natality CSV rows", () => {
    expect(parseCdcNatalityRows(csv)[0]).toEqual({
      yearQuarter: "2025 Q4",
      topicSubgroup: "General Fertility Rates",
      indicator: "15-44 years",
      group: "All races and origins",
      rate: "53.3",
      unit: "per 1,000 population",
      significant: "*"
    });
  });

  it("extracts the CDC page update timestamp", () => {
    expect(extractCdcPageUpdatedAt(html)).toBe("May 5, 2026");
  });

  it("formats the 2026 Q1 general fertility rate", () => {
    expect(extractCdcFertilityRateValue(csv, html)).toBe(
      [
        "Metric: General fertility rate",
        "Period: 2026 Q1",
        "Value: 54.1 per 1,000 population",
        "Reference: 2025 Q4 = 53.3 per 1,000 population",
        "Result: YES - 54.1 is above 53.3",
        "Indicator: 15-44 years",
        "Group: All races and origins",
        "Significant: not marked",
        "CDC page updated: May 5, 2026"
      ].join("\n")
    );
  });

  it("returns not published yet until 2026 Q1 appears", () => {
    const oldCsv = csv
      .split("\n")
      .filter((line) => !line.startsWith("2026 Q1"))
      .join("\n");

    expect(extractCdcFertilityRateValue(oldCsv, html)).toBe(
      [
        "Metric: General fertility rate",
        "Period: 2026 Q1",
        "Value: not published yet",
        "Reference: 2025 Q4 = 53.3 per 1,000 population",
        "Result: pending",
        "Latest available: 2025 Q4 = 53.3 per 1,000 population",
        "CDC page updated: May 5, 2026"
      ].join("\n")
    );
  });

  it("uses hourly polling", () => {
    expect(getCdcFertilityPollIntervalMinutes()).toBe(60);
  });
});
