import { describe, expect, it } from "vitest";
import {
  buildIsmServicesPmiValue,
  extractCurrentServicesReportUrl,
  extractIsmServicesPmiReport,
  getIsmServicesPmiPollIntervalMinutes
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

  it("formats the target May 2026 value when released", () => {
    const targetReport = extractIsmServicesPmiReport(mayReportHtml, "https://example.com/may/");
    expect(buildIsmServicesPmiValue(targetReport, null)).toContain("Value: 51.0");
  });

  it("polls every minute on the day before and day of scheduled release in ET", () => {
    expect(getIsmServicesPmiPollIntervalMinutes({} as never, new Date("2026-06-02T16:00:00.000Z"))).toBe(1);
    expect(getIsmServicesPmiPollIntervalMinutes({} as never, new Date("2026-06-03T16:00:00.000Z"))).toBe(1);
    expect(getIsmServicesPmiPollIntervalMinutes({} as never, new Date("2026-06-04T16:00:00.000Z"))).toBe(60);
  });
});
