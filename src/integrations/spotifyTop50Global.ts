import { extractSpotifyTop50NumberOne, fetchSpotifyTop50Value } from "./spotifyTop50Usa.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF";
const playlistUri = "spotify:playlist:37i9dQZEVXbMDoHDwVN2tF";

export function extractSpotifyTop50GlobalNumberOne(html: string): string {
  return extractSpotifyTop50NumberOne(html, playlistUri, "Spotify Top 50 - Global");
}

export const spotifyTop50GlobalAdapter: WebsiteAdapter = {
  id: "spotify-top-50-global",
  commandName: "spotifyglobal",
  displayName: "Spotify Top 50 Global",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/which-artists-will-have-1-hits-in-may",
  defaultChannelName: "spotifyglobal",
  alertRoleName: "Spotify Global Top 50 Alerts",
  alertRoleEmoji: "\uD83C\uDFB5",
  async fetchCurrentValue(): Promise<AdapterValue> {
    return fetchSpotifyTop50Value(sourceUrl, playlistUri, "Spotify Top 50 - Global", "Spotify Top 50 - Global #1 track");
  }
};
