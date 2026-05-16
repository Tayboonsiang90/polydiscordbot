import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.cdc.gov/nchs/nvss/vsrr/natality-dashboard.htm";
const csvUrl = "https://www.cdc.gov/nchs/nvss/vsrr/natality-dashboard.csv";
const targetQuarter = "2026 Q1";

export type CdcNatalityRow = {
  yearQuarter: string;
  topicSubgroup: string;
  indicator: string;
  group: string;
  rate: string;
  unit: string;
  significant: string;
};

export function extractCdcFertilityRateValue(csv: string, html: string): string {
  const rows = parseCdcNatalityRows(csv);
  const target = rows.find(isTargetGeneralFertilityRate);
  const latest = rows.filter(isGeneralFertilityRate).sort((left, right) => right.yearQuarter.localeCompare(left.yearQuarter))[0];
  const pageUpdated = extractCdcPageUpdatedAt(html) ?? "unknown";

  if (target) {
    return formatCdcFertilityRate(target, pageUpdated);
  }

  return [
    "Metric: General fertility rate",
    `Period: ${targetQuarter}`,
    "Value: not published yet",
    `Latest available: ${latest ? `${latest.yearQuarter} = ${latest.rate} ${latest.unit}` : "none"}`,
    `CDC page updated: ${pageUpdated}`
  ].join("\n");
}

export function parseCdcNatalityRows(csv: string): CdcNatalityRow[] {
  const [headerLine, ...dataLines] = csv.split(/\r?\n/).filter((line) => line.trim());
  if (!headerLine) {
    return [];
  }

  const headers = parseCsvLine(headerLine);
  return dataLines
    .map(parseCsvLine)
    .map((columns) => Object.fromEntries(headers.map((header, index) => [header, columns[index] ?? ""])))
    .map((row) => ({
      yearQuarter: row["Year Quarter"] ?? "",
      topicSubgroup: row["Topic Subgroup"] ?? "",
      indicator: row["Indicator"] ?? "",
      group: row["Group"] ?? "",
      rate: row["Rate"] ?? "",
      unit: row["Unit"] ?? "",
      significant: row["Significant"]?.trim() ?? ""
    }))
    .filter((row) => row.yearQuarter && row.topicSubgroup && row.indicator && row.group);
}

export function extractCdcPageUpdatedAt(html: string): string | null {
  const $ = cheerio.load(html);
  return (
    $("meta[property='cdc:last_updated']").attr("content") ??
    $("meta[name='DC.date']").attr("content") ??
    $("meta[name='cdc:last_published']").attr("content") ??
    null
  );
}

export function getCdcFertilityPollIntervalMinutes(): number {
  return 60;
}

export function getCdcFertilityPollIntervalReason(): string {
  return "CDC quarterly dashboard watch: hourly polling";
}

export const cdcFertilityRateAdapter: WebsiteAdapter = {
  id: "cdc-fertility-rate",
  commandName: "fertility",
  displayName: "CDC General Fertility Rate",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/us-fertility-rate-up-in-q1-2026",
  defaultChannelName: "fertility",
  alertRoleName: "CDC Fertility Alerts",
  alertRoleEmoji: "\uD83D\uDC76",
  getPollIntervalMinutes: getCdcFertilityPollIntervalMinutes,
  getPollIntervalReason: getCdcFertilityPollIntervalReason,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const [csvResponse, pageResponse] = await Promise.all([
      fetchWithTimeout(csvUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
        }
      }),
      fetchWithTimeout(sourceUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
        }
      })
    ]);

    if (!csvResponse.ok) {
      throw new Error(`CDC natality CSV returned HTTP ${csvResponse.status}`);
    }

    if (!pageResponse.ok) {
      throw new Error(`CDC natality page returned HTTP ${pageResponse.status}`);
    }

    const value = extractCdcFertilityRateValue(await csvResponse.text(), await pageResponse.text());
    return {
      value,
      rawValue: value,
      unit: "births per 1,000 population",
      observedAt: new Date()
    };
  }
};

function formatCdcFertilityRate(row: CdcNatalityRow, pageUpdated: string): string {
  return [
    "Metric: General fertility rate",
    `Period: ${row.yearQuarter}`,
    `Value: ${row.rate} ${row.unit}`,
    `Indicator: ${row.indicator}`,
    `Group: ${row.group}`,
    `Significant: ${row.significant || "not marked"}`,
    `CDC page updated: ${pageUpdated}`
  ].join("\n");
}

function isTargetGeneralFertilityRate(row: CdcNatalityRow): boolean {
  return row.yearQuarter === targetQuarter && isGeneralFertilityRate(row);
}

function isGeneralFertilityRate(row: CdcNatalityRow): boolean {
  return (
    row.topicSubgroup === "General Fertility Rates" &&
    row.indicator === "15-44 years" &&
    row.group === "All races and origins" &&
    row.rate !== ""
  );
}

function parseCsvLine(line: string): string[] {
  const columns: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === "\"" && nextChar === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      columns.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  columns.push(current.trim());
  return columns;
}
