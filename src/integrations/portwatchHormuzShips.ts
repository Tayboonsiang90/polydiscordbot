import { fetchWithTimeout } from "../http.js";
import { parsePolymarketDateRangeWindow, resolveIntegrationPolymarketQueue, type PolymarketQueueMarket, upsertPolymarketQueueUrl } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import { fetchOptionalMarineTrafficAlpha, formatMarineTrafficAlphaSnapshot, type MarineTrafficAlphaSnapshot } from "./marineTrafficAlpha.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://portwatch.imf.org/pages/cb5856222a5b4105adc6ee7e880a1730";
const apiUrl = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";
const defaultPolymarketUrl = "https://polymarket.com/event/how-many-ships-transit-the-strait-of-hormuz-week-of-june-1";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const marketSearchQuery = "ships transit strait of hormuz";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 72 * 60 * 60_000;

type PortwatchFeatureResponse = {
  features?: Array<{ attributes?: Partial<PortwatchHormuzRow> }>;
};

type GammaSearchResponse = {
  events?: GammaSearchEvent[];
};

type GammaSearchEvent = {
  slug?: unknown;
  title?: unknown;
  active?: unknown;
  closed?: unknown;
};

type HormuzDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastHormuzShipsDiscoveryAt?: string;
};

export type PortwatchHormuzRow = {
  date: string;
  portid: string;
  portname: string;
  n_container: number;
  n_dry_bulk: number;
  n_general_cargo: number;
  n_roro: number;
  n_tanker: number;
  n_total: number;
  ObjectId: number;
};

export const portwatchHormuzShipsAdapter: WebsiteAdapter = {
  id: "portwatch-hormuz-ships",
  commandName: "hormuzships",
  displayName: "IMF Portwatch Hormuz Ships",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "hormuzships",
  alertRoleName: "Hormuz Ships Alerts",
  alertRoleEmoji: "\uD83D\uDEA2",
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "polls Portwatch every minute for new Strait of Hormuz transit-call data",
  getErrorNoticeWindowMinutes: () => 30,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshHormuzShipsPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const [rows, marineTrafficAlpha] = await Promise.all([fetchPortwatchHormuzRows(), fetchOptionalMarineTrafficAlpha("hormuz")]);
    const value = extractPortwatchHormuzValue(rows, integration?.polymarketUrl ?? defaultPolymarketUrl, new Date(), marineTrafficAlpha);
    return {
      value,
      rawValue: value,
      unit: "transit calls",
      observedAt: new Date()
    };
  }
};

export async function fetchPortwatchHormuzRows(): Promise<PortwatchHormuzRow[]> {
  const response = await fetchWithTimeout(buildPortwatchHormuzApiUrl(), {
    headers: {
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`IMF Portwatch returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as PortwatchFeatureResponse;
  const rows = normalizePortwatchHormuzRows(payload);
  if (rows.length === 0) {
    throw new Error("Could not find Strait of Hormuz Portwatch rows");
  }

  return rows;
}

export function buildPortwatchHormuzApiUrl(): string {
  const url = new URL(apiUrl);
  url.searchParams.set("f", "json");
  url.searchParams.set("where", "portid='chokepoint6'");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("resultRecordCount", "400");
  url.searchParams.set("orderByFields", "date DESC");
  return url.toString();
}

export function normalizePortwatchHormuzRows(payload: PortwatchFeatureResponse): PortwatchHormuzRow[] {
  return (payload.features ?? [])
    .flatMap((feature) => {
      const attributes = feature.attributes;
      if (!attributes || attributes.portid !== "chokepoint6" || !isDateString(attributes.date)) {
        return [];
      }

      const row: PortwatchHormuzRow = {
        date: attributes.date,
        portid: "chokepoint6",
        portname: typeof attributes.portname === "string" ? attributes.portname : "Strait of Hormuz",
        n_container: normalizeCount(attributes.n_container),
        n_dry_bulk: normalizeCount(attributes.n_dry_bulk),
        n_general_cargo: normalizeCount(attributes.n_general_cargo),
        n_roro: normalizeCount(attributes.n_roro),
        n_tanker: normalizeCount(attributes.n_tanker),
        n_total: normalizeCount(attributes.n_total),
        ObjectId: normalizeCount(attributes.ObjectId)
      };
      return [row];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function extractPortwatchHormuzValue(
  rows: PortwatchHormuzRow[],
  polymarketUrl = defaultPolymarketUrl,
  now = new Date(),
  marineTrafficAlpha: MarineTrafficAlphaSnapshot | null = null
): string {
  const window = parsePolymarketDateRangeWindow(polymarketUrl, now);
  if (!window) {
    throw new Error(`Could not parse Hormuz ships market date range from Polymarket URL: ${polymarketUrl}`);
  }

  const startDate = formatEasternDate(new Date(window.startAt));
  const endDate = formatEasternDate(new Date(window.endAt));
  return formatPortwatchHormuzValue(rows, startDate, endDate, polymarketUrl, marineTrafficAlpha);
}

export function formatPortwatchHormuzValue(
  rows: PortwatchHormuzRow[],
  startDate: string,
  endDate: string,
  polymarketUrl = defaultPolymarketUrl,
  marineTrafficAlpha: MarineTrafficAlphaSnapshot | null = null
): string {
  const dates = enumerateDates(startDate, endDate);
  const rowByDate = new Map(rows.map((row) => [row.date, row]));
  const reportedRows = dates.flatMap((date) => {
    const row = rowByDate.get(date);
    return row ? [row] : [];
  });
  const missingDates = dates.filter((date) => !rowByDate.has(date));
  const total = reportedRows.reduce((sum, row) => sum + row.n_total, 0);
  const average = reportedRows.length > 0 ? total / reportedRows.length : 0;
  const latestRow = reportedRows.at(-1) ?? rows.at(-1);
  const dailyValues = reportedRows.map(formatDailyRow).join(" | ");

  return [
    "Metric: IMF Portwatch Strait of Hormuz transit calls",
    `Window: ${startDate} to ${endDate}`,
    `Status: ${missingDates.length === 0 ? "complete" : "partial"}`,
    `Reported days: ${reportedRows.length}/${dates.length}`,
    `Total transit calls: ${formatInteger(total)}`,
    `Average daily calls: ${formatDecimal(average)}`,
    `Latest data date: ${latestRow?.date ?? "none"}`,
    `Latest ObjectId: ${latestRow?.ObjectId ?? "none"}`,
    `Missing dates: ${missingDates.length ? missingDates.join(", ") : "none"}`,
    `Daily values: ${dailyValues || "none"}`,
    ...formatMarineTrafficAlphaSnapshot(marineTrafficAlpha),
    `Categories: container, dry bulk, general cargo, roll-on/roll-off, tanker`,
    `Resolution: ${sourceUrl}`,
    `API: ${buildPortwatchHormuzApiUrl()}`,
    `Polymarket: ${polymarketUrl}`
  ].join("\n");
}

export async function refreshHormuzShipsPolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseHormuzDiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverHormuzMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastHormuzShipsDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const candidates = await fetchHormuzMarketSearchCandidates(now);
    const existingSlugs = new Set((settings.polymarketMarkets ?? []).map((market) => market.slug));
    for (const candidate of candidates) {
      if (existingSlugs.has(candidate.slug)) {
        continue;
      }

      resolved = upsertPolymarketQueueUrl(
        {
          ...integration,
          settingsJson: resolved.settingsJson,
          polymarketUrl: resolved.activeUrl ?? integration.polymarketUrl
        },
        candidate.url,
        now
      );
      existingSlugs.add(candidate.slug);
    }

    return resolved;
  } catch {
    return resolved;
  }
}

export function normalizeHormuzSearchEvent(event: GammaSearchEvent, now: Date): { slug: string; url: string } | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  const title = event.title.toLowerCase();
  if (
    !event.slug.startsWith("how-many-ships-transit-the-strait-of-hormuz-week-of-") ||
    !title.startsWith("how many ships transit the strait of hormuz")
  ) {
    return null;
  }

  const url = `https://polymarket.com/event/${event.slug}`;
  return parsePolymarketDateRangeWindow(url, now) ? { slug: event.slug, url } : null;
}

async function fetchHormuzMarketSearchCandidates(now: Date): Promise<Array<{ slug: string; url: string }>> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", marketSearchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? [])
    .map((event) => normalizeHormuzSearchEvent(event, now))
    .filter((candidate) => candidate !== null);
}

function shouldDiscoverHormuzMarkets(settings: HormuzDiscoverySettings, now: Date): boolean {
  const markets = normalizeHormuzQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastHormuzShipsDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

function parseHormuzDiscoverySettings(settingsJson: string | null): HormuzDiscoverySettings {
  const settings = parseSettingsJson(settingsJson) as HormuzDiscoverySettings;
  return {
    ...settings,
    polymarketMarkets: normalizeHormuzQueueMarkets(settings.polymarketMarkets),
    lastHormuzShipsDiscoveryAt:
      typeof settings.lastHormuzShipsDiscoveryAt === "string" ? settings.lastHormuzShipsDiscoveryAt : undefined
  };
}

function normalizeHormuzQueueMarkets(value: unknown): PolymarketQueueMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const market = item as Partial<PolymarketQueueMarket>;
    if (!market.url || !market.slug) {
      return [];
    }

    return [
      {
        url: market.url,
        slug: market.slug,
        startAt: typeof market.startAt === "string" ? market.startAt : null,
        endAt: typeof market.endAt === "string" ? market.endAt : null,
        addedAt: typeof market.addedAt === "string" ? market.addedAt : new Date(0).toISOString()
      }
    ];
  });
}

function hasQueuedFutureMarket(markets: PolymarketQueueMarket[], now: Date): boolean {
  const nowMs = now.getTime();
  return markets.some((market) => Boolean(market.startAt) && Date.parse(market.startAt!) > nowMs);
}

function getActiveMarket(markets: PolymarketQueueMarket[], now: Date): PolymarketQueueMarket | null {
  const nowMs = now.getTime();
  return (
    markets.find((market) => {
      if (!market.startAt || !market.endAt) {
        return false;
      }

      return nowMs >= Date.parse(market.startAt) && nowMs <= Date.parse(market.endAt);
    }) ?? null
  );
}

function isDiscoveryIntervalDue(lastDiscoveryAt: string | undefined, now: Date, intervalMs: number): boolean {
  if (!lastDiscoveryAt) {
    return true;
  }

  const lastDiscoveryMs = Date.parse(lastDiscoveryAt);
  return Number.isNaN(lastDiscoveryMs) || now.getTime() - lastDiscoveryMs >= intervalMs;
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const endTimestamp = Date.parse(`${endDate}T12:00:00.000Z`);
  let timestamp = Date.parse(`${startDate}T12:00:00.000Z`);

  while (timestamp <= endTimestamp) {
    dates.push(new Date(timestamp).toISOString().slice(0, 10));
    timestamp += 24 * 60 * 60_000;
  }

  return dates;
}

function formatDailyRow(row: PortwatchHormuzRow): string {
  return `${row.date}: ${row.n_total} (container ${row.n_container}, dry bulk ${row.n_dry_bulk}, general cargo ${row.n_general_cargo}, roro ${row.n_roro}, tanker ${row.n_tanker})`;
}

function formatEasternDate(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
