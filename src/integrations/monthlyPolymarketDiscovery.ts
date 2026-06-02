import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import {
  parsePolymarketMonthWindow,
  resolveIntegrationPolymarketQueue,
  type PolymarketQueueMarket,
  upsertPolymarketQueueUrl
} from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { Integration } from "./types.js";

const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const defaultActiveIntervalMs = 2 * 60 * 60_000;
const defaultNoActiveIntervalMs = 30 * 60_000;
const defaultLookaheadMs = 7 * 24 * 60 * 60_000;

export type MonthlyPolymarketDiscoveryConfig = {
  searchQuery: string;
  slugPrefix: string;
  titlePrefix: string;
  lastDiscoveryAtKey: string;
  requiredTagSlugs?: string[];
  excludedSlugPrefixes?: string[];
  activeIntervalMs?: number;
  noActiveIntervalMs?: number;
  lookaheadMs?: number;
};

type MonthlyDiscoverySettings = {
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
  tags?: Array<{ slug?: unknown }>;
};

export async function refreshMonthlyPolymarketQueue(
  integration: Integration,
  config: MonthlyPolymarketDiscoveryConfig,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = syncMonthlyPeriod(
    resolveIntegrationPolymarketQueue(integration, now),
    integration.polymarketUrl,
    now
  );
  let settings = parseMonthlyDiscoverySettings(resolved.settingsJson, config.lastDiscoveryAtKey);
  if (!shouldDiscoverMonthlyMarkets(settings, config, now)) {
    return resolved;
  }

  settings = { ...settings, [config.lastDiscoveryAtKey]: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const existingSlugs = new Set((settings.polymarketMarkets ?? []).map((market) => market.slug));
    for (const candidate of await fetchMonthlyMarketSearchCandidates(config, now)) {
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

    return syncMonthlyPeriod(resolved, integration.polymarketUrl, now);
  } catch {
    return resolved;
  }
}

function syncMonthlyPeriod(
  resolved: { settingsJson: string | null; activeUrl: string | null },
  fallbackUrl: string | null,
  now: Date
): { settingsJson: string | null; activeUrl: string | null } {
  const activeUrl = resolved.activeUrl ?? fallbackUrl;
  const window = activeUrl ? parsePolymarketMonthWindow(activeUrl, now) : null;
  if (!window) {
    return resolved;
  }

  return {
    ...resolved,
    settingsJson: JSON.stringify({
      ...parseSettingsJson(resolved.settingsJson),
      year: window.year,
      month: window.month
    })
  };
}

function shouldDiscoverMonthlyMarkets(
  settings: MonthlyDiscoverySettings,
  config: MonthlyPolymarketDiscoveryConfig,
  now: Date
): boolean {
  const markets = normalizeMonthlyQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? config.activeIntervalMs ?? defaultActiveIntervalMs : config.noActiveIntervalMs ?? defaultNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings[config.lastDiscoveryAtKey], now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= (config.lookaheadMs ?? defaultLookaheadMs);
}

async function fetchMonthlyMarketSearchCandidates(
  config: MonthlyPolymarketDiscoveryConfig,
  now: Date
): Promise<Array<{ slug: string; url: string }>> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", config.searchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");
  for (const tagSlug of config.requiredTagSlugs ?? []) {
    searchUrl.searchParams.append("events_tag", tagSlug);
  }

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? [])
    .map((event) => normalizeMonthlySearchEvent(event, config, now))
    .filter((candidate) => candidate !== null);
}

function normalizeMonthlySearchEvent(
  event: GammaSearchEvent,
  config: MonthlyPolymarketDiscoveryConfig,
  now: Date
): { slug: string; url: string } | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  const slug = event.slug.trim();
  const title = event.title.toLowerCase().trim();
  if (
    !slug.startsWith(config.slugPrefix) ||
    !title.startsWith(config.titlePrefix.toLowerCase()) ||
    (config.excludedSlugPrefixes ?? []).some((prefix) => slug.startsWith(prefix))
  ) {
    return null;
  }

  const tagSlugs = new Set((event.tags ?? []).map((tag) => tag.slug).filter(isNonEmptyString));
  if ((config.requiredTagSlugs ?? []).some((tagSlug) => !tagSlugs.has(tagSlug))) {
    return null;
  }

  const url = `https://polymarket.com/event/${slug}`;
  return parsePolymarketMonthWindow(url, now) ? { slug, url } : null;
}

function parseMonthlyDiscoverySettings(settingsJson: string | null, lastDiscoveryAtKey: string): MonthlyDiscoverySettings {
  const settings = parseSettingsJson(settingsJson) as MonthlyDiscoverySettings;
  return {
    ...settings,
    polymarketMarkets: normalizeMonthlyQueueMarkets(settings.polymarketMarkets),
    [lastDiscoveryAtKey]:
      typeof settings[lastDiscoveryAtKey] === "string" ? settings[lastDiscoveryAtKey] : undefined
  };
}

function normalizeMonthlyQueueMarkets(value: unknown): PolymarketQueueMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
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

function isDiscoveryIntervalDue(lastDiscoveryAt: unknown, now: Date, intervalMs: number): boolean {
  if (typeof lastDiscoveryAt !== "string") {
    return true;
  }

  const lastDiscoveryMs = Date.parse(lastDiscoveryAt);
  return Number.isNaN(lastDiscoveryMs) || now.getTime() - lastDiscoveryMs >= intervalMs;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
