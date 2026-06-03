import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import { resolveIntegrationPolymarketQueue, type PolymarketQueueMarket } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.billboard.com/charts/hot-100/";
const defaultPolymarketUrl = "https://polymarket.com/event/billboard-hot-100-1-song-week-of-june-13";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const gammaEventsUrl = "https://gamma-api.polymarket.com/events";
const billboardHot100MarketSearchQuery = "billboard hot 100 1 song week";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 7 * 24 * 60 * 60_000;

export type BillboardHot100Song = {
  title: string;
  artist: string;
  rank: number;
  chartDateLabel: string | null;
  chartUrl: string;
};

export type BillboardHot100MarketTarget = {
  year: number;
  month: number;
  day: number;
  chartDate: string;
  chartDateLabel: string;
  expectedReleaseDate: string;
  fallbackDeadlineDate: string;
  chartUrl: string;
};

type BillboardHot100DiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastBillboardHot100DiscoveryAt?: string;
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
  createdAt?: unknown;
  endDate?: unknown;
};

export const billboardHot100Adapter: WebsiteAdapter = {
  id: "billboard-hot-100-number-one-song",
  commandName: "billboardhot100",
  displayName: "Billboard Hot 100 #1 Song",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "billboardhot100",
  alertRoleName: "Billboard Hot 100 Alerts",
  alertRoleEmoji: "\uD83C\uDFB5",
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Hourly Billboard Hot 100 dated chart check and weekly market discovery",
  shouldAlertOnChange: shouldAlertOnBillboardHot100Change,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshBillboardHot100PolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async upsertPolymarketMarket(
    integration: Integration,
    url: string
  ): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertBillboardHot100PolymarketQueueUrl(integration, url);
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const polymarketUrl = integration?.polymarketUrl ?? defaultPolymarketUrl;
    const target = parseBillboardHot100MarketTarget(polymarketUrl);
    const song = await fetchBillboardHot100TargetSong(target);
    const latestSong = song ? null : await fetchLatestBillboardHot100Song().catch(() => null);
    const value = formatBillboardHot100Value(target, song, latestSong);
    return {
      value,
      rawValue: song ? `${song.title} - ${song.artist}` : "not published yet",
      unit: "Billboard Hot 100 #1 song",
      observedAt: new Date()
    };
  }
};

export function parseBillboardHot100MarketTarget(url: string, now: Date = new Date()): BillboardHot100MarketTarget {
  const slug = getPolymarketSlug(url) ?? url;
  const parts = slug.split("-").map((part) => part.toLowerCase());
  const weekIndex = parts.findIndex((part, index) => part === "week" && parts[index + 1] === "of");
  if (weekIndex === -1) {
    throw new Error(`Could not parse Billboard Hot 100 chart week from Polymarket URL: ${url}`);
  }

  const month = monthNumber(parts[weekIndex + 2]);
  const day = parseDay(parts[weekIndex + 3]);
  const explicitYear = parts.slice(weekIndex + 4).map(parseYear).find((value): value is number => value !== null);
  const year = explicitYear ?? inferMarketYear(month, now);
  if (!month || !day || !year) {
    throw new Error(`Could not parse Billboard Hot 100 chart week from Polymarket URL: ${url}`);
  }

  const chartDate = formatDate(year, month, day);
  return {
    year,
    month,
    day,
    chartDate,
    chartDateLabel: `Week of ${monthName(month)} ${day}, ${year}`,
    expectedReleaseDate: addDays(chartDate, -4),
    fallbackDeadlineDate: addDays(chartDate, 14),
    chartUrl: buildBillboardHot100ChartUrl(chartDate)
  };
}

export function extractBillboardHot100NumberOneSong(html: string, chartUrl: string): BillboardHot100Song | null {
  const $ = cheerio.load(html);
  const chartDateLabel = extractChartDateLabel($);
  const row = $(".o-chart-results-list-row")
    .filter((_, element) => {
      const labels = extractLabels($, $(element));
      return labels[0] === "1";
    })
    .first();
  if (row.length === 0) {
    return null;
  }

  const title = normalizeText(row.find("h3.c-title, h3").first().text());
  const artist = extractLabels($, row).find((label) => !isChartStatsLabel(label)) ?? "";
  if (!title || !artist) {
    return null;
  }

  return {
    title,
    artist,
    rank: 1,
    chartDateLabel,
    chartUrl
  };
}

export function formatBillboardHot100Value(
  target: BillboardHot100MarketTarget,
  song: BillboardHot100Song | null,
  latestSong: BillboardHot100Song | null = null
): string {
  if (song) {
    return [
      "Metric: Billboard Hot 100 #1 song",
      `Target chart: ${target.chartDateLabel}`,
      "Status: published",
      `#1 Song: ${song.title}`,
      `Artist: ${song.artist}`,
      `Published chart date: ${song.chartDateLabel ?? target.chartDateLabel}`,
      `Chart URL: ${song.chartUrl}`,
      `Resolution: ${sourceUrl}`
    ].join("\n");
  }

  return [
    "Metric: Billboard Hot 100 #1 song",
    `Target chart: ${target.chartDateLabel}`,
    "Status: not published yet",
    "#1 Song: not published yet",
    `Expected release: around ${target.expectedReleaseDate} ET`,
    `Fallback deadline: ${target.fallbackDeadlineDate} ET`,
    `Latest available: ${latestSong ? `${latestSong.chartDateLabel ?? "current chart"} - ${latestSong.title} by ${latestSong.artist}` : "none found"}`,
    `Chart URL: ${target.chartUrl}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function shouldAlertOnBillboardHot100Change(previousValue: string | null, currentValue: string): boolean {
  return previousValue !== null && currentValue.includes("Status: published") && previousValue !== currentValue;
}

export async function refreshBillboardHot100PolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseBillboardHot100DiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverBillboardHot100Markets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastBillboardHot100DiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    let markets = normalizeBillboardHot100QueueMarkets(settings.polymarketMarkets);
    const existingSlugs = new Set(markets.map((market) => market.slug));
    for (const candidate of await fetchBillboardHot100MarketSearchCandidates(now)) {
      if (existingSlugs.has(candidate.slug)) {
        continue;
      }

      markets = upsertBillboardHot100QueueMarket(markets, candidate);
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

export async function upsertBillboardHot100PolymarketQueueUrl(
  integration: Integration,
  url: string,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  const settings = parseBillboardHot100DiscoverySettings(integration.settingsJson);
  const markets = upsertBillboardHot100QueueMarket(
    normalizeBillboardHot100QueueMarkets(settings.polymarketMarkets),
    (await fetchBillboardHot100MarketByUrl(url, now).catch(() => null)) ?? buildBillboardHot100QueueMarketFromUrl(url, now)
  );

  return resolveIntegrationPolymarketQueue(
    {
      ...integration,
      settingsJson: JSON.stringify({
        ...settings,
        polymarketMarkets: sortMarkets(markets)
      })
    },
    now
  );
}

export function normalizeBillboardHot100MarketSearchEvent(
  event: GammaSearchEvent,
  now: Date = new Date()
): PolymarketQueueMarket | null {
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
  const title = event.title.toLowerCase().trim();
  if (!slug.startsWith("billboard-hot-100-1-song-week-of-") || !title.startsWith("billboard hot 100 #1 song week of")) {
    return null;
  }

  const url = `https://polymarket.com/event/${slug}`;
  try {
    const fallbackMarket = buildBillboardHot100QueueMarketFromUrl(url, now);
    return {
      ...fallbackMarket,
      startAt:
        parseGammaDate(event.startDate)?.toISOString() ??
        parseGammaDate(event.creationDate)?.toISOString() ??
        parseGammaDate(event.createdAt)?.toISOString() ??
        fallbackMarket.startAt,
      endAt: parseGammaDate(event.endDate)?.toISOString() ?? fallbackMarket.endAt
    };
  } catch {
    return null;
  }
}

async function fetchBillboardHot100TargetSong(target: BillboardHot100MarketTarget): Promise<BillboardHot100Song | null> {
  const response = await fetchWithTimeout(target.chartUrl, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`Billboard Hot 100 returned HTTP ${response.status}`);
  }

  return extractBillboardHot100NumberOneSong(await response.text(), target.chartUrl);
}

async function fetchLatestBillboardHot100Song(): Promise<BillboardHot100Song | null> {
  const response = await fetchWithTimeout(sourceUrl, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Billboard Hot 100 returned HTTP ${response.status}`);
  }

  return extractBillboardHot100NumberOneSong(await response.text(), sourceUrl);
}

async function fetchBillboardHot100MarketSearchCandidates(now: Date): Promise<PolymarketQueueMarket[]> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", billboardHot100MarketSearchQuery);
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
    .map((event) => normalizeBillboardHot100MarketSearchEvent(event, now))
    .filter((market): market is PolymarketQueueMarket => market !== null);
}

async function fetchBillboardHot100MarketByUrl(url: string, now: Date): Promise<PolymarketQueueMarket | null> {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    return null;
  }

  const response = await fetchWithTimeout(`${gammaEventsUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const events = (await response.json()) as GammaSearchEvent[];
  return normalizeBillboardHot100MarketSearchEvent(events[0] ?? {}, now);
}

function buildBillboardHot100QueueMarketFromUrl(url: string, now: Date): PolymarketQueueMarket {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${url}`);
  }

  const target = parseBillboardHot100MarketTarget(url, now);
  const startAt = parseManualEasternDateTime(`${addDays(target.expectedReleaseDate, -14)} 00:00`)?.toISOString() ?? now.toISOString();
  const endAt =
    parseManualEasternDateTime(`${target.expectedReleaseDate} 23:59`)?.toISOString() ??
    parseManualEasternDateTime(`${target.fallbackDeadlineDate} 23:59`)?.toISOString() ??
    null;
  return { url, slug, startAt, endAt, addedAt: now.toISOString() };
}

function shouldDiscoverBillboardHot100Markets(settings: BillboardHot100DiscoverySettings, now: Date): boolean {
  const markets = normalizeBillboardHot100QueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastBillboardHot100DiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

function parseBillboardHot100DiscoverySettings(settingsJson: string | null): BillboardHot100DiscoverySettings {
  const settings = parseSettingsJson(settingsJson) as BillboardHot100DiscoverySettings;
  return {
    ...settings,
    polymarketMarkets: normalizeBillboardHot100QueueMarkets(settings.polymarketMarkets),
    lastBillboardHot100DiscoveryAt:
      typeof settings.lastBillboardHot100DiscoveryAt === "string" ? settings.lastBillboardHot100DiscoveryAt : undefined
  };
}

function normalizeBillboardHot100QueueMarkets(value: unknown): PolymarketQueueMarket[] {
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

function upsertBillboardHot100QueueMarket(markets: PolymarketQueueMarket[], market: PolymarketQueueMarket): PolymarketQueueMarket[] {
  const existingIndex = markets.findIndex((candidate) => candidate.slug === market.slug);
  if (existingIndex === -1) {
    return sortMarkets([...markets, market]);
  }

  const next = [...markets];
  next[existingIndex] = { ...next[existingIndex], ...market, addedAt: next[existingIndex].addedAt };
  return sortMarkets(next);
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

function extractLabels($: cheerio.CheerioAPI, row: cheerio.Cheerio<AnyNode>): string[] {
  return row
    .find(".c-label")
    .map((_, element) => normalizeText($(element).text()))
    .get()
    .filter((label) => label.length > 0);
}

function isChartStatsLabel(label: string): boolean {
  return /^\d+$/.test(label) || /^(LW|PEAK|WEEKS)$/i.test(label) || /^\d{1,2}\/\d{1,2}\/\d{2}$/.test(label);
}

function extractChartDateLabel($: cheerio.CheerioAPI): string | null {
  const match = normalizeText($.root().text()).match(/\bWeek of\s+[A-Za-z]+\s+\d{1,2},\s+20\d{2}\b/i);
  return match ? normalizeText(match[0]).replace(/^week/i, "Week") : null;
}

function buildBillboardHot100ChartUrl(chartDate: string): string {
  return `${sourceUrl}${chartDate}/`;
}

function parseGammaDate(value: unknown): Date | null {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function parseYear(value: string | undefined): number | null {
  return value && /^20\d{2}$/.test(value) ? Number(value) : null;
}

function inferMarketYear(month: number | null, now: Date): number | null {
  if (!month) {
    return null;
  }

  const currentYear = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(now));
  const currentMonth = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric" }).format(now));
  if (month === 12 && currentMonth === 1) {
    return currentYear - 1;
  }
  if (month === 1 && currentMonth === 12) {
    return currentYear + 1;
  }
  return currentYear;
}

function monthName(month: number): string {
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  return names[month - 1] ?? String(month);
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${padNumber(month)}-${padNumber(day)}`;
}

function addDays(value: string, days: number): string {
  const timestamp = Date.parse(`${value}T12:00:00.000Z`);
  return new Date(timestamp + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function padNumber(value: number): string {
  return value.toString().padStart(2, "0");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
