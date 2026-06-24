import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import {
  parsePolymarketDateRangeWindow,
  resolveIntegrationPolymarketQueue,
  type PolymarketQueueMarket,
  upsertPolymarketQueueUrl
} from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const allInEpisodesUrl = "https://allin.com/episodes";
const allInYoutubeChannelUrl = "https://www.youtube.com/@allin/videos";
const allInYoutubeFeedUrl = "https://www.youtube.com/feeds/videos.xml?channel_id=UCESLZhusAkFfsNsApnjF_Cg";
const sourceUrl = allInYoutubeChannelUrl;
const defaultPolymarketUrl = "https://polymarket.com/event/what-will-be-said-on-the-next-all-in-podcast-may-8";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const allInMarketSearchQuery = "what will be said on the next all-in podcast";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 72 * 60 * 60_000;

export type AllInEpisode = {
  title: string;
  date: string;
  url: string;
  publishedAt?: string;
  source: "YouTube RSS" | "allin.com";
};

type AllInDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastAllInDiscoveryAt?: string;
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

export function extractLatestAllInEpisodeValue(html: string): string {
  const episode = extractLatestAllInEpisode(html);
  return formatAllInEpisodeValue(episode);
}

export function extractLatestAllInYoutubeEpisodeValue(feedXml: string): string {
  const episode = extractLatestAllInYoutubeEpisode(feedXml);
  return formatAllInEpisodeValue(episode);
}

export function extractLatestAllInYoutubeEpisode(feedXml: string): AllInEpisode {
  const $ = cheerio.load(feedXml, { xmlMode: true });
  const entries = $("entry").toArray();
  for (const element of entries) {
    const entry = $(element);
    const title = normalizeText(entry.find("title").first().text());
    const videoId = normalizeText(entry.find("yt\\:videoId").first().text());
    const href = entry.find('link[rel="alternate"]').first().attr("href");
    const url = href ?? (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");
    const publishedAt = normalizeText(entry.find("published").first().text());

    if (!title || !url || !publishedAt || isYoutubeShortUrl(url)) {
      continue;
    }

    return {
      title,
      date: publishedAt,
      publishedAt,
      url,
      source: "YouTube RSS"
    };
  }

  throw new Error("Could not find the latest non-Shorts All-In episode in the YouTube feed");
}

export function extractLatestAllInEpisode(html: string): AllInEpisode {
  const $ = cheerio.load(html);
  const link = $('a[href^="https://youtube.com/v/"]')
    .filter((_, anchor) => normalizeText($(anchor).text()).length > 0)
    .first();
  const title = normalizeText(link.text());
  const href = link.attr("href");
  const date = normalizeText(link.parent().prev().text()).replace(/[\[\]\u00a0]/g, "").trim();

  if (!title || !href || !date) {
    throw new Error("Could not find the latest All-In episode on allin.com");
  }

  return {
    title,
    date,
    url: normalizeYoutubeUrl(href),
    source: "allin.com"
  };
}

export const allInPodcastAdapter: WebsiteAdapter = {
  id: "all-in-podcast",
  commandName: "allin",
  displayName: "All-In Podcast",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "allinpod",
  alertRoleName: "All-In Podcast Alerts",
  alertRoleEmoji: "\uD83C\uDFA7",
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "YouTube channel RSS polling every minute for new non-Shorts All-In uploads",
  shouldAlertOnChange: shouldAlertOnAllInChange,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshAllInPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    let youtubeFailure = "unknown error";
    try {
      const youtubeResponse = await fetchWithTimeout(allInYoutubeFeedUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
        }
      });

      if (youtubeResponse.ok) {
        const value = keepNewestAllInEpisodeValue(extractLatestAllInYoutubeEpisodeValue(await youtubeResponse.text()), integration?.lastValue);
        return {
          value,
          rawValue: value,
          unit: "latest episode",
          observedAt: new Date()
        };
      }

      youtubeFailure = `HTTP ${youtubeResponse.status}`;
    } catch (error) {
      youtubeFailure = formatFetchFailure(error);
    }

    const fallbackResponse = await fetchWithTimeout(allInEpisodesUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!fallbackResponse.ok) {
      throw new Error(`All-In YouTube feed failed (${youtubeFailure}); allin.com returned HTTP ${fallbackResponse.status}`);
    }

    const value = keepNewestAllInEpisodeValue(extractLatestAllInEpisodeValue(await fallbackResponse.text()), integration?.lastValue);
    return {
      value,
      rawValue: value,
      unit: "latest episode",
      observedAt: new Date()
    };
  }
};

function formatAllInEpisodeValue(episode: AllInEpisode): string {
  const dateLine = episode.publishedAt ? `Published: ${episode.publishedAt}` : `Date: ${episode.date}`;
  return [`Title: ${episode.title}`, dateLine, `URL: ${episode.url}`, `Source: ${episode.source}`].join("\n");
}

function keepNewestAllInEpisodeValue(currentValue: string, previousValue: string | null | undefined): string {
  const previousPublishedAt = extractAllInValuePublishedAt(previousValue ?? null);
  const currentPublishedAt = extractAllInValuePublishedAt(currentValue);
  if (!previousPublishedAt || !currentPublishedAt) {
    return currentValue;
  }

  return currentPublishedAt.getTime() < previousPublishedAt.getTime() ? previousValue! : currentValue;
}

export function shouldAlertOnAllInChange(previousValue: string | null, currentValue: string): boolean {
  const previousUrl = extractAllInValueUrl(previousValue);
  const currentUrl = extractAllInValueUrl(currentValue);
  if (!previousUrl || !currentUrl) {
    return true;
  }

  if (isYoutubeShortUrl(previousUrl) || isYoutubeShortUrl(currentUrl)) {
    return false;
  }

  return normalizeYoutubeWatchUrl(previousUrl) !== normalizeYoutubeWatchUrl(currentUrl);
}

function formatFetchFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function refreshAllInPolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseAllInDiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverAllInMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastAllInDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const candidates = await fetchAllInMarketSearchCandidates();
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

function shouldDiscoverAllInMarkets(settings: AllInDiscoverySettings, now: Date): boolean {
  const markets = normalizeAllInQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastAllInDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

async function fetchAllInMarketSearchCandidates(): Promise<Array<{ slug: string; url: string }>> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", allInMarketSearchQuery);
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
    .map(normalizeAllInSearchEvent)
    .filter((candidate) => candidate !== null);
}

function normalizeAllInSearchEvent(event: GammaSearchEvent): { slug: string; url: string } | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  const slug = event.slug;
  const title = event.title.toLowerCase();
  if (!slug.startsWith("what-will-be-said-on-the-next-all-in-podcast-") || !title.includes("next all-in podcast")) {
    return null;
  }

  const url = `https://polymarket.com/event/${slug}`;
  if (!parsePolymarketDateRangeWindow(url)) {
    return null;
  }

  return { slug, url };
}

function parseAllInDiscoverySettings(settingsJson: string | null): AllInDiscoverySettings {
  const settings = parseSettingsJson(settingsJson) as AllInDiscoverySettings;
  return {
    ...settings,
    polymarketMarkets: normalizeAllInQueueMarkets(settings.polymarketMarkets),
    lastAllInDiscoveryAt: typeof settings.lastAllInDiscoveryAt === "string" ? settings.lastAllInDiscoveryAt : undefined
  };
}

function normalizeAllInQueueMarkets(value: unknown): PolymarketQueueMarket[] {
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

function normalizeYoutubeUrl(url: string): string {
  const videoId = url.split("/v/").at(-1)?.split(/[?#]/)[0];
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : url;
}

function normalizeYoutubeWatchUrl(url: string): string {
  const parsed = safeParseUrl(url);
  if (!parsed) {
    return url;
  }

  const videoId =
    parsed.searchParams.get("v") ?? parsed.pathname.split("/v/").at(-1)?.split("/")[0] ?? parsed.pathname.split("/shorts/").at(-1)?.split("/")[0];
  if (!videoId || videoId === parsed.pathname) {
    return parsed.toString();
  }

  return `https://www.youtube.com/watch?v=${videoId}`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function extractAllInValueUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^URL:\s*(\S+)/m);
  return match?.[1] ?? null;
}

function extractAllInValuePublishedAt(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const publishedMatch = value.match(/^Published:\s*(.+)$/m);
  if (publishedMatch?.[1]) {
    const publishedAt = new Date(publishedMatch[1]);
    return Number.isNaN(publishedAt.getTime()) ? null : publishedAt;
  }

  const dateMatch = value.match(/^Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})$/m);
  if (!dateMatch) {
    return null;
  }

  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isYoutubeShortUrl(url: string): boolean {
  return /(^|\/)shorts\//i.test(url);
}

function safeParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
