import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.rottentomatoes.com";
const rottenTomatoesSearchUrl = `${sourceUrl}/search`;
const gammaEventsUrl = "https://gamma-api.polymarket.com/events";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const discoveryIntervalMs = 30 * 60_000;
const defaultPolymarketUrls = [
  "https://polymarket.com/event/paw-patrol-the-dino-movie-rotten-tomatoes-score-20260709174855589",
  "https://polymarket.com/event/moana-rotten-tomatoes-score-20260630145544856",
  "https://polymarket.com/event/evil-dead-burn-rotten-tomatoes-score-20260708180406392",
  "https://polymarket.com/event/the-odyssey-rotten-tomato-score",
  "https://polymarket.com/event/spider-man-brand-new-day-rotten-tomatoes-score-20260630144021976"
];
const requestHeaders = {
  accept: "text/html,application/xhtml+xml,application/json",
  "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
};

export type RottenTomatoesMarket = {
  url: string;
  slug: string;
  title: string;
  releaseYear: number | null;
  thresholds: number[];
  resolutionAt: string | null;
  noDataDeadlineAt: string | null;
  endAt: string | null;
  rtUrl?: string;
  addedAt: string;
};

export type RottenTomatoesScore = {
  title: string;
  releaseYear: number | null;
  score: number | null;
  url: string;
  searchUrl: string;
};

type RottenTomatoesSettings = {
  markets?: RottenTomatoesMarket[];
  lastRottenTomatoesDiscoveryAt?: string;
};

type GammaEvent = {
  slug?: unknown;
  title?: unknown;
  description?: unknown;
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
  startDate?: unknown;
  creationDate?: unknown;
  createdAt?: unknown;
  endDate?: unknown;
  tags?: Array<{ slug?: unknown; label?: unknown }>;
  markets?: GammaMarket[];
};

type GammaMarket = {
  question?: unknown;
  slug?: unknown;
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
  groupItemTitle?: unknown;
  outcomePrices?: unknown;
};

type GammaSearchResponse = {
  events?: GammaEvent[];
};

type MovieScoreSnapshot = {
  market: RottenTomatoesMarket;
  score: RottenTomatoesScore | null;
  error?: string;
};

export const rottenTomatoesScoresAdapter: WebsiteAdapter = {
  id: "rotten-tomatoes-scores",
  commandName: "rottentomatoes",
  displayName: "Rotten Tomatoes Scores",
  sourceUrl,
  defaultPolymarketUrl: defaultPolymarketUrls[0],
  defaultChannelName: "rottentomatoes",
  alertRoleName: "Rotten Tomatoes Alerts",
  alertRoleEmoji: "\uD83C\uDF45",
  getPollIntervalMinutes: () => 5,
  getPollIntervalReason: () => "5-minute Rotten Tomatoes polling; alerts only when a score moves into a new 5-point bucket.",
  getErrorNoticeWindowMinutes: () => 30,
  shouldAlertOnChange: shouldAlertOnRottenTomatoesBucketChange,
  async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
    return (
      await refreshRottenTomatoesMarkets(integration, new Date(), {
        force: options?.force ?? false
      })
    ).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async upsertPolymarketMarket(integration: Integration, url: string): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertRottenTomatoesMarket(integration, url);
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const settings = parseRottenTomatoesSettings(integration?.settingsJson ?? null);
    const markets = getCurrentRottenTomatoesMarkets(settings.markets ?? [], new Date());
    const snapshots = await Promise.all(markets.map(fetchRottenTomatoesMovieSnapshot));
    const previousBuckets = extractRottenTomatoesBucketMap(integration?.lastValue ?? null);
    const value = formatRottenTomatoesScoresValue(snapshots, new Date(), previousBuckets);
    return {
      value,
      rawValue: value,
      unit: "Rotten Tomatoes Tomatometer score buckets",
      observedAt: new Date()
    };
  }
};

export async function refreshRottenTomatoesMarkets(
  integration: Integration,
  now = new Date(),
  options: { force?: boolean } = {}
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let settings = parseRottenTomatoesSettings(integration.settingsJson);
  let markets = settings.markets ?? [];
  const seedUrls = markets.length === 0 ? [...defaultPolymarketUrls, integration.polymarketUrl] : [integration.polymarketUrl];
  for (const url of seedUrls.filter(isNonEmptyString)) {
    if (!markets.some((market) => market.url === url)) {
      const market = await fetchRottenTomatoesMarketByUrl(url, now).catch(() => buildFallbackRottenTomatoesMarket(url, now));
      if (market) {
        markets = upsertRottenTomatoesMarketRecord(markets, market);
      }
    }
  }

  if (options.force || isDiscoveryDue(settings.lastRottenTomatoesDiscoveryAt, now)) {
    settings = { ...settings, lastRottenTomatoesDiscoveryAt: now.toISOString() };
    for (const market of await fetchRottenTomatoesMarketSearchCandidates(now).catch(() => [])) {
      markets = upsertRottenTomatoesMarketRecord(markets, market);
    }
  }

  markets = pruneRottenTomatoesMarkets(markets, now);
  return {
    settingsJson: JSON.stringify({ ...settings, markets }),
    activeUrl: selectPrimaryRottenTomatoesMarket(markets, now)?.url ?? integration.polymarketUrl
  };
}

export async function upsertRottenTomatoesMarket(
  integration: Integration,
  url: string,
  now = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  const settings = parseRottenTomatoesSettings(integration.settingsJson);
  const market = (await fetchRottenTomatoesMarketByUrl(url, now).catch(() => null)) ?? buildFallbackRottenTomatoesMarket(url, now);
  if (!market) {
    throw new Error(`Could not parse Rotten Tomatoes Polymarket URL: ${url}`);
  }

  const markets = pruneRottenTomatoesMarkets(upsertRottenTomatoesMarketRecord(settings.markets ?? [], market), now);
  return {
    settingsJson: JSON.stringify({ ...settings, markets }),
    activeUrl: selectPrimaryRottenTomatoesMarket(markets, now)?.url ?? url
  };
}

export function normalizeRottenTomatoesGammaEvent(event: GammaEvent, now = new Date()): RottenTomatoesMarket | null {
  if (
    event.active === false ||
    event.closed === true ||
    event.archived === true ||
    !isNonEmptyString(event.slug) ||
    !isNonEmptyString(event.title) ||
    !isRottenTomatoesEvent(event)
  ) {
    return null;
  }

  const title = parseMovieTitle(event.title);
  if (!title) {
    return null;
  }

  const description = isNonEmptyString(event.description) ? event.description : "";
  const thresholds = parseRottenTomatoesThresholds(event.markets ?? []);
  const endAt = parseGammaDate(event.endDate)?.toISOString() ?? null;
  return {
    url: `https://polymarket.com/event/${event.slug}`,
    slug: event.slug,
    title,
    releaseYear: parseReleaseYear(description) ?? parseYearFromDate(endAt),
    thresholds,
    resolutionAt: parseResolutionAt(description)?.toISOString() ?? endAt,
    noDataDeadlineAt: parseNoDataDeadlineAt(description)?.toISOString() ?? endAt,
    endAt,
    addedAt: (parseGammaDate(event.startDate) ?? parseGammaDate(event.creationDate) ?? parseGammaDate(event.createdAt) ?? now).toISOString()
  };
}

export function extractRottenTomatoesScoreFromSearch(
  html: string,
  targetTitle: string,
  targetYear: number | null
): RottenTomatoesScore {
  const document = cheerio.load(html);
  const rows = document("search-page-media-row")
    .map((_, element) => {
      const row = document(element);
      const title = normalizeText(row.find("img").first().attr("alt") ?? "");
      const releaseYear = parseOptionalNumber(row.attr("release-year"));
      const score = parseOptionalNumber(row.attr("tomatometer-score"));
      const href = row.find('a[data-qa="thumbnail-link"]').first().attr("href") ?? row.find("a").first().attr("href");
      if (!title || !href) {
        return null;
      }

      return {
        title,
        releaseYear,
        score,
        url: new URL(href, sourceUrl).toString()
      };
    })
    .get()
    .filter((row): row is Omit<RottenTomatoesScore, "searchUrl"> => Boolean(row));

  const normalizedTarget = normalizeMovieTitle(targetTitle);
  const exact = rows.find((row) => normalizeMovieTitle(row.title) === normalizedTarget && (targetYear === null || row.releaseYear === targetYear));
  const titleOnly = rows.find((row) => normalizeMovieTitle(row.title) === normalizedTarget);
  const match = exact ?? titleOnly;
  if (!match) {
    throw new Error(`Could not find Rotten Tomatoes search result for ${targetTitle}${targetYear ? ` (${targetYear})` : ""}`);
  }

  return {
    ...match,
    searchUrl: buildRottenTomatoesSearchUrl(targetTitle, targetYear)
  };
}

export function formatRottenTomatoesScoresValue(snapshots: MovieScoreSnapshot[], now = new Date(), previousBuckets = new Map<string, string>()): string {
  const lines = [
    "Metric: Rotten Tomatoes All Critics Tomatometer",
    `Tracked active markets: ${snapshots.length}`,
    `Bucket rule: alerts only on real 5-point bucket moves; transient fetch errors keep the last known bucket`,
    "Scores:"
  ];

  if (snapshots.length === 0) {
    lines.push("none");
  }

  for (const snapshot of snapshots) {
    lines.push(formatRottenTomatoesSnapshotLine(snapshot, now, previousBuckets));
  }

  lines.push(`Buckets: ${formatRottenTomatoesBucketState(snapshots, previousBuckets)}`);
  lines.push(`Resolution: ${sourceUrl}`);
  return lines.join("\n");
}

export function shouldAlertOnRottenTomatoesBucketChange(previousValue: string | null, currentValue: string): boolean {
  if (!previousValue) {
    return false;
  }

  const previousBuckets = extractRottenTomatoesBucketMap(previousValue);
  const currentBuckets = extractRottenTomatoesBucketMap(currentValue);
  for (const [slug, bucket] of currentBuckets) {
    if (bucket === "pending" || bucket === "error") {
      continue;
    }

    const previousBucket = previousBuckets.get(slug);
    if (previousBucket === "error") {
      continue;
    }

    if (!previousBuckets.has(slug) || previousBucket !== bucket) {
      return true;
    }
  }

  return false;
}

export function extractRottenTomatoesBucketMap(value: string | null): Map<string, string> {
  const buckets = new Map<string, string>();
  if (!value) {
    return buckets;
  }

  for (const match of value.matchAll(/^Bucket\[(.+?)]:\s*(.+)$/gm)) {
    buckets.set(match[1], match[2].trim());
  }
  for (const match of value.matchAll(/^Buckets:\s*(.+)$/gm)) {
    for (const entry of match[1].split(";")) {
      const [key, bucket] = entry.split("=").map((part) => part.trim());
      if (key && bucket) {
        buckets.set(key, bucket);
      }
    }
  }
  return buckets;
}

async function fetchRottenTomatoesMovieSnapshot(market: RottenTomatoesMarket): Promise<MovieScoreSnapshot> {
  try {
    const score = await fetchRottenTomatoesScore(market.title, market.releaseYear);
    return {
      market: market.rtUrl && market.rtUrl !== score.url ? { ...market, rtUrl: score.url } : market,
      score
    };
  } catch (error) {
    return {
      market,
      score: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function fetchRottenTomatoesScore(title: string, releaseYear: number | null): Promise<RottenTomatoesScore> {
  const searchUrl = buildRottenTomatoesSearchUrl(title, releaseYear);
  const response = await fetchWithTimeout(searchUrl, { headers: requestHeaders }, 30_000);
  if (!response.ok) {
    throw new Error(`Rotten Tomatoes search returned HTTP ${response.status} for ${title}`);
  }

  return extractRottenTomatoesScoreFromSearch(await response.text(), title, releaseYear);
}

async function fetchRottenTomatoesMarketSearchCandidates(now: Date): Promise<RottenTomatoesMarket[]> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", "rotten tomatoes score");
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "50");
  searchUrl.searchParams.append("events_tag", "rotten-tomatoes");

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: requestHeaders
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  const candidates: RottenTomatoesMarket[] = [];
  for (const event of payload.events ?? []) {
    const normalized = normalizeRottenTomatoesGammaEvent(event, now);
    if (!normalized) {
      continue;
    }

    candidates.push((await fetchRottenTomatoesMarketByUrl(normalized.url, now).catch(() => null)) ?? normalized);
  }

  return candidates;
}

async function fetchRottenTomatoesMarketByUrl(url: string, now: Date): Promise<RottenTomatoesMarket | null> {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    return null;
  }

  const response = await fetchWithTimeout(`${gammaEventsUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: requestHeaders
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const events = (await response.json()) as GammaEvent[];
  return normalizeRottenTomatoesGammaEvent(events[0] ?? {}, now);
}

function formatRottenTomatoesSnapshotLine(snapshot: MovieScoreSnapshot, now: Date, previousBuckets: Map<string, string>): string {
  const { market, score } = snapshot;
  const previousBucket = previousBuckets.get(formatRottenTomatoesMarketKey(market));
  const scoreText = score?.score === null || score?.score === undefined ? "pending" : `${score.score}%`;
  const bucket = getEffectiveRottenTomatoesBucket(snapshot, previousBuckets);
  const nextThreshold = score?.score === null || score?.score === undefined ? null : market.thresholds.find((threshold) => threshold > score.score!);
  const hitThresholds = score?.score === null || score?.score === undefined
    ? []
    : market.thresholds.filter((threshold) => threshold <= score.score!);
  const status = snapshot.error
    ? isNumericBucket(previousBucket)
      ? `fetch failed, kept prior bucket ${previousBucket}`
      : `fetch failed: ${snapshot.error.slice(0, 60)}`
    : scoreText;
  const thresholdText = market.thresholds.length ? market.thresholds.join("/") : "none";
  const progress = score?.score === null || score?.score === undefined
    ? `thresholds ${thresholdText}`
    : `hit ${hitThresholds.length ? hitThresholds.join("/") : "none"}, next ${nextThreshold ?? "none"}`;
  return [
    "-",
    `${market.title}${market.releaseYear ? ` (${market.releaseYear})` : ""}:`,
    `${status}, bucket ${bucket}, ${progress}, check ${formatShortEasternDateTime(market.resolutionAt)}`,
    isMarketExpired(market, now) ? "(expired)" : ""
  ].filter(Boolean).join(" ");
}

function formatRottenTomatoesBucketState(snapshots: MovieScoreSnapshot[], previousBuckets = new Map<string, string>()): string {
  return snapshots
    .map((snapshot) => {
      const key = formatRottenTomatoesMarketKey(snapshot.market);
      const bucket = getEffectiveRottenTomatoesBucket(snapshot, previousBuckets);
      return `${key}=${bucket}`;
    })
    .join("; ");
}

function getEffectiveRottenTomatoesBucket(snapshot: MovieScoreSnapshot, previousBuckets: Map<string, string>): string {
  if (snapshot.score?.score !== null && snapshot.score?.score !== undefined) {
    return String(scoreBucket(snapshot.score.score));
  }

  const previousBucket = previousBuckets.get(formatRottenTomatoesMarketKey(snapshot.market));
  if (snapshot.error && isNumericBucket(previousBucket)) {
    return previousBucket;
  }

  return snapshot.error ? "error" : "pending";
}

function formatRottenTomatoesMarketKey(market: RottenTomatoesMarket): string {
  return `${market.title}${market.releaseYear ? ` (${market.releaseYear})` : ""}`;
}

function parseRottenTomatoesThresholds(markets: GammaMarket[]): number[] {
  const thresholds = new Set<number>();
  for (const market of markets) {
    if (!isOpenMarket(market)) {
      continue;
    }

    const parsed = parseThreshold(String(market.question ?? "")) ?? parseThreshold(String(market.groupItemTitle ?? ""));
    if (parsed !== null) {
      thresholds.add(parsed);
    }
  }

  return [...thresholds].sort((left, right) => left - right);
}

function parseThreshold(value: string): number | null {
  const match = value.match(/\bat least\s+(\d{1,3})\b/i) ?? value.match(/\bscore\s+(\d{1,3})\b/i);
  if (!match) {
    return null;
  }

  const threshold = Number(match[1]);
  return Number.isInteger(threshold) && threshold >= 0 && threshold <= 100 ? threshold : null;
}

function parseMovieTitle(value: string): string | null {
  const match = value.match(/[“"](.+?)[”"]\s+Rotten Tomato(?:es)? Score/i) ?? value.match(/^(.+?)\s+Rotten Tomato(?:es)? Score/i);
  return match ? normalizeText(match[1]) : null;
}

function parseReleaseYear(description: string): number | null {
  const match = description.match(/\bscore for [^.]+?\((20\d{2})\)\s+is at least/i) ?? description.match(/\((20\d{2})\)/);
  return match ? Number(match[1]) : null;
}

function parseResolutionAt(description: string): Date | null {
  const match = description.match(/\bat\s+(\d{1,2}:\d{2})\s*(AM|PM)\s*ET\s+on\s+([A-Za-z]+\s+\d{1,2},\s+20\d{2})/i);
  if (!match) {
    return null;
  }

  return parseManualEasternDateTime(`${longDateToIso(match[3])} ${toTwentyFourHour(match[1], match[2])}`);
}

function parseNoDataDeadlineAt(description: string): Date | null {
  const match = description.match(/\bby\s+([A-Za-z]+\s+\d{1,2},\s+20\d{2}),\s+11:59\s*PM\s*ET/i);
  return match ? parseManualEasternDateTime(`${longDateToIso(match[1])} 23:59`) : null;
}

function longDateToIso(value: string): string {
  const match = normalizeText(value).match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(20\d{2})$/);
  if (!match) {
    return value;
  }

  const month = monthNumber(match[1]);
  return month ? `${match[3]}-${padNumber(month)}-${padNumber(Number(match[2]))}` : value;
}

function toTwentyFourHour(hourMinute: string, meridiem: string): string {
  const [rawHour, minute] = hourMinute.split(":");
  const hour = Number(rawHour);
  const normalizedHour = meridiem.toUpperCase() === "AM"
    ? hour === 12 ? 0 : hour
    : hour === 12 ? 12 : hour + 12;
  return `${padNumber(normalizedHour)}:${minute}`;
}

function buildRottenTomatoesSearchUrl(title: string, releaseYear: number | null): string {
  const url = new URL(rottenTomatoesSearchUrl);
  url.searchParams.set("search", releaseYear ? `${title} ${releaseYear}` : title);
  return url.toString();
}

function getCurrentRottenTomatoesMarkets(markets: RottenTomatoesMarket[], now: Date): RottenTomatoesMarket[] {
  return pruneRottenTomatoesMarkets(markets, now)
    .filter((market) => !isMarketExpired(market, now))
    .sort(compareRottenTomatoesMarkets);
}

function pruneRottenTomatoesMarkets(markets: RottenTomatoesMarket[], now: Date): RottenTomatoesMarket[] {
  return markets
    .filter((market) => !isMarketExpired(market, now, 14 * 24 * 60 * 60_000))
    .sort(compareRottenTomatoesMarkets);
}

function isMarketExpired(market: RottenTomatoesMarket, now: Date, graceMs = 0): boolean {
  const deadline = market.noDataDeadlineAt ?? market.endAt;
  return Boolean(deadline && Date.parse(deadline) + graceMs < now.getTime());
}

function selectPrimaryRottenTomatoesMarket(markets: RottenTomatoesMarket[], now: Date): RottenTomatoesMarket | null {
  return getCurrentRottenTomatoesMarkets(markets, now)[0] ?? markets[0] ?? null;
}

function upsertRottenTomatoesMarketRecord(markets: RottenTomatoesMarket[], market: RottenTomatoesMarket): RottenTomatoesMarket[] {
  const existingIndex = markets.findIndex((candidate) => candidate.slug === market.slug);
  const nextMarkets = [...markets];
  if (existingIndex === -1) {
    nextMarkets.push(market);
  } else {
    const existing = nextMarkets[existingIndex];
    nextMarkets[existingIndex] = {
      ...existing,
      ...market,
      thresholds: normalizeThresholds([...(existing.thresholds ?? []), ...(market.thresholds ?? [])]),
      releaseYear: market.releaseYear ?? existing.releaseYear,
      resolutionAt: market.resolutionAt ?? existing.resolutionAt,
      noDataDeadlineAt: market.noDataDeadlineAt ?? existing.noDataDeadlineAt,
      endAt: market.endAt ?? existing.endAt,
      rtUrl: market.rtUrl ?? existing.rtUrl,
      addedAt: existing.addedAt
    };
  }

  return nextMarkets.sort(compareRottenTomatoesMarkets);
}

function buildFallbackRottenTomatoesMarket(url: string, now: Date): RottenTomatoesMarket | null {
  const slug = getPolymarketSlug(url);
  if (!slug || !slug.includes("rotten-tomato")) {
    return null;
  }

  const titlePart = slug.replace(/-?rotten-tomatoes?-score.*$/i, "");
  return {
    url,
    slug,
    title: titlePart.split("-").map(capitalizeWord).join(" "),
    releaseYear: parseYearFromDate(now.toISOString()),
    thresholds: [],
    resolutionAt: null,
    noDataDeadlineAt: null,
    endAt: null,
    addedAt: now.toISOString()
  };
}

function parseRottenTomatoesSettings(settingsJson: string | null): RottenTomatoesSettings {
  const settings = parseSettingsJson(settingsJson) as RottenTomatoesSettings;
  return {
    ...settings,
    markets: normalizeRottenTomatoesMarkets(settings.markets),
    lastRottenTomatoesDiscoveryAt:
      typeof settings.lastRottenTomatoesDiscoveryAt === "string" ? settings.lastRottenTomatoesDiscoveryAt : undefined
  };
}

function normalizeRottenTomatoesMarkets(value: unknown): RottenTomatoesMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const market = item as Partial<RottenTomatoesMarket>;
    if (!isNonEmptyString(market.url) || !isNonEmptyString(market.slug) || !isNonEmptyString(market.title)) {
      return [];
    }

    return [
      {
        url: market.url,
        slug: market.slug,
        title: market.title,
        releaseYear: typeof market.releaseYear === "number" && Number.isInteger(market.releaseYear) ? market.releaseYear : null,
        thresholds: normalizeThresholds(market.thresholds),
        resolutionAt: typeof market.resolutionAt === "string" ? market.resolutionAt : null,
        noDataDeadlineAt: typeof market.noDataDeadlineAt === "string" ? market.noDataDeadlineAt : null,
        endAt: typeof market.endAt === "string" ? market.endAt : null,
        rtUrl: typeof market.rtUrl === "string" ? market.rtUrl : undefined,
        addedAt: typeof market.addedAt === "string" ? market.addedAt : new Date(0).toISOString()
      }
    ];
  }).sort(compareRottenTomatoesMarkets);
}

function normalizeThresholds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((threshold): threshold is number => Number.isInteger(threshold) && threshold >= 0 && threshold <= 100))]
    .sort((left, right) => left - right);
}

function compareRottenTomatoesMarkets(left: RottenTomatoesMarket, right: RottenTomatoesMarket): number {
  const leftTime = left.resolutionAt ? Date.parse(left.resolutionAt) : Number.MAX_SAFE_INTEGER;
  const rightTime = right.resolutionAt ? Date.parse(right.resolutionAt) : Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime || left.title.localeCompare(right.title) || left.slug.localeCompare(right.slug);
}

function isRottenTomatoesEvent(event: GammaEvent): boolean {
  const title = isNonEmptyString(event.title) ? event.title.toLowerCase() : "";
  const tagSlugs = new Set((event.tags ?? []).map((tag) => tag.slug).filter(isNonEmptyString));
  return /rotten tomato(?:es)? score/i.test(title) || tagSlugs.has("rotten-tomatoes");
}

function isOpenMarket(market: GammaMarket): boolean {
  return market.active !== false && market.closed !== true && market.archived !== true && !isResolvedOutcomePrices(market.outcomePrices);
}

function isResolvedOutcomePrices(value: unknown): boolean {
  const prices = typeof value === "string" ? parseJsonArray(value) : Array.isArray(value) ? value : [];
  return prices.some((price) => Number(price) >= 0.999);
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isDiscoveryDue(lastDiscoveryAt: string | undefined, now: Date): boolean {
  if (!lastDiscoveryAt) {
    return true;
  }

  const lastDiscoveryMs = Date.parse(lastDiscoveryAt);
  return Number.isNaN(lastDiscoveryMs) || now.getTime() - lastDiscoveryMs >= discoveryIntervalMs;
}

function scoreBucket(score: number): number {
  return Math.floor(score / 5) * 5;
}

function isNumericBucket(bucket: string | undefined): bucket is string {
  return Boolean(bucket && /^\d+$/.test(bucket));
}

function formatShortEasternDateTime(value: string | null): string {
  if (!value) {
    return "not set";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "not set";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date).replace(",", "") + " ET";
}

function parseGammaDate(value: unknown): Date | null {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseYearFromDate(value: string | null): number | null {
  const year = value?.match(/\b(20\d{2})\b/)?.[1];
  return year ? Number(year) : null;
}

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    return null;
  }

  return Number(value);
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

function capitalizeWord(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function normalizeMovieTitle(value: string): string {
  return normalizeText(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
