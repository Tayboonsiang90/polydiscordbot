import type { Integration } from "./integrations/types.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "./marketEnd.js";
import { parseSettingsJson } from "./settingsJson.js";

export type PolymarketQueueMarket = {
  url: string;
  slug: string;
  startAt: string | null;
  endAt: string | null;
  addedAt: string;
};

export type PolymarketQueueSettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
};

export type PolymarketQueueResolution = {
  settingsJson: string | null;
  activeUrl: string | null;
};

export function upsertPolymarketQueueUrl(integration: Integration, url: string, now = new Date()): PolymarketQueueResolution {
  const settings = parseSettings(integration.settingsJson);
  const markets = normalizeMarkets(settings.polymarketMarkets);
  const market = buildQueueMarket(url, now);
  const existingIndex = markets.findIndex((candidate) => candidate.slug === market.slug);
  if (existingIndex === -1) {
    markets.push(market);
  } else {
    markets[existingIndex] = { ...markets[existingIndex], ...market, addedAt: markets[existingIndex].addedAt };
  }

  return resolvePolymarketQueue({ ...settings, polymarketMarkets: sortMarkets(markets) }, integration.polymarketUrl, now);
}

export function resolveIntegrationPolymarketQueue(integration: Integration, now = new Date()): PolymarketQueueResolution {
  const settings = parseSettings(integration.settingsJson);
  if (!Array.isArray(settings.polymarketMarkets) || settings.polymarketMarkets.length === 0) {
    return { settingsJson: integration.settingsJson, activeUrl: integration.polymarketUrl };
  }

  return resolvePolymarketQueue(settings, integration.polymarketUrl, now);
}

export function parsePolymarketDateRangeWindow(url: string, now = new Date()): { startAt: string; endAt: string } | null {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    return null;
  }

  const parts = slug.split("-").map((part) => part.toLowerCase());
  const year = getEasternYear(now);
  if (parts.includes("this") && parts.includes("quarter")) {
    return buildQuarterWindow(year, getEasternQuarter(now));
  }

  for (let index = 0; index < parts.length - 1; index += 1) {
    const quarter = parseQuarter(parts[index]);
    const quarterYear = parseYear(parts[index + 1]);
    if (quarter && quarterYear) {
      return buildQuarterWindow(quarterYear, quarter);
    }
  }

  for (let index = 0; index < parts.length - 1; index += 1) {
    const startMonth = monthNumber(parts[index]);
    const startDay = parseDay(parts[index + 1]);
    if (!startMonth || !startDay) {
      continue;
    }

    if (index + 2 >= parts.length) {
      return buildEasternWindow(year, startMonth, startDay, startMonth, startDay);
    }

    const sameMonthEndDay = parseDay(parts[index + 2]);
    if (sameMonthEndDay) {
      return buildEasternWindow(year, startMonth, startDay, startMonth, sameMonthEndDay);
    }

    const endMonth = monthNumber(parts[index + 2]);
    const endDay = parseDay(parts[index + 3]);
    if (endMonth && endDay) {
      return buildEasternWindow(year, startMonth, startDay, endMonth, endDay);
    }
  }

  return null;
}

function buildQuarterWindow(year: number, quarter: number): { startAt: string; endAt: string } | null {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const endDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  return buildEasternWindow(year, startMonth, 1, endMonth, endDay);
}

function resolvePolymarketQueue(settings: Record<string, unknown>, currentUrl: string | null, now: Date): PolymarketQueueResolution {
  const markets = normalizeMarkets(settings.polymarketMarkets);
  const activeMarket = getActiveMarket(markets, now);
  const activeUrl = activeMarket?.url ?? getFallbackUrl(markets, currentUrl, now);
  const retainedMarkets = pruneExpiredMarkets(markets, activeMarket, now);
  const nextSettings = { ...settings, polymarketMarkets: retainedMarkets };
  return {
    settingsJson: JSON.stringify(nextSettings),
    activeUrl
  };
}

function buildQueueMarket(url: string, now: Date): PolymarketQueueMarket {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${url}`);
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

function getFallbackUrl(markets: PolymarketQueueMarket[], currentUrl: string | null, now: Date): string | null {
  const undatedMarket = markets.find((market) => !market.startAt || !market.endAt);
  if (undatedMarket) {
    return undatedMarket.url;
  }

  if (!currentUrl) {
    return null;
  }

  return isCurrentUrlStillUsable(currentUrl, now) ? currentUrl : null;
}

function isCurrentUrlStillUsable(currentUrl: string, now: Date): boolean {
  const window = parsePolymarketDateRangeWindow(currentUrl, now);
  if (!window) {
    return true;
  }

  const nowMs = now.getTime();
  return nowMs >= Date.parse(window.startAt) && nowMs <= Date.parse(window.endAt);
}

function pruneExpiredMarkets(markets: PolymarketQueueMarket[], activeMarket: PolymarketQueueMarket | null, now: Date): PolymarketQueueMarket[] {
  const nowMs = now.getTime();
  return markets.filter((market) => {
    if (activeMarket?.slug === market.slug || !market.endAt) {
      return true;
    }

    return Date.parse(market.endAt) >= nowMs;
  });
}

function normalizeMarkets(value: unknown): PolymarketQueueMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return sortMarkets(
    value.flatMap((item) => {
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
    })
  );
}

function sortMarkets(markets: PolymarketQueueMarket[]): PolymarketQueueMarket[] {
  return [...markets].sort((left, right) => {
    const leftTime = left.startAt ? Date.parse(left.startAt) : Number.MAX_SAFE_INTEGER;
    const rightTime = right.startAt ? Date.parse(right.startAt) : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime || left.slug.localeCompare(right.slug);
  });
}

function parseSettings(settingsJson: string | null): Record<string, unknown> {
  return parseSettingsJson(settingsJson);
}

function buildEasternWindow(
  year: number,
  startMonth: number,
  startDay: number,
  endMonth: number,
  endDay: number
): { startAt: string; endAt: string } | null {
  const startAt = parseManualEasternDateTime(`${year}-${padNumber(startMonth)}-${padNumber(startDay)} 00:00`);
  const endAt = parseManualEasternDateTime(`${year}-${padNumber(endMonth)}-${padNumber(endDay)} 23:59`);
  if (!startAt || !endAt || startAt.getTime() > endAt.getTime()) {
    return null;
  }

  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}

function monthNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const months: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12
  };
  return months[value] ?? null;
}

function parseDay(value: string | undefined): number | null {
  if (!value || !/^\d{1,2}$/.test(value)) {
    return null;
  }

  const day = Number(value);
  return day >= 1 && day <= 31 ? day : null;
}

function parseQuarter(value: string | undefined): number | null {
  const match = value?.match(/^q([1-4])$/);
  return match ? Number(match[1]) : null;
}

function parseYear(value: string | undefined): number | null {
  if (!value || !/^20\d{2}$/.test(value)) {
    return null;
  }

  return Number(value);
}

function getEasternYear(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(date));
}

function getEasternQuarter(date: Date): number {
  const month = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric" }).format(date));
  return Math.floor((month - 1) / 3) + 1;
}

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}
