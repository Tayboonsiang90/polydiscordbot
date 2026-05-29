import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWhiteHouseTweetsMonitorValue,
  normalizeWhiteHouseTweetFromApi,
  parseWhiteHouseTweetsMarketWindow,
  refreshWhiteHouseTweetsPolymarketQueue,
  whiteHouseTweetsShouldAlertOnChange,
  type WhiteHouseTweet
} from "../src/integrations/whiteHouseTweets.js";
import type { Integration } from "../src/integrations/types.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const marketUrl = "https://polymarket.com/event/white-house-of-tweets-may-26-june-2-2026";

function tweet(id: string, createdAt: string, type: WhiteHouseTweet["type"] = "Post"): WhiteHouseTweet {
  return {
    id,
    text: `post ${id}`,
    createdAt,
    type,
    url: `https://x.com/WhiteHouse/status/${id}`
  };
}

describe("White House X posts adapter", () => {
  it("parses exact noon-to-noon ET market windows", () => {
    expect(parseWhiteHouseTweetsMarketWindow(marketUrl, new Date("2026-05-29T00:00:00.000Z"))).toEqual({
      startAt: "2026-05-26T16:00:00.000Z",
      endAt: "2026-06-02T16:00:00.000Z",
      label: "May 26 12:00 PM ET to Jun 2 12:00 PM ET"
    });
    expect(
      parseWhiteHouseTweetsMarketWindow(
        "https://polymarket.com/event/white-house-of-tweets-december-29-january-5-2027",
        new Date("2026-12-30T00:00:00.000Z")
      )
    ).toMatchObject({
      startAt: "2026-12-29T17:00:00.000Z",
      endAt: "2027-01-05T17:00:00.000Z"
    });
  });

  it("normalizes X API posts, quotes, and reposts while excluding replies", () => {
    expect(
      normalizeWhiteHouseTweetFromApi({
        id: "1",
        text: "quote",
        created_at: "2026-05-29T13:00:00.000Z",
        referenced_tweets: [{ type: "quoted", id: "quoted" }]
      })
    ).toMatchObject({ id: "1", type: "Quote" });
    expect(
      normalizeWhiteHouseTweetFromApi({
        id: "2",
        text: "rt",
        created_at: "2026-05-29T13:01:00.000Z",
        referenced_tweets: [{ type: "retweeted", id: "retweeted" }]
      })
    ).toMatchObject({ id: "2", type: "Repost" });
    expect(
      normalizeWhiteHouseTweetFromApi({
        id: "3",
        text: "reply",
        created_at: "2026-05-29T13:02:00.000Z",
        referenced_tweets: [{ type: "replied_to", id: "reply" }]
      })
    ).toBeNull();
  });

  it("initializes a market count without creating a retroactive hourly alert", () => {
    const window = parseWhiteHouseTweetsMarketWindow(marketUrl, new Date("2026-05-29T00:00:00.000Z"))!;
    const value = buildWhiteHouseTweetsMonitorValue(
      [tweet("1", "2026-05-29T13:00:00.000Z")],
      null,
      marketUrl,
      window,
      new Date("2026-05-29T13:05:00.000Z")
    );

    expect(value).toContain("Current total: 1");
    expect(value).toContain("Hourly summary ready: no");
    expect(whiteHouseTweetsShouldAlertOnChange(null, value)).toBe(false);
  });

  it("keeps captured posts when the X timeline no longer returns them", () => {
    const window = parseWhiteHouseTweetsMarketWindow(marketUrl, new Date("2026-05-29T00:00:00.000Z"))!;
    const firstValue = buildWhiteHouseTweetsMonitorValue(
      [tweet("1", "2026-05-29T13:00:00.000Z")],
      null,
      marketUrl,
      window,
      new Date("2026-05-29T13:05:00.000Z")
    );
    const secondValue = buildWhiteHouseTweetsMonitorValue([], firstValue, marketUrl, window, new Date("2026-05-29T13:10:00.000Z"));

    expect(secondValue).toContain("Current total: 1");
    expect(secondValue).toContain("Captured posts: 1|2026-05-29T13:00:00.000Z|Post|https://x.com/WhiteHouse/status/1");
  });

  it("rolls captured posts into one hourly summary alert after the hour closes", () => {
    const window = parseWhiteHouseTweetsMarketWindow(marketUrl, new Date("2026-05-29T00:00:00.000Z"))!;
    const initialized = buildWhiteHouseTweetsMonitorValue(
      [tweet("1", "2026-05-29T13:00:00.000Z")],
      null,
      marketUrl,
      window,
      new Date("2026-05-29T13:05:00.000Z")
    );
    const withNewPost = buildWhiteHouseTweetsMonitorValue(
      [tweet("1", "2026-05-29T13:00:00.000Z"), tweet("2", "2026-05-29T13:15:00.000Z")],
      initialized,
      marketUrl,
      window,
      new Date("2026-05-29T13:20:00.000Z")
    );
    const summary = buildWhiteHouseTweetsMonitorValue(
      [tweet("1", "2026-05-29T13:00:00.000Z"), tweet("2", "2026-05-29T13:15:00.000Z")],
      withNewPost,
      marketUrl,
      window,
      new Date("2026-05-29T14:01:00.000Z")
    );

    expect(withNewPost).toContain("Hourly summary ready: no");
    expect(summary).toContain("Hourly summary ready: yes");
    expect(summary).toContain("Hourly new posts: 1");
    expect(summary).toContain("2026-05-29 09:00 ET: 1");
    expect(whiteHouseTweetsShouldAlertOnChange(withNewPost, summary)).toBe(true);
  });

  it("auto-discovers overlapping weekly tweet markets with exact noon ET windows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "white-house-of-tweets-may-26-june-2-2026",
              title: "White House # posts May 26 - June 2, 2026?",
              active: true,
              closed: false,
              tags: [{ slug: "tweets-markets" }]
            },
            {
              slug: "white-house-of-tweets-may-29-june-5-2026",
              title: "White House # posts May 29 - June 5, 2026?",
              active: true,
              closed: false,
              tags: [{ slug: "tweets-markets" }]
            }
          ]
        })
      })
    );

    const result = await refreshWhiteHouseTweetsPolymarketQueue(
      {
        settingsJson: null,
        polymarketUrl: marketUrl
      } as Integration,
      new Date("2026-05-31T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      polymarketMarkets?: Array<{ slug: string; startAt: string; endAt: string }>;
    };

    expect(result.activeUrl).toBe(marketUrl);
    expect(settings.polymarketMarkets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "white-house-of-tweets-may-26-june-2-2026",
          startAt: "2026-05-26T16:00:00.000Z",
          endAt: "2026-06-02T16:00:00.000Z"
        }),
        expect.objectContaining({
          slug: "white-house-of-tweets-may-29-june-5-2026",
          startAt: "2026-05-29T16:00:00.000Z",
          endAt: "2026-06-05T16:00:00.000Z"
        })
      ])
    );
  });

  it("switches to the overlapping next market when the older one expires", async () => {
    const result = await refreshWhiteHouseTweetsPolymarketQueue(
      {
        settingsJson: JSON.stringify({
          polymarketMarkets: [
            {
              url: "https://polymarket.com/event/white-house-of-tweets-may-26-june-2-2026",
              slug: "white-house-of-tweets-may-26-june-2-2026",
              startAt: "2026-05-26T16:00:00.000Z",
              endAt: "2026-06-02T16:00:00.000Z",
              addedAt: "2026-05-29T12:00:00.000Z"
            },
            {
              url: "https://polymarket.com/event/white-house-of-tweets-may-29-june-5-2026",
              slug: "white-house-of-tweets-may-29-june-5-2026",
              startAt: "2026-05-29T16:00:00.000Z",
              endAt: "2026-06-05T16:00:00.000Z",
              addedAt: "2026-05-29T12:00:00.000Z"
            }
          ],
          lastWhiteHouseTweetsDiscoveryAt: "2026-05-29T12:00:00.000Z"
        }),
        polymarketUrl: "https://polymarket.com/event/white-house-of-tweets-may-26-june-2-2026"
      } as Integration,
      new Date("2026-06-02T16:01:00.000Z")
    );

    expect(result.activeUrl).toBe("https://polymarket.com/event/white-house-of-tweets-may-29-june-5-2026");
  });
});
