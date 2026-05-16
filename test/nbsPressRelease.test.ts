import { describe, expect, it } from "vitest";
import { extractLatestNbsPressRelease, extractLatestNbsPressReleaseValue } from "../src/integrations/nbsPressRelease.js";

const sampleHtml = `
  <ul>
    <li><a href="./202605/t20260507_1963600.html">1.Market Prices of Important Means of Production in Circulation, April 21-30, 2026</a> 2026-05-07</li>
    <li><a href="./202605/t20260501_1963500.html">2.Purchasing Managers' Index for April 2026</a> 2026-05-01</li>
  </ul>
`;

describe("NBS press release adapter", () => {
  it("extracts the latest press release row", () => {
    expect(extractLatestNbsPressRelease(sampleHtml)).toEqual({
      title: "Market Prices of Important Means of Production in Circulation, April 21-30, 2026",
      date: "2026-05-07",
      url: "https://www.stats.gov.cn/english/PressRelease/202605/t20260507_1963600.html"
    });
  });

  it("formats the latest release as a stable monitor value", () => {
    const value = extractLatestNbsPressReleaseValue(sampleHtml);
    expect(value).toContain("Title: Market Prices of Important Means of Production in Circulation, April 21-30, 2026");
    expect(value).toContain("Date: 2026-05-07");
    expect(value).toContain("URL: https://www.stats.gov.cn/english/PressRelease/202605/t20260507_1963600.html");
  });

  it("throws when no press release row is present", () => {
    expect(() => extractLatestNbsPressRelease("<html></html>")).toThrow("Could not find the latest NBS press release row");
  });
});
