import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.wunderground.com/history/daily/fr/bonneuil-en-france/LFPB";
const defaultPolymarketUrl = "https://polymarket.com/event/paris-heat-wave-by-july-31-20260630174856599";
const weatherApiKey = process.env.WUNDERGROUND_API_KEY ?? "e1f10a1e78da46f5b10a1e78da96f525";
const weatherLocationId = "LFPB:9:FR";
const stationCode = "LFPB";
const stationName = "Paris-Le Bourget Airport Station";
const stationTimeZone = "Europe/Paris";
const marketStartDate = "2026-06-30";
const marketEndDate = "2026-07-31";
const thresholdCelsius = 35;
const requiredConsecutiveDays = 3;

type WundergroundHistoryResponse = {
  metadata?: {
    status_code?: number;
  };
  observations?: WundergroundObservation[];
};

type WundergroundObservation = {
  obs_id?: unknown;
  valid_time_gmt?: unknown;
  temp?: unknown;
  max_temp?: unknown;
};

export type ParisHeatDay = {
  date: string;
  highCelsius: number;
  observationCount: number;
};

export type ParisHeatReport = {
  startDate: string;
  endDate: string;
  fetchedThroughDate: string;
  days: ParisHeatDay[];
  qualifyingDays: ParisHeatDay[];
  latestDay: ParisHeatDay | null;
  longestStreak: ParisHeatDay[];
  triggerReached: boolean;
};

export const parisHeatWaveAdapter: WebsiteAdapter = {
  id: "paris-heat-wave",
  commandName: "parisheat",
  displayName: "Paris Heat Wave",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "parisheat",
  alertRoleName: "Paris Heat Alerts",
  alertRoleEmoji: "\uD83C\uDF21\uFE0F",
  getPollIntervalMinutes: () => 5,
  getPollIntervalReason: () => "Fixed 5-minute check for Paris-Le Bourget Wunderground daily high updates",
  shouldAlertOnChange: parisHeatWaveShouldAlertOnChange,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const fetchedThroughDate = minDate(getStationDate(new Date()), marketEndDate);
    const response = await fetchWundergroundHistory(marketStartDate, fetchedThroughDate);
    const report = buildParisHeatReport(response, fetchedThroughDate);
    const value = formatParisHeatWaveValue(report);
    return {
      value,
      rawValue: extractParisHeatAlertKey(value) ?? value,
      unit: "degrees Celsius",
      observedAt: new Date()
    };
  }
};

export async function fetchWundergroundHistory(startDate: string, endDate: string): Promise<WundergroundHistoryResponse> {
  const url = buildWundergroundHistoryApiUrl(startDate, endDate);
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`Wunderground history API returned HTTP ${response.status}`);
  }

  return (await response.json()) as WundergroundHistoryResponse;
}

export function buildParisHeatReport(response: WundergroundHistoryResponse, fetchedThroughDate: string): ParisHeatReport {
  if (response.metadata?.status_code && response.metadata.status_code !== 200) {
    throw new Error(`Wunderground history API status ${response.metadata.status_code}`);
  }

  const days = extractParisHeatDays(response.observations ?? []);
  const qualifyingDays = days.filter((day) => day.highCelsius >= thresholdCelsius);
  const longestStreak = findLongestConsecutiveStreak(qualifyingDays);
  return {
    startDate: marketStartDate,
    endDate: marketEndDate,
    fetchedThroughDate,
    days,
    qualifyingDays,
    latestDay: days.at(-1) ?? null,
    longestStreak,
    triggerReached: longestStreak.length >= requiredConsecutiveDays
  };
}

export function extractParisHeatDays(observations: WundergroundObservation[]): ParisHeatDay[] {
  const byDate = new Map<string, number[]>();
  for (const observation of observations) {
    if (observation.obs_id !== stationCode || typeof observation.valid_time_gmt !== "number") {
      continue;
    }

    const date = getStationDate(new Date(observation.valid_time_gmt * 1000));
    if (date < marketStartDate || date > marketEndDate) {
      continue;
    }

    const temperature = readTemperature(observation);
    if (temperature === null) {
      continue;
    }

    const temperatures = byDate.get(date) ?? [];
    temperatures.push(temperature);
    byDate.set(date, temperatures);
  }

  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, temperatures]) => ({
      date,
      highCelsius: Math.max(...temperatures),
      observationCount: temperatures.length
    }));
}

export function formatParisHeatWaveValue(report: ParisHeatReport): string {
  const recentDays = report.days.slice(-10);
  const qualifyingDates = report.qualifyingDays.map((day) => day.date);
  return [
    "Metric: Paris-Le Bourget daily high temperature",
    `Station: ${stationName} (${stationCode})`,
    `Market window: ${report.startDate} to ${report.endDate} station local dates`,
    `Threshold: >=${thresholdCelsius}°C for ${requiredConsecutiveDays} consecutive calendar days`,
    `Status: ${report.triggerReached ? "YES trigger reached" : qualifyingDates.length ? "qualifying days found, streak not complete" : "watching"}`,
    `Reported days: ${report.days.length}`,
    `Fetched through: ${report.fetchedThroughDate}`,
    `Latest reported day: ${report.latestDay ? formatHeatDay(report.latestDay) : "none"}`,
    `Qualifying days: ${report.qualifyingDays.length ? report.qualifyingDays.map(formatHeatDay).join("; ") : "none"}`,
    `Longest qualifying streak: ${report.longestStreak.length ? report.longestStreak.map(formatHeatDay).join("; ") : "none"}`,
    `Recent daily highs: ${recentDays.length ? recentDays.map(formatHeatDay).join("; ") : "none"}`,
    `Alert key: ${formatParisHeatAlertKey(report)}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function parisHeatWaveShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  if (!previousValue) {
    return false;
  }

  const previousKey = extractParisHeatAlertKey(previousValue);
  const currentKey = extractParisHeatAlertKey(currentValue);
  if (!previousKey || !currentKey || previousKey === currentKey) {
    return false;
  }

  return previousKey !== "none|0|no" || currentKey !== "none|0|no";
}

export function buildWundergroundHistoryApiUrl(startDate: string, endDate: string): string {
  return `https://api.weather.com/v1/location/${weatherLocationId}/observations/historical.json?apiKey=${weatherApiKey}&units=m&startDate=${formatApiDate(startDate)}&endDate=${formatApiDate(endDate)}`;
}

function readTemperature(observation: WundergroundObservation): number | null {
  const candidates = [observation.temp, observation.max_temp];
  const temperatures = candidates.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!temperatures.length) {
    return null;
  }

  return Math.max(...temperatures);
}

function findLongestConsecutiveStreak(days: ParisHeatDay[]): ParisHeatDay[] {
  let current: ParisHeatDay[] = [];
  let longest: ParisHeatDay[] = [];
  for (const day of days) {
    const previous = current.at(-1);
    if (!previous || day.date === addDays(previous.date, 1)) {
      current = [...current, day];
    } else {
      current = [day];
    }

    if (current.length > longest.length) {
      longest = current;
    }
  }

  return longest;
}

function formatParisHeatAlertKey(report: ParisHeatReport): string {
  const qualifyingDates = report.qualifyingDays.map((day) => day.date).join(",") || "none";
  return `${qualifyingDates}|${report.longestStreak.length}|${report.triggerReached ? "yes" : "no"}`;
}

function extractParisHeatAlertKey(value: string): string | null {
  return value.match(/^Alert key:\s*(.+)$/m)?.[1]?.trim() ?? null;
}

function formatHeatDay(day: ParisHeatDay): string {
  return `${day.date} ${day.highCelsius}°C`;
}

function getStationDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: stationTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function addDays(value: string, days: number): string {
  const timestamp = Date.parse(`${value}T12:00:00.000Z`);
  return new Date(timestamp + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function minDate(left: string, right: string): string {
  return left < right ? left : right;
}

function formatApiDate(value: string): string {
  return value.replace(/-/g, "");
}
