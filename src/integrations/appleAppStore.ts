import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import {
  parsePolymarketDateRangeWindow,
  resolveIntegrationPolymarketQueue,
  type PolymarketQueueMarket
} from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { Integration } from "./types.js";

export type AppStoreChartResponse = {
  feed?: {
    updated?: string;
    results?: AppStoreChartResult[];
  };
};

type AppStoreChartResult = {
  name?: string;
  artistName?: string;
};

const appleAppStoreTimeoutMs = 45_000;
const appleAppStoreAttempts = 3;
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const gammaEventsUrl = "https://gamma-api.polymarket.com/events";
const appStoreMarketDiscoveryIntervalMs = 30 * 60_000;

export type AppStoreMarketDiscoveryConfig = {
  chartType: "free" | "paid";
  searchQuery: string;
  lastDiscoveryAtKey: string;
};

type AppStoreDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  [key: string]: unknown;
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
  startDate?: unknown;
  endDate?: unknown;
  creationDate?: unknown;
  createdAt?: unknown;
  tags?: Array<{ slug?: unknown }>;
};

export async function fetchAppleAppStoreChart(feedUrl: string): Promise<AppStoreChartResponse> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= appleAppStoreAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        feedUrl,
        {
          headers: {
            accept: "application/json",
            "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
          }
        },
        appleAppStoreTimeoutMs
      );

      if (!response.ok) {
        throw new Error(`Apple App Store chart returned HTTP ${response.status}`);
      }

      return (await response.json()) as AppStoreChartResponse;
    } catch (error) {
      lastError = error;
      if (attempt < appleAppStoreAttempts) {
        await delay(attempt * 2_000);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function extractAppStoreTopApps(response: AppStoreChartResponse, count: number, chartLabel: string): string {
  const apps = response.feed?.results?.slice(0, count) ?? [];
  if (apps.length < count) {
    throw new Error(`Could not find ${count} ${chartLabel} apps in the Apple App Store chart response`);
  }

  return apps
    .map((app, index) => {
      if (!app.name) {
        throw new Error("Apple App Store chart response included an app without a name");
      }

      return `${index + 1}. ${app.name}`;
    })
    .join("\n");
}

export function shouldAlertOnAppStoreTop2Change(previousValue: string | null, currentValue: string): boolean {
  return getTopTwoLines(previousValue) !== getTopTwoLines(currentValue);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function refreshAppStorePolymarketQueue(
  integration: Integration,
  config: AppStoreMarketDiscoveryConfig,
  now = new Date(),
  force = false
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseAppStoreDiscoverySettings(resolved.settingsJson, config.lastDiscoveryAtKey);
  if (!force && !isDiscoveryDue(settings[config.lastDiscoveryAtKey], now)) {
    return resolved;
  }

  settings = { ...settings, [config.lastDiscoveryAtKey]: now.toISOString() };
  try {
    const existingSlugs = new Set((settings.polymarketMarkets ?? []).map((market) => market.slug));
    for (const candidate of await fetchAppStoreMarketSearchCandidates(config, now)) {
      if (existingSlugs.has(candidate.slug)) {
        continue;
      }

      settings = {
        ...settings,
        polymarketMarkets: upsertAppStoreQueueMarket(settings.polymarketMarkets ?? [], candidate)
      };
      existingSlugs.add(candidate.slug);
    }
  } catch {
    return {
      settingsJson: JSON.stringify(settings),
      activeUrl: resolved.activeUrl
    };
  }

  resolved = resolveIntegrationPolymarketQueue(
    {
      ...integration,
      settingsJson: JSON.stringify(settings),
      polymarketUrl: resolved.activeUrl ?? integration.polymarketUrl
    },
    now
  );
  return resolved;
}

export async function upsertAppStorePolymarketMarket(
  integration: Integration,
  url: string,
  config: AppStoreMarketDiscoveryConfig,
  now = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  const market = (await fetchAppStoreMarketByUrl(url, config, now).catch(() => null)) ?? buildAppStoreQueueMarketFromUrl(url, now, config);
  const settings = parseAppStoreDiscoverySettings(integration.settingsJson, config.lastDiscoveryAtKey);
  return resolveIntegrationPolymarketQueue(
    {
      ...integration,
      settingsJson: JSON.stringify({
        ...settings,
        polymarketMarkets: upsertAppStoreQueueMarket(settings.polymarketMarkets ?? [], market)
      })
    },
    now
  );
}

export function normalizeAppStoreMarketSearchEvent(
  event: GammaSearchEvent,
  config: AppStoreMarketDiscoveryConfig,
  now = new Date()
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

  const slug = event.slug.trim();
  const title = event.title.trim().toLowerCase();
  const titlePattern = new RegExp(`^#?[12]\\s+${config.chartType}\\s+app\\s+in\\s+the\\s+us\\s+apple\\s+app\\s+store\\s+on\\s+`, "i");
  if (!isAppStoreSlugMatchingConfig(slug, config) || !titlePattern.test(title)) {
    return null;
  }

  const tagSlugs = new Set((event.tags ?? []).map((tag) => tag.slug).filter(isNonEmptyString));
  if (!tagSlugs.has("app-store")) {
    return null;
  }

  const fallback = buildAppStoreQueueMarketFromUrl(`https://polymarket.com/event/${slug}`, now);
  return {
    ...fallback,
    startAt:
      parseGammaDate(event.startDate)?.toISOString() ??
      parseGammaDate(event.creationDate)?.toISOString() ??
      parseGammaDate(event.createdAt)?.toISOString() ??
      fallback.startAt,
    endAt: parseGammaDate(event.endDate)?.toISOString() ?? fallback.endAt
  };
}

async function fetchAppStoreMarketSearchCandidates(
  config: AppStoreMarketDiscoveryConfig,
  now: Date
): Promise<PolymarketQueueMarket[]> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", config.searchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? [])
    .map((event) => normalizeAppStoreMarketSearchEvent(event, config, now))
    .filter((market): market is PolymarketQueueMarket => market !== null);
}

async function fetchAppStoreMarketByUrl(
  url: string,
  config: AppStoreMarketDiscoveryConfig,
  now: Date
): Promise<PolymarketQueueMarket | null> {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    return null;
  }

  const response = await fetchWithTimeout(`${gammaEventsUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const events = (await response.json()) as GammaSearchEvent[];
  return normalizeAppStoreMarketSearchEvent(events[0] ?? {}, config, now);
}

function buildAppStoreQueueMarketFromUrl(url: string, now: Date, config?: AppStoreMarketDiscoveryConfig): PolymarketQueueMarket {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${url}`);
  }
  if (config && !isAppStoreSlugMatchingConfig(slug, config)) {
    throw new Error(`Polymarket URL is not a ${config.chartType} App Store market: ${url}`);
  }

  const window = parsePolymarketDateRangeWindow(url, now);
  return {
    url,
    slug,
    startAt: window?.startAt ?? null,
    endAt: window?.endAt ?? null,
    addedAt: now.toISOString()
  };
}

function isAppStoreSlugMatchingConfig(slug: string, config: AppStoreMarketDiscoveryConfig): boolean {
  return new RegExp(`^[12]-${config.chartType}-app-in-the-us-apple-app-store-on-`).test(slug);
}

function parseAppStoreDiscoverySettings(settingsJson: string | null, lastDiscoveryAtKey: string): AppStoreDiscoverySettings {
  const settings = parseSettingsJson(settingsJson) as AppStoreDiscoverySettings;
  return {
    ...settings,
    polymarketMarkets: normalizeAppStoreQueueMarkets(settings.polymarketMarkets),
    [lastDiscoveryAtKey]: typeof settings[lastDiscoveryAtKey] === "string" ? settings[lastDiscoveryAtKey] : undefined
  };
}

function normalizeAppStoreQueueMarkets(value: unknown): PolymarketQueueMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return sortAppStoreQueueMarkets(
    value.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const market = item as Partial<PolymarketQueueMarket>;
      if (!isNonEmptyString(market.url)) {
        return [];
      }

      const slug = isNonEmptyString(market.slug) ? market.slug : getPolymarketSlug(market.url);
      if (!slug) {
        return [];
      }

      return [
        {
          url: market.url,
          slug,
          startAt: typeof market.startAt === "string" ? market.startAt : null,
          endAt: typeof market.endAt === "string" ? market.endAt : null,
          addedAt: typeof market.addedAt === "string" ? market.addedAt : new Date(0).toISOString()
        }
      ];
    })
  );
}

function upsertAppStoreQueueMarket(markets: PolymarketQueueMarket[], market: PolymarketQueueMarket): PolymarketQueueMarket[] {
  const nextMarkets = [...markets];
  const existingIndex = nextMarkets.findIndex((candidate) => candidate.slug === market.slug);
  if (existingIndex === -1) {
    nextMarkets.push(market);
  } else {
    nextMarkets[existingIndex] = { ...nextMarkets[existingIndex], ...market, addedAt: nextMarkets[existingIndex].addedAt };
  }

  return sortAppStoreQueueMarkets(nextMarkets);
}

function sortAppStoreQueueMarkets(markets: PolymarketQueueMarket[]): PolymarketQueueMarket[] {
  return [...markets].sort((left, right) => {
    const leftTime = left.startAt ? Date.parse(left.startAt) : Number.MAX_SAFE_INTEGER;
    const rightTime = right.startAt ? Date.parse(right.startAt) : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime || left.slug.localeCompare(right.slug);
  });
}

function isDiscoveryDue(lastDiscoveryAt: unknown, now: Date): boolean {
  if (typeof lastDiscoveryAt !== "string") {
    return true;
  }

  const lastDiscoveryMs = Date.parse(lastDiscoveryAt);
  return Number.isNaN(lastDiscoveryMs) || now.getTime() - lastDiscoveryMs >= appStoreMarketDiscoveryIntervalMs;
}

function parseGammaDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getTopTwoLines(value: string | null): string {
  return (value ?? "").split(/\r?\n/).slice(0, 2).join("\n");
}
