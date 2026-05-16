import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=WCSSTUS1&f=W";
const easternTimeZone = "America/New_York";

export type EiaCrudeSprDataPoint = {
  endDate: string;
  value: string;
};

export type EiaCrudeSprReleaseDates = {
  releaseDate: string | null;
  nextReleaseDate: string | null;
};

export function extractEiaCrudeSprValue(html: string): string {
  const latest = extractLatestEiaCrudeSprDataPoint(html);
  const releases = extractEiaCrudeSprReleaseDates(html);

  return [
    `End date: ${latest.endDate}`,
    `Value: ${latest.value} thousand barrels`,
    `Release date: ${releases.releaseDate ?? "unknown"}`,
    `Next release date: ${releases.nextReleaseDate ?? "unknown"}`
  ].join("\n");
}

export function extractLatestEiaCrudeSprDataPoint(html: string): EiaCrudeSprDataPoint {
  const $ = cheerio.load(html);
  const points: EiaCrudeSprDataPoint[] = [];

  $("tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .map((__, cell) => normalizeText($(cell).text()))
      .get();
    const yearMonth = parseYearMonth(cells[0]);
    if (!yearMonth) {
      return;
    }

    for (let index = 1; index < cells.length - 1; index += 2) {
      const endDate = cells[index];
      const value = cells[index + 1];
      if (!isShortDate(endDate) || !isNumericValue(value)) {
        continue;
      }

      points.push({
        endDate: formatEndDate(yearMonth.year, endDate),
        value
      });
    }
  });

  if (points.length === 0) {
    throw new Error("Could not find weekly EIA SPR crude oil reserve data");
  }

  return points.sort((left, right) => Date.parse(right.endDate) - Date.parse(left.endDate))[0];
}

export function extractEiaCrudeSprReleaseDates(html: string): EiaCrudeSprReleaseDates {
  const text = cheerio.load(html).root().text();
  return {
    releaseDate: text.match(/Release Date:\s*([0-9/]+)/)?.[1] ?? null,
    nextReleaseDate: text.match(/Next Release Date:\s*([0-9/]+)/)?.[1] ?? null
  };
}

export function getEiaCrudeSprPollIntervalMinutes(_integration: Integration, now: Date = new Date()): number {
  const weekday = getEasternWeekday(now);
  return weekday === "Tue" || weekday === "Wed" ? 1 : 60;
}

export function getEiaCrudeSprPollIntervalReason(_integration: Integration, now: Date = new Date()): string {
  const weekday = getEasternWeekday(now);
  return weekday === "Tue" || weekday === "Wed"
    ? "EIA release watch: Tuesday/Wednesday ET"
    : "EIA normal mode outside Tuesday/Wednesday ET";
}

export const eiaCrudeSprAdapter: WebsiteAdapter = {
  id: "eia-crude-spr",
  commandName: "eia",
  displayName: "EIA Crude Oil SPR Stocks",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/will-us-crude-oil-reserves-fall-to-by-june-5",
  defaultChannelName: "eia-crude-spr",
  alertRoleName: "EIA Crude SPR Alerts",
  alertRoleEmoji: "\u26FD",
  getPollIntervalMinutes: getEiaCrudeSprPollIntervalMinutes,
  getPollIntervalReason: getEiaCrudeSprPollIntervalReason,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`EIA returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const value = extractEiaCrudeSprValue(html);
    return {
      value,
      rawValue: value,
      unit: "thousand barrels",
      observedAt: new Date()
    };
  }
};

function parseYearMonth(value: string | undefined): { year: number; month: number } | null {
  const match = value?.match(/(\d{4})-([A-Za-z]{3})/);
  if (!match) {
    return null;
  }

  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(match[2]);
  return month === -1 ? null : { year: Number(match[1]), month: month + 1 };
}

function formatEndDate(year: number, value: string): string {
  const [month, day] = value.split("/").map(Number);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isShortDate(value: string): boolean {
  return /^\d{2}\/\d{2}$/.test(value);
}

function isNumericValue(value: string): boolean {
  return /^\d{1,3}(,\d{3})*$/.test(value);
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function getEasternWeekday(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: easternTimeZone, weekday: "short" }).format(date);
}
