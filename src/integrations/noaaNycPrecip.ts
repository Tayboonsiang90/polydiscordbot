import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";
import {
  appendHourlyPrecipitationAlpha,
  extractAviationWeatherHourlyPrecipitation,
  extractNwsHourlyPrecipitationHtml,
  extractOfficialPrecipitationSection,
  fetchAviationWeatherHourlyPrecipitation,
  hasNewOrRevisedHourlyPrecipitation,
  type HourlyPrecipitationObservation
} from "./hourlyPrecipAlpha.js";
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
  requiredTagSlugs: ["precipitation"],
  fallbackToCurrentMonthWhenExpired: true
};
const easternTimeZone = "America/New_York";
const requestHeaders = {
  "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
};

export type NycHourlyPrecipObservation = HourlyPrecipitationObservation;

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

export function extractNycHourlyPrecipObservations(
  payload: unknown,
  now: Date = new Date()
): NycHourlyPrecipObservation[] {
  return extractAviationWeatherHourlyPrecipitation(payload, "KNYC", easternTimeZone, now);
}

export function extractNycHourlyPrecipObservationsFromHtml(
  html: string,
  now: Date = new Date()
): NycHourlyPrecipObservation[] {
  return extractNwsHourlyPrecipitationHtml(html, easternTimeZone, now);
}

export function appendNycHourlyPrecipitationAlpha(
  officialValue: string,
  observations: NycHourlyPrecipObservation[],
  source: string,
  now: Date = new Date(),
  previousValue: string | null = null
): string {
  return appendHourlyPrecipitationAlpha(
    officialValue,
    observations,
    {
      station: "Central Park (KNYC)",
      timeZone: easternTimeZone,
      timeZoneLabel: "ET",
      unit: "inches",
      decimals: 2,
      source,
      historyUrl: "https://forecast.weather.gov/data/obhistory/KNYC.html",
      sourceNote: "provisional hourly alpha for the exact Central Park station; official NOAA monthly data resolves the market"
    },
    previousValue,
    now
  );
}

export function shouldAlertOnNycPrecipChange(previousValue: string | null, currentValue: string): boolean {
  if (!previousValue) {
    return false;
  }
  return (
    extractOfficialPrecipitationSection(previousValue) !== extractOfficialPrecipitationSection(currentValue) ||
    hasNewOrRevisedHourlyPrecipitation(previousValue, currentValue)
  );
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
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "1-minute KNYC hourly precipitation alpha watch; zero-hour reports are ignored",
  shouldAlertOnChange: shouldAlertOnNycPrecipChange,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshMonthlyPolymarketQueue(integration, monthlyDiscoveryConfig)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const settings = getNoaaNycPrecipSettings(integration);
    const observedAt = new Date();
    const [response, hourly] = await Promise.all([
      fetchWithTimeout(apiUrl, {
        method: "POST",
        headers: {
          ...requestHeaders,
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        body: buildNoaaMonthlyPrecipRequestBody(stationId, settings)
      }),
      fetchAviationWeatherHourlyPrecipitation({ stationId: "KNYC", timeZone: easternTimeZone, now: observedAt })
    ]);

    if (!response.ok) {
      throw new Error(`NOAA returned HTTP ${response.status}`);
    }

    const json = (await response.json()) as NoaaMonthlyPrecipResponse;
    const officialValue = extractNoaaNycPrecipitationValue(json, settings);
    const value = appendNycHourlyPrecipitationAlpha(
      officialValue,
      hourly.observations,
      hourly.source,
      observedAt,
      integration?.lastValue ?? null
    );
    return {
      value,
      rawValue: value,
      unit: "monthly precipitation",
      observedAt
    };
  }
};

export function isValidNoaaPeriod(year: number, month: number): boolean {
  return isValidNoaaMonthlyPrecipPeriod(year, month);
}
