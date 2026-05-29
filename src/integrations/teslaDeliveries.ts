import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import {
  resolveIntegrationPolymarketQueue,
  type PolymarketQueueMarket,
  upsertPolymarketQueueUrl
} from "../polymarketQueue.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://ir.tesla.com/press";
const secSubmissionsUrl = "https://data.sec.gov/submissions/CIK0001318605.json";
const secArchiveBaseUrl = "https://www.sec.gov/Archives/edgar/data/1318605";
const secUserAgent = "PolymarketResolutionMonitorBot/0.1 tesla-deliveries-monitor";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const teslaMarketSearchQuery = "tesla deliveries";
const marketDiscoveryActiveIntervalMs = 6 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 14 * 24 * 60 * 60_000;

export type TeslaDeliveryRelease = {
  title: string;
  date: string;
  pressUrl: string;
  filingUrl: string;
  totalDeliveries: string | null;
};

type SecRecentFilings = {
  filings?: {
    recent?: {
      accessionNumber?: unknown[];
      filingDate?: unknown[];
      form?: unknown[];
      primaryDocument?: unknown[];
      items?: unknown[];
    };
  };
};

type SecFilingCandidate = {
  accessionNumber: string;
  accessionPath: string;
  filingDate: string;
};

type TeslaDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastTeslaDiscoveryAt?: string;
};

type GammaSearchResponse = {
  events?: GammaSearchEvent[];
};

type GammaSearchEvent = {
  slug?: unknown;
  title?: unknown;
  active?: unknown;
  closed?: unknown;
  endDate?: unknown;
  tags?: Array<{ slug?: unknown }>;
};

export function extractLatestTeslaDeliveryReleaseFromFilings(data: unknown): SecFilingCandidate[] {
  const recent = (data as SecRecentFilings | null)?.filings?.recent;
  if (!recent) {
    return [];
  }

  const forms = recent.form ?? [];
  return forms
    .map((form, index) => {
      const accessionNumber = recent.accessionNumber?.[index];
      const filingDate = recent.filingDate?.[index];
      const items = recent.items?.[index];
      if (form !== "8-K" || typeof accessionNumber !== "string" || typeof filingDate !== "string") {
        return null;
      }

      if (typeof items === "string" && !items.includes("2.02")) {
        return null;
      }

      return {
        accessionNumber,
        accessionPath: accessionNumber.replace(/-/g, ""),
        filingDate
      };
    })
    .filter((candidate): candidate is SecFilingCandidate => Boolean(candidate));
}

export function extractTeslaDeliveryReleaseFromExhibit(html: string, filingDate: string, filingUrl: string): TeslaDeliveryRelease | null {
  const $ = cheerio.load(html);
  const text = normalizeText($("body").text());
  const title = extractDeliveryTitle(text);
  if (!title) {
    return null;
  }

  return {
    title,
    date: filingDate,
    pressUrl: `https://ir.tesla.com/press-release/${slugifyTeslaPressTitle(title)}`,
    filingUrl,
    totalDeliveries: extractTotalDeliveries($, text)
  };
}

export function formatTeslaDeliveryReleaseValue(release: TeslaDeliveryRelease): string {
  return [
    `Title: ${release.title}`,
    `Date: ${release.date}`,
    `Total Deliveries: ${release.totalDeliveries ?? "not parsed"}`,
    `Press URL: ${release.pressUrl}`,
    `SEC Filing: ${release.filingUrl}`
  ].join("\n");
}

export const teslaDeliveriesAdapter: WebsiteAdapter = {
  id: "tesla-deliveries",
  commandName: "tesla",
  displayName: "Tesla Deliveries",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/how-many-tesla-deliveries-in-q2-2026",
  defaultChannelName: "tesla",
  alertRoleName: "Tesla Deliveries Alerts",
  alertRoleEmoji: "\uD83D\uDE97",
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshTeslaPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(): Promise<AdapterValue> {
    const filingsResponse = await fetchWithTimeout(secSubmissionsUrl, {
      headers: {
        "user-agent": secUserAgent
      }
    });
    if (!filingsResponse.ok) {
      throw new Error(`SEC submissions returned HTTP ${filingsResponse.status}`);
    }

    const candidates = extractLatestTeslaDeliveryReleaseFromFilings(await filingsResponse.json());
    for (const candidate of candidates.slice(0, 12)) {
      const release = await fetchReleaseFromCandidate(candidate);
      if (release) {
        const value = formatTeslaDeliveryReleaseValue(release);
        return {
          value,
          rawValue: value,
          unit: "latest Tesla deliveries release",
          observedAt: new Date()
        };
      }
    }

    throw new Error("Could not find a recent Tesla production and deliveries press release in SEC filings");
  }
};

export async function refreshTeslaPolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseTeslaDiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverTeslaMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastTeslaDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const candidates = await fetchTeslaMarketSearchCandidates(now);
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
      settings = parseTeslaDiscoverySettings(resolved.settingsJson);
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

export function parseTeslaDeliveryMarketWindow(
  slugOrUrl: string,
  title?: string,
  now: Date = new Date()
): { startAt: string; endAt: string } | null {
  const slug = getPolymarketSlug(slugOrUrl) ?? slugOrUrl;
  const text = `${slug} ${title ?? ""}`.toLowerCase();
  const explicitQuarter = text.match(/\bq([1-4])[-\s]*(20\d{2})\b/);
  if (explicitQuarter) {
    return buildQuarterWindow(Number(explicitQuarter[2]), Number(explicitQuarter[1]));
  }

  if (text.includes("this-quarter") || text.includes("this quarter")) {
    return buildQuarterWindow(getEasternYear(now), getEasternQuarter(now));
  }

  return null;
}

function shouldDiscoverTeslaMarkets(settings: TeslaDiscoverySettings, now: Date): boolean {
  const markets = normalizeTeslaQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastTeslaDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

async function fetchTeslaMarketSearchCandidates(
  now: Date
): Promise<Array<{ slug: string; url: string; title: string; endDate: string | null }>> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", teslaMarketSearchQuery);
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
    .map((event) => normalizeTeslaSearchEvent(event, now))
    .filter((candidate) => candidate !== null);
}

function normalizeTeslaSearchEvent(
  event: GammaSearchEvent,
  now: Date
): { slug: string; url: string; title: string; endDate: string | null } | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  const title = event.title;
  const lowerTitle = title.toLowerCase();
  if (!lowerTitle.includes("tesla") || !lowerTitle.includes("deliveries")) {
    return null;
  }

  const slug = event.slug;
  if (!slug.includes("tesla-deliveries") && !slug.includes("tesla") && !slug.includes("deliveries")) {
    return null;
  }

  const url = `https://polymarket.com/event/${slug}`;
  if (!parseTeslaDeliveryMarketWindow(slug, title, now)) {
    return null;
  }

  return { slug, url, title, endDate: isNonEmptyString(event.endDate) ? event.endDate : null };
}

function parseTeslaDiscoverySettings(settingsJson: string | null): TeslaDiscoverySettings {
  if (!settingsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(settingsJson) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const settings = parsed as TeslaDiscoverySettings;
    return {
      ...settings,
      polymarketMarkets: normalizeTeslaQueueMarkets(settings.polymarketMarkets),
      lastTeslaDiscoveryAt: typeof settings.lastTeslaDiscoveryAt === "string" ? settings.lastTeslaDiscoveryAt : undefined
    };
  } catch {
    return {};
  }
}

function normalizeTeslaQueueMarkets(value: unknown): PolymarketQueueMarket[] {
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

function buildQuarterWindow(year: number, quarter: number): { startAt: string; endAt: string } | null {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const endDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const startAt = parseManualEasternDateTime(`${year}-${padNumber(startMonth)}-01 00:00`);
  const endAt = parseManualEasternDateTime(`${year}-${padNumber(endMonth)}-${padNumber(endDay)} 23:59`);
  if (!startAt || !endAt) {
    return null;
  }

  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}

function getEasternYear(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(date));
}

function getEasternQuarter(date: Date): number {
  const month = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric" }).format(date));
  return Math.floor((month - 1) / 3) + 1;
}

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function fetchReleaseFromCandidate(candidate: SecFilingCandidate): Promise<TeslaDeliveryRelease | null> {
  const filingDirectoryUrl = `${secArchiveBaseUrl}/${candidate.accessionPath}`;
  const indexResponse = await fetchWithTimeout(`${filingDirectoryUrl}/index.json`, {
    headers: {
      "user-agent": secUserAgent
    }
  });
  if (!indexResponse.ok) {
    throw new Error(`SEC filing index returned HTTP ${indexResponse.status}`);
  }

  const indexData = (await indexResponse.json()) as { directory?: { item?: { name?: unknown }[] } };
  const exhibitNames = (indexData.directory?.item ?? [])
    .map((item) => item.name)
    .filter((name): name is string => typeof name === "string" && /^exhibit.*\.htm$/i.test(name));

  for (const exhibitName of exhibitNames) {
    const exhibitUrl = `${filingDirectoryUrl}/${exhibitName}`;
    const exhibitResponse = await fetchWithTimeout(exhibitUrl, {
      headers: {
        "user-agent": secUserAgent
      }
    });
    if (!exhibitResponse.ok) {
      throw new Error(`SEC exhibit returned HTTP ${exhibitResponse.status}`);
    }

    const release = extractTeslaDeliveryReleaseFromExhibit(await exhibitResponse.text(), candidate.filingDate, exhibitUrl);
    if (release) {
      return release;
    }
  }

  return null;
}

function extractDeliveryTitle(text: string): string | null {
  return (
    text.match(/Tesla\s+(?:First|Second|Third|Fourth)\s+Quarter\s+20\d{2}\s+Production,\s+Deliveries\s+(?:&|and)\s+Deployments/i)?.[0] ??
    text.match(/Tesla\s+Vehicle\s+Production\s+&\s+Deliveries[^.]+/i)?.[0] ??
    null
  );
}

function extractTotalDeliveries($: cheerio.CheerioAPI, text: string): string | null {
  for (const row of $("tr").toArray()) {
    const cells = $(row)
      .find("td,th")
      .map((_, cell) => normalizeText($(cell).text()))
      .get()
      .filter(Boolean);
    if (cells[0] === "Total" && cells[2]) {
      return cells[2];
    }
  }

  return text.match(/Total\s*((?:\d{1,3},)+\d{3})\s*((?:\d{1,3},)+\d{3})\s*\d+%/)?.[2] ?? null;
}

function slugifyTeslaPressTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
