import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLemonadeQueueMarketFromUrl,
  extractLatestLemonadeStandEpisode,
  extractLatestLemonadeStandPageVideo,
  extractLatestLemonadeStandEpisodeValue,
  extractYoutubePublishedAt,
  lemonadeStandPodcastAdapter,
  refreshLemonadePolymarketQueue
} from "../src/integrations/lemonadeStandPodcast.js";
import type { Integration } from "../src/integrations/types.js";

const sampleYoutubeFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>short1</yt:videoId>
    <title>Would you vote for him?</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=short1"/>
    <published>2026-06-18T15:00:00+00:00</published>
  </entry>
  <entry>
    <yt:videoId>episode1</yt:videoId>
    <title>The Tide is Turning | Lemonade Stand 🍋</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=episode1"/>
    <published>2026-06-18T14:00:00+00:00</published>
  </entry>
</feed>`;

describe("Lemonade Stand Podcast adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('extracts the latest video with "Lemonade Stand" in the title', () => {
    expect(extractLatestLemonadeStandEpisode(sampleYoutubeFeed)).toEqual({
      title: "The Tide is Turning | Lemonade Stand 🍋",
      publishedAt: "2026-06-18T14:00:00+00:00",
      url: "https://www.youtube.com/watch?v=episode1"
    });
  });

  it("formats the latest qualifying video as a stable monitor value", () => {
    const value = extractLatestLemonadeStandEpisodeValue(sampleYoutubeFeed);

    expect(value).toContain("Title: The Tide is Turning | Lemonade Stand 🍋");
    expect(value).toContain("Published: 2026-06-18T14:00:00+00:00");
    expect(value).toContain("URL: https://www.youtube.com/watch?v=episode1");
    expect(value).toContain("Source: YouTube RSS");
  });

  it("throws when no qualifying Lemonade Stand video is present", () => {
    expect(() => extractLatestLemonadeStandEpisode("<feed></feed>")).toThrow(
      'Could not find a YouTube video with "Lemonade Stand" in the title'
    );
  });

  it("parses the newest qualifying upload from the YouTube channel-page fallback", () => {
    const html = [
      '{"metadata":{"lockupMetadataViewModel":{"title":{"content":"News But Our Personalities Change | Lemonade Stand \ud83c\udf4b"}}},',
      '"contentId":"oxu0mk4IXIA","contentType":"LOCKUP_CONTENT_TYPE_VIDEO"}'
    ].join("");

    expect(extractLatestLemonadeStandPageVideo(html)).toEqual({
      title: "News But Our Personalities Change | Lemonade Stand \ud83c\udf4b",
      videoId: "oxu0mk4IXIA",
      url: "https://www.youtube.com/watch?v=oxu0mk4IXIA"
    });
    expect(extractYoutubePublishedAt('"publishDate":"2026-07-29T12:00:30-07:00"')).toBe(
      "2026-07-29T12:00:30-07:00"
    );
  });

  it("polls the YouTube RSS feed every minute", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => sampleYoutubeFeed
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await lemonadeStandPodcastAdapter.fetchCurrentValue();

    expect(lemonadeStandPodcastAdapter.getPollIntervalMinutes?.({} as Integration)).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://www.youtube.com/feeds/videos.xml?channel_id=UCwVevVbti5Uuxj6Mkl5NHRA");
    expect(result.value).toContain("The Tide is Turning | Lemonade Stand 🍋");
  });

  it("falls back to the YouTube channel and watch pages when the RSS feed is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '{"metadata":{"lockupMetadataViewModel":{"title":{"content":"The News | Lemonade Stand"}}},"contentId":"oxu0mk4IXIA","contentType":"LOCKUP_CONTENT_TYPE_VIDEO"}'
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '"publishDate":"2026-07-29T12:00:30-07:00"'
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await lemonadeStandPodcastAdapter.fetchCurrentValue();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.value).toContain("Title: The News | Lemonade Stand");
    expect(result.value).toContain("Published: 2026-07-29T12:00:30-07:00");
    expect(result.value).toContain("Source: YouTube channel page fallback");
  });

  it("alerts only when the qualifying video URL changes", () => {
    const previous = "Title: Old title\nPublished: 1 day ago\nURL: https://www.youtube.com/watch?v=sameVideo01";
    const sameVideo = "Title: Old title\nPublished: 2 days ago\nURL: https://www.youtube.com/watch?v=sameVideo01";
    const newVideo = "Title: New title\nPublished: now\nURL: https://www.youtube.com/watch?v=newVideo002";

    expect(lemonadeStandPodcastAdapter.shouldAlertOnChange?.(previous, sameVideo)).toBe(false);
    expect(lemonadeStandPodcastAdapter.shouldAlertOnChange?.(previous, newVideo)).toBe(true);
  });

  it("builds a release-day plus next-day ET window from Lemonade market slugs", () => {
    expect(
      buildLemonadeQueueMarketFromUrl(
        "https://polymarket.com/event/what-will-be-said-on-the-next-lemonade-stand-podcast-june-17-20260611135654931",
        new Date("2026-06-17T12:00:00.000Z")
      )
    ).toMatchObject({
      slug: "what-will-be-said-on-the-next-lemonade-stand-podcast-june-17-20260611135654931",
      startAt: "2026-06-17T04:00:00.000Z",
      endAt: "2026-06-19T03:59:00.000Z"
    });
  });

  it("discovers and activates the current weekly Lemonade Stand Polymarket URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "what-will-be-said-on-the-next-lemonade-stand-podcast-june-10-20260604160436888",
              title: "What will be said on the next Lemonade Stand Podcast? (June 10)",
              active: true,
              closed: true
            },
            {
              slug: "what-will-be-said-on-the-next-lemonade-stand-podcast-june-17-20260611135654931",
              title: "What will be said on the next Lemonade Stand Podcast? (June 17)",
              active: true,
              closed: false,
              startDate: "2026-06-11T17:54:00Z",
              endDate: "2026-06-18T04:00:00Z"
            }
          ]
        })
      })
    );

    const result = await refreshLemonadePolymarketQueue(
      {
        settingsJson: null,
        polymarketUrl: "https://polymarket.com/event/what-will-be-said-on-the-next-lemonade-stand-podcast-june-3"
      } as Integration,
      new Date("2026-06-17T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      lastLemonadeDiscoveryAt?: string;
      polymarketMarkets?: Array<{ slug: string; startAt: string | null; endAt: string | null }>;
    };

    expect(settings.lastLemonadeDiscoveryAt).toBe("2026-06-17T12:00:00.000Z");
    expect(settings.polymarketMarkets).toEqual([
      expect.objectContaining({
        slug: "what-will-be-said-on-the-next-lemonade-stand-podcast-june-17-20260611135654931",
        startAt: "2026-06-11T17:54:00.000Z",
        endAt: "2026-06-18T04:00:00.000Z"
      })
    ]);
    expect(result.activeUrl).toBe(
      "https://polymarket.com/event/what-will-be-said-on-the-next-lemonade-stand-podcast-june-17-20260611135654931"
    );
  });
});
