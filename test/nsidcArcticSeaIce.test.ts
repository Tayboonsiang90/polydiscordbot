import { describe, expect, it } from "vitest";
import {
  buildNsidcArcticSeaIceReport,
  formatNsidcArcticSeaIceValue,
  nsidcArcticSeaIceAdapter,
  nsidcArcticSeaIceShouldAlertOnChange,
  parseNsidcSeaIceDailyExtentCsv
} from "../src/integrations/nsidcArcticSeaIce.js";

const sampleCsv = [
  "Year, Month, Day,     Extent,    Missing, Source Data",
  "YYYY,    MM,  DD, 10^6 sq km, 10^6 sq km, Source data product web sites",
  "2026,    07,  31,      6.112,      0.000, source",
  "2026,    08,  01,      5.901,      0.000, source",
  "2026,    08,  02,      5.842,      0.000, source",
  "2026,    09,  10,      4.255,      0.000, source",
  "2026,    10,  01,      4.610,      0.000, source",
  "2026,    10,  02,      4.700,      0.000, source"
].join("\n");

describe("NSIDC Arctic sea ice adapter", () => {
  it("parses daily northern hemisphere extent rows from the NSIDC CSV", () => {
    expect(parseNsidcSeaIceDailyExtentCsv(sampleCsv)).toEqual([
      { date: "2026-07-31", extentMillionSqKm: 6.112, missingMillionSqKm: 0 },
      { date: "2026-08-01", extentMillionSqKm: 5.901, missingMillionSqKm: 0 },
      { date: "2026-08-02", extentMillionSqKm: 5.842, missingMillionSqKm: 0 },
      { date: "2026-09-10", extentMillionSqKm: 4.255, missingMillionSqKm: 0 },
      { date: "2026-10-01", extentMillionSqKm: 4.61, missingMillionSqKm: 0 },
      { date: "2026-10-02", extentMillionSqKm: 4.7, missingMillionSqKm: 0 }
    ]);
  });

  it("computes the Aug 1-Oct 1 minimum and latest window day", () => {
    const report = buildNsidcArcticSeaIceReport(sampleCsv);

    expect(report.minimumRow).toMatchObject({ date: "2026-09-10", extentMillionSqKm: 4.255 });
    expect(report.latestWindowRow).toMatchObject({ date: "2026-10-01", extentMillionSqKm: 4.61 });
    expect(report.windowRows).toHaveLength(4);
  });

  it("formats the monitor value with minimum and latest published rows", () => {
    const value = formatNsidcArcticSeaIceValue(buildNsidcArcticSeaIceReport(sampleCsv));

    expect(value).toContain("Current minimum: 4.255 million sq km on 2026-09-10");
    expect(value).toContain("Latest window day: 2026-10-01 — 4.610 million sq km");
    expect(value).toContain("Reported window days: 4/62");
    expect(value).toContain("Data status: complete through Oct 1");
  });

  it("suppresses pre-window dataset-date-only alerts", () => {
    const previousValue = [
      "Metric: NSIDC Arctic sea ice minimum extent",
      "Reported window days: 0/62",
      "Latest dataset date: 2026-07-30"
    ].join("\n");
    const currentValue = previousValue.replace("2026-07-30", "2026-07-31");
    const firstWindowValue = currentValue.replace("Reported window days: 0/62", "Reported window days: 1/62");

    expect(nsidcArcticSeaIceShouldAlertOnChange(previousValue, currentValue)).toBe(false);
    expect(nsidcArcticSeaIceShouldAlertOnChange(currentValue, firstWindowValue)).toBe(true);
  });

  it("uses hourly polling", () => {
    expect(nsidcArcticSeaIceAdapter.getPollIntervalMinutes?.({} as never)).toBe(60);
  });
});
