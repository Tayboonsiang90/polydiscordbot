import { fetchWithTimeout } from "../http.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, EventMonitorPost, EventMonitorResult, Integration, WebsiteAdapter } from "./types.js";

const gammaEventsUrl = "https://gamma-api.polymarket.com/events";
const polymarketMentionsUrl = "https://polymarket.com/mentions";
const defaultEventsLimit = 50;
const maxEventsLimit = 100;

export type PolymarketNewMarketTag = {
  id?: string;
  label: string;
  slug: string;
  channelId?: string;
  channelName?: string;
};

export type PolymarketNewMarketsSettings = {
  eventSeenPostIds?: string[];
  watchedTags?: PolymarketNewMarketTag[];
  eventsLimit?: number;
  lastPolymarketNewMarketScanAt?: string;
};

export type PolymarketNewMarketsAdapterConfig = {
  id: string;
  commandName: string;
  displayName: string;
  sourceUrl: string;
  defaultChannelName: string;
  alertRoleName: string;
  alertRoleEmoji: string;
  defaultWatchedTags: PolymarketNewMarketTag[];
  alertTitle: string;
  eventsLimit?: number;
};

export type GammaNewMarketEvent = {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  description?: unknown;
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
  createdAt?: unknown;
  creationDate?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  tags?: unknown;
  markets?: unknown;
};

type GammaTag = {
  id?: unknown;
  label?: unknown;
  slug?: unknown;
};

type GammaMarket = {
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
};

const mentionMarketsTag: PolymarketNewMarketTag = {
  id: "100343",
  label: "Mentions",
  slug: "mention-markets"
};

export const polymarketMentionMarketsConfig: PolymarketNewMarketsAdapterConfig = {
  id: "polymarket-mention-markets",
  commandName: "mentions",
  displayName: "Polymarket Mention Markets",
  sourceUrl: polymarketMentionsUrl,
  defaultChannelName: "mentions",
  alertRoleName: "Polymarket Mentions Alerts",
  alertRoleEmoji: "\uD83D\uDCAC",
  defaultWatchedTags: [mentionMarketsTag],
  alertTitle: "New Polymarket mention market"
};

export const polymarketMentionMarketsAdapter = createPolymarketNewMarketsAdapter(polymarketMentionMarketsConfig);

export function createPolymarketNewMarketsAdapter(config: PolymarketNewMarketsAdapterConfig): WebsiteAdapter {
  return {
    id: config.id,
    commandName: config.commandName,
    displayName: config.displayName,
    sourceUrl: config.sourceUrl,
    defaultChannelName: config.defaultChannelName,
    alertRoleName: config.alertRoleName,
    alertRoleEmoji: config.alertRoleEmoji,
    defaultSettings: {
      watchedTags: sanitizeWatchedTags(config.defaultWatchedTags),
      eventsLimit: config.eventsLimit ?? defaultEventsLimit
    },
    async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
      const result = await fetchPolymarketNewMarketUpdates(config, integration ?? { settingsJson: null }, new Date());
      const latest = result.posts[0];
      const value = latest ? `${latest.id}\n${latest.text}` : "no active matching Polymarket markets";
      return { value, rawValue: value, unit: "latest matching Polymarket market", observedAt: result.observedAt };
    },
    async fetchEventUpdates(integration: Integration): Promise<EventMonitorResult> {
      return fetchPolymarketNewMarketUpdates(config, integration);
    },
    resolveEventPostChannelIds(integration: Integration, post: EventMonitorPost): string[] {
      return resolvePolymarketNewMarketChannelIds(config, integration, post);
    }
  };
}

export async function fetchPolymarketNewMarketUpdates(
  config: PolymarketNewMarketsAdapterConfig,
  integration: Pick<Integration, "settingsJson">,
  now = new Date()
): Promise<EventMonitorResult> {
  const settings = parsePolymarketNewMarketsSettings(integration.settingsJson, config);
  const eventsById = new Map<string, EventMonitorPost>();
  const sourceUrls: string[] = [];

  for (const tag of settings.watchedTags) {
    const sourceUrl = buildGammaEventsUrl(tag, settings.eventsLimit);
    sourceUrls.push(sourceUrl);
    const events = await fetchGammaEvents(sourceUrl);
    for (const event of events) {
      const post = normalizePolymarketNewMarketEvent(event, settings.watchedTags, {
        now,
        fallbackTag: tag,
        alertTitle: config.alertTitle
      });
      if (post) {
        eventsById.set(post.id, post);
      }
    }
  }

  const posts = [...eventsById.values()].sort(comparePostsDescending);

  return {
    posts,
    strikeTerms: [],
    settingsJson: JSON.stringify({
      ...settings,
      lastPolymarketNewMarketScanAt: now.toISOString()
    }),
    checkTitle: "Polymarket new-market check",
    checkFields: [
      { name: "Matching active events", value: String(posts.length), inline: true },
      { name: "Watched tags", value: formatWatchedTags(settings.watchedTags), inline: false },
      ...(posts[0] ? [{ name: "Latest market", value: `${posts[0].text}\n${posts[0].url}`, inline: false }] : []),
      { name: "Data source", value: sourceUrls.join("\n"), inline: false }
    ],
    observedAt: now
  };
}

export function normalizePolymarketNewMarketEvent(
  event: GammaNewMarketEvent,
  watchedTags: PolymarketNewMarketTag[],
  options: { now?: Date; fallbackTag?: PolymarketNewMarketTag; alertTitle?: string } = {}
): EventMonitorPost | null {
  if (event.active === false || event.closed === true || event.archived === true) {
    return null;
  }

  const id = firstNonEmptyString(event.id);
  const slug = firstNonEmptyString(event.slug);
  const title = firstNonEmptyString(event.title);
  if (!id || !slug || !title) {
    return null;
  }

  const marketTags = parseGammaTags(event.tags);
  const matchedTags = findWatchedTagMatches(marketTags, watchedTags);
  if (!matchedTags.length && options.fallbackTag) {
    matchedTags.push(options.fallbackTag);
  }
  if (!matchedTags.length) {
    return null;
  }

  const postedAt = parseGammaDate(event.createdAt) ?? parseGammaDate(event.creationDate) ?? parseGammaDate(event.startDate) ?? options.now ?? new Date();
  const startAt = parseGammaDate(event.startDate);
  const endAt = parseGammaDate(event.endDate);
  const markets = Array.isArray(event.markets) ? (event.markets as GammaMarket[]) : [];
  const marketCount = markets.length;
  const openMarketCount = markets.filter(isOpenGammaMarket).length;
  const url = `https://polymarket.com/event/${slug}`;
  const description = firstNonEmptyString(event.description);
  const tagLabels = uniqueTags(marketTags.length ? marketTags : matchedTags).map((tag) => tag.label);
  const matchedLabels = uniqueTags(matchedTags).map((tag) => tag.label);
  const text = description ? `${title}\n\n${truncateText(description, 700)}` : title;

  return {
    id: `event:${id}`,
    type: "Polymarket new market",
    alertTitle: options.alertTitle ?? "New Polymarket market",
    sourceLabel: "Polymarket",
    buttonLabel: "Open market",
    mentionAlertRole: true,
    textFieldName: "Market",
    text,
    qualifyingText: [title, description, tagLabels.join(", ")].filter(Boolean).join("\n"),
    postedAt,
    url,
    polymarketUrl: url,
    prioritySummary: {
      question: title,
      questionUrl: url,
      marketTags: tagLabels,
      matchedTags: matchedLabels
    },
    fields: [
      ...(marketCount > 0
        ? [{ name: "Child markets", value: `${marketCount} total / ${openMarketCount} open`, inline: true }]
        : []),
      ...(startAt ? [{ name: "Starts UTC", value: startAt.toISOString(), inline: true }] : []),
      ...(endAt ? [{ name: "Ends UTC", value: endAt.toISOString(), inline: true }] : [])
    ],
    hideDefaultEventFields: true,
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

export function parsePolymarketNewMarketsSettings(
  settingsJson: string | null,
  config: Pick<PolymarketNewMarketsAdapterConfig, "defaultWatchedTags" | "eventsLimit">
): PolymarketNewMarketsSettings & { watchedTags: PolymarketNewMarketTag[]; eventsLimit: number } {
  const parsed = parseSettingsJson(settingsJson) as PolymarketNewMarketsSettings;
  const watchedTags = sanitizeWatchedTags(parsed.watchedTags);
  const eventsLimit = getIntegerSetting(parsed.eventsLimit, config.eventsLimit ?? defaultEventsLimit, 1, maxEventsLimit);

  return {
    ...parsed,
    watchedTags: watchedTags.length ? watchedTags : sanitizeWatchedTags(config.defaultWatchedTags),
    eventsLimit,
    lastPolymarketNewMarketScanAt:
      typeof parsed.lastPolymarketNewMarketScanAt === "string" ? parsed.lastPolymarketNewMarketScanAt : undefined
  };
}

function resolvePolymarketNewMarketChannelIds(
  config: PolymarketNewMarketsAdapterConfig,
  integration: Integration,
  post: EventMonitorPost
): string[] {
  const settings = parsePolymarketNewMarketsSettings(integration.settingsJson, config);
  const matchedTagKeys = new Set((post.prioritySummary?.matchedTags ?? []).map(normalizeTagText).filter(Boolean));
  if (!matchedTagKeys.size) {
    return [];
  }

  return uniqueStrings(
    settings.watchedTags
      .filter((tag) => tag.channelId && (matchedTagKeys.has(normalizeTagText(tag.label)) || matchedTagKeys.has(normalizeTagText(tag.slug))))
      .map((tag) => tag.channelId!)
  );
}

async function fetchGammaEvents(sourceUrl: string): Promise<GammaNewMarketEvent[]> {
  const response = await fetchWithTimeout(sourceUrl, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma events returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  if (Array.isArray(payload)) {
    return payload as GammaNewMarketEvent[];
  }
  if (payload && typeof payload === "object" && "events" in payload && Array.isArray((payload as { events?: unknown }).events)) {
    return (payload as { events: GammaNewMarketEvent[] }).events;
  }
  return [];
}

function buildGammaEventsUrl(tag: PolymarketNewMarketTag, limit: number): string {
  const url = new URL(gammaEventsUrl);
  if (tag.id) {
    url.searchParams.set("tag_id", tag.id);
  } else {
    url.searchParams.set("tag_slug", tag.slug);
  }
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("archived", "false");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("order", "createdAt");
  url.searchParams.set("ascending", "false");
  return url.toString();
}

function parseGammaTags(value: unknown): PolymarketNewMarketTag[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueTags(value.map(toPolymarketNewMarketTag).filter(isPolymarketNewMarketTag));
}

function toPolymarketNewMarketTag(value: unknown): PolymarketNewMarketTag | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const tag = value as GammaTag;
  const label = firstNonEmptyString(tag.label);
  const slug = normalizeTagText(firstNonEmptyString(tag.slug) ?? label ?? "");
  if (!label || !slug) {
    return null;
  }

  return {
    ...(tag.id !== undefined && tag.id !== null ? { id: String(tag.id) } : {}),
    label,
    slug
  };
}

function sanitizeWatchedTags(value: unknown): PolymarketNewMarketTag[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueTags(
    value
      .map((item) => {
        const tag = toPolymarketNewMarketTag(item);
        if (!tag || !item || typeof item !== "object") {
          return tag;
        }

        const raw = item as Partial<PolymarketNewMarketTag>;
        return {
          ...tag,
          ...(typeof raw.channelId === "string" && raw.channelId.trim() ? { channelId: raw.channelId.trim() } : {}),
          ...(typeof raw.channelName === "string" && raw.channelName.trim() ? { channelName: raw.channelName.trim() } : {})
        };
      })
      .filter(isPolymarketNewMarketTag)
  );
}

function findWatchedTagMatches(
  marketTags: PolymarketNewMarketTag[],
  watchedTags: PolymarketNewMarketTag[]
): PolymarketNewMarketTag[] {
  const watchedByKey = new Map<string, PolymarketNewMarketTag>();
  for (const tag of watchedTags) {
    for (const key of getTagKeys(tag)) {
      watchedByKey.set(key, tag);
    }
  }

  const matches: PolymarketNewMarketTag[] = [];
  for (const marketTag of marketTags) {
    for (const key of getTagKeys(marketTag)) {
      const watched = watchedByKey.get(key);
      if (watched) {
        matches.push({ ...watched, label: marketTag.label, slug: marketTag.slug, id: marketTag.id ?? watched.id });
      }
    }
  }

  return uniqueTags(matches);
}

function getTagKeys(tag: PolymarketNewMarketTag): string[] {
  return uniqueStrings([tag.id ? `id:${tag.id}` : "", `slug:${normalizeTagText(tag.slug)}`, `label:${normalizeTagText(tag.label)}`].filter(Boolean));
}

function uniqueTags<T extends PolymarketNewMarketTag>(tags: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const tag of tags) {
    byKey.set(tag.id ? `id:${tag.id}` : `slug:${tag.slug}`, tag);
  }
  return [...byKey.values()];
}

function isPolymarketNewMarketTag(value: PolymarketNewMarketTag | null): value is PolymarketNewMarketTag {
  return Boolean(value);
}

function isOpenGammaMarket(market: GammaMarket): boolean {
  return market.active !== false && market.closed !== true && market.archived !== true;
}

function comparePostsDescending(left: EventMonitorPost, right: EventMonitorPost): number {
  return right.postedAt.getTime() - left.postedAt.getTime() || right.id.localeCompare(left.id);
}

function formatWatchedTags(tags: PolymarketNewMarketTag[]): string {
  return tags.map((tag) => `${tag.label} (${tag.id ? `id ${tag.id}, ` : ""}${tag.slug})`).join("\n") || "none configured";
}

function getIntegerSetting(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function parseGammaDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
    if (text) {
      return text;
    }
  }

  return null;
}

function normalizeTagText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
