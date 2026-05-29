import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import { resolveIntegrationPolymarketQueue, type PolymarketQueueMarket } from "../polymarketQueue.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.ncei.noaa.gov/access/monitoring/tornadoes/time-series";
const releaseScheduleUrl = "https://www.ncei.noaa.gov/access/monitoring/dyk/monthly-releases";
const defaultPolymarketUrl = "https://polymarket.com/event/how-many-tornadoes-in-the-us-in-may";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const tornadoMarketSearchQuery = "how many tornadoes in the us";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 21 * 24 * 60 * 60_000;

type NceiTornadoData = {
  description?: {
    title?: unknown;
    preliminary?: unknown;
  };
  tornadoes?: Record<string, unknown>;
  fatalities?: Record<string, unknown>;
};

type TornadoPeriod = {
  year: number;
  month: number;
  dataKey: string;
  label: string;
};

type TornadoObservation = {
  date: string;
  count: number;
  preliminary: boolean;
};

type TornadoDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastTornadoDiscoveryAt?: string;
};

type GammaSearchResponse = {
  events?: GammaSearchEvent[];
};

type GammaSearchEvent = {
  slug?: unknown;
  title?: unknown;
  active?: unknown;
  closed?: unknown;
  endDate?: unknown;
  tags?: Array<{ slug?: unknown }>;
};

export function extractNceiTornadoValue(data: NceiTornadoData, period: TornadoPeriod, releaseScheduleText?: string): string {
  const target = parseTornadoObservation(period.dataKey, data.tornadoes?.[period.dataKey]);
  const latest = findLatestSameMonthObservation(data, period.month);
  const releaseText = releaseScheduleText ?? "not listed";

  if (!target) {
    return [
      "Metric: NCEI U.S. tornado count",
      `Period: ${period.label}`,
      "Value: not published yet",
      `Latest available for month: ${latest ? formatObservation(latest) : "none"}`,
      `Release schedule: ${releaseText}`
    ].join("\n");
  }

  return [
    "Metric: NCEI U.S. tornado count",
    `Period: ${period.label}`,
    `Value: ${target.count} tornadoes`,
    `Preliminary: ${target.preliminary ? "yes" : "no"}`,
    `Release schedule: ${releaseText}`
  ].join("\n");
}

export function extractNceiReleaseScheduleText(html: string): string | null {
  const match = html.match(/<div[^>]+id=["']next-release["'][^>]*>\s*<a[^>]*>([^<]+)<\/a>/i);
  return normalizeText(match?.[1] ?? "") || null;
}

export function parseTornadoMarketPeriod(url: string, now = new Date()): TornadoPeriod {
  const slug = getPolymarketSlug(url) ?? url;
  const parts = slug.split("-").map((part) => part.toLowerCase());
  const month = parts.map(monthNumber).find((value): value is number => value !== null);
  if (!month) {
    throw new Error(`Could not parse tornado market month from Polymarket URL: ${url}`);
  }

  const explicitYear = parts.map(parseYear).find((value): value is number => value !== null);
  const year = explicitYear ?? inferMonthOnlyMarketYear(month, now);
  return {
    year,
    month,
    dataKey: `${year}${padNumber(month)}`,
    label: `${year}-${padNumber(month)}`
  };
}

export function shouldAlertOnTornadoChange(previousValue: string | null, currentValue: string): boolean {
  return Boolean(previousValue?.includes("Value: not published yet")) && isPublishedTornadoValue(currentValue);
}

export const nceiTornadoesAdapter: WebsiteAdapter = {
  id: "ncei-tornadoes",
  commandName: "tornadoes",
  displayName: "NCEI U.S. Tornadoes",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "tornadoes",
  alertRoleName: "NCEI Tornado Alerts",
  alertRoleEmoji: "\uD83C\uDF2A\uFE0F",
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshTornadoPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  shouldAlertOnChange: shouldAlertOnTornadoChange,
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const polymarketUrl = integration?.polymarketUrl ?? defaultPolymarketUrl;
    const period = parseTornadoMarketPeriod(polymarketUrl);
    const [dataResponse, releaseResponse] = await Promise.all([
      fetchWithTimeout(buildNceiTornadoDataUrl(period.month), {
        headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
      }),
      fetchWithTimeout(releaseScheduleUrl, {
        headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
      })
    ]);

    if (!dataResponse.ok) {
      throw new Error(`NCEI tornado data returned HTTP ${dataResponse.status}`);
    }
    if (!releaseResponse.ok) {
      throw new Error(`NCEI release schedule returned HTTP ${releaseResponse.status}`);
    }

    const value = extractNceiTornadoValue(
      (await dataResponse.json()) as NceiTornadoData,
      period,
      extractNceiReleaseScheduleText(await releaseResponse.text()) ?? undefined
    );
    return {
      value,
      rawValue: value,
      unit: "tornadoes",
      observedAt: new Date()
    };
  }
};

export async function refreshTornadoPolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseTornadoDiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverTornadoMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastTornadoDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const markets = normalizeTornadoQueueMarkets(settings.polymarketMarkets);
    const existingSlugs = new Set(markets.map((market) => market.slug));
    for (const candidate of await fetchTornadoMarketSearchCandidates(now)) {
      if (existingSlugs.has(candidate.slug)) {
        continue;
      }

      markets.push(buildTornadoQueueMarket(candidate, now));
      existingSlugs.add(candidate.slug);
    }

    settings = { ...settings, polymarketMarkets: sortMarkets(markets) };
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

export function buildNceiTornadoDataUrl(month: number): string {
  return `${sourceUrl}/1/${month}/data.json`;
}

function findLatestSameMonthObservation(data: NceiTornadoData, month: number): TornadoObservation | null {
  const observations = Object.entries(data.tornadoes ?? {})
    .flatMap(([date, value]) => {
      const observation = parseTornadoObservation(date, value);
      return observation && Number(date.slice(4, 6)) === month ? [observation] : [];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
  return observations.at(-1) ?? null;
}

function parseTornadoObservation(date: string, value: unknown): TornadoObservation | null {
  if (!/^\d{6}$/.test(date)) {
    return null;
  }

  const normalized = String(value ?? "").trim();
  if (!/^\d+\*?$/.test(normalized)) {
    return null;
  }

  const count = Number(normalized.replace(/\*/g, ""));
  if (!Number.isFinite(count)) {
    return null;
  }

  return {
    date: `${date.slice(0, 4)}-${date.slice(4, 6)}`,
    count,
    preliminary: normalized.includes("*")
  };
}

function formatObservation(observation: TornadoObservation): string {
  return `${observation.date} = ${observation.count} tornadoes${observation.preliminary ? " (preliminary)" : ""}`;
}

function shouldDiscoverTornadoMarkets(settings: TornadoDiscoverySettings, now: Date): boolean {
  const markets = normalizeTornadoQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastTornadoDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

async function fetchTornadoMarketSearchCandidates(now: Date): Promise<Array<{ slug: string; url: string; endDate: string | null }>> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", tornadoMarketSearchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");
  searchUrl.searchParams.append("events_tag", "tornadoes");

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? [])
    .map((event) => normalizeTornadoSearchEvent(event, now))
    .filter((candidate) => candidate !== null);
}

function normalizeTornadoSearchEvent(
  event: GammaSearchEvent,
  now: Date
): { slug: string; url: string; endDate: string | null } | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  if (
    !event.slug.startsWith("how-many-tornadoes-in-the-us-in-") ||
    !event.title.toLowerCase().startsWith("how many tornadoes in the us in")
  ) {
    return null;
  }

  const tagSlugs = new Set((event.tags ?? []).map((tag) => tag.slug).filter(isNonEmptyString));
  if (!tagSlugs.has("tornadoes")) {
    return null;
  }

  const url = `https://polymarket.com/event/${event.slug}`;
  try {
    parseTornadoMarketPeriod(url, now);
  } catch {
    return null;
  }

  return { slug: event.slug, url, endDate: isNonEmptyString(event.endDate) ? event.endDate : null };
}

function buildTornadoQueueMarket(candidate: { slug: string; url: string; endDate: string | null }, now: Date): PolymarketQueueMarket {
  const period = parseTornadoMarketPeriod(candidate.url, now);
  const startAt = parseManualEasternDateTime(`${period.label}-01 00:00`)?.toISOString() ?? null;
  const fallbackEndAt = buildFallbackReleaseWindow(period)?.toISOString() ?? null;
  return {
    url: candidate.url,
    slug: candidate.slug,
    startAt,
    endAt: candidate.endDate ? endOfEasternDate(candidate.endDate)?.toISOString() ?? fallbackEndAt : fallbackEndAt,
    addedAt: now.toISOString()
  };
}

function endOfEasternDate(value: string): Date | null {
  if (Number.isNaN(Date.parse(value))) {
    return null;
  }

  return parseManualEasternDateTime(`${value.slice(0, 10)} 23:59`);
}

function buildFallbackReleaseWindow(period: TornadoPeriod): Date | null {
  const releaseYear = period.month === 12 ? period.year + 1 : period.year;
  const releaseMonth = period.month === 12 ? 1 : period.month + 1;
  return parseManualEasternDateTime(`${releaseYear}-${padNumber(releaseMonth)}-08 23:59`);
}

function parseTornadoDiscoverySettings(settingsJson: string | null): TornadoDiscoverySettings {
  if (!settingsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(settingsJson) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const settings = parsed as TornadoDiscoverySettings;
    return {
      ...settings,
      polymarketMarkets: normalizeTornadoQueueMarkets(settings.polymarketMarkets),
      lastTornadoDiscoveryAt: typeof settings.lastTornadoDiscoveryAt === "string" ? settings.lastTornadoDiscoveryAt : undefined
    };
  } catch {
    return {};
  }
}

function normalizeTornadoQueueMarkets(value: unknown): PolymarketQueueMarket[] {
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

function isPublishedTornadoValue(value: string): boolean {
  return /Value:\s+\d+\s+tornadoes/i.test(value);
}

function inferMonthOnlyMarketYear(month: number, now: Date): number {
  const currentYear = getEasternYear(now);
  const currentMonth = getEasternMonth(now);
  if (month === 12 && currentMonth === 1) {
    return currentYear - 1;
  }

  if (month === 1 && currentMonth === 12) {
    return currentYear + 1;
  }

  return currentYear;
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

function parseYear(value: string | undefined): number | null {
  if (!value || !/^20\d{2}$/.test(value)) {
    return null;
  }

  return Number(value);
}

function getEasternYear(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(date));
}

function getEasternMonth(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric" }).format(date));
}

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
