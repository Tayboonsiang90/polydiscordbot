import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://fred.stlouisfed.org/series/APU0000703112";
const csvUrl = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=APU0000703112";
const targetYear = "2026";
const fallbackNextReleaseDate = "May 12, 2026";
const easternTimeZone = "America/New_York";

export type FredGroundBeefObservation = {
  date: string;
  value: string;
};

export function extractFredGroundBeefValue(csv: string, html: string): string {
  const observations = parseFredGroundBeefObservations(csv);
  const latest2026Observation = observations.filter((observation) => observation.date.startsWith(targetYear)).at(-1);
  const latestObservation = observations.at(-1);
  const nextReleaseDate = extractFredGroundBeefNextReleaseDate(html) ?? "unknown";

  if (latest2026Observation) {
    return [
      "Series: Ground beef, 100% beef (Cost per Pound) in U.S. City Average",
      `Year: ${targetYear}`,
      `Latest 2026 period: ${latest2026Observation.date.slice(0, 7)}`,
      `Value: $${latest2026Observation.value} per pound`,
      `Observation date: ${latest2026Observation.date}`,
      `Next release date: ${nextReleaseDate}`
    ].join("\n");
  }

  return [
    "Series: Ground beef, 100% beef (Cost per Pound) in U.S. City Average",
    `Year: ${targetYear}`,
    "Value: no 2026 data published yet",
    `Latest available: ${latestObservation ? `${latestObservation.date} = $${latestObservation.value} per pound` : "none"}`,
    `Next release date: ${nextReleaseDate}`
  ].join("\n");
}

export function parseFredGroundBeefObservations(csv: string): FredGroundBeefObservation[] {
  return csv
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [date, value] = line.split(",");
      return { date: date?.trim() ?? "", value: value?.trim() ?? "" };
    })
    .filter((observation) => /^\d{4}-\d{2}-\d{2}$/.test(observation.date) && observation.value !== "." && observation.value !== "");
}

export function extractFredGroundBeefNextReleaseDate(html: string): string | null {
  const text = cheerio.load(html).root().text().replace(/\s+/g, " ");
  return text.match(/Next Release Date:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/)?.[1] ?? null;
}

export function getFredGroundBeefPollIntervalMinutes(integration: Integration, now: Date = new Date()): number {
  return isReleaseWatchDay(integration, now) ? 1 : 60;
}

export function getFredGroundBeefPollIntervalReason(integration: Integration, now: Date = new Date()): string {
  const nextReleaseDate = getNextReleaseDate(integration);
  return isReleaseWatchDay(integration, now)
    ? `FRED release watch: day before/day of ${nextReleaseDate} ET`
    : `FRED normal mode outside day before/day of ${nextReleaseDate} ET`;
}

export const fredGroundBeefAdapter: WebsiteAdapter = {
  id: "fred-ground-beef",
  commandName: "beef",
  displayName: "FRED Ground Beef Price",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/will-ground-beef-hit-in-2026",
  defaultChannelName: "beef",
  alertRoleName: "FRED Ground Beef Alerts",
  alertRoleEmoji: "\uD83E\uDD69",
  getPollIntervalMinutes: getFredGroundBeefPollIntervalMinutes,
  getPollIntervalReason: getFredGroundBeefPollIntervalReason,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const [csvResponse, pageResponse] = await Promise.all([
      fetchWithTimeout(csvUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
        }
      }),
      fetchWithTimeout(sourceUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
        }
      })
    ]);

    if (!csvResponse.ok) {
      throw new Error(`FRED CSV returned HTTP ${csvResponse.status}`);
    }

    if (!pageResponse.ok) {
      throw new Error(`FRED page returned HTTP ${pageResponse.status}`);
    }

    const value = extractFredGroundBeefValue(await csvResponse.text(), await pageResponse.text());
    return {
      value,
      rawValue: value,
      unit: "USD per pound",
      observedAt: new Date()
    };
  }
};

function isReleaseWatchDay(integration: Integration, now: Date): boolean {
  const nextReleaseDate = parseMonthDayYear(getNextReleaseDate(integration));
  if (!nextReleaseDate) {
    return false;
  }

  const currentDate = getEasternDate(now);
  const dayBefore = addDays(nextReleaseDate, -1);
  return currentDate === dayBefore || currentDate === nextReleaseDate;
}

function getNextReleaseDate(integration: Integration): string {
  return integration.lastValue?.match(/Next release date:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/)?.[1] ?? fallbackNextReleaseDate;
}

function parseMonthDayYear(value: string): string | null {
  const timestamp = Date.parse(`${value} 00:00:00 GMT-0500`);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: easternTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(timestamp));
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
