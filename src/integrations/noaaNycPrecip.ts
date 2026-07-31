import * as cheerio from "cheerio";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";
import { parseManualEasternDateTime } from "../marketEnd.js";
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
const hourlyApiUrl = "https://aviationweather.gov/api/data/metar?ids=KNYC&format=json&hours=48";
const hourlyHistoryUrl = "https://forecast.weather.gov/data/obhistory/KNYC.html";
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

export type NycHourlyPrecipObservation = {
  observedAt: Date;
  precipitationInches: number | null;
};

type AviationWeatherMetar = {
  obsTime?: unknown;
  precip?: unknown;
  metarType?: unknown;
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

export function extractNycHourlyPrecipObservations(
  payload: unknown,
  now: Date = new Date()
): NycHourlyPrecipObservation[] {
  if (!Array.isArray(payload)) {
    throw new Error("AviationWeather KNYC response was not an array");
  }

  const currentEasternDate = getEasternDate(now);
  const observations = payload.flatMap((entry): NycHourlyPrecipObservation[] => {
    const report = entry as AviationWeatherMetar;
    if (report.metarType !== "METAR") {
      return [];
    }

    const observedAtSeconds = Number(report.obsTime);
    const precipitationInches = Number(report.precip);
    if (!Number.isFinite(observedAtSeconds) || !Number.isFinite(precipitationInches) || precipitationInches <= 0) {
      return [];
    }

    const observedAt = new Date(observedAtSeconds * 1_000);
    if (Number.isNaN(observedAt.getTime()) || getEasternDate(observedAt) !== currentEasternDate) {
      return [];
    }

    return [{ observedAt, precipitationInches }];
  });

  return deduplicateHourlyObservations(observations);
}

export function extractNycHourlyPrecipObservationsFromHtml(
  html: string,
  now: Date = new Date()
): NycHourlyPrecipObservation[] {
  const $ = cheerio.load(html);
  const currentEasternDate = getEasternDate(now);
  const currentDay = Number(currentEasternDate.slice(-2));
  const observations: NycHourlyPrecipObservation[] = [];

  $("table tbody tr").each((_index, row) => {
    const cells = $(row)
      .find("td")
      .map((_cellIndex, cell) => $(cell).text().replace(/\s+/g, " ").trim())
      .get();
    if (cells.length < 18 || Number(cells[0]) !== currentDay) {
      return;
    }

    const rawPrecipitation = cells[15]?.toUpperCase();
    const precipitationInches = Number(rawPrecipitation);
    const isTrace = rawPrecipitation === "T";
    if ((!Number.isFinite(precipitationInches) || precipitationInches <= 0) && !isTrace) {
      return;
    }

    const observedAt = parseManualEasternDateTime(`${currentEasternDate} ${cells[1]}`);
    if (!observedAt) {
      return;
    }

    observations.push({ observedAt, precipitationInches: isTrace ? null : precipitationInches });
  });

  return deduplicateHourlyObservations(observations);
}

export function appendNycHourlyPrecipitationAlpha(
  officialValue: string,
  observations: NycHourlyPrecipObservation[],
  source: string,
  now: Date = new Date()
): string {
  const latestObservation = observations.at(-1);
  const numericTotal = observations.reduce((sum, observation) => sum + (observation.precipitationInches ?? 0), 0);
  const traceCount = observations.filter((observation) => observation.precipitationInches === null).length;
  const totalSuffix = traceCount > 0 ? ` (plus ${traceCount} trace hour${traceCount === 1 ? "" : "s"})` : "";
  const observationKeys = observations
    .map((observation) => `${observation.observedAt.toISOString()}=${formatHourlyPrecipitation(observation)}`)
    .join(", ");

  return [
    officialValue,
    `Hourly alpha date ET: ${getEasternDate(now)}`,
    `Hourly alpha total: ${numericTotal.toFixed(2)} inches${totalSuffix}`,
    `Positive hourly reports: ${observations.length}`,
    `Latest positive hour ET: ${latestObservation ? formatEasternDateTime(latestObservation.observedAt) : "none"}`,
    `Latest positive hour precipitation: ${latestObservation ? formatHourlyPrecipitationForDisplay(latestObservation) : "none"}`,
    `Hourly positive keys: ${observationKeys || "none"}`,
    `Hourly alpha source: ${source}`,
    `Hourly history: ${hourlyHistoryUrl}`
  ].join("\n");
}

export function shouldAlertOnNycPrecipChange(previousValue: string | null, currentValue: string): boolean {
  if (!previousValue) {
    return false;
  }

  if (extractOfficialPrecipitationSection(previousValue) !== extractOfficialPrecipitationSection(currentValue)) {
    return true;
  }

  const previousObservations = extractHourlyObservationKeys(previousValue);
  const currentObservations = extractHourlyObservationKeys(currentValue);
  return [...currentObservations].some(
    ([observedAt, precipitation]) => previousObservations.get(observedAt) !== precipitation
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
      fetchNycHourlyPrecipitation(observedAt)
    ]);

    if (!response.ok) {
      throw new Error(`NOAA returned HTTP ${response.status}`);
    }

    const json = (await response.json()) as NoaaMonthlyPrecipResponse;
    const officialValue = extractNoaaNycPrecipitationValue(json, settings);
    const value = appendNycHourlyPrecipitationAlpha(officialValue, hourly.observations, hourly.source, observedAt);
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

async function fetchNycHourlyPrecipitation(
  now: Date
): Promise<{ observations: NycHourlyPrecipObservation[]; source: string }> {
  let apiError: unknown;
  try {
    const response = await fetchWithTimeout(hourlyApiUrl, { headers: requestHeaders });
    if (!response.ok) {
      throw new Error(`AviationWeather KNYC returned HTTP ${response.status}`);
    }

    return {
      observations: extractNycHourlyPrecipObservations(await response.json(), now),
      source: hourlyApiUrl
    };
  } catch (error) {
    apiError = error;
  }

  try {
    const response = await fetchWithTimeout(hourlyHistoryUrl, { headers: requestHeaders });
    if (!response.ok) {
      throw new Error(`NWS KNYC hourly history returned HTTP ${response.status}`);
    }

    return {
      observations: extractNycHourlyPrecipObservationsFromHtml(await response.text(), now),
      source: hourlyHistoryUrl
    };
  } catch (historyError) {
    throw new Error(
      `Could not fetch KNYC hourly precipitation: AviationWeather: ${formatError(apiError)}; NWS history: ${formatError(historyError)}`
    );
  }
}

function deduplicateHourlyObservations(observations: NycHourlyPrecipObservation[]): NycHourlyPrecipObservation[] {
  const byTimestamp = new Map<string, NycHourlyPrecipObservation>();
  for (const observation of observations) {
    byTimestamp.set(observation.observedAt.toISOString(), observation);
  }

  return [...byTimestamp.values()].sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime());
}

function extractOfficialPrecipitationSection(value: string): string {
  return value.split("\nHourly alpha date ET:", 1)[0]?.trim() ?? value.trim();
}

function extractHourlyObservationKeys(value: string): Map<string, string> {
  const line = value
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith("Hourly positive keys:"));
  const keys = line?.slice("Hourly positive keys:".length).trim();
  if (!keys || keys === "none") {
    return new Map();
  }

  return new Map(
    keys.split(", ").flatMap((entry): Array<[string, string]> => {
      const separator = entry.lastIndexOf("=");
      if (separator < 0) {
        return [];
      }
      return [[entry.slice(0, separator), entry.slice(separator + 1)]];
    })
  );
}

function formatHourlyPrecipitation(observation: NycHourlyPrecipObservation): string {
  return observation.precipitationInches === null ? "T" : observation.precipitationInches.toFixed(2);
}

function formatHourlyPrecipitationForDisplay(observation: NycHourlyPrecipObservation): string {
  return observation.precipitationInches === null ? "T (trace)" : `${observation.precipitationInches.toFixed(2)} inches`;
}

function getEasternDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: easternTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatEasternDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: easternTimeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short"
  }).format(date);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
