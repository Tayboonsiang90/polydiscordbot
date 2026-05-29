import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import { resolveIntegrationPolymarketQueue, type PolymarketQueueMarket } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const apiUrl = "https://discordstatus.com/api/v2/incidents.json";
const sourceUrl = "https://discordstatus.com/history";
const defaultPolymarketUrl = "https://polymarket.com/event/critical-discord-incident-by-may-31";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const marketSearchQuery = "critical discord incident";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 7 * 24 * 60 * 60_000;

export type DiscordIncident = {
  id?: string;
  name?: string;
  status?: string;
  impact?: string;
  started_at?: string;
  resolved_at?: string | null;
  updated_at?: string;
  shortlink?: string;
};

export type DiscordIncidentsResponse = {
  incidents?: DiscordIncident[];
};

export type DiscordCriticalMarketWindow = {
  startAt: string;
  endAt: string;
  label: string;
};

type DiscordDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastDiscordCriticalDiscoveryAt?: string;
};

type GammaSearchResponse = {
  events?: GammaSearchEvent[];
};

type GammaSearchEvent = {
  slug?: unknown;
  title?: unknown;
  active?: unknown;
  closed?: unknown;
  tags?: Array<{ slug?: unknown }>;
};

export function extractDiscordCriticalIncidentValue(
  response: DiscordIncidentsResponse,
  polymarketUrl = defaultPolymarketUrl
): string {
  const window = parseDiscordCriticalMarketWindow(polymarketUrl);
  const incidents = getCriticalDiscordIncidents(response, polymarketUrl);

  if (incidents.length === 0) {
    return `No critical incidents found in Discord incidents feed for the ${window.label} market window`;
  }

  return [
    "CRITICAL INCIDENT DETECTED",
    ...incidents.slice(0, 5).map((incident, index) =>
      [
        incidents.length > 1 ? `Incident ${index + 1}: ${incident.name ?? "Unnamed incident"}` : `Incident: ${incident.name ?? "Unnamed incident"}`,
        `Status: ${incident.status ?? "unknown"}`,
        `Started: ${incident.started_at ?? "unknown"}`,
        `Resolved: ${incident.resolved_at ?? "not resolved"}`,
        `Link: ${incident.shortlink ?? sourceUrl}`
      ].join("\n")
    )
  ].join("\n\n");
}

export function getCriticalDiscordIncidents(
  response: DiscordIncidentsResponse,
  polymarketUrl = defaultPolymarketUrl
): DiscordIncident[] {
  if (!Array.isArray(response.incidents)) {
    throw new Error("Could not find Discord incidents in API response");
  }

  const window = parseDiscordCriticalMarketWindow(polymarketUrl);
  return response.incidents
    .filter((incident) => incident.impact?.toLowerCase() === "critical")
    .filter((incident) => isInMarketWindow(incident, window))
    .sort((left, right) => getIncidentTime(right) - getIncidentTime(left));
}

export const discordCriticalAdapter: WebsiteAdapter = {
  id: "discord-critical-incidents",
  commandName: "discord",
  displayName: "Discord Critical Incidents",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "discord-critical",
  alertRoleName: "Discord Critical Alerts",
  alertRoleEmoji: "\uD83D\uDD34",
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshDiscordCriticalPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  shouldAlertOnChange: discordCriticalShouldAlertOnChange,
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const polymarketUrl = integration?.polymarketUrl ?? defaultPolymarketUrl;
    const response = await fetchWithTimeout(apiUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Discord Status returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as DiscordIncidentsResponse;
    const value = extractDiscordCriticalIncidentValue(data, polymarketUrl);
    return {
      value,
      rawValue: value,
      unit: "critical incident status",
      observedAt: new Date()
    };
  }
};

export async function refreshDiscordCriticalPolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseDiscordDiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverDiscordCriticalMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastDiscordCriticalDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const marketsBySlug = new Map(normalizeDiscordQueueMarkets(settings.polymarketMarkets).map((market) => [market.slug, market]));
    for (const url of [integration.polymarketUrl, resolved.activeUrl, defaultPolymarketUrl]) {
      const market = url ? buildDiscordQueueMarket(url, now) : null;
      if (market) {
        marketsBySlug.set(market.slug, market);
      }
    }

    for (const candidate of await fetchDiscordCriticalMarketSearchCandidates(now)) {
      const market = buildDiscordQueueMarket(candidate.url, now);
      if (market) {
        marketsBySlug.set(candidate.slug, market);
      }
    }

    settings = {
      ...settings,
      polymarketMarkets: assignDiscordQueueActivationWindows([...marketsBySlug.values()], now)
    };
    return resolveIntegrationPolymarketQueue(
      {
        ...integration,
        settingsJson: JSON.stringify(settings),
        polymarketUrl: resolved.activeUrl ?? integration.polymarketUrl
      },
      now
    );
  } catch {
    return resolved;
  }
}

export function parseDiscordCriticalMarketWindow(polymarketUrl: string, now = new Date()): DiscordCriticalMarketWindow {
  const marketEnd = parseDiscordCriticalMarketEnd(polymarketUrl, now);
  if (!marketEnd) {
    throw new Error(`Could not parse Discord critical market end date from Polymarket URL: ${polymarketUrl}`);
  }

  const startAt = parseManualEasternDateTime(`${marketEnd.year}-01-01 00:00`);
  const endAt = parseManualEasternDateTime(`${marketEnd.year}-${padNumber(marketEnd.month)}-${padNumber(marketEnd.day)} 23:59`);
  if (!startAt || !endAt) {
    throw new Error(`Could not build Discord critical market window from Polymarket URL: ${polymarketUrl}`);
  }

  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    label: `Jan 1-${marketEnd.monthName} ${marketEnd.day}`
  };
}

export function discordCriticalShouldAlertOnChange(_previousValue: string | null, currentValue: string): boolean {
  return currentValue.includes("CRITICAL INCIDENT DETECTED");
}

function isInMarketWindow(incident: DiscordIncident, window: DiscordCriticalMarketWindow): boolean {
  const timestamp = getIncidentTime(incident);
  return timestamp >= Date.parse(window.startAt) && timestamp <= Date.parse(window.endAt);
}

function getIncidentTime(incident: DiscordIncident): number {
  const date = incident.resolved_at ?? incident.started_at ?? incident.updated_at ?? "";
  const timestamp = Date.parse(date);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function shouldDiscoverDiscordCriticalMarkets(settings: DiscordDiscoverySettings, now: Date): boolean {
  const markets = normalizeDiscordQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastDiscordCriticalDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

async function fetchDiscordCriticalMarketSearchCandidates(now: Date): Promise<Array<{ slug: string; url: string }>> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", marketSearchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");
  searchUrl.searchParams.append("events_tag", "outage");

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? [])
    .map((event) => normalizeDiscordCriticalSearchEvent(event, now))
    .filter((candidate) => candidate !== null);
}

function normalizeDiscordCriticalSearchEvent(event: GammaSearchEvent, now: Date): { slug: string; url: string } | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  const slug = event.slug.trim();
  const title = event.title.toLowerCase().trim();
  if (!slug.startsWith("critical-discord-incident-by-") || !title.startsWith("critical discord incident by ")) {
    return null;
  }

  const tagSlugs = new Set((event.tags ?? []).map((tag) => tag.slug).filter(isNonEmptyString));
  if (!tagSlugs.has("outage")) {
    return null;
  }

  const url = `https://polymarket.com/event/${slug}`;
  return parseDiscordCriticalMarketEnd(url, now) ? { slug, url } : null;
}

function parseDiscordDiscoverySettings(settingsJson: string | null): DiscordDiscoverySettings {
  const settings = parseSettingsJson(settingsJson) as DiscordDiscoverySettings;
  return {
    ...settings,
    polymarketMarkets: normalizeDiscordQueueMarkets(settings.polymarketMarkets),
    lastDiscordCriticalDiscoveryAt:
      typeof settings.lastDiscordCriticalDiscoveryAt === "string" ? settings.lastDiscordCriticalDiscoveryAt : undefined
  };
}

function normalizeDiscordQueueMarkets(value: unknown): PolymarketQueueMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const market = item as Partial<PolymarketQueueMarket>;
    const slug = isNonEmptyString(market.slug) ? market.slug : isNonEmptyString(market.url) ? getPolymarketSlug(market.url) : null;
    if (!isNonEmptyString(market.url) || !slug) {
      return [];
    }

    return [
      {
        url: market.url,
        slug,
        startAt: typeof market.startAt === "string" ? market.startAt : null,
        endAt: typeof market.endAt === "string" ? market.endAt : null,
        addedAt: typeof market.addedAt === "string" ? market.addedAt : new Date(0).toISOString()
      }
    ];
  });
}

function buildDiscordQueueMarket(url: string, now: Date): PolymarketQueueMarket | null {
  const slug = getPolymarketSlug(url);
  const marketEnd = parseDiscordCriticalMarketEnd(url, now);
  const endAt = marketEnd ? parseManualEasternDateTime(`${marketEnd.year}-${padNumber(marketEnd.month)}-${padNumber(marketEnd.day)} 23:59`) : null;
  if (!slug || !endAt) {
    return null;
  }

  return {
    url,
    slug,
    startAt: null,
    endAt: endAt.toISOString(),
    addedAt: now.toISOString()
  };
}

function assignDiscordQueueActivationWindows(markets: PolymarketQueueMarket[], now: Date): PolymarketQueueMarket[] {
  const sorted = markets
    .filter((market) => market.endAt && Date.parse(market.endAt) >= startOfYearEastern(now).getTime())
    .sort((left, right) => Date.parse(left.endAt!) - Date.parse(right.endAt!) || left.slug.localeCompare(right.slug));

  return sorted.map((market, index) => {
    const previousEndAt = index > 0 ? sorted[index - 1].endAt : null;
    return {
      ...market,
      startAt: previousEndAt ? new Date(Date.parse(previousEndAt) + 60_000).toISOString() : startOfYearEastern(now).toISOString()
    };
  });
}

function parseDiscordCriticalMarketEnd(
  polymarketUrl: string,
  now: Date
): { year: number; month: number; monthName: string; day: number } | null {
  const slug = getPolymarketSlug(polymarketUrl);
  const match = slug?.match(/critical-discord-incident-by-([a-z]+)-(\d{1,2})(?:-(20\d{2}))?$/i);
  if (!match) {
    return null;
  }

  const month = monthNumber(match[1]);
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : getEasternYear(now);
  if (!month || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }

  return {
    year,
    month,
    monthName: formatMonthName(month),
    day
  };
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

function startOfYearEastern(now: Date): Date {
  const year = getEasternYear(now);
  const parsed = parseManualEasternDateTime(`${year}-01-01 00:00`);
  if (!parsed) {
    throw new Error(`Could not build Discord critical start-of-year date for ${year}`);
  }

  return parsed;
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
  return months[value.toLowerCase()] ?? null;
}

function formatMonthName(month: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, month - 1, 1)));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getEasternYear(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(date));
}

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
