import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractLatestMrBeastGamingVideo,
  extractLatestMrBeastGamingVideoValue,
  mrBeastGamingVideosAdapter
} from "../src/integrations/mrBeastGamingVideos.js";
import type { Integration } from "../src/integrations/types.js";

const sampleYoutubeFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>yt:video:abc123xyz</id>
    <yt:videoId>abc123xyz</yt:videoId>
    <title>We Built a Secret Gaming Room</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123xyz"/>
    <published>2026-06-16T01:02:03+00:00</published>
    <updated>2026-06-16T01:30:00+00:00</updated>
  </entry>
</feed>`;

describe("MrBeast Gaming Videos adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("extracts the latest video from the YouTube channel feed", () => {
    expect(extractLatestMrBeastGamingVideo(sampleYoutubeFeed)).toEqual({
      title: "We Built a Secret Gaming Room",
      publishedAt: "2026-06-16T01:02:03+00:00",
      url: "https://www.youtube.com/watch?v=abc123xyz",
      videoId: "abc123xyz"
    });
  });

  it("formats the latest video as a stable monitor value", () => {
    const value = extractLatestMrBeastGamingVideoValue(sampleYoutubeFeed);
    expect(value).toContain("Title: We Built a Secret Gaming Room");
    expect(value).toContain("Published: 2026-06-16T01:02:03+00:00");
    expect(value).toContain("URL: https://www.youtube.com/watch?v=abc123xyz");
    expect(value).toContain("Source: YouTube RSS");
  });

  it("throws when no latest video is present", () => {
    expect(() => extractLatestMrBeastGamingVideo("<feed></feed>")).toThrow(
      "Could not find the latest MrBeast Gaming video"
    );
  });

  it("polls the MrBeast Gaming YouTube RSS feed every minute", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => sampleYoutubeFeed
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await mrBeastGamingVideosAdapter.fetchCurrentValue();

    expect(mrBeastGamingVideosAdapter.getPollIntervalMinutes?.({} as Integration)).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://www.youtube.com/feeds/videos.xml?channel_id=UCIPPMRA040LQr5QPyJEbmXA"
    );
    expect(result.unit).toBe("latest YouTube upload");
    expect(result.value).toContain("URL: https://www.youtube.com/watch?v=abc123xyz");
  });

  it("reports YouTube feed HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => ""
      })
    );

    await expect(mrBeastGamingVideosAdapter.fetchCurrentValue()).rejects.toThrow(
      "MrBeast Gaming YouTube feed returned HTTP 503"
    );
  });
});
