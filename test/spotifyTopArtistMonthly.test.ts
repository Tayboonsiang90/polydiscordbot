import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSpotifyTopArtistSnapshot,
  extractKworbSpotifyMonthlyListenerArtists,
  formatSpotifyTopArtistValue,
  parseSpotifyTopArtistOutcomes,
  refreshSpotifyTopArtistMonthlySettings,
  spotifyTopArtistMonthlyAdapter
} from "../src/integrations/spotifyTopArtistMonthly.js";
import type { Integration } from "../src/integrations/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Spotify Top Artist Monthly adapter", () => {
  it("parses active listed artist outcomes and ignores placeholders", () => {
    const artists = parseSpotifyTopArtistOutcomes([
      { groupItemTitle: "Bruno Mars", active: true, closed: false, archived: false },
      { groupItemTitle: "Artist B", active: false, closed: false, archived: false },
      { groupItemTitle: "Other", active: false, closed: false, archived: false },
      { groupItemTitle: "Justin Bieber", active: true, closed: false, archived: false },
      { groupItemTitle: "Closed Artist", active: true, closed: true, archived: false }
    ]);

    expect(artists).toEqual(["Bruno Mars", "Justin Bieber"]);
  });

  it("parses Kworb monthly listener rows", () => {
    const rows = extractKworbSpotifyMonthlyListenerArtists(buildKworbListenersHtml());

    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      rank: 1,
      artist: "Bruno Mars",
      listeners: 131_916_723,
      dailyChange: -8_346,
      peak: 1,
      peakListeners: 151_079_821
    });
  });

  it("ranks tracked artists by listeners with alphabetical tie break", () => {
    const snapshot = buildSpotifyTopArtistSnapshot(
      extractKworbSpotifyMonthlyListenerArtists(buildKworbListenersHtml()),
      ["The Weeknd", "Bruno Mars", "Ariana Grande", "Missing Artist"],
      { year: 2026, month: 7 },
      "https://polymarket.com/event/top-artist-in-july-20260708185955937"
    );

    expect(snapshot.rankedArtists.map((artist) => artist.artist)).toEqual(["Bruno Mars", "Ariana Grande", "The Weeknd"]);
    expect(snapshot.missingArtists).toEqual([{ artist: "Missing Artist" }]);
  });

  it("formats a compact market-focused value", () => {
    const snapshot = buildSpotifyTopArtistSnapshot(
      extractKworbSpotifyMonthlyListenerArtists(buildKworbListenersHtml()),
      ["The Weeknd", "Bruno Mars", "Ariana Grande"],
      { year: 2026, month: 7 },
      "https://polymarket.com/event/top-artist-in-july-20260708185955937"
    );
    const value = formatSpotifyTopArtistValue(snapshot);

    expect(value).toContain("Market: 2026-07; check: 2026-07-31 12:00 ET");
    expect(value).toContain("Leader: Bruno Mars 131.9M (Kworb #1)");
    expect(value).toContain("2. Ariana Grande 113.4M (#4, +48.2K)");
    expect(value).toContain("Tie: exact tie resolves alphabetically");
  });

  it("compares tracked rankings for alert decisions", () => {
    const previous = [
      "Tracked artists:",
      "1. Bruno Mars - 131.9M (Kworb #1, daily -8.3K)",
      "2. Justin Bieber - 125.4M (Kworb #2, daily +133.6K)",
      "Missing tracked artists: none"
    ].join("\n");
    const current = [
      "Tracked artists:",
      "1. Justin Bieber - 132.0M (Kworb #1, daily +6.6M)",
      "2. Bruno Mars - 131.9M (Kworb #2, daily -8.3K)",
      "Missing tracked artists: none"
    ].join("\n");

    expect(spotifyTopArtistMonthlyAdapter.shouldAlertOnChange?.(previous, previous)).toBe(false);
    expect(spotifyTopArtistMonthlyAdapter.shouldAlertOnChange?.(previous, current)).toBe(true);
  });

  it("auto-discovers the active monthly Top Artist market and stores parsed artists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/public-search")) {
          return buildGammaSearchResponse();
        }
        if (url.includes("/events?slug=top-artist-in-july-20260708185955937")) {
          return buildGammaEventResponse();
        }

        return new Response("not found", { status: 404 });
      })
    );

    const settingsJson = await refreshSpotifyTopArtistMonthlySettings(
      {
        settingsJson: null,
        polymarketUrl: "https://polymarket.com/event/top-artist-in-june"
      } as Integration,
      new Date("2026-07-09T16:00:00.000Z"),
      { force: true }
    );
    const settings = JSON.parse(settingsJson) as {
      artists?: string[];
      polymarketMarkets?: Array<{ slug: string }>;
      parsedFromUrl?: string;
      year?: number;
      month?: number;
    };

    expect(settings.parsedFromUrl).toBe("https://polymarket.com/event/top-artist-in-july-20260708185955937");
    expect(settings.artists).toEqual(["Bruno Mars", "Justin Bieber"]);
    expect(settings.year).toBe(2026);
    expect(settings.month).toBe(7);
    expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual(["top-artist-in-july-20260708185955937"]);
  });
});

function buildKworbListenersHtml(): string {
  return `
    <html>
      <span class="pagetitle">Spotify top artists by monthly listeners</span>
      <table>
        <tr><th>#</th><th>Artist</th><th>Listeners</th><th>Daily +/-</th><th>Peak</th><th>PkListeners</th></tr>
        <tr><td>1</td><td>Bruno Mars</td><td>131,916,723</td><td>-8,346</td><td>1</td><td>151,079,821</td></tr>
        <tr><td>2</td><td>Justin Bieber</td><td>125,419,763</td><td>+133,552</td><td>1</td><td>146,972,758</td></tr>
        <tr><td>3</td><td>The Weeknd</td><td>113,436,438</td><td>48,195</td><td>1</td><td>126,192,069</td></tr>
        <tr><td>4</td><td>Ariana Grande</td><td>113,436,438</td><td>48,195</td><td>1</td><td>126,192,069</td></tr>
      </table>
    </html>`;
}

function buildGammaSearchResponse(): Response {
  return new Response(
    JSON.stringify({
      events: [
        {
          slug: "top-artist-in-july-20260708185955937",
          title: "Top artist in July?",
          active: true,
          closed: false,
          tags: [{ slug: "music" }, { slug: "spotify" }]
        }
      ]
    })
  );
}

function buildGammaEventResponse(): Response {
  return new Response(
    JSON.stringify([
      {
        markets: [
          { groupItemTitle: "Bruno Mars", active: true, closed: false, archived: false },
          { groupItemTitle: "Justin Bieber", active: true, closed: false, archived: false },
          { groupItemTitle: "Artist B", active: false, closed: false, archived: false }
        ]
      }
    ])
  );
}
