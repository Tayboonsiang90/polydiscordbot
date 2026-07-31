import { fetchWithTimeout } from "../http.js";
import { parsePolymarketDateRangeWindow, resolveIntegrationPolymarketQueue, type PolymarketQueueMarket, upsertPolymarketQueueUrl } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 72 * 60 * 60_000;
const pythFeedCacheMs = 5 * 60_000;
const pythMinimumRequestSpacingMs = 350;
const pythHttpRetryAttempts = 4;
const officialPythApiBaseUrl = "https://pyth.dourolabs.app/v1";
const officialPythHistoryChannel = "fixed_rate@1000ms";
const pythFeedCache = new Map<string, { feed: PythPriceFeed; expiresAt: number }>();
let pythRequestQueue: Promise<void> = Promise.resolve();
let lastPythRequestAt = 0;

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
  triggerDirection?: "up" | "down";
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
    const strikeKey = strike ? `${strike.triggerDirection ?? "either"}:${strike.display}` : "";
    if (strike && !seen.has(strikeKey)) {
      seen.add(strikeKey);
      strikes.push(strike);
    }
  }

  return strikes.sort((left, right) => left.value - right.value);
}

export function extractTopPythFeed(data: unknown, feedNamePattern: RegExp): PythPriceFeed | null {
  const rows = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.data) ? data.data : null;
  if (!rows) {
    return null;
  }

  return (
    rows
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
  if (isRecord(data) && Array.isArray(data.t) && Array.isArray(data.h) && Array.isArray(data.l) && Array.isArray(data.c)) {
    const rowCount = Math.min(data.t.length, data.h.length, data.l.length, data.c.length);
    const candles: PythCandle[] = [];
    for (let index = 0; index < rowCount; index += 1) {
      const timestampSeconds = parseNumber(data.t[index]);
      const high = parseNumber(data.h[index]);
      const low = parseNumber(data.l[index]);
      const close = parseNumber(data.c[index]);
      if (timestampSeconds !== null && high !== null && low !== null && close !== null) {
        candles.push({
          high,
          low,
          close,
          timestamp: new Date(timestampSeconds * 1_000).toISOString()
        });
      }
    }
    return candles;
  }

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
      if (strike.triggerDirection !== "down" && referencePrice < strike.value && candle.high >= strike.value) {
        crossings.push({ ...strike, direction: "up", feedName: feed.name, price: candle.high, timestamp: candle.timestamp });
      } else if (strike.triggerDirection !== "up" && referencePrice > strike.value && candle.low <= strike.value) {
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
    input.strikes.length > 0 ? input.strikes.map(formatTrackedStrike).join(", ") : "none",
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
  const query = config.priceFeedsQuery ?? config.search;
  const cached = pythFeedCache.get(query);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.feed;
  }

  let feed: PythPriceFeed | null = null;
  try {
    const officialResponse = await fetchPythDependencyWithRetry(buildOfficialPythSymbolsUrl(query), {
      headers: buildPythHeaders()
    });
    if (officialResponse.ok) {
      feed = extractTopPythFeed(await parsePythJsonResponse(officialResponse), config.feedNamePattern);
    }
  } catch {
    feed = null;
  }

  if (!feed) {
    const response = await fetchPythDependencyWithRetry(buildPythPriceFeedsUrl(query), {
      headers: buildPythHeaders()
    });
    if (!response.ok) {
      throw new Error(`Pyth price-feeds endpoint returned HTTP ${response.status}`);
    }
    feed = extractTopPythFeed(await parsePythJsonResponse(response), config.feedNamePattern);
  }

  if (!feed) {
    throw new Error(`Could not find the top active ${config.search} Pyth feed`);
  }

  pythFeedCache.set(query, { feed, expiresAt: Date.now() + pythFeedCacheMs });
  return feed;
}

async function fetchPythCandles(feed: PythPriceFeed, range: { from?: Date; to?: Date }): Promise<PythCandle[]> {
  const apiKey = process.env.PYTH_PRO_API_KEY?.trim();
  const response = await fetchPythDependencyWithRetry(
    apiKey ? buildOfficialHistoryUrl(feed.symbol, range) : buildHistoryUrl(feed.symbol, range),
    {
      headers: buildPythHeaders(apiKey)
    }
  );
  if (!response.ok) {
    const keyHint =
      !apiKey && (response.status === 401 || response.status === 403)
        ? " Add PYTH_PRO_API_KEY to .env for Pyth's authenticated history API."
        : "";
    throw new Error(`Pyth history endpoint returned HTTP ${response.status} for ${feed.name}.${keyHint}`);
  }

  return extractPythCandles(await parsePythJsonResponse(response));
}

export async function fetchPythDependencyWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown = null;
  let lastResponse: Response | null = null;
  for (let attempt = 1; attempt <= pythHttpRetryAttempts; attempt += 1) {
    try {
      const response = await queuePythRequest(() => fetchWithTimeout(url, init, 30_000));
      if (response.status !== 429 && response.status < 500) {
        return response;
      }

      lastResponse = response;
      if (attempt < pythHttpRetryAttempts) {
        await delay(getPythRetryDelayMs(response, attempt));
      }
    } catch (error) {
      lastError = error;
      if (attempt < pythHttpRetryAttempts) {
        await delay(attempt * 1_000);
      }
    }
  }

  if (lastResponse) {
    return lastResponse;
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function queuePythRequest(operation: () => Promise<Response>): Promise<Response> {
  let releaseQueue: () => void = () => undefined;
  const previous = pythRequestQueue;
  pythRequestQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await previous;

  try {
    const waitMs = Math.max(0, lastPythRequestAt + pythMinimumRequestSpacingMs - Date.now());
    if (waitMs > 0) {
      await delay(waitMs);
    }
    lastPythRequestAt = Date.now();
    return await operation();
  } finally {
    releaseQueue();
  }
}

function getPythRetryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1_000;
    }

    const retryAt = Date.parse(retryAfter);
    if (!Number.isNaN(retryAt)) {
      return Math.max(0, retryAt - Date.now());
    }
  }

  return attempt * 2_000;
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

function buildOfficialPythSymbolsUrl(search: string): string {
  return `${officialPythApiBaseUrl}/symbols?query=${encodeURIComponent(search)}`;
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

function buildOfficialHistoryUrl(symbol: string, range: { from?: Date; to?: Date }): string {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const url = new URL(`${officialPythApiBaseUrl}/${encodeURIComponent(officialPythHistoryChannel)}/history`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("resolution", "1");
  url.searchParams.set("from", String(Math.floor((range.from?.getTime() ?? Date.now() - 15 * 60_000) / 1_000)));
  url.searchParams.set("to", String(Math.floor((range.to?.getTime() ?? nowSeconds * 1_000) / 1_000)));
  return url.toString();
}

function buildPythHeaders(apiKey?: string): Record<string, string> {
  return {
    accept: "application/json",
    "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
  };
}

async function parsePythJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const checkpoint = /Vercel Security Checkpoint|<!DOCTYPE html/i.test(text);
    throw new Error(
      checkpoint
        ? "Pyth Data returned a browser security checkpoint. Add PYTH_PRO_API_KEY to .env for the official authenticated history API."
        : "Pyth returned a non-JSON response."
    );
  }
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
        value,
        ...(getStrikeTriggerDirection(text) ? { triggerDirection: getStrikeTriggerDirection(text)! } : {})
      }
    : null;
}

function getStrikeTriggerDirection(text: string): "up" | "down" | null {
  if (/\bHIGH\b/i.test(text) || text.includes("↑")) {
    return "up";
  }
  if (/\bLOW\b/i.test(text) || text.includes("↓")) {
    return "down";
  }
  return null;
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

  return (trackedText.match(/(?:[↑↓]\s*)?\$[\d,]+(?:\.\d+)?/g) ?? [])
    .map((trackedStrike) => {
      const display = trackedStrike.match(/\$[\d,]+(?:\.\d+)?/)?.[0];
      const value = display ? parseNumber(display.replace("$", "")) : null;
      const triggerDirection = trackedStrike.includes("↑") ? "up" : trackedStrike.includes("↓") ? "down" : undefined;
      return value === null || !display ? null : { display, value, ...(triggerDirection ? { triggerDirection } : {}) };
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

function formatTrackedStrike(strike: PythStrike): string {
  return `${strike.triggerDirection === "up" ? "↑ " : strike.triggerDirection === "down" ? "↓ " : ""}${strike.display}`;
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
