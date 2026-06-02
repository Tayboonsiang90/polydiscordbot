import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import { resolveIntegrationPolymarketQueue, type PolymarketQueueMarket } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.bonbast.com/graph/usd";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const defaultPolymarketUrl = "https://polymarket.com/event/will-usd-hit-iranian-rials-by-june-30";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 15 * 60_000;

type BonbastDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastBonbastMarketDiscoveryAt?: string;
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
  creationDate?: unknown;
  endDate?: unknown;
};

export function extractBonbastUsdIrrValue(html: string): string {
  const $ = cheerio.load(html);
  const text = $.root().text();
  const scriptText = $("script")
    .map((_, element) => $(element).text())
    .get()
    .join("\n");
  const searchableText = `${text}\n${scriptText}`;
  const numericMatches = searchableText.match(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d{5,9}(?:\.\d+)?\b/g) ?? [];

  const candidates = numericMatches
    .map((match) => Number(match.replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value >= 10_000 && value <= 10_000_000);

  if (candidates.length === 0) {
    throw new Error("Could not find a Bonbast USD/IRR value in the response");
  }

  return String(candidates.at(-1));
}

export const bonbastUsdIrrAdapter: WebsiteAdapter = {
  id: "bonbast-usd-irr",
  commandName: "bonbast",
  displayName: "Bonbast USD/IRR",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "bonbast-usd-irr",
  alertRoleName: "Bonbast Alerts",
  alertRoleEmoji: "\uD83D\uDCB1",
  async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
    return (await refreshBonbastPolymarketQueue(integration, new Date(), options)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Bonbast returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const value = extractBonbastUsdIrrValue(html);
    return {
      value,
      rawValue: value,
      unit: "IRR per USD",
      observedAt: new Date()
    };
  }
};

export async function refreshBonbastPolymarketQueue(
  integration: Integration,
  now = new Date(),
  options: { force?: boolean } = {}
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseBonbastDiscoverySettings(resolved.settingsJson);
  if (!options.force && !shouldDiscoverBonbastMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastBonbastMarketDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const marketBySlug = new Map(normalizeBonbastQueueMarkets(settings.polymarketMarkets).map((market) => [market.slug, market]));
    for (const candidate of await fetchBonbastMarketSearchCandidates(now)) {
      marketBySlug.set(candidate.slug, candidate);
    }

    const nextSettingsJson = JSON.stringify({
      ...settings,
      polymarketMarkets: [...marketBySlug.values()].sort(compareQueueMarkets)
    });
    return resolveIntegrationPolymarketQueue({ ...integration, settingsJson: nextSettingsJson }, now);
  } catch {
    return resolved;
  }
}

export function normalizeBonbastMarketSearchEvent(event: GammaSearchEvent, now = new Date()): PolymarketQueueMarket | null {
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
  const title = event.title.toLowerCase();
  if (!slug.startsWith("will-usd-hit-iranian-rials-by-") || !title.includes("usd") || !title.includes("iranian rials")) {
    return null;
  }

  const startAt = parseGammaDate(event.startDate) ?? parseGammaDate(event.creationDate);
  const endAt = parseGammaDate(event.endDate);
  if (!startAt || !endAt || Date.parse(endAt) < now.getTime()) {
    return null;
  }

  return {
    url: `https://polymarket.com/event/${slug}`,
    slug,
    startAt,
    endAt,
    addedAt: now.toISOString()
  };
}

async function fetchBonbastMarketSearchCandidates(now: Date): Promise<PolymarketQueueMarket[]> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", "will usd hit iranian rials");
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
    .map((event) => normalizeBonbastMarketSearchEvent(event, now))
    .filter((market): market is PolymarketQueueMarket => market !== null);
}

function shouldDiscoverBonbastMarkets(settings: BonbastDiscoverySettings, now: Date): boolean {
  const activeMarket = getActiveMarket(normalizeBonbastQueueMarkets(settings.polymarketMarkets), now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastBonbastMarketDiscoveryAt, now, intervalMs)) {
    return false;
  }

  return !activeMarket || Date.parse(activeMarket.endAt ?? "") - now.getTime() <= 7 * 24 * 60 * 60_000;
}

function parseBonbastDiscoverySettings(settingsJson: string | null): BonbastDiscoverySettings {
  const settings = parseSettingsJson(settingsJson) as BonbastDiscoverySettings;
  return {
    ...settings,
    polymarketMarkets: normalizeBonbastQueueMarkets(settings.polymarketMarkets),
    lastBonbastMarketDiscoveryAt:
      typeof settings.lastBonbastMarketDiscoveryAt === "string" ? settings.lastBonbastMarketDiscoveryAt : undefined
  };
}

function normalizeBonbastQueueMarkets(value: unknown): PolymarketQueueMarket[] {
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

function compareQueueMarkets(left: PolymarketQueueMarket, right: PolymarketQueueMarket): number {
  const leftTime = left.startAt ? Date.parse(left.startAt) : Number.MAX_SAFE_INTEGER;
  const rightTime = right.startAt ? Date.parse(right.startAt) : Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime || left.slug.localeCompare(right.slug);
}

function parseGammaDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
