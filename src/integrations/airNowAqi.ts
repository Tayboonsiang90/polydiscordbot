import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const airNowApiBaseUrl = "https://airnowgovapi.com/v2";
const userAgent = "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1";
const belowThreshold = 100;
const marketStartDate = "2026-07-17";
const marketEndDate = "2026-07-21";
const stadiumSourceUrl = "https://www.airnow.gov/?city=East%20Rutherford&state=NJ&country=USA";
const stadiumFallbackUrl =
  "https://gispub.epa.gov/airnow/?contours=none&monitors=ozonepm&xmin=-8250536.396073639&xmax=-8234197.981277704&ymin=4972953.424285053&ymax=4981084.413168878";
const stadiumWindowStartAt = "2026-07-19T15:00:00-04:00";
const stadiumWindowEndAt = "2026-07-19T20:00:00-04:00";
const stadiumThresholds = [60, 90, 120, 150, 180, 210];
const unionCityHighSchoolSiteId = "840340170008";

type AirNowHistoricalResponse = {
  state?: string;
  fileWrittenDateTime?: string;
  reportingAreas?: Array<Record<string, AirNowHistoricalValues>>;
};

type AirNowHistoricalValues = {
  pm25?: unknown;
  pm10?: unknown;
  ozone?: unknown;
};

type AirNowCurrentRecord = {
  issueDate?: unknown;
  validDate?: unknown;
  timezone?: unknown;
  time?: unknown;
  dataType?: unknown;
  isPrimary?: unknown;
  reportingArea?: unknown;
  siteName?: unknown;
  siteID?: unknown;
  parameter?: unknown;
  aqi?: unknown;
  category?: unknown;
};

export type AirNowDailyAqiRow = {
  date: string;
  pm25: number;
  pm10: number | null;
  ozone: number | null;
  fileWrittenDateTime?: string;
};

export type AirNowDailyAqiReport = {
  cityLabel: string;
  reportingArea: string;
  stateName: string;
  startDate: string;
  endDate: string;
  threshold: number;
  rows: AirNowDailyAqiRow[];
  missingDates: string[];
  belowThresholdRows: AirNowDailyAqiRow[];
  latestRow: AirNowDailyAqiRow | null;
  minimumRow: AirNowDailyAqiRow | null;
  sourceUpdatedAt: string | null;
};

type AirNowDailyAqiConfig = {
  id: string;
  commandName: string;
  displayName: string;
  defaultChannelName: string;
  alertRoleName: string;
  stateName: string;
  stateApiName: string;
  stateUrlName: string;
  reportingArea: string;
  cityLabel: string;
  defaultPolymarketUrl: string;
  startDate?: string;
  endDate?: string;
};

export type AirNowCurrentAqiReading = {
  aqi: number;
  category: string;
  parameter: string;
  reportingArea: string;
  siteName: string;
  siteId: string;
  validDate: string;
  time: string;
  timezone: string;
};

export type AirNowStadiumAqiReport = {
  status: "waiting for kickoff" | "tracking game window" | "game window ended";
  currentReading: AirNowCurrentAqiReading | null;
  previousHighestAqi: number | null;
  highestAqi: number | null;
  hitThresholds: number[];
};

export const airNowStadiumAqiAdapter: WebsiteAdapter = {
  id: "airnow-stadium-aqi",
  commandName: "stadiumaqi",
  displayName: "World Cup Final Stadium AQI",
  sourceUrl: stadiumSourceUrl,
  defaultPolymarketUrl:
    "https://polymarket.com/event/highest-air-quality-index-at-the-stadium-during-the-world-cup-final-20260717141117378",
  defaultChannelName: "stadiumaqi",
  alertRoleName: "Stadium AQI Alerts",
  alertRoleEmoji: "\uD83C\uDF2B\uFE0F",
  getPollIntervalMinutes: (_integration, now = new Date()) => getStadiumPollIntervalMinutes(now),
  getPollIntervalReason: (_integration, now = new Date()) =>
    getStadiumPollIntervalMinutes(now) === 1
      ? "1-minute AirNow current AQI polling around the World Cup final window"
      : "5-minute AirNow current AQI checks before/after the World Cup final window",
  getErrorNoticeWindowMinutes: () => 30,
  shouldAlertOnChange: shouldAlertOnAirNowStadiumChange,
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const records = await fetchAirNowCurrentAqi(40.8135, -74.0745, "NJ");
    const report = buildAirNowStadiumReport(records, integration?.lastValue ?? null, new Date());
    const value = formatAirNowStadiumValue(report);
    return {
      value,
      rawValue: extractAlertKey(value) ?? value,
      unit: "AQI",
      observedAt: new Date()
    };
  }
};

export const airNowPhiladelphiaAqiAdapter = createAirNowDailyPm25Adapter({
  id: "airnow-philadelphia-aqi",
  commandName: "phillyaqi",
  displayName: "Philadelphia PM2.5 AQI",
  defaultChannelName: "phillyaqi",
  alertRoleName: "Philadelphia AQI Alerts",
  stateName: "Pennsylvania",
  stateApiName: "Pennsylvania",
  stateUrlName: "pennsylvania",
  reportingArea: "Philadelphia",
  cityLabel: "Philadelphia",
  defaultPolymarketUrl: "https://polymarket.com/event/philadelphia-air-quality-index-below-100-byptptpt-20260717132206209"
});

export const airNowColumbusAqiAdapter = createAirNowDailyPm25Adapter({
  id: "airnow-columbus-aqi",
  commandName: "columbusaqi",
  displayName: "Columbus PM2.5 AQI",
  defaultChannelName: "columbusaqi",
  alertRoleName: "Columbus AQI Alerts",
  stateName: "Ohio",
  stateApiName: "Ohio",
  stateUrlName: "ohio",
  reportingArea: "Columbus",
  cityLabel: "Columbus",
  defaultPolymarketUrl: "https://polymarket.com/event/columbus-air-quality-index-below-100-byptptpt-20260717132724264"
});

export const airNowChicagoAqiAdapter = createAirNowDailyPm25Adapter({
  id: "airnow-chicago-aqi",
  commandName: "chicagoaqi",
  displayName: "Chicago PM2.5 AQI",
  defaultChannelName: "chicagoaqi",
  alertRoleName: "Chicago AQI Alerts",
  stateName: "Illinois",
  stateApiName: "Illinois",
  stateUrlName: "illinois",
  reportingArea: "Chicago",
  cityLabel: "Chicago",
  defaultPolymarketUrl: "https://polymarket.com/event/chicago-air-quality-index-below-100-byptptpt-20260717130414628"
});

export const airNowNycAqiAdapter = createAirNowDailyPm25Adapter({
  id: "airnow-nyc-aqi",
  commandName: "nycaqi",
  displayName: "NYC PM2.5 AQI",
  defaultChannelName: "nycaqi",
  alertRoleName: "NYC AQI Alerts",
  stateName: "New York",
  stateApiName: "New_York",
  stateUrlName: "new-york",
  reportingArea: "New York City Region",
  cityLabel: "NYC",
  defaultPolymarketUrl: "https://polymarket.com/event/nyc-air-quality-index-below-100-byptptpt-20260717052808748"
});

export function createAirNowDailyPm25Adapter(config: AirNowDailyAqiConfig): WebsiteAdapter {
  const sourceUrl = `https://www.airnow.gov/state/?name=${config.stateUrlName}`;
  return {
    id: config.id,
    commandName: config.commandName,
    displayName: config.displayName,
    sourceUrl,
    defaultPolymarketUrl: config.defaultPolymarketUrl,
    defaultChannelName: config.defaultChannelName,
    alertRoleName: config.alertRoleName,
    alertRoleEmoji: "\uD83C\uDF2B\uFE0F",
    getPollIntervalMinutes: () => 5,
    getPollIntervalReason: () => "5-minute AirNow finalized historical PM2.5 AQI row checks",
    getErrorNoticeWindowMinutes: () => 30,
    shouldAlertOnChange: shouldAlertOnAirNowDailyChange,
    async fetchCurrentValue(): Promise<AdapterValue> {
      const report = await fetchAirNowDailyPm25Report(config);
      const value = formatAirNowDailyAqiValue(report, sourceUrl);
      return {
        value,
        rawValue: extractAlertKey(value) ?? value,
        unit: "AQI",
        observedAt: new Date()
      };
    }
  };
}

export async function fetchAirNowDailyPm25Report(config: AirNowDailyAqiConfig): Promise<AirNowDailyAqiReport> {
  const dates = enumerateDates(config.startDate ?? marketStartDate, config.endDate ?? marketEndDate);
  const responses = await Promise.all(dates.map((date) => fetchAirNowHistoricalStateData(config.stateApiName, date)));
  return buildAirNowDailyAqiReport(config, dates, responses);
}

export async function fetchAirNowHistoricalStateData(stateApiName: string, date: string): Promise<AirNowHistoricalResponse | null> {
  const url = buildAirNowHistoricalStateUrl(stateApiName, date);
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: "application/json",
      "user-agent": userAgent
    }
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`AirNow historical AQI endpoint returned HTTP ${response.status}`);
  }
  return (await response.json()) as AirNowHistoricalResponse;
}

export async function fetchAirNowCurrentAqi(latitude: number, longitude: number, stateCode: string): Promise<AirNowCurrentRecord[]> {
  const url = `${airNowApiBaseUrl}/reportingarea/get?latitude=${latitude}&longitude=${longitude}&stateCode=${encodeURIComponent(
    stateCode
  )}&maxDistance=50`;
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: "application/json",
      "user-agent": userAgent
    }
  });
  if (!response.ok) {
    throw new Error(`AirNow current AQI endpoint returned HTTP ${response.status}`);
  }
  const json = (await response.json()) as unknown;
  if (!Array.isArray(json)) {
    throw new Error("AirNow current AQI endpoint returned a non-array payload");
  }
  return json as AirNowCurrentRecord[];
}

export function buildAirNowHistoricalStateUrl(stateApiName: string, date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${airNowApiBaseUrl}/andata/States/${encodeURIComponent(stateApiName)}/${year}/${month}/${day}.json`;
}

export function buildAirNowDailyAqiReport(
  config: Pick<AirNowDailyAqiConfig, "cityLabel" | "reportingArea" | "stateName">,
  dates: string[],
  responses: Array<AirNowHistoricalResponse | null>
): AirNowDailyAqiReport {
  const rows: AirNowDailyAqiRow[] = [];
  const missingDates: string[] = [];
  const sourceUpdateTimes: string[] = [];

  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index];
    const response = responses[index];
    if (!response) {
      missingDates.push(date);
      continue;
    }

    if (response.fileWrittenDateTime) {
      sourceUpdateTimes.push(response.fileWrittenDateTime);
    }

    const values = extractHistoricalValuesForArea(response, config.reportingArea);
    const pm25 = normalizeAqiValue(values?.pm25);
    if (pm25 === null) {
      missingDates.push(date);
      continue;
    }

    rows.push({
      date,
      pm25,
      pm10: normalizeAqiValue(values?.pm10),
      ozone: normalizeAqiValue(values?.ozone),
      fileWrittenDateTime: response.fileWrittenDateTime
    });
  }

  rows.sort((left, right) => left.date.localeCompare(right.date));
  const belowThresholdRows = rows.filter((row) => row.pm25 < belowThreshold);
  const latestRow = rows.at(-1) ?? null;
  const minimumRow = rows.length
    ? rows.reduce((best, row) => (row.pm25 < best.pm25 ? row : best), rows[0])
    : null;
  const sourceUpdatedAt = sourceUpdateTimes.sort().at(-1) ?? null;

  return {
    cityLabel: config.cityLabel,
    reportingArea: config.reportingArea,
    stateName: config.stateName,
    startDate: dates[0] ?? marketStartDate,
    endDate: dates.at(-1) ?? marketEndDate,
    threshold: belowThreshold,
    rows,
    missingDates,
    belowThresholdRows,
    latestRow,
    minimumRow,
    sourceUpdatedAt
  };
}

export function buildAirNowStadiumReport(
  records: AirNowCurrentRecord[],
  previousValue: string | null,
  observedAt: Date
): AirNowStadiumAqiReport {
  const currentReading = pickCurrentPm25Reading(records);
  const previousHighestAqi = extractHighestAqi(previousValue);
  const status = getStadiumTrackingStatus(observedAt);
  const currentAqiInWindow = status === "tracking game window" ? currentReading?.aqi ?? null : null;
  const highestAqi = maxNullable(previousHighestAqi, currentAqiInWindow);
  return {
    status,
    currentReading,
    previousHighestAqi,
    highestAqi,
    hitThresholds: highestAqi === null ? [] : stadiumThresholds.filter((threshold) => highestAqi >= threshold)
  };
}

export function formatAirNowDailyAqiValue(report: AirNowDailyAqiReport, sourceUrl: string): string {
  const earliestBelow = report.belowThresholdRows[0] ?? null;
  return [
    "Metric: AirNow finalized Daily AQI for PM2.5",
    `Area: ${report.reportingArea}, ${report.stateName}`,
    `Market window: ${report.startDate} to ${report.endDate} ET`,
    `Below 100 observed: ${earliestBelow ? `YES - ${earliestBelow.date} = ${earliestBelow.pm25}` : "not yet"}`,
    `Minimum PM2.5 AQI: ${report.minimumRow ? `${report.minimumRow.pm25} on ${report.minimumRow.date}` : "not published yet"}`,
    `Latest finalized day: ${report.latestRow ? `${report.latestRow.date} = ${report.latestRow.pm25}` : "not published yet"}`,
    `Reported days: ${report.rows.length}/${enumerateDates(report.startDate, report.endDate).length}`,
    `Missing dates: ${report.missingDates.length ? report.missingDates.join(", ") : "none"}`,
    `Daily PM2.5: ${report.rows.length ? report.rows.map((row) => `${row.date} ${row.pm25}`).join("; ") : "none"}`,
    `Source updated: ${report.sourceUpdatedAt ? formatAirNowSourceUpdateTime(report.sourceUpdatedAt) : "not published yet"}`,
    `Alert key: ${formatDailyAlertKey(report)}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function formatAirNowStadiumValue(report: AirNowStadiumAqiReport): string {
  return [
    "Metric: AirNow current PM2.5 AQI near MetLife Stadium",
    `Status: ${report.status}`,
    `Current PM2.5 AQI: ${report.currentReading ? `${report.currentReading.aqi} (${report.currentReading.category})` : "not available"}`,
    `Current monitor: ${report.currentReading ? `${report.currentReading.siteName} (${report.currentReading.siteId})` : "not available"}`,
    `Reading time (ET): ${report.currentReading ? formatCurrentReadingTime(report.currentReading) : "not available"}`,
    `Highest tracked AQI: ${report.highestAqi ?? "not started"}`,
    `Hit thresholds: ${report.hitThresholds.length ? report.hitThresholds.join(", ") : "none"}`,
    "Tracking window: 2026-07-19 15:00 ET to 2026-07-19 20:00 ET",
    `Alert key: ${formatStadiumAlertKey(report)}`,
    `Resolution: ${stadiumSourceUrl}`,
    `Fallback monitor: Union City High School - ${stadiumFallbackUrl}`
  ].join("\n");
}

export function shouldAlertOnAirNowDailyChange(previousValue: string | null, currentValue: string): boolean {
  if (!previousValue) {
    return false;
  }
  const previousKey = extractAlertKey(previousValue);
  const currentKey = extractAlertKey(currentValue);
  return Boolean(previousKey && currentKey && previousKey !== currentKey);
}

export function shouldAlertOnAirNowStadiumChange(previousValue: string | null, currentValue: string): boolean {
  if (!previousValue) {
    return false;
  }
  const previousHighest = extractHighestAqi(previousValue);
  const currentHighest = extractHighestAqi(currentValue);
  if (currentHighest !== null && (previousHighest === null || currentHighest > previousHighest)) {
    return true;
  }

  const currentReadingKey = extractStadiumCurrentReadingKey(currentValue);
  if (!currentReadingKey || currentReadingKey === "ignored-after-window") {
    return false;
  }

  return extractStadiumCurrentReadingKey(previousValue) !== currentReadingKey;
}

function extractHistoricalValuesForArea(
  response: AirNowHistoricalResponse,
  reportingArea: string
): AirNowHistoricalValues | null {
  for (const row of response.reportingAreas ?? []) {
    const values = row[reportingArea];
    if (values) {
      return values;
    }
  }
  return null;
}

function pickCurrentPm25Reading(records: AirNowCurrentRecord[]): AirNowCurrentAqiReading | null {
  const pm25Readings = records
    .filter((record) => record.dataType === "O" && record.parameter === "PM2.5")
    .map(normalizeCurrentReading)
    .filter((record): record is AirNowCurrentAqiReading => record !== null);
  if (!pm25Readings.length) {
    return null;
  }

  return (
    pm25Readings.find((record) => record.siteId === unionCityHighSchoolSiteId) ??
    pm25Readings.find((record) => record.siteName === "Union City High School") ??
    pm25Readings.reduce((best, record) => (record.aqi > best.aqi ? record : best), pm25Readings[0])
  );
}

function normalizeCurrentReading(record: AirNowCurrentRecord): AirNowCurrentAqiReading | null {
  const aqi = normalizeAqiValue(record.aqi);
  if (aqi === null) {
    return null;
  }

  return {
    aqi,
    category: readString(record.category) ?? "unknown",
    parameter: readString(record.parameter) ?? "PM2.5",
    reportingArea: readString(record.reportingArea) ?? "unknown",
    siteName: readString(record.siteName) ?? readString(record.reportingArea) ?? "unknown",
    siteId: readString(record.siteID) ?? "unknown",
    validDate: readString(record.validDate) ?? "unknown",
    time: readString(record.time) ?? "",
    timezone: readString(record.timezone) ?? "ET"
  };
}

function normalizeAqiValue(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return null;
  }
  return numberValue;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatDailyAlertKey(report: AirNowDailyAqiReport): string {
  return report.rows.map((row) => `${row.date}=${row.pm25}`).join("|") || "none";
}

function formatStadiumAlertKey(report: AirNowStadiumAqiReport): string {
  const currentReadingKey =
    report.status === "game window ended" ? "ignored-after-window" : formatCurrentReadingAlertKey(report.currentReading);
  return `highest=${report.highestAqi ?? "none"}|current=${currentReadingKey}|thresholds=${report.hitThresholds.join(",") || "none"}`;
}

function extractAlertKey(value: string | null): string | null {
  return value?.match(/^Alert key:\s*(.+)$/m)?.[1]?.trim() ?? null;
}

function extractHighestAqi(value: string | null): number | null {
  const match = value?.match(/^Highest tracked AQI:\s*(\d+(?:\.\d+)?)/m);
  if (!match) {
    return null;
  }
  const numberValue = Number(match[1]);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function extractStadiumCurrentReadingKey(value: string | null): string | null {
  const alertKey = extractAlertKey(value);
  return alertKey?.match(/(?:^|\|)current=([^|]+)/)?.[1]?.trim() ?? null;
}

function formatCurrentReadingAlertKey(reading: AirNowCurrentAqiReading | null): string {
  if (!reading) {
    return "none";
  }

  return `${reading.aqi}@${reading.validDate} ${reading.time || "no-time"} ${reading.timezone}@${reading.siteId}`;
}

function getStadiumPollIntervalMinutes(now: Date): number {
  const start = Date.parse(stadiumWindowStartAt) - 30 * 60_000;
  const end = Date.parse(stadiumWindowEndAt) + 60 * 60_000;
  return now.getTime() >= start && now.getTime() <= end ? 1 : 5;
}

function getStadiumTrackingStatus(now: Date): AirNowStadiumAqiReport["status"] {
  const timestamp = now.getTime();
  if (timestamp < Date.parse(stadiumWindowStartAt)) {
    return "waiting for kickoff";
  }
  if (timestamp <= Date.parse(stadiumWindowEndAt)) {
    return "tracking game window";
  }
  return "game window ended";
}

function maxNullable(left: number | null, right: number | null): number | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return Math.max(left, right);
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let timestamp = Date.parse(`${startDate}T12:00:00.000Z`);
  const endTimestamp = Date.parse(`${endDate}T12:00:00.000Z`);
  while (timestamp <= endTimestamp) {
    dates.push(new Date(timestamp).toISOString().slice(0, 10));
    timestamp += 24 * 60 * 60 * 1000;
  }
  return dates;
}

function formatAirNowSourceUpdateTime(value: string): string {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) {
    return value;
  }
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day} ${hour}:${minute}:${second} UTC`;
}

function formatCurrentReadingTime(reading: AirNowCurrentAqiReading): string {
  return `${reading.validDate} ${reading.time || "time not listed"} ${reading.timezone}`;
}
