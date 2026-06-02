import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractSpotifyTop50GlobalNumberOne,
  refreshSpotifyTop50GlobalPolymarketQueue
} from "../src/integrations/spotifyTop50Global.js";
import {
  extractSpotifyTop50UsaNumberOne,
  fetchSpotifyTop50Value,
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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Spotify Top 50 USA adapter", () => {
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
