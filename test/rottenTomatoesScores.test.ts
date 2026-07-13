import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractRottenTomatoesBucketMap,
  extractRottenTomatoesScoreFromSearch,
  formatRottenTomatoesScoresValue,
  normalizeRottenTomatoesGammaEvent,
  refreshRottenTomatoesMarkets,
  shouldAlertOnRottenTomatoesBucketChange
} from "../src/integrations/rottenTomatoesScores.js";
import type { Integration } from "../src/integrations/types.js";

const moanaUrl = "https://polymarket.com/event/moana-rotten-tomatoes-score-20260630145544856";

function integration(input: Partial<Integration> = {}): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "rotten-tomatoes-scores",
    displayName: "Rotten Tomatoes Scores",
    sourceUrl: "https://www.rottentomatoes.com",
    polymarketUrl: moanaUrl,
    alertRoleId: null,
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: null,
    settingsJson: null,
    pollIntervalMinutes: 5,
    status: "active",
    lastValue: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    snapshotValue: null,
    snapshotCheckedAt: null,
    snapshotDate: null,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    ...input
  };
}

describe("Rotten Tomatoes scores adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses exact movie score from Rotten Tomatoes search HTML", () => {
    const score = extractRottenTomatoesScoreFromSearch(
      `
      <search-page-media-row release-year="2026" tomatometer-score="35">
        <a href="https://www.rottentomatoes.com/m/moana_2026" data-qa="thumbnail-link" slot="thumbnail">
          <img alt="Moana">
        </a>
      </search-page-media-row>
      <search-page-media-row release-year="2016" tomatometer-score="96">
        <a href="https://www.rottentomatoes.com/m/moana_2016" data-qa="thumbnail-link" slot="thumbnail">
          <img alt="Moana">
        </a>
      </search-page-media-row>
      `,
      "Moana",
      2026
    );

    expect(score).toMatchObject({
      title: "Moana",
      releaseYear: 2026,
      score: 35,
      url: "https://www.rottentomatoes.com/m/moana_2026"
    });
  });

  it("normalizes Gamma event metadata, deadlines, and active thresholds", () => {
    const market = normalizeRottenTomatoesGammaEvent({
      slug: "moana-rotten-tomatoes-score-20260630145544856",
      title: "“Moana” Rotten Tomatoes Score?",
      description:
        "This market will resolve to “Yes” if the displayed Rotten Tomatoes “All Critics” Tomatometer score for Moana (2026) is at least equal to the specified number at 10:00 AM ET on July 13, 2026. This market will resolve to “No” if no data is available by July 17, 2026, 11:59 PM ET.",
      active: true,
      closed: false,
      endDate: "2026-07-13T00:00:00Z",
      tags: [{ slug: "rotten-tomatoes" }],
      markets: [
        { question: "Will \"Moana\" score at least 35 on the Rotten Tomatoes Tomatometer?", active: true, closed: false, outcomePrices: "[\"0.5\",\"0.5\"]" },
        { question: "Will \"Moana\" score at least 70 on the Rotten Tomatoes Tomatometer?", active: true, closed: false, outcomePrices: "[\"1\",\"0\"]" },
        { question: "Will \"Moana\" score at least 40 on the Rotten Tomatoes Tomatometer?", active: true, closed: false, outcomePrices: "[\"0.5\",\"0.5\"]" }
      ]
    });

    expect(market).toMatchObject({
      title: "Moana",
      releaseYear: 2026,
      thresholds: [35, 40],
      resolutionAt: "2026-07-13T14:00:00.000Z",
      noDataDeadlineAt: "2026-07-18T03:59:00.000Z"
    });
  });

  it("alerts only when a score enters a different 5-point bucket", () => {
    const previous = [
      "Bucket[moana-rotten-tomatoes-score-20260630145544856]: 35",
      "Bucket[evil-dead-burn-rotten-tomatoes-score-20260708180406392]: 70"
    ].join("\n");

    expect(shouldAlertOnRottenTomatoesBucketChange(null, previous)).toBe(false);
    expect(shouldAlertOnRottenTomatoesBucketChange(previous, previous.replace(": 35", ": 35"))).toBe(false);
    expect(shouldAlertOnRottenTomatoesBucketChange(previous, previous.replace(": 35", ": 40"))).toBe(true);
    expect(extractRottenTomatoesBucketMap(previous).get("moana-rotten-tomatoes-score-20260630145544856")).toBe("35");
  });

  it("does not alert when Rotten Tomatoes recovers from a transient error", () => {
    const previous = ["Buckets: Evil Dead Burn (2026)=error; Moana (2026)=30"].join("\n");
    const current = ["Buckets: Evil Dead Burn (2026)=70; Moana (2026)=30"].join("\n");

    expect(shouldAlertOnRottenTomatoesBucketChange(previous, current)).toBe(false);
  });

  it("keeps previous numeric buckets during transient score fetch errors", () => {
    const value = formatRottenTomatoesScoresValue(
      [
        {
          market: {
            url: moanaUrl,
            slug: "moana-rotten-tomatoes-score-20260630145544856",
            title: "Moana",
            releaseYear: 2026,
            thresholds: [30, 35, 40],
            resolutionAt: "2026-07-13T14:00:00.000Z",
            noDataDeadlineAt: "2026-07-18T03:59:00.000Z",
            endAt: "2026-07-13T00:00:00.000Z",
            addedAt: "2026-07-01T00:00:00.000Z"
          },
          score: null,
          error: "Rotten Tomatoes search returned HTTP 500 for Moana"
        }
      ],
      new Date("2026-07-13T12:00:00.000Z"),
      new Map([["Moana (2026)", "30"]])
    );

    expect(value).toContain("Moana (2026): fetch failed, kept prior bucket 30");
    expect(value).toContain("Buckets: Moana (2026)=30");
  });

  it("discovers active Rotten Tomatoes markets from Polymarket search", async () => {
    const existingSettings = JSON.stringify({
      markets: [
        {
          url: moanaUrl,
          slug: "moana-rotten-tomatoes-score-20260630145544856",
          title: "Moana",
          releaseYear: 2026,
          thresholds: [35, 40],
          resolutionAt: "2026-07-13T14:00:00.000Z",
          noDataDeadlineAt: "2026-07-18T03:59:00.000Z",
          endAt: "2026-07-13T00:00:00.000Z",
          addedAt: "2026-07-01T00:00:00.000Z"
        },
        {
          url: "https://polymarket.com/event/paw-patrol-the-dino-movie-rotten-tomatoes-score-20260709174855589",
          slug: "paw-patrol-the-dino-movie-rotten-tomatoes-score-20260709174855589",
          title: "PAW Patrol: The Dino Movie",
          releaseYear: 2026,
          thresholds: [60],
          resolutionAt: "2026-08-17T14:00:00.000Z",
          noDataDeadlineAt: "2026-08-22T03:59:00.000Z",
          endAt: "2026-08-17T23:59:00.000Z",
          addedAt: "2026-07-01T00:00:00.000Z"
        },
        {
          url: "https://polymarket.com/event/evil-dead-burn-rotten-tomatoes-score-20260708180406392",
          slug: "evil-dead-burn-rotten-tomatoes-score-20260708180406392",
          title: "Evil Dead Burn",
          releaseYear: 2026,
          thresholds: [70],
          resolutionAt: "2026-07-13T14:00:00.000Z",
          noDataDeadlineAt: "2026-07-18T03:59:00.000Z",
          endAt: "2026-07-13T23:59:00.000Z",
          addedAt: "2026-07-01T00:00:00.000Z"
        },
        {
          url: "https://polymarket.com/event/the-odyssey-rotten-tomato-score",
          slug: "the-odyssey-rotten-tomato-score",
          title: "The Odyssey",
          releaseYear: 2026,
          thresholds: [90],
          resolutionAt: "2026-07-20T14:00:00.000Z",
          noDataDeadlineAt: "2026-07-25T03:59:00.000Z",
          endAt: "2026-07-20T00:00:00.000Z",
          addedAt: "2026-07-01T00:00:00.000Z"
        },
        {
          url: "https://polymarket.com/event/spider-man-brand-new-day-rotten-tomatoes-score-20260630144021976",
          slug: "spider-man-brand-new-day-rotten-tomatoes-score-20260630144021976",
          title: "Spider-Man: Brand New Day",
          releaseYear: 2026,
          thresholds: [90],
          resolutionAt: "2026-08-03T14:00:00.000Z",
          noDataDeadlineAt: "2026-08-08T03:59:00.000Z",
          endAt: "2026-08-03T00:00:00.000Z",
          addedAt: "2026-07-01T00:00:00.000Z"
        }
      ]
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "new-movie-rotten-tomatoes-score",
              title: "“New Movie” Rotten Tomatoes Score?",
              description:
                "This market will resolve to “Yes” if the displayed Rotten Tomatoes “All Critics” Tomatometer score for New Movie (2026) is at least equal to the specified number at 10:00 AM ET on July 30, 2026. This market will resolve to “No” if no data is available by August 3, 2026, 11:59 PM ET.",
              active: true,
              closed: false,
              endDate: "2026-07-30T00:00:00Z",
              tags: [{ slug: "rotten-tomatoes" }],
              markets: [{ question: "Will \"New Movie\" score at least 50 on the Rotten Tomatoes Tomatometer?", active: true, closed: false }]
            }
          ]
        })
      })
    );

    const result = await refreshRottenTomatoesMarkets(
      integration({ settingsJson: existingSettings, polymarketUrl: null }),
      new Date("2026-07-11T12:00:00.000Z"),
      { force: true }
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as { markets?: Array<{ slug: string }> };

    expect(settings.markets?.map((market) => market.slug)).toContain("new-movie-rotten-tomatoes-score");
  });
});
