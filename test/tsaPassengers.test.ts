import { describe, expect, it } from "vitest";
import {
  extractTsaPassengerValue,
  extractTsaPassengerVolumes,
  formatTsaPassengerRangeValue,
  parsePolymarketTsaDateRange
} from "../src/integrations/tsaPassengers.js";

const html = `
  <table>
    <tbody>
      <tr><td>5/6/2026</td><td>2,251,410</td></tr>
      <tr><td>5/5/2026</td><td>2,040,845</td></tr>
      <tr><td>5/4/2026</td><td>2,540,806</td></tr>
    </tbody>
  </table>
`;

describe("TSA passengers adapter", () => {
  it("parses TSA passenger volume table rows", () => {
    expect(extractTsaPassengerVolumes(html)).toEqual([
      { date: "2026-05-06", passengers: 2251410 },
      { date: "2026-05-05", passengers: 2040845 },
      { date: "2026-05-04", passengers: 2540806 }
    ]);
  });

  it("parses the market date range from the Polymarket slug", () => {
    expect(
      parsePolymarketTsaDateRange(
        "https://polymarket.com/event/number-of-tsa-passengers-may-4-may-10",
        new Date("2026-05-07T00:00:00.000Z")
      )
    ).toEqual({ startDate: "2026-05-04", endDate: "2026-05-10" });
  });

  it("parses same-month shorthand date ranges", () => {
    expect(
      parsePolymarketTsaDateRange(
        "https://polymarket.com/event/number-of-tsa-passengers-june-1-7",
        new Date("2026-06-02T00:00:00.000Z")
      )
    ).toEqual({ startDate: "2026-06-01", endDate: "2026-06-07" });
  });

  it("formats partial range sums with missing dates", () => {
    expect(
      formatTsaPassengerRangeValue(extractTsaPassengerVolumes(html), { startDate: "2026-05-04", endDate: "2026-05-06" })
    ).toBe(
      [
        "Metric: TSA daily checkpoint throughput sum",
        "Range: 2026-05-04 to 2026-05-06",
        "Status: complete",
        "Reported days: 3/3",
        "Total passengers: 6,833,061",
        "Missing dates: none",
        "Daily values: 2026-05-04: 2,540,806 | 2026-05-05: 2,040,845 | 2026-05-06: 2,251,410"
      ].join("\n")
    );
  });

  it("formats the current market range from TSA HTML and Polymarket URL", () => {
    expect(
      extractTsaPassengerValue(
        html,
        "https://polymarket.com/event/number-of-tsa-passengers-may-4-may-10",
        new Date("2026-05-07T00:00:00.000Z")
      )
    ).toContain("Missing dates: 2026-05-07, 2026-05-08, 2026-05-09, 2026-05-10");
  });
});
