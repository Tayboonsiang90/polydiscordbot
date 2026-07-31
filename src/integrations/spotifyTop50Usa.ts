import type { AdapterValue, WebsiteAdapter } from "./types.js";
import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { resolveIntegrationPolymarketQueue, type PolymarketQueueMarket } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import { refreshMonthlyPolymarketQueue, type MonthlyPolymarketDiscoveryConfig } from "./monthlyPolymarketDiscovery.js";
import type { Integration } from "./types.js";

const sourceUrl = "https://open.spotify.com/playlist/37i9dQZEVXbLRQDuF5jeBp";
const kworbUsDailyUrl = "https://kworb.net/spotify/country/us_daily.html";
const playlistUri = "spotify:playlist:37i9dQZEVXbLRQDuF5jeBp";
const spotifyFetchAttempts = 3;
const spotifyRetryDelaysMs = [1_000, 3_000];
const spotifyRankMarketDiscoveryIntervalMs = 30 * 60_000;
const gammaSpotifyEventsUrl =
  "https://gamma-api.polymarket.com/events?tag_slug=spotify&active=true&closed=false&limit=100&order=id&ascending=false";
const usaMonthlyDiscoveryConfig: MonthlyPolymarketDiscoveryConfig = {
  searchQuery: "which artists will have 1 hits",
  slugPrefix: "which-artists-will-have-1-hits-in-the-us-in-",
  titlePrefix: "Which artists will have #1 hits in the US in",
  lastDiscoveryAtKey: "lastSpotifyUsaMarketDiscoveryAt",
  requiredTagSlugs: ["spotify"]
};

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

type SpotifyRankMarketScope = "usa" | "global";

type GammaSpotifyEvent = {
  slug?: unknown;
  title?: unknown;
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
  startDate?: unknown;
  creationDate?: unknown;
  createdAt?: unknown;
  endDate?: unknown;
};

export type KworbSpotifyDailyChart = {
  chartName: string;
  chartDate: string;
  spotifyUrl: string;
  kworbUrl: string;
  tracks: KworbSpotifyChartTrack[];
};

export type KworbSpotifyChartTrack = {
  position: number;
  movement: string;
  artist: string;
  title: string;
  artistAndTitle: string;
  days: string;
  peak: string;
  peakCount: string;
  streams: string;
  streamsChange: string;
  sevenDayStreams: string;
  sevenDayStreamsChange: string;
  totalStreams: string;
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
  for (let attempt = 1; attempt <= spotifyFetchAttempts; attempt += 1) {
    try {
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
    } catch (error) {
      if (attempt === spotifyFetchAttempts || !isRetryableSpotifyError(error)) {
        throw new Error(`${chartName} temporarily unavailable after ${attempt} attempt(s)`);
      }

      await delay(spotifyRetryDelaysMs[attempt - 1] ?? 1_000);
    }
  }

  throw new Error(`${chartName} temporarily unavailable after ${spotifyFetchAttempts} attempt(s)`);
}

export async function fetchKworbSpotifyTop10Value(
  kworbUrl: string,
  spotifyUrl: string,
  chartName: string,
  unit: string
): Promise<AdapterValue> {
  const response = await fetchWithTimeout(kworbUrl, {
    headers: {
      "user-agent": "Mozilla/5.0"
    }
  });
  if (!response.ok) {
    throw new Error(`Kworb returned HTTP ${response.status}`);
  }

  const html = await response.text();
  const chart = extractKworbSpotifyDailyChartTop10(html, chartName, spotifyUrl, kworbUrl);
  const value = formatKworbSpotifyDailyChartValue(chart);
  return {
    value,
    rawValue: JSON.stringify(chart),
    unit,
    observedAt: new Date()
  };
}

export function extractKworbSpotifyDailyChartTop10(
  html: string,
  chartName: string,
  spotifyUrl: string,
  kworbUrl: string
): KworbSpotifyDailyChart {
  const $ = cheerio.load(html);
  const pageTitle = normalizeText($(".pagetitle").first().text());
  const chartDate = pageTitle.match(/-\s*(\d{4}\/\d{2}\/\d{2})(?:\s*\||$)/)?.[1];
  if (!chartDate) {
    throw new Error(`Could not find Kworb chart date for ${chartName}`);
  }

  const tracks: KworbSpotifyChartTrack[] = [];
  $("#spotifydaily tbody tr")
    .slice(0, 10)
    .each((_, row) => {
      const cells = $(row).find("td");
      const artistTitleCell = cells.eq(2);
      const links = artistTitleCell.find("a");
      const artist = normalizeText(links.eq(0).text());
      const title = normalizeText(links.eq(1).text());
      const artistAndTitle = normalizeText(artistTitleCell.text()) || [artist, title].filter(Boolean).join(" - ");

      tracks.push({
        position: Number.parseInt(normalizeText(cells.eq(0).text()), 10),
        movement: normalizeText(cells.eq(1).text()),
        artist,
        title,
        artistAndTitle,
        days: normalizeText(cells.eq(3).text()),
        peak: normalizeText(cells.eq(4).text()),
        peakCount: normalizeText(cells.eq(5).text()),
        streams: normalizeText(cells.eq(6).text()),
        streamsChange: normalizeText(cells.eq(7).text()),
        sevenDayStreams: normalizeText(cells.eq(8).text()),
        sevenDayStreamsChange: normalizeText(cells.eq(9).text()),
        totalStreams: normalizeText(cells.eq(10).text())
      });
    });

  if (tracks.length < 10 || tracks.some((track) => !Number.isInteger(track.position) || !track.artistAndTitle)) {
    throw new Error(`Could not parse Kworb top 10 rows for ${chartName}`);
  }

  return {
    chartName,
    chartDate,
    spotifyUrl,
    kworbUrl,
    tracks
  };
}

export function formatKworbSpotifyDailyChartValue(chart: KworbSpotifyDailyChart): string {
  const rows = chart.tracks.map((track) => {
    const movement = track.movement ? ` ${track.movement}` : "";
    const peak = track.peak ? `, peak #${track.peak}${track.peakCount ? ` ${track.peakCount}` : ""}` : "";
    const days = track.days ? `, ${track.days}d` : "";
    const streams = track.streams ? `${track.streams} streams` : "streams n/a";
    return `#${track.position}${movement} ${track.artistAndTitle} — ${streams}${days}${peak}`;
  });

  return [
    `Metric: ${chart.chartName} daily top 10`,
    `Chart date: ${chart.chartDate} (Kworb daily chart)`,
    "Top 10:",
    ...rows,
    `Spotify playlist: ${chart.spotifyUrl}`,
    `Kworb details: ${chart.kworbUrl}`
  ].join("\n");
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
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshSpotifyTop50UsaPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  getPollIntervalMinutes(): number {
    return 60;
  },
  getPollIntervalReason(): string {
    return "Kworb Spotify daily charts update once per day, so hourly polling is enough.";
  },
  async fetchCurrentValue(): Promise<AdapterValue> {
    return fetchKworbSpotifyTop10Value(
      kworbUsDailyUrl,
      sourceUrl,
      "Spotify Top 50 - USA",
      "Spotify Top 50 - USA daily top 10"
    );
  }
};

export async function refreshSpotifyTop50UsaPolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  const monthly = await refreshMonthlyPolymarketQueue(integration, usaMonthlyDiscoveryConfig, now);
  return refreshSpotifyRankPolymarketQueue(
    {
      ...integration,
      settingsJson: monthly.settingsJson,
      polymarketUrl: monthly.activeUrl ?? integration.polymarketUrl
    },
    "usa",
    now
  );
}

export async function refreshSpotifyRankPolymarketQueue(
  integration: Integration,
  scope: SpotifyRankMarketScope,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  const settings = parseSettingsJson(integration.settingsJson);
  const discoveryKey = `lastSpotify${scope === "usa" ? "Usa" : "Global"}RankMarketDiscoveryAt`;
  const lastDiscoveryAt = typeof settings[discoveryKey] === "string" ? Date.parse(settings[discoveryKey]) : Number.NaN;
  if (!Number.isNaN(lastDiscoveryAt) && now.getTime() - lastDiscoveryAt < spotifyRankMarketDiscoveryIntervalMs) {
    return resolveIntegrationPolymarketQueue(integration, now);
  }

  const nextSettings = { ...settings, [discoveryKey]: now.toISOString() };
  try {
    const response = await fetchWithTimeout(gammaSpotifyEventsUrl, {
      headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
    });
    if (!response.ok) {
      throw new Error(`Polymarket Gamma events returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const candidates = Array.isArray(payload)
      ? payload
          .map((event) => normalizeSpotifyRankMarket(event as GammaSpotifyEvent, scope, now))
          .filter((market): market is PolymarketQueueMarket => market !== null)
      : [];
    const markets = mergeSpotifyRankMarkets(nextSettings.polymarketMarkets, candidates);
    return resolveIntegrationPolymarketQueue(
      {
        ...integration,
        settingsJson: JSON.stringify({ ...nextSettings, polymarketMarkets: markets })
      },
      now
    );
  } catch {
    return resolveIntegrationPolymarketQueue(
      {
        ...integration,
        settingsJson: JSON.stringify(nextSettings)
      },
      now
    );
  }
}

export function normalizeSpotifyRankMarket(
  event: GammaSpotifyEvent,
  scope: SpotifyRankMarketScope,
  now: Date = new Date()
): PolymarketQueueMarket | null {
  if (
    event.active === false ||
    event.closed === true ||
    event.archived === true ||
    !isNonEmptyString(event.slug) ||
    !isNonEmptyString(event.title)
  ) {
    return null;
  }

  const slug = event.slug.trim().toLowerCase();
  const matchesScope =
    scope === "usa"
      ? /^(?:1|2)-song-in-the-us-this-week-/.test(slug)
      : /^(?:1|2)-song-this-week-/.test(slug) && !slug.includes("-in-the-us-");
  const endAt = parseGammaDate(event.endDate);
  if (!matchesScope || !endAt) {
    return null;
  }

  return {
    url: `https://polymarket.com/event/${event.slug.trim()}`,
    slug: event.slug.trim(),
    startAt:
      parseGammaDate(event.startDate) ??
      parseGammaDate(event.creationDate) ??
      parseGammaDate(event.createdAt) ??
      now.toISOString(),
    endAt,
    addedAt: now.toISOString()
  };
}

function mergeSpotifyRankMarkets(existing: unknown, candidates: PolymarketQueueMarket[]): PolymarketQueueMarket[] {
  const markets = new Map<string, PolymarketQueueMarket>();
  if (Array.isArray(existing)) {
    for (const value of existing) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const market = value as Partial<PolymarketQueueMarket>;
      if (isNonEmptyString(market.slug) && isNonEmptyString(market.url)) {
        markets.set(market.slug, {
          url: market.url,
          slug: market.slug,
          startAt: isNonEmptyString(market.startAt) ? market.startAt : null,
          endAt: isNonEmptyString(market.endAt) ? market.endAt : null,
          addedAt: isNonEmptyString(market.addedAt) ? market.addedAt : new Date(0).toISOString()
        });
      }
    }
  }

  for (const candidate of candidates) {
    markets.set(candidate.slug, { ...markets.get(candidate.slug), ...candidate });
  }

  return [...markets.values()].sort(
    (left, right) =>
      Date.parse(left.startAt ?? "9999-12-31") - Date.parse(right.startAt ?? "9999-12-31") ||
      left.slug.localeCompare(right.slug)
  );
}

function parseGammaDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function extractInitialState(html: string): SpotifyInitialState {
  const match = html.match(/<script id="initialState" type="text\/plain">([^<]+)<\/script>/);
  if (!match?.[1]) {
    throw new Error("Could not find Spotify initial state in playlist page");
  }

  return JSON.parse(Buffer.from(match[1], "base64").toString("utf8")) as SpotifyInitialState;
}

function isRetryableSpotifyError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }

  return (
    /Spotify returned HTTP 5\d\d/.test(error.message) ||
    error.message.includes("fetch failed") ||
    error.message.includes("Could not find Spotify initial state") ||
    error.message.includes("Could not find the #1 track")
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

