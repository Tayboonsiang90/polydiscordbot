import { describe, expect, it } from "vitest";
import {
  extractLatestBeaCurrentRelease,
  extractLatestBeaCurrentReleaseValue
} from "../src/integrations/beaCurrentReleases.js";

const sampleHtml = `
  <table>
    <tbody>
      <tr class="release-row">
        <td><a href="/news/2026/us-international-trade-goods-and-services-march-2026">U.S. International Trade in Goods and Services, March 2026</a></td>
        <td><time datetime="2026-05-05T08:30:00-04:00">May 5, 2026</time></td>
      </tr>
    </tbody>
  </table>
`;

describe("BEA current releases adapter", () => {
  it("extracts the latest current release row", () => {
    expect(extractLatestBeaCurrentRelease(sampleHtml)).toEqual({
      title: "U.S. International Trade in Goods and Services, March 2026",
      url: "https://www.bea.gov/news/2026/us-international-trade-goods-and-services-march-2026",
      releaseDate: "May 5, 2026"
    });
  });

  it("formats the latest release as a stable monitor value", () => {
    const value = extractLatestBeaCurrentReleaseValue(sampleHtml);
    expect(value).toContain("Title: U.S. International Trade in Goods and Services, March 2026");
    expect(value).toContain("Date: May 5, 2026");
    expect(value).toContain("URL: https://www.bea.gov/news/2026/us-international-trade-goods-and-services-march-2026");
  });

  it("throws when no current release row is present", () => {
    expect(() => extractLatestBeaCurrentRelease("<html></html>")).toThrow("Could not find the latest BEA current release row");
  });
});
