import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://top10.netflix.com/";
const gammaEventsUrl = "https://gamma-api.polymarket.com/events";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const netflixRequestTimeoutMs = 60_000;
const netflixMarketDiscoveryIntervalMs = 30 * 60_000;
const staleMarketGraceMs = 21 * 24 * 60 * 60_000;
const requestHeaders = {
  accept: "text/html,application/xhtml+xml,text/plain,*/*",
  "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
};

const defaultPolymarketUrls = [
  "https://polymarket.com/event/what-will-be-the-top-us-netflix-show-this-week-20260715162849089",
  "https://polymarket.com/event/what-will-be-the-2-global-netflix-show-this-week-20260715162431454",
  "https://polymarket.com/event/what-will-be-the-top-global-netflix-show-this-week-20260715162306637",
  "https://polymarket.com/event/what-will-be-the-2-us-netflix-movie-this-week-20260715153837280",
  "https://polymarket.com/event/what-will-be-the-top-us-netflix-movie-this-week-20260715153749649",
  "https://polymarket.com/event/what-will-be-the-2-global-netflix-movie-this-week-20260715153657937",
  "https://polymarket.com/event/what-will-be-the-top-global-netflix-movie-this-week-20260715153437552"
];

type NetflixRegion = "Global" | "US";
type NetflixMediaType = "Movies" | "Shows";
type NetflixRank = 1 | 2;

type NetflixChartConfig = {
  key: string;
  label: string;
  region: NetflixRegion;
  mediaType: NetflixMediaType;
  url: string;
};

export type NetflixTop10Row = {
  rank: number;
  title: string;
  weeksInTop10: number | null;
  views: number | null;
  hoursViewed: number | null;
  runtime: string | null;
};

export type NetflixTop10Chart = {
  key: string;
  label: string;
  region: NetflixRegion;
  mediaType: NetflixMediaType;
  url: string;
  weekEndDate: string;
  rows: NetflixTop10Row[];
};

export type NetflixPolymarketMarket = {
  url: string;
  slug: string;
  title: string;
  region: NetflixRegion;
  mediaType: NetflixMediaType;
  rank: NetflixRank;
  startAt: string | null;
  endAt: string | null;
  addedAt: string;
};

type NetflixSettings = {
  markets?: NetflixPolymarketMarket[];
  lastNetflixMarketDiscoveryAt?: string;
  [key: string]: unknown;
};

type GammaSearchResponse = {
  events?: GammaEvent[];
};

type GammaEvent = {
  slug?: unknown;
  title?: unknown;
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
  startDate?: unknown;
  creationDate?: unknown;
  createdAt?: unknown;
  endDate?: unknown;
  tags?: Array<{ slug?: unknown; label?: unknown }>;
};

const netflixChartConfigs: NetflixChartConfig[] = [
  {
    key: "us-shows",
    label: "US Shows",
    region: "US",
    mediaType: "Shows",
    url: "https://www.netflix.com/tudum/top10/united-states/tv"
  },
  {
    key: "us-movies",
    label: "US Movies",
    region: "US",
    mediaType: "Movies",
    url: "https://www.netflix.com/tudum/top10/united-states/films"
  },
  {
    key: "global-shows",
    label: "Global Shows",
    region: "Global",
    mediaType: "Shows",
    url: "https://www.netflix.com/tudum/top10/tv"
  },
  {
    key: "global-movies",
    label: "Global Movies",
    region: "Global",
    mediaType: "Movies",
    url: "https://www.netflix.com/tudum/top10/films"
  }
];

export const netflixTop10Adapter: WebsiteAdapter = {
  id: "netflix-top-10",
  commandName: "netflix",
  displayName: "Netflix Top 10",
  sourceUrl,
  defaultPolymarketUrl: defaultPolymarketUrls[0],
  defaultChannelName: "netflix",
  alertRoleName: "Netflix Top 10 Alerts",
  alertRoleEmoji: "\uD83C\uDF7F",
  getPollIntervalMinutes(_integration: Integration, now: Date = new Date()): number {
    return isNetflixReleaseWindow(now) ? 5 : 60;
  },
  getPollIntervalReason(_integration: Integration, now: Date = new Date()): string {
    return isNetflixReleaseWindow(now)
      ? "5-minute polling during the Tuesday 2:30-5:00 PM ET Netflix Top 10 update window."
      : "Hourly Netflix Top 10 polling outside the Tuesday ET update window; the chart updates weekly.";
  },
  getErrorNoticeWindowMinutes: () => 30,
  shouldAlertOnChange: shouldAlertOnNetflixTop10Change,
  async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
    return (
      await refreshNetflixTop10Markets(integration, new Date(), {
        force: options?.force ?? false
      })
    ).settingsJson;
  },
  async upsertPolymarketMarket(integration: Integration, url: string): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertNetflixPolymarketMarket(integration, url);
  },
  async fetchCurrentValue(): Promise<AdapterValue> {
    const charts = await Promise.all(netflixChartConfigs.map(fetchNetflixTop10Chart));
    const value = formatNetflixTop10Value(charts);
    return {
      value,
      rawValue: JSON.stringify(charts),
      unit: "Netflix weekly Top 10 rankings",
      observedAt: new Date()
    };
  }
};

export async function fetchNetflixTop10Chart(config: NetflixChartConfig): Promise<NetflixTop10Chart> {
  const response = await fetchWithTimeout(
    config.url,
    {
      headers: requestHeaders
    },
    netflixRequestTimeoutMs
  );

  if (!response.ok) {
    throw new Error(`Netflix Top 10 page returned HTTP ${response.status} for ${config.label}`);
  }

  return extractNetflixTop10ChartFromHtml(await response.text(), config);
}

export function extractNetflixTop10ChartFromHtml(html: string, config: NetflixChartConfig): NetflixTop10Chart {
  const weekEndDate = extractLatestWeekEndDate(html);
  const documentRoot = cheerio.load(html);
  const rows: NetflixTop10Row[] = [];

  documentRoot("tbody tr")
    .slice(0, 10)
    .each((_, tableRow) => {
      const rowRoot = documentRoot(tableRow);
      const rank = Number.parseInt(normalizeText(rowRoot.find(".rank").first().text()), 10);
      const title = normalizeText(rowRoot.find("[data-uia='top10-table-row-title'] button").first().text());
      const weeksInTop10 = parseNullableInteger(rowRoot.find("[data-uia='top10-table-row-weeks']").first().text());
      const views = parseNullableInteger(rowRoot.find("[data-uia='top10-table-row-views']").first().text());
      const hoursViewed = parseNullableInteger(rowRoot.find("[data-uia='top10-table-row-hours']").first().text());
      const runtime = normalizeText(rowRoot.find("[data-uia='top10-table-row-runtime']").first().text()) || null;

      if (Number.isInteger(rank) && title) {
        rows.push({
          rank,
          title,
          weeksInTop10,
          views,
          hoursViewed,
          runtime
        });
      }
    });

  if (!weekEndDate || rows.length < 10) {
    throw new Error(`Could not parse Netflix Top 10 rows for ${config.label}`);
  }

  return {
    ...config,
    weekEndDate,
    rows: rows.sort((left, right) => left.rank - right.rank).slice(0, 10)
  };
}

export function formatNetflixTop10Value(charts: NetflixTop10Chart[]): string {
  const sortedCharts = sortNetflixCharts(charts);
  const weekSummary = formatNetflixWeekSummary(sortedCharts);
  const topTwoLines = sortedCharts.flatMap((chart) => [
    `${chart.label} #1: ${formatNetflixTopRowSummary(chart.rows[0])}`,
    `${chart.label} #2: ${formatNetflixTopRowSummary(chart.rows[1])}`
  ]);
  const topTenLines = sortedCharts.map(
    (chart) => `${chart.label} Top 10: ${chart.rows.map(formatNetflixTop10Entry).join(" | ")}`
  );

  return [
    "Metric: Netflix weekly Top 10 rankings",
    `Chart week ending: ${weekSummary}`,
    "Update cadence: Tuesdays around 3:00 PM ET",
    ...topTwoLines,
    ...topTenLines,
    `Resolution: ${sourceUrl}`,
    "Official pages:",
    ...sortedCharts.map((chart) => `${chart.label}: ${chart.url}`)
  ].join("\n");
}

export function shouldAlertOnNetflixTop10Change(previousValue: string | null, currentValue: string): boolean {
  if (previousValue === null) {
    return false;
  }

  return buildNetflixTop10Signature(previousValue) !== buildNetflixTop10Signature(currentValue);
}

export function buildNetflixTop10Signature(value: string | null): string {
  if (!value) {
    return "";
  }

  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("Chart week ending:") || /^(?:US|Global) (?:Shows|Movies) Top 10:/.test(line))
    .map((line) => line.replace(/\s+\([^)]+(?:views|w)[^)]*\)/gi, ""))
    .join("\n");
}

export async function refreshNetflixTop10Markets(
  integration: Integration,
  now: Date = new Date(),
  options: { force?: boolean } = {}
): Promise<{ settingsJson: string; activeUrl: string | null }> {
  let settings = parseNetflixSettings(integration.settingsJson);
  let markets = settings.markets ?? [];
  const seedUrls = [...defaultPolymarketUrls, integration.polymarketUrl].filter(isNonEmptyString);

  for (const url of seedUrls) {
    if (markets.some((market) => market.url === url)) {
      continue;
    }

    const market = (await fetchNetflixMarketByUrl(url, now).catch(() => null)) ?? buildFallbackNetflixMarketFromUrl(url, now);
    if (market) {
      markets = upsertNetflixMarket(markets, market);
    }
  }

  if (options.force || isDiscoveryDue(settings.lastNetflixMarketDiscoveryAt, now)) {
    settings = { ...settings, lastNetflixMarketDiscoveryAt: now.toISOString() };
    for (const market of await fetchNetflixMarketSearchCandidates(now).catch(() => [])) {
      markets = upsertNetflixMarket(markets, market);
    }
  }

  markets = pruneNetflixMarkets(markets, now);
  return {
    settingsJson: JSON.stringify({ ...settings, markets }),
    activeUrl: selectPrimaryNetflixMarket(markets, now)?.url ?? integration.polymarketUrl
  };
}

export async function upsertNetflixPolymarketMarket(
  integration: Integration,
  url: string,
  now: Date = new Date()
): Promise<{ settingsJson: string; activeUrl: string | null }> {
  const settings = parseNetflixSettings(integration.settingsJson);
  const market = (await fetchNetflixMarketByUrl(url, now).catch(() => null)) ?? buildFallbackNetflixMarketFromUrl(url, now);
  if (!market) {
    throw new Error(`Could not parse Netflix Polymarket URL: ${url}`);
  }

  const markets = pruneNetflixMarkets(upsertNetflixMarket(settings.markets ?? [], market), now);
  return {
    settingsJson: JSON.stringify({ ...settings, markets }),
    activeUrl: selectPrimaryNetflixMarket(markets, now)?.url ?? url
  };
}

export function normalizeNetflixMarketSearchEvent(
  event: GammaEvent,
  now: Date = new Date(),
  options: { requireActive?: boolean } = {}
): NetflixPolymarketMarket | null {
  if (
    (options.requireActive ?? true) &&
    (event.active === false || event.closed === true || event.archived === true)
  ) {
    return null;
  }

  if (!isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  const slug = event.slug.trim();
  const title = event.title.trim();
  const parsed = parseNetflixMarketText(title) ?? parseNetflixMarketText(slug.replace(/-/g, " "));
  if (!parsed) {
    return null;
  }

  const tagSlugs = new Set((event.tags ?? []).map((tag) => tag.slug).filter(isNonEmptyString));
  if ((options.requireActive ?? true) && tagSlugs.size > 0 && !tagSlugs.has("top-netflix") && !tagSlugs.has("netflix")) {
    return null;
  }

  return {
    url: `https://polymarket.com/event/${slug}`,
    slug,
    title,
    ...parsed,
    startAt:
      parseGammaDate(event.startDate)?.toISOString() ??
      parseGammaDate(event.creationDate)?.toISOString() ??
      parseGammaDate(event.createdAt)?.toISOString() ??
      null,
    endAt: parseGammaDate(event.endDate)?.toISOString() ?? null,
    addedAt: (parseGammaDate(event.creationDate) ?? parseGammaDate(event.createdAt) ?? now).toISOString()
  };
}

async function fetchNetflixMarketSearchCandidates(now: Date): Promise<NetflixPolymarketMarket[]> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", "netflix this week");
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "20");
  searchUrl.searchParams.append("events_tag", "top-netflix");

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? [])
    .map((event) => normalizeNetflixMarketSearchEvent(event, now))
    .filter((market): market is NetflixPolymarketMarket => market !== null);
}

async function fetchNetflixMarketByUrl(url: string, now: Date): Promise<NetflixPolymarketMarket | null> {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    return null;
  }

  const response = await fetchWithTimeout(`${gammaEventsUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const events = (await response.json()) as GammaEvent[];
  return normalizeNetflixMarketSearchEvent(events[0] ?? {}, now, { requireActive: false });
}

function buildFallbackNetflixMarketFromUrl(url: string, now: Date): NetflixPolymarketMarket | null {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    return null;
  }

  const parsed = parseNetflixMarketText(slug.replace(/-/g, " "));
  if (!parsed) {
    return null;
  }

  return {
    url,
    slug,
    title: slug,
    ...parsed,
    startAt: null,
    endAt: null,
    addedAt: now.toISOString()
  };
}

function parseNetflixSettings(settingsJson: string | null): NetflixSettings {
  const settings = parseSettingsJson(settingsJson) as NetflixSettings;
  return {
    ...settings,
    markets: normalizeNetflixMarkets(settings.markets),
    lastNetflixMarketDiscoveryAt:
      typeof settings.lastNetflixMarketDiscoveryAt === "string" ? settings.lastNetflixMarketDiscoveryAt : undefined
  };
}

function normalizeNetflixMarkets(value: unknown): NetflixPolymarketMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return sortNetflixMarkets(
    value.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const record = item as Partial<NetflixPolymarketMarket>;
      if (!isNonEmptyString(record.url)) {
        return [];
      }

      const slug = isNonEmptyString(record.slug) ? record.slug : getPolymarketSlug(record.url);
      const parsed = parseNetflixMarketText(isNonEmptyString(record.title) ? record.title : record.url) ?? parseNetflixMarketText(record.url);
      if (!slug || !parsed) {
        return [];
      }

      return [
        {
          url: record.url,
          slug,
          title: isNonEmptyString(record.title) ? record.title : slug,
          region: record.region === "US" || record.region === "Global" ? record.region : parsed.region,
          mediaType: record.mediaType === "Movies" || record.mediaType === "Shows" ? record.mediaType : parsed.mediaType,
          rank: record.rank === 1 || record.rank === 2 ? record.rank : parsed.rank,
          startAt: typeof record.startAt === "string" ? record.startAt : null,
          endAt: typeof record.endAt === "string" ? record.endAt : null,
          addedAt: typeof record.addedAt === "string" ? record.addedAt : new Date(0).toISOString()
        }
      ];
    })
  );
}

function upsertNetflixMarket(markets: NetflixPolymarketMarket[], market: NetflixPolymarketMarket): NetflixPolymarketMarket[] {
  const nextMarkets = [...markets];
  const existingIndex = nextMarkets.findIndex((candidate) => candidate.slug === market.slug);
  if (existingIndex === -1) {
    nextMarkets.push(market);
  } else {
    nextMarkets[existingIndex] = { ...nextMarkets[existingIndex], ...market, addedAt: nextMarkets[existingIndex].addedAt };
  }

  return sortNetflixMarkets(nextMarkets);
}

function pruneNetflixMarkets(markets: NetflixPolymarketMarket[], now: Date): NetflixPolymarketMarket[] {
  const nowMs = now.getTime();
  return sortNetflixMarkets(
    markets.filter((market) => {
      if (!market.endAt) {
        return true;
      }

      return Date.parse(market.endAt) + staleMarketGraceMs >= nowMs;
    })
  );
}

function selectPrimaryNetflixMarket(markets: NetflixPolymarketMarket[], now: Date): NetflixPolymarketMarket | null {
  const nowMs = now.getTime();
  return (
    markets.find((market) => {
      const startMs = market.startAt ? Date.parse(market.startAt) : Number.NEGATIVE_INFINITY;
      const endMs = market.endAt ? Date.parse(market.endAt) : Number.POSITIVE_INFINITY;
      return startMs <= nowMs && nowMs <= endMs;
    }) ??
    markets.find((market) => !market.endAt || Date.parse(market.endAt) >= nowMs) ??
    markets[0] ??
    null
  );
}

function sortNetflixMarkets(markets: NetflixPolymarketMarket[]): NetflixPolymarketMarket[] {
  return [...markets].sort((left, right) => {
    const leftEnd = left.endAt ? Date.parse(left.endAt) : Number.MAX_SAFE_INTEGER;
    const rightEnd = right.endAt ? Date.parse(right.endAt) : Number.MAX_SAFE_INTEGER;
    return (
      leftEnd - rightEnd ||
      left.region.localeCompare(right.region) ||
      left.mediaType.localeCompare(right.mediaType) ||
      left.rank - right.rank ||
      left.slug.localeCompare(right.slug)
    );
  });
}

function parseNetflixMarketText(value: string): { region: NetflixRegion; mediaType: NetflixMediaType; rank: NetflixRank } | null {
  const normalized = value.toLowerCase().replace(/[#?_]+/g, " ").replace(/[^a-z0-9.]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized.includes("netflix") || !normalized.includes("this week")) {
    return null;
  }

  const region = /\b(?:us|u\.s\.|united states)\b/.test(normalized) ? "US" : /\bglobal\b/.test(normalized) ? "Global" : null;
  const mediaType = /\bmovies?\b/.test(normalized) ? "Movies" : /\b(?:shows?|tv)\b/.test(normalized) ? "Shows" : null;
  const rank = /\b(?:2|second)\b/.test(normalized) ? 2 : /\b(?:top|1|first)\b/.test(normalized) ? 1 : null;
  if (!region || !mediaType || !rank) {
    return null;
  }

  return { region, mediaType, rank };
}

function isDiscoveryDue(lastDiscoveryAt: unknown, now: Date): boolean {
  if (typeof lastDiscoveryAt !== "string") {
    return true;
  }

  const lastDiscoveryMs = Date.parse(lastDiscoveryAt);
  return Number.isNaN(lastDiscoveryMs) || now.getTime() - lastDiscoveryMs >= netflixMarketDiscoveryIntervalMs;
}

function isNetflixReleaseWindow(now: Date): boolean {
  const eastern = getEasternClock(now);
  const minutes = eastern.hour * 60 + eastern.minute;
  return eastern.weekday === "Tue" && minutes >= 14 * 60 + 30 && minutes <= 17 * 60;
}

function getEasternClock(now: Date): { weekday: string; hour: number; minute: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(now).map((part) => [part.type, part.value])
  );

  return {
    weekday: parts.weekday ?? "",
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function sortNetflixCharts(charts: NetflixTop10Chart[]): NetflixTop10Chart[] {
  const chartOrder = new Map(netflixChartConfigs.map((config, index) => [config.key, index]));
  return [...charts].sort((left, right) => (chartOrder.get(left.key) ?? 999) - (chartOrder.get(right.key) ?? 999));
}

function formatNetflixWeekSummary(charts: NetflixTop10Chart[]): string {
  const uniqueWeeks = [...new Set(charts.map((chart) => chart.weekEndDate))];
  if (uniqueWeeks.length === 1) {
    return uniqueWeeks[0];
  }

  return charts.map((chart) => `${chart.label}=${chart.weekEndDate}`).join(" | ");
}

function formatNetflixTopRowSummary(row: NetflixTop10Row | undefined): string {
  if (!row) {
    return "not parsed";
  }

  return [
    row.title,
    row.views === null ? "" : `${formatCompactNumber(row.views)} views`,
    row.weeksInTop10 === null ? "" : `${row.weeksInTop10}w`
  ].filter(Boolean).join(" - ");
}

function formatNetflixTop10Entry(row: NetflixTop10Row): string {
  const views = row.views === null ? "" : ` (${formatCompactNumber(row.views)} views)`;
  return `#${row.rank} ${row.title}${views}`;
}

function extractLatestWeekEndDate(html: string): string | null {
  const weeks = [...html.matchAll(/"weekEndDate":"(\d{4}-\d{2}-\d{2})"/g)].map((match) => match[1]);
  return weeks.sort().at(-1) ?? null;
}

function parseNullableInteger(value: string | undefined): number | null {
  const normalized = normalizeText(value).replace(/,/g, "");
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGammaDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${trimTrailingZeros((value / 1_000_000).toFixed(1))}M`;
  }
  if (value >= 1_000) {
    return `${trimTrailingZeros((value / 1_000).toFixed(1))}K`;
  }
  return value.toLocaleString("en-US");
}

function trimTrailingZeros(value: string): string {
  return value.replace(/\.0$/, "");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
