import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import { resolveIntegrationPolymarketQueue, type PolymarketQueueMarket } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { Integration } from "./types.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

export const ornnSourceUrl = "https://dashboard.ornnai.com";
const apiBaseUrl = "https://ornn-backend-api-135941626504.us-central1.run.app/api/gpu";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const gammaEventsUrl = "https://gamma-api.polymarket.com/events";
const marketDiscoveryIntervalMs = 60 * 60_000;
const dailyGpuPollIntervalMinutes = 60;

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

type OrnnGpuDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastOrnnGpuMarketDiscoveryAt?: string;
};

type GammaSearchResponse = {
  events?: GammaEvent[];
};

type GammaEvent = {
  slug?: unknown;
  title?: unknown;
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
  startDate?: unknown;
  creationDate?: unknown;
  createdAt?: unknown;
  endDate?: unknown;
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
    getPollIntervalMinutes(): number {
      return dailyGpuPollIntervalMinutes;
    },
    getPollIntervalReason(): string {
      return "Hourly ORNN polling; alerts only when a new finalized daily GPU index value appears.";
    },
    async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
      return (
        await refreshOrnnGpuPolymarketQueue(integration, config, new Date(), {
          force: options?.force ?? false
        })
      ).settingsJson ?? integration.settingsJson ?? "{}";
    },
    async upsertPolymarketMarket(integration: Integration, url: string): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
      return upsertOrnnGpuPolymarketMarket(integration, config, url);
    },
    async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
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

export async function refreshOrnnGpuPolymarketQueue(
  integration: Integration,
  config: OrnnGpuIndexConfig,
  now = new Date(),
  options: { force?: boolean } = {}
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let settings = parseOrnnGpuDiscoverySettings(integration.settingsJson);
  let markets = upsertOrnnGpuQueueMarket(
    settings.polymarketMarkets ?? [],
    buildOrnnGpuQueueMarketFromUrl(config.defaultPolymarketUrl, config.gpuName, now)
  );
  let resolved = resolveOrnnGpuQueue(settings, markets, integration.polymarketUrl, now);

  settings = parseOrnnGpuDiscoverySettings(resolved.settingsJson);
  markets = settings.polymarketMarkets ?? [];
  if (!options.force && !isDiscoveryDue(settings.lastOrnnGpuMarketDiscoveryAt, now)) {
    return resolved;
  }

  settings = { ...settings, lastOrnnGpuMarketDiscoveryAt: now.toISOString() };
  resolved = resolveOrnnGpuQueue(settings, markets, resolved.activeUrl ?? integration.polymarketUrl, now);

  try {
    const candidates = await fetchOrnnGpuMarketSearchCandidates(config.gpuName, now);
    for (const candidate of candidates) {
      markets = upsertOrnnGpuQueueMarket(markets, candidate);
    }

    return resolveOrnnGpuQueue(settings, markets, resolved.activeUrl ?? integration.polymarketUrl, now);
  } catch {
    return resolved;
  }
}

export async function upsertOrnnGpuPolymarketMarket(
  integration: Integration,
  config: OrnnGpuIndexConfig,
  url: string,
  now = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  const settings = parseOrnnGpuDiscoverySettings(integration.settingsJson);
  const existingMarkets = settings.polymarketMarkets ?? [];
  const market =
    (await fetchOrnnGpuMarketByUrl(url, config.gpuName).catch(() => null)) ??
    buildOrnnGpuQueueMarketFromUrl(url, config.gpuName, now);
  return resolveOrnnGpuQueue(settings, upsertOrnnGpuQueueMarket(existingMarkets, market), integration.polymarketUrl, now);
}

export function normalizeOrnnGpuMarketSearchEvent(
  event: GammaEvent,
  gpuName: string,
  now = new Date()
): PolymarketQueueMarket | null {
  if (
    event.active === false ||
    event.closed === true ||
    event.archived === true ||
    !isNonEmptyString(event.slug) ||
    !isNonEmptyString(event.title)
  ) {
    return null;
  }

  const gpu = gpuName.toLowerCase();
  const slug = event.slug.toLowerCase();
  const title = event.title.toLowerCase();
  if (!slug.startsWith(`gpu-rental-prices-${gpu}-`) || !title.includes("gpu rental prices") || !title.includes(`(${gpu})`)) {
    return null;
  }

  const endAt = parseGammaDate(event.endDate) ?? parseOrnnGpuMarketEndFromSlug(slug, now);
  if (!endAt) {
    return null;
  }

  const startAt = parseGammaDate(event.startDate) ?? parseGammaDate(event.creationDate) ?? parseGammaDate(event.createdAt) ?? now;
  return {
    url: `https://polymarket.com/event/${event.slug}`,
    slug: event.slug,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    addedAt: now.toISOString()
  };
}

export function buildOrnnGpuApiUrl(gpuName: string): string {
  return `${apiBaseUrl}/${encodeURIComponent(toOrnnApiGpuName(gpuName))}/index-history`;
}

function toOrnnApiGpuName(gpuName: string): string {
  return gpuName.toUpperCase() === "H100" ? "H100 SXM" : gpuName;
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

async function fetchOrnnGpuMarketSearchCandidates(gpuName: string, now: Date): Promise<PolymarketQueueMarket[]> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", `gpu rental prices ${gpuName.toLowerCase()}`);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "20");

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? [])
    .map((event) => normalizeOrnnGpuMarketSearchEvent(event, gpuName, now))
    .filter((market): market is PolymarketQueueMarket => market !== null);
}

async function fetchOrnnGpuMarketByUrl(url: string, gpuName: string): Promise<PolymarketQueueMarket | null> {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    return null;
  }

  const response = await fetchWithTimeout(`${gammaEventsUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const events = (await response.json()) as GammaEvent[];
  return normalizeOrnnGpuMarketSearchEvent(events[0] ?? {}, gpuName);
}

function buildOrnnGpuQueueMarketFromUrl(url: string, gpuName: string, now: Date): PolymarketQueueMarket {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${url}`);
  }

  const endAt = parseOrnnGpuMarketEndFromSlug(slug, now);
  return {
    url,
    slug,
    startAt: now.toISOString(),
    endAt: endAt?.toISOString() ?? null,
    addedAt: now.toISOString()
  };
}

function parseOrnnGpuMarketEndFromSlug(slug: string, now: Date): Date | null {
  const parts = slug.toLowerCase().split("-");
  const explicitYear = parts.map(parseYear).find((value): value is number => value !== null);
  const currentYear = getEasternYear(now);
  const endOfMonthIndex = parts.findIndex((part, index) => part === "end" && parts[index + 1] === "of");
  if (endOfMonthIndex !== -1) {
    const month = monthNumber(parts[endOfMonthIndex + 2]);
    const year = explicitYear ?? inferMonthOnlyMarketYear(month, now);
    return month ? parseEasternDateTime(year, month, daysInMonth(year, month), 23, 59) : null;
  }

  for (let index = 0; index < parts.length - 1; index += 1) {
    const month = monthNumber(parts[index]);
    const day = parseDay(parts[index + 1]);
    if (!month || !day) {
      continue;
    }

    const year = explicitYear ?? inferMonthOnlyMarketYear(month, now);
    return parseEasternDateTime(year, month, day, 23, 59);
  }

  return null;
}

function resolveOrnnGpuQueue(
  settings: OrnnGpuDiscoverySettings,
  markets: PolymarketQueueMarket[],
  currentUrl: string | null,
  now: Date
): { settingsJson: string | null; activeUrl: string | null } {
  return resolveIntegrationPolymarketQueue(
    {
      id: 0,
      guildId: "",
      channelId: "",
      adapterId: "",
      displayName: "",
      sourceUrl: ornnSourceUrl,
      polymarketUrl: currentUrl,
      alertRoleId: null,
      roleMessageId: null,
      roleChannelId: null,
      roleEmoji: null,
      settingsJson: JSON.stringify({
        ...settings,
        polymarketMarkets: sortOrnnGpuMarkets(markets)
      }),
      pollIntervalMinutes: dailyGpuPollIntervalMinutes,
      status: "active",
      lastValue: null,
      lastCheckedAt: null,
      lastChangedAt: null,
      snapshotValue: null,
      snapshotCheckedAt: null,
      snapshotDate: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    },
    now
  );
}

function parseOrnnGpuDiscoverySettings(settingsJson: string | null): OrnnGpuDiscoverySettings {
  const settings = parseSettingsJson(settingsJson) as OrnnGpuDiscoverySettings;
  return {
    ...settings,
    polymarketMarkets: normalizeOrnnGpuMarkets(settings.polymarketMarkets),
    lastOrnnGpuMarketDiscoveryAt:
      typeof settings.lastOrnnGpuMarketDiscoveryAt === "string" ? settings.lastOrnnGpuMarketDiscoveryAt : undefined
  };
}

function normalizeOrnnGpuMarkets(value: unknown): PolymarketQueueMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return sortOrnnGpuMarkets(
    value.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const market = item as Partial<PolymarketQueueMarket>;
      if (!isNonEmptyString(market.url) || !isNonEmptyString(market.slug) || !isNonEmptyString(market.endAt)) {
        return [];
      }

      return [
        {
          url: market.url,
          slug: market.slug,
          startAt: typeof market.startAt === "string" ? market.startAt : new Date(0).toISOString(),
          endAt: market.endAt,
          addedAt: typeof market.addedAt === "string" ? market.addedAt : new Date(0).toISOString()
        }
      ];
    })
  );
}

function upsertOrnnGpuQueueMarket(markets: PolymarketQueueMarket[], market: PolymarketQueueMarket): PolymarketQueueMarket[] {
  const existingIndex = markets.findIndex((candidate) => candidate.slug === market.slug);
  const nextMarkets = [...markets];
  if (existingIndex === -1) {
    nextMarkets.push(market);
  } else {
    nextMarkets[existingIndex] = { ...nextMarkets[existingIndex], ...market, addedAt: nextMarkets[existingIndex].addedAt };
  }

  return sortOrnnGpuMarkets(nextMarkets);
}

function sortOrnnGpuMarkets(markets: PolymarketQueueMarket[]): PolymarketQueueMarket[] {
  return [...markets].sort((left, right) => {
    const leftEnd = left.endAt ? Date.parse(left.endAt) : Number.MAX_SAFE_INTEGER;
    const rightEnd = right.endAt ? Date.parse(right.endAt) : Number.MAX_SAFE_INTEGER;
    const leftStart = left.startAt ? Date.parse(left.startAt) : Number.MAX_SAFE_INTEGER;
    const rightStart = right.startAt ? Date.parse(right.startAt) : Number.MAX_SAFE_INTEGER;
    return leftEnd - rightEnd || leftStart - rightStart || left.slug.localeCompare(right.slug);
  });
}

function isDiscoveryDue(lastDiscoveryAt: string | undefined, now: Date): boolean {
  if (!lastDiscoveryAt) {
    return true;
  }

  const lastDiscoveryMs = Date.parse(lastDiscoveryAt);
  return Number.isNaN(lastDiscoveryMs) || now.getTime() - lastDiscoveryMs >= marketDiscoveryIntervalMs;
}

function parseGammaDate(value: unknown): Date | null {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseEasternDateTime(year: number, month: number, day: number, hour: number, minute: number): Date | null {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offsetMinutes = getEasternOffsetMinutes(utcGuess);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60_000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getEasternOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
    hour: "2-digit"
  }).formatToParts(date);
  const value = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT-5";
  const match = value.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) {
    return -300;
  }

  const sign = match[1] === "+" ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

function getEasternYear(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(date));
}

function getEasternMonth(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric" }).format(date));
}

function inferMonthOnlyMarketYear(month: number | null, now: Date): number {
  const currentYear = getEasternYear(now);
  const currentMonth = getEasternMonth(now);
  if (!month) {
    return currentYear;
  }

  if (month === 12 && currentMonth === 1) {
    return currentYear - 1;
  }

  if (month === 1 && currentMonth === 12) {
    return currentYear + 1;
  }

  return currentYear;
}

function monthNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const months: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12
  };
  return months[value] ?? null;
}

function parseDay(value: string | undefined): number | null {
  if (!value || !/^\d{1,2}$/.test(value)) {
    return null;
  }

  const day = Number(value);
  return day >= 1 && day <= 31 ? day : null;
}

function parseYear(value: string | undefined): number | null {
  if (!value || !/^20\d{2}$/.test(value)) {
    return null;
  }

  return Number(value);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
