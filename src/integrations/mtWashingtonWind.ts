import { PDFParse } from "pdf-parse";
import { fetchWithTimeout } from "../http.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://mountwashington.org/weather/mount-washington-weather-archives/monthly-f6/";
const defaultPolymarketUrl = "https://polymarket.com/event/highest-mtpt-washington-wind-speed-in-july-20260626193609212";
const defaultYear = 2026;
const defaultMonth = 7;
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type MtWashingtonWindSettings = {
  year: number;
  month: number;
};

export type MtWashingtonWindDay = {
  day: number;
  averageSpeedMph: number;
  fastestSpeedMph: number;
  directionDegrees: string;
  directionLabel: string;
};

export type MtWashingtonWindReport = {
  year: number;
  month: number;
  monthName: string;
  dailyRows: MtWashingtonWindDay[];
  latestReportedDay: number | null;
  highestSpeedMph: number | null;
  highestDay: number | null;
  miscFastestSpeedMph: number | null;
  miscDirection: string | null;
};

export const mtWashingtonWindAdapter: WebsiteAdapter = {
  id: "mt-washington-wind",
  commandName: "mtwind",
  displayName: "Mt. Washington Wind Speed",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "mtwind",
  alertRoleName: "Mt Washington Wind Alerts",
  alertRoleEmoji: "\uD83D\uDCA8",
  defaultSettings: { year: defaultYear, month: defaultMonth },
  supportsPeriod: true,
  getPollIntervalMinutes: () => 5,
  getPollIntervalReason: () => "Fixed 5-minute check for Mt. Washington F6 PDF updates",
  shouldAlertOnChange: mtWashingtonWindShouldAlertOnChange,
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const settings = getMtWashingtonWindSettings(integration);
    const pdfUrl = buildMtWashingtonF6PdfUrl(settings);
    const response = await fetchWithTimeout(pdfUrl, {
      headers: {
        accept: "application/pdf,*/*",
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });
    const observedAt = new Date();
    const lastModified = response.headers.get("last-modified");

    if (response.status === 404) {
      const value = formatMtWashingtonWindUnavailableValue(settings, pdfUrl, "F6 PDF not published yet");
      return { value, rawValue: value, unit: "mph", observedAt };
    }
    if (!response.ok) {
      throw new Error(`Mt. Washington F6 PDF returned HTTP ${response.status}`);
    }

    const text = await extractPdfText(Buffer.from(await response.arrayBuffer()));
    const report = extractMtWashingtonWindReport(text, settings);
    const value = formatMtWashingtonWindValue(report, pdfUrl, lastModified);
    return {
      value,
      rawValue: extractHighestWindLine(value) ?? value,
      unit: "mph",
      observedAt
    };
  }
};

export function getMtWashingtonWindSettings(integration?: Integration): MtWashingtonWindSettings {
  const settings = parseSettingsJson(integration?.settingsJson);
  const year = Number(settings.year);
  const month = Number(settings.month);
  if (isValidPeriod(year, month)) {
    return { year, month };
  }

  return { year: defaultYear, month: defaultMonth };
}

export function buildMtWashingtonF6PdfUrl(settings: MtWashingtonWindSettings): string {
  return `https://mountwashington.org/uploads/pdf/forms/${settings.year}/${padMonth(settings.month)}.pdf`;
}

export function extractMtWashingtonWindReport(text: string, settings: MtWashingtonWindSettings): MtWashingtonWindReport {
  const normalizedText = normalizeText(text);
  const dailyRows = normalizedText
    .split(/\r?\n/)
    .map((line) => extractMtWashingtonWindDay(line))
    .filter((row): row is MtWashingtonWindDay => row !== null)
    .filter((row) => row.day >= 1 && row.day <= 31);
  const misc = extractMiscFastestWind(normalizedText);
  const highestDailyRow = dailyRows.reduce<MtWashingtonWindDay | null>(
    (highest, row) => (!highest || row.fastestSpeedMph > highest.fastestSpeedMph ? row : highest),
    null
  );
  const highestSpeedMph = Math.max(highestDailyRow?.fastestSpeedMph ?? -Infinity, misc?.speedMph ?? -Infinity);
  const hasHighest = Number.isFinite(highestSpeedMph);

  return {
    year: settings.year,
    month: settings.month,
    monthName: monthNames[settings.month - 1],
    dailyRows,
    latestReportedDay: dailyRows.at(-1)?.day ?? null,
    highestSpeedMph: hasHighest ? highestSpeedMph : null,
    highestDay: highestDailyRow && highestDailyRow.fastestSpeedMph === highestSpeedMph ? highestDailyRow.day : null,
    miscFastestSpeedMph: misc?.speedMph ?? null,
    miscDirection: misc?.direction ?? null
  };
}

export function extractMtWashingtonWindDay(line: string): MtWashingtonWindDay | null {
  const normalizedLine = normalizeText(line).trim();
  const dayMatch = normalizedLine.match(/^(\d{1,2})\s+/);
  const windMatch = normalizedLine.match(/\s(\d+(?:\.\d+)?)\s+(\d+)\s+(\d{3})\s*\(([A-Z]+)\)/);
  if (!dayMatch || !windMatch) {
    return null;
  }

  const day = Number(dayMatch[1]);
  const averageSpeedMph = Number(windMatch[1]);
  const fastestSpeedMph = Number(windMatch[2]);
  if (!Number.isInteger(day) || !Number.isFinite(averageSpeedMph) || !Number.isFinite(fastestSpeedMph)) {
    return null;
  }

  return {
    day,
    averageSpeedMph,
    fastestSpeedMph,
    directionDegrees: windMatch[3],
    directionLabel: windMatch[4]
  };
}

export function formatMtWashingtonWindValue(report: MtWashingtonWindReport, pdfUrl: string, lastModified: string | null): string {
  if (report.highestSpeedMph === null) {
    return formatMtWashingtonWindUnavailableValue(
      { year: report.year, month: report.month },
      pdfUrl,
      "F6 PDF published but no daily wind rows found"
    );
  }

  const latestDailyRow = report.dailyRows.at(-1) ?? null;
  const latestDayDate = report.latestReportedDay ? `${report.year}-${padMonth(report.month)}-${padMonth(report.latestReportedDay)}` : null;
  return [
    "Metric: Mt. Washington summit highest wind speed",
    `Period: ${report.year}-${padMonth(report.month)}`,
    `Highest wind speed: ${report.highestSpeedMph} mph`,
    `Highest day: ${report.highestDay ? `${report.year}-${padMonth(report.month)}-${padMonth(report.highestDay)}` : "monthly MISC row only"}`,
    `Latest reported day: ${latestDayDate ?? "none"}`,
    `Latest day wind speed: ${latestDailyRow ? `${latestDailyRow.fastestSpeedMph} mph on ${latestDayDate} (avg ${latestDailyRow.averageSpeedMph} mph, ${latestDailyRow.directionDegrees} (${latestDailyRow.directionLabel}))` : "none"}`,
    `Daily rows parsed: ${report.dailyRows.length}`,
    `Daily wind rows: ${formatMtWashingtonDailyWindRows(report)}`,
    `MISC fastest: ${report.miscFastestSpeedMph === null ? "not found" : `${report.miscFastestSpeedMph} mph${report.miscDirection ? ` ${report.miscDirection}` : ""}`}`,
    `F6 last modified: ${lastModified ?? "unknown"}`,
    "Column used: WIND (MPH) FASTEST MILE / peak gust",
    `F6 PDF: ${pdfUrl}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

function formatMtWashingtonDailyWindRows(report: MtWashingtonWindReport): string {
  return report.dailyRows.length
    ? report.dailyRows
        .map((row) => `${report.year}-${padMonth(report.month)}-${padMonth(row.day)}=${row.fastestSpeedMph}mph avg ${row.averageSpeedMph} ${row.directionDegrees}(${row.directionLabel})`)
        .join(" | ")
    : "none";
}

export function mtWashingtonWindShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  if (!previousValue) {
    return false;
  }

  return previousValue !== currentValue;
}

function formatMtWashingtonWindUnavailableValue(settings: MtWashingtonWindSettings, pdfUrl: string, reason: string): string {
  return [
    "Metric: Mt. Washington summit highest wind speed",
    `Period: ${settings.year}-${padMonth(settings.month)}`,
    "Highest wind speed: not published yet",
    `Status: ${reason}`,
    `F6 PDF: ${pdfUrl}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

function extractMiscFastestWind(text: string): { speedMph: number; direction: string | null } | null {
  const match = text.match(/MISC\.\s*->\s*(\d+)\s+(\d{3}\s*\([A-Z]+\))?/i);
  if (!match) {
    return null;
  }

  const speedMph = Number(match[1]);
  return Number.isFinite(speedMph) ? { speedMph, direction: match[2]?.replace(/\s+/g, " ").trim() ?? null } : null;
}

async function extractPdfText(data: Buffer): Promise<string> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

function extractHighestWindLine(value: string): string | null {
  return value.match(/^Highest wind speed:\s*(.+)$/m)?.[1] ?? null;
}

function isValidPeriod(year: number, month: number): boolean {
  return Number.isInteger(year) && year >= 2005 && year <= 2100 && Number.isInteger(month) && month >= 1 && month <= 12;
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\t/g, " ");
}

function padMonth(value: number): string {
  return String(value).padStart(2, "0");
}
