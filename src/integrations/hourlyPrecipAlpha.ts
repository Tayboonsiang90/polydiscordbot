import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";

const requestHeaders = {
  "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
};

export type HourlyPrecipitationObservation = {
  localDate: string;
  localTime: string;
  precipitation: number | null;
};

export type HourlyPrecipitationAlphaConfig = {
  station: string;
  timeZone: string;
  timeZoneLabel: string;
  unit: "inches" | "mm";
  decimals: number;
  source: string;
  historyUrl?: string;
  sourceNote?: string;
  preserveFirstValuePerHour?: boolean;
};

type AviationWeatherMetar = {
  icaoId?: unknown;
  obsTime?: unknown;
  precip?: unknown;
  metarType?: unknown;
};

type EnvironmentAgencyReading = {
  dateTime?: unknown;
  value?: unknown;
};

type KmaHourlyItem = {
  awsStnId?: unknown;
  awsStnName?: unknown;
  awsPcpHr1?: unknown;
  tm?: unknown;
};

export function extractAviationWeatherHourlyPrecipitation(
  payload: unknown,
  stationId: string,
  timeZone: string,
  now: Date = new Date()
): HourlyPrecipitationObservation[] {
  if (!Array.isArray(payload)) {
    throw new Error(`AviationWeather ${stationId} response was not an array`);
  }

  const currentLocalDate = getLocalDate(now, timeZone);
  return deduplicateHourlyPrecipitationObservations(
    payload.flatMap((entry): HourlyPrecipitationObservation[] => {
      const report = entry as AviationWeatherMetar;
      const reportStation = String(report.icaoId ?? stationId).toUpperCase();
      if (report.metarType !== "METAR" || reportStation !== stationId.toUpperCase()) {
        return [];
      }

      const observedAtSeconds = Number(report.obsTime);
      const precipitation = Number(report.precip);
      if (!Number.isFinite(observedAtSeconds) || !Number.isFinite(precipitation) || precipitation <= 0) {
        return [];
      }

      const observedAt = new Date(observedAtSeconds * 1_000);
      const local = getLocalDateTime(observedAt, timeZone);
      return local.localDate === currentLocalDate ? [{ ...local, precipitation }] : [];
    })
  );
}

export function extractNwsHourlyPrecipitationHtml(
  html: string,
  timeZone: string,
  now: Date = new Date()
): HourlyPrecipitationObservation[] {
  const $ = cheerio.load(html);
  const currentLocalDate = getLocalDate(now, timeZone);
  const currentDay = Number(currentLocalDate.slice(-2));
  const observations: HourlyPrecipitationObservation[] = [];

  $("table tbody tr").each((_index, row) => {
    const cells = $(row)
      .find("td")
      .map((_cellIndex, cell) => $(cell).text().replace(/\s+/g, " ").trim())
      .get();
    if (cells.length < 18 || Number(cells[0]) !== currentDay) {
      return;
    }

    const precipitationText = cells[15]?.toUpperCase();
    const precipitation = Number(precipitationText);
    const isTrace = precipitationText === "T";
    const localTime = normalizeClockTime(cells[1] ?? "");
    if (!localTime || ((!Number.isFinite(precipitation) || precipitation <= 0) && !isTrace)) {
      return;
    }

    observations.push({
      localDate: currentLocalDate,
      localTime,
      precipitation: isTrace ? null : precipitation
    });
  });

  return deduplicateHourlyPrecipitationObservations(observations);
}

export function extractHkoHourlyPrecipitation(
  payload: unknown,
  now: Date = new Date()
): HourlyPrecipitationObservation[] {
  if (!payload || typeof payload !== "object") {
    throw new Error("HKO hourly rainfall response was not an object");
  }

  const response = payload as {
    obsTime?: unknown;
    hourlyRainfall?: Array<{
      automaticWeatherStation?: unknown;
      automaticWeatherStationID?: unknown;
      value?: unknown;
    }>;
  };
  const observedAt = new Date(String(response.obsTime ?? ""));
  if (Number.isNaN(observedAt.getTime())) {
    throw new Error("HKO hourly rainfall response did not include a valid observation time");
  }

  const local = getLocalDateTime(observedAt, "Asia/Hong_Kong");
  if (local.localDate !== getLocalDate(now, "Asia/Hong_Kong") || local.localTime.slice(3, 5) !== "00") {
    return [];
  }

  const station = response.hourlyRainfall?.find(
    (candidate) =>
      String(candidate.automaticWeatherStationID ?? "").toUpperCase() === "RF023" ||
      String(candidate.automaticWeatherStation ?? "").toLowerCase() === "hong kong observatory"
  );
  const precipitation = Number(station?.value);
  return Number.isFinite(precipitation) && precipitation > 0
    ? [{ ...local, localTime: `${local.localTime.slice(0, 2)}:00`, precipitation }]
    : [];
}

export function extractEnvironmentAgencyHourlyPrecipitation(
  payload: unknown,
  timeZone: string,
  now: Date = new Date()
): HourlyPrecipitationObservation[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { items?: unknown }).items)) {
    throw new Error("Environment Agency rainfall response did not include readings");
  }

  const currentLocalDate = getLocalDate(now, timeZone);
  const buckets = new Map<number, number[]>();
  for (const item of (payload as { items: EnvironmentAgencyReading[] }).items) {
    const observedAt = new Date(String(item.dateTime ?? ""));
    const value = Number(item.value);
    if (Number.isNaN(observedAt.getTime()) || !Number.isFinite(value) || value < 0) {
      continue;
    }

    const bucketEnd = Math.ceil(observedAt.getTime() / 3_600_000) * 3_600_000;
    const readings = buckets.get(bucketEnd) ?? [];
    readings.push(value);
    buckets.set(bucketEnd, readings);
  }

  const observations: HourlyPrecipitationObservation[] = [];
  for (const [bucketEnd, readings] of buckets) {
    const local = getLocalDateTime(new Date(bucketEnd), timeZone);
    const precipitation = readings.reduce((sum, value) => sum + value, 0);
    if (readings.length >= 4 && bucketEnd <= now.getTime() && local.localDate === currentLocalDate && precipitation > 0) {
      observations.push({ ...local, precipitation });
    }
  }

  return deduplicateHourlyPrecipitationObservations(observations);
}

export function extractKmaSeoulHourlyPrecipitation(
  payload: unknown,
  now: Date = new Date()
): HourlyPrecipitationObservation[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { items?: unknown }).items)) {
    throw new Error("KMA Seoul hourly response did not include observations");
  }

  const currentLocalDate = getLocalDate(now, "Asia/Seoul");
  return deduplicateHourlyPrecipitationObservations(
    (payload as { items: KmaHourlyItem[] }).items.flatMap((item): HourlyPrecipitationObservation[] => {
      if (Number(item.awsStnId) !== 108 && String(item.awsStnName ?? "") !== "서울") {
        return [];
      }

      const timestamp = String(item.tm ?? "");
      const precipitation = Number(item.awsPcpHr1);
      if (!/^\d{12}$/.test(timestamp) || !Number.isFinite(precipitation) || precipitation <= 0) {
        return [];
      }

      const localDate = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
      return localDate === currentLocalDate
        ? [{ localDate, localTime: `${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}`, precipitation }]
        : [];
    })
  );
}

export function appendHourlyPrecipitationAlpha(
  officialValue: string,
  observations: HourlyPrecipitationObservation[],
  config: HourlyPrecipitationAlphaConfig,
  previousValue: string | null = null,
  now: Date = new Date()
): string {
  const currentLocalDate = getLocalDate(now, config.timeZone);
  const merged = new Map<string, HourlyPrecipitationObservation>();
  if (extractValueLine(previousValue, "Hourly alpha date local")?.startsWith(currentLocalDate)) {
    for (const observation of extractStoredHourlyObservations(previousValue)) {
      if (observation.localDate === currentLocalDate) {
        merged.set(hourlyObservationKey(observation), observation);
      }
    }
  }

  for (const observation of observations) {
    if (observation.localDate === currentLocalDate && (observation.precipitation === null || observation.precipitation > 0)) {
      const key = hourlyObservationKey(observation);
      if (!config.preserveFirstValuePerHour || !merged.has(key)) {
        merged.set(key, observation);
      }
    }
  }

  const mergedObservations = [...merged.values()].sort(compareHourlyObservations);
  const latest = mergedObservations.at(-1);
  const numericTotal = mergedObservations.reduce((sum, observation) => sum + (observation.precipitation ?? 0), 0);
  const traceCount = mergedObservations.filter((observation) => observation.precipitation === null).length;
  const totalSuffix = traceCount > 0 ? ` (plus ${traceCount} trace hour${traceCount === 1 ? "" : "s"})` : "";

  return [
    officialValue,
    `Hourly alpha station: ${config.station}`,
    `Hourly alpha date local: ${currentLocalDate} (${config.timeZoneLabel})`,
    `Hourly alpha total: ${numericTotal.toFixed(config.decimals)} ${config.unit}${totalSuffix}`,
    `Positive hourly reports: ${mergedObservations.length}`,
    `Latest positive hour local: ${latest ? `${latest.localDate} ${latest.localTime} ${config.timeZoneLabel}` : "none"}`,
    `Latest positive hour precipitation: ${latest ? formatHourlyPrecipitationForDisplay(latest, config) : "none"}`,
    `Hourly positive keys: ${mergedObservations.map((observation) => formatHourlyObservationKey(observation, config)).join(", ") || "none"}`,
    `Hourly alpha source: ${config.source}`,
    ...(config.historyUrl ? [`Hourly history: ${config.historyUrl}`] : []),
    ...(config.sourceNote ? [`Hourly alpha note: ${config.sourceNote}`] : [])
  ].join("\n");
}

export function hasNewOrRevisedHourlyPrecipitation(previousValue: string | null, currentValue: string): boolean {
  if (!previousValue) {
    return false;
  }

  const previous = extractHourlyObservationKeys(previousValue);
  const current = extractHourlyObservationKeys(currentValue);
  return [...current].some(([key, precipitation]) => previous.get(key) !== precipitation);
}

export function extractOfficialPrecipitationSection(value: string): string {
  return value.split("\nHourly alpha station:", 1)[0]?.trim() ?? value.trim();
}

export async function fetchAviationWeatherHourlyPrecipitation(input: {
  stationId: string;
  timeZone: string;
  now?: Date;
}): Promise<{ observations: HourlyPrecipitationObservation[]; source: string; historyUrl: string }> {
  const now = input.now ?? new Date();
  const apiUrl = `https://aviationweather.gov/api/data/metar?ids=${input.stationId}&format=json&hours=48`;
  const historyUrl = `https://forecast.weather.gov/data/obhistory/${input.stationId}.html`;
  let apiError: unknown;
  try {
    const response = await fetchWithTimeout(apiUrl, { headers: requestHeaders });
    if (!response.ok) {
      throw new Error(`AviationWeather ${input.stationId} returned HTTP ${response.status}`);
    }

    return {
      observations: extractAviationWeatherHourlyPrecipitation(await response.json(), input.stationId, input.timeZone, now),
      source: apiUrl,
      historyUrl
    };
  } catch (error) {
    apiError = error;
  }

  try {
    const response = await fetchWithTimeout(historyUrl, { headers: requestHeaders });
    if (!response.ok) {
      throw new Error(`NWS ${input.stationId} hourly history returned HTTP ${response.status}`);
    }

    return {
      observations: extractNwsHourlyPrecipitationHtml(await response.text(), input.timeZone, now),
      source: historyUrl,
      historyUrl
    };
  } catch (historyError) {
    throw new Error(
      `Could not fetch ${input.stationId} hourly precipitation: AviationWeather: ${formatError(apiError)}; NWS history: ${formatError(historyError)}`
    );
  }
}

export function getLocalDate(date: Date, timeZone: string): string {
  return getLocalDateTime(date, timeZone).localDate;
}

export function deduplicateHourlyPrecipitationObservations(
  observations: HourlyPrecipitationObservation[]
): HourlyPrecipitationObservation[] {
  const byKey = new Map<string, HourlyPrecipitationObservation>();
  for (const observation of observations) {
    byKey.set(hourlyObservationKey(observation), observation);
  }
  return [...byKey.values()].sort(compareHourlyObservations);
}

function extractStoredHourlyObservations(value: string | null): HourlyPrecipitationObservation[] {
  const entries = extractValueLine(value, "Hourly positive keys");
  if (!entries || entries === "none") {
    return [];
  }

  return entries.split(", ").flatMap((entry): HourlyPrecipitationObservation[] => {
    const match = entry.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})=(T|-?\d+(?:\.\d+)?)$/);
    if (!match) {
      return [];
    }
    const precipitation = match[3] === "T" ? null : Number(match[3]);
    return precipitation === null || Number.isFinite(precipitation)
      ? [{ localDate: match[1], localTime: match[2], precipitation }]
      : [];
  });
}

function extractHourlyObservationKeys(value: string): Map<string, string> {
  return new Map(
    extractStoredHourlyObservations(value).map((observation) => [
      hourlyObservationKey(observation),
      observation.precipitation === null ? "T" : String(observation.precipitation)
    ])
  );
}

function extractValueLine(value: string | null, label: string): string | null {
  return value?.match(new RegExp(`^${escapeRegExp(label)}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
}

function hourlyObservationKey(observation: HourlyPrecipitationObservation): string {
  return `${observation.localDate}T${observation.localTime}`;
}

function formatHourlyObservationKey(
  observation: HourlyPrecipitationObservation,
  config: HourlyPrecipitationAlphaConfig
): string {
  const precipitation = observation.precipitation === null ? "T" : observation.precipitation.toFixed(config.decimals);
  return `${hourlyObservationKey(observation)}=${precipitation}`;
}

function formatHourlyPrecipitationForDisplay(
  observation: HourlyPrecipitationObservation,
  config: HourlyPrecipitationAlphaConfig
): string {
  return observation.precipitation === null
    ? "T (trace)"
    : `${observation.precipitation.toFixed(config.decimals)} ${config.unit}`;
}

function compareHourlyObservations(left: HourlyPrecipitationObservation, right: HourlyPrecipitationObservation): number {
  return hourlyObservationKey(left).localeCompare(hourlyObservationKey(right));
}

function getLocalDateTime(date: Date, timeZone: string): { localDate: string; localTime: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    localDate: `${values.year}-${values.month}-${values.day}`,
    localTime: `${values.hour}:${values.minute}`
  };
}

function normalizeClockTime(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?:\s*([ap])\.?m\.?)?$/i);
  if (!match) {
    return null;
  }
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "p" && hour < 12) {
    hour += 12;
  } else if (meridiem === "a" && hour === 12) {
    hour = 0;
  }
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
