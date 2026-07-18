import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import { resolveIntegrationPolymarketQueue, type PolymarketQueueMarket } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.cdc.gov/cyclosporiasis/php/surveillance/index.html";
const defaultPolymarketUrl = "https://polymarket.com/event/cyclosporiasis-cases-in-uptspt-by-july-31-20260714155955473";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const gammaEventsUrl = "https://gamma-api.polymarket.com/events";
const cyclosporiasisMarketSearchQuery = "cyclosporiasis cases";
const marketDiscoveryIntervalMs = 30 * 60_000;

type CdcCyclosporiasisSettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastCyclosporiasisDiscoveryAt?: string;
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

export type CdcCyclosporiasisCounter = {
  totalCases: number;
  asOfDate: string;
  pageDate?: string;
  hospitalizations?: number;
  deaths?: number;
  statesReporting?: number;
};

export const cdcCyclosporiasisAdapter: WebsiteAdapter = {
  id: "cdc-cyclosporiasis",
  commandName: "cyclospora",
  displayName: "CDC Cyclosporiasis Cases",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "cyclosporiasis",
  alertRoleName: "CDC Cyclosporiasis Alerts",
  alertRoleEmoji: "\uD83E\uDDEA",
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Hourly CDC cyclosporiasis surveillance count checks and active market discovery.",
  shouldAlertOnChange: shouldAlertOnCdcCyclosporiasisChange,
  async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
    return (
      (await refreshCdcCyclosporiasisPolymarketQueue(integration, new Date(), options?.force ?? false)).settingsJson ??
      integration.settingsJson ??
      "{}"
    );
  },
  async upsertPolymarketMarket(
    integration: Integration,
    url: string
  ): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertCdcCyclosporiasisPolymarketQueueUrl(integration, url);
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
    });
    if (!response.ok) {
      throw new Error(`CDC cyclosporiasis page returned HTTP ${response.status}`);
    }

    const counter = extractCdcCyclosporiasisCounterFromHtml(await response.text());
    const value = formatCdcCyclosporiasisValue(counter, integration ? getCdcCyclosporiasisQueuedMarkets(integration) : []);
    return {
      value,
      rawValue: String(counter.totalCases),
      unit: "confirmed domestically acquired cases",
      observedAt: new Date()
    };
  }
};

export function extractCdcCyclosporiasisCounterFromHtml(html: string): CdcCyclosporiasisCounter {
  const $ = cheerio.load(html);
  const text = normalizeText($.root().text());
  const fastFactsMatch = text.match(/As of ([A-Z][a-z]+ \d{1,2}, \d{4}):\s*U\.S\. cases reported to CDC:\s*([\d,]+)/i);
  const dataMatch = text.match(
    /As of ([A-Z][a-z]+ \d{1,2}, \d{4}),\s*([\d,]+)\s+lab-confirmed cases were reported in people who acquired cyclosporiasis in the United States/i
  );
  const match = fastFactsMatch ?? dataMatch;
  if (!match) {
    throw new Error("Could not find CDC cyclosporiasis U.S. cases reported to CDC count");
  }

  const totalCases = parseInteger(match[2]);
  if (totalCases === null) {
    throw new Error("Could not parse CDC cyclosporiasis U.S. cases reported to CDC count");
  }

  return {
    totalCases,
    asOfDate: match[1],
    pageDate: extractCdcCyclosporiasisPageDate(text) ?? undefined,
    hospitalizations: extractNamedInteger(text, "Hospitalizations"),
    deaths: extractNamedInteger(text, "Deaths"),
    statesReporting: extractNamedInteger(text, "States reporting cases")
  };
}

export function formatCdcCyclosporiasisValue(
  counter: CdcCyclosporiasisCounter,
  markets: PolymarketQueueMarket[] = []
): string {
  const lines = [
    "Metric: CDC confirmed domestically acquired U.S. cyclosporiasis cases since May 1, 2026",
    `Total cases: ${formatInteger(counter.totalCases)}`,
    `As of: ${counter.asOfDate}`,
    `Hospitalizations: ${formatOptionalInteger(counter.hospitalizations)}`,
    `Deaths: ${formatOptionalInteger(counter.deaths)}`,
    `States reporting: ${formatOptionalInteger(counter.statesReporting)}`,
    `CDC page date: ${counter.pageDate ?? "not listed"}`,
    `Resolution: ${sourceUrl}`
  ];

  const activeMarkets = markets.filter((market) => market.endAt === null || Date.parse(market.endAt) >= Date.now());
  if (activeMarkets.length > 0) {
    lines.push(
      "Tracked Polymarket markets:",
      ...activeMarkets.map((market, index) => `${index + 1}. ${formatCyclosporiasisMarketLabel(market)} - ${market.url}`)
    );
  }

  return lines.join("\n");
}

export function shouldAlertOnCdcCyclosporiasisChange(previousValue: string | null, currentValue: string): boolean {
  return extractComparableCdcCyclosporiasisValue(previousValue) !== extractComparableCdcCyclosporiasisValue(currentValue);
}

export async function refreshCdcCyclosporiasisPolymarketQueue(
  integration: Integration,
  now = new Date(),
  force = false
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseCdcCyclosporiasisSettings(resolved.settingsJson);
  if (!force && !shouldDiscoverCdcCyclosporiasisMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastCyclosporiasisDiscoveryAt: now.toISOString() };
  resolved = { settingsJson: JSON.stringify(settings), activeUrl: resolved.activeUrl };

  try {
    const markets = normalizeCdcCyclosporiasisQueueMarkets(settings.polymarketMarkets);
    for (const candidate of await fetchCdcCyclosporiasisMarketSearchCandidates(now)) {
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

export async function upsertCdcCyclosporiasisPolymarketQueueUrl(
  integration: Integration,
  url: string,
  now = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  const settings = parseCdcCyclosporiasisSettings(integration.settingsJson);
  const markets = normalizeCdcCyclosporiasisQueueMarkets(settings.polymarketMarkets);
  const market =
    (await fetchCdcCyclosporiasisMarketByUrl(url, now).catch(() => null)) ?? buildCdcCyclosporiasisQueueMarketFromUrl(url, now);
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

async function fetchCdcCyclosporiasisMarketSearchCandidates(now: Date): Promise<PolymarketQueueMarket[]> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", cyclosporiasisMarketSearchQuery);
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
    .map((event) => normalizeCdcCyclosporiasisSearchEvent(event, now))
    .filter((candidate): candidate is PolymarketQueueMarket => candidate !== null);
}

async function fetchCdcCyclosporiasisMarketByUrl(url: string, now: Date): Promise<PolymarketQueueMarket | null> {
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
  return event ? buildCdcCyclosporiasisQueueMarketFromGammaEvent(event, now) : null;
}

function normalizeCdcCyclosporiasisSearchEvent(event: GammaSearchEvent, now: Date): PolymarketQueueMarket | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  const slug = event.slug.trim();
  const title = normalizeText(event.title);
  if (!slug.startsWith("cyclosporiasis-cases-in-") && !/^cyclosporiasis cases in/i.test(title)) {
    return null;
  }

  return buildCdcCyclosporiasisQueueMarketFromGammaEvent(event, now);
}

function buildCdcCyclosporiasisQueueMarketFromGammaEvent(event: GammaSearchEvent, now: Date): PolymarketQueueMarket {
  if (!isNonEmptyString(event.slug)) {
    throw new Error("CDC cyclosporiasis Gamma event is missing a slug");
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

function buildCdcCyclosporiasisQueueMarketFromUrl(url: string, now: Date): PolymarketQueueMarket {
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

function parseCdcCyclosporiasisSettings(settingsJson: string | null): CdcCyclosporiasisSettings {
  const settings = parseSettingsJson(settingsJson) as CdcCyclosporiasisSettings;
  return {
    ...settings,
    polymarketMarkets: normalizeCdcCyclosporiasisQueueMarkets(settings.polymarketMarkets),
    lastCyclosporiasisDiscoveryAt:
      typeof settings.lastCyclosporiasisDiscoveryAt === "string" ? settings.lastCyclosporiasisDiscoveryAt : undefined
  };
}

function normalizeCdcCyclosporiasisQueueMarkets(value: unknown): PolymarketQueueMarket[] {
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

function getCdcCyclosporiasisQueuedMarkets(integration: Integration): PolymarketQueueMarket[] {
  return normalizeCdcCyclosporiasisQueueMarkets(parseSettingsJson(integration.settingsJson).polymarketMarkets);
}

function shouldDiscoverCdcCyclosporiasisMarkets(settings: CdcCyclosporiasisSettings, now: Date): boolean {
  if (normalizeCdcCyclosporiasisQueueMarkets(settings.polymarketMarkets).length === 0) {
    return true;
  }

  const lastDiscoveryMs = Date.parse(settings.lastCyclosporiasisDiscoveryAt ?? "");
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

function formatCyclosporiasisMarketLabel(market: PolymarketQueueMarket): string {
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

function extractComparableCdcCyclosporiasisValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return [value.match(/^Total cases:\s*(.+)$/m)?.[1] ?? "", value.match(/^As of:\s*(.+)$/m)?.[1] ?? ""].join("|");
}

function extractCdcCyclosporiasisPageDate(text: string): string | null {
  return text.match(/Surveillance of Cyclosporiasis For Public Health ([A-Z][a-z]+ \d{1,2}, \d{4}) Key points/i)?.[1] ?? null;
}

function extractNamedInteger(text: string, label: string): number | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escapedLabel}:\\s*([\\d,]+)`, "i"));
  const parsed = parseInteger(match?.[1]);
  return parsed ?? undefined;
}

function parseInteger(value: string | undefined): number | null {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  return Number(normalized);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatOptionalInteger(value: number | undefined): string {
  return value === undefined ? "not listed" : formatInteger(value);
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
