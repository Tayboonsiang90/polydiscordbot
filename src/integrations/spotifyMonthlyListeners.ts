import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const artistName = "Justin Bieber";
const artistId = "1uNFoZAHBGtllmzznpCI3s";
const sourceUrl = `https://open.spotify.com/artist/${artistId}`;
const gammaApiUrl = "https://gamma-api.polymarket.com/events";
const defaultPolymarketUrl = "https://polymarket.com/event/justin-bieber-monthly-listeners-hits-by-august-31-20260710220109217";
const settingsRefreshMs = 6 * 60 * 60_000;

type ListenerStrike = {
  label: string;
  listeners: number;
  question: string;
  slug: string;
};

type SpotifyMonthlyListenersSettings = {
  strikes?: ListenerStrike[];
  parsedFromUrl?: string;
  lastParsedAt?: string;
};

type GammaEvent = {
  markets?: GammaMarket[];
};

type GammaMarket = {
  question?: unknown;
  slug?: unknown;
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
  groupItemTitle?: unknown;
  outcomePrices?: unknown;
};

export const spotifyBieberMonthlyListenersAdapter: WebsiteAdapter = {
  id: "spotify-bieber-monthly-listeners",
  commandName: "bieberlisteners",
  displayName: "Justin Bieber Monthly Listeners",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "bieberlisteners",
  alertRoleName: "Bieber Listeners Alerts",
  alertRoleEmoji: "\uD83C\uDFA7",
  supportsStrikes: true,
  getPollIntervalMinutes: () => 5,
  getPollIntervalReason: () => "Spotify monthly listeners monitor: 5-minute polling.",
  shouldAlertOnChange: shouldAlertOnListenerChange,
  async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
    const settings = parseSpotifyMonthlyListenersSettings(integration.settingsJson);
    const polymarketUrl = integration.polymarketUrl ?? defaultPolymarketUrl;
    if (!options?.force && !shouldRefreshSettings(settings, polymarketUrl)) {
      return JSON.stringify(settings);
    }

    return JSON.stringify(await parseSpotifyMonthlyListenersMarket(polymarketUrl));
  },
  async upsertPolymarketMarket(_integration: Integration, url: string): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return { settingsJson: JSON.stringify(await parseSpotifyMonthlyListenersMarket(url)), activeUrl: url };
  },
  getStrikeTerms(integration: Integration): { strikeTerms: string[]; parsedFromUrl?: string; lastParsedAt?: string } {
    const settings = parseSpotifyMonthlyListenersSettings(integration.settingsJson);
    return {
      strikeTerms: (settings.strikes ?? []).map((strike) => strike.label),
      parsedFromUrl: settings.parsedFromUrl,
      lastParsedAt: settings.lastParsedAt
    };
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const settings = parseSpotifyMonthlyListenersSettings(integration?.settingsJson ?? null);
    const { listeners, displayText, description } = extractSpotifyMonthlyListenersFromHtml(await fetchSpotifyArtistHtml());
    const value = formatSpotifyMonthlyListenersValue(
      listeners,
      displayText,
      description,
      settings.strikes ?? [],
      settings.parsedFromUrl ?? integration?.polymarketUrl ?? defaultPolymarketUrl
    );

    return {
      value,
      rawValue: String(listeners),
      unit: "monthly listeners",
      observedAt: new Date()
    };
  }
};

export function extractSpotifyMonthlyListenersFromHtml(html: string): { listeners: number; displayText: string; description: string } {
  const document = cheerio.load(html);
  const description =
    document('meta[property="og:description"]').attr("content") ??
    document('meta[name="description"]').attr("content") ??
    html;
  const match = description.match(/([\d,.]+)\s*([KMB])?\s+monthly listeners/i);
  if (!match) {
    throw new Error("Could not parse Spotify monthly listeners from artist profile metadata");
  }

  const displayText = `${match[1]}${match[2] ?? ""}`;
  const listeners = parseCompactNumber(displayText);
  if (listeners === null) {
    throw new Error(`Could not normalize Spotify monthly listeners value: ${displayText}`);
  }

  return { listeners, displayText, description };
}

export async function parseSpotifyMonthlyListenersMarket(polymarketUrl: string, now = new Date()): Promise<SpotifyMonthlyListenersSettings> {
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
  const strikes = parseSpotifyMonthlyListenerStrikes(events.flatMap((event) => event.markets ?? []));
  return {
    strikes,
    parsedFromUrl: polymarketUrl,
    lastParsedAt: now.toISOString()
  };
}

export function parseSpotifyMonthlyListenerStrikes(markets: GammaMarket[]): ListenerStrike[] {
  const byListeners = new Map<number, ListenerStrike>();
  for (const market of markets) {
    if (!isOpenMarket(market)) {
      continue;
    }

    const question = String(market.question ?? "");
    const listeners = parseListenerStrike(question) ?? parseListenerStrike(String(market.groupItemTitle ?? ""));
    const slug = typeof market.slug === "string" ? market.slug : "";
    if (listeners === null || !slug) {
      continue;
    }

    byListeners.set(listeners, {
      label: formatListenersShort(listeners),
      listeners,
      question,
      slug
    });
  }

  return [...byListeners.values()].sort((left, right) => left.listeners - right.listeners);
}

export function formatSpotifyMonthlyListenersValue(
  listeners: number,
  displayText: string,
  description: string,
  strikes: ListenerStrike[],
  polymarketUrl: string
): string {
  const hitStrikes = strikes.filter((strike) => listeners >= strike.listeners);
  const openStrikes = strikes.filter((strike) => listeners < strike.listeners);
  const nextStrike = openStrikes[0] ?? null;

  return [
    "Metric: Spotify monthly listeners",
    `Artist: ${artistName}`,
    `Monthly listeners: ${formatListenersFull(listeners)} (${displayText})`,
    nextStrike
      ? `Next strike: ${nextStrike.label} - ${formatListenersFull(nextStrike.listeners - listeners)} away`
      : strikes.length
        ? "Next strike: all parsed strikes hit"
        : "Next strike: none parsed",
    `Hit strikes: ${hitStrikes.length ? hitStrikes.map((strike) => strike.label).join(", ") : "none"}`,
    `Open strikes: ${openStrikes.length ? openStrikes.map((strike) => strike.label).join(", ") : "none"}`,
    `Parsed strikes: ${strikes.length ? strikes.map((strike) => strike.label).join(", ") : "none"}`,
    `Spotify metadata: ${description}`,
    `Resolution: ${sourceUrl}`,
    `Polymarket: ${polymarketUrl}`
  ].join("\n");
}

function shouldAlertOnListenerChange(previousValue: string | null, currentValue: string): boolean {
  return extractListenerLine(previousValue) !== extractListenerLine(currentValue);
}

async function fetchSpotifyArtistHtml(): Promise<string> {
  const response = await fetchWithTimeout(sourceUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`Spotify artist profile returned HTTP ${response.status}`);
  }

  return response.text();
}

function parseSpotifyMonthlyListenersSettings(settingsJson: string | null): SpotifyMonthlyListenersSettings {
  const settings = parseSettingsJson(settingsJson) as SpotifyMonthlyListenersSettings;
  return {
    strikes: Array.isArray(settings.strikes) ? settings.strikes.filter(isListenerStrike).sort((left, right) => left.listeners - right.listeners) : undefined,
    parsedFromUrl: typeof settings.parsedFromUrl === "string" ? settings.parsedFromUrl : undefined,
    lastParsedAt: typeof settings.lastParsedAt === "string" ? settings.lastParsedAt : undefined
  };
}

function shouldRefreshSettings(settings: SpotifyMonthlyListenersSettings, polymarketUrl: string, now = new Date()): boolean {
  if (settings.parsedFromUrl !== polymarketUrl || !settings.strikes?.length || !settings.lastParsedAt) {
    return true;
  }

  const lastParsedAt = Date.parse(settings.lastParsedAt);
  return Number.isNaN(lastParsedAt) || now.getTime() - lastParsedAt >= settingsRefreshMs;
}

function parseListenerStrike(value: string): number | null {
  const match = value.match(/(?:hit|↑)\s*([\d,.]+)\s*([KMB])?\b/i) ?? value.match(/([\d,.]+)\s*([KMB])\b/i);
  return match ? parseCompactNumber(`${match[1]}${match[2] ?? ""}`) : null;
}

function parseCompactNumber(value: string): number | null {
  const match = value.trim().replace(/,/g, "").match(/^(\d+(?:\.\d+)?)([KMB])?$/i);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return null;
  }

  const multiplier = match[2]?.toUpperCase() === "B" ? 1_000_000_000 : match[2]?.toUpperCase() === "M" ? 1_000_000 : match[2]?.toUpperCase() === "K" ? 1_000 : 1;
  return Math.round(amount * multiplier);
}

function formatListenersShort(value: number): string {
  if (value >= 1_000_000_000) {
    return `${formatNumber(value / 1_000_000_000)}B`;
  }
  if (value >= 1_000_000) {
    return `${formatNumber(value / 1_000_000)}M`;
  }
  if (value >= 1_000) {
    return `${formatNumber(value / 1_000)}K`;
  }

  return String(value);
}

function formatListenersFull(value: number): string {
  return value.toLocaleString("en-US");
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function extractListenerLine(value: string | null): string | null {
  return value?.match(/^Monthly listeners:\s*(.+)$/m)?.[1] ?? null;
}

function isOpenMarket(market: GammaMarket): boolean {
  return market.active !== false && market.closed !== true && market.archived !== true && !isResolvedOutcomePrices(market.outcomePrices);
}

function isResolvedOutcomePrices(value: unknown): boolean {
  const prices = typeof value === "string" ? parseJsonArray(value) : Array.isArray(value) ? value : [];
  return prices.some((price) => Number(price) >= 0.999);
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isListenerStrike(value: unknown): value is ListenerStrike {
  if (!value || typeof value !== "object") {
    return false;
  }

  const strike = value as Partial<ListenerStrike>;
  return (
    typeof strike.label === "string" &&
    typeof strike.listeners === "number" &&
    Number.isFinite(strike.listeners) &&
    typeof strike.question === "string" &&
    typeof strike.slug === "string"
  );
}
