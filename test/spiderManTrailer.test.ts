import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractSpiderManTrailerVideos,
  fetchSpiderManTrailerUpdates,
  isQualifyingSpiderManTrailerTitle,
  spiderManTrailerAdapter
} from "../src/integrations/spiderManTrailer.js";
import type { Integration } from "../src/integrations/types.js";

const spiderFeed = {
  channelName: "Spider-Man",
  channelUrl: "https://www.youtube.com/@spiderman/videos",
  feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCP8AC-LXl5Jmp64IRIsdacg"
};

const qualifyingFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>tickets</yt:videoId>
    <title>SPIDER-MAN: BRAND NEW DAY - Tickets on Sale in One Week</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=tickets"/>
    <published>2026-06-13T17:00:00+00:00</published>
  </entry>
  <entry>
    <yt:videoId>trailer1</yt:videoId>
    <title>SPIDER-MAN: BRAND NEW DAY - Official Trailer (HD)</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=trailer1"/>
    <published>2026-06-13T16:00:00+00:00</published>
  </entry>
  <entry>
    <yt:videoId>oldtrailer</yt:videoId>
    <title>SPIDER-MAN: BRAND NEW DAY - Official Trailer (HD)</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=oldtrailer"/>
    <published>2026-03-18T16:00:00+00:00</published>
  </entry>
</feed>`;

const emptyFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>unrelated</yt:videoId>
    <title>Marvel Animation's X-Men '97 Season 2 | Roll Call</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=unrelated"/>
    <published>2026-06-13T16:00:00+00:00</published>
  </entry>
</feed>`;

describe("Spider-Man trailer adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("parses YouTube RSS entries into trailer videos", () => {
    expect(extractSpiderManTrailerVideos(qualifyingFeed, spiderFeed)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "trailer1",
          title: "SPIDER-MAN: BRAND NEW DAY - Official Trailer (HD)",
          url: "https://www.youtube.com/watch?v=trailer1",
          channelName: "Spider-Man"
        })
      ])
    );
  });

  it("qualifies Brand New Day trailer titles and rejects non-trailers", () => {
    expect(isQualifyingSpiderManTrailerTitle("SPIDER-MAN: BRAND NEW DAY - Official Trailer (HD)")).toBe(true);
    expect(isQualifyingSpiderManTrailerTitle("SPIDER MAN: BRAND NEW DAY - Official Teaser")).toBe(true);
    expect(isQualifyingSpiderManTrailerTitle("SPIDER-MAN: BRAND NEW DAY - Tickets on Sale in One Week")).toBe(false);
    expect(isQualifyingSpiderManTrailerTitle("SPIDER-MAN: BRAND NEW DAY - Practical Production")).toBe(false);
    expect(isQualifyingSpiderManTrailerTitle("THE SOCIAL RECKONING - Official Teaser Trailer")).toBe(false);
  });

  it("fetches all official feeds and returns only post-market qualifying trailer events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          text: async () => (url.includes("UCP8AC-LXl5Jmp64IRIsdacg") ? qualifyingFeed : emptyFeed)
        })
      )
    );

    const result = await fetchSpiderManTrailerUpdates({
      polymarketUrl: "https://polymarket.com/event/what-will-be-said-in-the-next-spider-man-trailer-20260612155048566"
    } as Integration);

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      id: "trailer1",
      alertTitle: "Spider-Man trailer detected",
      mentionAlertRole: true,
      polymarketUrl: "https://polymarket.com/event/what-will-be-said-in-the-next-spider-man-trailer-20260612155048566"
    });
    expect(result.checkFields?.find((field) => field.name === "Qualifying trailers")?.value).toBe("1");
  });

  it("returns a no-trailer check result when no qualifying trailer is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => emptyFeed
      })
    );

    const result = await fetchSpiderManTrailerUpdates();

    expect(result.posts).toEqual([]);
    expect(result.checkFields?.find((field) => field.name === "Latest qualifying trailer")?.value).toContain(
      "No qualifying Spider-Man: Brand New Day trailer found"
    );
  });

  it("polls every minute", () => {
    expect(spiderManTrailerAdapter.getPollIntervalMinutes?.({} as Integration)).toBe(1);
  });
});
