import { fetchWithTimeout } from "../http.js";
import { parsePolymarketDateRangeWindow, resolveIntegrationPolymarketQueue, type PolymarketQueueMarket, upsertPolymarketQueueUrl } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 72 * 60 * 60_000;

export type PythPriceStrikeConfig = {
  id: string;
  commandName: string;
  displayName: string;
  search: string;
  sourceUrl?: string;
  priceFeedsQuery?: string;
  feedNamePattern: RegExp;
  marketSlugPrefix: string;
  marketSearchQuery: string;
  defaultPolymarketUrl: string;
  defaultChannelName: string;
  alertRoleName: string;
  alertRoleEmoji: string;
};

export type PythPriceFeed = {
  name: string;
  symbol: string;
  state: string;
};

export type PythCandle = {
  high: number;
  low: number;
  close: number;
  timestamp: string;
};

export type PythStrike = {
  display: string;
  value: number;
};

export type PythStrikeCrossing = PythStrike & {
  direction: "up" | "down";
  feedName: string;
  price: number;
  timestamp: string;
};

type GammaEvent = {
  markets?: {
    active?: boolean;
    archived?: boolean;
    closed?: boolean;
    question?: string;
    groupItemTitle?: string;
    outcomePrices?: string;
  }[];
};

type GammaSearchResponse = {
  events?: GammaSearchEvent[];
};

type GammaSearchEvent = {
  slug?: unknown;
  title?: unknown;
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
};

type PythPriceDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastPythPriceMarketDiscoveryAt?: string;
};

export function createPythPriceStrikeAdapter(config: PythPriceStrikeConfig): WebsiteAdapter {
  const sourceUrl = config.sourceUrl ?? buildPythExploreUrl(config.search);
  return {
    id: config.id,
    commandName: config.commandName,
    displayName: config.displayName,
    sourceUrl,
    defaultPolymarketUrl: config.defaultPolymarketUrl,
    defaultChannelName: config.defaultChannelName,
    alertRoleName: config.alertRoleName,
    alertRoleEmoji: config.alertRoleEmoji,
    getPollIntervalMinutes: () => 1,
    getPollIntervalReason: () => "Fixed 1-minute live crossing watch; normal price changes do not alert",
    getErrorNoticeWindowMinutes: () => 30,
    shouldAlertOnChange: pythPriceStrikeShouldAlertOnChange,
    async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
      return (
        await refreshPythPricePolymarketQueue(integration, config, new Date(), {
          force: options?.force ?? false
        })
      ).settingsJson ?? integration.settingsJson ?? "{}";
    },
    upsertPolymarketMarket(integration: Integration, url: string): { settingsJson: string | null; activeUrl: string | null } {
      return upsertPolymarketQueueUrl(integration, url);
    },
    async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
      const value = await fetchPythPriceStrikeMonitorValue(config, integration);
      return {
        value,
        rawValue: value,
        unit: `${config.search} live strike crossings`,
        observedAt: new Date()
      };
    }
  };
}

export async function refreshPythPricePolymarketQueue(
  integration: Integration,
  config: PythPriceStrikeConfig,
  now = new Date(),
  options: { force?: boolean } = {}
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parsePythPriceDiscoverySettings(resolved.settingsJson);
  if (!options.force && !shouldDiscoverPythPriceMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastPythPriceMarketDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const candidates = await fetchPythPriceMarketSearchCandidates(config, now);
    for (const candidate of candidates) {
      resolved = upsertPolymarketQueueUrl(
        {
          ...integration,
          settingsJson: resolved.settingsJson,
          polymarketUrl: resolved.activeUrl ?? integration.polymarketUrl
        },
        candidate.url,
        now
      );
    }

    return resolved;
  } catch {
    return resolved;
  }
}

export async function fetchPythPriceStrikeMonitorValue(
  config: PythPriceStrikeConfig,
  integration?: Integration
): Promise<string> {
  const polymarketUrl = integration?.polymarketUrl ?? config.defaultPolymarketUrl;
  const strikes = await fetchPythStrikes(polymarketUrl, parseStoredTrackedStrikes(integration?.lastValue ?? null, polymarketUrl));
  const feed = await fetchTopPythFeed(config);
  const historyRange = getHistoryRange(integration);
  const candles = await fetchPythCandles(feed, historyRange);
  const previousPrice = parseStoredLastPrice(integration?.lastValue ?? null);
  const allCrossings = previousPrice === null ? [] : findPythStrikeCrossings(strikes, feed, previousPrice, candles);
  const alertState = filterNewPythStrikeCrossings(integration?.lastValue ?? null, polymarketUrl, allCrossings);
  const latestCandle = candles.at(-1);
  const lastPrice = latestCandle?.close ?? previousPrice;
  const lastPriceTime = latestCandle?.timestamp ?? "not available";

  return formatPythPriceStrikeMonitorValue({
    sourceUrl: config.sourceUrl ?? buildPythExploreUrl(config.search),
    polymarketUrl,
    feed,
    lastPrice,
    lastPriceTime,
    strikes,
    crossings: alertState.crossings,
    alertedStrikes: alertState.alertedStrikes
  });
}

export function extractPythStrikesFromGamma(data: unknown): PythStrike[] {
  const event = Array.isArray(data) ? (data[0] as GammaEvent | undefined) : (data as GammaEvent | undefined);
  const seen = new Set<string>();
  const strikes: PythStrike[] = [];

  for (const market of event?.markets ?? []) {
    if (isResolvedGammaMarket(market)) {
      continue;
    }

    const strike = extractStrikeFromText([market.groupItemTitle, market.question].filter(Boolean).join(" "));
    if (strike && !seen.has(strike.display)) {
      seen.add(strike.display);
      strikes.push(strike);
    }
  }

  return strikes.sort((left, right) => left.value - right.value);
}

export function extractTopPythFeed(data: unknown, feedNamePattern: RegExp): PythPriceFeed | null {
  if (!isRecord(data) || !Array.isArray(data.data)) {
    return null;
  }

  return (
    data.data
      .filter(isRecord)
      .map((row) => ({
        name: String(row.name ?? ""),
        symbol: String(row.symbol ?? ""),
        state: String(row.state ?? "")
      }))
      .find((feed) => feed.state === "stable" && feedNamePattern.test(feed.name)) ?? null
  );
}

export function extractPythCandles(data: unknown): PythCandle[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .filter(isRecord)
    .map((row) => {
      const high = parseNumber(row.high);
      const low = parseNumber(row.low);
      const close = parseNumber(row.close);
      const timestamp = typeof row.timestamp === "string" ? row.timestamp : null;
      return high !== null && low !== null && close !== null && timestamp ? { high, low, close, timestamp } : null;
    })
    .filter((candle): candle is PythCandle => Boolean(candle))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function normalizePythPriceMarketSearchEvent(
  event: GammaSearchEvent,
  config: PythPriceStrikeConfig,
  now = new Date()
): { slug: string; url: string } | null {
  if (
    event.active === false ||
    event.closed === true ||
    event.archived === true ||
    !isNonEmptyString(event.slug) ||
    !isNonEmptyString(event.title)
  ) {
    return null;
  }

  const slug = event.slug.toLowerCase();
  if (!slug.startsWith(config.marketSlugPrefix)) {
    return null;
  }

  const url = `https://polymarket.com/event/${event.slug}`;
  return parsePolymarketDateRangeWindow(url, now) ? { slug: event.slug, url } : null;
}

export function findPythStrikeCrossings(
  strikes: PythStrike[],
  feed: PythPriceFeed,
  previousPrice: number,
  candles: PythCandle[]
): PythStrikeCrossing[] {
  const crossings: PythStrikeCrossing[] = [];
  let referencePrice = previousPrice;

  for (const candle of candles) {
    for (const strike of strikes) {
      if (referencePrice < strike.value && candle.high >= strike.value) {
        crossings.push({ ...strike, direction: "up", feedName: feed.name, price: candle.high, timestamp: candle.timestamp });
      } else if (referencePrice > strike.value && candle.low <= strike.value) {
        crossings.push({ ...strike, direction: "down", feedName: feed.name, price: candle.low, timestamp: candle.timestamp });
      }
    }

    referencePrice = candle.close;
  }

  return dedupeCrossings(crossings);
}

export function formatPythPriceStrikeMonitorValue(input: {
  sourceUrl: string;
  polymarketUrl?: string;
  feed: PythPriceFeed;
  lastPrice: number | null;
  lastPriceTime: string;
  strikes: PythStrike[];
  crossings: PythStrikeCrossing[];
  alertedStrikes?: string[];
}): string {
  return [
    `Ticker: ${input.feed.name}`,
    `Last Price: ${input.lastPrice === null ? "not available" : formatPrice(input.lastPrice)}`,
    `Last Price Time: ${input.lastPriceTime}`,
    "Crossed Strikes:",
    input.crossings.length > 0 ? input.crossings.map(formatCrossing).join("\n") : "none",
    "Alerted Strikes:",
    input.alertedStrikes && input.alertedStrikes.length > 0 ? input.alertedStrikes.join(", ") : "none",
    "Tracked Strikes:",
    input.strikes.length > 0 ? input.strikes.map((strike) => strike.display).join(", ") : "none",
    `Resolution: ${input.sourceUrl}`,
    `Alerted For: ${input.polymarketUrl ?? "not set"}`
  ].join("\n");
}

export function pythPriceStrikeShouldAlertOnChange(_previousValue: string | null, currentValue: string): boolean {
  return parseCurrentCrossings(currentValue).length > 0;
}

export function filterNewPythStrikeCrossings(
  previousValue: string | null,
  polymarketUrl: string,
  crossings: PythStrikeCrossing[]
): { crossings: PythStrikeCrossing[]; alertedStrikes: string[] } {
  const previouslyAlertedStrikes = parseStoredAlertedStrikes(previousValue, polymarketUrl);
  const newCrossings = crossings.filter((crossing) => !previouslyAlertedStrikes.has(crossing.display));
  const alertedStrikes = new Set(previouslyAlertedStrikes);
  for (const crossing of newCrossings) {
    alertedStrikes.add(crossing.display);
  }

  return {
    crossings: newCrossings,
    alertedStrikes: [...alertedStrikes].sort(compareStrikeDisplays)
  };
}

async function fetchPythPriceMarketSearchCandidates(
  config: PythPriceStrikeConfig,
  now: Date
): Promise<Array<{ slug: string; url: string }>> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", config.marketSearchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "20");

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? [])
    .map((event) => normalizePythPriceMarketSearchEvent(event, config, now))
    .filter((candidate): candidate is { slug: string; url: string } => candidate !== null);
}

function isResolvedGammaMarket(market: NonNullable<GammaEvent["markets"]>[number]): boolean {
  if (market.closed || market.archived || market.active === false) {
    return true;
  }

  if (!market.outcomePrices) {
    return false;
  }

  try {
    const prices = JSON.parse(market.outcomePrices) as unknown;
    return Array.isArray(prices) && prices.some((price) => Number(price) === 1);
  } catch {
    return false;
  }
}

function shouldDiscoverPythPriceMarkets(settings: PythPriceDiscoverySettings, now: Date): boolean {
  const markets = normalizePythPriceQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastPythPriceMarketDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

function parsePythPriceDiscoverySettings(settingsJson: string | null): PythPriceDiscoverySettings {
  const settings = parseSettingsJson(settingsJson) as PythPriceDiscoverySettings;
  return {
    ...settings,
    polymarketMarkets: normalizePythPriceQueueMarkets(settings.polymarketMarkets),
    lastPythPriceMarketDiscoveryAt:
      typeof settings.lastPythPriceMarketDiscoveryAt === "string" ? settings.lastPythPriceMarketDiscoveryAt : undefined
  };
}

function normalizePythPriceQueueMarkets(value: unknown): PolymarketQueueMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const market = item as Partial<PolymarketQueueMarket>;
    if (!isNonEmptyString(market.url) || !isNonEmptyString(market.slug)) {
      return [];
    }

    return [
      {
        url: market.url,
        slug: market.slug,
        startAt: typeof market.startAt === "string" ? market.startAt : null,
        endAt: typeof market.endAt === "string" ? market.endAt : null,
        addedAt: typeof market.addedAt === "string" ? market.addedAt : new Date(0).toISOString()
      }
    ];
  });
}

function hasQueuedFutureMarket(markets: PolymarketQueueMarket[], now: Date): boolean {
  return markets.some((market) => Boolean(market.startAt && Date.parse(market.startAt) > now.getTime()));
}

function getActiveMarket(markets: PolymarketQueueMarket[], now: Date): PolymarketQueueMarket | null {
  const nowMs = now.getTime();
  return (
    markets.find((market) => {
      if (!market.startAt || !market.endAt) {
        return false;
      }

      return nowMs >= Date.parse(market.startAt) && nowMs <= Date.parse(market.endAt);
    }) ?? null
  );
}

function isDiscoveryIntervalDue(lastDiscoveryAt: string | undefined, now: Date, intervalMs: number): boolean {
  if (!lastDiscoveryAt) {
    return true;
  }

  const lastDiscoveryMs = Date.parse(lastDiscoveryAt);
  return Number.isNaN(lastDiscoveryMs) || now.getTime() - lastDiscoveryMs >= intervalMs;
}

async function fetchPythStrikes(polymarketUrl: string, fallbackStrikes: PythStrike[] = []): Promise<PythStrike[]> {
  const slug = new URL(polymarketUrl).pathname.split("/").filter(Boolean).at(-1);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${polymarketUrl}`);
  }

  const response = await fetchPythDependencyWithRetry(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const strikes = extractPythStrikesFromGamma(await response.json());
  if (strikes.length === 0) {
    return fallbackStrikes;
  }

  return strikes;
}

async function fetchTopPythFeed(config: PythPriceStrikeConfig): Promise<PythPriceFeed> {
  const response = await fetchPythDependencyWithRetry(buildPythPriceFeedsUrl(config.priceFeedsQuery ?? config.search), {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`Pyth price-feeds endpoint returned HTTP ${response.status}`);
  }

  const feed = extractTopPythFeed(await response.json(), config.feedNamePattern);
  if (!feed) {
    throw new Error(`Could not find the top active ${config.search} Pyth feed`);
  }

  return feed;
}

async function fetchPythCandles(feed: PythPriceFeed, range: { from?: Date; to?: Date }): Promise<PythCandle[]> {
  const response = await fetchPythDependencyWithRetry(buildHistoryUrl(feed.symbol, range), {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`Pyth history endpoint returned HTTP ${response.status} for ${feed.name}`);
  }

  return extractPythCandles(await response.json());
}

async function fetchPythDependencyWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetchWithTimeout(url, init, 30_000);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await delay(attempt * 1_000);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPythExploreUrl(search: string): string {
  return `https://pythdata.app/explore?search=${encodeURIComponent(search)}`;
}

function buildPythPriceFeedsUrl(search: string): string {
  return `https://pythdata.app/api/price-feeds?query=${encodeURIComponent(search)}&limit=100`;
}

function buildHistoryUrl(symbol: string, range: { from?: Date; to?: Date }): string {
  const url = new URL(`https://pythdata.app/api/price-feeds/${encodeURIComponent(symbol)}/history`);
  url.searchParams.set("resolution", "1m");
  if (range.from) {
    url.searchParams.set("from", range.from.toISOString());
  }
  if (range.to) {
    url.searchParams.set("to", range.to.toISOString());
  }
  return url.toString();
}

function getHistoryRange(integration?: Integration): { from?: Date; to?: Date } {
  if (!integration?.lastCheckedAt) {
    return {};
  }

  const previousCheck = new Date(integration.lastCheckedAt);
  if (Number.isNaN(previousCheck.getTime())) {
    return {};
  }

  return {
    from: new Date(previousCheck.getTime() - 5 * 60_000),
    to: new Date()
  };
}

function extractStrikeFromText(text: string): PythStrike | null {
  const match = text.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }

  const value = parseNumber(match[1]);
  return value !== null && Number.isFinite(value)
    ? {
        display: formatStrikeDisplay(value),
        value
      }
    : null;
}

function parseStoredLastPrice(value: string | null): number | null {
  const match = value?.match(/^Last Price:\s*([\d,.]+)/m);
  return match ? parseNumber(match[1]) : null;
}

function parseStoredAlertedStrikes(value: string | null, polymarketUrl: string): Set<string> {
  if (!value || !value.includes(`Alerted For: ${polymarketUrl}`)) {
    return new Set();
  }

  const lines = value.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "Alerted Strikes:");
  const end = lines.findIndex((line) => line === "Tracked Strikes:");
  if (start === -1 || end === -1 || end <= start) {
    return new Set();
  }

  const alertedText = lines.slice(start + 1, end).join(" ");
  if (!alertedText || alertedText === "none") {
    return new Set();
  }

  return new Set(alertedText.match(/\$[\d,]+(?:\.\d+)?/g) ?? []);
}

function parseStoredTrackedStrikes(value: string | null, polymarketUrl: string): PythStrike[] {
  if (!value || !value.includes(`Alerted For: ${polymarketUrl}`)) {
    return [];
  }

  const lines = value.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "Tracked Strikes:");
  const end = lines.findIndex((line, index) => index > start && line.startsWith("Resolution:"));
  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  const trackedText = lines.slice(start + 1, end).join(" ");
  if (!trackedText || trackedText === "none") {
    return [];
  }

  return (trackedText.match(/\$[\d,]+(?:\.\d+)?/g) ?? [])
    .map((display) => {
      const value = parseNumber(display.replace("$", ""));
      return value === null ? null : { display, value };
    })
    .filter((strike): strike is PythStrike => strike !== null)
    .sort((left, right) => left.value - right.value);
}

function parseCurrentCrossings(value: string): string[] {
  const lines = value.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "Crossed Strikes:");
  const alertedStart = lines.findIndex((line) => line === "Alerted Strikes:");
  const trackedStart = lines.findIndex((line) => line === "Tracked Strikes:");
  const end = alertedStart === -1 ? trackedStart : alertedStart;
  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  return lines.slice(start + 1, end).filter((line) => line && line !== "none");
}

function dedupeCrossings(crossings: PythStrikeCrossing[]): PythStrikeCrossing[] {
  const seen = new Set<string>();
  const deduped: PythStrikeCrossing[] = [];
  for (const crossing of crossings) {
    const key = `${crossing.display}:${crossing.direction}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(crossing);
    }
  }

  return deduped;
}

function formatCrossing(crossing: PythStrikeCrossing): string {
  return `${crossing.display} crossed ${crossing.direction} on ${crossing.feedName} at ${formatPrice(crossing.price)} (${crossing.timestamp})`;
}

function formatStrikeDisplay(value: number): string {
  return `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  }).format(value)}`;
}

function compareStrikeDisplays(left: string, right: string): number {
  return (parseNumber(left.replace("$", "")) ?? 0) - (parseNumber(right.replace("$", "")) ?? 0);
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/[,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

  return Number(normalized);
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 5,
    minimumFractionDigits: 0
  }).format(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
