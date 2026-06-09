import { describe, expect, it } from "vitest";
import {
  buildUmichConsumerSentimentValue,
  extractUmichConsumerSentimentRows,
  extractUmichReleaseLinks,
  getUmichConsumerSentimentPollIntervalMinutes,
  umichConsumerSentimentShouldAlertOnChange
} from "../src/integrations/umichConsumerSentiment.js";

const releaseHtml = `
  <table>
    <tr>
      <td class="date">June 26, 2026</td>
      <td class="title"><a href="fetchdoc.php?docid=999">June Final Results</a></td>
    </tr>
    <tr>
      <td class="date">June 12, 2026</td>
      <td class="title"><a href="fetchdoc.php?docid=998">June Preliminary Results</a></td>
    </tr>
  </table>
`;

describe("UMich Consumer Sentiment adapter", () => {
  it("extracts monthly sentiment rows from UMich CSV", () => {
    const rows = extractUmichConsumerSentimentRows(`Table 1: The Index of Consumer Sentiment
Month,Year,Index,
4,2026,49.8,
5,2026,52,
6,2026,55.55,
`);

    expect(rows).toEqual([
      { month: 4, year: 2026, value: "49.8" },
      { month: 5, year: 2026, value: "52.0" },
      { month: 6, year: 2026, value: "55.5" }
    ]);
  });

  it("extracts final and preliminary release links", () => {
    expect(extractUmichReleaseLinks(releaseHtml)).toEqual([
      {
        date: "June 26, 2026",
        title: "June Final Results",
        url: "https://data.sca.isr.umich.edu/fetchdoc.php?docid=999"
      },
      {
        date: "June 12, 2026",
        title: "June Preliminary Results",
        url: "https://data.sca.isr.umich.edu/fetchdoc.php?docid=998"
      }
    ]);
  });

  it("requires the final release link before treating June as published", () => {
    const targetRow = { month: 6, year: 2026, value: "55.5" };
    const pending = buildUmichConsumerSentimentValue(targetRow, targetRow, null);
    const published = buildUmichConsumerSentimentValue(targetRow, targetRow, {
      date: "June 26, 2026",
      title: "June Final Results",
      url: "https://data.sca.isr.umich.edu/fetchdoc.php?docid=999"
    });

    expect(pending).toContain("Target status: not published yet");
    expect(published).toContain("Target status: final release published");
    expect(published).toContain("Value: 55.5");
  });

  it("polls daily before release, per minute during release watch, and hourly if late", () => {
    expect(getUmichConsumerSentimentPollIntervalMinutes({ lastValue: null } as never, new Date("2026-06-24T16:00:00.000Z"))).toBe(1_440);
    expect(getUmichConsumerSentimentPollIntervalMinutes({ lastValue: null } as never, new Date("2026-06-25T16:00:00.000Z"))).toBe(1);
    expect(getUmichConsumerSentimentPollIntervalMinutes({ lastValue: null } as never, new Date("2026-06-26T14:00:00.000Z"))).toBe(1);
    expect(getUmichConsumerSentimentPollIntervalMinutes({ lastValue: null } as never, new Date("2026-06-27T16:00:00.000Z"))).toBe(60);
    expect(
      getUmichConsumerSentimentPollIntervalMinutes(
        { lastValue: "Target status: final release published" } as never,
        new Date("2026-06-27T16:00:00.000Z")
      )
    ).toBe(1_440);
  });

  it("alerts only when the final release first appears or revises", () => {
    const pending = "Target status: not published yet\nValue: not published yet";
    const published = "Target status: final release published\nValue: 55.5";
    const revised = "Target status: final release published\nValue: 55.6";

    expect(umichConsumerSentimentShouldAlertOnChange(pending, published)).toBe(true);
    expect(umichConsumerSentimentShouldAlertOnChange(published, published)).toBe(false);
    expect(umichConsumerSentimentShouldAlertOnChange(published, revised)).toBe(true);
    expect(umichConsumerSentimentShouldAlertOnChange(pending, pending)).toBe(false);
  });
});
