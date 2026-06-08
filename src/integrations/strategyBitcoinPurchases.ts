import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import {
  parsePolymarketDateRangeWindow,
  resolveIntegrationPolymarketQueue,
  type PolymarketQueueMarket,
  upsertPolymarketQueueUrl
} from "../polymarketQueue.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.strategy.com/purchases";
const defaultPolymarketUrl = "https://polymarket.com/event/will-microstrategy-announce-a-bitcoin-purchase-may-12-18";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const strategyMarketSearchQuery = "microstrategy bitcoin purchase";
const strategyMarketSearchTag = "microstrategy";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 72 * 60 * 60_000;

type StrategyPurchaseRow = {
  uid?: string;
  date_of_purchase?: string;
  title?: string;
  count?: number;
  purchase_price?: number;
  total_purchase_price?: number;
  btc_holdings?: number;
  average_price?: number;
  x_post_plain_text?: string;
  sec?: { url?: string; filename?: string };
  publish_details?: { time?: string };
};

type StrategyNextData = {
  props?: {
    pageProps?: {
      bitcoinData?: StrategyPurchaseRow[];
    };
  };
};

type StrategyDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastStrategyDiscoveryAt?: string;
};

type GammaSearchResponse = {
  events?: GammaSearchEvent[];
};

type GammaSearchEvent = {
  slug?: unknown;
  title?: unknown;
  active?: unknown;
  closed?: unknown;
  tags?: Array<{ slug?: unknown }>;
};

export type StrategyBitcoinPurchase = {
  id: string;
  date: string;
  title: string;
  count: number;
  purchasePrice: number | null;
  totalPurchasePrice: number | null;
  btcHoldings: number | null;
  averagePrice: number | null;
  publishedAt: string | null;
  secUrl: string | null;
  xPostText: string | null;
};

export function extractStrategyBitcoinPurchaseValue(html: string, polymarketUrl: string | null, now = new Date()): string {
  const purchases = extractStrategyBitcoinPurchases(html);
  const range = getMarketDateRange(polymarketUrl ?? defaultPolymarketUrl, now);
  const matchingPurchase = range
    ? purchases.find((purchase) => purchase.date >= range.startDate && purchase.date <= range.endDate)
    : purchases[0];

  if (!matchingPurchase) {
    return [
      `Status: no Strategy BTC purchase announced${range ? " in market range" : ""}`,
      ...(range ? [`Market range: ${range.startDate} to ${range.endDate}`] : []),
      `Latest purchase date: ${purchases[0]?.date ?? "none"}`,
      `Latest purchase title: ${purchases[0]?.title ?? "none"}`
    ].join("\n");
  }

  return formatStrategyBitcoinPurchaseValue(matchingPurchase, range);
}

export function extractStrategyBitcoinPurchases(html: string): StrategyBitcoinPurchase[] {
  const nextData = extractNextData(html);
  const rows = nextData.props?.pageProps?.bitcoinData;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Could not find Strategy bitcoin purchase rows");
  }

  return rows
    .map(normalizePurchaseRow)
    .filter((purchase) => purchase !== null)
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function formatStrategyBitcoinPurchaseValue(
  purchase: StrategyBitcoinPurchase,
  range?: { startDate: string; endDate: string } | null
): string {
  return [
    "Status: Strategy BTC purchase announced",
    ...(range ? [`Market range: ${range.startDate} to ${range.endDate}`] : []),
    `Purchase date: ${purchase.date}`,
    `Title: ${purchase.title}`,
    `BTC acquired: ${formatNumber(purchase.count)}`,
    `Average purchase price: ${formatCurrency(purchase.purchasePrice)}`,
    `Purchase value: ${formatCurrency(purchase.totalPurchasePrice)}`,
    `Total BTC holdings: ${formatNumber(purchase.btcHoldings)}`,
    `Average BTC cost: ${formatCurrency(purchase.averagePrice)}`,
    `Published at: ${purchase.publishedAt ?? "not available"}`,
    `SEC filing: ${purchase.secUrl ?? "not available"}`,
    `Post: ${purchase.xPostText ?? "not available"}`
  ].join("\n");
}

export const strategyBitcoinPurchasesAdapter: WebsiteAdapter = {
  id: "strategy-bitcoin-purchases",
  commandName: "strategybtc",
  displayName: "Strategy Bitcoin Purchases",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "strategybtc",
  alertRoleName: "Strategy BTC Alerts",
  alertRoleEmoji: "\uD83E\uDE99",
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshStrategyBitcoinPurchasesPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html"
      }
    });

    if (!response.ok) {
      throw new Error(`Strategy returned HTTP ${response.status}`);
    }

    const value = extractStrategyBitcoinPurchaseValue(await response.text(), integration?.polymarketUrl ?? defaultPolymarketUrl);
    return {
      value,
      rawValue: value,
      unit: "bitcoin purchase announcement",
      observedAt: new Date()
    };
  }
};

export async function refreshStrategyBitcoinPurchasesPolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseStrategyDiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverStrategyMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastStrategyDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const existingSlugs = new Set((settings.polymarketMarkets ?? []).map((market) => market.slug));
    for (const candidate of await fetchStrategyMarketSearchCandidates(now)) {
      if (existingSlugs.has(candidate.slug)) {
        continue;
      }

      resolved = upsertPolymarketQueueUrl(
        {
          ...integration,
          settingsJson: resolved.settingsJson,
          polymarketUrl: resolved.activeUrl ?? integration.polymarketUrl
        },
        candidate.url,
        now
      );
      existingSlugs.add(candidate.slug);
    }

    return resolved;
  } catch {
    return resolved;
  }
}

async function fetchStrategyMarketSearchCandidates(now: Date): Promise<Array<{ slug: string; url: string }>> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", strategyMarketSearchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");
  searchUrl.searchParams.append("events_tag", strategyMarketSearchTag);

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? []).map((event) => normalizeStrategySearchEvent(event, now)).filter((candidate) => candidate !== null);
}

function normalizeStrategySearchEvent(event: GammaSearchEvent, now: Date): { slug: string; url: string } | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  const slug = event.slug.trim();
  const title = event.title.toLowerCase().trim();
  if (!slug.startsWith("will-microstrategy-announce-a-bitcoin-purchase-") || !title.startsWith("will microstrategy announce a bitcoin purchase")) {
    return null;
  }

  const tagSlugs = new Set((event.tags ?? []).map((tag) => tag.slug).filter(isNonEmptyString));
  if (!tagSlugs.has(strategyMarketSearchTag)) {
    return null;
  }

  const url = `https://polymarket.com/event/${slug}`;
  return parsePolymarketDateRangeWindow(url, now) ? { slug, url } : null;
}

function shouldDiscoverStrategyMarkets(settings: StrategyDiscoverySettings, now: Date): boolean {
  const markets = normalizeStrategyQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastStrategyDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

function parseStrategyDiscoverySettings(settingsJson: string | null): StrategyDiscoverySettings {
  if (!settingsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(settingsJson) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const settings = parsed as StrategyDiscoverySettings;
    return {
      ...settings,
      polymarketMarkets: normalizeStrategyQueueMarkets(settings.polymarketMarkets),
      lastStrategyDiscoveryAt: typeof settings.lastStrategyDiscoveryAt === "string" ? settings.lastStrategyDiscoveryAt : undefined
    };
  } catch {
    return {};
  }
}

function normalizeStrategyQueueMarkets(value: unknown): PolymarketQueueMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((market) => {
    if (!market || typeof market !== "object") {
      return [];
    }

    const candidate = market as Partial<PolymarketQueueMarket>;
    if (!isNonEmptyString(candidate.url) || !isNonEmptyString(candidate.slug)) {
      return [];
    }

    return [
      {
        url: candidate.url,
        slug: candidate.slug,
        startAt: typeof candidate.startAt === "string" ? candidate.startAt : null,
        endAt: typeof candidate.endAt === "string" ? candidate.endAt : null,
        addedAt: typeof candidate.addedAt === "string" ? candidate.addedAt : new Date(0).toISOString()
      }
    ];
  });
}

function hasQueuedFutureMarket(markets: PolymarketQueueMarket[], now: Date): boolean {
  const nowMs = now.getTime();
  return markets.some((market) => Boolean(market.startAt) && Date.parse(market.startAt!) > nowMs);
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

function extractNextData(html: string): StrategyNextData {
  const $ = cheerio.load(html);
  const json = $("#__NEXT_DATA__").first().text();
  if (!json) {
    throw new Error("Could not find Strategy Next.js data");
  }

  try {
    return JSON.parse(json) as StrategyNextData;
  } catch {
    throw new Error("Could not parse Strategy Next.js data");
  }
}

function normalizePurchaseRow(row: StrategyPurchaseRow): StrategyBitcoinPurchase | null {
  if (!row.date_of_purchase || typeof row.count !== "number") {
    return null;
  }

  return {
    id: row.uid ?? row.date_of_purchase,
    date: row.date_of_purchase,
    title: row.title ?? row.date_of_purchase,
    count: row.count,
    purchasePrice: numberOrNull(row.purchase_price),
    totalPurchasePrice: numberOrNull(row.total_purchase_price),
    btcHoldings: numberOrNull(row.btc_holdings),
    averagePrice: numberOrNull(row.average_price),
    publishedAt: row.publish_details?.time ?? null,
    secUrl: row.sec?.url ?? null,
    xPostText: row.x_post_plain_text ?? null
  };
}

function getMarketDateRange(polymarketUrl: string, now: Date): { startDate: string; endDate: string } | null {
  const window = parsePolymarketDateRangeWindow(polymarketUrl, now);
  if (!window) {
    return null;
  }

  return {
    startDate: formatEasternDate(new Date(window.startAt)),
    endDate: formatEasternDate(new Date(window.endAt))
  };
}

function formatEasternDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatNumber(value: number | null): string {
  return value === null ? "not available" : new Intl.NumberFormat("en-US").format(value);
}

function formatCurrency(value: number | null): string {
  if (value === null) {
    return "not available";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
