import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { refreshMonthlyPolymarketQueue, type MonthlyPolymarketDiscoveryConfig } from "./monthlyPolymarketDiscovery.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.metoffice.gov.uk/pub/data/weather/uk/climate/stationdata/heathrowdata.txt";
const infoclimatStationPath = "london-heathrow-londres/valeurs/03772.html";
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

type LondonOfficialPrecipitationValue = {
  totalText: string | null;
  total: number | null;
  provisional: boolean;
  latestPeriodText: string | null;
};

export type InfoclimatLondonMonthlyPrecipitation = {
  totalText: string;
  total: number;
  updatedAt: string | null;
  sourceUrl: string;
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
  return buildLondonPrecipitationAlphaValue(extractLondonPrecipitationOfficialValue(text, settings), null, settings);
}

export function extractLondonPrecipitationOfficialValue(
  text: string,
  settings: LondonPrecipSettings
): LondonOfficialPrecipitationValue {
  const rows = extractHeathrowClimateRows(text);
  const row = rows.find((candidate) => candidate.year === settings.year && candidate.month === settings.month);
  const latest = rows.at(-1);
  if (!row) {
    return {
      totalText: null,
      total: null,
      provisional: false,
      latestPeriodText: latest ? `${latest.year}-${padMonth(latest.month)} = ${latest.rainText} mm` : null
    };
  }

  return {
    totalText: row.rainText,
    total: Number(row.rainText),
    provisional: row.provisional,
    latestPeriodText: latest ? `${latest.year}-${padMonth(latest.month)} = ${latest.rainText} mm` : null
  };
}

export function buildLondonPrecipitationAlphaValue(
  official: LondonOfficialPrecipitationValue,
  alpha: InfoclimatLondonMonthlyPrecipitation | null,
  settings: LondonPrecipSettings
): string {
  const period = `${settings.year}-${padMonth(settings.month)}`;
  if (official.totalText) {
    return [
      "Metric: Met Office Heathrow precipitation",
      `Period: ${period}`,
      `Current total: ${official.totalText} mm`,
      "Data status: official Met Office station data",
      `Official Met Office row: ${official.totalText} mm (${official.provisional ? "Provisional" : "Final"})`,
      `Alpha Infoclimat cumulative: ${formatAlphaValue(alpha)}`
    ].join("\n");
  }

  return [
    "Metric: Met Office Heathrow precipitation",
    `Period: ${period}`,
    `Current total: ${alpha ? `${alpha.totalText} mm` : "not published yet"}`,
    `Data status: ${alpha ? "alpha Infoclimat daily climatology" : "not published yet"}`,
    "Official Met Office row: not published yet",
    `Latest official Met Office row: ${official.latestPeriodText ?? "none"}`,
    `Alpha Infoclimat cumulative: ${formatAlphaValue(alpha)}`,
    `Alpha source: ${buildInfoclimatLondonPrecipitationUrl(settings.year)}`
  ].join("\n");
}

export function extractInfoclimatLondonMonthlyPrecipitation(
  html: string,
  settings: LondonPrecipSettings,
  source = buildInfoclimatLondonPrecipitationUrl(settings.year)
): InfoclimatLondonMonthlyPrecipitation {
  const $ = cheerio.load(html);
  let totalText: string | null = null;
  let updatedAt: string | null = null;

  $("tr").each((_, row) => {
    const cells = $(row)
      .find("th,td")
      .map((__, cell) => normalizeText($(cell).text()))
      .get();
    const label = normalizeAscii(cells[0] ?? "");
    if (label.includes("cumulprecip")) {
      totalText = normalizeRainfallValue(cells[settings.month]);
    }
    if (label.includes("miseajour")) {
      updatedAt = normalizeText(cells[settings.month] ?? "") || null;
    }
  });

  if (!totalText) {
    throw new Error("Could not find Infoclimat London monthly precipitation cumulative value");
  }

  return {
    totalText,
    total: Number(totalText),
    updatedAt,
    sourceUrl: source
  };
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
  return extractCurrentTotalLine(previousValue) !== extractCurrentTotalLine(currentValue);
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
    const settings = getLondonPrecipSettings(integration);
    const [response, alpha] = await Promise.all([
      fetchWithTimeout(sourceUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
        }
      }),
      fetchInfoclimatLondonPrecipitation(settings)
    ]);

    if (!response.ok) {
      throw new Error(`Met Office returned HTTP ${response.status}`);
    }

    const official = extractLondonPrecipitationOfficialValue(await response.text(), settings);
    const value = buildLondonPrecipitationAlphaValue(official, alpha, settings);
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

function buildInfoclimatLondonPrecipitationUrl(year: number): string {
  return `https://www.infoclimat.fr/climatologie/annee/${year}/${infoclimatStationPath}`;
}

async function fetchInfoclimatLondonPrecipitation(
  settings: LondonPrecipSettings
): Promise<InfoclimatLondonMonthlyPrecipitation | null> {
  try {
    const source = buildInfoclimatLondonPrecipitationUrl(settings.year);
    const response = await fetchWithTimeout(source, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });
    if (!response.ok) {
      return null;
    }

    return extractInfoclimatLondonMonthlyPrecipitation(await response.text(), settings, source);
  } catch {
    return null;
  }
}

function normalizeRainfallValue(value: string): string | null {
  const normalized = value.replace(",", ".").replace(/[^\d.-]/g, "");
  if (!normalized || value === "---") {
    return null;
  }

  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue >= 1000) {
    throw new Error(`Invalid Met Office Heathrow precipitation value: ${value}`);
  }

  return numericValue.toFixed(1);
}

function formatAlphaValue(alpha: InfoclimatLondonMonthlyPrecipitation | null): string {
  if (!alpha) {
    return "not available";
  }

  return `${alpha.totalText} mm${alpha.updatedAt ? ` (updated ${alpha.updatedAt})` : ""}`;
}

function extractCurrentTotalLine(value: string | null): string | null {
  return value?.match(/^Current total:\s*(.+)$/m)?.[1] ?? value;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeAscii(value: string): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function padMonth(month: number): string {
  return String(month).padStart(2, "0");
}
