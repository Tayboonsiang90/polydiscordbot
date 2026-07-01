import { describe, expect, it } from "vitest";
import {
  buildUmichQueueMarketFromGammaEvent,
  buildUmichConsumerSentimentValue,
  extractUmichConsumerSentimentRows,
  extractUmichReleaseLinks,
  getUmichConsumerSentimentPollIntervalMinutes,
  parseUmichMarketPeriod,
  umichConsumerSentimentShouldAlertOnChange
} from "../src/integrations/umichConsumerSentiment.js";

const julyPolymarketUrl = "https://polymarket.com/event/university-of-michigan-consumer-sentiment-july-2026-20260630013808102";
const julyDescription =
  "The resolution source for this market will be the University of Michigan Surveys of Consumers final release for July 2026 (https://data.sca.isr.umich.edu/), currently scheduled to be released on July 31, 2026, at 10:00 AM ET.";

const releaseHtml = `
  <table>
    <tr>
      <td class="date">July 31, 2026</td>
      <td class="title"><a href="fetchdoc.php?docid=1000">July Final Results</a></td>
    </tr>
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
  it("parses the active monthly market period and scheduled release from rules", () => {
    expect(parseUmichMarketPeriod(julyPolymarketUrl, new Date("2026-07-01T00:00:00.000Z"), julyDescription)).toEqual({
      month: 7,
      year: 2026,
      label: "July 2026",
      finalReleaseTitle: "July Final Results",
      scheduledReleaseDate: "2026-07-31",
      scheduledReleaseTime: "10:00 AM",
      scheduledReleaseLabel: "July 31, 2026 10:00 AM ET"
    });
  });

  it("extracts monthly sentiment rows from UMich CSV", () => {
    const rows = extractUmichConsumerSentimentRows(`Table 1: The Index of Consumer Sentiment
Month,Year,Index,
4,2026,49.8,
5,2026,52,
6,2026,55.55,
7,2026,50.04,
`);

    expect(rows).toEqual([
      { month: 4, year: 2026, value: "49.8" },
      { month: 5, year: 2026, value: "52.0" },
      { month: 6, year: 2026, value: "55.5" },
      { month: 7, year: 2026, value: "50.0" }
    ]);
  });

  it("extracts final and preliminary release links", () => {
    expect(extractUmichReleaseLinks(releaseHtml)).toEqual([
      {
        date: "July 31, 2026",
        title: "July Final Results",
        url: "https://data.sca.isr.umich.edu/fetchdoc.php?docid=1000"
      },
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

  it("requires the final release link before treating the target month as published", () => {
    const period = parseUmichMarketPeriod(julyPolymarketUrl, new Date("2026-07-01T00:00:00.000Z"), julyDescription);
    const targetRow = { month: 7, year: 2026, value: "50.0" };
    const pending = buildUmichConsumerSentimentValue(targetRow, targetRow, null, period);
    const published = buildUmichConsumerSentimentValue(targetRow, targetRow, {
      date: "July 31, 2026",
      title: "July Final Results",
      url: "https://data.sca.isr.umich.edu/fetchdoc.php?docid=1000"
    }, period);

    expect(pending).toContain("Target status: not published yet");
    expect(published).toContain("Target status: final release published");
    expect(published).toContain("Target period: July 2026");
    expect(published).toContain("Value: 50.0");
  });

  it("polls daily before release, per minute during release watch, and hourly if late", () => {
    const integration = { lastValue: null, polymarketUrl: julyPolymarketUrl } as never;

    expect(getUmichConsumerSentimentPollIntervalMinutes(integration, new Date("2026-07-29T16:00:00.000Z"))).toBe(1_440);
    expect(getUmichConsumerSentimentPollIntervalMinutes(integration, new Date("2026-07-30T16:00:00.000Z"))).toBe(1);
    expect(getUmichConsumerSentimentPollIntervalMinutes(integration, new Date("2026-07-31T14:00:00.000Z"))).toBe(1);
    expect(getUmichConsumerSentimentPollIntervalMinutes(integration, new Date("2026-08-01T16:00:00.000Z"))).toBe(60);
    expect(
      getUmichConsumerSentimentPollIntervalMinutes(
        { lastValue: "Target status: final release published", polymarketUrl: julyPolymarketUrl } as never,
        new Date("2026-08-01T16:00:00.000Z")
      )
    ).toBe(1_440);
  });

  it("builds queue windows from Gamma event dates and scheduled release text", () => {
    expect(
      buildUmichQueueMarketFromGammaEvent(
        {
          slug: "university-of-michigan-consumer-sentiment-july-2026-20260630013808102",
          title: "University of Michigan Consumer Sentiment - July 2026",
          description: julyDescription,
          startDate: "2026-06-30T22:22:40.846313Z",
          endDate: "2026-07-31T06:00:00Z"
        },
        new Date("2026-07-01T00:00:00.000Z")
      )
    ).toMatchObject({
      url: julyPolymarketUrl,
      slug: "university-of-michigan-consumer-sentiment-july-2026-20260630013808102",
      startAt: "2026-06-30T22:22:40.846Z",
      endAt: "2026-08-01T03:59:00.000Z"
    });
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
