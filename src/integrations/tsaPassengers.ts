import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import {
  parsePolymarketDateRangeWindow,
  resolveIntegrationPolymarketQueue,
  upsertPolymarketQueueUrl,
  type PolymarketQueueMarket
} from "../polymarketQueue.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.tsa.gov/travel/passenger-volumes";
const defaultPolymarketUrl = "https://polymarket.com/event/number-of-tsa-passengers-may-4-may-10";
const easternTimeZone = "America/New_York";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const tsaMarketSearchQuery = "number of tsa passengers";
const tsaMarketSearchTag = "tsa";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 72 * 60 * 60_000;

export type TsaPassengerVolume = {
  date: string;
  passengers: number;
};

export type TsaDateRange = {
  startDate: string;
  endDate: string;
};

type TsaDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastTsaDiscoveryAt?: string;
};

type GammaSearchResponse = {
  events?: GammaSearchEvent[];
};

type GammaSearchEvent = {
  slug?: string;
  title?: string;
  active?: boolean;
  closed?: boolean;
  tags?: Array<{ slug?: string | null }>;
};

const monthNumbers: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12
};

export function extractTsaPassengerValue(html: string, polymarketUrl: string | null, now: Date = new Date()): string {
  const range = parsePolymarketTsaDateRange(polymarketUrl ?? defaultPolymarketUrl, now);
  const volumes = extractTsaPassengerVolumes(html);
  return formatTsaPassengerRangeValue(volumes, range);
}

export function extractTsaPassengerVolumes(html: string): TsaPassengerVolume[] {
  const $ = cheerio.load(html);
  const volumes: TsaPassengerVolume[] = [];

  $("tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .map((__, cell) => normalizeText($(cell).text()))
      .get();
    const date = parseTsaDate(cells[0]);
    const passengers = parsePassengerCount(cells[1]);
    if (!date || passengers === null) {
      return;
    }

    volumes.push({ date, passengers });
  });

  if (volumes.length === 0) {
    throw new Error("Could not find TSA passenger volume rows");
  }

  return volumes;
}

export function parsePolymarketTsaDateRange(url: string, now: Date = new Date()): TsaDateRange {
  const slug = getUrlSlug(url);
  const parts = slug.split("-").map((part) => part.toLowerCase());
  const currentYear = getEasternYear(now);

  for (let index = 0; index < parts.length - 2; index += 1) {
    const startMonth = monthNumbers[parts[index]];
    const startDay = parseDay(parts[index + 1]);
    if (!startMonth || !startDay) {
      continue;
    }

    const sameMonthEndDay = parseDay(parts[index + 2]);
    if (sameMonthEndDay) {
      return buildDateRange(currentYear, startMonth, startDay, startMonth, sameMonthEndDay);
    }

    const endMonth = monthNumbers[parts[index + 2]];
    const endDay = parseDay(parts[index + 3]);
    if (endMonth && endDay) {
      return buildDateRange(currentYear, startMonth, startDay, endMonth, endDay);
    }
  }

  throw new Error(`Could not parse TSA market date range from Polymarket URL: ${url}`);
}

export function formatTsaPassengerRangeValue(volumes: TsaPassengerVolume[], range: TsaDateRange): string {
  const volumeByDate = new Map(volumes.map((volume) => [volume.date, volume.passengers]));
  const dates = enumerateDates(range.startDate, range.endDate);
  const reported = dates.flatMap((date) => {
    const passengers = volumeByDate.get(date);
    return passengers === undefined ? [] : [{ date, passengers }];
  });
  const missingDates = dates.filter((date) => !volumeByDate.has(date));
  const total = reported.reduce((sum, volume) => sum + volume.passengers, 0);

  return [
    "Metric: TSA daily checkpoint throughput sum",
    `Range: ${range.startDate} to ${range.endDate}`,
    `Status: ${missingDates.length === 0 ? "complete" : "partial"}`,
    `Reported days: ${reported.length}/${dates.length}`,
    `Total passengers: ${formatInteger(total)}`,
    `Missing dates: ${missingDates.length ? missingDates.join(", ") : "none"}`,
    `Daily values: ${reported.length ? reported.map((volume) => `${volume.date}: ${formatInteger(volume.passengers)}`).join(" | ") : "none"}`
  ].join("\n");
}

export const tsaPassengersAdapter: WebsiteAdapter = {
  id: "tsa-passengers",
  commandName: "tsa",
  displayName: "TSA Passenger Volumes",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "tsa",
  alertRoleName: "TSA Passenger Alerts",
  alertRoleEmoji: "\u2708\uFE0F",
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshTsaPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`TSA returned HTTP ${response.status}`);
    }

    const value = extractTsaPassengerValue(await response.text(), integration?.polymarketUrl ?? defaultPolymarketUrl);
    return {
      value,
      rawValue: value,
      unit: "passengers",
      observedAt: new Date()
    };
  }
};

export async function refreshTsaPolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseTsaDiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverTsaMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastTsaDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const candidates = await fetchTsaMarketSearchCandidates(now);
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

function shouldDiscoverTsaMarkets(settings: TsaDiscoverySettings, now: Date): boolean {
  const markets = normalizeTsaQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastTsaDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
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

async function fetchTsaMarketSearchCandidates(now: Date): Promise<Array<{ slug: string; url: string }>> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", tsaMarketSearchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");
  searchUrl.searchParams.append("events_tag", tsaMarketSearchTag);

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? [])
    .map((event) => normalizeTsaSearchEvent(event, now))
    .filter((candidate) => candidate !== null);
}

function normalizeTsaSearchEvent(event: GammaSearchEvent, now: Date): { slug: string; url: string } | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  if (!event.slug.startsWith("number-of-tsa-passengers-") || !event.title.toLowerCase().startsWith("number of tsa passengers")) {
    return null;
  }

  const tagSlugs = new Set((event.tags ?? []).map((tag) => tag.slug).filter(isNonEmptyString));
  if (!tagSlugs.has(tsaMarketSearchTag)) {
    return null;
  }

  const url = `https://polymarket.com/event/${event.slug}`;
  return parsePolymarketDateRangeWindow(url, now) ? { slug: event.slug, url } : null;
}

function parseTsaDiscoverySettings(settingsJson: string | null): TsaDiscoverySettings {
  if (!settingsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(settingsJson) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const settings = parsed as TsaDiscoverySettings;
    return {
      ...settings,
      polymarketMarkets: normalizeTsaQueueMarkets(settings.polymarketMarkets),
      lastTsaDiscoveryAt: typeof settings.lastTsaDiscoveryAt === "string" ? settings.lastTsaDiscoveryAt : undefined
    };
  } catch {
    return {};
  }
}

function normalizeTsaQueueMarkets(value: unknown): PolymarketQueueMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((market) => {
    if (!market || typeof market !== "object") {
      return [];
    }

    const candidate = market as Partial<PolymarketQueueMarket>;
    if (!isNonEmptyString(candidate.url)) {
      return [];
    }

    const slug = isNonEmptyString(candidate.slug) ? candidate.slug : getPolymarketSlug(candidate.url);
    if (!slug) {
      return [];
    }

    return [
      {
        url: candidate.url,
        slug,
        startAt: typeof candidate.startAt === "string" ? candidate.startAt : null,
        endAt: typeof candidate.endAt === "string" ? candidate.endAt : null,
        addedAt: typeof candidate.addedAt === "string" ? candidate.addedAt : new Date(0).toISOString()
      }
    ];
  });
}

function buildDateRange(year: number, startMonth: number, startDay: number, endMonth: number, endDay: number): TsaDateRange {
  return {
    startDate: formatDate(year, startMonth, startDay),
    endDate: formatDate(year, endMonth, endDay)
  };
}

function getUrlSlug(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).at(-1) ?? "";
  } catch {
    return url;
  }
}

function parseDay(value: string | undefined): number | null {
  if (!value || !/^\d{1,2}$/.test(value)) {
    return null;
  }

  const day = Number(value);
  return day >= 1 && day <= 31 ? day : null;
}

function parseTsaDate(value: string | undefined): string | null {
  const match = value?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  return formatDate(Number(match[3]), Number(match[1]), Number(match[2]));
}

function parsePassengerCount(value: string | undefined): number | null {
  const normalized = value?.replace(/,/g, "").trim() ?? "";
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  return Number(normalized);
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const endTimestamp = Date.parse(`${endDate}T12:00:00.000Z`);
  let timestamp = Date.parse(`${startDate}T12:00:00.000Z`);

  while (timestamp <= endTimestamp) {
    dates.push(new Date(timestamp).toISOString().slice(0, 10));
    timestamp += 24 * 60 * 60 * 1000;
  }

  return dates;
}

function getEasternYear(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: easternTimeZone, year: "numeric" }).format(date));
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
