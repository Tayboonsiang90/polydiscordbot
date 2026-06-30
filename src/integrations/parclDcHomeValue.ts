import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://app.parcllabs.com/prediction-market-resolutions/45";
const apiUrl = "https://api-app-service.parcllabs.com/v1/price-feeds/history";
const targetDate = "2026-06-30";
const fallbackDeadline = new Date("2026-07-11T03:59:00.000Z");
const parclId = 2_900_475;
const medianHomeSizeSqft = 1_800;
const easternTimeZone = "America/New_York";

export type ParclPriceFeedRow = {
  date: string;
  pricePerSqft: number;
};

export const parclDcHomeValueAdapter: WebsiteAdapter = {
  id: "parcl-dc-home-value",
  commandName: "dchomevalue",
  displayName: "Parcl DC Metro Home Value",
  sourceUrl,
  defaultPolymarketUrl:
    "https://polymarket.com/event/what-will-the-median-home-value-in-the-dc-metro-area-be-on-june-30-20260602001432202",
  defaultChannelName: "dchomevalue",
  alertRoleName: "DC Home Value Alerts",
  alertRoleEmoji: "\uD83C\uDFE0",
  getPollIntervalMinutes: getParclDcHomeValuePollIntervalMinutes,
  getPollIntervalReason: getParclDcHomeValuePollIntervalReason,
  shouldAlertOnChange: parclDcHomeValueShouldAlertOnChange,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const rows = await fetchParclDcHomeValueRows();
    const value = extractParclDcHomeValue(rows, new Date());
    return {
      value,
      rawValue: extractRawHomeValue(value) ?? value,
      unit: "USD median home value",
      observedAt: new Date()
    };
  }
};

export function extractParclDcHomeValue(rows: ParclPriceFeedRow[], now: Date): string {
  const sortedRows = [...rows].sort((left, right) => left.date.localeCompare(right.date));
  const target = sortedRows.find((row) => row.date === targetDate) ?? null;
  const latest = sortedRows.at(-1) ?? null;
  const fallbackActive = !target && now.getTime() > fallbackDeadline.getTime();

  if (target) {
    return [
      "Metric: Parcl Labs Sales Price Index",
      "Market: Washington, D.C. Metro",
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
    "Market: Washington, D.C. Metro",
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

export function extractParclPriceFeedRows(payload: unknown): ParclPriceFeedRow[] {
  const series = isRecord(payload) && isRecord(payload.series) ? payload.series[String(parclId)] : null;
  const items =
    isRecord(series) && Array.isArray(series.data)
      ? series.data
      : isRecord(payload) && Array.isArray(payload.items)
        ? payload.items
        : [];
  return items
    .filter(isRecord)
    .map((item) => {
      const date = typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : null;
      const pricePerSqft = parseNumber(item.value ?? item.price_feed);
      return date && pricePerSqft !== null ? { date, pricePerSqft } : null;
    })
    .filter((row): row is ParclPriceFeedRow => row !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function getParclDcHomeValuePollIntervalMinutes(integration: Integration, now: Date = new Date()): number {
  if (integration.lastValue?.includes("Target date status: published")) {
    return 1_440;
  }

  const easternDate = getEasternDate(now);
  if (easternDate < targetDate) {
    return 1_440;
  }

  return now.getTime() <= fallbackDeadline.getTime() ? 1 : 60;
}

export function getParclDcHomeValuePollIntervalReason(integration: Integration, now: Date = new Date()): string {
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

export function parclDcHomeValueShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  const targetPublishedNow = currentValue.includes("Target date status: published");
  const targetPublishedBefore = previousValue?.includes("Target date status: published") ?? false;
  if (targetPublishedNow && !targetPublishedBefore) {
    return true;
  }

  const fallbackActiveNow = currentValue.includes("Fallback status: active");
  const fallbackActiveBefore = previousValue?.includes("Fallback status: active") ?? false;
  return fallbackActiveNow && !fallbackActiveBefore;
}

export function buildParclDcHomeValueApiUrl(): string {
  return apiUrl;
}

async function fetchParclDcHomeValueRows(): Promise<ParclPriceFeedRow[]> {
  const response = await fetchWithTimeout(buildParclDcHomeValueApiUrl(), {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      origin: "https://app.parcllabs.com",
      referer: sourceUrl,
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    },
    body: JSON.stringify({ parcl_ids: [parclId] })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Parcl price feed returned HTTP ${response.status}: ${text.slice(0, 160)}`);
  }

  const rows = extractParclPriceFeedRows(JSON.parse(text) as unknown);
  if (rows.length === 0) {
    throw new Error("Could not find Parcl DC Metro price-feed rows");
  }

  return rows;
}

function calculateHomeValue(pricePerSqft: number): number {
  return pricePerSqft * medianHomeSizeSqft;
}

function formatRow(row: ParclPriceFeedRow | null): string {
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
