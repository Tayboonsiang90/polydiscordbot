import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";
import {
  buildNoaaMonthlyPrecipRequestBody,
  extractNoaaMonthlyPrecipitationValue,
  isValidNoaaMonthlyPrecipPeriod,
  type NoaaMonthlyPrecipResponse,
  type NoaaMonthlyPrecipSettings
} from "./noaaMonthlyPrecip.js";
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

export function getNoaaNycPrecipSettings(integration?: Integration): NoaaMonthlyPrecipSettings {
  if (!integration?.settingsJson) {
    return { year: defaultYear, month: defaultMonth };
  }

  try {
    const settings = JSON.parse(integration.settingsJson) as Partial<NoaaMonthlyPrecipSettings>;
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

export function extractNoaaNycPrecipitationValue(response: NoaaMonthlyPrecipResponse, settings: NoaaMonthlyPrecipSettings): string {
  return extractNoaaMonthlyPrecipitationValue(response, settings, "NY-Central Park Area");
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
      body: buildNoaaMonthlyPrecipRequestBody(stationId, settings)
    });

    if (!response.ok) {
      throw new Error(`NOAA returned HTTP ${response.status}`);
    }

    const json = (await response.json()) as NoaaMonthlyPrecipResponse;
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
  return isValidNoaaMonthlyPrecipPeriod(year, month);
}
