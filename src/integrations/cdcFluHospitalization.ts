import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import { resolveIntegrationPolymarketQueue, type PolymarketQueueMarket } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.cdc.gov/fluview/index.html";
const fluSurvNetUrl = "https://gis.cdc.gov/grasp/fluview/fluhosprates.html";
const defaultPolymarketUrl = "https://polymarket.com/event/flu-hospitalization-rate-week-20-2026";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const fluHospitalizationMarketSearchQuery = "flu hospitalization rate week";
const fluHospitalizationMarketSearchTag = "flu";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 14 * 24 * 60 * 60_000;
const latestPriorReportSearchWeeks = 8;

export type FluHospitalizationPeriod = {
  year: number;
  week: number;
  label: string;
  weekStartDate: string;
  weekEndDate: string;
};

export type CdcFluHospitalizationReport = {
  period: FluHospitalizationPeriod;
  rate: number;
  reportDate: string | null;
  reportUrl: string;
};

type FluHospitalizationDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastFluHospitalizationDiscoveryAt?: string;
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

export function parseFluHospitalizationMarketPeriod(url: string): FluHospitalizationPeriod {
  const slug = getPolymarketSlug(url) ?? url;
  const match = slug.match(/(?:^|-)flu-hospitalization-rate-week-(\d{1,2})-(20\d{2})(?:-|$)/i);
  if (!match) {
    throw new Error(`Could not parse flu hospitalization market week from Polymarket URL: ${url}`);
  }

  const week = Number(match[1]);
  const year = Number(match[2]);
  if (!Number.isInteger(week) || week < 1 || week > 53) {
    throw new Error(`Invalid CDC FluView week in Polymarket URL: ${url}`);
  }

  return buildFluHospitalizationPeriod(year, week);
}

export function extractCdcFluHospitalizationReport(
  html: string,
  reportUrl: string
): CdcFluHospitalizationReport | null {
  const $ = cheerio.load(html);
  const text = normalizeText($.root().text());
  const rateMatch = text.match(
    /cumulative hospitalization rate observed in Week\s+(\d{1,2})\s+was\s+([0-9]+(?:\.[0-9]+)?)\s+per\s+100,000 population/i
  );
  if (!rateMatch) {
    return null;
  }

  const urlMatch = reportUrl.match(/(20\d{2})-week-(\d{1,2})\.html/i);
  const titleMatch = text.match(/Key Updates for Week\s+(\d{1,2}),\s+ending\s+[A-Za-z]+\s+\d{1,2},\s+(20\d{2})/i);
  const week = Number(titleMatch?.[1] ?? rateMatch[1] ?? urlMatch?.[2]);
  const year = Number(titleMatch?.[2] ?? urlMatch?.[1]);
  const rate = Number(rateMatch[2]);
  if (!Number.isInteger(year) || !Number.isInteger(week) || !Number.isFinite(rate)) {
    return null;
  }

  return {
    period: buildFluHospitalizationPeriod(year, week),
    rate,
    reportDate: extractCdcReportDate($),
    reportUrl
  };
}

export function formatCdcFluHospitalizationValue(
  targetPeriod: FluHospitalizationPeriod,
  targetReport: CdcFluHospitalizationReport | null,
  latestReport: CdcFluHospitalizationReport | null
): string {
  if (targetReport) {
    return [
      "Metric: CDC FluSurv-NET cumulative influenza-associated hospitalization rate",
      `Target week: ${targetPeriod.label}`,
      `Week dates: ${targetPeriod.weekStartDate} to ${targetPeriod.weekEndDate}`,
      "Status: published",
      `Value: ${formatRate(targetReport.rate)} per 100,000`,
      `Report date: ${targetReport.reportDate ?? "not listed"}`,
      `Report URL: ${targetReport.reportUrl}`,
      `FluSurv-NET app: ${fluSurvNetUrl}`,
      `Resolution: ${sourceUrl}`
    ].join("\n");
  }

  return [
    "Metric: CDC FluSurv-NET cumulative influenza-associated hospitalization rate",
    `Target week: ${targetPeriod.label}`,
    `Week dates: ${targetPeriod.weekStartDate} to ${targetPeriod.weekEndDate}`,
    "Status: not published yet",
    "Value: not published yet",
    `Latest available: ${latestReport ? formatLatestReport(latestReport) : "none found"}`,
    `Expected report URL: ${buildCdcFluWeeklyReportUrl(targetPeriod.year, targetPeriod.week)}`,
    `FluSurv-NET app: ${fluSurvNetUrl}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function shouldAlertOnCdcFluHospitalizationChange(previousValue: string | null, currentValue: string): boolean {
  if (!isPublishedFluHospitalizationValue(currentValue)) {
    return false;
  }

  const currentRate = extractPublishedRate(currentValue);
  const previousRate = extractPublishedRate(previousValue);
  return currentRate !== null && currentRate !== previousRate;
}

export const cdcFluHospitalizationAdapter: WebsiteAdapter = {
  id: "cdc-flu-hospitalization",
  commandName: "fluhosp",
  displayName: "CDC Flu Hospitalization Rate",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "fluhosp",
  alertRoleName: "CDC Flu Hosp Alerts",
  alertRoleEmoji: "\uD83C\uDFE5",
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "CDC FluView weekly hospitalization monitor",
  shouldAlertOnChange: shouldAlertOnCdcFluHospitalizationChange,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshFluHospitalizationPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async upsertPolymarketMarket(
    integration: Integration,
    url: string
  ): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertFluHospitalizationPolymarketQueueUrl(integration, url);
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const polymarketUrl = integration?.polymarketUrl ?? defaultPolymarketUrl;
    const targetPeriod = parseFluHospitalizationMarketPeriod(polymarketUrl);
    const targetReport = await fetchCdcFluHospitalizationWeeklyReport(targetPeriod.year, targetPeriod.week);
    const latestReport =
      targetReport ?? (await fetchLatestPriorCdcFluHospitalizationReport(targetPeriod, latestPriorReportSearchWeeks));
    const value = formatCdcFluHospitalizationValue(targetPeriod, targetReport, latestReport);
    return {
      value,
      rawValue: targetReport ? formatRate(targetReport.rate) : "not published yet",
      unit: "per 100,000",
      observedAt: new Date()
    };
  }
};

export async function refreshFluHospitalizationPolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseFluHospitalizationDiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverFluHospitalizationMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastFluHospitalizationDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const markets = normalizeFluHospitalizationQueueMarkets(settings.polymarketMarkets);
    const existingSlugs = new Set(markets.map((market) => market.slug));
    for (const candidate of await fetchFluHospitalizationMarketSearchCandidates()) {
      if (existingSlugs.has(candidate.slug)) {
        continue;
      }

      markets.push(buildFluHospitalizationQueueMarket(candidate.url, now, candidate.endDate));
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

export function upsertFluHospitalizationPolymarketQueueUrl(
  integration: Integration,
  url: string,
  now = new Date()
): { settingsJson: string | null; activeUrl: string | null } {
  const settings = parseFluHospitalizationDiscoverySettings(integration.settingsJson);
  const markets = normalizeFluHospitalizationQueueMarkets(settings.polymarketMarkets);
  const market = buildFluHospitalizationQueueMarket(url, now);
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

export function buildCdcFluWeeklyReportUrl(year: number, week: number): string {
  return `https://www.cdc.gov/fluview/surveillance/${year}-week-${week}.html`;
}

async function fetchCdcFluHospitalizationWeeklyReport(
  year: number,
  week: number
): Promise<CdcFluHospitalizationReport | null> {
  const reportUrl = buildCdcFluWeeklyReportUrl(year, week);
  const response = await fetchWithTimeout(reportUrl, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`CDC FluView weekly report returned HTTP ${response.status}`);
  }

  const report = extractCdcFluHospitalizationReport(await response.text(), reportUrl);
  if (!report && response.status === 200) {
    throw new Error(`Could not find FluSurv-NET cumulative hospitalization rate in ${reportUrl}`);
  }

  return report;
}

async function fetchLatestPriorCdcFluHospitalizationReport(
  targetPeriod: FluHospitalizationPeriod,
  maxWeeks: number
): Promise<CdcFluHospitalizationReport | null> {
  for (let week = targetPeriod.week - 1; week >= Math.max(1, targetPeriod.week - maxWeeks); week -= 1) {
    const report = await fetchCdcFluHospitalizationWeeklyReport(targetPeriod.year, week);
    if (report) {
      return report;
    }
  }

  return null;
}

function buildFluHospitalizationPeriod(year: number, week: number): FluHospitalizationPeriod {
  const weekStartDate = addDays(getMmwrWeekOneStartDate(year), (week - 1) * 7);
  const weekEndDate = addDays(weekStartDate, 6);
  return {
    year,
    week,
    label: `Week ${week}, ${year}`,
    weekStartDate,
    weekEndDate
  };
}

function buildFluHospitalizationQueueMarket(url: string, now: Date, gammaEndDate?: string | null): PolymarketQueueMarket {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${url}`);
  }

  const period = parseFluHospitalizationMarketPeriod(url);
  const startAt = parseManualEasternDateTime(`${period.weekStartDate} 00:00`)?.toISOString() ?? null;
  const fallbackEndAt = parseManualEasternDateTime(`${addDays(period.weekEndDate, 10)} 23:59`)?.toISOString() ?? null;
  return {
    url,
    slug,
    startAt,
    endAt: gammaEndDate ? endOfEasternDate(gammaEndDate)?.toISOString() ?? fallbackEndAt : fallbackEndAt,
    addedAt: now.toISOString()
  };
}

function shouldDiscoverFluHospitalizationMarkets(settings: FluHospitalizationDiscoverySettings, now: Date): boolean {
  const markets = normalizeFluHospitalizationQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastFluHospitalizationDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

async function fetchFluHospitalizationMarketSearchCandidates(): Promise<
  Array<{ slug: string; url: string; endDate: string | null }>
> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", fluHospitalizationMarketSearchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");
  searchUrl.searchParams.append("events_tag", fluHospitalizationMarketSearchTag);

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? []).map(normalizeFluHospitalizationSearchEvent).filter((candidate) => candidate !== null);
}

function normalizeFluHospitalizationSearchEvent(
  event: GammaSearchEvent
): { slug: string; url: string; endDate: string | null } | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  const slug = event.slug.trim();
  const title = event.title.toLowerCase().trim();
  if (!slug.startsWith("flu-hospitalization-rate-week-") || !title.startsWith("flu hospitalization rate week")) {
    return null;
  }

  try {
    parseFluHospitalizationMarketPeriod(`https://polymarket.com/event/${slug}`);
  } catch {
    return null;
  }

  return {
    slug,
    url: `https://polymarket.com/event/${slug}`,
    endDate: isNonEmptyString(event.endDate) ? event.endDate : null
  };
}

function parseFluHospitalizationDiscoverySettings(settingsJson: string | null): FluHospitalizationDiscoverySettings {
  const settings = parseSettingsJson(settingsJson) as FluHospitalizationDiscoverySettings;
  return {
    ...settings,
    polymarketMarkets: normalizeFluHospitalizationQueueMarkets(settings.polymarketMarkets),
    lastFluHospitalizationDiscoveryAt:
      typeof settings.lastFluHospitalizationDiscoveryAt === "string"
        ? settings.lastFluHospitalizationDiscoveryAt
        : undefined
  };
}

function normalizeFluHospitalizationQueueMarkets(value: unknown): PolymarketQueueMarket[] {
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

function endOfEasternDate(value: string): Date | null {
  if (Number.isNaN(Date.parse(value))) {
    return null;
  }

  return parseManualEasternDateTime(`${value.slice(0, 10)} 23:59`);
}

function extractCdcReportDate($: cheerio.CheerioAPI): string | null {
  return (
    normalizeText($("time.cdc-page-title-bar__item--date").first().text()) ||
    normalizeText($("meta[property='cdc:last_updated']").attr("content") ?? "") ||
    null
  );
}

function formatLatestReport(report: CdcFluHospitalizationReport): string {
  return `${report.period.label} = ${formatRate(report.rate)} per 100,000 (report date: ${
    report.reportDate ?? "not listed"
  })`;
}

function isPublishedFluHospitalizationValue(value: string): boolean {
  return /^Status:\s*published$/im.test(value) && extractPublishedRate(value) !== null;
}

function extractPublishedRate(value: string | null): number | null {
  const match = value?.match(/^Value:\s*([0-9]+(?:\.[0-9]+)?)\s+per\s+100,000$/im);
  return match ? Number(match[1]) : null;
}

function getMmwrWeekOneStartDate(year: number): string {
  const jan1 = new Date(Date.UTC(year, 0, 1, 12));
  const sundayBeforeJan1 = addDays(formatDate(jan1), -jan1.getUTCDay());
  const daysInNewYear = 7 - jan1.getUTCDay();
  return daysInNewYear >= 4 ? sundayBeforeJan1 : addDays(sundayBeforeJan1, 7);
}

function addDays(value: string, days: number): string {
  const timestamp = Date.parse(`${value}T12:00:00.000Z`);
  return new Date(timestamp + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatRate(value: number): string {
  return value.toFixed(1);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
