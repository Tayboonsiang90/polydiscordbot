import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";
import { refreshMonthlyPolymarketQueue, type MonthlyPolymarketDiscoveryConfig } from "./monthlyPolymarketDiscovery.js";

const sourceUrl = "https://www.weather.gov/wrh/climate?wfo=okx";
const apiUrl = "https://data.rcc-acis.org/StnData";
const stationId = "NYCthr 9";
const defaultYear = 2026;
const defaultMonth = 5;
const monthlyDiscoveryConfig: MonthlyPolymarketDiscoveryConfig = {
  searchQuery: "precipitation in nyc",
  slugPrefix: "precipitation-in-nyc-in-",
  titlePrefix: "Precipitation in NYC in",
  lastDiscoveryAtKey: "lastNoaaNycPrecipDiscoveryAt",
  requiredTagSlugs: ["precipitation"]
};

type NoaaSettings = {
  year: number;
  month: number;
};

type NoaaResponse = {
  data?: Array<[string, string]>;
  error?: string;
};

export function getNoaaNycPrecipSettings(integration?: Integration): NoaaSettings {
  if (!integration?.settingsJson) {
    return { year: defaultYear, month: defaultMonth };
  }

  try {
    const settings = JSON.parse(integration.settingsJson) as Partial<NoaaSettings>;
    const year = Number(settings.year);
    const month = Number(settings.month);
    if (isValidNoaaPeriod(year, month)) {
      return { year, month };
    }
  } catch {
    return { year: defaultYear, month: defaultMonth };
  }

  return { year: defaultYear, month: defaultMonth };
}

export function extractNoaaNycPrecipitationValue(response: NoaaResponse, settings: NoaaSettings): string {
  if (response.error) {
    throw new Error(`NOAA returned error: ${response.error}`);
  }

  const row = response.data?.[0];
  const rawValue = row?.[1];
  if (!rawValue || rawValue === "M") {
    throw new Error("Could not find NYC monthly precipitation in the NOAA response");
  }

  const normalizedValue = normalizePrecipitationValue(rawValue);
  const period = row[0] ?? `${settings.year}-${padMonth(settings.month)}`;
  return `${normalizedValue} inches (${period})`;
}

export const noaaNycPrecipAdapter: WebsiteAdapter = {
  id: "noaa-nyc-precip",
  commandName: "nycprecip",
  displayName: "NOAA NYC Precipitation",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/precipitation-in-nyc-in-may",
  defaultChannelName: "nycprecip",
  legacyChannelNames: ["precipitationnyc"],
  alertRoleName: "NOAA NYC Precip Alerts",
  alertRoleEmoji: "\u2614",
  defaultSettings: { year: defaultYear, month: defaultMonth },
  supportsPeriod: true,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshMonthlyPolymarketQueue(integration, monthlyDiscoveryConfig)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const settings = getNoaaNycPrecipSettings(integration);
    const response = await fetchWithTimeout(apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      },
      body: buildNoaaRequestBody(settings)
    });

    if (!response.ok) {
      throw new Error(`NOAA returned HTTP ${response.status}`);
    }

    const json = (await response.json()) as NoaaResponse;
    const value = extractNoaaNycPrecipitationValue(json, settings);
    return {
      value,
      rawValue: value,
      unit: "monthly precipitation",
      observedAt: new Date()
    };
  }
};

export function isValidNoaaPeriod(year: number, month: number): boolean {
  return Number.isInteger(year) && Number.isInteger(month) && year >= 1900 && year <= 2100 && month >= 1 && month <= 12;
}

function buildNoaaRequestBody(settings: NoaaSettings): URLSearchParams {
  const periodEndDate = `${settings.year}-${padMonth(settings.month)}-${lastDayOfMonth(settings)}`;
  const params = {
    sid: stationId,
    date: periodEndDate,
    elems: [{ name: "pcpn", interval: "mly", duration: "mly", reduce: "sum" }]
  };

  return new URLSearchParams({
    params: JSON.stringify(params),
    output: "json"
  });
}

function normalizePrecipitationValue(value: string): string {
  if (value === "T") {
    return "T";
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue >= 100) {
    throw new Error(`Invalid NOAA NYC precipitation value: ${value}`);
  }

  return numericValue.toFixed(2);
}

function lastDayOfMonth(settings: NoaaSettings): string {
  return String(new Date(settings.year, settings.month, 0).getDate()).padStart(2, "0");
}

function padMonth(month: number): string {
  return String(month).padStart(2, "0");
}

