import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import { parsePolymarketMonthWindow, upsertPolymarketQueueUrl } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import { refreshMonthlyPolymarketQueue, type MonthlyPolymarketDiscoveryConfig } from "./monthlyPolymarketDiscovery.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://open.spotify.com";
const kworbListenersUrl = "https://kworb.net/spotify/listeners.html";
const gammaApiUrl = "https://gamma-api.polymarket.com/events";
const defaultPolymarketUrl = "https://polymarket.com/event/top-artist-in-july-20260708185955937";
const artistSettingsRefreshMs = 6 * 60 * 60_000;

const monthlyDiscoveryConfig: MonthlyPolymarketDiscoveryConfig = {
  searchQuery: "top artist in",
  slugPrefix: "top-artist-in-",
  titlePrefix: "Top artist in",
  lastDiscoveryAtKey: "lastSpotifyTopArtistMarketDiscoveryAt",
  requiredTagSlugs: ["spotify"]
};

type SpotifyTopArtistSettings = {
  artists?: string[];
  parsedFromUrl?: string;
  lastParsedAt?: string;
  year?: number;
  month?: number;
};

type GammaEvent = {
  markets?: GammaMarket[];
};

type GammaMarket = {
  groupItemTitle?: unknown;
  question?: unknown;
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
};

export type KworbSpotifyMonthlyListenerArtist = {
  rank: number;
  artist: string;
  listeners: number;
  dailyChange: number | null;
  peak: number | null;
  peakListeners: number | null;
};

type RankedTrackedArtist = {
  marketRank: number;
  artist: string;
  kworbRank: number;
  listeners: number;
  dailyChange: number | null;
  peak: number | null;
  peakListeners: number | null;
};

type MissingTrackedArtist = {
  artist: string;
};

type SpotifyTopArtistSnapshot = {
  artists: string[];
  rankedArtists: RankedTrackedArtist[];
  missingArtists: MissingTrackedArtist[];
  marketMonth: { year: number; month: number } | null;
  polymarketUrl: string;
};

export const spotifyTopArtistMonthlyAdapter: WebsiteAdapter = {
  id: "spotify-top-artist-monthly",
  commandName: "spotifytopartist",
  displayName: "Spotify Top Artist Monthly",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "spotifytopartist",
  alertRoleName: "Spotify Top Artist Alerts",
  alertRoleEmoji: "\uD83C\uDFA7",
  async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
    return refreshSpotifyTopArtistMonthlySettings(integration, new Date(), options);
  },
  async upsertPolymarketMarket(integration: Integration, url: string): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    const queued = upsertPolymarketQueueUrl(integration, url);
    const parsed = await parseSpotifyTopArtistMarket(url);
    return {
      activeUrl: queued.activeUrl ?? url,
      settingsJson: JSON.stringify({
        ...parseSettingsJson(queued.settingsJson),
        ...parsed
      })
    };
  },
  getPollIntervalMinutes(): number {
    return 60;
  },
  getPollIntervalReason(): string {
    return "Kworb's Spotify monthly listener ranking updates periodically, so hourly polling is enough.";
  },
  shouldAlertOnChange: shouldAlertOnTopArtistChange,
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const settings = await getSettingsWithArtists(integration);
    const artists = settings.artists ?? [];
    if (artists.length === 0) {
      throw new Error("No active Polymarket artist outcomes parsed for Spotify Top Artist Monthly");
    }

    const rows = extractKworbSpotifyMonthlyListenerArtists(await fetchKworbMonthlyListenersHtml());
    const polymarketUrl = settings.parsedFromUrl ?? integration?.polymarketUrl ?? defaultPolymarketUrl;
    const snapshot = buildSpotifyTopArtistSnapshot(rows, artists, settings, polymarketUrl);

    return {
      value: formatSpotifyTopArtistValue(snapshot),
      rawValue: JSON.stringify(snapshot),
      unit: "monthly listeners",
      observedAt: new Date()
    };
  }
};

export async function refreshSpotifyTopArtistMonthlySettings(
  integration: Integration,
  now = new Date(),
  options?: { force?: boolean }
): Promise<string> {
  const queued = await refreshMonthlyPolymarketQueue(integration, monthlyDiscoveryConfig, now);
  const activeUrl = queued.activeUrl ?? integration.polymarketUrl ?? defaultPolymarketUrl;
  const settings = parseSpotifyTopArtistSettings(queued.settingsJson);
  if (!options?.force && !shouldRefreshArtistSettings(settings, activeUrl, now)) {
    return queued.settingsJson ?? "{}";
  }

  const parsed = await parseSpotifyTopArtistMarket(activeUrl, now);
  return JSON.stringify({
    ...parseSettingsJson(queued.settingsJson),
    ...parsed
  });
}

export async function parseSpotifyTopArtistMarket(polymarketUrl: string, now = new Date()): Promise<SpotifyTopArtistSettings> {
  const slug = getPolymarketSlug(polymarketUrl);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${polymarketUrl}`);
  }

  const response = await fetchWithTimeout(`${gammaApiUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const events = (await response.json()) as GammaEvent[];
  const artists = parseSpotifyTopArtistOutcomes(events.flatMap((event) => event.markets ?? []));
  if (artists.length === 0) {
    throw new Error(`Could not parse active Spotify artist outcomes from ${polymarketUrl}`);
  }

  return {
    artists,
    parsedFromUrl: polymarketUrl,
    lastParsedAt: now.toISOString()
  };
}

export function parseSpotifyTopArtistOutcomes(markets: GammaMarket[]): string[] {
  const artists = new Set<string>();
  for (const market of markets) {
    if (!isOpenMarket(market)) {
      continue;
    }

    const artist = normalizeText(String(market.groupItemTitle ?? ""));
    if (!artist || /^artist\s+[a-z]$/i.test(artist) || artist.toLowerCase() === "other") {
      continue;
    }

    artists.add(artist);
  }

  return [...artists].sort((left, right) => left.localeCompare(right));
}

export function extractKworbSpotifyMonthlyListenerArtists(html: string): KworbSpotifyMonthlyListenerArtist[] {
  const $ = cheerio.load(html);
  const pageTitle = normalizeText($(".pagetitle").first().text());
  if (!/spotify top artists by monthly listeners/i.test(pageTitle)) {
    throw new Error("Could not verify Kworb monthly listener page title");
  }

  const rows: KworbSpotifyMonthlyListenerArtist[] = [];
  $("table")
    .first()
    .find("tr")
    .slice(1)
    .each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 6) {
        return;
      }

      const rank = parseInteger(normalizeText(cells.eq(0).text()));
      const artist = normalizeText(cells.eq(1).text());
      const listeners = parseInteger(normalizeText(cells.eq(2).text()));
      if (rank === null || !artist || listeners === null) {
        return;
      }

      rows.push({
        rank,
        artist,
        listeners,
        dailyChange: parseInteger(normalizeText(cells.eq(3).text())),
        peak: parseInteger(normalizeText(cells.eq(4).text())),
        peakListeners: parseInteger(normalizeText(cells.eq(5).text()))
      });
    });

  if (rows.length === 0) {
    throw new Error("Could not parse Kworb Spotify monthly listener rows");
  }

  return rows;
}

export function buildSpotifyTopArtistSnapshot(
  rows: KworbSpotifyMonthlyListenerArtist[],
  artists: string[],
  settings: Pick<SpotifyTopArtistSettings, "year" | "month">,
  polymarketUrl: string
): SpotifyTopArtistSnapshot {
  const rowByArtist = new Map(rows.map((row) => [normalizeArtistKey(row.artist), row]));
  const rankedArtists: RankedTrackedArtist[] = [];
  const missingArtists: MissingTrackedArtist[] = [];

  for (const artist of artists) {
    const row = rowByArtist.get(normalizeArtistKey(artist));
    if (!row) {
      missingArtists.push({ artist });
      continue;
    }

    rankedArtists.push({
      marketRank: 0,
      artist,
      kworbRank: row.rank,
      listeners: row.listeners,
      dailyChange: row.dailyChange,
      peak: row.peak,
      peakListeners: row.peakListeners
    });
  }

  rankedArtists
    .sort((left, right) => right.listeners - left.listeners || left.artist.localeCompare(right.artist))
    .forEach((artist, index) => {
      artist.marketRank = index + 1;
    });

  return {
    artists,
    rankedArtists,
    missingArtists: missingArtists.sort((left, right) => left.artist.localeCompare(right.artist)),
    marketMonth:
      typeof settings.year === "number" && typeof settings.month === "number"
        ? { year: settings.year, month: settings.month }
        : parseMarketMonthFromUrl(polymarketUrl),
    polymarketUrl
  };
}

export function formatSpotifyTopArtistValue(snapshot: SpotifyTopArtistSnapshot): string {
  const leader = snapshot.rankedArtists[0] ?? null;
  const marketMonth = snapshot.marketMonth ? `${snapshot.marketMonth.year}-${padNumber(snapshot.marketMonth.month)}` : "unknown";
  const resolutionTime = snapshot.marketMonth ? formatResolutionCheckTime(snapshot.marketMonth.year, snapshot.marketMonth.month) : "unknown";
  const rankedRows = snapshot.rankedArtists.map(
    (artist) =>
      `${artist.marketRank}. ${artist.artist} ${formatCompactNumber(artist.listeners)} (#${artist.kworbRank}, ${formatSignedCompactNumber(artist.dailyChange)})`
  );

  return [
    "Metric: Spotify monthly listeners (listed artists)",
    `Market: ${marketMonth}; check: ${resolutionTime}`,
    leader
      ? `Leader: ${leader.artist} ${formatCompactNumber(leader.listeners)} (Kworb #${leader.kworbRank})`
      : "Leader: unknown",
    "Tracked artists:",
    ...(rankedRows.length ? rankedRows : ["none"]),
    `Missing: ${snapshot.missingArtists.length ? snapshot.missingArtists.map((artist) => artist.artist).join(", ") : "none"}`,
    "Tie: exact tie resolves alphabetically",
    `Kworb: ${kworbListenersUrl}`
  ].join("\n");
}

function shouldAlertOnTopArtistChange(previousValue: string | null, currentValue: string): boolean {
  return extractComparableRanking(previousValue) !== extractComparableRanking(currentValue);
}

async function getSettingsWithArtists(integration?: Integration): Promise<SpotifyTopArtistSettings> {
  const parsed = parseSpotifyTopArtistSettings(integration?.settingsJson ?? null);
  if (parsed.artists?.length) {
    return parsed;
  }

  const polymarketUrl = integration?.polymarketUrl ?? defaultPolymarketUrl;
  const marketSettings = await parseSpotifyTopArtistMarket(polymarketUrl);
  const window = parsePolymarketMonthWindow(polymarketUrl);
  return {
    ...parsed,
    ...marketSettings,
    year: parsed.year ?? window?.year,
    month: parsed.month ?? window?.month
  };
}

async function fetchKworbMonthlyListenersHtml(): Promise<string> {
  const response = await fetchWithTimeout(kworbListenersUrl, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Kworb monthly listeners returned HTTP ${response.status}`);
  }

  return response.text();
}

function parseSpotifyTopArtistSettings(settingsJson: string | null): SpotifyTopArtistSettings {
  const settings = parseSettingsJson(settingsJson) as SpotifyTopArtistSettings;
  return {
    artists: Array.isArray(settings.artists) ? settings.artists.filter(isNonEmptyString).map(normalizeText) : undefined,
    parsedFromUrl: typeof settings.parsedFromUrl === "string" ? settings.parsedFromUrl : undefined,
    lastParsedAt: typeof settings.lastParsedAt === "string" ? settings.lastParsedAt : undefined,
    year: typeof settings.year === "number" ? settings.year : undefined,
    month: typeof settings.month === "number" ? settings.month : undefined
  };
}

function shouldRefreshArtistSettings(settings: SpotifyTopArtistSettings, polymarketUrl: string, now: Date): boolean {
  if (settings.parsedFromUrl !== polymarketUrl || !settings.artists?.length || !settings.lastParsedAt) {
    return true;
  }

  const lastParsedAt = Date.parse(settings.lastParsedAt);
  return Number.isNaN(lastParsedAt) || now.getTime() - lastParsedAt >= artistSettingsRefreshMs;
}

function parseMarketMonthFromUrl(polymarketUrl: string): { year: number; month: number } | null {
  const window = parsePolymarketMonthWindow(polymarketUrl);
  return window ? { year: window.year, month: window.month } : null;
}

function formatResolutionCheckTime(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${padNumber(month)}-${padNumber(lastDay)} 12:00 ET`;
}

function extractComparableRanking(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const lines = value.split("\n");
  const trackedIndex = lines.indexOf("Tracked artists:");
  const missingIndex = lines.findIndex((line) => line.startsWith("Missing:") || line.startsWith("Missing tracked artists:"));
  if (trackedIndex === -1 || missingIndex === -1 || missingIndex <= trackedIndex) {
    return value;
  }

  return lines.slice(trackedIndex + 1, missingIndex + 1).join("\n");
}

function parseInteger(value: string): number | null {
  const normalized = value.replace(/,/g, "").replace(/^\+/, "").trim();
  if (!/^-?\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function formatCompactNumber(value: number): string {
  const absoluteValue = Math.abs(value);
  if (absoluteValue >= 1_000_000_000) {
    return `${formatDecimal(value / 1_000_000_000)}B`;
  }
  if (absoluteValue >= 1_000_000) {
    return `${formatDecimal(value / 1_000_000)}M`;
  }
  if (absoluteValue >= 1_000) {
    return `${formatDecimal(value / 1_000)}K`;
  }

  return value.toLocaleString("en-US");
}

function formatSignedCompactNumber(value: number | null): string {
  if (value === null) {
    return "n/a";
  }

  return `${value >= 0 ? "+" : ""}${formatCompactNumber(value)}`;
}

function formatDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function normalizeArtistKey(value: string): string {
  return normalizeText(value).normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function isOpenMarket(market: GammaMarket): boolean {
  return market.active !== false && market.closed !== true && market.archived !== true;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
