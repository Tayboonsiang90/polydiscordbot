import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://app.parcllabs.com/prediction-market-resolutions/42";
const apiStartDate = "2026-05-01";
const targetDate = "2026-06-30";
const fallbackDeadline = new Date("2026-07-11T03:59:00.000Z");
const parclId = 5_372_594;
const medianHomeSizeSqft = 1_000;
const easternTimeZone = "America/New_York";

export type ParclNycPriceFeedRow = {
  date: string;
  pricePerSqft: number;
};

export const parclNycHomeValueAdapter: WebsiteAdapter = {
  id: "parcl-nyc-home-value",
  commandName: "nychomevalue",
  displayName: "Parcl NYC Home Value",
  sourceUrl,
  defaultPolymarketUrl:
    "https://polymarket.com/event/what-will-the-median-home-value-in-new-york-city-be-on-june-30-20260602003325294",
  defaultChannelName: "nychomevalue",
  alertRoleName: "NYC Home Value Alerts",
  alertRoleEmoji: "\uD83C\uDFD9\uFE0F",
  getPollIntervalMinutes: getParclNycHomeValuePollIntervalMinutes,
  getPollIntervalReason: getParclNycHomeValuePollIntervalReason,
  shouldAlertOnChange: parclNycHomeValueShouldAlertOnChange,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const rows = await fetchParclNycHomeValueRows();
    const value = extractParclNycHomeValue(rows, new Date());
    return {
      value,
      rawValue: extractRawHomeValue(value) ?? value,
      unit: "USD median home value",
      observedAt: new Date()
    };
  }
};

export function extractParclNycHomeValue(rows: ParclNycPriceFeedRow[], now: Date): string {
  const sortedRows = [...rows].sort((left, right) => left.date.localeCompare(right.date));
  const target = sortedRows.find((row) => row.date === targetDate) ?? null;
  const latest = sortedRows.at(-1) ?? null;
  const fallbackActive = !target && now.getTime() > fallbackDeadline.getTime();

  if (target) {
    return [
      "Metric: Parcl Labs Sales Price Index",
      "Market: New York City, New York",
      `Parcl ID: ${parclId}`,
      `Target date: ${targetDate}`,
      "Target date status: published",
      `Price index: ${formatPricePerSqft(target.pricePerSqft)}`,
      `Median home size: ${formatInteger(medianHomeSizeSqft)} sqft`,
      `Settlement home value: ${formatHomeValue(calculateHomeValue(target.pricePerSqft))}`,
      `Latest available: ${formatRow(latest)}`,
      "Fallback status: not needed",
      `Resolution: ${sourceUrl}`
    ].join("\n");
  }

  return [
    "Metric: Parcl Labs Sales Price Index",
    "Market: New York City, New York",
    `Parcl ID: ${parclId}`,
    `Target date: ${targetDate}`,
    "Target date status: not published yet",
    "Price index: not published yet",
    `Median home size: ${formatInteger(medianHomeSizeSqft)} sqft`,
    "Settlement home value: not published yet",
    `Latest available: ${formatRow(latest)}`,
    `Fallback status: ${
      fallbackActive
        ? "active; use latest available data if 2026-06-30 remains unavailable"
        : "waiting until 2026-07-10 23:59 ET"
    }`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function extractParclNycPriceFeedRows(payload: unknown): ParclNycPriceFeedRow[] {
  const items = isRecord(payload) && Array.isArray(payload.items) ? payload.items : [];
  return items
    .filter(isRecord)
    .map((item) => {
      const date = typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : null;
      const pricePerSqft = parseNumber(item.price_feed);
      return date && pricePerSqft !== null ? { date, pricePerSqft } : null;
    })
    .filter((row): row is ParclNycPriceFeedRow => row !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function getParclNycHomeValuePollIntervalMinutes(integration: Integration, now: Date = new Date()): number {
  if (integration.lastValue?.includes("Target date status: published")) {
    return 1_440;
  }

  const easternDate = getEasternDate(now);
  if (easternDate < targetDate) {
    return 1_440;
  }

  return now.getTime() <= fallbackDeadline.getTime() ? 1 : 60;
}

export function getParclNycHomeValuePollIntervalReason(integration: Integration, now: Date = new Date()): string {
  if (integration.lastValue?.includes("Target date status: published")) {
    return "Parcl target date already published; daily verification only";
  }

  const easternDate = getEasternDate(now);
  if (easternDate < targetDate) {
    return "Parcl normal mode before June 30, 2026 ET; daily check only";
  }

  return now.getTime() <= fallbackDeadline.getTime()
    ? "Parcl release watch from June 30 through July 10 ET"
    : "Parcl fallback window passed; hourly check for late/revised data";
}

export function parclNycHomeValueShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  const targetPublishedNow = currentValue.includes("Target date status: published");
  const targetPublishedBefore = previousValue?.includes("Target date status: published") ?? false;
  if (targetPublishedNow && !targetPublishedBefore) {
    return true;
  }

  const fallbackActiveNow = currentValue.includes("Fallback status: active");
  const fallbackActiveBefore = previousValue?.includes("Fallback status: active") ?? false;
  return fallbackActiveNow && !fallbackActiveBefore;
}

export function buildParclNycHomeValueApiUrl(): string {
  const url = new URL("https://app.parcllabs.com/api/price-feed");
  url.searchParams.set("parclId", parclId.toString());
  url.searchParams.set("startDate", apiStartDate);
  url.searchParams.set("endDate", targetDate);
  url.searchParams.set("limit", "1000");
  return url.toString();
}

async function fetchParclNycHomeValueRows(): Promise<ParclNycPriceFeedRow[]> {
  const response = await fetchWithTimeout(buildParclNycHomeValueApiUrl(), {
    headers: {
      accept: "application/json",
      referer: sourceUrl,
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Parcl price feed returned HTTP ${response.status}: ${text.slice(0, 160)}`);
  }

  const rows = extractParclNycPriceFeedRows(JSON.parse(text) as unknown);
  if (rows.length === 0) {
    throw new Error("Could not find Parcl NYC price-feed rows");
  }

  return rows;
}

function calculateHomeValue(pricePerSqft: number): number {
  return pricePerSqft * medianHomeSizeSqft;
}

function formatRow(row: ParclNycPriceFeedRow | null): string {
  return row
    ? `${row.date} = ${formatPricePerSqft(row.pricePerSqft)}; ${formatHomeValue(calculateHomeValue(row.pricePerSqft))}`
    : "none";
}

function formatPricePerSqft(value: number): string {
  return `${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  }).format(value)} per sqft`;
}

function formatHomeValue(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function extractRawHomeValue(value: string): string | null {
  return value.match(/^Settlement home value:\s*(.+)$/m)?.[1] ?? value.match(/^Latest available:\s*(.+)$/m)?.[1] ?? null;
}

function getEasternDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: easternTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
