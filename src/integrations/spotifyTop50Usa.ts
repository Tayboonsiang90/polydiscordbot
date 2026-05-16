import type { AdapterValue, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";

const sourceUrl = "https://open.spotify.com/playlist/37i9dQZEVXbLRQDuF5jeBp";
const playlistUri = "spotify:playlist:37i9dQZEVXbLRQDuF5jeBp";

type SpotifyInitialState = {
  entities?: {
    items?: Record<string, SpotifyPlaylist | undefined>;
  };
};

type SpotifyPlaylist = {
  content?: {
    items?: SpotifyPlaylistItem[];
  };
};

type SpotifyPlaylistItem = {
  itemV2?: {
    data?: SpotifyTrack;
  };
};

type SpotifyTrack = {
  name?: string;
  uri?: string;
  artists?: {
    items?: SpotifyArtist[];
  };
};

type SpotifyArtist = {
  profile?: {
    name?: string;
  };
  uri?: string;
};

export function extractSpotifyTop50UsaNumberOne(html: string): string {
  return extractSpotifyTop50NumberOne(html, playlistUri, "Spotify Top 50 - USA");
}

export function extractSpotifyTop50NumberOne(html: string, targetPlaylistUri: string, chartName: string): string {
  const initialState = extractInitialState(html);
  const track = initialState.entities?.items?.[targetPlaylistUri]?.content?.items?.[0]?.itemV2?.data;
  if (!track?.name) {
    throw new Error(`Could not find the #1 track in ${chartName}`);
  }

  const artists = track.artists?.items?.map((artist) => artist.profile?.name).filter(isNonEmptyString) ?? [];
  if (artists.length === 0) {
    throw new Error(`Could not find the #1 track primary artist in ${chartName}`);
  }

  return [`#1: ${track.name}`, `Primary artist(s): ${artists.join(", ")}`].join("\n");
}

export async function fetchSpotifyTop50Value(
  chartUrl: string,
  targetPlaylistUri: string,
  chartName: string,
  unit: string
): Promise<AdapterValue> {
  const response = await fetchWithTimeout(chartUrl, {
    headers: {
      "user-agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Spotify returned HTTP ${response.status}`);
  }

  const html = await response.text();
  const value = extractSpotifyTop50NumberOne(html, targetPlaylistUri, chartName);
  return {
    value,
    rawValue: value,
    unit,
    observedAt: new Date()
  };
}

export const spotifyTop50UsaAdapter: WebsiteAdapter = {
  id: "spotify-top-50-usa",
  commandName: "spotifyusa",
  displayName: "Spotify Top 50 USA",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/which-artists-will-have-1-hits-in-the-us-in-may",
  defaultChannelName: "spotifyusa",
  alertRoleName: "Spotify USA Top 50 Alerts",
  alertRoleEmoji: "\uD83C\uDFB5",
  async fetchCurrentValue(): Promise<AdapterValue> {
    return fetchSpotifyTop50Value(sourceUrl, playlistUri, "Spotify Top 50 - USA", "Spotify Top 50 - USA #1 track");
  }
};

function extractInitialState(html: string): SpotifyInitialState {
  const match = html.match(/<script id="initialState" type="text\/plain">([^<]+)<\/script>/);
  if (!match?.[1]) {
    throw new Error("Could not find Spotify initial state in playlist page");
  }

  return JSON.parse(Buffer.from(match[1], "base64").toString("utf8")) as SpotifyInitialState;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

