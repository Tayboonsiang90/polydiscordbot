import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.census.gov/manufacturing/m3/adv/current/index.html";
const targetPeriod = "May 2026";
const scheduledReleaseLabel = "June 25, 2026 8:30 AM ET";
const releaseDateEt = "2026-06-25";
const easternTimeZone = "America/New_York";

const monthNames = [
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

export type CensusDurableGoodsReport = {
  period: string;
  value: string;
  direction: "increased" | "decreased" | "unchanged";
  releaseDate: string | null;
  reportUrl: string;
};

export const censusDurableGoodsAdapter: WebsiteAdapter = {
  id: "census-durable-goods",
  commandName: "durablegoods",
  displayName: "Census Durable Goods Orders",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/durable-goods-orders-mom-may-2026",
  defaultChannelName: "durablegoods",
  alertRoleName: "Durable Goods Alerts",
  alertRoleEmoji: "\uD83C\uDFED",
  getPollIntervalMinutes: getCensusDurableGoodsPollIntervalMinutes,
  getPollIntervalReason: getCensusDurableGoodsPollIntervalReason,
  shouldAlertOnChange: censusDurableGoodsShouldAlertOnChange,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Census durable goods page returned HTTP ${response.status}`);
    }

    const report = extractCensusDurableGoodsReport(await response.text(), sourceUrl);
    const targetReport = report?.period === targetPeriod ? report : null;
    const value = buildCensusDurableGoodsValue(targetReport, report);
    return {
      value,
      rawValue: targetReport ? formatSignedPercent(targetReport.value) : "not published yet",
      unit: "seasonally adjusted MoM percent change",
      observedAt: new Date()
    };
  }
};

export function extractCensusDurableGoodsReport(html: string, reportUrl = sourceUrl): CensusDurableGoodsReport | null {
  const $ = cheerio.load(html);
  const text = normalizeText($.root().text());
  const releaseDate = extractReleaseDate(text);
  const newOrdersMatch = text.match(/\bNew orders for manufactured durable goods in ([A-Za-z]+),\s+/i);
  if (!newOrdersMatch || newOrdersMatch.index === undefined) {
    return null;
  }

  const month = titleCaseMonth(newOrdersMatch[1]);
  if (!month) {
    return null;
  }

  const releaseYear = releaseDate ? Number(releaseDate.match(/\b(20\d{2})\b/)?.[1]) : new Date().getUTCFullYear();
  const periodYear = inferPeriodYear(month, releaseDate, releaseYear);
  const parsed = parseDurableGoodsPercentChange(extractNewOrdersSentenceTail(text, newOrdersMatch));
  if (!parsed) {
    return null;
  }

  return {
    period: `${month} ${periodYear}`,
    value: parsed.value,
    direction: parsed.direction,
    releaseDate,
    reportUrl
  };
}

export function buildCensusDurableGoodsValue(
  targetReport: CensusDurableGoodsReport | null,
  latestReport: CensusDurableGoodsReport | null
): string {
  if (targetReport) {
    return [
      "Report: Census Advance Durable Goods Manufacturers' Shipments, Inventories and Orders",
      `Target period: ${targetPeriod}`,
      "Target status: published",
      `Value: ${formatSignedPercent(targetReport.value)}`,
      `Direction: ${targetReport.direction}`,
      `Report release: ${targetReport.releaseDate ?? "unknown"}`,
      "Precision: one decimal point",
      `Report URL: ${targetReport.reportUrl}`
    ].join("\n");
  }

  return [
    "Report: Census Advance Durable Goods Manufacturers' Shipments, Inventories and Orders",
    `Target period: ${targetPeriod}`,
    "Target status: not published yet",
    "Value: not published yet",
    `Scheduled release: ${scheduledReleaseLabel}`,
    `Latest available: ${latestReport ? `${latestReport.period} = ${formatSignedPercent(latestReport.value)}` : "none"}`,
    `Report release: ${latestReport?.releaseDate ?? "unknown"}`,
    `Report URL: ${latestReport?.reportUrl ?? sourceUrl}`
  ].join("\n");
}

export function getCensusDurableGoodsPollIntervalMinutes(integration: Integration, now: Date = new Date()): number {
  if (integration.lastValue?.includes("Target status: published")) {
    return 1_440;
  }

  const currentDate = getEasternDate(now);
  if (currentDate < releaseDateEt) {
    return 1_440;
  }

  return currentDate === releaseDateEt ? 1 : 60;
}

export function getCensusDurableGoodsPollIntervalReason(integration: Integration, now: Date = new Date()): string {
  if (integration.lastValue?.includes("Target status: published")) {
    return "Census durable goods target report already published; daily verification only";
  }

  const currentDate = getEasternDate(now);
  if (currentDate < releaseDateEt) {
    return "Census durable goods normal mode before June 25, 2026 ET; daily check only";
  }

  return currentDate === releaseDateEt
    ? "Census durable goods release watch on June 25, 2026 ET"
    : "Census durable goods late-release watch after June 25, 2026 ET";
}

export function censusDurableGoodsShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  const publishedNow = currentValue.includes("Target status: published");
  const publishedBefore = previousValue?.includes("Target status: published") ?? false;
  if (publishedNow && !publishedBefore) {
    return true;
  }

  return publishedNow && publishedBefore && extractPublishedValue(previousValue) !== extractPublishedValue(currentValue);
}

export function parseDurableGoodsPercentChange(
  sentenceTail: string
): { value: string; direction: "increased" | "decreased" | "unchanged" } | null {
  if (/\b(?:virtually\s+)?unchanged\b/i.test(sentenceTail)) {
    return { value: "0.0", direction: "unchanged" };
  }

  const increasedMatch = sentenceTail.match(/\bincreased\b[\s\S]*?\bor\s+(\d{1,3}(?:\.\d+)?)\s+percent\b/i);
  if (increasedMatch?.[1]) {
    return { value: formatOneDecimal(increasedMatch[1]), direction: "increased" };
  }

  const decreasedMatch = sentenceTail.match(/\bdecreased\b[\s\S]*?\bor\s+(\d{1,3}(?:\.\d+)?)\s+percent\b/i);
  if (decreasedMatch?.[1]) {
    return { value: `-${formatOneDecimal(decreasedMatch[1])}`, direction: "decreased" };
  }

  return null;
}

function extractReleaseDate(text: string): string | null {
  return text.match(/\bFOR IMMEDIATE RELEASE:\s*(?:[A-Za-z]+,\s*)?([A-Za-z]+\s+\d{1,2},\s+20\d{2})\b/i)?.[1] ?? null;
}

function extractNewOrdersSentenceTail(text: string, newOrdersMatch: RegExpMatchArray): string {
  const tailStart = (newOrdersMatch.index ?? 0) + newOrdersMatch[0].length;
  const tailWindow = text.slice(tailStart, tailStart + 600);
  return tailWindow.split(/,\s+the U\.S\. Census Bureau announced today\b/i)[0].split(/\bThis followed\b/i)[0];
}

function inferPeriodYear(month: string, releaseDate: string | null, fallbackYear: number): number {
  if (!releaseDate) {
    return fallbackYear;
  }

  const releaseMonth = titleCaseMonth(releaseDate.split(/\s+/)[0]);
  if (!releaseMonth) {
    return fallbackYear;
  }

  const periodMonthIndex = monthNames.indexOf(month);
  const releaseMonthIndex = monthNames.indexOf(releaseMonth);
  return periodMonthIndex > releaseMonthIndex ? fallbackYear - 1 : fallbackYear;
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

function formatSignedPercent(value: string): string {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return value;
  }

  const sign = numberValue > 0 ? "+" : "";
  return `${sign}${numberValue.toFixed(1)}%`;
}

function formatOneDecimal(value: string): string {
  return Number.parseFloat(value).toFixed(1);
}

function titleCaseMonth(value: string): string | null {
  const lower = value.toLowerCase();
  return monthNames.find((month) => month.toLowerCase() === lower) ?? null;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
