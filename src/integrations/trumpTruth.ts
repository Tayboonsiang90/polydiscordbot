import * as cheerio from "cheerio";
import Tesseract from "tesseract.js";
import type { AdapterValue, EventMonitorPost, EventMonitorResult, Integration, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";

const sourceUrl = "https://truthsocial.com/@realDonaldTrump";
const archiveFeedUrl = "https://www.trumpstruth.org/feed";
const defaultPolymarketUrl = "https://polymarket.com/event/what-will-trump-post-this-week-may-4-may-10";
const maxPosts = 20;
const maxOcrImagesPerPost = 2;
const archiveDetailTimeoutMs = 8_000;
const gammaApiUrl = "https://gamma-api.polymarket.com/events";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const strikeRefreshIntervalMs = 5 * 60_000;
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 72 * 60 * 60_000;
const trumpTruthMarketSearchQuery = "what will trump post this week";
const trumpTruthMarketSearchTags = ["trump", "mention-markets"];
const ocrTextCache = new Map<string, string>();

export type TrumpTruthSettings = {
  strikeTerms?: string[];
  parsedFromUrl?: string;
  lastParsedAt?: string;
  lastDiscoveryAt?: string;
  markets?: TrumpTruthMarket[];
};

export type TrumpTruthMarket = {
  url: string;
  slug: string;
  startAt: string;
  endAt: string;
  strikeTerms: string[];
  resolvedTerms: string[];
  activeStrikeTerms: string[];
  lastParsedAt?: string;
};

type TruthSocialStatus = {
  id?: string;
  url?: string;
  uri?: string;
  created_at?: string;
  content?: string;
  account?: { acct?: string; username?: string };
  media_attachments?: Array<{ type?: string; url?: string; preview_url?: string }>;
  reblog?: TruthSocialStatus | null;
  in_reply_to_id?: string | null;
  quote?: TruthSocialStatus | null;
  quote_id?: string | null;
};

type TrumpTruthArchiveItem = {
  id: string;
  archiveUrl: string;
  originalUrl: string;
  originalId: string;
  postedAt: Date;
  html: string;
  title: string;
};

type GammaEvent = {
  markets?: GammaMarket[];
};

type GammaSearchResponse = {
  events?: GammaSearchEvent[];
};

type GammaSearchEvent = {
  slug?: string;
  title?: string;
  active?: boolean;
  closed?: boolean;
  tags?: Array<{ slug?: string | null }>;
  markets?: GammaMarket[];
};

type GammaMarket = {
  question?: string;
  closed?: boolean;
  outcomePrices?: string[] | string;
  outcomes?: string[] | string;
};

export const trumpTruthAdapter: WebsiteAdapter = {
  id: "trump-truth",
  commandName: "trumptruth",
  displayName: "Trump Truth Social",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "trumptruth",
  alertRoleName: "Trump Truth Alerts",
  alertRoleEmoji: "\uD83D\uDCF0",
  supportsStrikes: true,
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    if (!integration) {
      throw new Error("Trump Truth requires an integration record");
    }

    const result = await this.fetchEventUpdates!(integration);
    const latest = result.posts[0];
    const value = latest ? `${latest.id}\n${latest.text || latest.type}` : "no recent posts found";
    return { value, rawValue: value, unit: "latest Truth Social post", observedAt: result.observedAt };
  },
  async fetchEventUpdates(integration: Integration): Promise<EventMonitorResult> {
    const settings = await refreshTrumpTruthSettings(integration);
    const items = await fetchTrumpTruthArchiveItems();
    const posts = items
      .slice(0, maxPosts)
      .map((item) => ({
        ...normalizeTrumpTruthArchiveItem(item, settings.strikeTerms ?? []),
        polymarketUrl: settings.parsedFromUrl
      }));

    return { posts, strikeTerms: settings.strikeTerms ?? [], polymarketUrl: settings.parsedFromUrl, observedAt: new Date() };
  },
  async enrichEventPost(post: EventMonitorPost, strikeTerms: string[]): Promise<EventMonitorPost> {
    return enrichTrumpTruthPostWithOcr(post, strikeTerms);
  },
  async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
    return JSON.stringify(await refreshTrumpTruthSettings(integration, options?.force));
  },
  getStrikeTerms(integration: Integration): { strikeTerms: string[]; parsedFromUrl?: string; lastParsedAt?: string } {
    const settings = parseTrumpTruthSettings(integration.settingsJson);
    return { strikeTerms: settings.strikeTerms ?? [], parsedFromUrl: settings.parsedFromUrl, lastParsedAt: settings.lastParsedAt };
  }
};

export async function refreshTrumpTruthSettings(integration: Integration, force = false, now = new Date()): Promise<TrumpTruthSettings> {
  let settings = ensureTrumpTruthMarkets(parseTrumpTruthSettings(integration.settingsJson, now), integration.polymarketUrl ?? defaultPolymarketUrl, now);
  settings = await discoverTrumpTruthMarketsIfDue(settings, now);
  const activeMarket = getActiveTrumpTruthMarket(settings.markets ?? [], now);
  if (!activeMarket) {
    return { ...settings, strikeTerms: [], parsedFromUrl: undefined, lastParsedAt: undefined };
  }

  if (force || shouldRefreshMarket(activeMarket, now)) {
    try {
      settings = upsertMarket(settings, await fetchTrumpTruthGammaMarket(activeMarket.url, now), now);
    } catch (error) {
      if (force || !activeMarket.lastParsedAt) {
        throw error;
      }
    }
  }

  return withActiveTrumpTruthMarket(settings, now);
}

export async function upsertTrumpTruthPolymarketMarket(
  integration: Integration,
  url: string,
  now = new Date()
): Promise<TrumpTruthSettings> {
  const settings = ensureTrumpTruthMarkets(parseTrumpTruthSettings(integration.settingsJson, now), integration.polymarketUrl ?? defaultPolymarketUrl, now);
  return withActiveTrumpTruthMarket(upsertMarket(settings, await fetchTrumpTruthGammaMarket(url, now), now), now);
}

export function parseTrumpTruthSettings(settingsJson: string | null, now = new Date()): TrumpTruthSettings {
  if (!settingsJson) {
    return {};
  }

  try {
    const settings = JSON.parse(settingsJson) as TrumpTruthSettings;
    const markets = Array.isArray(settings.markets) ? settings.markets.map(normalizeStoredMarket).filter((market) => market !== null) : undefined;
    if (markets?.length) {
      return withActiveTrumpTruthMarket(
        {
          ...settings,
          markets,
          lastDiscoveryAt: typeof settings.lastDiscoveryAt === "string" ? settings.lastDiscoveryAt : undefined
        },
        now
      );
    }

    return {
      strikeTerms: Array.isArray(settings.strikeTerms) ? settings.strikeTerms.filter(isNonEmptyString) : undefined,
      parsedFromUrl: typeof settings.parsedFromUrl === "string" ? settings.parsedFromUrl : undefined,
      lastParsedAt: typeof settings.lastParsedAt === "string" ? settings.lastParsedAt : undefined,
      lastDiscoveryAt: typeof settings.lastDiscoveryAt === "string" ? settings.lastDiscoveryAt : undefined
    };
  } catch {
    return {};
  }
}

export async function fetchPolymarketStrikeTerms(url: string): Promise<string[]> {
  const response = await fetchWithTimeout(url, { headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" } });
  if (!response.ok) {
    throw new Error(`Polymarket returned HTTP ${response.status}`);
  }

  const html = await response.text();
  return extractPolymarketStrikeTerms(html);
}

async function fetchTrumpTruthGammaMarket(url: string, now: Date): Promise<TrumpTruthMarket> {
  const window = parseTrumpTruthMarketWindow(url, now);
  if (!window) {
    throw new Error("Could not parse Trump Truth weekly Polymarket date range from URL");
  }

  const response = await fetchWithTimeout(`${gammaApiUrl}?slug=${encodeURIComponent(window.slug)}`, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const events = (await response.json()) as GammaEvent[];
  const markets = events.flatMap((event) => event.markets ?? []);
  const terms = extractTrumpTruthGammaStrikeTerms(markets);
  return {
    url,
    slug: window.slug,
    startAt: window.startAt,
    endAt: window.endAt,
    ...terms,
    lastParsedAt: new Date().toISOString()
  };
}

async function discoverTrumpTruthMarketsIfDue(settings: TrumpTruthSettings, now: Date): Promise<TrumpTruthSettings> {
  if (!shouldDiscoverTrumpTruthMarkets(settings, now)) {
    return settings;
  }

  const discoveryTimestamp = now.toISOString();
  try {
    const candidates = await fetchTrumpTruthMarketSearchCandidates(now);
    let nextSettings: TrumpTruthSettings = { ...settings, lastDiscoveryAt: discoveryTimestamp };
    const existingSlugs = new Set((settings.markets ?? []).map((market) => market.slug));

    for (const candidate of candidates) {
      if (existingSlugs.has(candidate.slug)) {
        continue;
      }

      const market = await fetchTrumpTruthGammaMarket(candidate.url, now);
      if (market.strikeTerms.length === 0) {
        continue;
      }

      nextSettings = upsertMarket(nextSettings, market, now);
      existingSlugs.add(market.slug);
    }

    return withActiveTrumpTruthMarket(nextSettings, now);
  } catch {
    return { ...settings, lastDiscoveryAt: discoveryTimestamp };
  }
}

function shouldDiscoverTrumpTruthMarkets(settings: TrumpTruthSettings, now: Date): boolean {
  if (hasQueuedFutureMarket(settings.markets ?? [], now)) {
    return false;
  }

  const activeMarket = getActiveTrumpTruthMarket(settings.markets ?? [], now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return new Date(activeMarket.endAt).getTime() - now.getTime() <= marketDiscoveryLookaheadMs;
}

function hasQueuedFutureMarket(markets: TrumpTruthMarket[], now: Date): boolean {
  const nowMs = now.getTime();
  return markets.some((market) => new Date(market.startAt).getTime() > nowMs);
}

function isDiscoveryIntervalDue(lastDiscoveryAt: string | undefined, now: Date, intervalMs: number): boolean {
  if (!lastDiscoveryAt) {
    return true;
  }

  const lastDiscoveryMs = new Date(lastDiscoveryAt).getTime();
  return Number.isNaN(lastDiscoveryMs) || now.getTime() - lastDiscoveryMs >= intervalMs;
}

async function fetchTrumpTruthMarketSearchCandidates(now: Date): Promise<Array<{ slug: string; url: string }>> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", trumpTruthMarketSearchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");
  searchUrl.searchParams.set("search_tags", "true");
  for (const tag of trumpTruthMarketSearchTags) {
    searchUrl.searchParams.append("events_tag", tag);
  }

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? [])
    .map((event) => normalizeTrumpTruthSearchEvent(event, now))
    .filter((candidate) => candidate !== null);
}

function normalizeTrumpTruthSearchEvent(event: GammaSearchEvent, now: Date): { slug: string; url: string } | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  if (!event.slug.startsWith("what-will-trump-post-this-week-") || !event.title.toLowerCase().startsWith("what will trump post this week")) {
    return null;
  }

  const tagSlugs = new Set((event.tags ?? []).map((tag) => tag.slug).filter(isNonEmptyString));
  if (!trumpTruthMarketSearchTags.every((tag) => tagSlugs.has(tag))) {
    return null;
  }

  if ((event.markets?.length ?? 0) > 0 && !event.markets!.some((market) => extractPolymarketStrikeTerms(market.question ?? "").length > 0)) {
    return null;
  }

  const url = `https://polymarket.com/event/${event.slug}`;
  return parseTrumpTruthMarketWindow(url, now) ? { slug: event.slug, url } : null;
}

function ensureTrumpTruthMarkets(settings: TrumpTruthSettings, fallbackUrl: string, now: Date): TrumpTruthSettings {
  if (settings.markets?.length) {
    return settings;
  }

  const sourceUrl = parseTrumpTruthMarketWindow(settings.parsedFromUrl ?? "", now) ? settings.parsedFromUrl! : fallbackUrl;
  const window = parseTrumpTruthMarketWindow(sourceUrl, now);
  if (!window) {
    return settings;
  }

  return {
    markets: [
      {
        url: sourceUrl,
        slug: window.slug,
        startAt: window.startAt,
        endAt: window.endAt,
        strikeTerms: settings.strikeTerms ?? [],
        resolvedTerms: [],
        activeStrikeTerms: settings.strikeTerms ?? [],
        lastParsedAt: settings.lastParsedAt
      }
    ]
  };
}

function withActiveTrumpTruthMarket(settings: TrumpTruthSettings, now: Date): TrumpTruthSettings {
  const activeMarket = getActiveTrumpTruthMarket(settings.markets ?? [], now);
  return {
    ...settings,
    strikeTerms: activeMarket?.activeStrikeTerms ?? settings.strikeTerms,
    parsedFromUrl: activeMarket?.url ?? settings.parsedFromUrl,
    lastParsedAt: activeMarket?.lastParsedAt ?? settings.lastParsedAt
  };
}

function upsertMarket(settings: TrumpTruthSettings, market: TrumpTruthMarket, now: Date): TrumpTruthSettings {
  const markets = [...(settings.markets ?? [])];
  const existingIndex = markets.findIndex((candidate) => candidate.slug === market.slug);
  if (existingIndex === -1) {
    markets.push(market);
  } else {
    markets[existingIndex] = market;
  }

  markets.sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());
  return withActiveTrumpTruthMarket({ ...settings, markets }, now);
}

function normalizeStoredMarket(value: unknown): TrumpTruthMarket | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const market = value as Partial<TrumpTruthMarket>;
  if (
    !isNonEmptyString(market.url) ||
    !isNonEmptyString(market.slug) ||
    !isNonEmptyString(market.startAt) ||
    !isNonEmptyString(market.endAt)
  ) {
    return null;
  }

  return {
    url: market.url,
    slug: market.slug,
    startAt: market.startAt,
    endAt: market.endAt,
    strikeTerms: Array.isArray(market.strikeTerms) ? sortTerms(market.strikeTerms.filter(isNonEmptyString)) : [],
    resolvedTerms: Array.isArray(market.resolvedTerms) ? sortTerms(market.resolvedTerms.filter(isNonEmptyString)) : [],
    activeStrikeTerms: Array.isArray(market.activeStrikeTerms) ? sortTerms(market.activeStrikeTerms.filter(isNonEmptyString)) : [],
    lastParsedAt: typeof market.lastParsedAt === "string" ? market.lastParsedAt : undefined
  };
}

function shouldRefreshMarket(market: TrumpTruthMarket, now: Date): boolean {
  if (!market.lastParsedAt) {
    return true;
  }

  const lastParsedAt = new Date(market.lastParsedAt).getTime();
  return Number.isNaN(lastParsedAt) || now.getTime() - lastParsedAt >= strikeRefreshIntervalMs;
}

function isResolvedYesMarket(market: GammaMarket): boolean {
  if (!market.closed) {
    return false;
  }

  const prices = parseJsonStringArray(market.outcomePrices).map(Number);
  const outcomes = parseJsonStringArray(market.outcomes);
  const yesIndex = outcomes.findIndex((outcome) => outcome.toLowerCase() === "yes");
  const resolvedPrice = prices[yesIndex === -1 ? 0 : yesIndex];
  return resolvedPrice === 1;
}

function parseJsonStringArray(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function extractPolymarketStrikeTerms(html: string): string[] {
  const decoded = decodeHtmlEntities(html).replace(/\\"/g, '"');
  const terms = new Set<string>();

  for (const match of decoded.matchAll(/Will Trump post\s+([^?<>{}]{1,240}?)\s+on Truth Social this week/gi)) {
    const rawTerm = match[1]?.trim();
    if (!rawTerm || rawTerm.length > 240) {
      continue;
    }

    const quotedTerms = [...rawTerm.matchAll(/["“]([^"”]+)["”]/g)]
      .flatMap((quotedMatch) => quotedMatch[1]?.split("/") ?? [])
      .map((term) => term.trim())
      .filter(isNonEmptyString);
    const candidateTerms = quotedTerms.length
      ? quotedTerms
      : rawTerm.split(/\s+or\s+|\//i).map((part) => part.trim()).filter(Boolean);

    for (const term of candidateTerms) {
      if (term.length <= 80) {
        terms.add(term);
      }
    }
  }

  return [...terms].sort((left, right) => left.localeCompare(right));
}

export function findMatchedStrikeTerms(text: string, strikeTerms: string[]): string[] {
  return strikeTerms.filter((term) => matchesStrikeTerm(text, term));
}

export function matchesStrikeTerm(text: string, term: string): boolean {
  const normalizedText = text.toLowerCase();
  const normalizedTerm = escapeRegExp(term.toLowerCase());
  const sigilPrefix = "(?:^|[^a-z0-9])[@#$]?";
  const suffix = "(?:s|'s|’s)?";
  const pattern = new RegExp(`${sigilPrefix}${normalizedTerm}${suffix}(?=$|[^a-z0-9])`, "i");
  return pattern.test(normalizedText);
}

export function normalizeTruthSocialStatus(status: TruthSocialStatus, strikeTerms: string[]): EventMonitorPost | null {
  const target = status.reblog ?? status;
  const id = target.id ?? status.id;
  const postedAtValue = target.created_at ?? status.created_at;
  if (!id || !postedAtValue) {
    return null;
  }

  const type = status.reblog ? "ReTruth" : status.in_reply_to_id ? "Reply" : status.quote || status.quote_id ? "Quote" : "Truth";
  const text = htmlToText(target.content ?? "");
  const qualifyingText = status.reblog ? "" : htmlToText(status.content ?? "");
  const imageUrls =
    target.media_attachments
      ?.filter((attachment) => attachment.type === "image")
      .map((attachment) => attachment.url ?? attachment.preview_url)
      .filter(isNonEmptyString) ?? [];
  const imageText = "";
  const url = target.url ?? status.url ?? target.uri ?? status.uri ?? `${sourceUrl}/${id}`;

  return {
    id,
    type,
    text,
    qualifyingText,
    postedAt: new Date(postedAtValue),
    url,
    imageUrls: dedupeImageUrls(imageUrls),
    imageText,
    matchedTerms: findMatchedStrikeTerms(qualifyingText, strikeTerms),
    strikeTerms
  };
}

export function normalizeTrumpTruthArchiveItem(item: TrumpTruthArchiveItem, strikeTerms: string[]): EventMonitorPost {
  const text = extractPostText(item.html);
  const imageUrls = extractImageUrls(item.html);
  const imageText = extractImageText(item.html);
  const qualifyingText = [text, imageText].filter(Boolean).join("\n");

  return {
    id: item.originalId || item.id,
    type: "Truth",
    text,
    qualifyingText,
    postedAt: item.postedAt,
    url: item.originalUrl || item.archiveUrl,
    imageUrls,
    imageText,
    matchedTerms: findMatchedStrikeTerms(qualifyingText, strikeTerms),
    strikeTerms
  };
}

export async function enrichTrumpTruthPostWithOcr(post: EventMonitorPost, strikeTerms: string[]): Promise<EventMonitorPost> {
  if (!post.imageUrls.length) {
    return post;
  }

  const ocrText = await parseImageTextWithOcr(post.imageUrls.slice(0, maxOcrImagesPerPost));
  if (!ocrText) {
    return post;
  }

  const imageText = [post.imageText, ocrText].filter(Boolean).join("\n");
  const qualifyingText = [post.text, imageText].filter(Boolean).join("\n");
  return {
    ...post,
    imageText,
    qualifyingText,
    matchedTerms: findMatchedStrikeTerms(qualifyingText, strikeTerms)
  };
}

export function parseTrumpTruthArchiveFeed(xml: string): TrumpTruthArchiveItem[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $("item")
    .toArray()
    .map((element) => {
      const item = $(element);
      const archiveUrl = item.find("link").first().text().trim();
      const originalUrl = item.find("truth\\:originalUrl, originalUrl").first().text().trim();
      const originalId = item.find("truth\\:originalId, originalId").first().text().trim();
      const postedAt = new Date(item.find("pubDate").first().text().trim());
      const description = item.find("description").first().text();
      const title = item.find("title").first().text().trim();
      const id = originalId || archiveUrl;

      return { id, archiveUrl, originalUrl, originalId, postedAt, html: description, title };
    })
    .filter((item) => item.id && item.archiveUrl && !Number.isNaN(item.postedAt.getTime()));
}

async function fetchTrumpTruthArchiveItems(): Promise<TrumpTruthArchiveItem[]> {
  const response = await fetchWithTimeout(archiveFeedUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1",
      accept: "application/rss+xml, application/xml, text/xml"
    }
  });

  if (!response.ok) {
    throw new Error(`Trump's Truth archive returned HTTP ${response.status}`);
  }

  const xml = await response.text();
  const feedItems = parseTrumpTruthArchiveFeed(xml).slice(0, maxPosts);
  return Promise.all(feedItems.map(fetchArchiveDetailIfNeeded));
}

async function fetchArchiveDetailIfNeeded(item: TrumpTruthArchiveItem): Promise<TrumpTruthArchiveItem> {
  try {
    const response = await fetchWithTimeout(
      item.archiveUrl,
      { headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" } },
      archiveDetailTimeoutMs
    );
    if (!response.ok) {
      return item;
    }

    const html = await response.text();
    return { ...item, html: extractArchiveStatusBodyHtml(html) || item.html };
  } catch {
    return item;
  }
}

export function parseTrumpTruthMarketWindow(url: string, now = new Date()): { slug: string; startAt: string; endAt: string } | null {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    return null;
  }

  const rangeMatch = slug.match(/what-will-trump-post-this-week-([a-z]+)-(\d+)-([a-z]+)-(\d+)/i);
  const endOnlyMatch = slug.match(/what-will-trump-post-this-week-([a-z]+)-(\d+)$/i);
  const year = getEasternYear(now);
  const range = rangeMatch
    ? {
        startMonth: monthNumber(rangeMatch[1]),
        startDay: Number(rangeMatch[2]),
        endMonth: monthNumber(rangeMatch[3]),
        endDay: Number(rangeMatch[4])
      }
    : endOnlyMatch
      ? getWeekEndingRange(monthNumber(endOnlyMatch[1]), Number(endOnlyMatch[2]), year)
      : null;

  if (!range) {
    return null;
  }

  const { startMonth, startDay, endMonth, endDay } = range;
  if (!startMonth || !endMonth || !isValidDay(startDay) || !isValidDay(endDay)) {
    return null;
  }

  const startAt = parseManualEasternDateTime(`${year}-${padNumber(startMonth)}-${padNumber(startDay)} 00:00`);
  const endAt = parseManualEasternDateTime(`${year}-${padNumber(endMonth)}-${padNumber(endDay)} 23:59`);
  if (!startAt || !endAt || startAt.getTime() > endAt.getTime()) {
    return null;
  }

  return { slug, startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}

function getWeekEndingRange(
  endMonth: number | null,
  endDay: number,
  year: number
): { startMonth: number; startDay: number; endMonth: number; endDay: number } | null {
  if (!endMonth || !isValidDay(endDay)) {
    return null;
  }

  const startDate = new Date(Date.UTC(year, endMonth - 1, endDay - 6));
  return {
    startMonth: startDate.getUTCMonth() + 1,
    startDay: startDate.getUTCDate(),
    endMonth,
    endDay
  };
}

export function getActiveTrumpTruthMarket(markets: TrumpTruthMarket[], now = new Date()): TrumpTruthMarket | null {
  const nowMs = now.getTime();
  return markets.find((market) => nowMs >= new Date(market.startAt).getTime() && nowMs <= new Date(market.endAt).getTime()) ?? null;
}

export function extractTrumpTruthGammaStrikeTerms(markets: GammaMarket[]): Pick<TrumpTruthMarket, "strikeTerms" | "resolvedTerms" | "activeStrikeTerms"> {
  const strikeTerms = new Set<string>();
  const resolvedTerms = new Set<string>();

  for (const market of markets) {
    const terms = extractPolymarketStrikeTerms(market.question ?? "");
    for (const term of terms) {
      strikeTerms.add(term);
    }

    if (isResolvedYesMarket(market)) {
      for (const term of terms) {
        resolvedTerms.add(term);
      }
    }
  }

  const activeStrikeTerms = [...strikeTerms].filter((term) => !resolvedTerms.has(term));
  return {
    strikeTerms: sortTerms([...strikeTerms]),
    resolvedTerms: sortTerms([...resolvedTerms]),
    activeStrikeTerms: sortTerms(activeStrikeTerms)
  };
}

function extractArchiveStatusBodyHtml(html: string): string {
  const $ = cheerio.load(html);
  const body = $(".status__body").first();
  const attachmentDetails = $(".status-details-attachment").toArray().map((element) => $.html(element));
  return [body.length ? body.html() ?? "" : "", ...attachmentDetails].filter(Boolean).join("\n");
}

function extractImageUrls(html: string): string[] {
  const $ = cheerio.load(html);
  const urls = $("img, a.status-attachment__link, .status-details-attachment__media a")
    .toArray()
    .map((element) => {
      const node = $(element);
      const linkedImage = node.is("img") ? node.closest("a").attr("href") : node.attr("href");
      return isImageUrl(linkedImage) ? linkedImage : node.attr("src") ?? linkedImage;
    })
    .filter(isNonEmptyString)
    .filter((url) => /^https?:\/\//.test(url))
    .filter(isImageUrl);
  return dedupeImageUrls(urls);
}

function dedupeImageUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const url of urls) {
    const key = getImageDedupeKey(url);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(url);
  }

  return deduped;
}

function getImageDedupeKey(value: string): string {
  try {
    const url = new URL(value);
    const fileName = url.pathname.split("/").filter(Boolean).at(-1);
    return fileName ? fileName.toLowerCase() : url.toString().toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function isImageUrl(value: string | undefined): value is string {
  return typeof value === "string" && /^https?:\/\/.+\.(?:png|jpe?g|webp|gif)(?:$|[?#])/i.test(value);
}

function extractImageText(html: string): string {
  const $ = cheerio.load(html);
  const textParts = [
    ...$(".status-details-attachment__text").toArray().map((element) => $(element).text()),
    ...$("img").toArray().flatMap((element) => [$(element).attr("alt"), $(element).attr("title")])
  ];

  return textParts
    .filter(isNonEmptyString)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join("\n");
}

function extractPostText(html: string): string {
  const $ = cheerio.load(html);
  $(".status__attachments, .status-details-attachment, img, button").remove();
  return $.text().replace(/\s+/g, " ").trim();
}

async function parseImageTextWithOcr(imageUrls: string[]): Promise<string> {
  const textParts: string[] = [];
  for (const imageUrl of imageUrls) {
    const text = await recognizeImageText(imageUrl);
    if (text) {
      textParts.push(text);
    }
  }

  return textParts.join("\n");
}

async function recognizeImageText(imageUrl: string): Promise<string> {
  const cached = ocrTextCache.get(imageUrl);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const response = await fetchWithTimeout(imageUrl, { headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" } });
    if (!response.ok) {
      return "";
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const result = await Tesseract.recognize(imageBuffer, "eng");
    const text = result.data.text.replace(/\s+/g, " ").trim();
    ocrTextCache.set(imageUrl, text);
    return text;
  } catch {
    return "";
  }
}

function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  return $.text().replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  const $ = cheerio.load(value);
  return $.text();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function getEasternYear(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).formatToParts(date);
  return Number(parts.find((part) => part.type === "year")?.value);
}

function monthNumber(value: string): number | null {
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

function isValidDay(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 31;
}

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function sortTerms(terms: string[]): string[] {
  return [...new Set(terms)].sort((left, right) => left.localeCompare(right));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

