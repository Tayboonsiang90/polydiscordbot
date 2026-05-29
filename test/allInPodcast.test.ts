import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractLatestAllInEpisode,
  extractLatestAllInEpisodeValue,
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

describe("All-In Podcast adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("extracts the latest episode from allin.com", () => {
    expect(extractLatestAllInEpisode(sampleHtml)).toEqual({
      title: "Episode #272",
      date: "5/8/2026",
      url: "https://www.youtube.com/watch?v=10MdOvK-aG4"
    });
  });

  it("formats the latest episode as a stable monitor value", () => {
    const value = extractLatestAllInEpisodeValue(sampleHtml);
    expect(value).toContain("Title: Episode #272");
    expect(value).toContain("Date: 5/8/2026");
    expect(value).toContain("URL: https://www.youtube.com/watch?v=10MdOvK-aG4");
  });

  it("throws when no latest episode is present", () => {
    expect(() => extractLatestAllInEpisode("<html></html>")).toThrow("Could not find the latest All-In episode");
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
