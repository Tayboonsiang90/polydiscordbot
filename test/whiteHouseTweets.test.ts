import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWhiteHouseTweetsMonitorValue,
  normalizeWhiteHouseTweetFromTrumpFeed,
  parseWhiteHouseTweetsNitterFeed,
  parseWhiteHouseTweetsMarketWindow,
  refreshWhiteHouseTweetsPolymarketQueue,
  whiteHouseTweetsAdapter,
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

  it("normalizes The Trump Feed public archive posts while excluding POTUS posts", () => {
    expect(
      normalizeWhiteHouseTweetFromTrumpFeed({
        id: 1,
        platform: "potus-x",
        authorHandle: "@WhiteHouse",
        sourceUrl: "https://x.com/WhiteHouse/status/2061970387349426334",
        postedAt: "2026-06-03T00:37:00.000Z",
        contentText: "White House post"
      })
    ).toEqual({
      id: "2061970387349426334",
      text: "White House post",
      createdAt: "2026-06-03T00:37:00.000Z",
      type: "Post",
      url: "https://x.com/WhiteHouse/status/2061970387349426334"
    });
    expect(
      normalizeWhiteHouseTweetFromTrumpFeed({
        id: 2,
        platform: "potus-x",
        authorHandle: "@POTUS",
        sourceUrl: "https://x.com/POTUS/status/2061963830788305194",
        postedAt: "2026-06-03T00:11:01.000Z",
        contentText: "RT @WhiteHouse: repost"
      })
    ).toBeNull();
  });

  it("parses Nitter/XCancel RSS posts while excluding replies", () => {
    const tweets = parseWhiteHouseTweetsNitterFeed(`
      <rss><channel>
        <item>
          <title>The White House: New post</title>
          <link>https://xcancel.com/WhiteHouse/status/100</link>
          <pubDate>Fri, 29 May 2026 13:00:00 GMT</pubDate>
          <description>New post</description>
        </item>
        <item>
          <title>R to @example: reply</title>
          <link>https://xcancel.com/WhiteHouse/status/101</link>
          <pubDate>Fri, 29 May 2026 13:01:00 GMT</pubDate>
          <description>Replying to @example</description>
        </item>
        <item>
          <title>RT by @WhiteHouse: repost</title>
          <link>https://xcancel.com/WhiteHouse/status/102</link>
          <pubDate>Fri, 29 May 2026 13:02:00 GMT</pubDate>
          <description>RT by @WhiteHouse</description>
        </item>
      </channel></rss>
    `);

    expect(tweets).toEqual([
      expect.objectContaining({ id: "100", type: "Post", url: "https://x.com/WhiteHouse/status/100" }),
      expect.objectContaining({ id: "102", type: "Repost", url: "https://x.com/WhiteHouse/status/102" })
    ]);
  });

  it("uses The Trump Feed public archive as the primary public source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            posts: [
              {
                id: 1,
                platform: "potus-x",
                authorHandle: "@WhiteHouse",
                sourceUrl: "https://x.com/WhiteHouse/status/200",
                postedAt: "2026-05-29T13:00:00.000Z",
                contentText: "feed post"
              },
              {
                id: 2,
                platform: "potus-x",
                authorHandle: "@POTUS",
                sourceUrl: "https://x.com/POTUS/status/201",
                postedAt: "2026-05-29T13:01:00.000Z",
                contentText: "POTUS post"
              }
            ],
            totalPages: 1
          })
      })
    );

    const result = await whiteHouseTweetsAdapter.fetchCurrentValue({
      polymarketUrl: marketUrl,
      lastValue: null
    } as Integration);

    expect(result.value).toContain("Current total: 1");
    expect(result.value).toContain("Capture source: The Trump Feed public archive");
  });

  it("skips XCancel whitelist placeholders and tries the backup RSS feed", async () => {
    vi.stubEnv("WHITE_HOUSE_TWEETS_NITTER_FEEDS", "https://xcancel.com/WhiteHouse/rss");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "temporary failure"
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <rss><channel>
            <title>RSS reader not yet whitelisted!</title>
            <item>
              <title>RSS reader not yet whitelisted!</title>
              <link>https://rss.xcancel.com/WhiteHouse/rss</link>
              <pubDate>Mon, 01 January 1971 00:00:00 GMT</pubDate>
            </item>
          </channel></rss>
        `
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <rss><channel><item>
            <title>The White House: backup feed post</title>
            <link>https://nitter.net/WhiteHouse/status/201</link>
            <pubDate>Fri, 29 May 2026 13:00:00 GMT</pubDate>
            <description>backup feed post</description>
          </item></channel></rss>
        `
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await whiteHouseTweetsAdapter.fetchCurrentValue({
      polymarketUrl: marketUrl,
      lastValue: null
    } as Integration);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.value).toContain("Current total: 1");
    expect(result.value).toContain("https://x.com/WhiteHouse/status/201");
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
