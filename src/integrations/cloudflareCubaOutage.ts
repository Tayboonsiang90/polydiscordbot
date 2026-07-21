import { fetchWithTimeout } from "../http.js";
import { formatEasternDateTime } from "../time.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const apiUrl = "https://api.cloudflare.com/client/v4/radar/annotations/outages";
const sourceUrl = "https://radar.cloudflare.com/traffic/cu";
const defaultPolymarketUrl = "https://polymarket.com/event/cuba-nationwide-internetpower-outage-byptptpt-20260720181729407";
const marketStartAt = "2026-07-20T20:43:11.734Z";
const finalMarketDeadlineAt = "2026-12-31T23:59:00.000Z";

const marketDeadlines = [
  { label: "July 31", deadlineAt: "2026-07-31T23:59:00.000Z" },
  { label: "August 31", deadlineAt: "2026-08-31T23:59:00.000Z" },
  { label: "December 31", deadlineAt: finalMarketDeadlineAt }
] as const;

export type CloudflareRadarOutageLocation = {
  code?: string;
  name?: string;
};

export type CloudflareRadarOutageAnnotation = {
  id?: string;
  dataSource?: string;
  startDate?: string;
  endDate?: string | null;
  updatedAt?: string;
  eventType?: string;
  scope?: string;
  description?: string;
  linkedUrl?: string;
  locations?: Array<string | CloudflareRadarOutageLocation>;
  locationsDetails?: CloudflareRadarOutageLocation[];
  outage?: {
    outageCause?: string;
    outageType?: string;
  };
};

export type CloudflareRadarOutagesResponse = {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: {
    annotations?: CloudflareRadarOutageAnnotation[];
  };
};

export const cloudflareCubaOutageAdapter: WebsiteAdapter = {
  id: "cloudflare-cuba-outage",
  commandName: "cubaoutage",
  displayName: "Cloudflare Cuba Outage",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "cubaoutage",
  alertRoleName: "Cuba Outage Alerts",
  alertRoleEmoji: "\uD83C\uDDE8\uD83C\uDDFA",
  getPollIntervalMinutes(): number {
    return 1;
  },
  getPollIntervalReason(): string {
    return "polls Cloudflare Radar Cuba outage annotations every minute";
  },
  getErrorNoticeWindowMinutes(): number {
    return 30;
  },
  shouldAlertOnChange: shouldAlertOnCloudflareCubaOutageChange,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const token = getCloudflareRadarApiToken();
    const observedAt = new Date();
    const response = await fetchWithTimeout(buildRadarOutagesUrl(observedAt).toString(), {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Cloudflare Radar outages API returned HTTP ${response.status}: ${await readResponsePreview(response)}`);
    }

    const data = (await response.json()) as CloudflareRadarOutagesResponse;
    const value = extractCloudflareCubaOutageValue(data);
    return {
      value,
      rawValue: value,
      unit: "Cuba nationwide power-outage status",
      observedAt
    };
  }
};

export function extractCloudflareCubaOutageValue(response: CloudflareRadarOutagesResponse): string {
  const cubaOutages = getCubaOutages(response);
  const qualifyingOutages = getQualifyingCubaPowerOutages(response);
  const latestQualifying = qualifyingOutages[0];
  const latestCubaOutage = cubaOutages[0];

  return [
    `Status: ${qualifyingOutages.length > 0 ? "QUALIFYING NATIONWIDE POWER OUTAGE FOUND" : "No qualifying nationwide power outage found"}`,
    `Qualifying outages: ${qualifyingOutages.length}`,
    `Qualifying keys: ${qualifyingOutages.map(formatOutageKey).join(", ") || "none"}`,
    `Latest qualifying outage: ${latestQualifying ? formatOutageSummary(latestQualifying) : "none"}`,
    `Qualifying deadlines: ${latestQualifying ? getQualifiedDeadlineLabels(latestQualifying).join(", ") || "none" : "none"}`,
    `Recent Cuba outage rows: ${cubaOutages.length}`,
    `Latest Cuba outage: ${latestCubaOutage ? formatOutageSummary(latestCubaOutage) : "none in queried market window"}`,
    `Market window: ${formatEasternDateTime(marketStartAt)} to ${formatEasternDateTime(finalMarketDeadlineAt)}`,
    `Rule check: requires Cuba + Type Nationwide + Cause Power Outage on Cloudflare Radar`,
    `Resolution: ${sourceUrl}`,
    `API: ${apiUrl}`
  ].join("\n");
}

export function getQualifyingCubaPowerOutages(response: CloudflareRadarOutagesResponse): CloudflareRadarOutageAnnotation[] {
  return getCubaOutages(response).filter(isQualifyingCubaPowerOutage);
}

export function shouldAlertOnCloudflareCubaOutageChange(previousValue: string | null, currentValue: string): boolean {
  if (!previousValue) {
    return false;
  }

  return extractQualifyingKeys(previousValue) !== extractQualifyingKeys(currentValue);
}

function getCubaOutages(response: CloudflareRadarOutagesResponse): CloudflareRadarOutageAnnotation[] {
  const outages = getCloudflareRadarOutages(response);
  return outages.filter(isCubaOutage).sort((left, right) => getOutageTimestamp(right) - getOutageTimestamp(left));
}

function getCloudflareRadarOutages(response: CloudflareRadarOutagesResponse): CloudflareRadarOutageAnnotation[] {
  if (response.success === false) {
    const errors = response.errors?.map((error) => error.message ?? String(error.code ?? "unknown error")).join("; ");
    throw new Error(`Cloudflare Radar outages API returned an error${errors ? `: ${errors}` : ""}`);
  }

  if (!Array.isArray(response.result?.annotations)) {
    throw new Error("Could not find Cloudflare Radar outage annotations in API response");
  }

  return response.result.annotations;
}

function isQualifyingCubaPowerOutage(outage: CloudflareRadarOutageAnnotation): boolean {
  if (!isCubaOutage(outage) || !isOutageEvent(outage)) {
    return false;
  }

  const startTime = getOutageTimestamp(outage);
  if (startTime < Date.parse(marketStartAt) || startTime > Date.parse(finalMarketDeadlineAt)) {
    return false;
  }

  return isNationwideOutage(outage.outage?.outageType) && isPowerOutageCause(outage.outage?.outageCause);
}

function isCubaOutage(outage: CloudflareRadarOutageAnnotation): boolean {
  const locationTokens = [
    ...(outage.locations ?? []).map((location) => (typeof location === "string" ? location : `${location.code ?? ""} ${location.name ?? ""}`)),
    ...(outage.locationsDetails ?? []).map((location) => `${location.code ?? ""} ${location.name ?? ""}`)
  ];

  return locationTokens.some((token) => /\b(CU|CUBA)\b/i.test(token));
}

function isOutageEvent(outage: CloudflareRadarOutageAnnotation): boolean {
  const eventType = normalizeLabel(outage.eventType);
  return eventType === "" || eventType.includes("OUTAGE");
}

function isNationwideOutage(value: string | undefined): boolean {
  const normalized = normalizeLabel(value);
  return normalized.includes("NATIONWIDE") || normalized.includes("NATIONAL");
}

function isPowerOutageCause(value: string | undefined): boolean {
  const normalized = normalizeLabel(value);
  return normalized.includes("POWEROUTAGE") || normalized.includes("POWERFAILURE") || normalized.includes("POWERBLACKOUT") || normalized.includes("ELECTRIC") || normalized.includes("GRID");
}

function normalizeLabel(value: string | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function formatOutageSummary(outage: CloudflareRadarOutageAnnotation): string {
  const parts = [
    `ID ${getOutageId(outage)}`,
    `Start: ${formatDate(outage.startDate)}`,
    `End: ${outage.endDate ? formatDate(outage.endDate) : "ongoing/not listed"}`,
    `Type: ${outage.outage?.outageType ?? "unknown"}`,
    `Cause: ${outage.outage?.outageCause ?? "unknown"}`
  ];

  if (outage.linkedUrl) {
    parts.push(`Link: ${outage.linkedUrl}`);
  }

  return parts.join(" | ");
}

function formatOutageKey(outage: CloudflareRadarOutageAnnotation): string {
  return [
    getOutageId(outage),
    normalizeDateKey(outage.startDate),
    normalizeDateKey(outage.endDate ?? undefined),
    normalizeLabel(outage.outage?.outageType) || "UNKNOWN_TYPE",
    normalizeLabel(outage.outage?.outageCause) || "UNKNOWN_CAUSE"
  ].join(":");
}

function getOutageId(outage: CloudflareRadarOutageAnnotation): string {
  return outage.id?.trim() || normalizeDateKey(outage.startDate) || "unknown";
}

function getQualifiedDeadlineLabels(outage: CloudflareRadarOutageAnnotation): string[] {
  const startTime = getOutageTimestamp(outage);
  return marketDeadlines.filter((deadline) => startTime <= Date.parse(deadline.deadlineAt)).map((deadline) => deadline.label);
}

function getOutageTimestamp(outage: CloudflareRadarOutageAnnotation): number {
  const timestamp = Date.parse(outage.startDate ?? "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatDate(value: string | undefined): string {
  return value ? formatEasternDateTime(value) : "not listed";
}

function normalizeDateKey(value: string | undefined): string {
  if (!value) {
    return "none";
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}

function extractQualifyingKeys(value: string): string {
  return value.match(/^Qualifying keys:\s*(.*)$/m)?.[1].trim() ?? "";
}

function buildRadarOutagesUrl(now: Date): URL {
  const url = new URL(apiUrl);
  url.searchParams.set("limit", "100");
  url.searchParams.set("offset", "0");
  url.searchParams.set("dateStart", marketStartAt);
  url.searchParams.set("dateEnd", now.toISOString());
  url.searchParams.set("location", "CU");
  url.searchParams.set("format", "json");
  return url;
}

function getCloudflareRadarApiToken(): string {
  const token = process.env.CLOUDFLARE_RADAR_API_TOKEN?.trim() || process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "CLOUDFLARE_RADAR_API_TOKEN or CLOUDFLARE_API_TOKEN is required for Cloudflare Radar API polling. Create a Cloudflare API token with Account > Radar > Read and add it to .env."
    );
  }

  return token;
}

async function readResponsePreview(response: Response): Promise<string> {
  const text = await response.text();
  return text.replace(/\s+/g, " ").trim().slice(0, 240) || "empty response";
}
