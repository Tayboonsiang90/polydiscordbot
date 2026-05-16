import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://kaito.ai/mindshare-arena/infomarkets";
const defaultPolymarketUrl = "https://polymarket.com/event/how-high-will-polymarkets-mindshare-go-by-june-30";

export type KaitoMindsharePoint = {
  date: string;
  mindsharePercent: number;
};

export function extractLatestKaitoPolymarketMindshareValue(data: unknown): string {
  const point = extractLatestKaitoPolymarketMindsharePoint(data);
  return [
    "Metric: Polymarket Kaito Info Markets mindshare",
    `Date: ${point.date}`,
    `Mindshare: ${formatPercent(point.mindsharePercent)}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function extractLatestKaitoPolymarketMindsharePoint(data: unknown): KaitoMindsharePoint {
  const points = extractRows(data)
    .map(parsePolymarketMindsharePoint)
    .filter((point): point is KaitoMindsharePoint => Boolean(point))
    .sort((left, right) => left.date.localeCompare(right.date));

  const latest = points.at(-1);
  if (!latest) {
    throw new Error("Could not find finalized Polymarket mindshare rows in Kaito data");
  }

  return latest;
}

export const kaitoMindshareAdapter: WebsiteAdapter = {
  id: "kaito-polymarket-mindshare",
  commandName: "kaitomindshare",
  displayName: "Kaito Polymarket Mindshare",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "kaitomindshare",
  alertRoleName: "Kaito Mindshare Alerts",
  alertRoleEmoji: "\uD83E\uDDE0",
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Fixed hourly check for finalized Kaito Polymarket mindshare values",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const apiUrl = process.env.KAITO_INFOMARKETS_API_URL;
    if (!apiUrl) {
      throw new Error(
        "Missing KAITO_INFOMARKETS_API_URL. The Kaito page is Cloudflare-protected for direct bot scraping; configure a JSON/API endpoint that returns Historical Data rows."
      );
    }

    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    };
    if (process.env.KAITO_API_KEY) {
      headers.authorization = `Bearer ${process.env.KAITO_API_KEY}`;
    }

    const response = await fetchWithTimeout(apiUrl, { headers });
    if (!response.ok) {
      throw new Error(`Kaito data endpoint returned HTTP ${response.status}`);
    }

    const value = extractLatestKaitoPolymarketMindshareValue(await response.json());
    return {
      value,
      rawValue: value,
      unit: "mindshare",
      observedAt: new Date()
    };
  }
};

function extractRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.flatMap(extractRows);
  }

  if (!isRecord(data)) {
    return [];
  }

  const candidates = [
    data.rows,
    data.data,
    data.items,
    data.results,
    data.result,
    isRecord(data.result) ? data.result.rows : undefined,
    isRecord(data.result) ? data.result.data : undefined,
    isRecord(data.payload) ? data.payload.rows : undefined,
    isRecord(data.payload) ? data.payload.data : undefined
  ];

  for (const candidate of candidates) {
    const rows = Array.isArray(candidate) ? candidate.filter(isRecord) : [];
    if (rows.length > 0) {
      return rows;
    }
  }

  return [data];
}

function parsePolymarketMindsharePoint(row: Record<string, unknown>): KaitoMindsharePoint | null {
  if (!isPolymarketRow(row)) {
    return null;
  }

  const dateEntry = Object.entries(row).find(([key, value]) => isDateKey(key) && parseDateValue(value));
  const mindshareEntry = Object.entries(row).find(
    ([key, value]) => isMindshareKey(key) && parseNumericValue(value) !== null
  );
  const finalizedEntry = Object.entries(row).find(([key]) => isFinalizedKey(key));

  const date = dateEntry ? parseDateValue(dateEntry[1]) : null;
  const mindshareValue = mindshareEntry ? parseNumericValue(mindshareEntry[1]) : null;
  const finalized = finalizedEntry ? parseFinalizedValue(finalizedEntry[1]) : true;

  if (!date || mindshareValue === null || !finalized) {
    return null;
  }

  return {
    date,
    mindsharePercent: normalizeMindsharePercent(mindshareValue)
  };
}

function isPolymarketRow(row: Record<string, unknown>): boolean {
  const identityEntries = Object.entries(row).filter(([key]) => isIdentityKey(key));
  if (identityEntries.length === 0) {
    return true;
  }

  return identityEntries.some(([, value]) => String(value).toLowerCase().includes("polymarket"));
}

function isIdentityKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return ["name", "project", "topic", "market", "ticker", "asset", "platform", "protocol"].includes(normalized);
}

function isDateKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return ["date", "day", "dt", "time", "timestamp", "createdat"].includes(normalized) || normalized.endsWith("date");
}

function isMindshareKey(key: string): boolean {
  return normalizeKey(key).includes("mindshare");
}

function isFinalizedKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return normalized === "finalized" || normalized === "isfinalized" || normalized === "status";
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

function parseNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/[%\s,]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

  return Number(normalized);
}

function parseFinalizedValue(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return ["final", "finalized", "true", "complete", "completed"].includes(value.trim().toLowerCase());
  }

  return Boolean(value);
}

function normalizeMindsharePercent(value: number): number {
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0
  }).format(value)}%`;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
