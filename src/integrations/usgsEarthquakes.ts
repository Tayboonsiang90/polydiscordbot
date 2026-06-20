import { fetchWithTimeout } from "../http.js";
import { parsePolymarketDateRangeWindow, resolveIntegrationPolymarketQueue, type PolymarketQueueMarket, upsertPolymarketQueueUrl } from "../polymarketQueue.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://earthquake.usgs.gov/earthquakes/search/";
const usgsApiUrl = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const defaultPolymarketUrl = "https://polymarket.com/event/how-many-5pt5-or-above-earthquakes-may-4-may-10";
const sevenPlusPolymarketUrl = "https://polymarket.com/event/how-many-7pt0-or-above-earthquakes-by-june-30-higher-strikes";
const sevenPlusYearPolymarketUrl = "https://polymarket.com/event/how-many-7pt0-or-above-earthquakes-in-2026";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const earthquakeMarketSearchQuery = "5.5 earthquakes";
const minimumMagnitude = "5.5";
const sevenPlusMinimumMagnitude = "7.0";
const sevenPlusMarketWindow = {
  startAt: "2025-12-04T17:00:00.000Z",
  endAt: "2026-07-01T03:59:00.000Z"
};
const sevenPlusYearMarketWindow = {
  startAt: "2026-01-01T05:00:00.000Z",
  endAt: "2027-01-01T04:59:00.000Z"
};
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 72 * 60 * 60_000;

type UsgsEarthquakeFeatureCollection = {
  metadata?: {
    count?: number;
    generated?: number;
  };
  features?: UsgsEarthquakeFeature[];
};

type EarthquakeDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastEarthquakeDiscoveryAt?: string;
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

type UsgsEarthquakeCountOptions = {
  metricLabel: string;
  minimumMagnitude: string;
  customWindow?: { startAt: string; endAt: string };
};

export type UsgsEarthquakeFeature = {
  id?: string;
  properties?: {
    mag?: number | null;
    place?: string | null;
    time?: number | null;
    title?: string | null;
    url?: string | null;
  };
  geometry?: {
    coordinates?: [number, number, number?];
  } | null;
};

const fivePointFiveOptions: UsgsEarthquakeCountOptions = {
  metricLabel: "USGS 5.5+ earthquake count",
  minimumMagnitude
};

const sevenPlusOptions: UsgsEarthquakeCountOptions = {
  metricLabel: "USGS 7.0+ earthquake count",
  minimumMagnitude: sevenPlusMinimumMagnitude,
  customWindow: sevenPlusMarketWindow
};

const sevenPlusYearOptions: UsgsEarthquakeCountOptions = {
  metricLabel: "USGS 7.0+ earthquake count in 2026",
  minimumMagnitude: sevenPlusMinimumMagnitude,
  customWindow: sevenPlusYearMarketWindow
};

export function extractUsgsEarthquakeCountValue(
  data: UsgsEarthquakeFeatureCollection,
  polymarketUrl = defaultPolymarketUrl,
  options = fivePointFiveOptions
): string {
  const total = typeof data.metadata?.count === "number" ? data.metadata.count : (data.features?.length ?? 0);
  const events = (data.features ?? []).map(formatUsgsEarthquakeSummary);
  return [
    `Metric: ${options.metricLabel}`,
    `Window ET: ${formatMarketWindow(polymarketUrl, options)}`,
    `Window UTC: ${formatMarketWindowUtc(polymarketUrl, options)}`,
    `Minimum magnitude: ${options.minimumMagnitude}`,
    `Total earthquakes: ${total}`,
    `Events: ${events.length ? events.join(" | ") : "none"}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function formatUsgsEarthquake(feature: UsgsEarthquakeFeature): string {
  const magnitude = feature.properties?.mag;
  const place = feature.properties?.place?.trim() || "unknown location";
  const time = feature.properties?.time ? new Date(feature.properties.time).toISOString() : "unknown";
  const url = feature.properties?.url?.trim() || sourceUrl;
  const depth = feature.geometry?.coordinates?.[2];

  if (magnitude === null || magnitude === undefined || magnitude < 5.5) {
    throw new Error("USGS response did not include a qualifying 5.5+ earthquake");
  }

  return [
    `Event ID: ${feature.id ?? "unknown"}`,
    `Magnitude: ${magnitude}`,
    `Location: ${place}`,
    `Time: ${time}`,
    `Depth: ${depth === undefined ? "unknown" : `${depth} km`}`,
    `USGS: ${url}`
  ].join("\n");
}

export const usgsEarthquakesAdapter: WebsiteAdapter = {
  id: "usgs-earthquakes",
  commandName: "earthquake",
  displayName: "USGS 5.5+ Earthquakes",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/how-many-5pt5-or-above-earthquakes-may-4-may-10",
  defaultChannelName: "earthquake",
  alertRoleName: "USGS Earthquake Alerts",
  alertRoleEmoji: "\uD83C\uDF0E",
  shouldAlertOnChange: shouldAlertOnUsgsEarthquakeCountChange,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshEarthquakePolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const polymarketUrl = integration?.polymarketUrl ?? defaultPolymarketUrl;
    const response = await fetchWithTimeout(buildUsgsApiUrl(polymarketUrl), {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`USGS returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as UsgsEarthquakeFeatureCollection;
    const value = extractUsgsEarthquakeCountValue(data, polymarketUrl);
    return {
      value,
      rawValue: extractUsgsEarthquakeCount(value) ?? value,
      unit: "USGS 5.5+ earthquake count",
      observedAt: new Date()
    };
  }
};

export const usgsSevenPlusEarthquakesAdapter: WebsiteAdapter = {
  id: "usgs-earthquakes-7-plus",
  commandName: "earthquake7",
  displayName: "USGS 7.0+ Earthquakes",
  sourceUrl,
  defaultPolymarketUrl: sevenPlusPolymarketUrl,
  defaultChannelName: "earthquake7",
  alertRoleName: "USGS 7.0 Earthquake Alerts",
  alertRoleEmoji: "\uD83C\uDF0B",
  shouldAlertOnChange: shouldAlertOnUsgsEarthquakeCountChange,
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const polymarketUrl = integration?.polymarketUrl ?? sevenPlusPolymarketUrl;
    const response = await fetchWithTimeout(buildUsgsApiUrl(polymarketUrl, sevenPlusOptions), {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`USGS returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as UsgsEarthquakeFeatureCollection;
    const value = extractUsgsEarthquakeCountValue(data, polymarketUrl, sevenPlusOptions);
    return {
      value,
      rawValue: extractUsgsEarthquakeCount(value) ?? value,
      unit: "USGS 7.0+ earthquake count",
      observedAt: new Date()
    };
  }
};

export const usgsSevenPlusEarthquakesYearAdapter: WebsiteAdapter = {
  id: "usgs-earthquakes-7-plus-2026",
  commandName: "earthquake2026",
  displayName: "USGS 7.0+ Earthquakes 2026",
  sourceUrl,
  defaultPolymarketUrl: sevenPlusYearPolymarketUrl,
  defaultChannelName: "earthquake2026",
  alertRoleName: "USGS 2026 Earthquake Alerts",
  alertRoleEmoji: "\uD83D\uDCC5",
  shouldAlertOnChange: shouldAlertOnUsgsEarthquakeCountChange,
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const polymarketUrl = integration?.polymarketUrl ?? sevenPlusYearPolymarketUrl;
    const response = await fetchWithTimeout(buildUsgsApiUrl(polymarketUrl, sevenPlusYearOptions), {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`USGS returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as UsgsEarthquakeFeatureCollection;
    const value = extractUsgsEarthquakeCountValue(data, polymarketUrl, sevenPlusYearOptions);
    return {
      value,
      rawValue: extractUsgsEarthquakeCount(value) ?? value,
      unit: "USGS 7.0+ earthquake count in 2026",
      observedAt: new Date()
    };
  }
};

export function shouldAlertOnUsgsEarthquakeCountChange(previousValue: string | null, currentValue: string): boolean {
  const currentCount = extractUsgsEarthquakeCount(currentValue);
  const previousCount = extractUsgsEarthquakeCount(previousValue);
  if (currentCount === null || previousCount === null) {
    return false;
  }

  return Number(currentCount) !== Number(previousCount);
}

export const shouldAlertOnUsgsEarthquakeChange = shouldAlertOnUsgsEarthquakeCountChange;

function extractUsgsEarthquakeCount(value: string | null): string | null {
  return value?.match(/^Total earthquakes:\s*(\d+)$/m)?.[1] ?? null;
}

export async function refreshEarthquakePolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseEarthquakeDiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverEarthquakeMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastEarthquakeDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const candidates = await fetchEarthquakeMarketSearchCandidates(now);
    const existingSlugs = new Set((settings.polymarketMarkets ?? []).map((market) => market.slug));
    for (const candidate of candidates) {
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

export function buildUsgsApiUrl(polymarketUrl: string, options = fivePointFiveOptions): string {
  const window = options.customWindow ?? parsePolymarketDateRangeWindow(polymarketUrl);
  if (!window) {
    throw new Error(`Could not parse earthquake market date range from Polymarket URL: ${polymarketUrl}`);
  }

  const url = new URL(usgsApiUrl);
  url.searchParams.set("format", "geojson");
  url.searchParams.set("minmagnitude", options.minimumMagnitude);
  url.searchParams.set("orderby", "time");
  url.searchParams.set("starttime", window.startAt);
  url.searchParams.set("endtime", window.endAt);
  return url.toString();
}

function shouldDiscoverEarthquakeMarkets(settings: EarthquakeDiscoverySettings, now: Date): boolean {
  const markets = normalizeEarthquakeQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastEarthquakeDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

async function fetchEarthquakeMarketSearchCandidates(now: Date): Promise<Array<{ slug: string; url: string }>> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", earthquakeMarketSearchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");
  searchUrl.searchParams.append("events_tag", "earthquakes");

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? [])
    .map((event) => normalizeEarthquakeSearchEvent(event, now))
    .filter((candidate) => candidate !== null);
}

function normalizeEarthquakeSearchEvent(event: GammaSearchEvent, now: Date): { slug: string; url: string } | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  if (
    !event.slug.startsWith("how-many-5pt5-or-above-earthquakes-") ||
    !event.title.toLowerCase().startsWith("how many 5.5 or above earthquakes")
  ) {
    return null;
  }

  const tagSlugs = new Set((event.tags ?? []).map((tag) => tag.slug).filter(isNonEmptyString));
  if (!tagSlugs.has("earthquakes")) {
    return null;
  }

  const url = `https://polymarket.com/event/${event.slug}`;
  return parsePolymarketDateRangeWindow(url, now) ? { slug: event.slug, url } : null;
}

function parseEarthquakeDiscoverySettings(settingsJson: string | null): EarthquakeDiscoverySettings {
  if (!settingsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(settingsJson) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const settings = parsed as EarthquakeDiscoverySettings;
    return {
      ...settings,
      polymarketMarkets: normalizeEarthquakeQueueMarkets(settings.polymarketMarkets),
      lastEarthquakeDiscoveryAt:
        typeof settings.lastEarthquakeDiscoveryAt === "string" ? settings.lastEarthquakeDiscoveryAt : undefined
    };
  } catch {
    return {};
  }
}

function normalizeEarthquakeQueueMarkets(value: unknown): PolymarketQueueMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const market = item as Partial<PolymarketQueueMarket>;
    if (!market.url || !market.slug) {
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

function formatMarketWindow(polymarketUrl: string, options: UsgsEarthquakeCountOptions): string {
  const window = options.customWindow ?? parsePolymarketDateRangeWindow(polymarketUrl);
  if (!window) {
    return "configured";
  }

  return `${formatEasternDateTime(new Date(window.startAt))} to ${formatEasternDateTime(new Date(window.endAt))}`;
}

function formatMarketWindowUtc(polymarketUrl: string, options: UsgsEarthquakeCountOptions): string {
  const window = options.customWindow ?? parsePolymarketDateRangeWindow(polymarketUrl);
  if (!window) {
    return "configured";
  }

  return `${window.startAt} to ${window.endAt}`;
}

function formatUsgsEarthquakeSummary(feature: UsgsEarthquakeFeature): string {
  const magnitude = feature.properties?.mag ?? "unknown magnitude";
  const place = feature.properties?.place?.trim() || "unknown location";
  const time = feature.properties?.time ? new Date(feature.properties.time).toISOString() : "unknown time";
  const id = feature.id ?? "unknown";
  return `${id}: M${magnitude}, ${place}, ${time}`;
}

function formatEasternDateTime(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
