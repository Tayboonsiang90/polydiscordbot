import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import {
  refreshGammaPolymarketQueue,
  upsertGammaPolymarketQueueUrl,
  type GammaPolymarketDiscoveryConfig
} from "./gammaPolymarketDiscovery.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://app.parcllabs.com/prediction-market-resolutions/50";
const apiUrl = "https://api-app-service.parcllabs.com/v1/price-feeds/history";
const defaultPolymarketUrl =
  "https://polymarket.com/event/what-will-the-median-home-value-in-new-york-city-be-on-september-30-20260630180215064";
const parclId = 5_372_594;
const medianHomeSizeSqft = 1_000;
const easternTimeZone = "America/New_York";
const discoveryConfig: GammaPolymarketDiscoveryConfig = {
  searchQuery: "median home value New York City",
  slugPrefixes: ["what-will-the-median-home-value-in-new-york-city-be-on-"],
  titlePrefixes: ["What will the median home value in New York City be on"],
  lastDiscoveryAtKey: "lastParclNycHomeValueDiscoveryAt"
};

export type ParclNycPriceFeedRow = {
  date: string;
  pricePerSqft: number;
};

export const parclNycHomeValueAdapter: WebsiteAdapter = {
  id: "parcl-nyc-home-value",
  commandName: "nychomevalue",
  displayName: "Parcl NYC Home Value",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "nychomevalue",
  alertRoleName: "NYC Home Value Alerts",
  alertRoleEmoji: "\uD83C\uDFD9\uFE0F",
  getPollIntervalMinutes: getParclNycHomeValuePollIntervalMinutes,
  getPollIntervalReason: getParclNycHomeValuePollIntervalReason,
  shouldAlertOnChange: parclNycHomeValueShouldAlertOnChange,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshGammaPolymarketQueue(integration, discoveryConfig)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async upsertPolymarketMarket(
    integration: Integration,
    url: string
  ): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertGammaPolymarketQueueUrl(integration, url, discoveryConfig);
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const rows = await fetchParclNycHomeValueRows();
    const value = extractParclNycHomeValue(rows, new Date(), integration?.polymarketUrl ?? defaultPolymarketUrl);
    return {
      value,
      rawValue: extractRawHomeValue(value) ?? value,
      unit: "USD median home value",
      observedAt: new Date()
    };
  }
};

export function extractParclNycHomeValue(
  rows: ParclNycPriceFeedRow[],
  now: Date,
  polymarketUrl = defaultPolymarketUrl
): string {
  const target = parseParclNycTarget(polymarketUrl, now);
  const sortedRows = [...rows].sort((left, right) => left.date.localeCompare(right.date));
  const targetRow = sortedRows.find((row) => row.date === target.targetDate) ?? null;
  const latest = sortedRows.at(-1) ?? null;
  const fallbackActive = !targetRow && now.getTime() > target.fallbackDeadline.getTime();

  if (targetRow) {
    return [
      "Metric: Parcl Labs Sales Price Index",
      "Market: New York City, New York",
      `Parcl ID: ${parclId}`,
      `Target date: ${target.targetDate}`,
      "Target date status: published",
      `Price index: ${formatPricePerSqft(targetRow.pricePerSqft)}`,
      `Median home size: ${formatInteger(medianHomeSizeSqft)} sqft`,
      `Settlement home value: ${formatHomeValue(calculateHomeValue(targetRow.pricePerSqft))}`,
      `Latest available: ${formatRow(latest)}`,
      "Fallback status: not needed",
      `Resolution: ${sourceUrl}`
    ].join("\n");
  }

  return [
    "Metric: Parcl Labs Sales Price Index",
    "Market: New York City, New York",
    `Parcl ID: ${parclId}`,
    `Target date: ${target.targetDate}`,
    "Target date status: not published yet",
    "Price index: not published yet",
    `Median home size: ${formatInteger(medianHomeSizeSqft)} sqft`,
    "Settlement home value: not published yet",
    `Latest available: ${formatRow(latest)}`,
    `Fallback status: ${
      fallbackActive
        ? `active; use latest available data if ${target.targetDate} remains unavailable`
        : `waiting until ${target.fallbackDate} 23:59 ET`
    }`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function extractParclNycPriceFeedRows(payload: unknown): ParclNycPriceFeedRow[] {
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
    .filter((row): row is ParclNycPriceFeedRow => row !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function getParclNycHomeValuePollIntervalMinutes(integration: Integration, now: Date = new Date()): number {
  if (integration.lastValue?.includes("Target date status: published")) {
    return 1_440;
  }

  const target = parseParclNycTarget(integration.polymarketUrl ?? defaultPolymarketUrl, now);
  const easternDate = getEasternDate(now);
  if (easternDate < target.targetDate) {
    return 1_440;
  }

  return now.getTime() <= target.fallbackDeadline.getTime() ? 1 : 60;
}

export function getParclNycHomeValuePollIntervalReason(integration: Integration, now: Date = new Date()): string {
  if (integration.lastValue?.includes("Target date status: published")) {
    return "Parcl target date already published; daily verification only";
  }

  const target = parseParclNycTarget(integration.polymarketUrl ?? defaultPolymarketUrl, now);
  const easternDate = getEasternDate(now);
  if (easternDate < target.targetDate) {
    return `Parcl normal mode before ${target.targetDate} ET; daily check only`;
  }

  return now.getTime() <= target.fallbackDeadline.getTime()
    ? `Parcl release watch from ${target.targetDate} through ${target.fallbackDate} ET`
    : "Parcl fallback window passed; hourly check for late/revised data";
}

export function parseParclNycTarget(
  polymarketUrl: string,
  now = new Date()
): { targetDate: string; fallbackDate: string; fallbackDeadline: Date } {
  const slug = getPolymarketSlug(polymarketUrl) ?? polymarketUrl;
  const match = slug.match(/on-([a-z]+)-(\d{1,2})(?:-|$)/i);
  const month = monthNumber(match?.[1]);
  const day = Number(match?.[2]);
  if (!month || !Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error(`Could not parse Parcl NYC target date from Polymarket URL: ${polymarketUrl}`);
  }

  const timestampYear = Number(slug.match(/-(20\d{2})\d{8,}$/)?.[1]);
  const year = Number.isInteger(timestampYear) ? timestampYear : Number(getEasternDate(now).slice(0, 4));
  const targetDate = `${year}-${padNumber(month)}-${padNumber(day)}`;
  const fallbackDate = addDays(targetDate, 10);
  const fallbackDeadline = parseManualEasternDateTime(`${fallbackDate} 23:59`);
  if (!fallbackDeadline) {
    throw new Error(`Could not build Parcl NYC fallback deadline for ${targetDate}`);
  }

  return { targetDate, fallbackDate, fallbackDeadline };
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
  return apiUrl;
}

async function fetchParclNycHomeValueRows(): Promise<ParclNycPriceFeedRow[]> {
  const response = await fetchWithTimeout(buildParclNycHomeValueApiUrl(), {
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

function monthNumber(value: string | undefined): number | null {
  const month = value?.toLowerCase();
  const index = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
  ].indexOf(month ?? "");
  return index === -1 ? null : index + 1;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function padNumber(value: number): string {
  return value.toString().padStart(2, "0");
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
