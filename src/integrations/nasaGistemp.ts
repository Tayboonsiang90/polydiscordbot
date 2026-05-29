import { fetchWithTimeout } from "../http.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.txt";
const defaultPolymarketUrl = "https://polymarket.com/event/june-2026-temperature-increase-c";
const defaultYear = 2026;
const defaultMonth = 6;
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type NasaGistempSettings = {
  year: number;
  month: number;
};

export type NasaGistempObservation = {
  year: number;
  month: number;
  monthName: string;
  tableValue: number;
  anomalyCelsius: number;
};

export const nasaGistempAdapter: WebsiteAdapter = {
  id: "nasa-gistemp-temperature",
  commandName: "gistemp",
  displayName: "NASA GISTEMP Temperature",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "gistemp",
  alertRoleName: "NASA GISTEMP Alerts",
  alertRoleEmoji: "\uD83C\uDF21\uFE0F",
  defaultSettings: { year: defaultYear, month: defaultMonth },
  supportsPeriod: true,
  shouldAlertOnChange: nasaGistempShouldAlertOnChange,
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
    });
    if (!response.ok) {
      throw new Error(`NASA GISTEMP returned HTTP ${response.status}`);
    }

    const settings = getNasaGistempSettings(integration);
    const value = extractNasaGistempValue(await response.text(), settings);
    return {
      value,
      rawValue: extractCurrentValueLine(value) ?? value,
      unit: "°C anomaly",
      observedAt: new Date()
    };
  }
};

export function getNasaGistempSettings(integration?: Integration): NasaGistempSettings {
  const settings = parseSettingsJson(integration?.settingsJson);
  const year = Number(settings.year);
  const month = Number(settings.month);
  if (isValidNasaGistempPeriod(year, month)) {
    return { year, month };
  }

  return { year: defaultYear, month: defaultMonth };
}

export function extractNasaGistempValue(text: string, settings: NasaGistempSettings): string {
  const observations = extractNasaGistempObservations(text);
  const target = observations.find((observation) => observation.year === settings.year && observation.month === settings.month);
  const latest = observations.at(-1) ?? null;
  const period = `${settings.year}-${padMonth(settings.month)}`;
  const columnName = monthNames[settings.month - 1];

  if (!target) {
    return [
      "Metric: NASA GISTEMP Global Land-Ocean Temperature Index",
      `Period: ${period}`,
      "Value: not published yet",
      `Source cell: row ${settings.year}, column ${columnName}`,
      `Latest available: ${latest ? formatObservation(latest) : "none"}`,
      "Table units: 0.01 °C; displayed value is divided by 100"
    ].join("\n");
  }

  return [
    "Metric: NASA GISTEMP Global Land-Ocean Temperature Index",
    `Period: ${period}`,
    `Value: ${formatCelsius(target.anomalyCelsius)} °C anomaly`,
    `Table value: ${target.tableValue}`,
    `Source cell: row ${settings.year}, column ${columnName}`,
    "Table units: 0.01 °C; displayed value is divided by 100"
  ].join("\n");
}

export function extractNasaGistempObservations(text: string): NasaGistempObservation[] {
  return text
    .split(/\r?\n/)
    .flatMap((line) => extractNasaGistempRowObservations(line))
    .sort((left, right) => left.year - right.year || left.month - right.month);
}

export function extractNasaGistempRowObservations(line: string): NasaGistempObservation[] {
  const columns = line.trim().split(/\s+/);
  if (columns.length < 13 || !/^\d{4}$/.test(columns[0])) {
    return [];
  }

  const year = Number(columns[0]);
  if (!Number.isInteger(year)) {
    return [];
  }

  return monthNames.flatMap((monthName, index) => {
    const rawValue = columns[index + 1];
    if (!rawValue || rawValue === "****" || !/^-?\d+$/.test(rawValue)) {
      return [];
    }

    const tableValue = Number(rawValue);
    return [
      {
        year,
        month: index + 1,
        monthName,
        tableValue,
        anomalyCelsius: tableValue / 100
      }
    ];
  });
}

export function nasaGistempShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  return Boolean(previousValue?.includes("Value: not published yet")) && !currentValue.includes("Value: not published yet");
}

function extractCurrentValueLine(value: string): string | null {
  return value.match(/^Value:\s*(.+)$/m)?.[1] ?? null;
}

function formatObservation(observation: NasaGistempObservation): string {
  return `${observation.year}-${padMonth(observation.month)} = ${formatCelsius(observation.anomalyCelsius)} °C (table value ${observation.tableValue})`;
}

function formatCelsius(value: number): string {
  return value.toFixed(2);
}

function isValidNasaGistempPeriod(year: number, month: number): boolean {
  return Number.isInteger(year) && Number.isInteger(month) && year >= 1880 && year <= 2100 && month >= 1 && month <= 12;
}

function padMonth(month: number): string {
  return String(month).padStart(2, "0");
}
