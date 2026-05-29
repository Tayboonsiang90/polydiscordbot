import { fetchWithTimeout } from "../http.js";
import { refreshMonthlyPolymarketQueue, type MonthlyPolymarketDiscoveryConfig } from "./monthlyPolymarketDiscovery.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.metoffice.gov.uk/pub/data/weather/uk/climate/stationdata/heathrowdata.txt";
const defaultYear = 2026;
const defaultMonth = 5;
const monthlyDiscoveryConfig: MonthlyPolymarketDiscoveryConfig = {
  searchQuery: "precipitation in london",
  slugPrefix: "precipitation-in-london-in-",
  titlePrefix: "Precipitation in London in",
  lastDiscoveryAtKey: "lastLondonPrecipDiscoveryAt",
  requiredTagSlugs: ["precipitation"]
};

type LondonPrecipSettings = {
  year: number;
  month: number;
};

type HeathrowClimateRow = {
  year: number;
  month: number;
  rainText: string;
  provisional: boolean;
};

export function getLondonPrecipSettings(integration?: Integration): LondonPrecipSettings {
  if (!integration?.settingsJson) {
    return { year: defaultYear, month: defaultMonth };
  }

  try {
    const settings = JSON.parse(integration.settingsJson) as Partial<LondonPrecipSettings>;
    const year = Number(settings.year);
    const month = Number(settings.month);
    if (isValidLondonPrecipPeriod(year, month)) {
      return { year, month };
    }
  } catch {
    return { year: defaultYear, month: defaultMonth };
  }

  return { year: defaultYear, month: defaultMonth };
}

export function extractLondonPrecipitationValue(text: string, settings: LondonPrecipSettings): string {
  const rows = extractHeathrowClimateRows(text);
  const row = rows.find((candidate) => candidate.year === settings.year && candidate.month === settings.month);
  const period = `${settings.year}-${padMonth(settings.month)}`;
  if (!row) {
    const latest = rows.at(-1);
    return [
      "Metric: Met Office Heathrow precipitation",
      `Period: ${period}`,
      "Value: not published yet",
      `Latest available: ${latest ? `${latest.year}-${padMonth(latest.month)} = ${latest.rainText} mm` : "none"}`
    ].join("\n");
  }

  return [
    "Metric: Met Office Heathrow precipitation",
    `Period: ${period}`,
    `Value: ${row.rainText} mm`,
    `Status: ${row.provisional ? "Provisional" : "Final"}`
  ].join("\n");
}

export function extractHeathrowClimateRows(text: string): HeathrowClimateRow[] {
  return text
    .split(/\r?\n/)
    .flatMap((line) => {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 6 || !/^\d{4}$/.test(columns[0]) || !/^\d{1,2}$/.test(columns[1])) {
        return [];
      }

      const year = Number(columns[0]);
      const month = Number(columns[1]);
      if (!isValidLondonPrecipPeriod(year, month)) {
        return [];
      }

      const rainText = normalizeRainfallValue(columns[5]);
      if (!rainText) {
        return [];
      }

      return [
        {
          year,
          month,
          rainText,
          provisional: line.toLowerCase().includes("provisional")
        }
      ];
    });
}

export function londonPrecipShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  return extractValueLine(previousValue) !== extractValueLine(currentValue);
}

export const londonPrecipAdapter: WebsiteAdapter = {
  id: "met-office-london-precip",
  commandName: "londonprecip",
  displayName: "Met Office London Precipitation",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/precipitation-in-london-in-may",
  defaultChannelName: "londonprecip",
  alertRoleName: "Met Office London Precip Alerts",
  alertRoleEmoji: "\u2614",
  defaultSettings: { year: defaultYear, month: defaultMonth },
  supportsPeriod: true,
  shouldAlertOnChange: londonPrecipShouldAlertOnChange,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshMonthlyPolymarketQueue(integration, monthlyDiscoveryConfig)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Met Office returned HTTP ${response.status}`);
    }

    const value = extractLondonPrecipitationValue(await response.text(), getLondonPrecipSettings(integration));
    return {
      value,
      rawValue: value,
      unit: "monthly precipitation",
      observedAt: new Date()
    };
  }
};

export function isValidLondonPrecipPeriod(year: number, month: number): boolean {
  return Number.isInteger(year) && Number.isInteger(month) && year >= 1948 && year <= 2100 && month >= 1 && month <= 12;
}

function normalizeRainfallValue(value: string): string | null {
  const normalized = value.replace(/[^\d.-]/g, "");
  if (!normalized || value === "---") {
    return null;
  }

  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue >= 1000) {
    throw new Error(`Invalid Met Office Heathrow precipitation value: ${value}`);
  }

  return numericValue.toFixed(1);
}

function extractValueLine(value: string | null): string | null {
  return value?.match(/^Value:\s*(.+)$/m)?.[1] ?? value;
}

function padMonth(month: number): string {
  return String(month).padStart(2, "0");
}
