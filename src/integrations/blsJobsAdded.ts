import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import { resolveIntegrationPolymarketQueue, type PolymarketQueueMarket } from "../polymarketQueue.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.bls.gov/bls/newsrels.htm";
const currentReportUrl = "https://www.bls.gov/news.release/empsit.nr0.htm";
const defaultPolymarketUrl = "https://polymarket.com/event/how-many-jobs-added-in-may-945";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const jobsMarketSearchQuery = "how many jobs added";
const jobsMarketSearchTag = "nonfarm-payroll";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 21 * 24 * 60 * 60_000;
const easternTimeZone = "America/New_York";

type JobsPeriod = {
  year: number;
  month: number;
  label: string;
};

export type BlsEmploymentSituationReport = {
  period: JobsPeriod;
  changeJobs: number;
  releaseDate: string | null;
  reportUrl: string;
};

type JobsDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastJobsDiscoveryAt?: string;
};

type GammaSearchResponse = {
  events?: GammaSearchEvent[];
};

type GammaSearchEvent = {
  slug?: unknown;
  title?: unknown;
  active?: unknown;
  closed?: unknown;
  tags?: Array<{ slug?: unknown }>;
};

export function extractBlsJobsAddedValue(
  reportHtmlByUrl: Map<string, string>,
  polymarketUrl: string,
  now = new Date()
): string {
  const targetPeriod = parseJobsAddedMarketPeriod(polymarketUrl, now);
  const reports = [...reportHtmlByUrl.entries()]
    .flatMap(([reportUrl, html]) => {
      const report = extractBlsEmploymentSituationReport(html, reportUrl);
      return report ? [report] : [];
    })
    .sort((left, right) => comparePeriod(left.period, right.period));
  const targetReport = reports.find((report) => samePeriod(report.period, targetPeriod)) ?? null;
  const latestReport = reports.at(-1) ?? null;
  return buildBlsJobsAddedValue(targetPeriod, targetReport, latestReport, now);
}

export function extractBlsEmploymentSituationReport(
  html: string,
  reportUrl: string
): BlsEmploymentSituationReport | null {
  const text = normalizeText(cheerio.load(html).root().text());
  const period = extractReportPeriod(text);
  if (!period) {
    return null;
  }

  const changeJobs = extractNonfarmPayrollChange(text, period);
  if (changeJobs === null) {
    return null;
  }

  return {
    period,
    changeJobs,
    releaseDate: extractReportReleaseDate(text),
    reportUrl
  };
}

export function parseJobsAddedMarketPeriod(url: string, now = new Date()): JobsPeriod {
  const slug = getPolymarketSlug(url) ?? url;
  const parts = slug.split("-").map((part) => part.toLowerCase());
  const month = parts.map(monthNumber).find((value): value is number => value !== null);
  if (!month) {
    throw new Error(`Could not parse jobs-added market month from Polymarket URL: ${url}`);
  }

  const explicitYear = parts.map(parseYear).find((value): value is number => value !== null);
  const year = explicitYear ?? inferMonthOnlyMarketYear(month, now);
  return { year, month, label: `${monthName(month)} ${year}` };
}

export function getJobsAddedScheduledReleaseDate(period: JobsPeriod): string {
  const releaseMonth = period.month === 12 ? 1 : period.month + 1;
  const releaseYear = period.month === 12 ? period.year + 1 : period.year;
  const cursor = new Date(Date.UTC(releaseYear, releaseMonth - 1, 3, 12));
  while (cursor.getUTCDay() !== 5) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return formatDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
}

export function getBlsJobsAddedPollIntervalMinutes(integration: Integration, now: Date = new Date()): number {
  return isReleaseWatchDay(integration, now) ? 1 : 60;
}

export function getBlsJobsAddedPollIntervalReason(integration: Integration, now: Date = new Date()): string {
  const period = parseJobsAddedMarketPeriod(integration.polymarketUrl ?? defaultPolymarketUrl, now);
  const releaseDate = getJobsAddedScheduledReleaseDate(period);
  return isReleaseWatchDay(integration, now)
    ? `BLS jobs release watch: day before/day of ${releaseDate} ET`
    : `BLS jobs normal mode outside day before/day of ${releaseDate} ET`;
}

export function shouldAlertOnBlsJobsAddedChange(previousValue: string | null, currentValue: string): boolean {
  return !currentValue.includes("Status: not published yet") && previousValue !== currentValue;
}

export const blsJobsAddedAdapter: WebsiteAdapter = {
  id: "bls-jobs-added",
  commandName: "jobsadded",
  displayName: "BLS Jobs Added",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "jobsadded",
  alertRoleName: "BLS Jobs Added Alerts",
  alertRoleEmoji: "\uD83D\uDCBC",
  getPollIntervalMinutes: getBlsJobsAddedPollIntervalMinutes,
  getPollIntervalReason: getBlsJobsAddedPollIntervalReason,
  shouldAlertOnChange: shouldAlertOnBlsJobsAddedChange,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshBlsJobsAddedPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async upsertPolymarketMarket(
    integration: Integration,
    url: string
  ): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertBlsJobsAddedPolymarketQueueUrl(integration, url);
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const polymarketUrl = integration?.polymarketUrl ?? defaultPolymarketUrl;
    const period = parseJobsAddedMarketPeriod(polymarketUrl);
    const releaseDate = getJobsAddedScheduledReleaseDate(period);
    const reportUrls = uniqueUrls([currentReportUrl, buildArchiveReportUrl(releaseDate)]);
    const reportHtmlByUrl = new Map<string, string>();

    for (const reportUrl of reportUrls) {
      const response = await fetchWithTimeout(reportUrl, {
        headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
      });
      if (!response.ok) {
        continue;
      }
      reportHtmlByUrl.set(reportUrl, await response.text());
    }

    if (reportHtmlByUrl.size === 0) {
      throw new Error("Could not fetch the current or archived BLS Employment Situation Summary");
    }

    const value = extractBlsJobsAddedValue(reportHtmlByUrl, polymarketUrl);
    return {
      value,
      rawValue: value,
      unit: "jobs",
      observedAt: new Date()
    };
  }
};

export async function refreshBlsJobsAddedPolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseJobsDiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverJobsMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastJobsDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const markets = normalizeJobsQueueMarkets(settings.polymarketMarkets);
    const existingSlugs = new Set(markets.map((market) => market.slug));
    for (const candidate of await fetchJobsMarketSearchCandidates(now)) {
      if (existingSlugs.has(candidate.slug)) {
        continue;
      }

      markets.push(buildJobsQueueMarket(candidate.url, now));
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

export function upsertBlsJobsAddedPolymarketQueueUrl(
  integration: Integration,
  url: string,
  now = new Date()
): { settingsJson: string | null; activeUrl: string | null } {
  const settings = parseJobsDiscoverySettings(integration.settingsJson);
  const markets = normalizeJobsQueueMarkets(settings.polymarketMarkets);
  const market = buildJobsQueueMarket(url, now);
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

function buildBlsJobsAddedValue(
  targetPeriod: JobsPeriod,
  targetReport: BlsEmploymentSituationReport | null,
  latestReport: BlsEmploymentSituationReport | null,
  now: Date
): string {
  const scheduledReleaseDate = getJobsAddedScheduledReleaseDate(targetPeriod);
  if (targetReport) {
    return [
      "Metric: BLS total nonfarm payroll employment change",
      `Period: ${targetPeriod.label}`,
      "Status: published",
      `Value: ${formatSignedJobs(targetReport.changeJobs)}`,
      `Report release: ${targetReport.releaseDate ?? "unknown"}`,
      `Scheduled release: ${scheduledReleaseDate} 08:30 ET`,
      `Report URL: ${targetReport.reportUrl}`
    ].join("\n");
  }

  const fallbackDate = getJobsAddedScheduledReleaseDate(addMonths(targetPeriod, 1));
  if (latestReport && isAfterEasternRelease(now, fallbackDate)) {
    return [
      "Metric: BLS total nonfarm payroll employment change",
      `Period: ${targetPeriod.label}`,
      "Status: fallback latest available",
      `Value: ${formatSignedJobs(latestReport.changeJobs)}`,
      `Fallback reason: target period not published by ${fallbackDate} 08:30 ET`,
      `Latest available: ${latestReport.period.label} = ${formatSignedJobs(latestReport.changeJobs)}`,
      `Report URL: ${latestReport.reportUrl}`
    ].join("\n");
  }

  return [
    "Metric: BLS total nonfarm payroll employment change",
    `Period: ${targetPeriod.label}`,
    "Status: not published yet",
    "Value: not published yet",
    `Scheduled release: ${scheduledReleaseDate} 08:30 ET`,
    `Latest available: ${latestReport ? `${latestReport.period.label} = ${formatSignedJobs(latestReport.changeJobs)}` : "none"}`,
    `Report URL: ${latestReport?.reportUrl ?? currentReportUrl}`
  ].join("\n");
}

function extractReportPeriod(text: string): JobsPeriod | null {
  const match = text.match(/THE EMPLOYMENT SITUATION\s*--\s*([A-Za-z]+)\s+(20\d{2})/i);
  const month = monthNumber(match?.[1]?.toLowerCase());
  const year = match?.[2] ? Number(match[2]) : NaN;
  if (!month || !Number.isInteger(year)) {
    return null;
  }
  return { year, month, label: `${monthName(month)} ${year}` };
}

function extractReportReleaseDate(text: string): string | null {
  return text.match(/8:30\s*a\.m\.\s*\(ET\)\s*[A-Za-z]+,\s*([A-Za-z]+\s+\d{1,2},\s+20\d{2})/i)?.[1] ?? null;
}

function extractNonfarmPayrollChange(text: string, period: JobsPeriod): number | null {
  const month = period.label.split(" ")[0];
  const positivePattern = new RegExp(
    `Total\\s+nonfarm\\s+payroll\\s+employment\\s+(?:edged\\s+up|increased|rose|grew|was\\s+up)\\s+by\\s+([\\d,]+)\\s+in\\s+${month}`,
    "i"
  );
  const negativePattern = new RegExp(
    `Total\\s+nonfarm\\s+payroll\\s+employment\\s+(?:edged\\s+down|declined|decreased|fell|was\\s+down)\\s+by\\s+([\\d,]+)\\s+in\\s+${month}`,
    "i"
  );
  const positiveMatch = text.match(positivePattern);
  if (positiveMatch?.[1]) {
    return parseInteger(positiveMatch[1]);
  }

  const negativeMatch = text.match(negativePattern);
  if (negativeMatch?.[1]) {
    const value = parseInteger(negativeMatch[1]);
    return value === null ? null : -value;
  }

  return extractNonfarmPayrollChangeFromTable(text);
}

function extractNonfarmPayrollChangeFromTable(text: string): number | null {
  const tableIndex = text.indexOf("Table B-1.");
  if (tableIndex === -1) {
    return null;
  }

  const tableText = text.slice(tableIndex);
  const match = tableText.match(/Total nonfarm(?:\s+[-\d,]+|\s+\(\s*p\s*\)){8,12}\s+([+-]?\d[\d,]*)\s+Total private/i);
  return match?.[1] ? parseInteger(match[1]) : null;
}

function shouldDiscoverJobsMarkets(settings: JobsDiscoverySettings, now: Date): boolean {
  const markets = normalizeJobsQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastJobsDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

async function fetchJobsMarketSearchCandidates(now: Date): Promise<Array<{ slug: string; url: string }>> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", jobsMarketSearchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");
  searchUrl.searchParams.append("events_tag", jobsMarketSearchTag);

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? [])
    .map((event) => normalizeJobsSearchEvent(event, now))
    .filter((candidate) => candidate !== null);
}

function normalizeJobsSearchEvent(event: GammaSearchEvent, now: Date): { slug: string; url: string } | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  const slug = event.slug.trim();
  const title = event.title.toLowerCase().trim();
  if (!slug.startsWith("how-many-jobs-added-in-") || !title.startsWith("how many jobs added in")) {
    return null;
  }

  const tagSlugs = new Set((event.tags ?? []).map((tag) => tag.slug).filter(isNonEmptyString));
  if (!tagSlugs.has("nonfarm-payroll") && !tagSlugs.has("nfp")) {
    return null;
  }

  try {
    parseJobsAddedMarketPeriod(`https://polymarket.com/event/${slug}`, now);
    return { slug, url: `https://polymarket.com/event/${slug}` };
  } catch {
    return null;
  }
}

function buildJobsQueueMarket(url: string, now: Date): PolymarketQueueMarket {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${url}`);
  }

  const period = parseJobsAddedMarketPeriod(url, now);
  const startAt = parseManualEasternDateTime(`${period.year}-${padNumber(period.month)}-01 00:00`)?.toISOString() ?? null;
  const releaseDate = getJobsAddedScheduledReleaseDate(period);
  const endAt = parseManualEasternDateTime(`${releaseDate} 23:59`)?.toISOString() ?? null;
  return { url, slug, startAt, endAt, addedAt: now.toISOString() };
}

function parseJobsDiscoverySettings(settingsJson: string | null): JobsDiscoverySettings {
  if (!settingsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(settingsJson) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const settings = parsed as JobsDiscoverySettings;
    return {
      ...settings,
      polymarketMarkets: normalizeJobsQueueMarkets(settings.polymarketMarkets),
      lastJobsDiscoveryAt: typeof settings.lastJobsDiscoveryAt === "string" ? settings.lastJobsDiscoveryAt : undefined
    };
  } catch {
    return {};
  }
}

function normalizeJobsQueueMarkets(value: unknown): PolymarketQueueMarket[] {
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

function isReleaseWatchDay(integration: Integration, now: Date): boolean {
  const period = parseJobsAddedMarketPeriod(integration.polymarketUrl ?? defaultPolymarketUrl, now);
  const releaseDate = getJobsAddedScheduledReleaseDate(period);
  const currentDate = getEasternDate(now);
  return currentDate === addDays(releaseDate, -1) || currentDate === releaseDate;
}

function isAfterEasternRelease(now: Date, date: string): boolean {
  const releaseAt = parseManualEasternDateTime(`${date} 08:30`);
  return Boolean(releaseAt && now.getTime() >= releaseAt.getTime());
}

function buildArchiveReportUrl(releaseDate: string): string {
  const [year, month, day] = releaseDate.split("-");
  return `https://www.bls.gov/news.release/archives/empsit_${month}${day}${year}.htm`;
}

function addMonths(period: JobsPeriod, months: number): JobsPeriod {
  const date = new Date(Date.UTC(period.year, period.month - 1 + months, 1));
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  return { year, month, label: `${monthName(month)} ${year}` };
}

function samePeriod(left: JobsPeriod, right: JobsPeriod): boolean {
  return left.year === right.year && left.month === right.month;
}

function comparePeriod(left: JobsPeriod, right: JobsPeriod): number {
  return left.year - right.year || left.month - right.month;
}

function parseInteger(value: string): number | null {
  const normalized = value.replace(/,/g, "").trim();
  if (!/^[+-]?\d+$/.test(normalized)) {
    return null;
  }
  return Number(normalized);
}

function formatSignedJobs(value: number): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} jobs`;
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
  return value && /^20\d{2}$/.test(value) ? Number(value) : null;
}

function inferMonthOnlyMarketYear(month: number, now: Date): number {
  const currentYear = getEasternYear(now);
  const currentMonth = Number(new Intl.DateTimeFormat("en-US", { timeZone: easternTimeZone, month: "numeric" }).format(now));
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

function addDays(value: string, days: number): string {
  const timestamp = Date.parse(`${value}T12:00:00.000Z`);
  return new Date(timestamp + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${padNumber(month)}-${padNumber(day)}`;
}

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function uniqueUrls(urls: string[]): string[] {
  return [...new Set(urls)];
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
