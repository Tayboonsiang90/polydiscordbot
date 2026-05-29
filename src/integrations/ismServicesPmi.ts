import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-report-on-business/";
const targetReportUrl = "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-pmi-reports/services/may/";
const targetPeriod = "May 2026";
const scheduledReleaseLabel = "June 3, 2026 10:00 AM ET";
const releaseDateEt = "2026-06-03";
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

export type IsmServicesPmiReport = {
  period: string;
  value: string;
  reportUrl: string;
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

export function buildIsmServicesPmiValue(targetReport: IsmServicesPmiReport | null, latestReport: IsmServicesPmiReport | null): string {
  if (targetReport) {
    return [
      "Report: ISM Services PMI Report On Business",
      `Target period: ${targetPeriod}`,
      `Value: ${targetReport.value}`,
      "Precision: one decimal point",
      `Report URL: ${targetReport.reportUrl}`
    ].join("\n");
  }

  return [
    "Report: ISM Services PMI Report On Business",
    `Target period: ${targetPeriod}`,
    "Value: not published yet",
    `Scheduled release: ${scheduledReleaseLabel}`,
    `Latest available: ${latestReport ? `${latestReport.period} = ${latestReport.value}` : "none"}`,
    `Report URL: ${latestReport?.reportUrl ?? targetReportUrl}`
  ].join("\n");
}

export function getIsmServicesPmiPollIntervalMinutes(integration: Integration, now: Date = new Date()): number {
  return isReleaseWatchDay(now) ? 1 : 60;
}

export function getIsmServicesPmiPollIntervalReason(integration: Integration, now: Date = new Date()): string {
  return isReleaseWatchDay(now)
    ? `ISM release watch: day before/day of ${releaseDateEt} ET`
    : `ISM normal mode outside day before/day of ${releaseDateEt} ET`;
}

export const ismServicesPmiAdapter: WebsiteAdapter = {
  id: "ism-services-pmi",
  commandName: "ismpmi",
  displayName: "ISM Services PMI",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/ism-services-pmi-may-2026",
  defaultChannelName: "ismpmi",
  alertRoleName: "ISM PMI Alerts",
  alertRoleEmoji: "\uD83D\uDCCA",
  getPollIntervalMinutes: getIsmServicesPmiPollIntervalMinutes,
  getPollIntervalReason: getIsmServicesPmiPollIntervalReason,
  async fetchCurrentValue(): Promise<AdapterValue> {
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
    const candidateUrls = uniqueUrls([targetReportUrl, currentReportUrl]);
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
      if (report.period === targetPeriod) {
        targetReport = report;
        break;
      }
    }

    const value = buildIsmServicesPmiValue(targetReport, latestReport);
    return {
      value,
      rawValue: targetReport?.value ?? "not published yet",
      unit: "PMI index",
      observedAt: new Date()
    };
  }
};

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

function isReleaseWatchDay(now: Date): boolean {
  const currentDate = getEasternDate(now);
  return currentDate === "2026-06-02" || currentDate === releaseDateEt;
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
