import { describe, expect, it } from "vitest";
import {
  extractCdcCyclosporiasisCounterFromHtml,
  formatCdcCyclosporiasisValue,
  shouldAlertOnCdcCyclosporiasisChange
} from "../src/integrations/cdcCyclosporiasis.js";

const sampleHtml = `
  <main>
    <h1>Surveillance of Cyclosporiasis</h1>
    <p>For Public Health</p>
    <p>July 15, 2026</p>
    <h2>Key points</h2>
    <section>
      <h2>2026 fast facts</h2>
      <p>As of July 13, 2026:</p>
      <ul>
        <li>U.S. cases reported to CDC: 1,645</li>
        <li>Hospitalizations: 141</li>
        <li>Deaths: 0</li>
        <li>States reporting cases: 34</li>
      </ul>
    </section>
  </main>
`;

describe("CDC cyclosporiasis adapter", () => {
  it("extracts the CDC U.S. cases reported to CDC count", () => {
    expect(extractCdcCyclosporiasisCounterFromHtml(sampleHtml)).toEqual({
      totalCases: 1645,
      asOfDate: "July 13, 2026",
      pageDate: "July 15, 2026",
      hospitalizations: 141,
      deaths: 0,
      statesReporting: 34
    });
  });

  it("falls back to the CDC data paragraph format", () => {
    expect(
      extractCdcCyclosporiasisCounterFromHtml(`
        <p>As of July 13, 2026, 1,645 lab-confirmed cases were reported in people who acquired cyclosporiasis in the United States.</p>
      `)
    ).toMatchObject({
      totalCases: 1645,
      asOfDate: "July 13, 2026"
    });
  });

  it("formats the Discord stored value", () => {
    expect(formatCdcCyclosporiasisValue(extractCdcCyclosporiasisCounterFromHtml(sampleHtml))).toBe(
      [
        "Metric: CDC confirmed domestically acquired U.S. cyclosporiasis cases since May 1, 2026",
        "Total cases: 1,645",
        "As of: July 13, 2026",
        "Hospitalizations: 141",
        "Deaths: 0",
        "States reporting: 34",
        "CDC page date: July 15, 2026",
        "Resolution: https://www.cdc.gov/cyclosporiasis/php/surveillance/index.html"
      ].join("\n")
    );
  });

  it("includes tracked Polymarket markets without making them the alert key", () => {
    const base = formatCdcCyclosporiasisValue({
      totalCases: 1645,
      asOfDate: "July 13, 2026",
      pageDate: "July 15, 2026"
    });
    const withMarkets = formatCdcCyclosporiasisValue(
      {
        totalCases: 1645,
        asOfDate: "July 13, 2026",
        pageDate: "July 15, 2026"
      },
      [
        {
          url: "https://polymarket.com/event/cyclosporiasis-cases-in-uptspt-by-july-31-20260714155955473",
          slug: "cyclosporiasis-cases-in-uptspt-by-july-31-20260714155955473",
          startAt: "2026-07-15T01:55:00.000Z",
          endAt: "2099-07-31T23:59:00.000Z",
          addedAt: "2026-07-18T00:00:00.000Z"
        }
      ]
    );

    expect(withMarkets).toContain("Tracked Polymarket markets:");
    expect(withMarkets).toContain("cyclosporiasis-cases-in-uptspt-by-july-31-20260714155955473");
    expect(shouldAlertOnCdcCyclosporiasisChange(base, withMarkets)).toBe(false);
    expect(shouldAlertOnCdcCyclosporiasisChange(base, withMarkets.replace("Total cases: 1,645", "Total cases: 1,646"))).toBe(true);
  });
});
