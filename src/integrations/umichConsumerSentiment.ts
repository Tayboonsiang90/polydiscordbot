import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import { resolveIntegrationPolymarketQueue, type PolymarketQueueMarket } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://data.sca.isr.umich.edu/";
const timeSeriesUrl = "https://data.sca.isr.umich.edu/data-archive/mine.php";
const defaultPolymarketUrl =
  "https://polymarket.com/event/university-of-michigan-consumer-sentiment-july-2026-20260630013808102";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const gammaEventsUrl = "https://gamma-api.polymarket.com/events";
const umichMarketSearchQuery = "university of michigan consumer sentiment";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 21 * 24 * 60 * 60_000;
const easternTimeZone = "America/New_York";

export type UmichConsumerSentimentRow = {
  month: number;
  year: number;
  value: string;
};

export type UmichReleaseLink = {
  date: string;
  title: string;
  url: string;
};

export type UmichMarketPeriod = {
  month: number;
  year: number;
  label: string;
  finalReleaseTitle: string;
  scheduledReleaseDate: string;
  scheduledReleaseTime: string;
  scheduledReleaseLabel: string;
};

type UmichDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastUmichDiscoveryAt?: string;
};

type GammaSearchResponse = {
  events?: GammaSearchEvent[];
};

type GammaEventResponse = GammaSearchEvent[];

type GammaSearchEvent = {
  slug?: unknown;
  title?: unknown;
  description?: unknown;
  active?: unknown;
  closed?: unknown;
  startDate?: unknown;
  creationDate?: unknown;
  createdAt?: unknown;
  endDate?: unknown;
};

export const umichConsumerSentimentAdapter: WebsiteAdapter = {
  id: "umich-consumer-sentiment",
  commandName: "umichsentiment",
  displayName: "UMich Consumer Sentiment",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "umichsentiment",
  alertRoleName: "UMich Sentiment Alerts",
  alertRoleEmoji: "\uD83D\uDCCA",
  getPollIntervalMinutes: getUmichConsumerSentimentPollIntervalMinutes,
  getPollIntervalReason: getUmichConsumerSentimentPollIntervalReason,
  shouldAlertOnChange: umichConsumerSentimentShouldAlertOnChange,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshUmichPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async upsertPolymarketMarket(
    integration: Integration,
    url: string
  ): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertUmichPolymarketQueueUrl(integration, url);
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const polymarketUrl = integration?.polymarketUrl ?? defaultPolymarketUrl;
    const period = parseUmichMarketPeriod(polymarketUrl);
    const [landingResponse, timeSeriesResponse] = await Promise.all([
      fetchWithTimeout(sourceUrl, {
        headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
      }),
      fetchWithTimeout(timeSeriesUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
        },
        body: buildTimeSeriesRequestBody(period.year)
      })
    ]);

    if (!landingResponse.ok) {
      throw new Error(`UMich landing page returned HTTP ${landingResponse.status}`);
    }

    if (!timeSeriesResponse.ok) {
      throw new Error(`UMich time series returned HTTP ${timeSeriesResponse.status}`);
    }

    const releases = extractUmichReleaseLinks(await landingResponse.text());
    const rows = extractUmichConsumerSentimentRows(await timeSeriesResponse.text());
    const targetRow = rows.find((row) => row.month === period.month && row.year === period.year) ?? null;
    const latestRow = rows.at(-1) ?? null;
    const targetFinalRelease = findTargetFinalRelease(releases, period);
    const value = buildUmichConsumerSentimentValue(targetRow, latestRow, targetFinalRelease, period);

    return {
      value,
      rawValue: targetRow && targetFinalRelease ? targetRow.value : "not published yet",
      unit: "consumer sentiment index",
      observedAt: new Date()
    };
  }
};

export function extractUmichConsumerSentimentRows(csv: string): UmichConsumerSentimentRow[] {
  return csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d{1,2},\d{4},/.test(line))
    .flatMap((line) => {
      const [monthRaw, yearRaw, valueRaw] = line.split(",");
      const month = Number(monthRaw);
      const year = Number(yearRaw);
      const value = valueRaw?.trim();
      if (!Number.isInteger(month) || !Number.isInteger(year) || !value || !/^\d{1,3}(?:\.\d+)?$/.test(value)) {
        return [];
      }

      return [{ month, year, value: formatOneDecimal(value) }];
    });
}

export function extractUmichReleaseLinks(html: string): UmichReleaseLink[] {
  const $ = cheerio.load(html);
  return $("td.title a")
    .toArray()
    .flatMap((element) => {
      const title = normalizeText($(element).text());
      const date = normalizeText($(element).closest("tr").find("td.date").text());
      const href = $(element).attr("href");
      if (!title || !date || !href) {
        return [];
      }

      return [{ title, date, url: new URL(href, sourceUrl).toString() }];
    });
}

export function buildUmichConsumerSentimentValue(
  targetRow: UmichConsumerSentimentRow | null,
  latestRow: UmichConsumerSentimentRow | null,
  targetFinalRelease: UmichReleaseLink | null,
  period: UmichMarketPeriod
): string {
  if (targetRow && targetFinalRelease) {
    return [
      "Report: University of Michigan Surveys of Consumers final release",
      `Target period: ${period.label}`,
      "Target status: final release published",
      `Value: ${targetRow.value}`,
      "Precision: one decimal point",
      `Final release: ${targetFinalRelease.date}`,
      `Release URL: ${targetFinalRelease.url}`
    ].join("\n");
  }

  return [
    "Report: University of Michigan Surveys of Consumers final release",
    `Target period: ${period.label}`,
    "Target status: not published yet",
    "Value: not published yet",
    `Scheduled release: ${period.scheduledReleaseLabel}`,
    `Latest final time series row: ${latestRow ? `${formatPeriod(latestRow)} = ${latestRow.value}` : "none"}`,
    `${monthName(period.month)} final release link: ${targetFinalRelease ? targetFinalRelease.url : "not found yet"}`,
    `Time series URL: ${timeSeriesUrl}`
  ].join("\n");
}

export function parseUmichMarketPeriod(
  polymarketUrl: string,
  now: Date = new Date(),
  description?: string | null
): UmichMarketPeriod {
  const slug = getPolymarketSlug(polymarketUrl) ?? polymarketUrl;
  const parts = slug.split("-").map((part) => part.toLowerCase());
  const sentimentIndex = parts.findIndex((part) => part === "sentiment");
  const startIndex = sentimentIndex === -1 ? 0 : sentimentIndex + 1;

  for (let index = startIndex; index < parts.length - 1; index += 1) {
    const month = monthNumber(parts[index]);
    const year = parseYear(parts[index + 1]);
    if (month && year) {
      return buildUmichMarketPeriod(month, year, description);
    }
  }

  throw new Error(`Could not parse UMich Consumer Sentiment month/year from Polymarket URL: ${polymarketUrl}`);
}

export function getUmichConsumerSentimentPollIntervalMinutes(integration: Integration, now: Date = new Date()): number {
  if (integration.lastValue?.includes("Target status: final release published")) {
    return 1_440;
  }

  const period = parseUmichMarketPeriod(integration.polymarketUrl ?? defaultPolymarketUrl, now);
  const currentDate = getEasternDate(now);
  const watchStartDate = addDays(period.scheduledReleaseDate, -1);
  if (currentDate < watchStartDate) {
    return 1_440;
  }

  return currentDate === watchStartDate || currentDate === period.scheduledReleaseDate ? 1 : 60;
}

export function getUmichConsumerSentimentPollIntervalReason(integration: Integration, now: Date = new Date()): string {
  const period = parseUmichMarketPeriod(integration.polymarketUrl ?? defaultPolymarketUrl, now);
  if (integration.lastValue?.includes("Target status: final release published")) {
    return `UMich final ${period.label} sentiment already published; daily verification only`;
  }

  const currentDate = getEasternDate(now);
  const watchStartDate = addDays(period.scheduledReleaseDate, -1);
  if (currentDate < watchStartDate) {
    return `UMich normal mode before ${watchStartDate} ET; daily check only`;
  }

  return currentDate === watchStartDate || currentDate === period.scheduledReleaseDate
    ? `UMich final sentiment release watch on day before/day of ${period.scheduledReleaseLabel}`
    : `UMich late-release watch after ${period.scheduledReleaseLabel}`;
}

export function umichConsumerSentimentShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  const publishedNow = currentValue.includes("Target status: final release published");
  const publishedBefore = previousValue?.includes("Target status: final release published") ?? false;
  if (publishedNow && !publishedBefore) {
    return true;
  }

  return publishedNow && publishedBefore && extractPublishedValue(previousValue) !== extractPublishedValue(currentValue);
}

export async function refreshUmichPolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseUmichDiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverUmichMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastUmichDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const markets = normalizeUmichQueueMarkets(settings.polymarketMarkets);
    const existingSlugs = new Set(markets.map((market) => market.slug));
    for (const candidate of await fetchUmichMarketSearchCandidates(now)) {
      if (existingSlugs.has(candidate.slug)) {
        continue;
      }

      markets.push(candidate);
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

export async function upsertUmichPolymarketQueueUrl(
  integration: Integration,
  url: string,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  const settings = parseUmichDiscoverySettings(integration.settingsJson);
  const markets = normalizeUmichQueueMarkets(settings.polymarketMarkets);
  const market = (await fetchUmichMarketByUrl(url, now).catch(() => null)) ?? buildUmichQueueMarketFromUrl(url, now);
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
        polymarketMarkets: sortMarkets(markets)
      })
    },
    now
  );
}

export function buildUmichQueueMarketFromGammaEvent(event: GammaSearchEvent, now: Date = new Date()): PolymarketQueueMarket {
  if (!isNonEmptyString(event.slug)) {
    throw new Error("UMich Gamma event is missing a slug");
  }

  const slug = event.slug.trim();
  const url = `https://polymarket.com/event/${slug}`;
  const period = parseUmichMarketPeriod(url, now, isNonEmptyString(event.description) ? event.description : null);
  return {
    url,
    slug,
    startAt:
      parseGammaDate(event.startDate)?.toISOString() ??
      parseGammaDate(event.creationDate)?.toISOString() ??
      parseGammaDate(event.createdAt)?.toISOString() ??
      now.toISOString(),
    endAt: parseManualEasternDateTime(`${period.scheduledReleaseDate} 23:59`)?.toISOString() ?? parseGammaDate(event.endDate)?.toISOString() ?? null,
    addedAt: now.toISOString()
  };
}

function findTargetFinalRelease(releases: UmichReleaseLink[], period: UmichMarketPeriod): UmichReleaseLink | null {
  return releases.find((release) => release.title.toLowerCase() === period.finalReleaseTitle.toLowerCase()) ?? null;
}

function buildTimeSeriesRequestBody(year: number): URLSearchParams {
  return new URLSearchParams({
    table: "1",
    year: String(year),
    qorm: "M",
    order: "asc",
    format: "Comma-Separated (CSV)"
  });
}

function shouldDiscoverUmichMarkets(settings: UmichDiscoverySettings, now: Date): boolean {
  const markets = normalizeUmichQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastUmichDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

async function fetchUmichMarketSearchCandidates(now: Date): Promise<PolymarketQueueMarket[]> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", umichMarketSearchQuery);
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
    .map((event) => normalizeUmichSearchEvent(event, now))
    .filter((candidate): candidate is PolymarketQueueMarket => candidate !== null);
}

async function fetchUmichMarketByUrl(url: string, now: Date): Promise<PolymarketQueueMarket | null> {
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
  return event ? buildUmichQueueMarketFromGammaEvent(event, now) : null;
}

function normalizeUmichSearchEvent(event: GammaSearchEvent, now: Date): PolymarketQueueMarket | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  const slug = event.slug.trim();
  const title = event.title.toLowerCase().trim();
  if (!slug.startsWith("university-of-michigan-consumer-sentiment-") || !title.startsWith("university of michigan consumer sentiment")) {
    return null;
  }

  try {
    return buildUmichQueueMarketFromGammaEvent(event, now);
  } catch {
    return null;
  }
}

function buildUmichQueueMarketFromUrl(url: string, now: Date): PolymarketQueueMarket {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${url}`);
  }

  const period = parseUmichMarketPeriod(url, now);
  return {
    url,
    slug,
    startAt: now.toISOString(),
    endAt: parseManualEasternDateTime(`${period.scheduledReleaseDate} 23:59`)?.toISOString() ?? null,
    addedAt: now.toISOString()
  };
}

function parseUmichDiscoverySettings(settingsJson: string | null): UmichDiscoverySettings {
  const settings = parseSettingsJson(settingsJson) as UmichDiscoverySettings;
  return {
    ...settings,
    polymarketMarkets: normalizeUmichQueueMarkets(settings.polymarketMarkets),
    lastUmichDiscoveryAt: typeof settings.lastUmichDiscoveryAt === "string" ? settings.lastUmichDiscoveryAt : undefined
  };
}

function normalizeUmichQueueMarkets(value: unknown): PolymarketQueueMarket[] {
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

function buildUmichMarketPeriod(month: number, year: number, description?: string | null): UmichMarketPeriod {
  const scheduledRelease = extractScheduledRelease(description, month, year) ?? getDefaultScheduledRelease(month, year);
  return {
    month,
    year,
    label: `${monthName(month)} ${year}`,
    finalReleaseTitle: `${monthName(month)} Final Results`,
    scheduledReleaseDate: scheduledRelease.date,
    scheduledReleaseTime: scheduledRelease.time,
    scheduledReleaseLabel: `${formatDisplayDate(scheduledRelease.date)} ${scheduledRelease.time} ET`
  };
}

function extractScheduledRelease(description: string | null | undefined, targetMonth: number, targetYear: number): { date: string; time: string } | null {
  if (!description) {
    return null;
  }

  const match = description.match(
    /scheduled\s+to\s+be\s+released\s+on\s+([A-Za-z]+)\s+(\d{1,2}),\s+(20\d{2}),\s+at\s+(\d{1,2}:\d{2})\s*([AP]M)\s+ET/i
  );
  const month = monthNumber(match?.[1]?.toLowerCase());
  const day = match?.[2] ? Number(match[2]) : NaN;
  const year = match?.[3] ? Number(match[3]) : NaN;
  if (!month || month !== targetMonth || year !== targetYear || !Number.isInteger(day)) {
    return null;
  }

  return {
    date: formatDate(year, month, day),
    time: `${match?.[4] ?? "10:00"} ${(match?.[5] ?? "AM").toUpperCase()}`
  };
}

function getDefaultScheduledRelease(month: number, year: number): { date: string; time: string } {
  const cursor = new Date(Date.UTC(year, month, 0, 12));
  while (cursor.getUTCDay() !== 5) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return {
    date: formatDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate()),
    time: "10:00 AM"
  };
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

function formatPeriod(row: UmichConsumerSentimentRow): string {
  return `${String(row.month).padStart(2, "0")}/${row.year}`;
}

function extractPublishedValue(value: string | null): string | null {
  return value?.match(/^Value:\s*(.+)$/m)?.[1] ?? null;
}

function getEasternDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: easternTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function getEasternYear(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: easternTimeZone, year: "numeric" }).format(date));
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

function parseYear(value: string | undefined): number | null {
  return value && /^20\d{2}$/.test(value) ? Number(value) : null;
}

function parseGammaDate(value: unknown): Date | null {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(value: string, days: number): string {
  const timestamp = Date.parse(`${value}T12:00:00.000Z`);
  return new Date(timestamp + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${padNumber(month)}-${padNumber(day)}`;
}

function formatDisplayDate(value: string): string {
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  return `${monthName(Number(monthRaw))} ${Number(dayRaw)}, ${yearRaw}`;
}

function formatOneDecimal(value: string): string {
  return Number.parseFloat(value).toFixed(1);
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
