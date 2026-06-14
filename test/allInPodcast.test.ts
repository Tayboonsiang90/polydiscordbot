import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allInPodcastAdapter,
  extractLatestAllInEpisode,
  extractLatestAllInEpisodeValue,
  extractLatestAllInYoutubeEpisode,
  extractLatestAllInYoutubeEpisodeValue,
  refreshAllInPolymarketQueue
} from "../src/integrations/allInPodcast.js";
import type { Integration } from "../src/integrations/types.js";

const sampleHtml = `
  <div>
    <a href="https://youtube.com/v/10MdOvK-aG4"><img alt=""></a>
    <div>[  5/8/2026  ]</div>
    <div><a href="https://youtube.com/v/10MdOvK-aG4">Episode #272</a></div>
    <div>The episode kicks off with a discussion...</div>
  </div>
`;

const sampleYoutubeFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>yt:video:gH4FTjDm9FQ</id>
    <yt:videoId>gH4FTjDm9FQ</yt:videoId>
    <title>Anthropic's Fable Backlash, Nationalizing AI, Inflation Heats Up &amp; California's Broken Elections</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=gH4FTjDm9FQ"/>
    <published>2026-06-13T05:10:15+00:00</published>
    <updated>2026-06-13T19:32:49+00:00</updated>
  </entry>
</feed>`;

describe("All-In Podcast adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("extracts the latest episode from allin.com", () => {
    expect(extractLatestAllInEpisode(sampleHtml)).toEqual({
      title: "Episode #272",
      date: "5/8/2026",
      url: "https://www.youtube.com/watch?v=10MdOvK-aG4",
      source: "allin.com"
    });
  });

  it("extracts the latest episode from the YouTube channel feed", () => {
    expect(extractLatestAllInYoutubeEpisode(sampleYoutubeFeed)).toEqual({
      title: "Anthropic's Fable Backlash, Nationalizing AI, Inflation Heats Up & California's Broken Elections",
      date: "2026-06-13T05:10:15+00:00",
      publishedAt: "2026-06-13T05:10:15+00:00",
      url: "https://www.youtube.com/watch?v=gH4FTjDm9FQ",
      source: "YouTube RSS"
    });
  });

  it("formats the latest episode as a stable monitor value", () => {
    const value = extractLatestAllInEpisodeValue(sampleHtml);
    expect(value).toContain("Title: Episode #272");
    expect(value).toContain("Date: 5/8/2026");
    expect(value).toContain("URL: https://www.youtube.com/watch?v=10MdOvK-aG4");
    expect(value).toContain("Source: allin.com");
  });

  it("formats YouTube feed episodes with the publish timestamp", () => {
    const value = extractLatestAllInYoutubeEpisodeValue(sampleYoutubeFeed);
    expect(value).toContain("Published: 2026-06-13T05:10:15+00:00");
    expect(value).toContain("Source: YouTube RSS");
  });

  it("throws when no latest episode is present", () => {
    expect(() => extractLatestAllInEpisode("<html></html>")).toThrow("Could not find the latest All-In episode");
  });

  it("polls YouTube RSS every minute before falling back to allin.com", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => sampleYoutubeFeed
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await allInPodcastAdapter.fetchCurrentValue();

    expect(allInPodcastAdapter.getPollIntervalMinutes?.({} as Integration)).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://www.youtube.com/feeds/videos.xml?channel_id=UCESLZhusAkFfsNsApnjF_Cg");
    expect(result.value).toContain("URL: https://www.youtube.com/watch?v=gH4FTjDm9FQ");
  });

  it("falls back to allin.com if the YouTube feed returns an error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "" })
      .mockResolvedValueOnce({ ok: true, text: async () => sampleHtml });
    vi.stubGlobal("fetch", fetchMock);

    const result = await allInPodcastAdapter.fetchCurrentValue();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://allin.com/episodes");
    expect(result.value).toContain("Source: allin.com");
  });

  it("falls back to allin.com if the YouTube feed request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("bad feed"))
      .mockResolvedValueOnce({ ok: true, text: async () => sampleHtml });
    vi.stubGlobal("fetch", fetchMock);

    const result = await allInPodcastAdapter.fetchCurrentValue();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.value).toContain("Source: allin.com");
  });

  it("discovers and activates the current weekly All-In Polymarket URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "what-will-be-said-on-the-next-all-in-podcast-may-22",
              title: "What will be said on the next All-In Podcast? (May 22)",
              active: true,
              closed: true
            },
            {
              slug: "what-will-be-said-on-the-next-all-in-podcast-may-29",
              title: "What will be said on the next All-In Podcast? (May 29)",
              active: true,
              closed: false
            }
          ]
        })
      })
    );

    const result = await refreshAllInPolymarketQueue(
      {
        settingsJson: null,
        polymarketUrl: "https://polymarket.com/event/what-will-be-said-on-the-next-all-in-podcast-may-8"
      } as Integration,
      new Date("2026-05-29T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      lastAllInDiscoveryAt?: string;
      polymarketMarkets?: Array<{ slug: string; startAt: string | null; endAt: string | null }>;
    };

    expect(settings.lastAllInDiscoveryAt).toBe("2026-05-29T12:00:00.000Z");
    expect(settings.polymarketMarkets).toEqual([
      expect.objectContaining({
        slug: "what-will-be-said-on-the-next-all-in-podcast-may-29",
        startAt: "2026-05-29T04:00:00.000Z",
        endAt: "2026-05-30T03:59:00.000Z"
      })
    ]);
    expect(result.activeUrl).toBe("https://polymarket.com/event/what-will-be-said-on-the-next-all-in-podcast-may-29");
  });
});
