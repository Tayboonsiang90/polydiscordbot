import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import { resolveIntegrationPolymarketQueue, type PolymarketQueueMarket } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://x.com/WhiteHouse";
const defaultPolymarketUrl = "https://polymarket.com/event/white-house-of-tweets-may-26-june-2-2026";
const xApiBaseUrl = "https://api.twitter.com/2";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const marketSearchQuery = "white house tweets";
const marketSearchTag = "tweets-markets";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 72 * 60 * 60_000;
const maxXApiPages = 10;

export type WhiteHouseTweet = {
  id: string;
  text: string;
  createdAt: string;
  type: "Post" | "Quote" | "Repost";
  url: string;
};

export type WhiteHouseTweetsMarketWindow = {
  startAt: string;
  endAt: string;
  label: string;
};

type CapturedPost = {
  id: string;
  createdAt: string;
  type: string;
  url: string;
};

type StoredTweetState = {
  polymarketUrl?: string;
  capturedPosts: CapturedPost[];
  pendingHourlyBuckets: Record<string, number>;
};

type WhiteHouseTweetsDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastWhiteHouseTweetsDiscoveryAt?: string;
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

type XUserResponse = {
  data?: {
    id?: unknown;
  };
};

type XTweetsResponse = {
  data?: XTweet[];
  meta?: {
    next_token?: unknown;
  };
};

type XTweet = {
  id?: unknown;
  text?: unknown;
  created_at?: unknown;
  referenced_tweets?: Array<{ type?: unknown; id?: unknown }>;
};

let cachedWhiteHouseUserId: string | null = null;

export const whiteHouseTweetsAdapter: WebsiteAdapter = {
  id: "white-house-tweets",
  commandName: "whitehousetweets",
  displayName: "White House X Posts",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "whitehousetweets",
  alertRoleName: "White House Tweet Alerts",
  alertRoleEmoji: "\uD83D\uDC26",
  getPollIntervalMinutes(): number {
    return 5;
  },
  getPollIntervalReason(): string {
    return "5-minute X capture polling; Discord alerts are hourly summaries when new posts are captured.";
  },
  getErrorNoticeWindowMinutes(): number {
    return 30;
  },
  shouldAlertOnChange: whiteHouseTweetsShouldAlertOnChange,
  upsertPolymarketMarket(integration: Integration, url: string): { settingsJson: string | null; activeUrl: string | null } {
    return upsertWhiteHouseTweetsPolymarketMarket(integration, url);
  },
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshWhiteHouseTweetsPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const polymarketUrl = integration?.polymarketUrl ?? defaultPolymarketUrl;
    const window = parseWhiteHouseTweetsMarketWindow(polymarketUrl);
    if (!window) {
      throw new Error(`Could not parse White House tweet market window from Polymarket URL: ${polymarketUrl}`);
    }

    const observedAt = new Date();
    const tweets = await fetchWhiteHouseTweetsFromXApi(window, observedAt);
    const value = buildWhiteHouseTweetsMonitorValue(tweets, integration?.lastValue ?? null, polymarketUrl, window, observedAt);
    return {
      value,
      rawValue: value,
      unit: "posts",
      observedAt
    };
  }
};

export function parseWhiteHouseTweetsMarketWindow(url: string, now = new Date()): WhiteHouseTweetsMarketWindow | null {
  const slug = getPolymarketSlug(url) ?? url;
  const parts = slug.split("-").map((part) => part.toLowerCase());
  const currentYear = getEasternYear(now);

  for (let index = 0; index < parts.length - 3; index += 1) {
    const startMonth = monthNumber(parts[index]);
    const startDay = parseDay(parts[index + 1]);
    const endMonth = monthNumber(parts[index + 2]);
    const endDay = parseDay(parts[index + 3]);
    if (!startMonth || !startDay || !endMonth || !endDay) {
      continue;
    }

    const explicitYear = parts.slice(index + 4).map(parseYear).find((value): value is number => value !== null);
    const endYear = explicitYear ?? currentYear;
    const startYear = endMonth < startMonth ? endYear - 1 : endYear;
    const startAt = parseManualEasternDateTime(`${startYear}-${padNumber(startMonth)}-${padNumber(startDay)} 12:00`);
    const endAt = parseManualEasternDateTime(`${endYear}-${padNumber(endMonth)}-${padNumber(endDay)} 12:00`);
    if (!startAt || !endAt || startAt.getTime() > endAt.getTime()) {
      return null;
    }

    return {
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      label: `${formatMonthDay(startMonth, startDay)} 12:00 PM ET to ${formatMonthDay(endMonth, endDay)} 12:00 PM ET`
    };
  }

  return null;
}

export function buildWhiteHouseTweetsMonitorValue(
  tweets: WhiteHouseTweet[],
  previousValue: string | null,
  polymarketUrl: string,
  window: WhiteHouseTweetsMarketWindow,
  now: Date
): string {
  const previousState = parseWhiteHouseTweetsStoredState(previousValue);
  const sameMarket = previousState.polymarketUrl === polymarketUrl;
  const previousPosts = sameMarket ? previousState.capturedPosts.filter((post) => isCapturedPostInWindow(post, window)) : [];
  const previousIds = new Set(previousPosts.map((post) => post.id));
  const currentPosts = tweets.filter((tweet) => isTweetInWindow(tweet, window)).map(tweetToCapturedPost);
  const newPosts = previousValue && sameMarket ? currentPosts.filter((post) => !previousIds.has(post.id)) : [];
  const capturedPosts = sortCapturedPosts([...previousPosts, ...currentPosts]);
  const currentIds = new Set<string>();
  const uniqueCapturedPosts = capturedPosts.filter((post) => {
    if (currentIds.has(post.id)) {
      return false;
    }
    currentIds.add(post.id);
    return true;
  });

  const currentBucket = formatEasternHourBucket(now);
  const currentBucketMs = parseEasternHourBucketMs(currentBucket);
  const pendingHourlyBuckets = sameMarket
    ? filterPendingBuckets(previousState.pendingHourlyBuckets, window)
    : {};
  for (const post of newPosts) {
    const bucket = formatEasternHourBucket(new Date(post.createdAt));
    pendingHourlyBuckets[bucket] = (pendingHourlyBuckets[bucket] ?? 0) + 1;
  }

  const closedBuckets = Object.entries(pendingHourlyBuckets)
    .filter(([bucket, count]) => count > 0 && parseEasternHourBucketMs(bucket) < currentBucketMs)
    .sort(([left], [right]) => parseEasternHourBucketMs(left) - parseEasternHourBucketMs(right));
  const remainingPendingBuckets = Object.fromEntries(
    Object.entries(pendingHourlyBuckets).filter(([bucket]) => parseEasternHourBucketMs(bucket) >= currentBucketMs)
  );
  const hourlyNewPosts = closedBuckets.reduce((sum, [, count]) => sum + count, 0);
  const hourlySummaryReady = hourlyNewPosts > 0;
  const latestPosts = [...uniqueCapturedPosts].reverse().slice(0, 5);

  return [
    "Metric: White House @WhiteHouse X post count",
    `Current total: ${uniqueCapturedPosts.length}`,
    `New captured this check: ${newPosts.length}`,
    `Hourly summary ready: ${hourlySummaryReady ? "yes" : "no"}`,
    `Hourly new posts: ${hourlyNewPosts}`,
    `Hourly summary: ${closedBuckets.length ? closedBuckets.map(([bucket, count]) => `${bucket}: ${count}`).join(" | ") : "none"}`,
    `Window: ${window.label}`,
    `Window UTC: ${window.startAt} to ${window.endAt}`,
    `Latest captured posts: ${latestPosts.length ? latestPosts.map((post) => `${post.createdAt} ${post.type} ${post.url}`).join(" | ") : "none"}`,
    `Pending hourly buckets: ${formatPendingBuckets(remainingPendingBuckets)}`,
    `Captured posts: ${formatCapturedPosts(uniqueCapturedPosts)}`,
    `Resolution: ${sourceUrl}`,
    `Polymarket: ${polymarketUrl}`
  ].join("\n");
}

export function whiteHouseTweetsShouldAlertOnChange(_previousValue: string | null, currentValue: string): boolean {
  return /^Hourly summary ready:\s*yes$/m.test(currentValue) && !/^Hourly new posts:\s*0$/m.test(currentValue);
}

export function upsertWhiteHouseTweetsPolymarketMarket(
  integration: Integration,
  url: string,
  now = new Date()
): { settingsJson: string | null; activeUrl: string | null } {
  const settings = parseWhiteHouseTweetsDiscoverySettings(integration.settingsJson);
  const markets = upsertWhiteHouseTweetMarket(settings.polymarketMarkets ?? [], buildWhiteHouseTweetQueueMarket(url, now));
  return resolveWhiteHouseTweetsQueue({ ...settings, polymarketMarkets: markets }, integration.polymarketUrl, now);
}

export async function refreshWhiteHouseTweetsPolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let settings = parseWhiteHouseTweetsDiscoverySettings(integration.settingsJson);
  const baseUrl = integration.polymarketUrl ?? defaultPolymarketUrl;
  settings = {
    ...settings,
    polymarketMarkets: upsertWhiteHouseTweetMarket(settings.polymarketMarkets ?? [], buildWhiteHouseTweetQueueMarket(baseUrl, now))
  };
  let resolved = resolveWhiteHouseTweetsQueue(settings, integration.polymarketUrl, now);
  settings = parseWhiteHouseTweetsDiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverWhiteHouseTweetMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastWhiteHouseTweetsDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const candidates = await fetchWhiteHouseTweetMarketSearchCandidates(now);
    const existingSlugs = new Set((settings.polymarketMarkets ?? []).map((market) => market.slug));
    for (const candidate of candidates) {
      if (existingSlugs.has(candidate.slug)) {
        continue;
      }

      const nextSettings = parseWhiteHouseTweetsDiscoverySettings(resolved.settingsJson);
      resolved = resolveWhiteHouseTweetsQueue(
        {
          ...nextSettings,
          polymarketMarkets: upsertWhiteHouseTweetMarket(
            nextSettings.polymarketMarkets ?? [],
            buildWhiteHouseTweetQueueMarket(candidate.url, now)
          )
        },
        resolved.activeUrl ?? integration.polymarketUrl,
        now
      );
      existingSlugs.add(candidate.slug);
    }

    return resolved;
  } catch {
    return resolved;
  }
}

export function normalizeWhiteHouseTweetFromApi(tweet: XTweet): WhiteHouseTweet | null {
  if (!isNonEmptyString(tweet.id) || !isNonEmptyString(tweet.created_at)) {
    return null;
  }

  const referenceTypes = new Set((tweet.referenced_tweets ?? []).map((reference) => reference.type).filter(isNonEmptyString));
  if (referenceTypes.has("replied_to")) {
    return null;
  }

  const type = referenceTypes.has("retweeted") ? "Repost" : referenceTypes.has("quoted") ? "Quote" : "Post";
  return {
    id: tweet.id,
    text: isNonEmptyString(tweet.text) ? tweet.text : "",
    createdAt: tweet.created_at,
    type,
    url: `https://x.com/WhiteHouse/status/${tweet.id}`
  };
}

async function fetchWhiteHouseTweetsFromXApi(window: WhiteHouseTweetsMarketWindow, now: Date = new Date()): Promise<WhiteHouseTweet[]> {
  const bearerToken = getXBearerToken();
  const userId = await fetchWhiteHouseUserId(bearerToken);
  const tweets: WhiteHouseTweet[] = [];
  let nextToken: string | undefined;
  const apiEndTime = new Date(Math.min(Date.parse(window.endAt) + 1000, now.getTime()));
  if (apiEndTime.getTime() <= Date.parse(window.startAt)) {
    return [];
  }

  for (let page = 0; page < maxXApiPages; page += 1) {
    const url = new URL(`${xApiBaseUrl}/users/${encodeURIComponent(userId)}/tweets`);
    url.searchParams.set("max_results", "100");
    url.searchParams.set("tweet.fields", "created_at,referenced_tweets");
    url.searchParams.set("exclude", "replies");
    url.searchParams.set("start_time", window.startAt);
    url.searchParams.set("end_time", apiEndTime.toISOString());
    if (nextToken) {
      url.searchParams.set("pagination_token", nextToken);
    }

    const response = await fetchWithTimeout(url.toString(), {
      headers: {
        authorization: `Bearer ${bearerToken}`,
        "user-agent": "PolymarketResolutionMonitorBot/0.1"
      }
    });
    const payload = (await readXApiJson(response, "tweets")) as XTweetsResponse;
    tweets.push(...(payload.data ?? []).map(normalizeWhiteHouseTweetFromApi).filter((tweet) => tweet !== null));

    nextToken = isNonEmptyString(payload.meta?.next_token) ? payload.meta.next_token : undefined;
    if (!nextToken) {
      break;
    }
  }

  return sortTweets(tweets);
}

async function fetchWhiteHouseUserId(bearerToken: string): Promise<string> {
  if (cachedWhiteHouseUserId) {
    return cachedWhiteHouseUserId;
  }

  const response = await fetchWithTimeout(`${xApiBaseUrl}/users/by/username/WhiteHouse`, {
    headers: {
      authorization: `Bearer ${bearerToken}`,
      "user-agent": "PolymarketResolutionMonitorBot/0.1"
    }
  });
  const payload = (await readXApiJson(response, "user lookup")) as XUserResponse;
  if (!isNonEmptyString(payload.data?.id)) {
    throw new Error("X API user lookup did not return the @WhiteHouse user ID");
  }

  cachedWhiteHouseUserId = payload.data.id;
  return cachedWhiteHouseUserId;
}

async function readXApiJson(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`X API ${label} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new Error(`X API ${label} returned invalid JSON`);
  }
}

function getXBearerToken(): string {
  const token = process.env.X_BEARER_TOKEN ?? process.env.TWITTER_BEARER_TOKEN;
  if (!isNonEmptyString(token)) {
    throw new Error("X_BEARER_TOKEN is required for direct X API polling. Add it to .env and restart the bot.");
  }

  return token;
}

function resolveWhiteHouseTweetsQueue(
  settings: WhiteHouseTweetsDiscoverySettings,
  currentUrl: string | null,
  now: Date
): { settingsJson: string | null; activeUrl: string | null } {
  return resolveIntegrationPolymarketQueue(
    {
      id: 0,
      guildId: "",
      channelId: "",
      adapterId: whiteHouseTweetsAdapter.id,
      displayName: whiteHouseTweetsAdapter.displayName,
      sourceUrl,
      polymarketUrl: currentUrl,
      alertRoleId: null,
      roleMessageId: null,
      roleChannelId: null,
      roleEmoji: null,
      settingsJson: JSON.stringify({
        ...settings,
        polymarketMarkets: sortMarkets(settings.polymarketMarkets ?? [])
      }),
      pollIntervalMinutes: 5,
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

function shouldDiscoverWhiteHouseTweetMarkets(settings: WhiteHouseTweetsDiscoverySettings, now: Date): boolean {
  const markets = normalizeWhiteHouseTweetQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastWhiteHouseTweetsDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

async function fetchWhiteHouseTweetMarketSearchCandidates(now: Date): Promise<Array<{ slug: string; url: string }>> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", marketSearchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");
  searchUrl.searchParams.append("events_tag", marketSearchTag);

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? [])
    .map((event) => normalizeWhiteHouseTweetSearchEvent(event, now))
    .filter((candidate) => candidate !== null);
}

function normalizeWhiteHouseTweetSearchEvent(event: GammaSearchEvent, now: Date): { slug: string; url: string } | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  const slug = event.slug;
  if (!slug.startsWith("white-house-of-tweets-") || !event.title.toLowerCase().includes("white house # posts")) {
    return null;
  }

  const tagSlugs = new Set((event.tags ?? []).map((tag) => tag.slug).filter(isNonEmptyString));
  if (!tagSlugs.has(marketSearchTag)) {
    return null;
  }

  const url = `https://polymarket.com/event/${slug}`;
  return parseWhiteHouseTweetsMarketWindow(url, now) ? { slug, url } : null;
}

function buildWhiteHouseTweetQueueMarket(url: string, now: Date): PolymarketQueueMarket {
  const slug = getPolymarketSlug(url);
  const window = parseWhiteHouseTweetsMarketWindow(url, now);
  if (!slug || !window) {
    throw new Error(`Could not parse White House tweet market from Polymarket URL: ${url}`);
  }

  return {
    url,
    slug,
    startAt: window.startAt,
    endAt: window.endAt,
    addedAt: now.toISOString()
  };
}

function upsertWhiteHouseTweetMarket(markets: PolymarketQueueMarket[], market: PolymarketQueueMarket): PolymarketQueueMarket[] {
  const existingIndex = markets.findIndex((candidate) => candidate.slug === market.slug);
  const nextMarkets = [...markets];
  if (existingIndex === -1) {
    nextMarkets.push(market);
  } else {
    nextMarkets[existingIndex] = { ...nextMarkets[existingIndex], ...market, addedAt: nextMarkets[existingIndex].addedAt };
  }

  return sortMarkets(nextMarkets);
}

function parseWhiteHouseTweetsDiscoverySettings(settingsJson: string | null): WhiteHouseTweetsDiscoverySettings {
  const settings = parseSettingsJson(settingsJson) as WhiteHouseTweetsDiscoverySettings;
  return {
    ...settings,
    polymarketMarkets: normalizeWhiteHouseTweetQueueMarkets(settings.polymarketMarkets),
    lastWhiteHouseTweetsDiscoveryAt:
      typeof settings.lastWhiteHouseTweetsDiscoveryAt === "string" ? settings.lastWhiteHouseTweetsDiscoveryAt : undefined
  };
}

function normalizeWhiteHouseTweetQueueMarkets(value: unknown): PolymarketQueueMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return sortMarkets(
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

function parseWhiteHouseTweetsStoredState(value: string | null): StoredTweetState {
  if (!value) {
    return { capturedPosts: [], pendingHourlyBuckets: {} };
  }

  const polymarketUrl = value.match(/^Polymarket:\s*(.+)$/m)?.[1]?.trim();
  const capturedPosts = parseCapturedPosts(value.match(/^Captured posts:\s*(.*)$/m)?.[1] ?? "");
  const pendingHourlyBuckets = parsePendingBuckets(value.match(/^Pending hourly buckets:\s*(.*)$/m)?.[1] ?? "");
  return { polymarketUrl, capturedPosts, pendingHourlyBuckets };
}

function parseCapturedPosts(value: string): CapturedPost[] {
  if (!value || value === "none") {
    return [];
  }

  return value.split(";").flatMap((entry) => {
    const [id, createdAt, type, url] = entry.split("|").map((part) => part.trim());
    if (!id || !createdAt || !url || Number.isNaN(Date.parse(createdAt))) {
      return [];
    }

    return [{ id, createdAt, type: type || "Post", url }];
  });
}

function parsePendingBuckets(value: string): Record<string, number> {
  if (!value || value === "none") {
    return {};
  }

  return Object.fromEntries(
    value.split(";").flatMap((entry) => {
      const [bucket, countText] = entry.split("=").map((part) => part.trim());
      const count = Number(countText);
      return bucket && Number.isFinite(count) && count > 0 ? [[bucket, count]] : [];
    })
  );
}

function formatCapturedPosts(posts: CapturedPost[]): string {
  return posts.length ? posts.map((post) => `${post.id}|${post.createdAt}|${post.type}|${post.url}`).join(";") : "none";
}

function formatPendingBuckets(buckets: Record<string, number>): string {
  const entries = Object.entries(buckets)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => parseEasternHourBucketMs(left) - parseEasternHourBucketMs(right));
  return entries.length ? entries.map(([bucket, count]) => `${bucket}=${count}`).join(";") : "none";
}

function filterPendingBuckets(buckets: Record<string, number>, window: WhiteHouseTweetsMarketWindow): Record<string, number> {
  return Object.fromEntries(
    Object.entries(buckets).filter(([bucket, count]) => count > 0 && isTimestampInWindow(parseEasternHourBucketMs(bucket), window))
  );
}

function tweetToCapturedPost(tweet: WhiteHouseTweet): CapturedPost {
  return {
    id: tweet.id,
    createdAt: tweet.createdAt,
    type: tweet.type,
    url: tweet.url
  };
}

function sortTweets(tweets: WhiteHouseTweet[]): WhiteHouseTweet[] {
  return [...tweets].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id));
}

function sortCapturedPosts(posts: CapturedPost[]): CapturedPost[] {
  return [...posts].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id));
}

function sortMarkets(markets: PolymarketQueueMarket[]): PolymarketQueueMarket[] {
  return [...markets].sort((left, right) => {
    const leftTime = left.startAt ? Date.parse(left.startAt) : Number.MAX_SAFE_INTEGER;
    const rightTime = right.startAt ? Date.parse(right.startAt) : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime || left.slug.localeCompare(right.slug);
  });
}

function isTweetInWindow(tweet: WhiteHouseTweet, window: WhiteHouseTweetsMarketWindow): boolean {
  return isTimestampInWindow(Date.parse(tweet.createdAt), window);
}

function isCapturedPostInWindow(post: CapturedPost, window: WhiteHouseTweetsMarketWindow): boolean {
  return isTimestampInWindow(Date.parse(post.createdAt), window);
}

function isTimestampInWindow(timestamp: number, window: WhiteHouseTweetsMarketWindow): boolean {
  return !Number.isNaN(timestamp) && timestamp >= Date.parse(window.startAt) && timestamp <= Date.parse(window.endAt);
}

function formatEasternHourBucket(date: Date): string {
  const parts = getEasternDateTimeParts(date);
  return `${parts.year}-${padNumber(parts.month)}-${padNumber(parts.day)} ${padNumber(parts.hour)}:00 ET`;
}

function parseEasternHourBucketMs(bucket: string): number {
  const match = bucket.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):00 ET$/);
  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }

  const parsed = parseManualEasternDateTime(`${match[1]}-${match[2]}-${match[3]} ${match[4]}:00`);
  return parsed ? parsed.getTime() : Number.MAX_SAFE_INTEGER;
}

function getEasternDateTimeParts(date: Date): { year: number; month: number; day: number; hour: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour)
  };
}

function getEasternYear(date: Date): number {
  return getEasternDateTimeParts(date).year;
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

function formatMonthDay(month: number, day: number): string {
  return `${monthName(month)} ${day}`;
}

function monthName(month: number): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names[month - 1] ?? String(month);
}

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
