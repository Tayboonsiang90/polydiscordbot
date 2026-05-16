import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";

const sourceUrl = "https://www.weather.gov.hk/en/cis/dailyExtract.htm";
const dataBaseUrl = "https://www.weather.gov.hk/cis/dailyExtract";
const defaultYear = 2026;
const defaultMonth = 5;

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
  const monthData = response.stn?.data?.find((candidate) => candidate.month === settings.month);
  const totalRow = monthData?.dayData?.find((row) => row[0] === "Mean/Total");
  const rawValue = totalRow?.[8];

  if (!rawValue) {
    throw new Error("Could not find Hong Kong monthly total rainfall in the HKO Daily Extract response");
  }

  const normalizedValue = normalizeRainfallValue(rawValue);
  return `${normalizedValue} mm (${settings.year}-${padMonth(settings.month)})`;
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
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const settings = getHkPrecipSettings(integration);
    const response = await fetchWithTimeout(buildHkoDailyExtractUrl(settings), {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`HKO returned HTTP ${response.status}`);
    }

    const json = (await response.json()) as HkoDailyExtractResponse;
    const value = extractHkPrecipitationValue(json, settings);
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

function padMonth(month: number): string {
  return String(month).padStart(2, "0");
}

