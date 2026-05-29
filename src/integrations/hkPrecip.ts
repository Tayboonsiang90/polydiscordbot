import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";
import { refreshMonthlyPolymarketQueue, type MonthlyPolymarketDiscoveryConfig } from "./monthlyPolymarketDiscovery.js";

const sourceUrl = "https://www.weather.gov.hk/en/cis/dailyExtract.htm";
const dataBaseUrl = "https://www.weather.gov.hk/cis/dailyExtract";
const alphaDailyReportUrl = "https://www.hko.gov.hk/textonly/v2/pastwx/ryestxt.htm";
const defaultYear = 2026;
const defaultMonth = 5;
const hkoFetchTimeoutMs = 30_000;
const hkoFetchAttempts = 3;
const monthlyDiscoveryConfig: MonthlyPolymarketDiscoveryConfig = {
  searchQuery: "precipitation in hong kong",
  slugPrefix: "precipitation-in-hong-kong-in-",
  titlePrefix: "Precipitation in Hong Kong in",
  lastDiscoveryAtKey: "lastHkPrecipDiscoveryAt",
  requiredTagSlugs: ["precipitation"]
};

type HkPrecipSettings = {
  year: number;
  month: number;
};

type HkoDailyExtractMonth = {
  month?: number;
  dayData?: string[][];
};

type HkoDailyExtractResponse = {
  stn?: {
    data?: HkoDailyExtractMonth[];
  };
};

type HkPrecipOfficialValue = {
  totalText: string;
  total: number | null;
  latestDay: number | null;
  value: string;
};

export type HkoYesterdayRainfall = {
  issuedDate: string;
  rainfallText: string;
  rainfall: number | null;
  yesterdayDate: string;
};

export function getHkPrecipSettings(integration?: Integration): HkPrecipSettings {
  if (!integration?.settingsJson) {
    return { year: defaultYear, month: defaultMonth };
  }

  try {
    const settings = JSON.parse(integration.settingsJson) as Partial<HkPrecipSettings>;
    const year = Number(settings.year);
    const month = Number(settings.month);
    if (isValidHkPrecipPeriod(year, month)) {
      return { year, month };
    }
  } catch {
    return { year: defaultYear, month: defaultMonth };
  }

  return { year: defaultYear, month: defaultMonth };
}

export function extractHkPrecipitationValue(response: HkoDailyExtractResponse, settings: HkPrecipSettings): string {
  return extractHkPrecipitationOfficialValue(response, settings).value;
}

export function extractHkPrecipitationOfficialValue(
  response: HkoDailyExtractResponse,
  settings: HkPrecipSettings
): HkPrecipOfficialValue {
  const monthData = response.stn?.data?.find((candidate) => candidate.month === settings.month);
  const totalRow = monthData?.dayData?.find((row) => row[0] === "Mean/Total");
  const rawValue = totalRow?.[8];

  if (!rawValue) {
    throw new Error("Could not find Hong Kong monthly total rainfall in the HKO Daily Extract response");
  }

  const latestDay = extractLatestDailyExtractDay(monthData);
  const totalText = normalizeRainfallValue(rawValue);
  const total = parseRainfallNumber(totalText);
  return {
    totalText,
    total,
    latestDay,
    value: `${totalText} mm (${settings.year}-${padMonth(settings.month)})`
  };
}

export function extractHkoYesterdayRainfall(html: string): HkoYesterdayRainfall {
  const text = html.replace(/\s+/g, " ").trim();
  const issuedMatch = text.match(/Bulletin issued at\s+\d{2}:\d{2}\s+HKT\s+(\d{1,2})\/([A-Za-z]+)\/(\d{4})/i);
  const rainfallMatch = text.match(/\bRainfall\s+((?:Trace)|(?:\d+(?:\.\d+)?))\s*mm\b/i);

  if (!issuedMatch || !rainfallMatch) {
    throw new Error("Could not find issued date and rainfall in HKO Yesterday's Weather report");
  }

  const issuedMonth = monthNumber(issuedMatch[2]);
  if (!issuedMonth) {
    throw new Error(`Could not parse HKO Yesterday's Weather issued month: ${issuedMatch[2]}`);
  }

  const issuedDate = `${issuedMatch[3]}-${issuedMonth}-${issuedMatch[1].padStart(2, "0")}`;
  const yesterdayDate = formatUtcDate(addUtcDays(new Date(`${issuedDate}T00:00:00.000Z`), -1));
  const rainfallText = normalizeRainfallValue(rainfallMatch[1]);

  return {
    issuedDate,
    rainfallText,
    rainfall: parseRainfallNumber(rainfallText),
    yesterdayDate
  };
}

export function buildHkPrecipitationAlphaValue(
  official: HkPrecipOfficialValue,
  yesterday: HkoYesterdayRainfall | null,
  settings: HkPrecipSettings
): string {
  const period = `${settings.year}-${padMonth(settings.month)}`;
  const canAddYesterday =
    official.total !== null &&
    yesterday !== null &&
    yesterday.rainfall !== null &&
    shouldAddYesterdayRainfall(official, yesterday, settings);
  const alphaTotal = canAddYesterday && yesterday ? (official.total! + yesterday.rainfall!).toFixed(1) : null;

  return [
    `Current total: ${alphaTotal ?? official.totalText} mm (${period})`,
    `Data status: ${alphaTotal ? "alpha daily report added" : "official daily extract"}`,
    `Official Daily Extract total: ${official.totalText} mm`,
    `Official latest day: ${official.latestDay ?? "unknown"}`,
    `Yesterday report rainfall: ${yesterday ? `${yesterday.rainfallText} mm (${yesterday.yesterdayDate})` : "not available"}`,
    `Alpha source: ${alphaDailyReportUrl}`
  ].join("\n");
}

export function hkPrecipShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  return extractCurrentTotalLine(previousValue) !== extractCurrentTotalLine(currentValue);
}

export const hkPrecipAdapter: WebsiteAdapter = {
  id: "hk-precip",
  commandName: "hkprecip",
  displayName: "HKO Hong Kong Precipitation",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/precipitation-in-hong-kong-in-may",
  defaultChannelName: "hkprecip",
  alertRoleName: "HKO Hong Kong Precip Alerts",
  alertRoleEmoji: "\u2614",
  defaultSettings: { year: defaultYear, month: defaultMonth },
  supportsPeriod: true,
  shouldAlertOnChange: hkPrecipShouldAlertOnChange,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshMonthlyPolymarketQueue(integration, monthlyDiscoveryConfig)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const settings = getHkPrecipSettings(integration);
    const [response, yesterdayReport] = await Promise.all([
      fetchHkoDailyExtractWithRetry(buildHkoDailyExtractUrl(settings)),
      fetchHkoYesterdayRainfallWithRetry()
    ]);

    if (!response.ok) {
      throw new Error(`HKO returned HTTP ${response.status}`);
    }

    const json = (await response.json()) as HkoDailyExtractResponse;
    const official = extractHkPrecipitationOfficialValue(json, settings);
    const value = buildHkPrecipitationAlphaValue(official, yesterdayReport, settings);
    return {
      value,
      rawValue: value,
      unit: "monthly precipitation",
      observedAt: new Date()
    };
  }
};

export function isValidHkPrecipPeriod(year: number, month: number): boolean {
  return Number.isInteger(year) && Number.isInteger(month) && year >= 1884 && year <= 2100 && month >= 1 && month <= 12;
}

function buildHkoDailyExtractUrl(settings: HkPrecipSettings): string {
  return `${dataBaseUrl}/dailyExtract_${settings.year}${padMonth(settings.month)}.xml`;
}

async function fetchHkoDailyExtractWithRetry(url: string): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= hkoFetchAttempts; attempt += 1) {
    try {
      return await fetchWithTimeout(
        url,
        {
          headers: {
            "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
          }
        },
        hkoFetchTimeoutMs
      );
    } catch (error) {
      lastError = error;
      if (attempt < hkoFetchAttempts) {
        await delay(attempt * 2_000);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchHkoYesterdayRainfallWithRetry(): Promise<HkoYesterdayRainfall | null> {
  try {
    const response = await fetchHkoDailyExtractWithRetry(alphaDailyReportUrl);
    if (!response.ok) {
      return null;
    }

    return extractHkoYesterdayRainfall(await response.text());
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeRainfallValue(value: string): string {
  const trimmedValue = value.trim();
  if (trimmedValue === "Trace") {
    return "Trace";
  }

  const numericValue = Number(trimmedValue);
  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue >= 5000) {
    throw new Error(`Invalid HKO Hong Kong precipitation value: ${value}`);
  }

  return numericValue.toFixed(1);
}

function parseRainfallNumber(value: string): number | null {
  return value === "Trace" ? 0 : Number(value);
}

function extractLatestDailyExtractDay(monthData: HkoDailyExtractMonth | undefined): number | null {
  const days =
    monthData?.dayData
      ?.map((row) => Number(row[0]))
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31) ?? [];
  return days.length > 0 ? Math.max(...days) : null;
}

function shouldAddYesterdayRainfall(
  official: HkPrecipOfficialValue,
  yesterday: HkoYesterdayRainfall,
  settings: HkPrecipSettings
): boolean {
  const [year, month, day] = yesterday.yesterdayDate.split("-").map(Number);
  return year === settings.year && month === settings.month && official.latestDay !== null && day > official.latestDay;
}

function extractCurrentTotalLine(value: string | null): string | null {
  return value?.match(/^Current total:\s*(.+)$/m)?.[1] ?? value;
}

function monthNumber(month: string): string | null {
  const index = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december"
  ].indexOf(month.toLowerCase());
  return index === -1 ? null : String(index + 1).padStart(2, "0");
}

function addUtcDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function padMonth(month: number): string {
  return String(month).padStart(2, "0");
}

