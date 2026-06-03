import { describe, expect, it } from "vitest";
import {
  buildTrumpGettyValue,
  extractGettyDateCreatedFromText,
  extractGettyDetailDateCreated,
  extractGettyPublicSearchPhotos,
  normalizeGettyPhoto,
  parseTrumpGettyMarketWindow,
  refreshTrumpGettyPolymarketQueue,
  trumpGettyPhotosAdapter,
  trumpGettyShouldAlertOnChange
} from "../src/integrations/trumpGettyPhotos.js";
import type { Integration } from "../src/integrations/types.js";

describe("Trump Getty photos adapter", () => {
  it("parses compact weekly market windows and upload deadlines", () => {
    expect(
      parseTrumpGettyMarketWindow(
        "https://polymarket.com/event/will-trump-be-photographed-every-day-this-week-525-531",
        new Date("2026-05-26T12:00:00.000Z")
      )
    ).toMatchObject({
      startDate: "2026-05-25",
      endDate: "2026-05-31",
      uploadDeadlineDate: "2026-06-01",
      label: "May 25-May 31 2026",
      qualifyingDates: ["2026-05-25", "2026-05-26", "2026-05-27", "2026-05-28", "2026-05-29", "2026-05-30", "2026-05-31"]
    });

    expect(
      parseTrumpGettyMarketWindow(
        "https://polymarket.com/event/will-trump-be-photographed-every-day-this-week-61-67",
        new Date("2026-06-02T12:00:00.000Z")
      )
    ).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-07",
      uploadDeadlineDate: "2026-06-08",
      label: "Jun 1-Jun 7 2026"
    });
  });

  it("normalizes Getty API image records", () => {
    expect(
      normalizeGettyPhoto({
        id: "2200000000",
        title: "President Trump Departs The White House",
        date_created: "2026-06-01T10:00:00Z",
        display_sizes: [{ name: "thumb", uri: "https://media.gettyimages.com/thumb.jpg" }],
        referral_destinations: [{ uri: "https://www.gettyimages.com/detail/news-photo/2200000000" }]
      })
    ).toEqual({
      id: "2200000000",
      title: "President Trump Departs The White House",
      dateCreated: "2026-06-01",
      url: "https://www.gettyimages.com/detail/news-photo/2200000000",
      thumbnailUrl: "https://media.gettyimages.com/thumb.jpg"
    });
  });

  it("extracts Getty public search photos and created dates from reader markdown", () => {
    const markdown = `
[![Image 3: President Donald Trump waves as he returns to the White House on June 1, 2026](https://media.gettyimages.com/id/2278476994/photo/washington-dc.jpg?s=612x612&w=0&k=20&c=abc) President Donald Trump waves as he returns to the White House on June 1, 2026 in Washington, DC.](https://www.gettyimages.com/detail/news-photo/president-donald-trump-waves-news-photo/2278476994)
`;

    expect(extractGettyPublicSearchPhotos(markdown)).toEqual([
      {
        id: "2278476994",
        title:
          "President Donald Trump waves as he returns to the White House on June 1, 2026 President Donald Trump waves as he returns to the White House on June 1, 2026 in Washington, DC.",
        dateCreated: "2026-06-01",
        url: "https://www.gettyimages.com/detail/news-photo/president-donald-trump-waves-news-photo/2278476994",
        thumbnailUrl: "https://media.gettyimages.com/id/2278476994/photo/washington-dc.jpg?s=612x612&w=0&k=20&c=abc"
      }
    ]);
  });

  it("extracts Getty detail created dates when captions are incomplete", () => {
    expect(extractGettyDateCreatedFromText("President Trump departs on May 31, 2026 in Washington, DC.")).toBe("2026-05-31");
    expect(
      extractGettyDetailDateCreated(`
Date created:

May 31, 2026

Upload date:

June 1, 2026
`)
    ).toBe("2026-05-31");
  });

  it("uses the public scraper fallback when Getty API credentials are missing", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.GETTY_API_KEY;
    const originalAccessToken = process.env.GETTY_ACCESS_TOKEN;
    delete process.env.GETTY_API_KEY;
    delete process.env.GETTY_ACCESS_TOKEN;

    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("page=2")) {
        return new Response("Title: empty page\n\nMarkdown Content:\n");
      }

      if (url.includes("r.jina.ai") && url.includes("/search/2/image")) {
        return new Response(`
[![Image 3: President Donald Trump waves on June 1,...](https://media.gettyimages.com/id/1/photo/one.jpg?s=612x612) President Donald Trump waves on June 1, in Washington, DC.](https://www.gettyimages.com/detail/news-photo/one-news-photo/1)
[![Image 4: President Donald Trump speaks on June 2, 2026](https://media.gettyimages.com/id/2/photo/two.jpg?s=612x612) President Donald Trump speaks on June 2, 2026 in Washington, DC.](https://www.gettyimages.com/detail/news-photo/two-news-photo/2)
`);
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    try {
      const result = await trumpGettyPhotosAdapter.fetchCurrentValue(
        buildIntegration("https://polymarket.com/event/will-trump-be-photographed-every-day-this-week-61-67")
      );
      expect(result.value).toContain("Covered days: 2/7");
      expect(result.value).toContain("Covered dates: 2026-06-01, 2026-06-02");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) {
        delete process.env.GETTY_API_KEY;
      } else {
        process.env.GETTY_API_KEY = originalApiKey;
      }

      if (originalAccessToken === undefined) {
        delete process.env.GETTY_ACCESS_TOKEN;
      } else {
        process.env.GETTY_ACCESS_TOKEN = originalAccessToken;
      }
    }
  });

  it("formats day coverage and only alerts when new dates become covered", () => {
    const window = parseTrumpGettyMarketWindow(
      "https://polymarket.com/event/will-trump-be-photographed-every-day-this-week-61-67",
      new Date("2026-06-02T12:00:00.000Z")
    );
    expect(window).not.toBeNull();

    const firstValue = buildTrumpGettyValue(
      [
        {
          id: "1",
          title: "Trump photo",
          dateCreated: "2026-06-01",
          url: "https://www.gettyimages.com/detail/news-photo/1",
          thumbnailUrl: null
        }
      ],
      window!,
      "https://polymarket.com/event/will-trump-be-photographed-every-day-this-week-61-67"
    );
    const secondValue = buildTrumpGettyValue(
      [
        {
          id: "1",
          title: "Trump photo",
          dateCreated: "2026-06-01",
          url: "https://www.gettyimages.com/detail/news-photo/1",
          thumbnailUrl: null
        },
        {
          id: "2",
          title: "Another Trump photo",
          dateCreated: "2026-06-02",
          url: "https://www.gettyimages.com/detail/news-photo/2",
          thumbnailUrl: null
        }
      ],
      window!,
      "https://polymarket.com/event/will-trump-be-photographed-every-day-this-week-61-67"
    );

    expect(firstValue).toContain("Covered days: 1/7");
    expect(firstValue).toContain("Missing dates: 2026-06-02, 2026-06-03, 2026-06-04, 2026-06-05, 2026-06-06, 2026-06-07");
    expect(trumpGettyShouldAlertOnChange(firstValue, secondValue)).toBe(true);
    expect(trumpGettyShouldAlertOnChange(secondValue, secondValue)).toBe(false);
  });

  it("discovers and queues weekly Polymarket markets", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          events: [
            {
              slug: "will-trump-be-photographed-every-day-this-week-525-531",
              title: "Will Trump be photographed every day this week? (5/25-5/31)",
              active: true,
              closed: false
            },
            {
              slug: "will-trump-be-photographed-every-day-this-week-61-67",
              title: "Will Trump be photographed every day this week? (6/1-6/7)",
              active: true,
              closed: false
            }
          ]
        })
      );

    try {
      const result = await refreshTrumpGettyPolymarketQueue(
        buildIntegration("https://polymarket.com/event/will-trump-be-photographed-every-day-this-week-525-531"),
        new Date("2026-05-31T22:00:00.000Z")
      );
      const settings = JSON.parse(result.settingsJson ?? "{}") as { polymarketMarkets?: Array<{ slug: string; startAt: string; endAt: string }> };
      expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual([
        "will-trump-be-photographed-every-day-this-week-525-531",
        "will-trump-be-photographed-every-day-this-week-61-67"
      ]);
      expect(settings.polymarketMarkets?.[1]).toMatchObject({
        startAt: "2026-06-01T04:00:00.000Z",
        endAt: "2026-06-09T03:59:00.000Z"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function buildIntegration(polymarketUrl: string): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "trump-getty-photos",
    displayName: "Trump Getty Photos",
    sourceUrl: "https://www.gettyimages.com.mx/search/2/image?family=editorial&sort=newest&specificpeople=118600",
    polymarketUrl,
    alertRoleId: null,
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: null,
    settingsJson: null,
    pollIntervalMinutes: 60,
    status: "active",
    lastValue: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    snapshotValue: null,
    snapshotCheckedAt: null,
    snapshotDate: null,
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z"
  };
}
