import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://nsidc.org/sea-ice-today/sea-ice-tools";
const dataUrl = "https://noaadata.apps.nsidc.org/NOAA/G02135/north/daily/data/N_seaice_extent_daily_v4.0.csv";
const defaultPolymarketUrl = "https://polymarket.com/event/min-arctic-sea-ice-extent-this-summer";
const windowStart = "2026-08-01";
const windowEnd = "2026-10-01";
const expectedWindowDays = 62;

export type NsidcSeaIceDailyRow = {
  date: string;
  extentMillionSqKm: number;
  missingMillionSqKm: number;
};

export type NsidcSeaIceReport = {
  windowStart: string;
  windowEnd: string;
  rows: NsidcSeaIceDailyRow[];
  windowRows: NsidcSeaIceDailyRow[];
  minimumRow: NsidcSeaIceDailyRow | null;
  latestWindowRow: NsidcSeaIceDailyRow | null;
  latestDatasetRow: NsidcSeaIceDailyRow | null;
};

export const nsidcArcticSeaIceAdapter: WebsiteAdapter = {
  id: "nsidc-arctic-sea-ice",
  commandName: "arcticice",
  displayName: "NSIDC Arctic Sea Ice",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "arcticice",
  alertRoleName: "Arctic Sea Ice Alerts",
  alertRoleEmoji: "\uD83E\uDDCA",
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Hourly check for NSIDC daily Sea Ice Index updates",
  shouldAlertOnChange: nsidcArcticSeaIceShouldAlertOnChange,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(dataUrl, {
      headers: {
        accept: "text/csv,*/*",
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });
    if (!response.ok) {
      throw new Error(`NSIDC daily extent CSV returned HTTP ${response.status}`);
    }

    const report = buildNsidcArcticSeaIceReport(await response.text());
    const value = formatNsidcArcticSeaIceValue(report);
    return {
      value,
      rawValue: report.minimumRow ? `${report.minimumRow.extentMillionSqKm.toFixed(3)} million sq km` : value,
      unit: "million sq km",
      observedAt: new Date()
    };
  }
};

export function parseNsidcSeaIceDailyExtentCsv(csv: string): NsidcSeaIceDailyRow[] {
  return csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const parts = line.split(",");
      if (parts.length < 5 || !/^\d{4}$/.test(parts[0].trim())) {
        return [];
      }

      const year = Number(parts[0].trim());
      const month = Number(parts[1].trim());
      const day = Number(parts[2].trim());
      const extentMillionSqKm = Number(parts[3].trim());
      const missingMillionSqKm = Number(parts[4].trim());
      if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day) ||
        !Number.isFinite(extentMillionSqKm) ||
        !Number.isFinite(missingMillionSqKm)
      ) {
        return [];
      }

      return [
        {
          date: `${year}-${pad2(month)}-${pad2(day)}`,
          extentMillionSqKm,
          missingMillionSqKm
        }
      ];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function buildNsidcArcticSeaIceReport(csv: string): NsidcSeaIceReport {
  const rows = parseNsidcSeaIceDailyExtentCsv(csv);
  const windowRows = rows.filter((row) => row.date >= windowStart && row.date <= windowEnd);
  const minimumRow = windowRows.reduce<NsidcSeaIceDailyRow | null>(
    (minimum, row) => (!minimum || row.extentMillionSqKm < minimum.extentMillionSqKm ? row : minimum),
    null
  );

  return {
    windowStart,
    windowEnd,
    rows,
    windowRows,
    minimumRow,
    latestWindowRow: windowRows.at(-1) ?? null,
    latestDatasetRow: rows.at(-1) ?? null
  };
}

export function formatNsidcArcticSeaIceValue(report: NsidcSeaIceReport): string {
  const status =
    report.windowRows.length === 0
      ? "waiting for Aug 1-Oct 1 window data"
      : report.windowRows.length >= expectedWindowDays || report.latestWindowRow?.date === windowEnd
        ? "complete through Oct 1"
        : "in progress";

  return [
    "Metric: NSIDC Arctic sea ice minimum extent",
    `Window: ${report.windowStart} to ${report.windowEnd}`,
    `Current minimum: ${report.minimumRow ? `${formatExtent(report.minimumRow.extentMillionSqKm)} million sq km on ${report.minimumRow.date}` : "not published yet"}`,
    `Latest window day: ${report.latestWindowRow ? `${report.latestWindowRow.date} — ${formatExtent(report.latestWindowRow.extentMillionSqKm)} million sq km` : "none"}`,
    `Reported window days: ${report.windowRows.length}/${expectedWindowDays}`,
    `Latest dataset date: ${report.latestDatasetRow?.date ?? "none"}`,
    `Latest dataset extent: ${report.latestDatasetRow ? `${formatExtent(report.latestDatasetRow.extentMillionSqKm)} million sq km` : "none"}`,
    `Data status: ${status}`,
    `Resolution: ${sourceUrl}`,
    `CSV: ${dataUrl}`
  ].join("\n");
}

export function nsidcArcticSeaIceShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  if (!previousValue || previousValue === currentValue) {
    return false;
  }

  return getReportedWindowDays(previousValue) > 0 || getReportedWindowDays(currentValue) > 0;
}

function getReportedWindowDays(value: string): number {
  const match = value.match(/^Reported window days:\s*(\d+)\//m);
  return match ? Number(match[1]) : 0;
}

function formatExtent(value: number): string {
  return value.toFixed(3);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
