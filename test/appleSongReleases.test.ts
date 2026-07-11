import { afterEach, describe, expect, it, vi } from "vitest";
import {
  artistAlbumReleasesAdapter,
  artistSongReleasesAdapter,
  formatSongReleaseValue,
  kpopSongReleasesAdapter,
  parseArtistFromQuestion,
  parseArtistReleaseMarketsFromPolymarket,
  shouldAlertOnSongReleaseChange
} from "../src/integrations/appleSongReleases.js";
import type { Integration } from "../src/integrations/types.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Apple song release adapters", () => {
  it("parses artist names from Polymarket questions", () => {
    expect(parseArtistFromQuestion("Will Taylor Swift release a new song in 2026?", "new song")).toBe("Taylor Swift");
    expect(parseArtistFromQuestion("Will NewJeans release a song in 2026?", "song")).toBe("NewJeans");
    expect(parseArtistFromQuestion("Will Frank Ocean release an album in 2026?", "album")).toBe("Frank Ocean");
  });

  it("parses only unresolved artist markets from Gamma", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            markets: [
              {
                question: "Will Drake release a new song in 2026?",
                slug: "will-drake-release-a-new-song-in-2026",
                active: true,
                closed: true,
                outcomePrices: "[\"1\", \"0\"]"
              },
              {
                question: "Will Taylor Swift release a new song in 2026?",
                slug: "will-taylor-swift-release-a-new-song-in-2026",
                active: true,
                closed: false,
                outcomePrices: "[\"0.605\", \"0.395\"]"
              }
            ]
          }
        ]
      })
    );

    await expect(
      parseArtistReleaseMarketsFromPolymarket(
        "https://polymarket.com/event/which-artists-will-release-a-new-song-in-2026",
        "new song"
      )
    ).resolves.toEqual([
      {
        artistName: "Taylor Swift",
        marketSlug: "will-taylor-swift-release-a-new-song-in-2026",
        question: "Will Taylor Swift release a new song in 2026?"
      }
    ]);
  });

  it("formats release IDs and detects only new song IDs", () => {
    const previous = formatSongReleaseValue(
      [
        {
          artistName: "Taylor Swift",
          trackName: "Existing Song",
          releaseDate: "2026-01-01T12:00:00Z",
          trackUrl: "https://music.apple.com/example-existing",
          trackId: 1
        }
      ],
      [],
      "https://polymarket.com/event/example",
      "2026-05-01T00:00:00.000Z"
    );
    const current = formatSongReleaseValue(
      [
        {
          artistName: "Taylor Swift",
          trackName: "Existing Song",
          releaseDate: "2026-01-01T12:00:00Z",
          trackUrl: "https://music.apple.com/example-existing",
          trackId: 1
        },
        {
          artistName: "Taylor Swift",
          trackName: "New Song",
          releaseDate: "2026-02-01T12:00:00Z",
          trackUrl: "https://music.apple.com/example-new",
          trackId: 2
        }
      ],
      [],
      "https://polymarket.com/event/example",
      "2026-05-01T00:00:00.000Z"
    );

    expect(shouldAlertOnSongReleaseChange(previous, current)).toBe(true);
    expect(shouldAlertOnSongReleaseChange(current, current)).toBe(false);
  });

  it("fetches Apple Music songs and filters DJ-mix catalog noise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            { wrapperType: "artist", artistName: "Taylor Swift" },
            {
              wrapperType: "track",
              kind: "song",
              artistId: 159260351,
              artistName: "Taylor Swift",
              collectionArtistName: "Taylor Swift",
              collectionName: "New Single",
              trackId: 2,
              trackName: "New Song",
              releaseDate: "2026-02-01T12:00:00Z",
              trackViewUrl: "https://music.apple.com/example-new"
            },
            {
              wrapperType: "track",
              kind: "song",
              artistId: 159260351,
              artistName: "Taylor Swift",
              collectionArtistName: "DJ Test",
              collectionName: "House Party (DJ Mix)",
              trackId: 3,
              trackName: "Old Song (Mixed)",
              releaseDate: "2026-03-01T12:00:00Z",
              trackViewUrl: "https://music.apple.com/example-mixed"
            }
          ]
        })
      })
    );

    const value = await artistSongReleasesAdapter.fetchCurrentValue({
      settingsJson: JSON.stringify({
        artistReleaseMarkets: [
          {
            artistName: "Taylor Swift",
            marketSlug: "will-taylor-swift-release-a-new-song-in-2026",
            question: "Will Taylor Swift release a new song in 2026?",
            artistId: 159260351
          }
        ],
        parsedFromUrl: "https://polymarket.com/event/which-artists-will-release-a-new-song-in-2026",
        lastParsedAt: "2026-05-01T00:00:00.000Z"
      }),
      polymarketUrl: "https://polymarket.com/event/which-artists-will-release-a-new-song-in-2026"
    } as Integration);

    expect(value.value).toContain("New Song");
    expect(value.value).not.toContain("Old Song (Mixed)");
  });

  it("fetches Apple Music albums and filters singles or EPs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            { wrapperType: "artist", artistName: "Frank Ocean" },
            {
              wrapperType: "collection",
              collectionType: "Album",
              artistId: 123,
              artistName: "Frank Ocean",
              collectionArtistName: "Frank Ocean",
              collectionId: 10,
              collectionName: "New Album",
              releaseDate: "2026-02-01T12:00:00Z",
              collectionViewUrl: "https://music.apple.com/example-album"
            },
            {
              wrapperType: "collection",
              collectionType: "Album",
              artistId: 123,
              artistName: "Frank Ocean",
              collectionArtistName: "Frank Ocean",
              collectionId: 11,
              collectionName: "Loose Track - Single",
              releaseDate: "2026-03-01T12:00:00Z",
              collectionViewUrl: "https://music.apple.com/example-single"
            }
          ]
        })
      })
    );

    const value = await artistAlbumReleasesAdapter.fetchCurrentValue({
      settingsJson: JSON.stringify({
        artistReleaseMarkets: [
          {
            artistName: "Frank Ocean",
            marketSlug: "will-frank-ocean-release-an-album-in-2026",
            question: "Will Frank Ocean release an album in 2026?",
            artistId: 123
          }
        ],
        parsedFromUrl: "https://polymarket.com/event/which-artists-will-release-new-albums-in-2026",
        lastParsedAt: "2026-05-01T00:00:00.000Z"
      }),
      polymarketUrl: "https://polymarket.com/event/which-artists-will-release-new-albums-in-2026"
    } as Integration);

    expect(value.value).toContain("Metric: Apple Music/iTunes 2026 album releases");
    expect(value.value).toContain("New Album");
    expect(value.value).not.toContain("Loose Track");
  });

  it("exposes a separate KPop adapter command", () => {
    expect(kpopSongReleasesAdapter.commandName).toBe("kpopreleases");
    expect(kpopSongReleasesAdapter.defaultPolymarketUrl).toBe(
      "https://polymarket.com/event/which-kpop-groups-will-release-songs-in-2026"
    );
  });

  it("exposes a separate album adapter command", () => {
    expect(artistAlbumReleasesAdapter.commandName).toBe("albumreleases");
    expect(artistAlbumReleasesAdapter.defaultPolymarketUrl).toBe(
      "https://polymarket.com/event/which-artists-will-release-new-albums-in-2026"
    );
  });
});
