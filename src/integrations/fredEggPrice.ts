import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { refreshMonthlyPolymarketQueue, type MonthlyPolymarketDiscoveryConfig } from "./monthlyPolymarketDiscovery.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://fred.stlouisfed.org/series/APU0000708111";
const csvUrl = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=APU0000708111";
const requestHeaders = {
  "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
};
const defaultYear = 2026;
const defaultMonth = 7;
const fallbackNextReleaseDate = "August 12, 2026";
const easternTimeZone = "America/New_York";
const monthlyDiscoveryConfig: MonthlyPolymarketDiscoveryConfig = {
  searchQuery: "price of dozen eggs",
  slugPrefix: "price-of-dozen-eggs-in-",
  titlePrefix: "Price of Dozen Eggs in",
  lastDiscoveryAtKey: "lastFredEggPriceDiscoveryAt"
};

export type FredEggObservation = {
  date: string;
  value: string;
};

export type FredEggPriceSettings = {
  year: number;
  month: number;
};

export function getFredEggPriceSettings(integration?: Integration): FredEggPriceSettings {
  if (!integration?.settingsJson) {
    return { year: defaultYear, month: defaultMonth };
  }

  try {
    const settings = JSON.parse(integration.settingsJson) as Partial<FredEggPriceSettings>;
    const year = Number(settings.year);
    const month = Number(settings.month);
    if (isValidFredEggPricePeriod(year, month)) {
      return { year, month };
    }
  } catch {
    return { year: defaultYear, month: defaultMonth };
  }

  return { year: defaultYear, month: defaultMonth };
}

export function extractFredEggPriceValue(
  csv: string,
  html: string,
  settings: FredEggPriceSettings = { year: defaultYear, month: defaultMonth }
): string {
  const observations = parseFredEggObservations(csv);
  const targetPeriod = formatFredEggPricePeriod(settings);
  const targetObservation = observations.find((observation) => observation.date.startsWith(targetPeriod));
  const latestObservation = observations.at(-1);
  const nextReleaseDate = extractFredNextReleaseDate(html) ?? "unknown";

  if (targetObservation) {
    return [
      "Series: Eggs, Grade A, Large (Cost per Dozen) in U.S. City Average",
      `Period: ${targetPeriod}`,
      `Value: $${targetObservation.value} per dozen`,
      `Observation date: ${targetObservation.date}`,
      `Next release date: ${nextReleaseDate}`
    ].join("\n");
  }

  return [
    "Series: Eggs, Grade A, Large (Cost per Dozen) in U.S. City Average",
    `Period: ${targetPeriod}`,
    "Value: not published yet",
    `Latest available: ${latestObservation ? `${latestObservation.date} = $${latestObservation.value} per dozen` : "none"}`,
    `Next release date: ${nextReleaseDate}`
  ].join("\n");
}

export function parseFredEggObservations(csv: string): FredEggObservation[] {
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

export function extractFredNextReleaseDate(html: string): string | null {
  const text = cheerio.load(html).root().text().replace(/\s+/g, " ");
  return text.match(/Next Release Date:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/)?.[1] ?? null;
}

export function getFredEggPricePollIntervalMinutes(integration: Integration, now: Date = new Date()): number {
  return isReleaseWatchDay(integration, now) ? 1 : 60;
}

export function getFredEggPricePollIntervalReason(integration: Integration, now: Date = new Date()): string {
  const nextReleaseDate = getNextReleaseDate(integration);
  return isReleaseWatchDay(integration, now)
    ? `FRED release watch: day before/day of ${nextReleaseDate} ET`
    : `FRED normal mode outside day before/day of ${nextReleaseDate} ET`;
}

export const fredEggPriceAdapter: WebsiteAdapter = {
  id: "fred-egg-price",
  commandName: "eggs",
  displayName: "FRED Egg Price",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/price-of-dozen-eggs-in-july-20260714151433730",
  defaultChannelName: "eggs",
  alertRoleName: "FRED Egg Price Alerts",
  alertRoleEmoji: "\uD83E\uDD5A",
  defaultSettings: { year: defaultYear, month: defaultMonth },
  supportsPeriod: true,
  getPollIntervalMinutes: getFredEggPricePollIntervalMinutes,
  getPollIntervalReason: getFredEggPricePollIntervalReason,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshFredEggPricePolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const settings = getFredEggPriceSettings(integration);
    const [csvResponse, pageResponse] = await Promise.all([
      fetchWithTimeout(csvUrl, { headers: requestHeaders }),
      fetchWithTimeout(sourceUrl, { headers: requestHeaders })
    ]);

    if (!csvResponse.ok) {
      throw new Error(`FRED CSV returned HTTP ${csvResponse.status}`);
    }

    if (!pageResponse.ok) {
      throw new Error(`FRED page returned HTTP ${pageResponse.status}`);
    }

    const [csvText, pageText] = await Promise.all([
      readFredEggResponseText(csvResponse, csvUrl, "FRED CSV"),
      readFredEggResponseText(pageResponse, sourceUrl, "FRED page")
    ]);
    const value = extractFredEggPriceValue(csvText, pageText, settings);
    return {
      value,
      rawValue: value,
      unit: "USD per dozen",
      observedAt: new Date()
    };
  }
};

export async function refreshFredEggPricePolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  return refreshMonthlyPolymarketQueue(integration, monthlyDiscoveryConfig, now);
}

export function isValidFredEggPricePeriod(year: number, month: number): boolean {
  return Number.isInteger(year) && Number.isInteger(month) && year >= 2020 && year <= 2100 && month >= 1 && month <= 12;
}

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

function formatFredEggPricePeriod(settings: FredEggPriceSettings): string {
  return `${settings.year}-${String(settings.month).padStart(2, "0")}`;
}

async function readFredEggResponseText(response: Response, url: string, label: string): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    if (!isConsumedResponseBodyError(error)) {
      throw error;
    }

    const retryResponse = await fetchWithTimeout(url, { headers: requestHeaders });
    if (!retryResponse.ok) {
      throw new Error(`${label} retry returned HTTP ${retryResponse.status}`);
    }
    return retryResponse.text();
  }
}

function isConsumedResponseBodyError(error: unknown): boolean {
  return error instanceof TypeError && /body (?:is unusable|has already been read)/i.test(error.message);
}
