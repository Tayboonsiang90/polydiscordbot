import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildJoeRoganQueueMarketFromUrl,
  extractLatestJoeRoganEpisode,
  extractLatestJoeRoganEpisodeValue,
  joeRoganPodcastAdapter,
  refreshJoeRoganPolymarketQueue
} from "../src/integrations/joeRoganPodcast.js";
import type { Integration } from "../src/integrations/types.js";

const sampleYoutubeFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>clip1</yt:videoId>
    <title>PowerfulJRE Clip - Not the episode</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=clip1"/>
    <published>2026-06-16T15:00:00+00:00</published>
  </entry>
  <entry>
    <yt:videoId>episode1</yt:videoId>
    <title>Joe Rogan Experience #2514 - Cameron Hanes</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=episode1"/>
    <published>2026-06-16T14:00:00+00:00</published>
  </entry>
</feed>`;

const olderMmaFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>Ag7GEsPQhFo</yt:videoId>
    <title>JRE MMA Show #181 with Justin Gaethje &amp; Trevor Wittman</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=Ag7GEsPQhFo"/>
    <published>2026-06-20T17:00:09+00:00</published>
  </entry>
</feed>`;

const newerTaylorSheridanValue = [
  "Title: Joe Rogan Experience #2517 - Taylor Sheridan",
  "Published: 2026-06-23T17:00:28+00:00",
  "URL: https://www.youtube.com/watch?v=uYO2fJ-M_M4",
  "Source: YouTube RSS"
].join("\n");

describe("Joe Rogan Podcast adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("extracts the latest Joe Rogan Experience episode from the YouTube feed", () => {
    expect(extractLatestJoeRoganEpisode(sampleYoutubeFeed)).toEqual({
      title: "Joe Rogan Experience #2514 - Cameron Hanes",
      publishedAt: "2026-06-16T14:00:00+00:00",
      url: "https://www.youtube.com/watch?v=episode1"
    });
  });

  it("formats the latest episode as a stable monitor value", () => {
    const value = extractLatestJoeRoganEpisodeValue(sampleYoutubeFeed);

    expect(value).toContain("Title: Joe Rogan Experience #2514 - Cameron Hanes");
    expect(value).toContain("Published: 2026-06-16T14:00:00+00:00");
    expect(value).toContain("URL: https://www.youtube.com/watch?v=episode1");
    expect(value).toContain("Source: YouTube RSS");
  });

  it("throws when no Joe Rogan Experience episode is present", () => {
    expect(() => extractLatestJoeRoganEpisode("<feed></feed>")).toThrow(
      "Could not find the latest Joe Rogan Experience episode"
    );
  });

  it("polls the YouTube RSS feed every minute", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => sampleYoutubeFeed
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await joeRoganPodcastAdapter.fetchCurrentValue();

    expect(joeRoganPodcastAdapter.getPollIntervalMinutes?.({} as Integration)).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://www.youtube.com/feeds/videos.xml?channel_id=UCzQUP1qoWDoEbmsQxvdjxgQ");
    expect(result.value).toContain("Joe Rogan Experience #2514 - Cameron Hanes");
  });

  it("keeps the previous episode when YouTube RSS serves an older cached episode", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => olderMmaFeed
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await joeRoganPodcastAdapter.fetchCurrentValue({ lastValue: newerTaylorSheridanValue } as Integration);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.value).toBe(newerTaylorSheridanValue);
  });

  it("builds a full-week ET window from Joe Rogan weekly market slugs", () => {
    expect(
      buildJoeRoganQueueMarketFromUrl(
        "https://polymarket.com/event/what-will-be-said-on-the-first-joe-rogan-experience-episode-of-the-week-june-15-20260611144821382",
        new Date("2026-06-16T12:00:00.000Z")
      )
    ).toMatchObject({
      slug: "what-will-be-said-on-the-first-joe-rogan-experience-episode-of-the-week-june-15-20260611144821382",
      startAt: "2026-06-15T04:00:00.000Z",
      endAt: "2026-06-22T03:59:00.000Z"
    });
  });

  it("discovers and activates the current weekly Joe Rogan Polymarket URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "what-will-be-said-on-the-first-joe-rogan-experience-episode-of-the-week-june-8",
              title: "What will be said on the first Joe Rogan Experience episode of the week June 8?",
              active: true,
              closed: true
            },
            {
              slug: "what-will-be-said-on-the-first-joe-rogan-experience-episode-of-the-week-june-15-20260611144821382",
              title: "What will be said on the first Joe Rogan Experience episode of the week June 15?",
              active: true,
              closed: false
            }
          ]
        })
      })
    );

    const result = await refreshJoeRoganPolymarketQueue(
      {
        settingsJson: null,
        polymarketUrl: "https://polymarket.com/event/what-will-be-said-on-the-first-joe-rogan-experience-episode-of-the-week-may-25"
      } as Integration,
      new Date("2026-06-16T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      lastJoeRoganDiscoveryAt?: string;
      polymarketMarkets?: Array<{ slug: string; startAt: string | null; endAt: string | null }>;
    };

    expect(settings.lastJoeRoganDiscoveryAt).toBe("2026-06-16T12:00:00.000Z");
    expect(settings.polymarketMarkets).toEqual([
      expect.objectContaining({
        slug: "what-will-be-said-on-the-first-joe-rogan-experience-episode-of-the-week-june-15-20260611144821382",
        startAt: "2026-06-15T04:00:00.000Z",
        endAt: "2026-06-22T03:59:00.000Z"
      })
    ]);
    expect(result.activeUrl).toBe(
      "https://polymarket.com/event/what-will-be-said-on-the-first-joe-rogan-experience-episode-of-the-week-june-15-20260611144821382"
    );
  });
});
