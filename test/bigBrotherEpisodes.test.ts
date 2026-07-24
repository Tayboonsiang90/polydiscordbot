import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bigBrotherEpisodesAdapter,
  extractLatestBigBrotherEpisode,
  extractLatestBigBrotherEpisodeValue,
  shouldAlertOnBigBrotherChange
} from "../src/integrations/bigBrotherEpisodes.js";
import type { Integration } from "../src/integrations/types.js";

const sampleJsonLdHtml = `
<html>
  <body>
    <script type="application/ld+json">
      {
        "@context": "http://schema.org",
        "@type": "TVSeries",
        "name": "Big Brother",
        "containsSeason": {
          "@type": "TVSeason",
          "name": "Season 28",
          "episode": [
            {
              "@type": "TVEpisode",
              "episodeNumber": "6",
              "name": "Episode 6",
              "url": "https://www.cbs.com/shows/video/old/",
              "publication": [{"@type": "BroadcastEvent", "startDate": "2026-07-19T17:00:00-07:00"}]
            },
            {
              "@type": "TVEpisode",
              "episodeNumber": "7",
              "name": "Episode 7",
              "url": "https://www.cbs.com/shows/video/new/",
              "publication": [{"@type": "BroadcastEvent", "startDate": "2026-07-22T17:00:00-07:00"}]
            }
          ]
        }
      }
    </script>
  </body>
</html>`;

const sampleCardHtml = `
<section id="latest-episodes">
  <a href="/shows/video/new-card/" aa-link="Full Episodes||play|1|Big Brother|Episode 8|28|8|07/24/26|vod:full-episodes|CBS Studios|||t|0|Reality|new-card|||||||">
    <img alt="Big Brother - Episode 8">
  </a>
  <a href="/shows/video/old-card/" aa-link="Full Episodes||play|2|Big Brother|Episode 7|28|7|07/22/26|vod:full-episodes|CBS Studios|||t|0|Reality|old-card|||||||">
    <img alt="Big Brother - Episode 7">
  </a>
</section>`;

describe("Big Brother Episodes adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("extracts the latest episode from CBS JSON-LD", () => {
    expect(extractLatestBigBrotherEpisode(sampleJsonLdHtml)).toEqual({
      title: "Episode 7",
      season: "28",
      episode: "7",
      airDate: "2026-07-22",
      url: "https://www.cbs.com/shows/video/new/",
      source: "CBS JSON-LD"
    });
  });

  it("falls back to visible CBS episode cards", () => {
    expect(extractLatestBigBrotherEpisode(sampleCardHtml)).toEqual({
      title: "Episode 8",
      season: "28",
      episode: "8",
      airDate: "2026-07-24",
      url: "https://www.cbs.com/shows/video/new-card/",
      source: "CBS episode cards"
    });
  });

  it("formats a stable latest-episode monitor value", () => {
    const value = extractLatestBigBrotherEpisodeValue(sampleJsonLdHtml);

    expect(value).toContain("Metric: CBS Big Brother latest full episode");
    expect(value).toContain("Title: Episode 7");
    expect(value).toContain("Season: 28");
    expect(value).toContain("Episode: 7");
    expect(value).toContain("URL: https://www.cbs.com/shows/video/new/");
    expect(value).toContain("Source: CBS JSON-LD");
  });

  it("alerts only when the latest episode URL changes", () => {
    const previous = [
      "Title: Episode 7",
      "Air date: 2026-07-23",
      "URL: https://www.cbs.com/shows/video/new/",
      "Source: CBS JSON-LD"
    ].join("\n");
    const sameEpisodeCurrent = [
      "Title: Episode 7",
      "Air date: 2026-07-23",
      "URL: https://www.cbs.com/shows/video/new/",
      "Source: CBS episode cards"
    ].join("\n");
    const newEpisodeCurrent = sameEpisodeCurrent.replace("/new/", "/episode-8/");

    expect(shouldAlertOnBigBrotherChange(previous, sameEpisodeCurrent)).toBe(false);
    expect(shouldAlertOnBigBrotherChange(previous, newEpisodeCurrent)).toBe(true);
  });

  it("polls the CBS show page every minute", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => sampleJsonLdHtml
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await bigBrotherEpisodesAdapter.fetchCurrentValue();

    expect(bigBrotherEpisodesAdapter.getPollIntervalMinutes?.({} as Integration)).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://www.cbs.com/shows/big_brother/");
    expect(result.value).toContain("Episode 7");
  });
});
