import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import {
  resolveIntegrationPolymarketQueue,
  type PolymarketQueueMarket
} from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const joeRoganYoutubeChannelUrl = "https://www.youtube.com/@joerogan";
const joeRoganYoutubeFeedUrl = "https://www.youtube.com/feeds/videos.xml?channel_id=UCzQUP1qoWDoEbmsQxvdjxgQ";
const defaultPolymarketUrl =
  "https://polymarket.com/event/what-will-be-said-on-the-first-joe-rogan-experience-episode-of-the-week-june-15-20260611144821382";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const joeRoganMarketSearchQuery = "what will be said on the first joe rogan experience episode of the week";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 72 * 60 * 60_000;

export type JoeRoganEpisode = {
  title: string;
  publishedAt: string;
  url: string;
};

type JoeRoganDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastJoeRoganDiscoveryAt?: string;
};

type GammaSearchResponse = {
  events?: GammaSearchEvent[];
};

type GammaSearchEvent = {
  slug?: unknown;
  title?: unknown;
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
};

export function extractLatestJoeRoganEpisodeValue(feedXml: string): string {
  return formatJoeRoganEpisodeValue(extractLatestJoeRoganEpisode(feedXml));
}

export function extractLatestJoeRoganEpisode(feedXml: string): JoeRoganEpisode {
  const $ = cheerio.load(feedXml, { xmlMode: true });
  const entry = $("entry")
    .toArray()
    .map((element) => $(element))
    .find((candidate) => isJoeRoganEpisodeTitle(normalizeText(candidate.find("title").first().text())));

  if (!entry) {
    throw new Error("Could not find the latest Joe Rogan Experience episode in the YouTube feed");
  }

  const title = normalizeText(entry.find("title").first().text());
  const videoId = normalizeText(entry.find("yt\\:videoId").first().text());
  const href = entry.find('link[rel="alternate"]').first().attr("href");
  const publishedAt = normalizeText(entry.find("published").first().text());

  if (!title || (!href && !videoId) || !publishedAt) {
    throw new Error("Could not find the latest Joe Rogan Experience episode in the YouTube feed");
  }

  return {
    title,
    publishedAt,
    url: href ?? `https://www.youtube.com/watch?v=${videoId}`
  };
}

export const joeRoganPodcastAdapter: WebsiteAdapter = {
  id: "joe-rogan-podcast",
  commandName: "joerogan",
  displayName: "Joe Rogan Podcast",
  sourceUrl: joeRoganYoutubeChannelUrl,
  defaultPolymarketUrl,
  defaultChannelName: "joerogan",
  alertRoleName: "Joe Rogan Alerts",
  alertRoleEmoji: "\uD83C\uDFA4",
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "YouTube channel RSS polling every minute for new Joe Rogan Experience uploads",
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshJoeRoganPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async upsertPolymarketMarket(integration: Integration, url: string): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertJoeRoganPolymarketMarket(integration, url);
  },
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(joeRoganYoutubeFeedUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Joe Rogan YouTube feed returned HTTP ${response.status}`);
    }

    const value = extractLatestJoeRoganEpisodeValue(await response.text());
    return {
      value,
      rawValue: value,
      unit: "latest episode",
      observedAt: new Date()
    };
  }
};

export async function refreshJoeRoganPolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseJoeRoganDiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverJoeRoganMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastJoeRoganDiscoveryAt: now.toISOString() };
  try {
    const existingSlugs = new Set((settings.polymarketMarkets ?? []).map((market) => market.slug));
    for (const candidate of await fetchJoeRoganMarketSearchCandidates(now)) {
      if (existingSlugs.has(candidate.slug)) {
        continue;
      }

      settings = {
        ...settings,
        polymarketMarkets: upsertJoeRoganQueueMarket(settings.polymarketMarkets ?? [], candidate)
      };
      existingSlugs.add(candidate.slug);
    }
  } catch {
    return {
      settingsJson: JSON.stringify(settings),
      activeUrl: resolved.activeUrl
    };
  }

  resolved = resolveIntegrationPolymarketQueue(
    {
      ...integration,
      settingsJson: JSON.stringify(settings),
      polymarketUrl: resolved.activeUrl ?? integration.polymarketUrl
    },
    now
  );
  return resolved;
}

export function upsertJoeRoganPolymarketMarket(
  integration: Integration,
  url: string,
  now = new Date()
): { settingsJson: string | null; activeUrl: string | null } {
  const market = buildJoeRoganQueueMarketFromUrl(url, now);
  const settings = parseJoeRoganDiscoverySettings(integration.settingsJson);
  return resolveIntegrationPolymarketQueue(
    {
      ...integration,
      settingsJson: JSON.stringify({
        ...settings,
        polymarketMarkets: upsertJoeRoganQueueMarket(settings.polymarketMarkets ?? [], market)
      })
    },
    now
  );
}

export function buildJoeRoganQueueMarketFromUrl(url: string, now = new Date()): PolymarketQueueMarket {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${url}`);
  }

  const window = parseJoeRoganWeekWindow(slug, now);
  if (!window) {
    throw new Error(`Polymarket URL is not a Joe Rogan weekly episode market: ${url}`);
  }

  return {
    url,
    slug,
    startAt: window.startAt,
    endAt: window.endAt,
    addedAt: now.toISOString()
  };
}

function formatJoeRoganEpisodeValue(episode: JoeRoganEpisode): string {
  return [`Title: ${episode.title}`, `Published: ${episode.publishedAt}`, `URL: ${episode.url}`, "Source: YouTube RSS"].join("\n");
}

function shouldDiscoverJoeRoganMarkets(settings: JoeRoganDiscoverySettings, now: Date): boolean {
  const markets = normalizeJoeRoganQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastJoeRoganDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

async function fetchJoeRoganMarketSearchCandidates(now: Date): Promise<PolymarketQueueMarket[]> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", joeRoganMarketSearchQuery);
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
    .map((event) => normalizeJoeRoganSearchEvent(event, now))
    .filter((market): market is PolymarketQueueMarket => market !== null);
}

function normalizeJoeRoganSearchEvent(event: GammaSearchEvent, now: Date): PolymarketQueueMarket | null {
  if (
    event.active === false ||
    event.closed === true ||
    event.archived === true ||
    !isNonEmptyString(event.slug) ||
    !isNonEmptyString(event.title)
  ) {
    return null;
  }

  const slug = event.slug.trim();
  const title = event.title.toLowerCase();
  if (
    !slug.startsWith("what-will-be-said-on-the-first-joe-rogan-experience-episode-of-the-week-") ||
    !title.includes("joe rogan") ||
    !title.includes("episode")
  ) {
    return null;
  }

  try {
    return buildJoeRoganQueueMarketFromUrl(`https://polymarket.com/event/${slug}`, now);
  } catch {
    return null;
  }
}

function parseJoeRoganDiscoverySettings(settingsJson: string | null): JoeRoganDiscoverySettings {
  const settings = parseSettingsJson(settingsJson) as JoeRoganDiscoverySettings;
  return {
    ...settings,
    polymarketMarkets: normalizeJoeRoganQueueMarkets(settings.polymarketMarkets),
    lastJoeRoganDiscoveryAt: typeof settings.lastJoeRoganDiscoveryAt === "string" ? settings.lastJoeRoganDiscoveryAt : undefined
  };
}

function normalizeJoeRoganQueueMarkets(value: unknown): PolymarketQueueMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return sortJoeRoganQueueMarkets(
    value.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const market = item as Partial<PolymarketQueueMarket>;
      if (!isNonEmptyString(market.url)) {
        return [];
      }

      const slug = isNonEmptyString(market.slug) ? market.slug : getPolymarketSlug(market.url);
      if (!slug) {
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
    })
  );
}

function upsertJoeRoganQueueMarket(markets: PolymarketQueueMarket[], market: PolymarketQueueMarket): PolymarketQueueMarket[] {
  const nextMarkets = [...markets];
  const existingIndex = nextMarkets.findIndex((candidate) => candidate.slug === market.slug);
  if (existingIndex === -1) {
    nextMarkets.push(market);
  } else {
    nextMarkets[existingIndex] = { ...nextMarkets[existingIndex], ...market, addedAt: nextMarkets[existingIndex].addedAt };
  }

  return sortJoeRoganQueueMarkets(nextMarkets);
}

function sortJoeRoganQueueMarkets(markets: PolymarketQueueMarket[]): PolymarketQueueMarket[] {
  return [...markets].sort((left, right) => {
    const leftTime = left.startAt ? Date.parse(left.startAt) : Number.MAX_SAFE_INTEGER;
    const rightTime = right.startAt ? Date.parse(right.startAt) : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime || left.slug.localeCompare(right.slug);
  });
}

function parseJoeRoganWeekWindow(slug: string, now: Date): { startAt: string; endAt: string } | null {
  const match = slug.match(/first-joe-rogan-experience-episode-of-the-week-([a-z]+)-(\d{1,2})(?:-(\d{4}|\d{14,}))?/i);
  const month = monthNumber(match?.[1]);
  const day = match?.[2] ? Number(match[2]) : null;
  if (!match || !month || !day || day < 1 || day > 31) {
    return null;
  }

  const year = parseEmbeddedYear(match[3]) ?? getEasternYear(now);
  const endDate = new Date(Date.UTC(year, month - 1, day + 6));
  const startAt = parseManualEasternDateTime(`${year}-${padNumber(month)}-${padNumber(day)} 00:00`);
  const endAt = parseManualEasternDateTime(
    `${endDate.getUTCFullYear()}-${padNumber(endDate.getUTCMonth() + 1)}-${padNumber(endDate.getUTCDate())} 23:59`
  );
  if (!startAt || !endAt) {
    return null;
  }

  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
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

function isJoeRoganEpisodeTitle(title: string): boolean {
  return /^(joe rogan experience|jre)\b/i.test(title);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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

function parseEmbeddedYear(value: string | undefined): number | null {
  const match = value?.match(/^(20\d{2})/);
  return match ? Number(match[1]) : null;
}

function getEasternYear(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(now));
}

function padNumber(value: number): string {
  return value.toString().padStart(2, "0");
}
