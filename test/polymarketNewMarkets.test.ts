import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchPolymarketNewMarketUpdates,
  normalizePolymarketNewMarketEvent,
  polymarketMentionMarketsAdapter,
  polymarketMentionMarketsConfig
} from "../src/integrations/polymarketNewMarkets.js";
import type { EventMonitorPost, Integration } from "../src/integrations/types.js";

const mentionsTag = { id: "100343", label: "Mentions", slug: "mention-markets" };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Polymarket new-market parsing", () => {
  it("normalizes active open mention-tag events into event alert posts", () => {
    const post = normalizePolymarketNewMarketEvent(
      {
        id: "588049",
        slug: "what-will-trump-post-this-week-june-15-21",
        title: "What will Trump post this week? (June 15 - 21)",
        description: "This market resolves based on Trump's Truth Social posts.",
        active: true,
        closed: false,
        archived: false,
        createdAt: "2026-06-12T18:40:57.186771Z",
        startDate: "2026-06-12T22:46:35.955991Z",
        endDate: "2026-06-22T03:59:00Z",
        tags: [
          mentionsTag,
          { id: "2", label: "Politics", slug: "politics" }
        ],
        markets: [
          { active: true, closed: false, archived: false },
          { active: true, closed: true, archived: false }
        ]
      },
      [mentionsTag],
      { alertTitle: "New Polymarket mention market" }
    );

    expect(post).toMatchObject<Partial<EventMonitorPost>>({
      id: "event:588049",
      type: "Polymarket new market",
      alertTitle: "New Polymarket mention market",
      mentionAlertRole: true,
      buttonLabel: "Open market",
      textFieldName: "Market",
      url: "https://polymarket.com/event/what-will-trump-post-this-week-june-15-21",
      polymarketUrl: "https://polymarket.com/event/what-will-trump-post-this-week-june-15-21",
      prioritySummary: {
        question: "What will Trump post this week? (June 15 - 21)",
        questionUrl: "https://polymarket.com/event/what-will-trump-post-this-week-june-15-21",
        marketTags: ["Mentions", "Politics"],
        matchedTags: ["Mentions"]
      },
      fields: [
        { name: "Child markets", value: "2 total / 1 open", inline: true },
        { name: "Starts UTC", value: "2026-06-12T22:46:35.955Z", inline: true },
        { name: "Ends UTC", value: "2026-06-22T03:59:00.000Z", inline: true }
      ],
      hideDefaultEventFields: true
    });
    expect(post?.postedAt.toISOString()).toBe("2026-06-12T18:40:57.186Z");
    expect(post?.text).toContain("This market resolves based on Trump's Truth Social posts.");
  });

  it("rejects closed, archived, malformed, and non-watched-tag events", () => {
    const baseEvent = {
      id: "1",
      slug: "test-market",
      title: "Test market",
      active: true,
      closed: false,
      archived: false,
      tags: [mentionsTag]
    };

    expect(normalizePolymarketNewMarketEvent({ ...baseEvent, closed: true }, [mentionsTag])).toBeNull();
    expect(normalizePolymarketNewMarketEvent({ ...baseEvent, archived: true }, [mentionsTag])).toBeNull();
    expect(normalizePolymarketNewMarketEvent({ ...baseEvent, slug: "" }, [mentionsTag])).toBeNull();
    expect(
      normalizePolymarketNewMarketEvent(
        { ...baseEvent, tags: [{ id: "2", label: "Politics", slug: "politics" }] },
        [mentionsTag]
      )
    ).toBeNull();
  });
});

describe("fetchPolymarketNewMarketUpdates", () => {
  it("fetches active Gamma events by watched tag id and sorts newest first", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = url.toString();
      expect(target).toContain("https://gamma-api.polymarket.com/events?");
      expect(target).toContain("tag_id=100343");
      expect(target).toContain("active=true");
      expect(target).toContain("closed=false");
      expect(target).toContain("archived=false");
      expect(target).toContain("order=createdAt");
      expect(target).toContain("ascending=false");

      return jsonResponse([
        {
          id: "old",
          slug: "old-mention-market",
          title: "Old mention market",
          active: true,
          closed: false,
          archived: false,
          createdAt: "2026-06-12T18:00:00.000Z",
          tags: [mentionsTag]
        },
        {
          id: "new",
          slug: "new-mention-market",
          title: "New mention market",
          active: true,
          closed: false,
          archived: false,
          createdAt: "2026-06-12T19:00:00.000Z",
          tags: [mentionsTag]
        }
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPolymarketNewMarketUpdates(
      polymarketMentionMarketsConfig,
      buildIntegration(JSON.stringify({ watchedTags: [mentionsTag], eventsLimit: 20 })),
      new Date("2026-06-13T00:00:00.000Z")
    );

    expect(result.posts.map((post) => post.id)).toEqual(["event:new", "event:old"]);
    expect(result.checkFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Matching active events", value: "2" }),
        expect.objectContaining({ name: "Watched tags", value: "Mentions (id 100343, mention-markets)" })
      ])
    );
    expect(JSON.parse(result.settingsJson ?? "{}")).toMatchObject({
      watchedTags: [mentionsTag],
      eventsLimit: 20,
      lastPolymarketNewMarketScanAt: "2026-06-13T00:00:00.000Z"
    });
  });

  it("can route future tag-specific posts to configured tag channels", () => {
    const post = normalizePolymarketNewMarketEvent(
      {
        id: "1",
        slug: "finance-mention-market",
        title: "Finance mention market",
        active: true,
        closed: false,
        archived: false,
        tags: [mentionsTag]
      },
      [mentionsTag]
    );
    const integration = buildIntegration(
      JSON.stringify({
        watchedTags: [{ ...mentionsTag, channelId: "mentions-channel", channelName: "mentions" }]
      })
    );

    expect(polymarketMentionMarketsAdapter.resolveEventPostChannelIds?.(integration, post!)).toEqual(["mentions-channel"]);
  });
});

function buildIntegration(settingsJson: string | null): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "polymarket-mention-markets",
    displayName: "Polymarket Mention Markets",
    sourceUrl: "https://polymarket.com/mentions",
    polymarketUrl: null,
    alertRoleId: null,
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: null,
    settingsJson,
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
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
