import { describe, expect, it } from "vitest";
import {
  extractEiaCrudeSprReleaseDates,
  extractEiaCrudeSprValue,
  extractLatestEiaCrudeSprDataPoint,
  getEiaCrudeSprPollIntervalMinutes
} from "../src/integrations/eiaCrudeSpr.js";
import type { Integration } from "../src/integrations/types.js";

const sampleHtml = `
  <table>
    <tr>
      <td class='B6'>&nbsp;&nbsp;2026-Apr</td>
      <td class='B5'>04/24&nbsp;</td>
      <td class='B3'>397,924&nbsp;&nbsp;&nbsp;</td>
      <td class='B5'>&nbsp;</td>
      <td class='B3'>&nbsp;&nbsp;&nbsp;</td>
    </tr>
    <tr>
      <td class='B6'>&nbsp;&nbsp;2026-May</td>
      <td class='B5'>05/01&nbsp;</td>
      <td class='B3'>392,700&nbsp;&nbsp;&nbsp;</td>
      <td class='B5'>&nbsp;</td>
      <td class='B3'>&nbsp;&nbsp;&nbsp;</td>
    </tr>
  </table>
  <table>
    <tr><td class='F2'>Release Date: 5/6/2026</td></tr>
    <tr><td class='F2'>Next Release Date: 5/13/2026</td></tr>
  </table>
`;

const integration = {
  adapterId: "eia-crude-spr",
  pollIntervalMinutes: 5
} as Integration;

describe("EIA crude SPR adapter", () => {
  it("extracts the latest weekly SPR data point", () => {
    expect(extractLatestEiaCrudeSprDataPoint(sampleHtml)).toEqual({
      endDate: "2026-05-01",
      value: "392,700"
    });
  });

  it("extracts release dates", () => {
    expect(extractEiaCrudeSprReleaseDates(sampleHtml)).toEqual({
      releaseDate: "5/6/2026",
      nextReleaseDate: "5/13/2026"
    });
  });

  it("formats the monitor value", () => {
    expect(extractEiaCrudeSprValue(sampleHtml)).toBe(
      [
        "End date: 2026-05-01",
        "Value: 392,700 thousand barrels",
        "Release date: 5/6/2026",
        "Next release date: 5/13/2026"
      ].join("\n")
    );
  });

  it("uses one-minute polling on Tuesday and Wednesday ET", () => {
    expect(getEiaCrudeSprPollIntervalMinutes(integration, new Date("2026-05-12T16:00:00.000Z"))).toBe(1);
    expect(getEiaCrudeSprPollIntervalMinutes(integration, new Date("2026-05-13T16:00:00.000Z"))).toBe(1);
    expect(getEiaCrudeSprPollIntervalMinutes(integration, new Date("2026-05-14T16:00:00.000Z"))).toBe(60);
  });
});
