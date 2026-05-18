import * as cheerio from "cheerio";
import Tesseract from "tesseract.js";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import { findMatchedStrikeTerms } from "./trumpTruth.js";
import type { AdapterValue, EventMonitorPost, EventMonitorResult, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://nytimes.pressreader.com/the-new-york-times/";
const defaultPolymarketUrl = "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-may-18-may-24";
const gammaApiUrl = "https://gamma-api.polymarket.com/events";
const strikeRefreshIntervalMs = 5 * 60_000;
const pageImageWidth = 1200;
const ocrTextCache = new Map<string, string>();

export type NytFrontPageSettings = {
  nytStrikeTerms?: string[];
  nytParsedFromUrl?: string;
  nytLastParsedAt?: string;
};

type GammaEvent = {
  markets?: GammaMarket[];
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

export const nytFrontPageAdapter: WebsiteAdapter = {
  id: "nyt-front-page",
  commandName: "nytfront",
  displayName: "NYT Front Page",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "nytfront",
  alertRoleName: "NYT Front Page Alerts",
  alertRoleEmoji: "\uD83D\uDCF0",
  supportsStrikes: true,
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Fixed hourly check for the latest NYT New York print front page",
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const settings = integration ? await refreshNytFrontPageSettings(integration) : { nytParsedFromUrl: defaultPolymarketUrl };
    const strikeTerms = settings.nytStrikeTerms ?? [];
    const post = await fetchLatestNytFrontPagePost(strikeTerms, settings.nytParsedFromUrl ?? integration?.polymarketUrl ?? defaultPolymarketUrl);
    const enriched = await enrichNytFrontPagePostWithOcr(post, strikeTerms);
    const value = formatNytFrontPageValue(enriched);
    return { value, rawValue: value, unit: "NYT New York print front page", observedAt: new Date() };
  },
  async fetchEventUpdates(integration: Integration): Promise<EventMonitorResult> {
    const settings = parseNytFrontPageSettings(integration.settingsJson);
    const strikeTerms = settings.nytStrikeTerms ?? [];
    const post = await fetchLatestNytFrontPagePost(strikeTerms, settings.nytParsedFromUrl ?? integration.polymarketUrl ?? defaultPolymarketUrl);
    return {
      posts: [post],
      strikeTerms,
      polymarketUrl: settings.nytParsedFromUrl ?? integration.polymarketUrl ?? defaultPolymarketUrl,
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
  const settings = parseRawSettings(integration.settingsJson);
  const polymarketUrl = integration.polymarketUrl ?? defaultPolymarketUrl;
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

export function parseNytFrontPageSettings(settingsJson: string | null): NytFrontPageSettings {
  const settings = parseRawSettings(settingsJson);
  return {
    nytStrikeTerms: Array.isArray(settings.nytStrikeTerms) ? settings.nytStrikeTerms.filter(isNonEmptyString).sort() : undefined,
    nytParsedFromUrl: typeof settings.nytParsedFromUrl === "string" ? settings.nytParsedFromUrl : undefined,
    nytLastParsedAt: typeof settings.nytLastParsedAt === "string" ? settings.nytLastParsedAt : undefined
  };
}

export async function fetchNytFrontPageGammaStrikeTerms(polymarketUrl: string): Promise<string[]> {
  const slug = getPolymarketSlug(polymarketUrl);
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
    $("meta[property='article:published_time']").attr("content") ?? issue?.datePublished ?? articles[0]?.datePublished
  );
  const thumbnailUrl = issue?.thumbnailUrl;
  const headlines = articles.map((article) => normalizeText(article.headline ?? "")).filter(isNonEmptyString);

  if (!date || !thumbnailUrl || headlines.length === 0) {
    throw new Error("Could not find NYT front page issue metadata");
  }

  return {
    id: `nyt-front-page-${date}`,
    date,
    pageUrl,
    pageImageUrl: normalizePageImageUrl(decodeHtmlEntities(thumbnailUrl)),
    headlines
  };
}

export async function enrichNytFrontPagePostWithOcr(post: EventMonitorPost, strikeTerms: string[]): Promise<EventMonitorPost> {
  const ocrText = await recognizeImageText(post.imageUrls[0]);
  const imageText = [post.imageText, ocrText].filter(Boolean).join("\n");
  const qualifyingText = [post.text, imageText].filter(Boolean).join("\n");
  return {
    ...post,
    imageText,
    qualifyingText,
    matchedTerms: findMatchedStrikeTerms(qualifyingText, strikeTerms)
  };
}

async function fetchLatestNytFrontPagePost(strikeTerms: string[], polymarketUrl: string): Promise<EventMonitorPost> {
  const issueDate = await fetchLatestIssueDate();
  const pageUrl = `${sourceUrl.replace(/\/$/, "")}/${issueDate.replaceAll("-", "")}/page/1`;
  const response = await fetchWithTimeout(pageUrl, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`NYT PressReader returned HTTP ${response.status}`);
  }

  const issue = extractNytFrontPageIssue(await response.text(), pageUrl);
  const text = issue.headlines.join("\n");
  return {
    id: issue.id,
    type: "Front page",
    text,
    qualifyingText: text,
    postedAt: new Date(`${issue.date}T04:20:00.000Z`),
    url: issue.pageUrl,
    polymarketUrl,
    imageUrls: [issue.pageImageUrl],
    imageText: "",
    matchedTerms: findMatchedStrikeTerms(text, strikeTerms),
    strikeTerms
  };
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
    throw new Error("Could not find latest NYT PressReader issue date");
  }
  return date;
}

async function recognizeImageText(imageUrl: string | undefined): Promise<string> {
  if (!imageUrl) {
    return "";
  }

  const cached = ocrTextCache.get(imageUrl);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const response = await fetchWithTimeout(imageUrl, { headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" } }, 30_000);
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

function formatNytFrontPageValue(post: EventMonitorPost): string {
  return [
    `Issue: ${post.id.replace("nyt-front-page-", "")}`,
    `Matched terms: ${post.matchedTerms.length ? post.matchedTerms.join(", ") : "none"}`,
    `Headlines:\n${post.text}`,
    post.imageText ? `OCR text:\n${post.imageText}` : "OCR text: none",
    `URL: ${post.url}`
  ].join("\n");
}

function extractJsonLdNodes($: cheerio.CheerioAPI): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  $("script[type='application/ld+json']").each((_, element) => {
    try {
      const parsed = JSON.parse($(element).text()) as JsonLdNode;
      nodes.push(...(Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed]));
    } catch {
      return;
    }
  });
  return nodes;
}

function hasJsonLdType(node: JsonLdNode, type: string): boolean {
  return Array.isArray(node["@type"]) ? node["@type"].includes(type) : node["@type"] === type;
}

function normalizePageImageUrl(value: string): string {
  const url = new URL(value);
  url.searchParams.set("width", String(pageImageWidth));
  return url.toString();
}

function normalizeIssueDate(value: string | undefined): string | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
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
