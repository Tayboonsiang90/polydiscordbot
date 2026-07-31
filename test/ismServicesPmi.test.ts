import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildIsmServicesPmiValue,
  extractCurrentServicesReportUrl,
  extractIsmServicesPmiReport,
  fetchIsmServicesPmiMarketMetadata,
  getIsmServicesPmiPollIntervalMinutes,
  parseIsmServicesPmiTarget
} from "../src/integrations/ismServicesPmi.js";

const reportsPageHtml = `
  <section>
    <h3>Manufacturing PMI®</h3>
    <a href="/supply-management-news-and-reports/reports/ism-pmi-reports/manufacturing/april/">View Report</a>
    <h3>Services PMI®</h3>
    <a href="/supply-management-news-and-reports/reports/ism-pmi-reports/services/april/">View Report</a>
  </section>
`;

const aprilReportHtml = `
  <main>
    <h1>Services PMI® at 53.6%</h1>
    <h1>April 2026 ISM® Services PMI® Report</h1>
    <p>The Services PMI® registered 53.6 percent.</p>
    <h3>SERVICES PMI® HISTORY</h3>
    <p>Apr 2026 53.6</p>
  </main>
`;

const mayReportHtml = `
  <main>
    <h1>May 2026 ISM® Services PMI® Report</h1>
    <p>The Services PMI® registered 51 percent, lower than April.</p>
  </main>
`;

describe("ISM Services PMI adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("extracts the current Services report URL from the reports page", () => {
    expect(extractCurrentServicesReportUrl(reportsPageHtml)).toBe(
      "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-pmi-reports/services/april/"
    );
  });

  it("extracts the period and one-decimal PMI value from a Services report", () => {
    expect(extractIsmServicesPmiReport(aprilReportHtml, "https://example.com/april/")).toEqual({
      period: "April 2026",
      value: "53.6",
      reportUrl: "https://example.com/april/"
    });
  });

  it("formats a not-published value with latest available report context", () => {
    const latestReport = extractIsmServicesPmiReport(aprilReportHtml, "https://example.com/april/");
    expect(buildIsmServicesPmiValue(null, latestReport)).toContain("Value: not published yet");
    expect(buildIsmServicesPmiValue(null, latestReport)).toContain("Latest available: April 2026 = 53.6");
  });

  it("formats a dynamically selected target value when released", () => {
    const targetReport = extractIsmServicesPmiReport(mayReportHtml, "https://example.com/may/");
    expect(
      buildIsmServicesPmiValue(targetReport, null, parseIsmServicesPmiTarget("https://polymarket.com/event/ism-services-pmi-may-2026"))
    ).toContain("Value: 51.0");
  });

  it("parses the active target period and report URL from the market", () => {
    expect(
      parseIsmServicesPmiTarget(
        "https://polymarket.com/event/ism-services-pmi-july-2026-20260710153544980"
      )
    ).toMatchObject({
      period: "July 2026",
      reportUrl: "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-pmi-reports/services/july/"
    });
  });

  it("parses the exact release date from current Gamma rules", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{
        description: "The report is currently scheduled to be released on August 5, 2026, at 10:00 AM ET."
      }]
    }));

    await expect(
      fetchIsmServicesPmiMarketMetadata(
        "https://polymarket.com/event/ism-services-pmi-july-2026-20260710153544980"
      )
    ).resolves.toMatchObject({
      period: "July 2026",
      releaseDateEt: "2026-08-05",
      releaseLabel: "August 5, 2026 10:00 AM ET"
    });
  });

  it("polls every minute on the day before and day of the discovered release", () => {
    const integration = {
      polymarketUrl: "https://polymarket.com/event/ism-services-pmi-july-2026-20260710153544980",
      settingsJson: JSON.stringify({
        ismServicesReleaseDateEt: "2026-08-05",
        ismServicesReleaseLabel: "August 5, 2026 10:00 AM ET"
      })
    } as never;
    expect(getIsmServicesPmiPollIntervalMinutes(integration, new Date("2026-08-04T16:00:00.000Z"))).toBe(1);
    expect(getIsmServicesPmiPollIntervalMinutes(integration, new Date("2026-08-05T16:00:00.000Z"))).toBe(1);
    expect(getIsmServicesPmiPollIntervalMinutes(integration, new Date("2026-08-06T16:00:00.000Z"))).toBe(60);
  });
});
