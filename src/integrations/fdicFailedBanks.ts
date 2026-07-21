import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import { resolveIntegrationPolymarketQueue, type PolymarketQueueMarket } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.fdic.gov/resources/resolutions/bank-failures/failed-bank-list/";
const defaultPolymarketUrl = "https://polymarket.com/event/us-bank-failure-by-december-31-2026-20260720194747677";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const gammaEventsUrl = "https://gamma-api.polymarket.com/events";
const fdicMarketSearchQuery = "us bank failure";
const marketDiscoveryIntervalMs = 30 * 60_000;

type FdicFailedBanksSettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastFdicMarketDiscoveryAt?: string;
};

type GammaSearchResponse = {
  events?: GammaSearchEvent[];
};

type GammaEventResponse = GammaSearchEvent[];

export type GammaSearchEvent = {
  slug?: unknown;
  title?: unknown;
  active?: unknown;
  closed?: unknown;
  seriesSlug?: unknown;
  startDate?: unknown;
  creationDate?: unknown;
  createdAt?: unknown;
  endDate?: unknown;
  endDateIso?: unknown;
};

export type FdicFailedBank = {
  bankName: string;
  city: string;
  state: string;
  cert: string;
  acquiringInstitution: string;
  closingDate: string;
  fund: string;
};

export function extractLatestFdicFailedBankValue(html: string): string {
  const bank = extractLatestFdicFailedBank(html);
  return [
    `Bank: ${bank.bankName}`,
    `Location: ${bank.city}, ${bank.state}`,
    `Closing date: ${bank.closingDate}`,
    `Acquiring institution: ${bank.acquiringInstitution}`,
    `Cert: ${bank.cert}`,
    `Fund: ${bank.fund}`
  ].join("\n");
}

export function extractLatestFdicFailedBank(html: string): FdicFailedBank {
  const $ = cheerio.load(html);
  const row = $("tbody tr").first();
  const cells = row
    .find("td")
    .map((_, cell) => normalizeText($(cell).text()))
    .get();

  if (cells.length < 7 || !cells[0] || !cells[5]) {
    throw new Error("Could not find the latest failed bank row in the FDIC response");
  }

  return {
    bankName: cells[0],
    city: cells[1],
    state: cells[2],
    cert: cells[3],
    acquiringInstitution: cells[4],
    closingDate: cells[5],
    fund: cells[6]
  };
}

export const fdicFailedBanksAdapter: WebsiteAdapter = {
  id: "fdic-failed-banks",
  commandName: "fdic",
  displayName: "FDIC Failed Bank List",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "fdic-failed-banks",
  alertRoleName: "FDIC Failed Bank Alerts",
  alertRoleEmoji: "\uD83C\uDFE6",
  async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
    return (await refreshFdicFailedBanksPolymarketQueue(integration, new Date(), options?.force ?? false)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async upsertPolymarketMarket(
    integration: Integration,
    url: string
  ): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertFdicFailedBanksPolymarketQueueUrl(integration, url);
  },
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`FDIC returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const value = extractLatestFdicFailedBankValue(html);
    return {
      value,
      rawValue: value,
      unit: "latest failed bank row",
      observedAt: new Date()
    };
  }
};

export async function refreshFdicFailedBanksPolymarketQueue(
  integration: Integration,
  now = new Date(),
  force = false
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseFdicFailedBanksSettings(resolved.settingsJson);
  if (!force && !shouldDiscoverFdicFailedBanksMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastFdicMarketDiscoveryAt: now.toISOString() };
  resolved = { settingsJson: JSON.stringify(settings), activeUrl: resolved.activeUrl };

  try {
    const markets = normalizeFdicFailedBanksQueueMarkets(settings.polymarketMarkets);
    for (const candidate of await fetchFdicFailedBanksMarketSearchCandidates(now)) {
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

export async function upsertFdicFailedBanksPolymarketQueueUrl(
  integration: Integration,
  url: string,
  now = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  const settings = parseFdicFailedBanksSettings(integration.settingsJson);
  const markets = normalizeFdicFailedBanksQueueMarkets(settings.polymarketMarkets);
  const market = (await fetchFdicFailedBanksMarketByUrl(url, now).catch(() => null)) ?? buildFdicFailedBanksQueueMarketFromUrl(url, now);
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

export function normalizeFdicFailedBanksSearchEvent(event: GammaSearchEvent, now = new Date()): PolymarketQueueMarket | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  const title = normalizeText(event.title);
  if (event.seriesSlug !== "bank-failure" && !/^US bank failure by /i.test(title)) {
    return null;
  }

  return buildFdicFailedBanksQueueMarketFromGammaEvent(event, now);
}

function parseFdicFailedBanksSettings(settingsJson: string | null): FdicFailedBanksSettings {
  const settings = parseSettingsJson(settingsJson) as FdicFailedBanksSettings;
  return {
    ...settings,
    polymarketMarkets: normalizeFdicFailedBanksQueueMarkets(settings.polymarketMarkets),
    lastFdicMarketDiscoveryAt: typeof settings.lastFdicMarketDiscoveryAt === "string" ? settings.lastFdicMarketDiscoveryAt : undefined
  };
}

function normalizeFdicFailedBanksQueueMarkets(value: unknown): PolymarketQueueMarket[] {
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

async function fetchFdicFailedBanksMarketSearchCandidates(now: Date): Promise<PolymarketQueueMarket[]> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", fdicMarketSearchQuery);
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
    .map((event) => normalizeFdicFailedBanksSearchEvent(event, now))
    .filter((candidate): candidate is PolymarketQueueMarket => candidate !== null);
}

async function fetchFdicFailedBanksMarketByUrl(url: string, now: Date): Promise<PolymarketQueueMarket | null> {
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
  return event ? buildFdicFailedBanksQueueMarketFromGammaEvent(event, now) : null;
}

function buildFdicFailedBanksQueueMarketFromGammaEvent(event: GammaSearchEvent, now: Date): PolymarketQueueMarket {
  if (!isNonEmptyString(event.slug)) {
    throw new Error("FDIC bank-failure Gamma event is missing a slug");
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

function buildFdicFailedBanksQueueMarketFromUrl(url: string, now: Date): PolymarketQueueMarket {
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

function shouldDiscoverFdicFailedBanksMarkets(settings: FdicFailedBanksSettings, now: Date): boolean {
  if (normalizeFdicFailedBanksQueueMarkets(settings.polymarketMarkets).length === 0) {
    return true;
  }

  const lastDiscoveryMs = Date.parse(settings.lastFdicMarketDiscoveryAt ?? "");
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
