import { describe, expect, it } from "vitest";
import { extractSpotifyTop50GlobalNumberOne } from "../src/integrations/spotifyTop50Global.js";
import { extractSpotifyTop50UsaNumberOne } from "../src/integrations/spotifyTop50Usa.js";

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
});

describe("Spotify Top 50 Global adapter", () => {
  it("extracts the #1 track and primary artist profiles", () => {
    const value = extractSpotifyTop50GlobalNumberOne(
      buildSpotifyHtml("spotify:playlist:37i9dQZEVXbMDoHDwVN2tF", "Global Song", ["Global Artist"])
    );

    expect(value).toBe("#1: Global Song\nPrimary artist(s): Global Artist");
  });
});
