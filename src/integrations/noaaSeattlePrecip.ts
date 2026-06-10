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

const sourceUrl = "https://www.weather.gov/wrh/climate?wfo=sew";
const apiUrl = "https://data.rcc-acis.org/StnData";
const stationId = "SEWthr 9";
const defaultYear = 2026;
const defaultMonth = 5;
const monthlyDiscoveryConfig: MonthlyPolymarketDiscoveryConfig = {
  searchQuery: "precipitation in seattle",
  slugPrefix: "precipitation-in-seattle-in-",
  titlePrefix: "Precipitation in Seattle in",
  lastDiscoveryAtKey: "lastNoaaSeattlePrecipDiscoveryAt",
  requiredTagSlugs: ["precipitation"]
};

export function getNoaaSeattlePrecipSettings(integration?: Integration): NoaaMonthlyPrecipSettings {
  if (!integration?.settingsJson) {
    return { year: defaultYear, month: defaultMonth };
  }

  try {
    const settings = JSON.parse(integration.settingsJson) as Partial<NoaaMonthlyPrecipSettings>;
    const year = Number(settings.year);
    const month = Number(settings.month);
    if (isValidNoaaSeattlePeriod(year, month)) {
      return { year, month };
    }
  } catch {
    return { year: defaultYear, month: defaultMonth };
  }

  return { year: defaultYear, month: defaultMonth };
}

export function extractNoaaSeattlePrecipitationValue(response: NoaaMonthlyPrecipResponse, settings: NoaaMonthlyPrecipSettings): string {
  return extractNoaaMonthlyPrecipitationValue(response, settings, "Seattle Area");
}

export const noaaSeattlePrecipAdapter: WebsiteAdapter = {
  id: "noaa-seattle-precip",
  commandName: "seattleprecip",
  displayName: "NOAA Seattle Precipitation",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/precipitation-in-seattle-in-may",
  defaultChannelName: "seattleprecip",
  legacyChannelNames: ["precipitationseattle"],
  alertRoleName: "NOAA Seattle Precip Alerts",
  alertRoleEmoji: "\u2614",
  defaultSettings: { year: defaultYear, month: defaultMonth },
  supportsPeriod: true,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshMonthlyPolymarketQueue(integration, monthlyDiscoveryConfig)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const settings = getNoaaSeattlePrecipSettings(integration);
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
    const value = extractNoaaSeattlePrecipitationValue(json, settings);
    return {
      value,
      rawValue: value,
      unit: "monthly precipitation",
      observedAt: new Date()
    };
  }
};

export function isValidNoaaSeattlePeriod(year: number, month: number): boolean {
  return isValidNoaaMonthlyPrecipPeriod(year, month);
}
