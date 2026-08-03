import * as cheerio from "cheerio";
import { Jimp, rgbaToInt } from "jimp";
import Tesseract from "tesseract.js";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import {
  parsePolymarketDateRangeWindow,
  resolveIntegrationPolymarketQueue,
  upsertPolymarketQueueUrl,
  type PolymarketQueueMarket
} from "../polymarketQueue.js";
import { findMatchedStrikeTerms } from "./trumpTruth.js";
import type { AdapterValue, EventMonitorOptions, EventMonitorPost, EventMonitorResult, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://nytimes.pressreader.com/the-new-york-times/";
const defaultPolymarketUrl =
  "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-june-15-june-21-20260612213503327";
const gammaApiUrl = "https://gamma-api.polymarket.com/events";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const nytMarketSearchQuery = "NYT front page headlines";
const nytSeriesSlug = "nyt-headlines";
const nytTagSlug = "new-york-times";
const nytTagId = "103236";
const strikeRefreshIntervalMs = 5 * 60_000;
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 72 * 60 * 60_000;
const pageImageWidth = 1200;
const pressReaderPublicationCid = "8302";
const ocrCache = new Map<string, NytOcrResult>();

export type NytFrontPageSettings = {
  nytStrikeTerms?: string[];
  nytParsedFromUrl?: string;
  nytLastParsedAt?: string;
  nytLatestIssueDate?: string;
  polymarketMarkets?: PolymarketQueueMarket[];
  lastNytDiscoveryAt?: string;
};

type GammaEvent = {
  markets?: GammaMarket[];
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

type GammaMarket = {
  question?: string;
  groupItemTitle?: string;
  closed?: boolean;
  outcomePrices?: string[] | string;
  outcomes?: string[] | string;
};

export type NytFrontPageIssue = {
  id: string;
  date: string;
  pageUrl: string;
  pageImageUrl: string;
  headlines: string[];
};

type JsonLdNode = {
  "@type"?: string | string[];
  "@graph"?: JsonLdNode[];
  datePublished?: string;
  headline?: string;
  thumbnailUrl?: string;
};

export type NytOcrWord = {
  text: string;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
};

export type NytHighlightBox = NytOcrWord["bbox"] & {
  term: string;
};

type NytOcrResult = {
  text: string;
  words: NytOcrWord[];
  imageBuffer: Buffer;
};

export const nytFrontPageAdapter: WebsiteAdapter = {
  id: "nyt-front-page",
  commandName: "nytfront",
  displayName: "NYT Front Page",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "nytfront",
  alertRoleName: "NYT Front Page Alerts",
  alertRoleEmoji: "\uD83D\uDCF0",
  manualCheckMode: "historical",
  supportsStrikes: true,
  recheckLatestEventPostUntilAlerted: true,
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Fixed hourly check for the latest NYT New York print front page",
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const settings = integration ? await refreshNytFrontPageSettings(integration) : { nytParsedFromUrl: defaultPolymarketUrl };
    const strikeTerms = settings.nytStrikeTerms ?? [];
    const post = await fetchLatestNytFrontPagePost(strikeTerms, getNytActivePolymarketUrl(settings, integration));
    const enriched = await enrichNytFrontPagePostWithOcr(post, strikeTerms);
    const value = formatNytFrontPageValue(enriched);
    return { value, rawValue: value, unit: "NYT New York print front page", observedAt: new Date() };
  },
  async fetchEventUpdates(integration: Integration, options?: EventMonitorOptions): Promise<EventMonitorResult> {
    const settings = parseNytDiscoverySettings(integration.settingsJson);
    const issueDate = await fetchLatestIssueDate();
    const issuePolymarketUrl = getNytPolymarketUrlForIssueDate(settings.polymarketMarkets, issueDate);
    let strikeTerms = settings.nytStrikeTerms ?? [];
    let polymarketUrl = getNytActivePolymarketUrl(settings, integration);
    let nextSettings: Record<string, unknown> & NytFrontPageSettings = {
      ...settings,
      nytLatestIssueDate: issueDate
    };
    if (issuePolymarketUrl) {
      polymarketUrl = issuePolymarketUrl;
      if (normalizeNytPolymarketEventUrl(settings.nytParsedFromUrl) !== issuePolymarketUrl) {
        strikeTerms = await fetchNytFrontPageGammaStrikeTerms(issuePolymarketUrl);
        nextSettings = {
          ...nextSettings,
          nytStrikeTerms: strikeTerms,
          nytParsedFromUrl: issuePolymarketUrl,
          nytLastParsedAt: new Date().toISOString()
        };
      }
    }
    const settingsJson = JSON.stringify(nextSettings);
    const clockPolymarketUrl = normalizeNytPolymarketEventUrl(integration.polymarketUrl);
    if (options?.historicalCheck) {
      const result = await fetchHistoricalNytFrontPageCheck(strikeTerms, polymarketUrl);
      return {
        ...result,
        settingsJson,
        polymarketUrl: clockPolymarketUrl
      };
    }

    const post = await fetchNytFrontPagePostForDate(issueDate, strikeTerms, polymarketUrl);
    return {
      posts: [post],
      strikeTerms,
      polymarketUrl,
      settingsJson,
      observedAt: new Date()
    };
  },
  async enrichEventPost(post: EventMonitorPost, strikeTerms: string[]): Promise<EventMonitorPost> {
    return enrichNytFrontPagePostWithOcr(post, strikeTerms);
  },
  shouldAlertOnEventPost(post: EventMonitorPost): boolean {
    return post.matchedTerms.length > 0;
  },
  async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
    return JSON.stringify(await refreshNytFrontPageSettings(integration, options?.force));
  },
  getStrikeTerms(integration: Integration): { strikeTerms: string[]; parsedFromUrl?: string; lastParsedAt?: string } {
    const settings = parseNytFrontPageSettings(integration.settingsJson);
    return {
      strikeTerms: settings.nytStrikeTerms ?? [],
      parsedFromUrl: settings.nytParsedFromUrl,
      lastParsedAt: settings.nytLastParsedAt
    };
  }
};

export async function refreshNytFrontPageSettings(
  integration: Integration,
  force = false,
  now = new Date()
): Promise<Record<string, unknown> & NytFrontPageSettings> {
  const resolvedQueue = await refreshNytFrontPagePolymarketQueue(integration, now);
  const settings = parseNytDiscoverySettings(resolvedQueue.settingsJson);
  const issuePolymarketUrl = getNytPolymarketUrlForIssueDate(settings.polymarketMarkets, settings.nytLatestIssueDate);
  const polymarketUrl = normalizeNytPolymarketEventUrl(
    issuePolymarketUrl ?? resolvedQueue.activeUrl ?? getNytLegacyFallbackPolymarketUrl(integration, resolvedQueue.settingsJson)
  );
  if (!polymarketUrl) {
    return clearNytStrikeCache(settings);
  }

  const lastParsedAt = typeof settings.nytLastParsedAt === "string" ? new Date(settings.nytLastParsedAt).getTime() : NaN;
  const shouldRefresh =
    force ||
    settings.nytParsedFromUrl !== polymarketUrl ||
    Number.isNaN(lastParsedAt) ||
    now.getTime() - lastParsedAt >= strikeRefreshIntervalMs;

  if (!shouldRefresh) {
    return settings;
  }

  try {
    const strikeTerms = await fetchNytFrontPageGammaStrikeTerms(polymarketUrl);
    return {
      ...settings,
      nytStrikeTerms: strikeTerms,
      nytParsedFromUrl: polymarketUrl,
      nytLastParsedAt: now.toISOString()
    };
  } catch (error) {
    if (force || !Array.isArray(settings.nytStrikeTerms)) {
      throw error;
    }
    return settings;
  }
}

export async function refreshNytFrontPagePolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  const queueIntegration = seedNytCurrentPolymarketUrl(integration, now);
  let resolved = resolveIntegrationPolymarketQueue(queueIntegration, now);
  let settings = parseNytDiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverNytMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastNytDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const candidates = await fetchNytMarketSearchCandidates(now);
    const existingSlugs = new Set((settings.polymarketMarkets ?? []).map((market) => market.slug));
    for (const candidate of candidates) {
      if (existingSlugs.has(candidate.slug)) {
        continue;
      }

      resolved = upsertPolymarketQueueUrl(
        {
          ...queueIntegration,
          settingsJson: resolved.settingsJson,
          polymarketUrl: resolved.activeUrl
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

function seedNytCurrentPolymarketUrl(integration: Integration, now: Date): Integration {
  const normalizedPolymarketUrl = normalizeNytPolymarketEventUrl(integration.polymarketUrl) ?? integration.polymarketUrl;
  const settings = parseRawSettings(integration.settingsJson);
  if (
    Array.isArray(settings.polymarketMarkets) ||
    !normalizedPolymarketUrl ||
    !parsePolymarketDateRangeWindow(normalizedPolymarketUrl, now)
  ) {
    return integration;
  }

  const normalizedIntegration = { ...integration, polymarketUrl: normalizedPolymarketUrl };
  const resolved = upsertPolymarketQueueUrl(normalizedIntegration, normalizedPolymarketUrl, now);
  return {
    ...normalizedIntegration,
    settingsJson: resolved.settingsJson,
    polymarketUrl: resolved.activeUrl
  };
}

function getNytActivePolymarketUrl(settings: NytFrontPageSettings, integration?: Integration): string | undefined {
  if (settings.nytParsedFromUrl) {
    return normalizeNytPolymarketEventUrl(settings.nytParsedFromUrl);
  }

  if (integration && Array.isArray(parseRawSettings(integration.settingsJson).polymarketMarkets)) {
    return undefined;
  }

  return normalizeNytPolymarketEventUrl(integration?.polymarketUrl ?? defaultPolymarketUrl);
}

function getNytLegacyFallbackPolymarketUrl(integration: Integration, settingsJson: string | null): string | null {
  if (Array.isArray(parseRawSettings(settingsJson).polymarketMarkets)) {
    return null;
  }

  return normalizeNytPolymarketEventUrl(integration.polymarketUrl ?? defaultPolymarketUrl) ?? null;
}

function clearNytStrikeCache(settings: Record<string, unknown> & NytFrontPageSettings): Record<string, unknown> & NytFrontPageSettings {
  const next = { ...settings };
  delete next.nytParsedFromUrl;
  delete next.nytLastParsedAt;
  return {
    ...next,
    nytStrikeTerms: []
  };
}

export function parseNytFrontPageSettings(settingsJson: string | null): NytFrontPageSettings {
  const settings = parseRawSettings(settingsJson);
  return {
    nytStrikeTerms: Array.isArray(settings.nytStrikeTerms) ? settings.nytStrikeTerms.filter(isNonEmptyString).sort() : undefined,
    nytParsedFromUrl: typeof settings.nytParsedFromUrl === "string" ? settings.nytParsedFromUrl : undefined,
    nytLastParsedAt: typeof settings.nytLastParsedAt === "string" ? settings.nytLastParsedAt : undefined
  };
}

export async function fetchNytFrontPageGammaStrikeTerms(polymarketUrl: string): Promise<string[]> {
  const normalizedUrl = normalizeNytPolymarketEventUrl(polymarketUrl) ?? polymarketUrl;
  const slug = getPolymarketSlug(normalizedUrl);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${polymarketUrl}`);
  }

  const response = await fetchWithTimeout(`${gammaApiUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const events = (await response.json()) as GammaEvent[];
  return extractNytFrontPageGammaStrikeTerms(events.flatMap((event) => event.markets ?? []));
}

export function extractNytFrontPageGammaStrikeTerms(markets: GammaMarket[]): string[] {
  const strikeTerms = new Set<string>();
  const resolvedTerms = new Set<string>();

  for (const market of markets) {
    const terms = extractNytStrikeTermsFromQuestion(market.question ?? market.groupItemTitle ?? "");
    for (const term of terms) {
      strikeTerms.add(term);
    }
    if (isResolvedYesMarket(market)) {
      for (const term of terms) {
        resolvedTerms.add(term);
      }
    }
  }

  return [...strikeTerms].filter((term) => !resolvedTerms.has(term)).sort((left, right) => left.localeCompare(right));
}

function shouldDiscoverNytMarkets(settings: NytFrontPageSettings, now: Date): boolean {
  const markets = normalizeNytQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastNytDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

async function fetchNytMarketSearchCandidates(now: Date): Promise<Array<{ slug: string; url: string }>> {
  const candidates = new Map<string, { slug: string; url: string }>();
  const errors: string[] = [];
  for (const url of buildNytGammaDiscoveryUrls()) {
    try {
      for (const candidate of await fetchNytMarketCandidatesFromUrl(url, now)) {
        candidates.set(candidate.slug, candidate);
      }
    } catch (error) {
      errors.push(`${url}: ${formatErrorMessage(error)}`);
    }
  }

  if (candidates.size > 0 || errors.length === 0) {
    return [...candidates.values()].sort((left, right) => compareNytMarketCandidates(left, right, now));
  }

  throw new Error(`Polymarket Gamma NYT discovery failed: ${errors.join("; ")}`);
}

function buildNytGammaDiscoveryUrls(): string[] {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", nytMarketSearchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");

  const seriesUrl = new URL(gammaApiUrl);
  seriesUrl.searchParams.set("series_slug", nytSeriesSlug);
  seriesUrl.searchParams.set("active", "true");
  seriesUrl.searchParams.set("closed", "false");
  seriesUrl.searchParams.set("limit", "20");

  const tagSlugUrl = new URL(gammaApiUrl);
  tagSlugUrl.searchParams.set("tag_slug", nytTagSlug);
  tagSlugUrl.searchParams.set("active", "true");
  tagSlugUrl.searchParams.set("closed", "false");
  tagSlugUrl.searchParams.set("limit", "20");

  const tagIdUrl = new URL(gammaApiUrl);
  tagIdUrl.searchParams.set("tag_id", nytTagId);
  tagIdUrl.searchParams.set("active", "true");
  tagIdUrl.searchParams.set("closed", "false");
  tagIdUrl.searchParams.set("limit", "20");

  return [searchUrl.toString(), seriesUrl.toString(), tagSlugUrl.toString(), tagIdUrl.toString()];
}

async function fetchNytMarketCandidatesFromUrl(url: string, now: Date): Promise<Array<{ slug: string; url: string }>> {
  const response = await fetchWithTimeout(url, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse | GammaSearchEvent[];
  return extractGammaSearchEvents(payload).map((event) => normalizeNytSearchEvent(event, now)).filter((candidate) => candidate !== null);
}

function extractGammaSearchEvents(payload: GammaSearchResponse | GammaSearchEvent[]): GammaSearchEvent[] {
  return Array.isArray(payload) ? payload : payload.events ?? [];
}

function normalizeNytSearchEvent(event: GammaSearchEvent, now: Date): { slug: string; url: string } | null {
  if (
    event.active === false ||
    event.closed === true ||
    event.archived === true ||
    !isNonEmptyString(event.slug) ||
    !isNonEmptyString(event.title)
  ) {
    return null;
  }

  const title = event.title.toLowerCase();
  if (
    !event.slug.startsWith("what-will-the-nyt-front-page-headlines-say-this-week-") ||
    (!title.startsWith("what will the nyt front-page headlines say this week") &&
      !title.startsWith("what will the nyt front page headlines say this week"))
  ) {
    return null;
  }

  const url = `https://polymarket.com/event/${event.slug}`;
  return parsePolymarketDateRangeWindow(url, now) ? { slug: event.slug, url } : null;
}

function compareNytMarketCandidates(left: { url: string }, right: { url: string }, now: Date): number {
  const leftWindow = parsePolymarketDateRangeWindow(left.url, now);
  const rightWindow = parsePolymarketDateRangeWindow(right.url, now);
  const leftTime = leftWindow?.startAt ? Date.parse(leftWindow.startAt) : Number.MAX_SAFE_INTEGER;
  const rightTime = rightWindow?.startAt ? Date.parse(rightWindow.startAt) : Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime || left.url.localeCompare(right.url);
}

function parseNytDiscoverySettings(settingsJson: string | null): NytFrontPageSettings {
  const settings = parseRawSettings(settingsJson);
  return {
    ...settings,
    polymarketMarkets: normalizeNytQueueMarkets(settings.polymarketMarkets),
    lastNytDiscoveryAt: typeof settings.lastNytDiscoveryAt === "string" ? settings.lastNytDiscoveryAt : undefined
  };
}

function normalizeNytQueueMarkets(value: unknown): PolymarketQueueMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((market) => {
    if (!market || typeof market !== "object") {
      return [];
    }

    const candidate = market as Partial<PolymarketQueueMarket>;
    if (!isNonEmptyString(candidate.url)) {
      return [];
    }

    const slug = isNonEmptyString(candidate.slug) ? candidate.slug : getPolymarketSlug(candidate.url);
    if (!slug) {
      return [];
    }

    return [
      {
        url: candidate.url,
        slug,
        startAt: typeof candidate.startAt === "string" ? candidate.startAt : null,
        endAt: typeof candidate.endAt === "string" ? candidate.endAt : null,
        addedAt: typeof candidate.addedAt === "string" ? candidate.addedAt : new Date(0).toISOString()
      }
    ];
  });
}

export function getNytPolymarketUrlForIssueDate(
  markets: PolymarketQueueMarket[] | undefined,
  issueDate: string | undefined
): string | undefined {
  if (!issueDate || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
    return undefined;
  }

  return normalizeNytQueueMarkets(markets)
    .filter((market) => {
      if (!market.startAt || !market.endAt) {
        return false;
      }

      return issueDate >= formatEasternDate(new Date(market.startAt)) && issueDate <= formatEasternDate(new Date(market.endAt));
    })
    .sort((left, right) => Date.parse(right.startAt ?? "") - Date.parse(left.startAt ?? ""))[0]?.url;
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

export function extractNytStrikeTermsFromQuestion(question: string): string[] {
  const terms = new Set<string>();
  const quotedTerms = [...question.matchAll(/["“]([^"”]+)["”]/g)]
    .flatMap((match) => match[1]?.split("/") ?? [])
    .map((term) => term.trim())
    .filter(isNonEmptyString);

  if (quotedTerms.length) {
    for (const term of quotedTerms) {
      terms.add(term);
    }
  } else {
    const match = question.match(/front page headlines say\s+(.+?)\s+this week/i);
    for (const term of match?.[1]?.split(/\s+or\s+|\//i).map((part) => part.trim()).filter(Boolean) ?? []) {
      terms.add(term);
    }
  }

  return [...terms].filter((term) => term.length <= 80).sort((left, right) => left.localeCompare(right));
}

export function extractNytFrontPageIssue(html: string, pageUrl: string): NytFrontPageIssue {
  const $ = cheerio.load(html);
  const nodes = extractJsonLdNodes($);
  const issue = nodes.find((node) => hasJsonLdType(node, "PublicationIssue"));
  const articles = nodes.filter((node) => hasJsonLdType(node, "NewsArticle"));
  const date = normalizeIssueDate(
    $("meta[property='article:published_time']").attr("content") ??
      issue?.datePublished ??
      articles[0]?.datePublished ??
      $("[typeof='PublicationIssue'] [property='datePublished']").first().text()
  );
  const fallbackDate = date ?? parseIssueDateFromPressReaderUrl(pageUrl);
  const thumbnailUrl = issue?.thumbnailUrl ?? $("[typeof='PublicationIssue'] [property='thumbnailUrl'] img").first().attr("src");
  const headlines = articles.map((article) => normalizeText(article.headline ?? "")).filter(isNonEmptyString);

  if (!fallbackDate) {
    throw new Error("Could not find NYT front page issue metadata");
  }

  const pageImageUrl = thumbnailUrl
    ? normalizePageImageUrl(decodeHtmlEntities(thumbnailUrl), fallbackDate)
    : buildNytFrontPageImageUrl(fallbackDate, pageImageWidth);

  return {
    id: `nyt-front-page-${fallbackDate}`,
    date: fallbackDate,
    pageUrl,
    pageImageUrl,
    headlines
  };
}

export async function enrichNytFrontPagePostWithOcr(post: EventMonitorPost, strikeTerms: string[]): Promise<EventMonitorPost> {
  const ocr = await recognizeImageText(post.imageUrls[0]);
  const imageText = [post.imageText, ocr.text].filter(Boolean).join("\n");
  const qualifyingText = [post.text, imageText].filter(Boolean).join("\n");
  const matchedTerms = findMatchedStrikeTerms(qualifyingText, strikeTerms);
  const highlightBoxes = findNytStrikeTermBoxes(ocr.words, matchedTerms);
  const highlightedImage = highlightBoxes.length
    ? await buildHighlightedNytImageAttachment(ocr.imageBuffer, highlightBoxes, post.id)
    : null;
  return {
    ...post,
    imageText,
    qualifyingText,
    matchedTerms,
    imageAttachments: highlightedImage ? [highlightedImage] : post.imageAttachments
  };
}

async function fetchLatestNytFrontPagePost(strikeTerms: string[], polymarketUrl?: string): Promise<EventMonitorPost> {
  const issueDate = await fetchLatestIssueDate();
  return fetchNytFrontPagePostForDate(issueDate, strikeTerms, polymarketUrl);
}

async function fetchHistoricalNytFrontPageCheck(strikeTerms: string[], polymarketUrl: string | undefined): Promise<EventMonitorResult> {
  if (!polymarketUrl) {
    throw new Error("No active NYT Front Page Polymarket market is configured for the current ET date.");
  }

  const issueDates = getNytFrontPageMarketIssueDates(polymarketUrl);
  if (!issueDates.length) {
    throw new Error(`Could not parse NYT market date window from Polymarket URL: ${polymarketUrl}`);
  }

  const posts: EventMonitorPost[] = [];
  const failures: string[] = [];
  for (const issueDate of issueDates) {
    try {
      const post = await fetchNytFrontPagePostForDate(issueDate, strikeTerms, polymarketUrl);
      posts.push(await enrichNytFrontPagePostWithOcr(post, strikeTerms));
    } catch (error) {
      failures.push(`${issueDate}: ${formatErrorMessage(error)}`);
    }
  }

  if (!posts.length) {
    throw new Error(`Could not fetch any NYT front pages for ${issueDates[0]} to ${issueDates.at(-1)}.`);
  }

  const newestFirstPosts = [...posts].sort((left, right) => right.postedAt.getTime() - left.postedAt.getTime());
  const chronologicalPosts = [...posts].sort((left, right) => left.postedAt.getTime() - right.postedAt.getTime());
  const matchedPosts = chronologicalPosts.filter((post) => post.matchedTerms.length > 0);

  return {
    posts: newestFirstPosts,
    postsAreEnriched: true,
    strikeTerms,
    polymarketUrl,
    checkTitle: "Historical strike check",
    checkFields: [
      { name: "Window", value: `${issueDates[0]} to ${issueDates.at(-1)}`, inline: false },
      { name: "Issues checked", value: String(posts.length), inline: true },
      { name: "Strike matches", value: String(matchedPosts.length), inline: true },
      { name: "Strike terms", value: formatStrikeTermsForCheck(strikeTerms), inline: false },
      { name: "Checked dates", value: formatNytHistoricalIssueRows(chronologicalPosts), inline: false },
      ...(failures.length
        ? [{ name: "Skipped dates", value: failures.slice(0, 5).join("\n"), inline: false }]
        : [])
    ],
    observedAt: new Date()
  };
}

export function formatNytHistoricalIssueRows(posts: EventMonitorPost[]): string {
  if (!posts.length) {
    return "No front pages checked.";
  }

  return posts
    .map((post) => {
      const matches = post.matchedTerms.length ? post.matchedTerms.join(", ") : "no matches";
      return `${formatNytPostIssueDateWithWeekday(post)} - ${matches}\n${post.url}`;
    })
    .join("\n");
}

export function getNytFrontPageMarketIssueDates(polymarketUrl: string, now = new Date()): string[] {
  const normalizedUrl = normalizeNytPolymarketEventUrl(polymarketUrl) ?? polymarketUrl;
  const window = parsePolymarketDateRangeWindow(normalizedUrl, now);
  if (!window) {
    return [];
  }

  const start = getEasternDateParts(new Date(window.startAt));
  const end = getEasternDateParts(new Date(window.endAt));
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const endDate = new Date(Date.UTC(end.year, end.month - 1, end.day));
  while (cursor.getTime() <= endDate.getTime()) {
    dates.push(formatUtcDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

export function normalizeNytPolymarketEventUrl(polymarketUrl: string | null | undefined): string | undefined {
  if (!isNonEmptyString(polymarketUrl)) {
    return undefined;
  }

  const eventPathMatch = polymarketUrl.match(/^https?:\/\/(?:www\.)?polymarket\.com\/event\/([^/?#]+)(?:\/[^?#]+)?(?:[?#].*)?$/i);
  const eventSlug = eventPathMatch?.[1];
  if (eventSlug?.startsWith("what-will-the-nyt-front-page-headlines-say-this-week-")) {
    return `https://polymarket.com/event/${eventSlug}`;
  }

  return polymarketUrl;
}

async function fetchNytFrontPagePostForDate(
  issueDate: string,
  strikeTerms: string[],
  polymarketUrl?: string
): Promise<EventMonitorPost> {
  const pageUrl = `${sourceUrl.replace(/\/$/, "")}/${issueDate.replaceAll("-", "")}/page/1`;
  const response = await fetchWithTimeout(pageUrl, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`NYT PressReader returned HTTP ${response.status}`);
  }

  const issue = extractNytFrontPageIssue(await response.text(), pageUrl);
  const text = issue.headlines.join("\n");
  const post: EventMonitorPost = {
    id: issue.id,
    type: "NYT front page",
    sourceLabel: "NYT front page",
    textFieldName: "Headlines",
    text,
    qualifyingText: text,
    postedAt: new Date(`${issue.date}T04:20:00.000Z`),
    url: issue.pageUrl,
    polymarketUrl,
    fields: [{ name: "Issue date", value: issue.date, inline: true }],
    imageUrls: [issue.pageImageUrl],
    imageText: "",
    matchedTerms: findMatchedStrikeTerms(text, strikeTerms),
    strikeTerms
  };
  if (polymarketUrl) {
    post.polymarketUrl = polymarketUrl;
  }

  return post;
}

async function fetchLatestIssueDate(): Promise<string> {
  const response = await fetchWithTimeout(sourceUrl, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`NYT PressReader returned HTTP ${response.status}`);
  }

  const $ = cheerio.load(await response.text());
  const heading = normalizeText($("h1").first().text());
  const date = parseIssueHeadingDate(heading);
  if (!date) {
    const latestImageDate = await findLatestAvailableIssueDateByImage();
    if (latestImageDate) {
      return latestImageDate;
    }
    throw new Error("Could not find latest NYT PressReader issue date");
  }
  return date;
}

export async function findLatestAvailableIssueDateByImage(now = new Date()): Promise<string | null> {
  const start = getEasternDateParts(now);
  const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day));
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  for (let offset = 0; offset < 15; offset += 1) {
    const issueDate = formatUtcDate(cursor);
    try {
      const response = await fetchWithTimeout(
        buildNytFrontPageImageUrl(issueDate, 100),
        { method: "HEAD", headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" } },
        10_000
      );
      if (response.ok && String(response.headers.get("content-type") ?? "").toLowerCase().includes("image")) {
        return issueDate;
      }
    } catch {
      // Try the previous issue date.
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return null;
}

async function recognizeImageText(imageUrl: string | undefined): Promise<NytOcrResult> {
  if (!imageUrl) {
    return { text: "", words: [], imageBuffer: Buffer.alloc(0) };
  }

  const cached = ocrCache.get(imageUrl);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const response = await fetchWithTimeout(imageUrl, { headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" } }, 30_000);
    if (!response.ok) {
      return { text: "", words: [], imageBuffer: Buffer.alloc(0) };
    }

    const ocrImageBuffer = Buffer.from(await response.arrayBuffer());
    const highlightImageBuffer = await fetchNytHighlightImageBuffer(imageUrl, ocrImageBuffer);
    const result = await recognizeNytImageWithBlocks(ocrImageBuffer);
    const text = result.data.text.replace(/\s+/g, " ").trim();
    const words = normalizeNytOcrWords(collectTesseractWords(result.data));
    const ocrResult = { text, words, imageBuffer: highlightImageBuffer };
    ocrCache.set(imageUrl, ocrResult);
    return ocrResult;
  } catch {
    return { text: "", words: [], imageBuffer: Buffer.alloc(0) };
  }
}

async function fetchNytHighlightImageBuffer(imageUrl: string, fallbackBuffer: Buffer): Promise<Buffer> {
  try {
    const response = await fetchWithTimeout(
      imageUrl,
      { headers: { "user-agent": "Mozilla/5.0", referer: sourceUrl } },
      30_000
    );
    if (!response.ok) {
      return fallbackBuffer;
    }
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    return imageBuffer.length ? imageBuffer : fallbackBuffer;
  } catch {
    return fallbackBuffer;
  }
}

async function recognizeNytImageWithBlocks(imageBuffer: Buffer): Promise<Tesseract.RecognizeResult> {
  const worker = await Tesseract.createWorker("eng");
  try {
    return await worker.recognize(imageBuffer, {}, { text: true, blocks: true });
  } finally {
    await worker.terminate();
  }
}

function collectTesseractWords(page: Tesseract.Page): unknown[] {
  return (
    page.blocks?.flatMap((block) =>
      block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words))
    ) ?? []
  );
}

export function findNytStrikeTermBoxes(words: NytOcrWord[], strikeTerms: string[]): NytHighlightBox[] {
  const boxes: NytHighlightBox[] = [];
  const normalizedWords = words.map((word) => normalizeOcrToken(word.text));

  for (const term of strikeTerms) {
    const termTokens = tokenizeStrikeTerm(term);
    if (!termTokens.length) {
      continue;
    }

    for (let index = 0; index <= normalizedWords.length - termTokens.length; index += 1) {
      const sequence = normalizedWords.slice(index, index + termTokens.length);
      if (!sequence.every((wordToken, offset) => ocrTokenMatchesStrikeToken(wordToken, termTokens[offset]))) {
        continue;
      }

      boxes.push({
        ...mergeBoundingBoxes(words.slice(index, index + termTokens.length)),
        term
      });
    }
  }

  return dedupeHighlightBoxes(boxes);
}

function normalizeNytOcrWords(words: unknown): NytOcrWord[] {
  if (!Array.isArray(words)) {
    return [];
  }

  return words.flatMap((word) => {
    if (!word || typeof word !== "object") {
      return [];
    }

    const candidate = word as Partial<NytOcrWord>;
    const bbox = candidate.bbox;
    if (!isNonEmptyString(candidate.text) || !bbox || !isFiniteBox(bbox)) {
      return [];
    }

    return [
      {
        text: candidate.text,
        bbox: {
          x0: Math.round(bbox.x0),
          y0: Math.round(bbox.y0),
          x1: Math.round(bbox.x1),
          y1: Math.round(bbox.y1)
        }
      }
    ];
  });
}

async function buildHighlightedNytImageAttachment(
  imageBuffer: Buffer,
  boxes: NytHighlightBox[],
  postId: string
): Promise<NonNullable<EventMonitorPost["imageAttachments"]>[number] | null> {
  if (!imageBuffer.length || !boxes.length) {
    return null;
  }

  try {
    const image = await Jimp.read(imageBuffer);
    const borderColor = rgbaToInt(255, 214, 10, 255);
    const shadowColor = rgbaToInt(220, 38, 38, 255);
    for (const box of boxes) {
      drawRectangle(image, expandBox(box, 8), shadowColor, 8);
      drawRectangle(image, expandBox(box, 4), borderColor, 4);
    }

    return {
      name: `${sanitizeAttachmentName(postId)}-highlight.png`,
      data: await image.getBuffer("image/png"),
      description: `NYT front page with highlighted strike terms: ${[...new Set(boxes.map((box) => box.term))].join(", ")}`,
      displayAsImage: true
    };
  } catch {
    return null;
  }
}

function drawRectangle(
  image: Awaited<ReturnType<typeof Jimp.read>>,
  box: NytHighlightBox | NytOcrWord["bbox"],
  color: number,
  thickness: number
): void {
  const x0 = clamp(Math.floor(box.x0), 0, image.bitmap.width - 1);
  const x1 = clamp(Math.ceil(box.x1), 0, image.bitmap.width - 1);
  const y0 = clamp(Math.floor(box.y0), 0, image.bitmap.height - 1);
  const y1 = clamp(Math.ceil(box.y1), 0, image.bitmap.height - 1);

  for (let offset = 0; offset < thickness; offset += 1) {
    for (let x = x0; x <= x1; x += 1) {
      setPixelIfInBounds(image, x, y0 + offset, color);
      setPixelIfInBounds(image, x, y1 - offset, color);
    }
    for (let y = y0; y <= y1; y += 1) {
      setPixelIfInBounds(image, x0 + offset, y, color);
      setPixelIfInBounds(image, x1 - offset, y, color);
    }
  }
}

function setPixelIfInBounds(image: Awaited<ReturnType<typeof Jimp.read>>, x: number, y: number, color: number): void {
  if (x < 0 || y < 0 || x >= image.bitmap.width || y >= image.bitmap.height) {
    return;
  }

  image.setPixelColor(color, x, y);
}

function expandBox(box: NytHighlightBox, padding: number): NytHighlightBox {
  return {
    ...box,
    x0: box.x0 - padding,
    y0: box.y0 - padding,
    x1: box.x1 + padding,
    y1: box.y1 + padding
  };
}

function mergeBoundingBoxes(words: NytOcrWord[]): NytOcrWord["bbox"] {
  return {
    x0: Math.min(...words.map((word) => word.bbox.x0)),
    y0: Math.min(...words.map((word) => word.bbox.y0)),
    x1: Math.max(...words.map((word) => word.bbox.x1)),
    y1: Math.max(...words.map((word) => word.bbox.y1))
  };
}

function dedupeHighlightBoxes(boxes: NytHighlightBox[]): NytHighlightBox[] {
  const seen = new Set<string>();
  return boxes.filter((box) => {
    const key = `${box.term}:${box.x0}:${box.y0}:${box.x1}:${box.y1}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function tokenizeStrikeTerm(term: string): string[] {
  return term.split(/\s+/).map(normalizeOcrToken).filter(isNonEmptyString);
}

function normalizeOcrToken(value: string): string {
  return value.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "").replace(/[^a-z0-9]+/g, "");
}

function ocrTokenMatchesStrikeToken(wordToken: string, strikeToken: string): boolean {
  return wordToken === strikeToken || wordToken === `${strikeToken}s`;
}

function isFiniteBox(box: Partial<NytOcrWord["bbox"]>): box is NytOcrWord["bbox"] {
  return [box.x0, box.y0, box.x1, box.y1].every((value) => typeof value === "number" && Number.isFinite(value));
}

function sanitizeAttachmentName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "nyt-front-page";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatNytFrontPageValue(post: EventMonitorPost): string {
  return [
    `Issue: ${post.id.replace("nyt-front-page-", "")}`,
    `Matched terms: ${post.matchedTerms.length ? post.matchedTerms.join(", ") : "none"}`,
    `Headlines:\n${post.text}`,
    post.imageText ? `OCR text:\n${post.imageText}` : "OCR text: none",
    `URL: ${post.url}`
  ].join("\n");
}

function formatStrikeTermsForCheck(strikeTerms: string[]): string {
  return strikeTerms.length ? strikeTerms.join(", ") : "none parsed";
}

function formatNytPostIssueDate(post: EventMonitorPost): string {
  return post.id.replace("nyt-front-page-", "");
}

function formatNytPostIssueDateWithWeekday(post: EventMonitorPost): string {
  const issueDate = formatNytPostIssueDate(post);
  return `${issueDate} (${formatUtcWeekday(issueDate)})`;
}

function formatUtcWeekday(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(
    new Date(Date.UTC(year, month - 1, day, 12))
  );
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getEasternDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day)
  };
}

function formatEasternDate(date: Date): string {
  const parts = getEasternDateParts(date);
  return `${parts.year}-${padNumber(parts.month)}-${padNumber(parts.day)}`;
}

function formatUtcDate(date: Date): string {
  return `${date.getUTCFullYear()}-${padNumber(date.getUTCMonth() + 1)}-${padNumber(date.getUTCDate())}`;
}

function extractJsonLdNodes($: cheerio.CheerioAPI): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  $("script[type='application/ld+json']").each((_, element) => {
    try {
      const parsed = JSON.parse(sanitizeJsonLd($(element).text())) as JsonLdNode;
      nodes.push(...(Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed]));
    } catch {
      return;
    }
  });
  return nodes;
}

function sanitizeJsonLd(value: string): string {
  return value.replace(/,\s*([}\]])/g, "$1");
}

function hasJsonLdType(node: JsonLdNode, type: string): boolean {
  return Array.isArray(node["@type"]) ? node["@type"].includes(type) : node["@type"] === type;
}

function normalizePageImageUrl(value: string, issueDate?: string): string {
  const url = new URL(value);
  url.searchParams.delete("v");
  url.searchParams.delete("ver");
  if (issueDate) {
    url.searchParams.set("date", issueDate.replaceAll("-", ""));
  }
  url.searchParams.set("width", String(pageImageWidth));
  return url.toString();
}

function buildNytFrontPageImageUrl(issueDate: string, width: number): string {
  const url = new URL("https://t.prcdn.co/img");
  url.searchParams.set("cid", pressReaderPublicationCid);
  url.searchParams.set("page", "1");
  url.searchParams.set("date", issueDate.replaceAll("-", ""));
  url.searchParams.set("width", String(width));
  return url.toString();
}

function normalizeIssueDate(value: string | undefined): string | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function parseIssueDateFromPressReaderUrl(value: string): string | null {
  const match = value.match(/\/(\d{4})(\d{2})(\d{2})\/page\/1(?:[/?#]|$)/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function parseIssueHeadingDate(value: string): string | null {
  const match = value.match(/The New York Times - ([A-Za-z]+) (\d{1,2}), (\d{4})/);
  if (!match) {
    return null;
  }

  const month = monthNumber(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  return month && Number.isInteger(day) && day >= 1 && day <= 31 ? `${year}-${padNumber(month)}-${padNumber(day)}` : null;
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

function parseRawSettings(settingsJson: string | null): Record<string, unknown> & NytFrontPageSettings {
  if (!settingsJson) {
    return {};
  }
  try {
    const parsed = JSON.parse(settingsJson) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown> & NytFrontPageSettings) : {};
  } catch {
    return {};
  }
}

function decodeHtmlEntities(value: string): string {
  const $ = cheerio.load(value);
  return $.text();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function monthNumber(value: string): number | null {
  const months: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12
  };
  return months[value.toLowerCase()] ?? null;
}

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
