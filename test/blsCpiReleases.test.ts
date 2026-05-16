import { describe, expect, it } from "vitest";
import { extractLatestBlsCpiRelease, extractLatestBlsCpiReleaseValue } from "../src/integrations/blsCpiReleases.js";

const sampleHtml = `
  <h4 id="current">Current Edition of Consumer Price Index</h4>
  <ul>
    <li>The current edition is always posted at <a href="/news.release/cpi.nr0.htm">www.bls.gov/news.release/cpi.nr0.htm</a>.</li>
  </ul>
  <h4 id="2026">2026 Consumer Price Index</h4>
  <ul>
    <li><a href="/news.release/archives/cpi_04102026.htm">March 2026 Consumer Price Index</a> (<a href="/news.release/archives/cpi_04102026.pdf">PDF</a>)</li>
    <li><a href="/news.release/archives/cpi_03112026.htm">February 2026 Consumer Price Index</a></li>
  </ul>
`;

describe("BLS CPI releases adapter", () => {
  it("extracts the latest CPI archive release", () => {
    expect(extractLatestBlsCpiRelease(sampleHtml)).toEqual({
      title: "March 2026 Consumer Price Index",
      url: "https://www.bls.gov/news.release/archives/cpi_04102026.htm"
    });
  });

  it("formats the latest release as a stable monitor value", () => {
    const value = extractLatestBlsCpiReleaseValue(sampleHtml);
    expect(value).toContain("Title: March 2026 Consumer Price Index");
    expect(value).toContain("URL: https://www.bls.gov/news.release/archives/cpi_04102026.htm");
  });

  it("throws when no CPI archive release is present", () => {
    expect(() => extractLatestBlsCpiRelease("<html></html>")).toThrow("Could not find the latest BLS CPI archive release");
  });
});
