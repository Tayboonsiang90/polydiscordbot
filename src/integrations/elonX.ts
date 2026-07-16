import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, EventMonitorPost, EventMonitorResult, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://x.com/elonmusk";
const defaultPolymarketUrl = "https://polymarket.com/event/what-will-elon-post-this-week-june-15-21-20260612141418431";
const gammaApiUrl = "https://gamma-api.polymarket.com/events";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const marketSearchQuery = "what will elon post this week";
const marketSearchTags = ["elon-tweets", "mention-markets"];
const defaultXFrontendBaseUrls = ["https://xcancel.com", "https://nitter.kareem.one"];
const defaultXFeedUrls = ["https://xcancel.com/elonmusk/rss"];
const maxPosts = 40;
const sourceTimeoutMs = 30_000;
const strikeRefreshIntervalMs = 5 * 60_000;
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 72 * 60 * 60_000;

export type ElonXSettings = {
  strikeTerms?: string[];
  parsedFromUrl?: string;
  lastParsedAt?: string;
  lastDiscoveryAt?: string;
  markets?: ElonXMarket[];
};

export type ElonXMarket = {
  url: string;
  slug: string;
  startAt: string;
  endAt: string;
  strikeTerms: string[];
  resolvedTerms: string[];
  activeStrikeTerms: string[];
  lastParsedAt?: string;
};

export type ElonXPost = {
  id: string;
  type: "Post" | "Reply" | "Quote" | "Repost";
  text: string;
  qualifyingText: string;
  postedAt: Date;
  url: string;
  imageUrls: string[];
  imageText: string;
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

export const elonXAdapter: WebsiteAdapter = {
  id: "elon-x-strikes",
  commandName: "elonx",
  displayName: "Elon X Posts",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "elonx",
  alertRoleName: "Elon X Alerts",
  alertRoleEmoji: "\uD83D\uDE80",
  supportsStrikes: true,
  getPollIntervalMinutes(integration: Integration, now = new Date()): number {
    return getActiveElonXMarket(getConfiguredElonXMarkets(integration), now) ? 1 : 5;
  },
  getPollIntervalReason(integration: Integration, now = new Date()): string {
    return getActiveElonXMarket(getConfiguredElonXMarkets(integration), now)
      ? "1-minute Elon X strike polling during the active market window."
      : "5-minute Elon X feed polling while no compatible market window is active.";
  },
  getErrorNoticeWindowMinutes(): number {
    return 30;
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    if (!integration) {
      throw new Error("Elon X requires an integration record");
    }

    const result = await this.fetchEventUpdates!(integration);
    const latest = result.posts[0];
    const value = latest ? `${latest.id}\n${latest.type}: ${latest.text || "(no text)"}` : "no recent Elon X posts found";
    return { value, rawValue: value, unit: "latest Elon X post", observedAt: result.observedAt };
  },
  async fetchEventUpdates(integration: Integration): Promise<EventMonitorResult> {
    const now = new Date();
    const settings = await refreshElonXSettings(integration, false, now);
    const activeMarket = getActiveElonXMarket(settings.markets ?? [], now);
    const activeStrikeTerms = activeMarket?.activeStrikeTerms ?? [];
    const sourceResult = await fetchElonXPosts();
    const sourcePosts = sourceResult.posts
      .slice(0, maxPosts)
      .map((post) => normalizeElonXEventPost(post, activeStrikeTerms));
    const posts = activeMarket
      ? sourcePosts
          .filter((post) => isPostInElonXMarketWindow(post, activeMarket))
          .map((post) => attachElonXMarketAuditFields(post, activeMarket))
      : sourcePosts.map((post) => attachElonXNoActiveMarketFields(post, settings));

    return {
      posts,
      strikeTerms: activeStrikeTerms,
      polymarketUrl: activeMarket?.url ?? settings.parsedFromUrl,
      checkTitle: "Event check complete",
      checkFields: buildElonXCheckFields(posts, sourcePosts[0], activeMarket, settings, sourceResult.source),
      observedAt: now
    };
  },
  async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
    return JSON.stringify(await refreshElonXSettings(integration, options?.force));
  },
  getStrikeTerms(integration: Integration): { strikeTerms: string[]; parsedFromUrl?: string; lastParsedAt?: string } {
    const settings = parseElonXSettings(integration.settingsJson);
    return { strikeTerms: settings.strikeTerms ?? [], parsedFromUrl: settings.parsedFromUrl, lastParsedAt: settings.lastParsedAt };
  },
  async upsertPolymarketMarket(
    integration: Integration,
    url: string
  ): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    const settings = await upsertElonXPolymarketMarket(integration, url);
    return { settingsJson: JSON.stringify(settings), activeUrl: settings.parsedFromUrl ?? integration.polymarketUrl };
  },
  shouldAlertOnEventPost(post: EventMonitorPost): boolean {
    return post.type !== "Repost";
  }
};

export async function refreshElonXSettings(integration: Integration, force = false, now = new Date()): Promise<ElonXSettings> {
  let settings = ensureElonXMarkets(parseElonXSettings(integration.settingsJson, now), integration.polymarketUrl ?? defaultPolymarketUrl, now);
  settings = await discoverElonXMarketsIfDue(settings, now);
  const displayMarket = getDisplayElonXMarket(settings.markets ?? [], now);
  const activeMarket = getActiveElonXMarket(settings.markets ?? [], now);
  const marketToRefresh = activeMarket ?? displayMarket;

  if (marketToRefresh && (force || shouldRefreshMarket(marketToRefresh, now))) {
    try {
      settings = upsertMarket(settings, await fetchElonXGammaMarket(marketToRefresh.url, now), now);
    } catch (error) {
      if (force || !marketToRefresh.lastParsedAt) {
        throw error;
      }
    }
  }

  return withDisplayElonXMarket(settings, now);
}

export async function upsertElonXPolymarketMarket(integration: Integration, url: string, now = new Date()): Promise<ElonXSettings> {
  const settings = ensureElonXMarkets(parseElonXSettings(integration.settingsJson, now), integration.polymarketUrl ?? defaultPolymarketUrl, now);
  return withDisplayElonXMarket(upsertMarket(settings, await fetchElonXGammaMarket(url, now), now), now);
}

export function parseElonXSettings(settingsJson: string | null, now = new Date()): ElonXSettings {
  const settings = parseSettingsJson(settingsJson) as ElonXSettings;
  const markets = Array.isArray(settings.markets) ? settings.markets.map(normalizeStoredMarket).filter((market) => market !== null) : undefined;
  if (markets?.length) {
    return withDisplayElonXMarket(
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
}

export function parseElonXMarketWindow(url: string, now = new Date()): { slug: string; startAt: string; endAt: string } | null {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    return null;
  }

  const rangeMatch = slug.match(/what-will-elon-post-this-week-([a-z]+)-(\d+)-([a-z]+)-(\d+)/i);
  const sameMonthRangeMatch = slug.match(/what-will-elon-post-this-week-([a-z]+)-(\d+)-(\d+)/i);
  const endOnlyMatch = slug.match(/what-will-elon-post-this-week-([a-z]+)-(\d+)$/i);
  const year = getEasternYear(now);
  const range = rangeMatch
    ? {
        startMonth: monthNumber(rangeMatch[1]),
        startDay: Number(rangeMatch[2]),
        endMonth: monthNumber(rangeMatch[3]),
        endDay: Number(rangeMatch[4])
      }
    : sameMonthRangeMatch
      ? {
          startMonth: monthNumber(sameMonthRangeMatch[1]),
          startDay: Number(sameMonthRangeMatch[2]),
          endMonth: monthNumber(sameMonthRangeMatch[1]),
          endDay: Number(sameMonthRangeMatch[3])
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

export function parseElonXCancelTimeline(html: string, baseUrl = defaultXFrontendBaseUrls[0]): ElonXPost[] {
  const document = cheerio.load(html);
  const posts: ElonXPost[] = [];

  document(".timeline-item").each((_, element) => {
    const item = document(element);
    if (item.find(".pinned").length > 0) {
      return;
    }

    const link = item.find("a.tweet-link").first().attr("href") ?? item.find(".tweet-date a").first().attr("href") ?? "";
    const id = extractTweetId(link);
    const timestamp = parseXCancelTimestamp(item.find(".tweet-date a").first().attr("title") ?? "");
    if (!id || !timestamp) {
      return;
    }

    const username = (item.attr("data-username") ?? "").trim().toLowerCase();
    const hasRepostHeader = item.find(".retweet-header").length > 0;
    if (!hasRepostHeader && username && username !== "elonmusk") {
      return;
    }

    const tweetBody = item.find(".tweet-body").first().clone();
    tweetBody.find(".quote").remove();
    const text = normalizeText(tweetBody.find(".tweet-content").first().text());
    const imageUrls = extractXCancelImageUrls(document, tweetBody);
    const imageText = extractXCancelImageText(document, tweetBody);
    const type: ElonXPost["type"] = hasRepostHeader
      ? "Repost"
      : tweetBody.find(".replying-to").length > 0
        ? "Reply"
        : item.find(".quote").length > 0
          ? "Quote"
          : "Post";

    posts.push({
      id,
      type,
      text,
      qualifyingText: type === "Repost" ? "" : text,
      postedAt: timestamp,
      url: normalizeXPostUrl(link, id, baseUrl),
      imageUrls,
      imageText
    });
  });

  return sortPostsNewestFirst(dedupePosts(posts));
}

export function parseElonXNitterFeed(xml: string, feedUrl = defaultXFeedUrls[0]): ElonXPost[] {
  const document = cheerio.load(xml, { xmlMode: true });
  const posts: ElonXPost[] = [];

  document("item").each((_, element) => {
    const item = document(element);
    const title = normalizeText(item.find("title").first().text());
    const descriptionHtml = item.find("description").first().text();
    const descriptionText = htmlToText(descriptionHtml);
    const link = item.find("link").first().text().trim();
    const pubDate = item.find("pubDate").first().text().trim();
    const timestamp = new Date(pubDate);
    const id = extractTweetId(link) ?? buildStableFeedPostId(link, pubDate, title);
    if (!id || Number.isNaN(timestamp.getTime())) {
      return;
    }

    const type = inferNitterFeedPostType(title, descriptionText);
    const text = normalizeNitterFeedText(title, descriptionText);
    const imageUrls = extractNitterFeedImageUrls(document, item);

    posts.push({
      id,
      type,
      text,
      qualifyingText: type === "Repost" ? "" : text,
      postedAt: timestamp,
      url: normalizeXPostUrl(link, id, feedUrl),
      imageUrls,
      imageText: ""
    });
  });

  return sortPostsNewestFirst(dedupePosts(posts));
}

export function extractElonXGammaStrikeTerms(markets: GammaMarket[]): Pick<ElonXMarket, "strikeTerms" | "resolvedTerms" | "activeStrikeTerms"> {
  const strikeTerms = new Set<string>();
  const resolvedTerms = new Set<string>();

  for (const market of markets) {
    const terms = extractElonXStrikeTerms(market.question ?? "");
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

export function extractElonXStrikeTerms(text: string): string[] {
  const decoded = decodeHtmlEntities(text).replace(/\\"/g, '"');
  const terms = new Set<string>();

  for (const match of decoded.matchAll(/Will Elon post\s+([^?<>{}]{1,240}?)\s+on X this week/gi)) {
    const rawTerm = match[1]?.trim();
    if (!rawTerm || rawTerm.length > 240) {
      continue;
    }

    const quotedTerms = [...rawTerm.matchAll(/["“]([^"”]+)["”]/g)]
      .flatMap((quotedMatch) => quotedMatch[1]?.split(/\s+or\s+|\//i) ?? [])
      .map((term) => term.trim())
      .filter(isNonEmptyString);
    const candidateTerms = quotedTerms.length
      ? quotedTerms
      : rawTerm.split(/\s+or\s+|\//i).map((part) => part.trim()).filter(Boolean);

    for (const term of candidateTerms) {
      const normalized = term.replace(/^["“]|["”]$/g, "").trim();
      if (normalized.length > 0 && normalized.length <= 80) {
        terms.add(normalized);
      }
    }
  }

  return sortTerms([...terms]);
}

export function findMatchedElonXStrikeTerms(text: string, strikeTerms: string[]): string[] {
  return strikeTerms.filter((term) => matchesStrikeTerm(text, term));
}

function normalizeElonXEventPost(post: ElonXPost, strikeTerms: string[]): EventMonitorPost {
  const matchedTerms = post.type === "Repost" ? [] : findMatchedElonXStrikeTerms(post.qualifyingText, strikeTerms);
  return {
    id: post.id,
    type: post.type,
    sourceLabel: "X",
    buttonLabel: "Open X",
    textFieldName: "X post text",
    text: post.text,
    qualifyingText: post.type === "Repost" ? "" : post.qualifyingText,
    postedAt: post.postedAt,
    url: post.url,
    imageUrls: post.imageUrls,
    imageText: post.imageText,
    matchedTerms,
    strikeTerms
  };
}

async function fetchElonXPosts(): Promise<{ posts: ElonXPost[]; source: string }> {
  const errors: string[] = [];

  for (const baseUrl of getXFrontendBaseUrls()) {
    try {
      const posts = await fetchElonXPostsFromFrontend(baseUrl);
      if (posts.length > 0) {
        return { posts, source: `${baseUrl} public page` };
      }

      errors.push(`${baseUrl}: no timeline posts found`);
    } catch (error) {
      errors.push(`${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    return { posts: await fetchElonXPostsFromNitterFeeds(), source: "Nitter/XCancel RSS" };
  } catch (error) {
    errors.push(`Nitter/XCancel RSS: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new Error(`Public Elon X polling failed: ${errors.join(" | ")}`);
}

async function fetchElonXPostsFromNitterFeeds(): Promise<ElonXPost[]> {
  const feedUrls = getXFeedUrls();
  const posts: ElonXPost[] = [];
  const errors: string[] = [];

  for (const feedUrl of feedUrls) {
    try {
      const response = await fetchWithTimeout(
        feedUrl,
        {
          headers: {
            accept: "application/rss+xml, application/xml, text/xml",
            "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
          }
        },
        sourceTimeoutMs
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const xml = await response.text();
      if (isUnavailableXFrontendPage(xml) || isUnavailableXFeed(xml)) {
        throw new Error("RSS feed returned an unavailable/whitelist placeholder");
      }

      const feedPosts = parseElonXNitterFeed(xml, feedUrl);
      if (!feedPosts.length && !/<item[\s>]/i.test(xml)) {
        throw new Error("RSS feed returned no items");
      }

      posts.push(...feedPosts);
    } catch (error) {
      errors.push(`${feedUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!posts.length && errors.length === feedUrls.length) {
    throw new Error(errors.join(" | "));
  }

  return sortPostsNewestFirst(dedupePosts(posts)).slice(0, maxPosts);
}

async function fetchElonXPostsFromFrontend(baseUrl: string): Promise<ElonXPost[]> {
  const profileUrl = buildFrontendUrl(baseUrl, "/elonmusk");
  const repliesUrl = buildFrontendUrl(baseUrl, "/elonmusk/with_replies");
  const posts: ElonXPost[] = [];

  for (const url of [profileUrl, repliesUrl]) {
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
        }
      },
      sourceTimeoutMs
    );
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }

    const html = await response.text();
    if (isUnavailableXFrontendPage(html)) {
      throw new Error(`${url} returned a bot-check or unavailable page`);
    }

    posts.push(...parseElonXCancelTimeline(html, baseUrl));
  }

  return sortPostsNewestFirst(dedupePosts(posts)).slice(0, maxPosts);
}

async function fetchElonXGammaMarket(url: string, now: Date): Promise<ElonXMarket> {
  const window = parseElonXMarketWindow(url, now);
  if (!window) {
    throw new Error("Could not parse Elon X weekly Polymarket date range from URL");
  }

  const response = await fetchWithTimeout(`${gammaApiUrl}?slug=${encodeURIComponent(window.slug)}`, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const events = (await response.json()) as GammaEvent[];
  const markets = events.flatMap((event) => event.markets ?? []);
  return {
    url,
    slug: window.slug,
    startAt: window.startAt,
    endAt: window.endAt,
    ...extractElonXGammaStrikeTerms(markets),
    lastParsedAt: new Date().toISOString()
  };
}

async function discoverElonXMarketsIfDue(settings: ElonXSettings, now: Date): Promise<ElonXSettings> {
  if (!shouldDiscoverElonXMarkets(settings, now)) {
    return settings;
  }

  const discoveryTimestamp = now.toISOString();
  try {
    const candidates = await fetchElonXMarketSearchCandidates(now);
    let nextSettings: ElonXSettings = { ...settings, lastDiscoveryAt: discoveryTimestamp };
    const existingSlugs = new Set((settings.markets ?? []).map((market) => market.slug));

    for (const candidate of candidates) {
      if (existingSlugs.has(candidate.slug)) {
        continue;
      }

      const market = await fetchElonXGammaMarket(candidate.url, now);
      if (market.strikeTerms.length === 0) {
        continue;
      }

      nextSettings = upsertMarket(nextSettings, market, now);
      existingSlugs.add(market.slug);
    }

    return withDisplayElonXMarket(nextSettings, now);
  } catch {
    return { ...settings, lastDiscoveryAt: discoveryTimestamp };
  }
}

async function fetchElonXMarketSearchCandidates(now: Date): Promise<Array<{ slug: string; url: string }>> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", marketSearchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");
  searchUrl.searchParams.set("search_tags", "true");
  for (const tag of marketSearchTags) {
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
    .map((event) => normalizeElonXSearchEvent(event, now))
    .filter((candidate) => candidate !== null);
}

function normalizeElonXSearchEvent(event: GammaSearchEvent, now: Date): { slug: string; url: string } | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  if (!event.slug.startsWith("what-will-elon-post-this-week-") || !event.title.toLowerCase().startsWith("what will elon post this week")) {
    return null;
  }

  const tagSlugs = new Set((event.tags ?? []).map((tag) => tag.slug).filter(isNonEmptyString));
  if (!marketSearchTags.every((tag) => tagSlugs.has(tag))) {
    return null;
  }

  if ((event.markets?.length ?? 0) > 0 && !event.markets!.some((market) => extractElonXStrikeTerms(market.question ?? "").length > 0)) {
    return null;
  }

  const url = `https://polymarket.com/event/${event.slug}`;
  return parseElonXMarketWindow(url, now) ? { slug: event.slug, url } : null;
}

function ensureElonXMarkets(settings: ElonXSettings, fallbackUrl: string, now: Date): ElonXSettings {
  if (settings.markets?.length) {
    return settings;
  }

  const sourceMarketUrl = parseElonXMarketWindow(settings.parsedFromUrl ?? "", now) ? settings.parsedFromUrl! : fallbackUrl;
  const window = parseElonXMarketWindow(sourceMarketUrl, now);
  if (!window) {
    return settings;
  }

  return {
    ...settings,
    markets: [
      {
        url: sourceMarketUrl,
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

function withDisplayElonXMarket(settings: ElonXSettings, now: Date): ElonXSettings {
  const displayMarket = getDisplayElonXMarket(settings.markets ?? [], now);
  return {
    ...settings,
    strikeTerms: displayMarket?.activeStrikeTerms ?? settings.strikeTerms,
    parsedFromUrl: displayMarket?.url ?? settings.parsedFromUrl,
    lastParsedAt: displayMarket?.lastParsedAt ?? settings.lastParsedAt
  };
}

function upsertMarket(settings: ElonXSettings, market: ElonXMarket, now: Date): ElonXSettings {
  const markets = [...(settings.markets ?? [])];
  const existingIndex = markets.findIndex((candidate) => candidate.slug === market.slug);
  if (existingIndex === -1) {
    markets.push(market);
  } else {
    markets[existingIndex] = market;
  }

  markets.sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  return withDisplayElonXMarket({ ...settings, markets }, now);
}

function getConfiguredElonXMarkets(integration: Integration): ElonXMarket[] {
  const settings = parseElonXSettings(integration.settingsJson);
  if (settings.markets?.length) {
    return settings.markets;
  }

  const url = settings.parsedFromUrl ?? integration.polymarketUrl ?? defaultPolymarketUrl;
  const window = parseElonXMarketWindow(url);
  return window
    ? [
        {
          url,
          slug: window.slug,
          startAt: window.startAt,
          endAt: window.endAt,
          strikeTerms: settings.strikeTerms ?? [],
          resolvedTerms: [],
          activeStrikeTerms: settings.strikeTerms ?? [],
          lastParsedAt: settings.lastParsedAt
        }
      ]
    : [];
}

function getActiveElonXMarket(markets: ElonXMarket[], now = new Date()): ElonXMarket | null {
  const nowMs = now.getTime();
  return markets.find((market) => nowMs >= Date.parse(market.startAt) && nowMs <= Date.parse(market.endAt)) ?? null;
}

function getDisplayElonXMarket(markets: ElonXMarket[], now = new Date()): ElonXMarket | null {
  const activeMarket = getActiveElonXMarket(markets, now);
  if (activeMarket) {
    return activeMarket;
  }

  const nowMs = now.getTime();
  const futureMarket = markets.find((market) => Date.parse(market.startAt) > nowMs);
  return futureMarket ?? markets.at(-1) ?? null;
}

function shouldDiscoverElonXMarkets(settings: ElonXSettings, now: Date): boolean {
  if (hasQueuedFutureMarket(settings.markets ?? [], now)) {
    return false;
  }

  const activeMarket = getActiveElonXMarket(settings.markets ?? [], now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt) - now.getTime() <= marketDiscoveryLookaheadMs;
}

function hasQueuedFutureMarket(markets: ElonXMarket[], now: Date): boolean {
  const nowMs = now.getTime();
  return markets.some((market) => Date.parse(market.startAt) > nowMs);
}

function isDiscoveryIntervalDue(lastDiscoveryAt: string | undefined, now: Date, intervalMs: number): boolean {
  if (!lastDiscoveryAt) {
    return true;
  }

  const lastDiscoveryMs = Date.parse(lastDiscoveryAt);
  return Number.isNaN(lastDiscoveryMs) || now.getTime() - lastDiscoveryMs >= intervalMs;
}

function shouldRefreshMarket(market: ElonXMarket, now: Date): boolean {
  if (!market.lastParsedAt) {
    return true;
  }

  const lastParsedAt = Date.parse(market.lastParsedAt);
  return Number.isNaN(lastParsedAt) || now.getTime() - lastParsedAt >= strikeRefreshIntervalMs;
}

function normalizeStoredMarket(value: unknown): ElonXMarket | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const market = value as Partial<ElonXMarket>;
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

function attachElonXMarketAuditFields(post: EventMonitorPost, market: ElonXMarket): EventMonitorPost {
  return {
    ...post,
    polymarketUrl: market.url,
    fields: [
      ...(post.fields ?? []),
      { name: "Posted at audit", value: `ET: ${formatEasternDateTime(post.postedAt)}\nUTC: ${post.postedAt.toISOString()}`, inline: false },
      {
        name: "Market window check",
        value: `Inside active Polymarket window\nET: ${formatEasternDateTime(market.startAt)} to ${formatEasternDateTime(market.endAt)}`,
        inline: false
      },
      ...(post.type === "Repost" ? [{ name: "Resolution note", value: "Reposts do not count for strike detection.", inline: false }] : [])
    ]
  };
}

function attachElonXNoActiveMarketFields(post: EventMonitorPost, settings: ElonXSettings): EventMonitorPost {
  const displayMarket = settings.markets?.[0];
  const nextWindow = displayMarket ? `${formatEasternDateTime(displayMarket.startAt)} to ${formatEasternDateTime(displayMarket.endAt)}` : "none";
  return {
    ...post,
    polymarketUrl: settings.parsedFromUrl ?? "not active",
    strikeTerms: [],
    matchedTerms: [],
    fields: [
      ...(post.fields ?? []),
      {
        name: "Market mode",
        value: `No compatible active Elon X Polymarket window is live. This alert is feed-only; strike detection is disabled.\nNext/known window: ${nextWindow}`,
        inline: false
      },
      { name: "Posted at audit", value: `ET: ${formatEasternDateTime(post.postedAt)}\nUTC: ${post.postedAt.toISOString()}`, inline: false }
    ]
  };
}

function buildElonXCheckFields(
  posts: EventMonitorPost[],
  latestSourcePost: EventMonitorPost | undefined,
  activeMarket: ElonXMarket | null,
  settings: ElonXSettings,
  source: string
): NonNullable<EventMonitorResult["checkFields"]> {
  const displayMarket = getDisplayElonXMarket(settings.markets ?? []);
  const suppressedReposts = posts.filter((post) => post.type === "Repost").length;
  const alertablePosts = posts.filter((post) => post.type !== "Repost");
  const strikeHitPosts = posts.filter((post) => post.matchedTerms.length > 0);
  return [
    { name: activeMarket ? "Posts in active window" : "Monitored feed posts", value: String(posts.length), inline: true },
    {
      name: "Alert eligibility",
      value: [
        `Alertable non-reposts: ${alertablePosts.length}`,
        `Suppressed reposts: ${suppressedReposts}`,
        `Text strike hits: ${strikeHitPosts.length}`,
        "Reposts are intentionally ignored for alerts because they do not qualify for strike detection."
      ].join("\n"),
      inline: false
    },
    {
      name: "Active Polymarket market",
      value: activeMarket
        ? `${activeMarket.url}\nWindow: ${formatEasternDateTime(activeMarket.startAt)} to ${formatEasternDateTime(activeMarket.endAt)}`
        : displayMarket
          ? `none active yet\nNext/known: ${displayMarket.url}\nWindow: ${formatEasternDateTime(displayMarket.startAt)} to ${formatEasternDateTime(displayMarket.endAt)}`
          : "none found",
      inline: false
    },
    {
      name: "Latest source post",
      value: latestSourcePost
        ? [`ID: ${latestSourcePost.id}`, `Type: ${latestSourcePost.type}`, `Posted: ${formatEasternDateTime(latestSourcePost.postedAt)}`, latestSourcePost.url].join("\n")
        : "none returned from public X frontend",
      inline: false
    },
    {
      name: activeMarket ? "Latest in active window" : "Latest monitored feed post",
      value: posts[0] ? [`ID: ${posts[0].id}`, `Posted: ${formatEasternDateTime(posts[0].postedAt)}`, posts[0].url].join("\n") : "none",
      inline: false
    },
    {
      name: "Latest alertable post",
      value: alertablePosts[0]
        ? [
            `ID: ${alertablePosts[0].id}`,
            `Type: ${alertablePosts[0].type}`,
            `Posted: ${formatEasternDateTime(alertablePosts[0].postedAt)}`,
            alertablePosts[0].url
          ].join("\n")
        : "none in returned source rows",
      inline: false
    },
    {
      name: "Strike terms",
      value: (settings.strikeTerms ?? []).length ? (settings.strikeTerms ?? []).join(", ") : "none parsed yet",
      inline: false
    },
    {
      name: "Source note",
      value: `${source}. This is a free unauthenticated X frontend, not the paid X API; if it is stale or blocked, the bot will fail loudly instead of guessing.`,
      inline: false
    }
  ];
}

function isPostInElonXMarketWindow(post: EventMonitorPost, market: Pick<ElonXMarket, "startAt" | "endAt">): boolean {
  const postedAt = post.postedAt.getTime();
  const startAt = Date.parse(market.startAt);
  const endAt = Date.parse(market.endAt);
  return [postedAt, startAt, endAt].every((value) => !Number.isNaN(value)) && postedAt >= startAt && postedAt <= endAt;
}

function extractXCancelImageUrls(document: cheerio.CheerioAPI, tweetBody: cheerio.Cheerio<AnyNode>): string[] {
  const urls = tweetBody
    .find("a.still-image")
    .toArray()
    .map((element) => document(element).attr("href") ?? document(element).find("img").first().attr("src"))
    .filter(isNonEmptyString)
    .filter((url) => /^https?:\/\//i.test(url));
  return uniqueStrings(urls);
}

function extractXCancelImageText(document: cheerio.CheerioAPI, tweetBody: cheerio.Cheerio<AnyNode>): string {
  return uniqueStrings(
    tweetBody
      .find("a.still-image img")
      .toArray()
      .flatMap((element) => [document(element).attr("alt"), document(element).attr("title")])
      .filter(isNonEmptyString)
      .map(normalizeText)
      .filter(Boolean)
  ).join("\n");
}

function parseXCancelTimestamp(value: string): Date | null {
  const cleaned = value.replace(/[·Â]+/g, " ").replace(/\s+/g, " ").trim();
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractTweetId(link: string): string | null {
  return link.match(/\/status(?:es)?\/(\d+)/)?.[1] ?? null;
}

function normalizeXPostUrl(link: string, id: string, baseUrl: string): string {
  try {
    const parsed = new URL(link, baseUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const handle = parts[0] ?? "elonmusk";
    return `https://x.com/${handle}/status/${id}`;
  } catch {
    return `https://x.com/elonmusk/status/${id}`;
  }
}

export function getXFrontendBaseUrls(): string[] {
  const configured = process.env.ELON_X_NITTER_BASE_URLS ?? process.env.ELON_X_FRONTEND_BASE_URLS;
  const urls = configured?.split(",").map((url) => url.trim()).filter(Boolean) ?? [];
  return uniqueStrings([...urls, ...defaultXFrontendBaseUrls]).map((url) => url.replace(/\/+$/, ""));
}

export function getXFeedUrls(): string[] {
  const configured = process.env.ELON_X_NITTER_FEEDS ?? process.env.ELON_X_RSS_URLS;
  const urls = configured?.split(",").map((url) => url.trim()).filter(Boolean) ?? [];
  return uniqueStrings([...urls, ...defaultXFeedUrls]);
}

function buildFrontendUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function isUnavailableXFrontendPage(html: string): boolean {
  return /RSS reader not yet whitelisted|Making sure you&#39;re not a bot|Making sure you're not a bot|Verifying your browser/i.test(html);
}

function isUnavailableXFeed(xml: string): boolean {
  return /RSS reader not yet whitelisted|RSS reader not yet whitelist/i.test(xml);
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

function matchesStrikeTerm(text: string, term: string): boolean {
  const normalizedText = text.toLowerCase();
  const normalizedTerm = escapeRegExp(term.toLowerCase());
  const sigilPrefix = "(?:^|[^a-z0-9])[@#$]?";
  const suffix = "(?:s|'s|’s)?";
  const pattern = new RegExp(`${sigilPrefix}${normalizedTerm}${suffix}(?=$|[^a-z0-9])`, "i");
  return pattern.test(normalizedText);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value: string): string {
  return cheerio.load(value).text();
}

function htmlToText(html: string): string {
  return cheerio.load(html).text().replace(/\s+/g, " ").trim();
}

function normalizeNitterFeedText(title: string, descriptionText: string): string {
  const preferred = descriptionText || title;
  return normalizeText(
    preferred
      .replace(/^RT by @?elonmusk:\s*/i, "")
      .replace(/^R to @[^:]+:\s*/i, "")
      .replace(/^Elon Musk\s*\(@elonmusk\):\s*/i, "")
      .replace(/^Elon Musk:\s*/i, "")
  );
}

function inferNitterFeedPostType(title: string, descriptionText: string): ElonXPost["type"] {
  const combined = `${title}\n${descriptionText}`;
  if (/^RT by @?elonmusk:|^RT @/i.test(combined)) {
    return "Repost";
  }

  if (/^R to @|Replying to @/i.test(combined)) {
    return "Reply";
  }

  if (/\bQuote(?:d)?(?: post| tweet)?\b/i.test(combined)) {
    return "Quote";
  }

  return "Post";
}

function extractNitterFeedImageUrls(document: cheerio.CheerioAPI, item: cheerio.Cheerio<AnyNode>): string[] {
  const urls = item
    .find("enclosure, media\\:content, content")
    .toArray()
    .flatMap((element) => [document(element).attr("url"), document(element).attr("href")])
    .filter(isNonEmptyString)
    .filter((url) => /^https?:\/\//i.test(url));
  return uniqueStrings(urls);
}

function buildStableFeedPostId(link: string, pubDate: string, title: string): string {
  let hash = 0;
  for (const character of `${link}|${pubDate}|${title}`) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return `feed-${hash.toString(16)}`;
}

function sortPostsNewestFirst(posts: ElonXPost[]): ElonXPost[] {
  return [...posts].sort((left, right) => right.postedAt.getTime() - left.postedAt.getTime() || right.id.localeCompare(left.id));
}

function dedupePosts(posts: ElonXPost[]): ElonXPost[] {
  const seen = new Set<string>();
  const deduped: ElonXPost[] = [];
  for (const post of posts) {
    if (seen.has(post.id)) {
      continue;
    }

    seen.add(post.id);
    deduped.push(post);
  }
  return deduped;
}

function sortTerms(terms: string[]): string[] {
  return [...new Set(terms)].sort((left, right) => left.localeCompare(right));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getEasternYear(date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" });
  return Number(formatter.format(date));
}

function formatEasternDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ET`;
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

function isValidDay(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 31;
}

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
