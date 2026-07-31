import { afterEach, describe, expect, it, vi } from "vitest";
import {
  elonXAdapter,
  extractElonXGammaStrikeTerms,
  findMatchedElonXStrikeTerms,
  getXFeedUrls,
  getXFrontendBaseUrls,
  hasAuthenticatedXCredentials,
  parseAuthenticatedElonXTweets,
  parseElonXCancelTimeline,
  parseElonXTrackerPosts,
  parseElonXMarketWindow,
  parseElonXNitterFeed,
  refreshElonXSettings
} from "../src/integrations/elonX.js";
import type { Integration } from "../src/integrations/types.js";

const integration: Integration = {
  id: 1,
  guildId: "guild",
  channelId: "channel",
  adapterId: "elon-x-strikes",
  displayName: "Elon X Posts",
  sourceUrl: "https://x.com/elonmusk",
  polymarketUrl: "https://polymarket.com/event/what-will-elon-post-this-week-june-15-21-20260612141418431",
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
  createdAt: "2026-06-13T00:00:00.000Z",
  updatedAt: "2026-06-13T00:00:00.000Z"
};

describe("Elon X strike monitor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("parses weekly Polymarket windows from Elon X market URLs", () => {
    const window = parseElonXMarketWindow(
      "https://polymarket.com/event/what-will-elon-post-this-week-june-15-21-20260612141418431",
      new Date("2026-06-13T00:00:00.000Z")
    );

    expect(window).toMatchObject({
      slug: "what-will-elon-post-this-week-june-15-21-20260612141418431",
      startAt: "2026-06-15T04:00:00.000Z",
      endAt: "2026-06-22T03:59:00.000Z"
    });
  });

  it("extracts unresolved strike terms from Gamma markets", () => {
    const terms = extractElonXGammaStrikeTerms([
      {
        question: 'Will Elon post "Crypto" or "Bitcoin" on X this week?',
        closed: false,
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.15","0.85"]'
      },
      {
        question: 'Will Elon post "Tesla" on X this week?',
        closed: true,
        outcomes: '["Yes","No"]',
        outcomePrices: '["1","0"]'
      }
    ]);

    expect(terms.strikeTerms).toEqual(["Bitcoin", "Crypto", "Tesla"]);
    expect(terms.resolvedTerms).toEqual(["Tesla"]);
    expect(terms.activeStrikeTerms).toEqual(["Bitcoin", "Crypto"]);
  });

  it("parses XCancel posts while excluding pinned posts and quoted/reposted text from matches", () => {
    const posts = parseElonXCancelTimeline(`
      <div class="timeline">
        <div class="timeline-item" data-username="elonmusk">
          <div class="tweet-body">
            <div class="pinned">Pinned Tweet</div>
            <a class="tweet-link" href="/elonmusk/status/100#m"></a>
            <span class="tweet-date"><a title="Jun 9, 2026 · 3:25 AM UTC"></a></span>
            <div class="tweet-content">Old pinned Tesla post</div>
          </div>
        </div>
        <div class="timeline-item" data-username="elonmusk">
          <a class="tweet-link" href="/elonmusk/status/101#m"></a>
          <div class="tweet-body">
            <span class="tweet-date"><a title="Jun 16, 2026 · 7:58 AM UTC"></a></span>
            <div class="tweet-content">Tesla factories in Texas</div>
            <div class="quote"><div class="quote-text">Bitcoin only appears in quoted text</div></div>
            <div class="attachments"><a class="still-image" href="https://pbs.twimg.com/media/sample.jpg?name=orig"><img alt="sample image" /></a></div>
          </div>
        </div>
        <div class="timeline-item" data-username="other">
          <a class="tweet-link" href="/other/status/102#m"></a>
          <div class="tweet-body">
            <div class="retweet-header">Elon Musk retweeted</div>
            <span class="tweet-date"><a title="Jun 16, 2026 · 8:10 AM UTC"></a></span>
            <div class="tweet-content">Crypto in a repost</div>
          </div>
        </div>
      </div>
    `);

    expect(posts.map((post) => post.id)).toEqual(["102", "101"]);
    expect(posts[1]).toMatchObject({
      type: "Quote",
      text: "Tesla factories in Texas",
      qualifyingText: "Tesla factories in Texas",
      imageUrls: ["https://pbs.twimg.com/media/sample.jpg?name=orig"],
      imageText: "sample image"
    });
    expect(posts[0]).toMatchObject({ type: "Repost", qualifyingText: "" });
    expect(findMatchedElonXStrikeTerms(posts[1].qualifyingText, ["Bitcoin", "Tesla", "Texas"])).toEqual(["Tesla", "Texas"]);
    expect(findMatchedElonXStrikeTerms(posts[0].qualifyingText, ["Crypto"])).toEqual([]);
  });

  it("suppresses repost notifications because reposts do not count for strike detection", () => {
    expect(
      elonXAdapter.shouldAlertOnEventPost?.({
        id: "102",
        type: "Repost",
        text: "Crypto in a repost",
        qualifyingText: "",
        postedAt: new Date("2026-06-16T08:10:00.000Z"),
        url: "https://x.com/other/status/102",
        imageUrls: [],
        imageText: "",
        matchedTerms: [],
        strikeTerms: ["Crypto"]
      })
    ).toBe(false);
  });

  it("uses multiple public X frontends by default", () => {
    expect(getXFrontendBaseUrls()).toEqual(["https://xcancel.com", "https://nitter.kareem.one"]);
    expect(getXFeedUrls()).toEqual(["https://xcancel.com/elonmusk/rss"]);
  });

  it("recognizes direct X session credentials only when both cookies exist", () => {
    vi.stubEnv("ELON_X_AUTH_TOKEN", "auth");
    expect(hasAuthenticatedXCredentials()).toBe(false);
    vi.stubEnv("ELON_X_CT0", "csrf");
    expect(hasAuthenticatedXCredentials()).toBe(true);
  });

  it("polls an active market every 30 seconds with direct X credentials", () => {
    const activeAt = new Date("2026-06-16T12:00:00.000Z");
    expect(elonXAdapter.getPollIntervalMinutes?.(integration, activeAt)).toBe(1);

    vi.stubEnv("ELON_X_AUTH_TOKEN", "auth");
    vi.stubEnv("ELON_X_CT0", "csrf");
    expect(elonXAdapter.getPollIntervalMinutes?.(integration, activeAt)).toBe(0.5);
  });

  it("converts authenticated X search results into full-text posts and replies", () => {
    const posts = parseAuthenticatedElonXTweets([
      {
        id: "2083053178761732504",
        text: "Wow",
        author: { username: "elonmusk", name: "Elon Musk" },
        inReplyToStatusId: "2083050000000000000",
        media: [{ type: "photo", url: "https://pbs.twimg.com/media/reply.jpg" }]
      },
      {
        id: "2083050405349482668",
        text: "Seriously https://t.co/cHH6KDkWst",
        author: { username: "elonmusk", name: "Elon Musk" },
        createdAt: "2026-07-31T04:41:32.000Z",
        quotedTweet: {
          id: "200",
          text: "Quoted text does not become Elon's wording",
          author: { username: "other", name: "Other" }
        }
      }
    ]);

    expect(posts[0]).toMatchObject({
      id: "2083053178761732504",
      type: "Reply",
      text: "Wow",
      qualifyingText: "Wow",
      url: "https://x.com/elonmusk/status/2083053178761732504",
      imageUrls: ["https://pbs.twimg.com/media/reply.jpg"],
      captureSource: "Direct X search"
    });
    expect(posts[0].postedAt.toISOString()).toBe("2026-07-31T04:52:33.730Z");
    expect(posts[1]).toMatchObject({
      id: "2083050405349482668",
      type: "Quote",
      text: "Seriously https://t.co/cHH6KDkWst"
    });
  });

  it("parses fast Polymarket XTracker posts without treating repost text as a strike source", () => {
    const posts = parseElonXTrackerPosts({
      success: true,
      data: [
        {
          platformId: "2083050405349482668",
          content: "Seriously https://t.co/cHH6KDkWst",
          createdAt: "2026-07-31T04:41:32.000Z"
        },
        {
          platformId: "2083037264750211153",
          content: "RT @someone: Bitcoin",
          createdAt: "2026-07-31T03:49:19.000Z"
        }
      ]
    });

    expect(posts[0]).toMatchObject({
      id: "2083050405349482668",
      type: "Post",
      qualifyingText: "Seriously https://t.co/cHH6KDkWst"
    });
    expect(posts[1]).toMatchObject({ id: "2083037264750211153", type: "Repost", qualifyingText: "" });
  });

  it("parses Nitter/XCancel RSS fallback posts", () => {
    const posts = parseElonXNitterFeed(`
      <rss>
        <channel>
          <item>
            <title>Elon Musk: Tesla factories in Texas</title>
            <description><![CDATA[Tesla factories in Texas]]></description>
            <link>https://xcancel.com/elonmusk/status/201#m</link>
            <pubDate>Tue, 14 Jul 2026 12:00:00 GMT</pubDate>
            <enclosure url="https://pbs.twimg.com/media/sample.jpg" />
          </item>
          <item>
            <title>RT by @elonmusk: Crypto in a repost</title>
            <description><![CDATA[Crypto in a repost]]></description>
            <link>https://xcancel.com/other/status/202#m</link>
            <pubDate>Tue, 14 Jul 2026 12:01:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    `);

    expect(posts.map((post) => post.id)).toEqual(["202", "201"]);
    expect(posts[0]).toMatchObject({ type: "Repost", qualifyingText: "" });
    expect(posts[1]).toMatchObject({
      type: "Post",
      text: "Tesla factories in Texas",
      qualifyingText: "Tesla factories in Texas",
      imageUrls: ["https://pbs.twimg.com/media/sample.jpg"]
    });
  });

  it("force-refreshes strike settings from the configured Polymarket URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              markets: [
                { question: 'Will Elon post "Always" on X this week?', closed: false, outcomes: '["Yes","No"]', outcomePrices: '["0.4","0.6"]' }
              ]
            }
          ]),
          { status: 200 }
        )
      )
    );

    await expect(refreshElonXSettings(integration, true, new Date("2026-06-13T00:00:00.000Z"))).resolves.toMatchObject({
      strikeTerms: ["Always"],
      parsedFromUrl: integration.polymarketUrl
    });
  });
});
