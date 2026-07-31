import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import { parseSettingsJson } from "../settingsJson.js";
import {
  refreshGammaPolymarketQueue,
  upsertGammaPolymarketQueueUrl,
  type GammaPolymarketDiscoveryConfig
} from "./gammaPolymarketDiscovery.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-report-on-business/";
const defaultPolymarketUrl =
  "https://polymarket.com/event/ism-services-pmi-july-2026-20260710153544980";
const gammaEventsUrl = "https://gamma-api.polymarket.com/events";
const easternTimeZone = "America/New_York";
const discoveryConfig: GammaPolymarketDiscoveryConfig = {
  searchQuery: "ism services pmi",
  slugPrefixes: ["ism-services-pmi-"],
  titlePrefixes: ["ISM Services PMI"],
  lastDiscoveryAtKey: "lastIsmServicesPmiDiscoveryAt"
};

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

export type IsmServicesPmiReport = {
  period: string;
  value: string;
  reportUrl: string;
};

export type IsmServicesPmiTarget = {
  period: string;
  reportUrl: string;
  releaseDateEt: string | null;
  releaseLabel: string;
};

export function extractCurrentServicesReportUrl(html: string): string | null {
  const $ = cheerio.load(html);
  const link = $("a")
    .filter((_, element) => normalizeText($(element).text()).toLowerCase() === "view report")
    .filter((_, element) => ($(element).attr("href") ?? "").includes("/services/"))
    .first();
  const href = link.attr("href");
  return href ? new URL(href, sourceUrl).toString() : null;
}

export function extractIsmServicesPmiReport(html: string, reportUrl: string): IsmServicesPmiReport | null {
  const $ = cheerio.load(html);
  const text = normalizeText($.root().text());
  if (!text || /content you are looking for is no longer available/i.test(text)) {
    return null;
  }

  const period = extractReportPeriod(text);
  const value = extractServicesPmiValue(text, period);
  if (!period || !value) {
    return null;
  }

  return { period, value, reportUrl };
}

export function buildIsmServicesPmiValue(
  targetReport: IsmServicesPmiReport | null,
  latestReport: IsmServicesPmiReport | null,
  target: IsmServicesPmiTarget = parseIsmServicesPmiTarget(defaultPolymarketUrl)
): string {
  if (targetReport) {
    return [
      "Report: ISM Services PMI Report On Business",
      `Target period: ${target.period}`,
      `Value: ${targetReport.value}`,
      "Precision: one decimal point",
      `Report URL: ${targetReport.reportUrl}`
    ].join("\n");
  }

  return [
    "Report: ISM Services PMI Report On Business",
    `Target period: ${target.period}`,
    "Value: not published yet",
    `Scheduled release: ${target.releaseLabel}`,
    `Latest available: ${latestReport ? `${latestReport.period} = ${latestReport.value}` : "none"}`,
    `Report URL: ${latestReport?.reportUrl ?? target.reportUrl}`
  ].join("\n");
}

export function getIsmServicesPmiPollIntervalMinutes(integration: Integration, now: Date = new Date()): number {
  return isReleaseWatchDay(resolveIsmServicesPmiTarget(integration), now) ? 1 : 60;
}

export function getIsmServicesPmiPollIntervalReason(integration: Integration, now: Date = new Date()): string {
  const target = resolveIsmServicesPmiTarget(integration);
  return isReleaseWatchDay(target, now)
    ? `ISM release watch: ${target.releaseLabel}`
    : `ISM normal mode outside the release window for ${target.period}`;
}

export const ismServicesPmiAdapter: WebsiteAdapter = {
  id: "ism-services-pmi",
  commandName: "ismpmi",
  displayName: "ISM Services PMI",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "ismpmi",
  alertRoleName: "ISM PMI Alerts",
  alertRoleEmoji: "\uD83D\uDCCA",
  getPollIntervalMinutes: getIsmServicesPmiPollIntervalMinutes,
  getPollIntervalReason: getIsmServicesPmiPollIntervalReason,
  async refreshSettings(integration: Integration): Promise<string> {
    const discovered = await refreshGammaPolymarketQueue(integration, discoveryConfig);
    const activeUrl = discovered.activeUrl ?? integration.polymarketUrl ?? defaultPolymarketUrl;
    const metadata = await fetchIsmServicesPmiMarketMetadata(activeUrl).catch(() => null);
    return JSON.stringify({
      ...parseSettingsJson(discovered.settingsJson),
      ...(metadata
        ? {
            ismServicesReleaseDateEt: metadata.releaseDateEt,
            ismServicesReleaseLabel: metadata.releaseLabel,
            ismServicesTargetPeriod: metadata.period
          }
        : {})
    });
  },
  async upsertPolymarketMarket(
    integration: Integration,
    url: string
  ): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertGammaPolymarketQueueUrl(integration, url, discoveryConfig);
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const target = resolveIsmServicesPmiTarget(integration);
    const landingResponse = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!landingResponse.ok) {
      throw new Error(`ISM reports page returned HTTP ${landingResponse.status}`);
    }

    const landingHtml = await landingResponse.text();
    const currentReportUrl = extractCurrentServicesReportUrl(landingHtml);
    const candidateUrls = uniqueUrls([target.reportUrl, currentReportUrl]);
    let targetReport: IsmServicesPmiReport | null = null;
    let latestReport: IsmServicesPmiReport | null = null;

    for (const candidateUrl of candidateUrls) {
      const reportResponse = await fetchWithTimeout(candidateUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
        }
      });

      if (!reportResponse.ok) {
        continue;
      }

      const report = extractIsmServicesPmiReport(await reportResponse.text(), candidateUrl);
      if (!report) {
        continue;
      }

      latestReport ??= report;
      if (report.period === target.period) {
        targetReport = report;
        break;
      }
    }

    const value = buildIsmServicesPmiValue(targetReport, latestReport, target);
    return {
      value,
      rawValue: targetReport?.value ?? "not published yet",
      unit: "PMI index",
      observedAt: new Date()
    };
  }
};

export function parseIsmServicesPmiTarget(url: string): IsmServicesPmiTarget {
  const slug = getPolymarketSlug(url) ?? url;
  const match = slug.match(/ism-services-pmi-([a-z]+)-(20\d{2})(?:-|$)/i);
  const month = titleCaseMonth(match?.[1] ?? "July");
  const year = Number(match?.[2] ?? 2026);
  return {
    period: `${month} ${year}`,
    reportUrl: `https://www.ismworld.org/supply-management-news-and-reports/reports/ism-pmi-reports/services/${month.toLowerCase()}/`,
    releaseDateEt: null,
    releaseLabel: "official ISM release date not parsed; broad early-month watch enabled"
  };
}

export async function fetchIsmServicesPmiMarketMetadata(url: string): Promise<IsmServicesPmiTarget> {
  const target = parseIsmServicesPmiTarget(url);
  const slug = getPolymarketSlug(url);
  if (!slug) {
    return target;
  }

  const response = await fetchWithTimeout(`${gammaEventsUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    return target;
  }

  const payload = (await response.json()) as unknown;
  const event = Array.isArray(payload) && payload[0] && typeof payload[0] === "object"
    ? payload[0] as { description?: unknown }
    : null;
  const description = typeof event?.description === "string" ? event.description : "";
  const release = description.match(
    /scheduled to be released on ([A-Za-z]+ \d{1,2}, 20\d{2}), at (\d{1,2}:\d{2} [AP]M ET)/i
  );
  if (!release) {
    return target;
  }

  const releaseDate = new Date(`${release[1]} 12:00:00 UTC`);
  return {
    ...target,
    releaseDateEt: Number.isNaN(releaseDate.getTime()) ? null : releaseDate.toISOString().slice(0, 10),
    releaseLabel: `${release[1]} ${release[2]}`
  };
}

function extractReportPeriod(text: string): string | null {
  const escapedMonths = monthNames.join("|");
  const match = text.match(new RegExp(`\\b(${escapedMonths})\\s+(20\\d{2})\\s+ISM®?\\s+Services\\s+PMI®?\\s+Report`, "i"));
  if (!match) {
    return null;
  }

  return `${titleCaseMonth(match[1])} ${match[2]}`;
}

function extractServicesPmiValue(text: string, period: string | null): string | null {
  const headingMatch = text.match(/Services\s+PMI®?\s+at\s+(\d{1,3}(?:\.\d)?)\s*%/i);
  if (headingMatch?.[1]) {
    return formatOneDecimal(headingMatch[1]);
  }

  const registeredMatch = text.match(/Services\s+PMI®?\s+registered\s+(\d{1,3}(?:\.\d)?)\s+percent/i);
  if (registeredMatch?.[1]) {
    return formatOneDecimal(registeredMatch[1]);
  }

  if (period) {
    const [month, year] = period.split(" ");
    const historyMatch = text.match(new RegExp(`\\b${month}\\s+${year}\\s+(\\d{1,3}(?:\\.\\d)?)\\b`, "i"));
    if (historyMatch?.[1]) {
      return formatOneDecimal(historyMatch[1]);
    }
  }

  return null;
}

function formatOneDecimal(value: string): string {
  return Number.parseFloat(value).toFixed(1);
}

function resolveIsmServicesPmiTarget(integration?: Integration): IsmServicesPmiTarget {
  const target = parseIsmServicesPmiTarget(integration?.polymarketUrl ?? defaultPolymarketUrl);
  const settings = parseSettingsJson(integration?.settingsJson ?? null);
  const releaseDateEt =
    typeof settings.ismServicesReleaseDateEt === "string" ? settings.ismServicesReleaseDateEt : null;
  const releaseLabel =
    typeof settings.ismServicesReleaseLabel === "string" ? settings.ismServicesReleaseLabel : target.releaseLabel;
  return { ...target, releaseDateEt, releaseLabel };
}

function isReleaseWatchDay(target: IsmServicesPmiTarget, now: Date): boolean {
  const currentDate = getEasternDate(now);
  if (target.releaseDateEt) {
    return currentDate === addDays(target.releaseDateEt, -1) || currentDate === target.releaseDateEt;
  }

  const [targetMonth, targetYearText] = target.period.split(" ");
  const targetMonthIndex = monthNames.findIndex((month) => month === targetMonth);
  const targetYear = Number(targetYearText);
  const releaseMonth = targetMonthIndex === 11 ? 1 : targetMonthIndex + 2;
  const releaseYear = targetMonthIndex === 11 ? targetYear + 1 : targetYear;
  const [currentYear, currentMonth, currentDay] = currentDate.split("-").map(Number);
  return currentYear === releaseYear && currentMonth === releaseMonth && currentDay >= 1 && currentDay <= 10;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getEasternDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: easternTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function uniqueUrls(urls: Array<string | null>): string[] {
  return [...new Set(urls.filter((url): url is string => Boolean(url)))];
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function titleCaseMonth(value: string): string {
  const lower = value.toLowerCase();
  return monthNames.find((month) => month.toLowerCase() === lower) ?? value;
}
