import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://data.sca.isr.umich.edu/";
const timeSeriesUrl = "https://data.sca.isr.umich.edu/data-archive/mine.php";
const targetPeriod = "June 2026";
const targetMonth = 6;
const targetYear = 2026;
const scheduledReleaseLabel = "June 26, 2026 10:00 AM ET";
const releaseDateEt = "2026-06-26";
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

export const umichConsumerSentimentAdapter: WebsiteAdapter = {
  id: "umich-consumer-sentiment",
  commandName: "umichsentiment",
  displayName: "UMich Consumer Sentiment",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/university-of-michigan-consumer-sentiment-june-2026",
  defaultChannelName: "umichsentiment",
  alertRoleName: "UMich Sentiment Alerts",
  alertRoleEmoji: "\uD83D\uDCCA",
  getPollIntervalMinutes: getUmichConsumerSentimentPollIntervalMinutes,
  getPollIntervalReason: getUmichConsumerSentimentPollIntervalReason,
  shouldAlertOnChange: umichConsumerSentimentShouldAlertOnChange,
  async fetchCurrentValue(): Promise<AdapterValue> {
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
        body: buildTimeSeriesRequestBody()
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
    const targetRow = rows.find((row) => row.month === targetMonth && row.year === targetYear) ?? null;
    const latestRow = rows.at(-1) ?? null;
    const targetFinalRelease = findTargetFinalRelease(releases);
    const value = buildUmichConsumerSentimentValue(targetRow, latestRow, targetFinalRelease);

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
  targetFinalRelease: UmichReleaseLink | null
): string {
  if (targetRow && targetFinalRelease) {
    return [
      "Report: University of Michigan Surveys of Consumers final release",
      `Target period: ${targetPeriod}`,
      "Target status: final release published",
      `Value: ${targetRow.value}`,
      "Precision: one decimal point",
      `Final release: ${targetFinalRelease.date}`,
      `Release URL: ${targetFinalRelease.url}`
    ].join("\n");
  }

  return [
    "Report: University of Michigan Surveys of Consumers final release",
    `Target period: ${targetPeriod}`,
    "Target status: not published yet",
    "Value: not published yet",
    `Scheduled release: ${scheduledReleaseLabel}`,
    `Latest final time series row: ${latestRow ? `${formatPeriod(latestRow)} = ${latestRow.value}` : "none"}`,
    `June final release link: ${targetFinalRelease ? targetFinalRelease.url : "not found yet"}`,
    `Time series URL: ${timeSeriesUrl}`
  ].join("\n");
}

export function getUmichConsumerSentimentPollIntervalMinutes(integration: Integration, now: Date = new Date()): number {
  if (integration.lastValue?.includes("Target status: final release published")) {
    return 1_440;
  }

  const currentDate = getEasternDate(now);
  if (currentDate < "2026-06-25") {
    return 1_440;
  }

  return currentDate === "2026-06-25" || currentDate === releaseDateEt ? 1 : 60;
}

export function getUmichConsumerSentimentPollIntervalReason(integration: Integration, now: Date = new Date()): string {
  if (integration.lastValue?.includes("Target status: final release published")) {
    return "UMich final June sentiment already published; daily verification only";
  }

  const currentDate = getEasternDate(now);
  if (currentDate < "2026-06-25") {
    return "UMich normal mode before June 25, 2026 ET; daily check only";
  }

  return currentDate === "2026-06-25" || currentDate === releaseDateEt
    ? "UMich final sentiment release watch on day before/day of June 26, 2026 ET"
    : "UMich late-release watch after June 26, 2026 ET";
}

export function umichConsumerSentimentShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  const publishedNow = currentValue.includes("Target status: final release published");
  const publishedBefore = previousValue?.includes("Target status: final release published") ?? false;
  if (publishedNow && !publishedBefore) {
    return true;
  }

  return publishedNow && publishedBefore && extractPublishedValue(previousValue) !== extractPublishedValue(currentValue);
}

function findTargetFinalRelease(releases: UmichReleaseLink[]): UmichReleaseLink | null {
  return releases.find((release) => /^June Final Results$/i.test(release.title)) ?? null;
}

function buildTimeSeriesRequestBody(): URLSearchParams {
  return new URLSearchParams({
    table: "1",
    year: String(targetYear),
    qorm: "M",
    order: "asc",
    format: "Comma-Separated (CSV)"
  });
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

function formatOneDecimal(value: string): string {
  return Number.parseFloat(value).toFixed(1);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
