import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import type { PolymarketQueueMarket } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { Integration } from "./types.js";

const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const gammaEventsUrl = "https://gamma-api.polymarket.com/events";
const defaultActiveIntervalMs = 2 * 60 * 60_000;
const defaultNoActiveIntervalMs = 30 * 60_000;

export type GammaPolymarketDiscoveryConfig = {
  searchQuery: string;
  slugPrefixes: string[];
  titlePrefixes?: string[];
  lastDiscoveryAtKey: string;
  activeIntervalMs?: number;
  noActiveIntervalMs?: number;
  limit?: number;
};

type GammaSearchResponse = {
  events?: GammaEvent[];
};

type GammaEvent = {
  slug?: unknown;
  title?: unknown;
  active?: unknown;
  closed?: unknown;
  startDate?: unknown;
  creationDate?: unknown;
  createdAt?: unknown;
  endDate?: unknown;
  endDateIso?: unknown;
};

export async function refreshGammaPolymarketQueue(
  integration: Integration,
  config: GammaPolymarketDiscoveryConfig,
  now = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  const settings = parseSettingsJson(integration.settingsJson);
  let markets = normalizeQueueMarkets(settings.polymarketMarkets);
  const activeUrl = selectActiveMarket(markets, now)?.url ?? integration.polymarketUrl;
  const lastDiscoveryAt = settings[config.lastDiscoveryAtKey];
  const intervalMs = selectActiveMarket(markets, now)
    ? config.activeIntervalMs ?? defaultActiveIntervalMs
    : config.noActiveIntervalMs ?? defaultNoActiveIntervalMs;

  if (!isDiscoveryDue(lastDiscoveryAt, now, intervalMs)) {
    return {
      settingsJson: JSON.stringify({ ...settings, polymarketMarkets: markets }),
      activeUrl
    };
  }

  const nextSettings = { ...settings, [config.lastDiscoveryAtKey]: now.toISOString() };
  try {
    const candidates = await fetchSearchCandidates(config, now);
    markets = mergeQueueMarkets(markets, candidates);
    markets = pruneExpiredMarkets(markets, now);
    return {
      settingsJson: JSON.stringify({ ...nextSettings, polymarketMarkets: markets }),
      activeUrl: selectActiveMarket(markets, now)?.url ?? integration.polymarketUrl
    };
  } catch {
    return {
      settingsJson: JSON.stringify({ ...nextSettings, polymarketMarkets: markets }),
      activeUrl
    };
  }
}

export async function upsertGammaPolymarketQueueUrl(
  integration: Integration,
  url: string,
  config: GammaPolymarketDiscoveryConfig,
  now = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  const settings = parseSettingsJson(integration.settingsJson);
  const markets = normalizeQueueMarkets(settings.polymarketMarkets);
  const slug = getPolymarketSlug(url);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${url}`);
  }

  let candidate: PolymarketQueueMarket = {
    url,
    slug,
    startAt: now.toISOString(),
    endAt: null,
    addedAt: now.toISOString()
  };

  try {
    const response = await fetchWithTimeout(`${gammaEventsUrl}?slug=${encodeURIComponent(slug)}`, {
      headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
    });
    if (response.ok) {
      const payload = (await response.json()) as unknown;
      const event = Array.isArray(payload) ? (payload[0] as GammaEvent | undefined) : undefined;
      candidate = normalizeGammaEvent(event, config, now) ?? candidate;
    }
  } catch {
    // Keep the manually supplied URL even if Gamma is temporarily unavailable.
  }

  const merged = mergeQueueMarkets(markets, [candidate]);
  return {
    settingsJson: JSON.stringify({ ...settings, polymarketMarkets: merged }),
    activeUrl: selectActiveMarket(merged, now)?.url ?? url
  };
}

function fetchSearchCandidates(
  config: GammaPolymarketDiscoveryConfig,
  now: Date
): Promise<PolymarketQueueMarket[]> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", config.searchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", String(config.limit ?? 10));

  return fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as GammaSearchResponse;
    return (payload.events ?? [])
      .map((event) => normalizeGammaEvent(event, config, now))
      .filter((market): market is PolymarketQueueMarket => market !== null);
  });
}

function normalizeGammaEvent(
  event: GammaEvent | undefined,
  config: GammaPolymarketDiscoveryConfig,
  now: Date
): PolymarketQueueMarket | null {
  if (
    !event ||
    event.active === false ||
    event.closed === true ||
    !isNonEmptyString(event.slug) ||
    !isNonEmptyString(event.title)
  ) {
    return null;
  }

  const slug = event.slug.trim();
  const title = event.title.trim().toLowerCase();
  if (
    !config.slugPrefixes.some((prefix) => slug.startsWith(prefix)) ||
    (config.titlePrefixes?.length &&
      !config.titlePrefixes.some((prefix) => title.startsWith(prefix.toLowerCase())))
  ) {
    return null;
  }

  const startAt =
    parseGammaDate(event.startDate) ??
    parseGammaDate(event.creationDate) ??
    parseGammaDate(event.createdAt) ??
    now;
  const endAt = parseGammaDate(event.endDate) ?? parseGammaDate(event.endDateIso);
  return {
    url: `https://polymarket.com/event/${slug}`,
    slug,
    startAt: startAt.toISOString(),
    endAt: endAt?.toISOString() ?? null,
    addedAt: now.toISOString()
  };
}

function normalizeQueueMarkets(value: unknown): PolymarketQueueMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return sortMarkets(
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

      return [{
        url: market.url,
        slug,
        startAt: isNonEmptyString(market.startAt) ? market.startAt : null,
        endAt: isNonEmptyString(market.endAt) ? market.endAt : null,
        addedAt: isNonEmptyString(market.addedAt) ? market.addedAt : new Date(0).toISOString()
      }];
    })
  );
}

function mergeQueueMarkets(
  existing: PolymarketQueueMarket[],
  candidates: PolymarketQueueMarket[]
): PolymarketQueueMarket[] {
  const bySlug = new Map(existing.map((market) => [market.slug, market]));
  for (const candidate of candidates) {
    const previous = bySlug.get(candidate.slug);
    bySlug.set(candidate.slug, {
      ...previous,
      ...candidate,
      addedAt: previous?.addedAt ?? candidate.addedAt
    });
  }
  return sortMarkets([...bySlug.values()]);
}

function pruneExpiredMarkets(markets: PolymarketQueueMarket[], now: Date): PolymarketQueueMarket[] {
  const cutoff = now.getTime() - 24 * 60 * 60_000;
  return markets.filter((market) => !market.endAt || Date.parse(market.endAt) >= cutoff);
}

function selectActiveMarket(markets: PolymarketQueueMarket[], now: Date): PolymarketQueueMarket | null {
  const nowMs = now.getTime();
  return (
    markets
      .filter((market) => {
        const startMs = market.startAt ? Date.parse(market.startAt) : Number.NEGATIVE_INFINITY;
        const endMs = market.endAt ? Date.parse(market.endAt) : Number.POSITIVE_INFINITY;
        return startMs <= nowMs && endMs >= nowMs;
      })
      .sort((left, right) => {
        const leftEnd = left.endAt ? Date.parse(left.endAt) : Number.MAX_SAFE_INTEGER;
        const rightEnd = right.endAt ? Date.parse(right.endAt) : Number.MAX_SAFE_INTEGER;
        return leftEnd - rightEnd || left.slug.localeCompare(right.slug);
      })[0] ?? null
  );
}

function sortMarkets(markets: PolymarketQueueMarket[]): PolymarketQueueMarket[] {
  return [...markets].sort((left, right) => {
    const leftStart = left.startAt ? Date.parse(left.startAt) : Number.MAX_SAFE_INTEGER;
    const rightStart = right.startAt ? Date.parse(right.startAt) : Number.MAX_SAFE_INTEGER;
    return leftStart - rightStart || left.slug.localeCompare(right.slug);
  });
}

function isDiscoveryDue(lastDiscoveryAt: unknown, now: Date, intervalMs: number): boolean {
  if (typeof lastDiscoveryAt !== "string") {
    return true;
  }
  const timestamp = Date.parse(lastDiscoveryAt);
  return Number.isNaN(timestamp) || now.getTime() - timestamp >= intervalMs;
}

function parseGammaDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
