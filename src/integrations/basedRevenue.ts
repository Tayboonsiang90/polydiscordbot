import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://dune.com/datadashboards/based-statistics";
const queryUrl = "https://dune.com/queries/6807696";
const queryResultsUrl = "https://api.dune.com/api/v1/query/6807696/results";

export type BasedRevenuePoint = {
  date: string;
  cumulativeRevenue: number;
};

export function extractLatestBasedRevenueValue(data: unknown): string {
  const point = extractLatestBasedRevenuePoint(data);
  return [
    "Metric: Based cumulative revenue",
    `Date: ${point.date}`,
    `Cumulative Revenue: ${formatCurrency(point.cumulativeRevenue)}`,
    `Query: ${queryUrl}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function extractLatestBasedRevenuePoint(data: unknown): BasedRevenuePoint {
  const rows = extractDuneRows(data);
  const points = rows
    .map(parseBasedRevenuePoint)
    .filter((point): point is BasedRevenuePoint => Boolean(point))
    .sort((left, right) => left.date.localeCompare(right.date));

  const latest = points.at(-1);
  if (!latest) {
    throw new Error("Could not find Based cumulative revenue rows in Dune response");
  }

  return latest;
}

export const basedRevenueAdapter: WebsiteAdapter = {
  id: "based-revenue",
  commandName: "basedrevenue",
  displayName: "Based Revenue",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/what-will-based-prediction-market-revenue-hit-before-2027",
  defaultChannelName: "basedrevenue",
  alertRoleName: "Based Revenue Alerts",
  alertRoleEmoji: "\uD83D\uDCB5",
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Fixed hourly check for Dune Based cumulative revenue updates",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const apiKey = process.env.DUNE_API_KEY;
    if (!apiKey) {
      throw new Error("Missing DUNE_API_KEY. Create a Dune API key and add it to .env to monitor Based revenue.");
    }

    const response = await fetchWithTimeout(queryResultsUrl, {
      headers: {
        "x-dune-api-key": apiKey,
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Dune returned HTTP ${response.status}`);
    }

    const value = extractLatestBasedRevenueValue(await response.json());
    return {
      value,
      rawValue: value,
      unit: "cumulative revenue",
      observedAt: new Date()
    };
  }
};

function extractDuneRows(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") {
    return [];
  }

  const candidate = data as {
    result?: { rows?: unknown };
    rows?: unknown;
  };
  const rows = candidate.result?.rows ?? candidate.rows;
  return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

function parseBasedRevenuePoint(row: Record<string, unknown>): BasedRevenuePoint | null {
  const dateEntry = Object.entries(row).find(([key, value]) => isDateKey(key) && parseDateValue(value));
  const revenueEntry = Object.entries(row).find(([key, value]) => isCumulativeRevenueKey(key) && parseNumberValue(value) !== null);
  const date = dateEntry ? parseDateValue(dateEntry[1]) : null;
  const cumulativeRevenue = revenueEntry ? parseNumberValue(revenueEntry[1]) : null;

  return date && cumulativeRevenue !== null ? { date, cumulativeRevenue } : null;
}

function isDateKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
  return ["day", "date", "dt", "time", "blockdate"].includes(normalized) || normalized.endsWith("date");
}

function isCumulativeRevenueKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
  return normalized.includes("cumulative") && normalized.includes("revenue");
}

function parseDateValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function parseNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

  return Number(normalized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}
