import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import { resolveIntegrationPolymarketQueue, type PolymarketQueueMarket } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.youtube.com/@MrBeast/about";
const defaultPolymarketUrl = "https://polymarket.com/event/will-mrbeast-hit-billion-views-by-june-30";
const gammaApiUrl = "https://gamma-api.polymarket.com/events";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const mrBeastViewsMarketSearchQuery = "mrbeast billion views";
const marketDiscoveryActiveIntervalMs = 6 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 14 * 24 * 60 * 60_000;
const minimumDailyRateWindowMs = 60 * 60_000;
const minimumPlausibleChannelViews = 10_000_000_000;
const maximumAllowedChannelViewDropRatio = 0.05;

type GammaEvent = {
  markets?: GammaMarket[];
};

type GammaMarket = {
  question?: string;
  closed?: boolean;
  outcomePrices?: string[] | string;
  outcomes?: string[] | string;
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
  startDate?: unknown;
  endDate?: unknown;
};

type MrBeastViewsDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastMrBeastViewsDiscoveryAt?: string;
};

export type MrBeastViewTarget = {
  label: string;
  views: number;
  resolved: boolean;
};

export type MrBeastViewProjection = {
  currentViews: number;
  previousViews: number | null;
  previousChangedAt: Date | null;
  dailyRate: number | null;
  deadline: Date | null;
  targets: MrBeastViewTarget[];
};

export function extractMrBeastTotalViews(html: string): number {
  const candidates = collectViewCountCandidates(html);
  const channelStatsCandidate = candidates.find((candidate) => isChannelStatsViewCount(html, candidate.index));
  if (channelStatsCandidate) {
    return channelStatsCandidate.value;
  }

  const largestCandidate = candidates.reduce<ViewCountCandidate | null>(
    (largest, candidate) => (largest === null || candidate.value > largest.value ? candidate : largest),
    null
  );
  if (largestCandidate && largestCandidate.value >= minimumPlausibleChannelViews) {
    return largestCandidate.value;
  }

  throw new Error("Could not find MrBeast YouTube channel total views");
}

export function extractMrBeastTargetsFromGamma(markets: GammaMarket[]): MrBeastViewTarget[] {
  const targets = markets.flatMap((market) => {
    const match = market.question?.match(/MrBeast hit ([\d.]+)\s+billion views/i);
    if (!match) {
      return [];
    }

    return [
      {
        label: `${match[1]}B`,
        views: Math.round(Number(match[1]) * 1_000_000_000),
        resolved: isResolvedYesMarket(market)
      }
    ];
  });

  return targets
    .filter((target) => Number.isFinite(target.views))
    .sort((left, right) => left.views - right.views);
}

export function parseMrBeastMarketDeadline(polymarketUrl: string | null, now = new Date()): Date | null {
  const slug = polymarketUrl ? getPolymarketSlug(polymarketUrl) : null;
  const match = slug?.match(/by-([a-z]+)-(\d{1,2})(?:-|$)/i);
  if (!match) {
    return null;
  }

  const month = monthNumber(match[1]);
  const day = Number(match[2]);
  if (!month || day < 1 || day > 31) {
    return null;
  }

  return parseManualEasternDateTime(`${getEasternYear(now)}-${padNumber(month)}-${padNumber(day)} 23:59`);
}

export function parseMrBeastStoredViews(value: string | null): number | null {
  const match = value?.match(/Total views:\s*([\d,.\s\u00a0]+[KMB]?)/i);
  return parseViewCount(match?.[1]);
}

export function buildMrBeastViewValue(input: MrBeastViewProjection, observedAt = new Date()): string {
  const dailyRate = input.dailyRate;
  const openTargets = input.targets.filter((target) => !target.resolved);
  const nextTarget =
    openTargets.find((target) => target.views > input.currentViews) ?? openTargets[0] ?? input.targets.at(-1) ?? null;
  const deadlineDays = input.deadline ? Math.max(0, (input.deadline.getTime() - observedAt.getTime()) / 86_400_000) : null;

  return [
    "Metric: MrBeast YouTube channel total views",
    `Total views: ${formatCompactCount(input.currentViews)}`,
    `Change: ${
      input.previousViews === null
        ? "not available"
        : `${formatSignedCompactCount(input.currentViews - input.previousViews)} since last stored total`
    }`,
    `Rate: ${
      dailyRate === null ? "not enough history" : `${formatSignedCompactCount(Math.round(dailyRate))}/day since last counter change`
    }`,
    `Market deadline: ${input.deadline ? formatEasternDateTime(input.deadline) : "not parsed"}`,
    `Next target: ${nextTarget ? formatTargetStatus(nextTarget, input.currentViews) : "not available"}`,
    `Needed by deadline: ${formatViewsNeededByDeadline(nextTarget, input.currentViews, deadlineDays)}`,
    `Targets: ${formatTargetList(input.targets, input.currentViews)}`
  ].join("\n");
}

export const mrBeastViewsAdapter: WebsiteAdapter = {
  id: "mrbeast-views",
  commandName: "mrbeastviews",
  displayName: "MrBeast YouTube Views",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "mrbeastviews",
  legacyChannelNames: ["mrbeast", "mrbeast-views"],
  alertRoleName: "MrBeast Views Alerts",
  alertRoleEmoji: "\uD83D\uDC40",
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshMrBeastViewsPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  upsertPolymarketMarket(integration: Integration, url: string): { settingsJson: string | null; activeUrl: string | null } {
    return upsertMrBeastViewsQueueUrl(integration, url);
  },
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "YouTube About metadata polling every minute for MrBeast total-view counter changes",
  shouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
    const previousViews = parseMrBeastStoredViews(previousValue);
    const currentViews = parseMrBeastStoredViews(currentValue);
    if (isRecoveryFromBadStoredViewCount(previousViews, currentViews)) {
      return false;
    }

    return previousViews !== null && currentViews !== null ? previousViews !== currentViews : previousValue !== currentValue;
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const [channelResponse, targets] = await Promise.all([
      fetchWithTimeout(sourceUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1",
          "accept-language": "en-US,en;q=0.9"
        }
      }),
      fetchMrBeastTargets(integration?.polymarketUrl ?? defaultPolymarketUrl).catch(() => [])
    ]);

    if (!channelResponse.ok) {
      throw new Error(`YouTube returned HTTP ${channelResponse.status}`);
    }

    const currentViews = extractMrBeastTotalViews(await channelResponse.text());
    const previousViews = parseMrBeastStoredViews(integration?.lastValue ?? null);
    if (isImplausibleViewDrop(currentViews, previousViews)) {
      throw new Error(
        `Parsed MrBeast views (${formatCompactCount(currentViews)}) are more than ${formatDecimal(
          maximumAllowedChannelViewDropRatio * 100,
          0
        )}% below the last stored total (${formatCompactCount(previousViews ?? 0)}); refusing to overwrite stored channel total.`
      );
    }

    const previousChangedAt = integration?.lastChangedAt ? new Date(integration.lastChangedAt) : null;
    const observedAt = new Date();
    const dailyRate = calculateDailyRate(currentViews, previousViews, previousChangedAt, observedAt);
    const value = buildMrBeastViewValue(
      {
        currentViews,
        previousViews,
        previousChangedAt: previousChangedAt && !Number.isNaN(previousChangedAt.getTime()) ? previousChangedAt : null,
        dailyRate,
        deadline: parseMrBeastMarketDeadline(integration?.polymarketUrl ?? defaultPolymarketUrl, observedAt),
        targets
      },
      observedAt
    );

    return {
      value,
      rawValue: String(currentViews),
      unit: "views",
      observedAt
    };
  }
};

export async function refreshMrBeastViewsPolymarketQueue(
  integration: Integration,
  now = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseMrBeastViewsDiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverMrBeastViewsMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastMrBeastViewsDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const candidates = await fetchMrBeastViewMarketSearchCandidates(now);
    const existingSlugs = new Set((settings.polymarketMarkets ?? []).map((market) => market.slug));
    for (const candidate of candidates) {
      if (existingSlugs.has(candidate.slug)) {
        continue;
      }

      resolved = upsertMrBeastViewsQueueUrl(
        {
          ...integration,
          settingsJson: resolved.settingsJson,
          polymarketUrl: resolved.activeUrl ?? integration.polymarketUrl
        },
        candidate.url,
        now,
        candidate.startDate,
        candidate.endDate
      );
      settings = parseMrBeastViewsDiscoverySettings(resolved.settingsJson);
      resolved = resolveIntegrationPolymarketQueue(
        {
          ...integration,
          settingsJson: JSON.stringify(settings),
          polymarketUrl: resolved.activeUrl ?? integration.polymarketUrl
        },
        now
      );
      existingSlugs.add(candidate.slug);
    }

    return resolved;
  } catch {
    return resolved;
  }
}

export function normalizeMrBeastViewSearchEvent(
  event: GammaSearchEvent,
  now = new Date()
): { slug: string; url: string; title: string; startDate: string | null; endDate: string | null } | null {
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
  const title = event.title.trim();
  const lowerTitle = title.toLowerCase();
  if (!slug.startsWith("will-mrbeast-hit-billion-views-by-") || !lowerTitle.includes("mrbeast") || !lowerTitle.includes("billion views")) {
    return null;
  }

  const url = `https://polymarket.com/event/${slug}`;
  const deadline = parseMrBeastMarketDeadline(url, now);
  if (!deadline) {
    return null;
  }

  return {
    slug,
    url,
    title,
    startDate: isValidDateString(event.startDate) ? event.startDate : null,
    endDate: deadline.toISOString()
  };
}

type ViewCountCandidate = {
  value: number;
  index: number;
};

function collectViewCountCandidates(html: string): ViewCountCandidate[] {
  const patterns = [
    /"viewCountText"\s*:\s*"([\d,\s\u00a0.]+)\s+views"/gi,
    /"viewCountText"\s*:\s*\{\s*"simpleText"\s*:\s*"([\d,\s\u00a0.]+)\s+views"/gi
  ];
  const candidates: ViewCountCandidate[] = [];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = parseViewCount(match[1]);
      if (value !== null && match.index !== undefined) {
        candidates.push({ value, index: match.index });
      }
    }
  }

  return candidates.sort((left, right) => left.index - right.index);
}

function isChannelStatsViewCount(html: string, index: number): boolean {
  const before = html.slice(Math.max(0, index - 600), index);
  const after = html.slice(index, Math.min(html.length, index + 900));
  return /"subscriberCountText"/i.test(before) && /"joinedDateText"|"canonicalChannelUrl"|"channelId"/i.test(after);
}

function isImplausibleViewDrop(currentViews: number, previousViews: number | null): boolean {
  return (
    previousViews !== null &&
    previousViews >= minimumPlausibleChannelViews &&
    currentViews < previousViews * (1 - maximumAllowedChannelViewDropRatio)
  );
}

function isRecoveryFromBadStoredViewCount(previousViews: number | null, currentViews: number | null): boolean {
  return (
    previousViews !== null &&
    currentViews !== null &&
    currentViews >= minimumPlausibleChannelViews &&
    previousViews < currentViews * maximumAllowedChannelViewDropRatio
  );
}

async function fetchMrBeastTargets(polymarketUrl: string | null): Promise<MrBeastViewTarget[]> {
  const slug = polymarketUrl ? getPolymarketSlug(polymarketUrl) : null;
  if (!slug) {
    return [];
  }

  const response = await fetchWithTimeout(`${gammaApiUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const events = (await response.json()) as GammaEvent[];
  return extractMrBeastTargetsFromGamma(events.flatMap((event) => event.markets ?? []));
}

async function fetchMrBeastViewMarketSearchCandidates(
  now: Date
): Promise<Array<{ slug: string; url: string; title: string; startDate: string | null; endDate: string | null }>> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", mrBeastViewsMarketSearchQuery);
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
    .map((event) => normalizeMrBeastViewSearchEvent(event, now))
    .filter((candidate) => candidate !== null);
}

function upsertMrBeastViewsQueueUrl(
  integration: Integration,
  url: string,
  now = new Date(),
  startAt?: string | null,
  endAt?: string | null
): { settingsJson: string | null; activeUrl: string | null } {
  const settings = parseMrBeastViewsDiscoverySettings(integration.settingsJson);
  const markets = normalizeMrBeastViewsQueueMarkets(settings.polymarketMarkets);
  const slug = getPolymarketSlug(url);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${url}`);
  }

  const market = {
    url,
    slug,
    startAt: startAt ?? now.toISOString(),
    endAt: endAt ?? parseMrBeastMarketDeadline(url, now)?.toISOString() ?? null,
    addedAt: now.toISOString()
  };
  const existingIndex = markets.findIndex((candidate) => candidate.slug === market.slug);
  if (existingIndex === -1) {
    markets.push(market);
  } else {
    markets[existingIndex] = { ...markets[existingIndex], ...market, addedAt: markets[existingIndex].addedAt };
  }

  return resolveIntegrationPolymarketQueue(
    {
      ...integration,
      settingsJson: JSON.stringify({
        ...settings,
        polymarketMarkets: sortMrBeastViewsQueueMarkets(markets)
      })
    },
    now
  );
}

function shouldDiscoverMrBeastViewsMarkets(settings: MrBeastViewsDiscoverySettings, now: Date): boolean {
  const markets = normalizeMrBeastViewsQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMrBeastViewsMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMrBeastViewsMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastMrBeastViewsDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

function parseMrBeastViewsDiscoverySettings(settingsJson: string | null): MrBeastViewsDiscoverySettings {
  const parsed = parseSettingsJson(settingsJson);
  return {
    ...parsed,
    polymarketMarkets: normalizeMrBeastViewsQueueMarkets(parsed.polymarketMarkets),
    lastMrBeastViewsDiscoveryAt:
      typeof parsed.lastMrBeastViewsDiscoveryAt === "string" ? parsed.lastMrBeastViewsDiscoveryAt : undefined
  };
}

function normalizeMrBeastViewsQueueMarkets(value: unknown): PolymarketQueueMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return sortMrBeastViewsQueueMarkets(
    value.flatMap((item) => {
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
    })
  );
}

function sortMrBeastViewsQueueMarkets(markets: PolymarketQueueMarket[]): PolymarketQueueMarket[] {
  return [...markets].sort((left, right) => {
    const leftTime = left.startAt ? Date.parse(left.startAt) : Number.MAX_SAFE_INTEGER;
    const rightTime = right.startAt ? Date.parse(right.startAt) : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime || left.slug.localeCompare(right.slug);
  });
}

function hasQueuedFutureMrBeastViewsMarket(markets: PolymarketQueueMarket[], now: Date): boolean {
  const nowMs = now.getTime();
  return markets.some((market) => Boolean(market.startAt) && Date.parse(market.startAt!) > nowMs);
}

function getActiveMrBeastViewsMarket(markets: PolymarketQueueMarket[], now: Date): PolymarketQueueMarket | null {
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

function calculateDailyRate(
  currentViews: number,
  previousViews: number | null,
  previousChangedAt: Date | null,
  observedAt: Date
): number | null {
  if (previousViews === null || !previousChangedAt || Number.isNaN(previousChangedAt.getTime())) {
    return null;
  }

  const elapsedMs = observedAt.getTime() - previousChangedAt.getTime();
  if (elapsedMs < minimumDailyRateWindowMs) {
    return null;
  }

  return ((currentViews - previousViews) / elapsedMs) * 86_400_000;
}

function formatTargetStatus(target: MrBeastViewTarget, currentViews: number): string {
  if (currentViews >= target.views || target.resolved) {
    return `${target.label} hit`;
  }

  const remaining = target.views - currentViews;
  return `${target.label} - ${formatCompactCount(remaining)} away`;
}

function formatViewsNeededByDeadline(
  target: MrBeastViewTarget | null,
  currentViews: number,
  deadlineDays: number | null
): string {
  if (!target || deadlineDays === null) {
    return "not available";
  }

  const remaining = Math.max(0, target.views - currentViews);
  if (remaining === 0) {
    return "0/day";
  }

  return deadlineDays > 0 ? `${formatCompactCount(Math.ceil(remaining / deadlineDays))}/day` : "deadline passed";
}

function formatTargetList(targets: MrBeastViewTarget[], currentViews: number): string {
  if (targets.length === 0) {
    return "not available";
  }

  const hitTargets = targets.filter((target) => target.resolved || currentViews >= target.views);
  const openTargets = targets.filter((target) => !target.resolved && currentViews < target.views);
  const openLabels = openTargets.slice(0, 4).map((target) => target.label).join(", ");
  const moreOpen = openTargets.length > 4 ? ` +${openTargets.length - 4} more` : "";
  return `${hitTargets.length} hit, ${openTargets.length} open${openTargets.length ? ` (${openLabels}${moreOpen})` : ""}`;
}

function isResolvedYesMarket(market: GammaMarket): boolean {
  if (!market.closed) {
    return false;
  }

  const prices = parseJsonStringArray(market.outcomePrices).map(Number);
  const outcomes = parseJsonStringArray(market.outcomes);
  const yesIndex = outcomes.findIndex((outcome) => outcome.toLowerCase() === "yes");
  return prices[yesIndex === -1 ? 0 : yesIndex] === 1;
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

function parseViewCount(value: string | undefined): number | null {
  const normalized = value?.replace(/[\s\u00a0,]/g, "").trim() ?? "";
  const match = normalized.match(/^(\d+(?:\.\d+)?)([KMB])?$/i);
  if (!match) {
    return null;
  }

  const suffix = match[2]?.toUpperCase();
  const multiplier = suffix === "B" ? 1_000_000_000 : suffix === "M" ? 1_000_000 : suffix === "K" ? 1_000 : 1;
  return Math.round(Number(match[1]) * multiplier);
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

function getEasternYear(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(date));
}

function formatEasternDateTime(date: Date): string {
  return `${formatEasternDate(date)} ${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date)} ET`;
}

function formatEasternDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCompactCount(value: number): string {
  const absoluteValue = Math.abs(value);
  if (absoluteValue >= 1_000_000_000) {
    return `${formatDecimal(value / 1_000_000_000, 3)}B`;
  }

  if (absoluteValue >= 1_000_000) {
    return `${formatDecimal(value / 1_000_000, 1)}M`;
  }

  if (absoluteValue >= 1_000) {
    return `${formatDecimal(value / 1_000, 1)}K`;
  }

  return formatInteger(value);
}

function formatSignedCompactCount(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatCompactCount(Math.abs(value))}`;
}

function formatDecimal(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}
