import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

export const ornnSourceUrl = "https://dashboard.ornnai.com";
const apiBaseUrl = "https://ornn-backend-api-135941626504.us-central1.run.app/api/gpu";

export type OrnnGpuIndexPoint = {
  date: string;
  indexValue: number;
  publishedAt: string;
};

export type OrnnGpuFinalizedPoint = OrnnGpuIndexPoint & {
  finalizedByDate: string;
};

export type OrnnGpuIndexConfig = {
  gpuName: string;
  displayName: string;
  id: string;
  commandName: string;
  defaultPolymarketUrl: string;
  defaultChannelName: string;
  alertRoleName: string;
};

export function createOrnnGpuIndexAdapter(config: OrnnGpuIndexConfig): WebsiteAdapter {
  return {
    id: config.id,
    commandName: config.commandName,
    displayName: config.displayName,
    sourceUrl: ornnSourceUrl,
    defaultPolymarketUrl: config.defaultPolymarketUrl,
    defaultChannelName: config.defaultChannelName,
    alertRoleName: config.alertRoleName,
    alertRoleEmoji: "\uD83D\uDDA5\uFE0F",
    async fetchCurrentValue(): Promise<AdapterValue> {
      const response = await fetchWithTimeout(buildOrnnGpuApiUrl(config.gpuName), {
        headers: {
          accept: "application/json",
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
        }
      });

      if (!response.ok) {
        throw new Error(`ORNN ${config.gpuName} index endpoint returned HTTP ${response.status}`);
      }

      const value = extractLatestFinalizedOrnnGpuValue(await response.json(), config.gpuName);
      return {
        value,
        rawValue: value,
        unit: `${config.gpuName} index`,
        observedAt: new Date()
      };
    }
  };
}

export function buildOrnnGpuApiUrl(gpuName: string): string {
  return `${apiBaseUrl}/${encodeURIComponent(gpuName)}/index-history`;
}

export function extractLatestFinalizedOrnnGpuValue(data: unknown, gpuName: string): string {
  const point = extractLatestFinalizedOrnnGpuPoint(data);
  return [
    `Metric: ORNN ${gpuName} Index`,
    `Date: ${point.date}`,
    `Index Value: ${formatIndexValue(point.indexValue)}`,
    `Finalized by: ${point.finalizedByDate}`,
    `Published at: ${point.publishedAt}`,
    `Resolution: ${ornnSourceUrl}`
  ].join("\n");
}

export function extractLatestFinalizedOrnnGpuPoint(data: unknown): OrnnGpuFinalizedPoint {
  const points = extractOrnnGpuPoints(data).sort((left, right) => left.publishedAt.localeCompare(right.publishedAt));
  if (points.length < 2) {
    throw new Error("Could not find enough ORNN index points to identify a finalized daily value");
  }

  const finalizedPoint = points.at(-2);
  const followingPoint = points.at(-1);
  if (!finalizedPoint || !followingPoint) {
    throw new Error("Could not find the latest finalized ORNN index point");
  }

  return {
    ...finalizedPoint,
    finalizedByDate: followingPoint.date
  };
}

export function extractOrnnGpuPoints(data: unknown): OrnnGpuIndexPoint[] {
  if (!isRecord(data)) {
    return [];
  }

  const rows = Array.isArray(data.data) ? data.data.filter(isRecord) : [];
  return rows
    .map(parseOrnnGpuPoint)
    .filter((point): point is OrnnGpuIndexPoint => Boolean(point));
}

function parseOrnnGpuPoint(row: Record<string, unknown>): OrnnGpuIndexPoint | null {
  const timestamp = typeof row.timestamp === "string" ? row.timestamp : null;
  const indexValue = parseNumber(row.index_value);
  if (!timestamp || indexValue === null) {
    return null;
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return {
    date: parsed.toISOString().slice(0, 10),
    indexValue,
    publishedAt: parsed.toISOString()
  };
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/[,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

  return Number(normalized);
}

function formatIndexValue(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0
  }).format(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
