import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import { resolveIntegrationPolymarketQueue, type PolymarketQueueMarket } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.cdc.gov/measles/data-research/index.html";
const measlesCounterUrl = "https://www.cdc.gov/wcms/vizdata/measles/measles_hosp.json";
const defaultPolymarketUrl = "https://polymarket.com/event/measles-cases-in-us-by-june-30";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const gammaEventsUrl = "https://gamma-api.polymarket.com/events";
const measlesMarketSearchQuery = "measles cases";
const marketDiscoveryIntervalMs = 30 * 60_000;

type CdcMeaslesCounterJson = Record<string, { total_cases?: unknown }>;
type CdcMeaslesSettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastMeaslesDiscoveryAt?: string;
};
type GammaSearchResponse = {
  events?: GammaSearchEvent[];
};
type GammaEventResponse = GammaSearchEvent[];
type GammaSearchEvent = {
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

export type CdcMeaslesCounter = {
  totalCases: number;
  asOfDate?: string;
};

export function extractCdcMeaslesCounterFromJson(payload: unknown, year = "2026"): CdcMeaslesCounter {
  const yearData = payload && typeof payload === "object" ? (payload as CdcMeaslesCounterJson)[year] : undefined;
  const totalCases = parseCounterValue(Array.isArray(yearData?.total_cases) ? yearData?.total_cases[0] : yearData?.total_cases);
  if (totalCases === null) {
    throw new Error(`Could not find CDC measles ${year} total_cases counter`);
  }

  return { totalCases };
}

export function extractCdcMeaslesAsOfDate(html: string): string | undefined {
  const $ = cheerio.load(html);
  const text = $.root().text().replace(/\s+/g, " ").trim();
  const match = text.match(/As of ([A-Z][a-z]+ \d{1,2}, \d{4}),\s*[\d,]+\s+confirmed\*?\s+measles cases were reported/i);
  return match?.[1];
}

export function extractCdcMeaslesCounterFromHtml(html: string): CdcMeaslesCounter {
  const $ = cheerio.load(html);
  const text = $.root().text().replace(/\s+/g, " ").trim();
  const match = text.match(/As of ([A-Z][a-z]+ \d{1,2}, \d{4}),\s*([\d,]+)\s+confirmed\*?\s+measles cases were reported/i);
  if (!match) {
    throw new Error("Could not find CDC measles confirmed case sentence");
  }

  return {
    totalCases: Number(match[2].replace(/,/g, "")),
    asOfDate: match[1]
  };
}

export function formatCdcMeaslesValue(counter: CdcMeaslesCounter, markets: PolymarketQueueMarket[] = []): string {
  const lines = [
    "Metric: CDC confirmed U.S. measles cases in 2026",
    `Total cases: ${formatInteger(counter.totalCases)}`,
    `As of: ${counter.asOfDate ?? "not listed"}`
  ];

  const activeMarkets = markets.filter((market) => market.endAt === null || Date.parse(market.endAt) >= Date.now());
  if (activeMarkets.length > 0) {
    lines.push(
      "Tracked Polymarket markets:",
      ...activeMarkets.map((market, index) => `${index + 1}. ${formatMeaslesMarketLabel(market)} - ${market.url}`)
    );
  }

  return lines.join("\n");
}

export const cdcMeaslesAdapter: WebsiteAdapter = {
  id: "cdc-measles",
  commandName: "measles",
  displayName: "CDC Measles Cases",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "measles",
  alertRoleName: "CDC Measles Alerts",
  alertRoleEmoji: "\uD83E\uDDA0",
  shouldAlertOnChange: shouldAlertOnCdcMeaslesChange,
  async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
    return (await refreshCdcMeaslesPolymarketQueue(integration, new Date(), options?.force ?? false)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async upsertPolymarketMarket(
    integration: Integration,
    url: string
  ): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertCdcMeaslesPolymarketQueueUrl(integration, url);
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const [counterResponse, pageResponse] = await Promise.all([
      fetchWithTimeout(measlesCounterUrl, {
        headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
      }),
      fetchWithTimeout(sourceUrl, {
        headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
      })
    ]);

    if (!counterResponse.ok) {
      throw new Error(`CDC measles counter returned HTTP ${counterResponse.status}`);
    }
    if (!pageResponse.ok) {
      throw new Error(`CDC measles page returned HTTP ${pageResponse.status}`);
    }

    const counter = extractCdcMeaslesCounterFromJson(await counterResponse.json());
    const asOfDate = extractCdcMeaslesAsOfDate(await pageResponse.text());
    const value = formatCdcMeaslesValue({ ...counter, asOfDate }, integration ? getCdcMeaslesQueuedMarkets(integration) : []);
    return {
      value,
      rawValue: String(counter.totalCases),
      unit: "confirmed cases",
      observedAt: new Date()
    };
  }
};

export function shouldAlertOnCdcMeaslesChange(previousValue: string | null, currentValue: string): boolean {
  return extractComparableCdcMeaslesValue(previousValue) !== extractComparableCdcMeaslesValue(currentValue);
}

export async function refreshCdcMeaslesPolymarketQueue(
  integration: Integration,
  now = new Date(),
  force = false
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseCdcMeaslesSettings(resolved.settingsJson);
  if (!force && !shouldDiscoverCdcMeaslesMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastMeaslesDiscoveryAt: now.toISOString() };
  resolved = { settingsJson: JSON.stringify(settings), activeUrl: resolved.activeUrl };

  try {
    const markets = normalizeCdcMeaslesQueueMarkets(settings.polymarketMarkets);
    for (const candidate of await fetchCdcMeaslesMarketSearchCandidates(now)) {
      const existingIndex = markets.findIndex((market) => market.slug === candidate.slug);
      if (existingIndex === -1) {
        markets.push(candidate);
      } else {
        markets[existingIndex] = { ...markets[existingIndex], ...candidate, addedAt: markets[existingIndex].addedAt };
      }
    }

    settings = { ...settings, polymarketMarkets: sortMarkets(pruneExpiredMarkets(markets, now)) };
    return resolveIntegrationPolymarketQueue(
      {
        ...integration,
        settingsJson: JSON.stringify(settings),
        polymarketUrl: resolved.activeUrl ?? integration.polymarketUrl
      },
      now
    );
  } catch {
    return resolved;
  }
}

export async function upsertCdcMeaslesPolymarketQueueUrl(
  integration: Integration,
  url: string,
  now = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  const settings = parseCdcMeaslesSettings(integration.settingsJson);
  const markets = normalizeCdcMeaslesQueueMarkets(settings.polymarketMarkets);
  const market = (await fetchCdcMeaslesMarketByUrl(url, now).catch(() => null)) ?? buildCdcMeaslesQueueMarketFromUrl(url, now);
  const existingIndex = markets.findIndex((candidate) => candidate.slug === market.slug);
  if (existingIndex === -1) {
    markets.push(market);
  } else {
    markets[existingIndex] = { ...markets[existingIndex], ...market, addedAt: markets[existingIndex].addedAt };
  }

  return resolveIntegrationPolymarketQueue(
    {
      ...integration,
      settingsJson: JSON.stringify({
        ...settings,
        polymarketMarkets: sortMarkets(pruneExpiredMarkets(markets, now))
      })
    },
    now
  );
}

function parseCounterValue(value: unknown): number | null {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  return Number(normalized);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

async function fetchCdcMeaslesMarketSearchCandidates(now: Date): Promise<PolymarketQueueMarket[]> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", measlesMarketSearchQuery);
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
    .map((event) => normalizeCdcMeaslesSearchEvent(event, now))
    .filter((candidate): candidate is PolymarketQueueMarket => candidate !== null);
}

async function fetchCdcMeaslesMarketByUrl(url: string, now: Date): Promise<PolymarketQueueMarket | null> {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    return null;
  }

  const response = await fetchWithTimeout(`${gammaEventsUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma event lookup returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaEventResponse;
  const event = payload.find((candidate) => candidate.slug === slug) ?? payload[0];
  return event ? buildCdcMeaslesQueueMarketFromGammaEvent(event, now) : null;
}

function normalizeCdcMeaslesSearchEvent(event: GammaSearchEvent, now: Date): PolymarketQueueMarket | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  const slug = event.slug.trim();
  const title = normalizeText(event.title);
  if (!slug.startsWith("measles-cases-in-") && !/^measles cases in u\.?s\.?/i.test(title)) {
    return null;
  }

  return buildCdcMeaslesQueueMarketFromGammaEvent(event, now);
}

function buildCdcMeaslesQueueMarketFromGammaEvent(event: GammaSearchEvent, now: Date): PolymarketQueueMarket {
  if (!isNonEmptyString(event.slug)) {
    throw new Error("CDC measles Gamma event is missing a slug");
  }

  const slug = event.slug.trim();
  return {
    url: `https://polymarket.com/event/${slug}`,
    slug,
    startAt: parseGammaDate(event.startDate)?.toISOString() ?? parseGammaDate(event.creationDate)?.toISOString() ?? parseGammaDate(event.createdAt)?.toISOString() ?? now.toISOString(),
    endAt: parseGammaDate(event.endDate)?.toISOString() ?? parseGammaDate(event.endDateIso)?.toISOString() ?? null,
    addedAt: now.toISOString()
  };
}

function buildCdcMeaslesQueueMarketFromUrl(url: string, now: Date): PolymarketQueueMarket {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${url}`);
  }

  return {
    url,
    slug,
    startAt: now.toISOString(),
    endAt: null,
    addedAt: now.toISOString()
  };
}

function parseCdcMeaslesSettings(settingsJson: string | null): CdcMeaslesSettings {
  const settings = parseSettingsJson(settingsJson) as CdcMeaslesSettings;
  return {
    ...settings,
    polymarketMarkets: normalizeCdcMeaslesQueueMarkets(settings.polymarketMarkets),
    lastMeaslesDiscoveryAt: typeof settings.lastMeaslesDiscoveryAt === "string" ? settings.lastMeaslesDiscoveryAt : undefined
  };
}

function normalizeCdcMeaslesQueueMarkets(value: unknown): PolymarketQueueMarket[] {
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

function getCdcMeaslesQueuedMarkets(integration: Integration): PolymarketQueueMarket[] {
  return normalizeCdcMeaslesQueueMarkets(parseSettingsJson(integration.settingsJson).polymarketMarkets);
}

function shouldDiscoverCdcMeaslesMarkets(settings: CdcMeaslesSettings, now: Date): boolean {
  if (normalizeCdcMeaslesQueueMarkets(settings.polymarketMarkets).length === 0) {
    return true;
  }

  const lastDiscoveryMs = Date.parse(settings.lastMeaslesDiscoveryAt ?? "");
  return Number.isNaN(lastDiscoveryMs) || now.getTime() - lastDiscoveryMs >= marketDiscoveryIntervalMs;
}

function pruneExpiredMarkets(markets: PolymarketQueueMarket[], now: Date): PolymarketQueueMarket[] {
  const nowMs = now.getTime();
  return markets.filter((market) => !market.endAt || Date.parse(market.endAt) >= nowMs);
}

function sortMarkets(markets: PolymarketQueueMarket[]): PolymarketQueueMarket[] {
  return [...markets].sort((left, right) => {
    const leftEnd = left.endAt ? Date.parse(left.endAt) : Number.MAX_SAFE_INTEGER;
    const rightEnd = right.endAt ? Date.parse(right.endAt) : Number.MAX_SAFE_INTEGER;
    const leftStart = left.startAt ? Date.parse(left.startAt) : Number.MAX_SAFE_INTEGER;
    const rightStart = right.startAt ? Date.parse(right.startAt) : Number.MAX_SAFE_INTEGER;
    return leftEnd - rightEnd || leftStart - rightStart || left.slug.localeCompare(right.slug);
  });
}

function formatMeaslesMarketLabel(market: PolymarketQueueMarket): string {
  if (!market.endAt) {
    return market.slug;
  }

  const endDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(market.endAt));
  return `${market.slug} (ends ${endDate} ET)`;
}

function extractComparableCdcMeaslesValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return [value.match(/^Total cases:\s*(.+)$/m)?.[1] ?? "", value.match(/^As of:\s*(.+)$/m)?.[1] ?? ""].join("|");
}

function parseGammaDate(value: unknown): Date | null {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
