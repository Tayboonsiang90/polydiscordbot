import { Buffer } from "node:buffer";
import { unzipSync } from "node:zlib";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://app.rwa.xyz/";
const apiUrl = "https://app.rwa.xyz/api/trpc/tokenTimeseries.queryTimeseries";
const defaultPolymarketUrl =
  "https://polymarket.com/event/will-rwas-hit-50b-by-december-31/will-rwas-hit-50b-by-december-31-2026";
const userAgent = "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1";

const query = {
  sort: { direction: "desc", field: "date" },
  pagination: { page: 1, perPage: 100 },
  aggregate: { groupBy: "asset_class", aggregateFunction: "sum", interval: "day", groupLimit: 50 },
  filter: {
    operator: "and",
    filters: [
      { operator: "equals", field: "measure_slug", value: "bridged_token_value_dollar" },
      { field: "asset_class_id", operator: "notEquals", value: 26 },
      { operator: "equals", field: "tokenization_type_id", value: 3 },
      { operator: "notEquals", field: "asset_class_id", value: 28 }
    ]
  }
};

export type RwaTotalValuePoint = {
  date: string;
  totalValue: number;
  groups: RwaTotalValueGroup[];
};

export type RwaTotalValueGroup = {
  name: string;
  value: number;
};

export const rwaTotalValueAdapter: WebsiteAdapter = {
  id: "rwa-total-value",
  commandName: "rwatotal",
  displayName: "RWA.xyz Total RWA Value",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "rwatotal",
  alertRoleName: "RWA Total Value Alerts",
  alertRoleEmoji: "\uD83C\uDFE6",
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Fixed hourly check for RWA.xyz Total RWA Value chart updates",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const point = extractLatestRwaTotalValuePoint(await fetchRwaTimeseries());
    const value = formatRwaTotalValue(point);
    return {
      value,
      rawValue: `${point.date}:${point.totalValue.toFixed(2)}`,
      unit: "total RWA value",
      observedAt: new Date()
    };
  }
};

export function extractLatestRwaTotalValuePoint(data: unknown): RwaTotalValuePoint {
  const decoded = decodeRwaApiResponse(data);
  const series = extractSeries(decoded);
  const valueByDate = new Map<string, Map<string, number>>();

  for (const item of series) {
    const groupName = extractGroupName(item.group);
    for (const [date, value] of extractPoints(item.points)) {
      const groups = valueByDate.get(date) ?? new Map<string, number>();
      groups.set(groupName, (groups.get(groupName) ?? 0) + value);
      valueByDate.set(date, groups);
    }
  }

  const latestDate = [...valueByDate.keys()].sort().at(-1);
  if (!latestDate) {
    throw new Error("Could not find RWA.xyz Total RWA Value chart points");
  }

  const groups = [...(valueByDate.get(latestDate)?.entries() ?? [])]
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value);
  const totalValue = groups.reduce((sum, group) => sum + group.value, 0);
  if (!Number.isFinite(totalValue) || totalValue <= 0) {
    throw new Error("RWA.xyz Total RWA Value chart returned an invalid latest total");
  }

  return { date: latestDate, totalValue, groups };
}

export function formatRwaTotalValue(point: RwaTotalValuePoint): string {
  return [
    "Metric: RWA.xyz Total RWA Value",
    `Chart date: ${point.date}`,
    `Total RWA Value: ${formatCompactCurrency(point.totalValue)} (${formatCurrency(point.totalValue)})`,
    "Chart mode: Distributed assets, excluding stablecoins and cryptocurrency",
    `Top categories: ${formatTopGroups(point.groups)}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function decodeRwaCompressedPayload(value: string): unknown {
  if (value.length <= 45) {
    throw new Error("RWA.xyz API payload was too short to decode");
  }

  const encodedPayload = value.substring(20).slice(0, -25);
  const compressed = Buffer.from(encodedPayload, "base64");
  const decompressed = unzipSync(compressed);
  const json = Buffer.from(decompressed).reverse().toString("utf8");
  return JSON.parse(json) as unknown;
}

async function fetchRwaTimeseries(): Promise<unknown> {
  const url = `${apiUrl}?input=${encodeURIComponent(JSON.stringify({ query }))}`;
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: "application/json",
      origin: "https://app.rwa.xyz",
      referer: sourceUrl,
      "user-agent": userAgent
    }
  });

  if (!response.ok) {
    throw new Error(`RWA.xyz API returned HTTP ${response.status}`);
  }

  return response.json() as Promise<unknown>;
}

function decodeRwaApiResponse(data: unknown): unknown {
  const payload = extractCompressedPayload(data);
  return payload ? decodeRwaCompressedPayload(payload) : data;
}

function extractCompressedPayload(data: unknown): string | null {
  if (!isRecord(data)) {
    return null;
  }

  const result = isRecord(data.result) ? data.result : null;
  const resultData = result?.data;
  if (typeof resultData === "string") {
    return resultData;
  }

  return typeof data.data === "string" ? data.data : null;
}

function extractSeries(data: unknown): Array<{ group: unknown; points: unknown }> {
  const results = isRecord(data) ? data.results : null;
  if (!Array.isArray(results)) {
    return [];
  }

  return results.filter(isRecord).map((result) => ({
    group: result.group,
    points: result.points
  }));
}

function extractPoints(points: unknown): Array<[string, number]> {
  if (!Array.isArray(points)) {
    return [];
  }

  return points.flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) {
      return [];
    }

    const date = typeof point[0] === "string" ? point[0] : null;
    const value = typeof point[1] === "number" ? point[1] : Number(point[1]);
    return date && Number.isFinite(value) ? [[date, value] as [string, number]] : [];
  });
}

function extractGroupName(group: unknown): string {
  if (!isRecord(group)) {
    return "Unknown";
  }

  return typeof group.name === "string" && group.name.trim().length > 0 ? group.name.trim() : "Unknown";
}

function formatTopGroups(groups: RwaTotalValueGroup[]): string {
  if (groups.length === 0) {
    return "none";
  }

  return groups
    .slice(0, 5)
    .map((group) => `${group.name} ${formatCompactCurrency(group.value)}`)
    .join("; ");
}

function formatCompactCurrency(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `$${formatDecimal(value / 1_000_000_000, 2)}B`;
  }

  if (absolute >= 1_000_000) {
    return `$${formatDecimal(value / 1_000_000, 2)}M`;
  }

  return formatCurrency(value);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

function formatDecimal(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
