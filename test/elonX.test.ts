import { afterEach, describe, expect, it, vi } from "vitest";
import {
  elonXAdapter,
  extractElonXGammaStrikeTerms,
  findMatchedElonXStrikeTerms,
  parseElonXCancelTimeline,
  parseElonXMarketWindow,
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
