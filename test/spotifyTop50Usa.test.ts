import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractSpotifyTop50GlobalNumberOne,
  refreshSpotifyTop50GlobalPolymarketQueue
} from "../src/integrations/spotifyTop50Global.js";
import {
  extractKworbSpotifyDailyChartTop10,
  extractSpotifyTop50UsaNumberOne,
  fetchSpotifyTop50Value,
  formatKworbSpotifyDailyChartValue,
  normalizeSpotifyRankMarket,
  refreshSpotifyTop50UsaPolymarketQueue
} from "../src/integrations/spotifyTop50Usa.js";
import type { Integration } from "../src/integrations/types.js";

function buildSpotifyHtml(playlistUri: string, trackName: string, artistNames: string[]): string {
  const initialState = {
    entities: {
      items: {
        [playlistUri]: {
          content: {
            items: [
              {
                itemV2: {
                  data: {
                    name: trackName,
                    artists: {
                      items: artistNames.map((name) => ({ profile: { name } }))
                    }
                  }
                }
              }
            ]
          }
        }
      }
    }
  };
  const encodedState = Buffer.from(JSON.stringify(initialState), "utf8").toString("base64");
  return `<html><script id="initialState" type="text/plain">${encodedState}</script></html>`;
}

function buildKworbHtml(country: string = "United States"): string {
  const rows = [
    ["1", "+3", "Malcolm Todd", "Earrings", "177", "1", "(x1)", "1,751,197", "+695,401", "8,555,787", "+498,467", "137,765,212"],
    ["2", "-1", "Alex Warren", "Ordinary", "147", "1", "(x5)", "1,466,912", "-9,182", "10,480,667", "-151,069", "203,592,217"],
    ["3", "-1", "Sabrina Carpenter", "Manchild", "24", "1", "(x4)", "1,437,509", "-5,099", "11,908,759", "-1,020,540", "48,994,360"],
    ["4", "-1", "Morgan Wallen", "What I Want", "46", "1", "(x1)", "1,236,397", "-77,357", "8,932,027", "-90,809", "72,853,659"],
    ["5", "+1", "Ravyn Lenae", "Love Me Not", "114", "5", "", "1,070,609", "+11,382", "7,231,115", "+105,801", "89,814,192"],
    ["6", "-1", "Lady Gaga", "Die With A Smile", "318", "1", "(x15)", "1,031,384", "-42,013", "7,612,009", "-155,899", "502,392,223"],
    ["7", "=", "Drake", "NOKIA", "91", "2", "", "972,450", "+2,019", "6,872,401", "+40,132", "144,992,332"],
    ["8", "+2", "Tate McRae", "Sports car", "156", "6", "", "901,332", "+25,871", "6,151,100", "+76,102", "122,418,900"],
    ["9", "-1", "Kendrick Lamar", "luther", "215", "1", "(x10)", "884,001", "-7,412", "6,062,222", "-45,011", "310,000,001"],
    ["10", "=", "Doechii", "Anxiety", "122", "4", "", "802,441", "+1,002", "5,778,921", "+28,111", "94,721,555"]
  ];

  const tableRows = rows
    .map(
      ([position, movement, artist, title, days, peak, peakCount, streams, streamsChange, sevenDay, sevenDayChange, total]) => `
        <tr>
          <td>${position}</td><td>${movement}</td>
          <td><a href="/artist">${artist}</a> - <a href="/track">${title}</a></td>
          <td>${days}</td><td>${peak}</td><td>${peakCount}</td><td>${streams}</td><td>${streamsChange}</td>
          <td>${sevenDay}</td><td>${sevenDayChange}</td><td>${total}</td>
        </tr>`
    )
    .join("");

  return `
    <html>
      <span class="pagetitle">Spotify Daily Chart - ${country} - 2026/06/29 | <a href="us_daily_totals.html">Totals</a></span>
      <table id="spotifydaily"><tbody>${tableRows}</tbody></table>
    </html>`;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Spotify Top 50 USA adapter", () => {
  it("extracts Kworb's daily chart date and top 10 details", () => {
    const chart = extractKworbSpotifyDailyChartTop10(
      buildKworbHtml(),
      "Spotify Top 50 - USA",
      "https://open.spotify.com/playlist/37i9dQZEVXbLRQDuF5jeBp",
      "https://kworb.net/spotify/country/us_daily.html"
    );

    expect(chart.chartDate).toBe("2026/06/29");
    expect(chart.tracks).toHaveLength(10);
    expect(chart.tracks[0]).toMatchObject({
      position: 1,
      movement: "+3",
      artist: "Malcolm Todd",
      title: "Earrings",
      days: "177",
      streams: "1,751,197"
    });
  });

  it("formats Kworb top 10 values with chart date, days, streams, and links", () => {
    const chart = extractKworbSpotifyDailyChartTop10(
      buildKworbHtml(),
      "Spotify Top 50 - USA",
      "https://open.spotify.com/playlist/37i9dQZEVXbLRQDuF5jeBp",
      "https://kworb.net/spotify/country/us_daily.html"
    );

    const value = formatKworbSpotifyDailyChartValue(chart);

    expect(value).toContain("Chart date: 2026/06/29 (Kworb daily chart)");
    expect(value).toContain("#1 +3 Malcolm Todd - Earrings — 1,751,197 streams, 177d, peak #1 (x1)");
    expect(value).toContain("Spotify playlist: https://open.spotify.com/playlist/37i9dQZEVXbLRQDuF5jeBp");
    expect(value).toContain("Kworb details: https://kworb.net/spotify/country/us_daily.html");
  });

  it("extracts the #1 track and primary artist profiles", () => {
    const value = extractSpotifyTop50UsaNumberOne(
      buildSpotifyHtml("spotify:playlist:37i9dQZEVXbLRQDuF5jeBp", "Test Song", ["Primary Artist", "Second Artist"])
    );

    expect(value).toBe("#1: Test Song\nPrimary artist(s): Primary Artist, Second Artist");
  });

  it("throws when the playlist state is missing", () => {
    expect(() => extractSpotifyTop50UsaNumberOne("<html></html>")).toThrow("Could not find Spotify initial state");
  });

  it("throws when the #1 track has no artist profile", () => {
    expect(() =>
      extractSpotifyTop50UsaNumberOne(buildSpotifyHtml("spotify:playlist:37i9dQZEVXbLRQDuF5jeBp", "Test Song", []))
    ).toThrow(
      "Could not find the #1 track primary artist"
    );
  });

  it("retries transient Spotify failures before returning a value", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("gateway timeout", { status: 504 }))
      .mockResolvedValueOnce(new Response(buildSpotifyHtml("spotify:playlist:other", "Wrong", ["Wrong Artist"])))
      .mockResolvedValueOnce(
        new Response(buildSpotifyHtml("spotify:playlist:37i9dQZEVXbLRQDuF5jeBp", "Recovered Song", ["Recovered Artist"]))
      );
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchSpotifyTop50Value(
      "https://open.spotify.com/playlist/37i9dQZEVXbLRQDuF5jeBp",
      "spotify:playlist:37i9dQZEVXbLRQDuF5jeBp",
      "Spotify Top 50 - USA",
      "Spotify Top 50 - USA #1 track"
    );
    const expectation = expect(promise).resolves.toMatchObject({
      value: "#1: Recovered Song\nPrimary artist(s): Recovered Artist"
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(3_000);

    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns a stable error after repeated transient Spotify failures", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("gateway timeout", { status: 504 })));

    const promise = fetchSpotifyTop50Value(
      "https://open.spotify.com/playlist/37i9dQZEVXbLRQDuF5jeBp",
      "spotify:playlist:37i9dQZEVXbLRQDuF5jeBp",
      "Spotify Top 50 - USA",
      "Spotify Top 50 - USA #1 track"
    );
    const expectation = expect(promise).rejects.toThrow("Spotify Top 50 - USA temporarily unavailable after 3 attempt(s)");
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(3_000);

    await expectation;
  });

  it("auto-discovers the active monthly USA artists market", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(buildGammaSearchResponse()));

    const result = await refreshSpotifyTop50UsaPolymarketQueue(
      {
        settingsJson: null,
        polymarketUrl: "https://polymarket.com/event/which-artists-will-have-1-hits-in-the-us-in-may"
      } as Integration,
      new Date("2026-06-02T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      polymarketMarkets?: Array<{ slug: string; startAt: string; endAt: string }>;
    };

    expect(result.activeUrl).toBe("https://polymarket.com/event/which-artists-will-have-1-hits-in-the-us-in-june");
    expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual([
      "which-artists-will-have-1-hits-in-the-us-in-june"
    ]);
  });

  it("recognizes current weekly USA #1 and #2 song markets", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    expect(
      normalizeSpotifyRankMarket(
        {
          slug: "1-song-in-the-us-this-week-july-31-2026",
          title: "#1 song in the US this week?",
          active: true,
          closed: false,
          startDate: "2026-07-30T00:00:00.000Z",
          endDate: "2026-08-06T00:00:00.000Z"
        },
        "usa",
        now
      )
    ).toMatchObject({
      slug: "1-song-in-the-us-this-week-july-31-2026",
      endAt: "2026-08-06T00:00:00.000Z"
    });
    expect(
      normalizeSpotifyRankMarket(
        {
          slug: "1-song-this-week-july-31-2026",
          title: "#1 global song this week?",
          active: true,
          closed: false,
          endDate: "2026-08-06T00:00:00.000Z"
        },
        "usa",
        now
      )
    ).toBeNull();
  });
});

describe("Spotify Top 50 Global adapter", () => {
  it("extracts the #1 track and primary artist profiles", () => {
    const value = extractSpotifyTop50GlobalNumberOne(
      buildSpotifyHtml("spotify:playlist:37i9dQZEVXbMDoHDwVN2tF", "Global Song", ["Global Artist"])
    );

    expect(value).toBe("#1: Global Song\nPrimary artist(s): Global Artist");
  });

  it("auto-discovers the active monthly global artists market without taking the USA market", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(buildGammaSearchResponse()));

    const result = await refreshSpotifyTop50GlobalPolymarketQueue(
      {
        settingsJson: null,
        polymarketUrl: "https://polymarket.com/event/which-artists-will-have-1-hits-in-may"
      } as Integration,
      new Date("2026-06-02T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      polymarketMarkets?: Array<{ slug: string; startAt: string; endAt: string }>;
    };

    expect(result.activeUrl).toBe("https://polymarket.com/event/which-artists-will-have-1-hits-in-june");
    expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual(["which-artists-will-have-1-hits-in-june"]);
  });

  it("recognizes current weekly global #1 and #2 song markets", () => {
    expect(
      normalizeSpotifyRankMarket(
        {
          slug: "2-song-this-week-july-31-2026",
          title: "#2 global song this week?",
          active: true,
          closed: false,
          endDate: "2026-08-06T00:00:00.000Z"
        },
        "global",
        new Date("2026-07-30T12:00:00.000Z")
      )
    ).toMatchObject({
      slug: "2-song-this-week-july-31-2026",
      endAt: "2026-08-06T00:00:00.000Z"
    });
  });
});

function buildGammaSearchResponse(): Response {
  return new Response(
    JSON.stringify({
      events: [
        {
          slug: "which-artists-will-have-1-hits-in-the-us-in-june",
          title: "Which artists will have #1 hits in the US in June?",
          active: true,
          closed: false,
          tags: [{ slug: "spotify" }, { slug: "music" }]
        },
        {
          slug: "which-artists-will-have-1-hits-in-june",
          title: "Which artists will have #1 hits in June?",
          active: true,
          closed: false,
          tags: [{ slug: "spotify" }, { slug: "music" }]
        }
      ]
    })
  );
}
