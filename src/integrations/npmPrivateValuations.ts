import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import { resolveIntegrationPolymarketQueue, type PolymarketQueueMarket } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import { formatEasternDateTime } from "../time.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const gammaEventsUrl = "https://gamma-api.polymarket.com/events";
const secondMarketRenderPrefix = "https://r.jina.ai/http://";
const secondMarketPublicApiBaseUrl = "https://api-npm17-data-company-pricing-review-prod.k8s-prod-1.npmdev.net/api/public/companies";
const userAgent = "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1";
const burstPollIntervalMinutes = 10 / 60;
const normalPollIntervalMinutes = 1;
const discoveryIntervalMs = 30 * 60_000;

export type NpmValuationConfig = {
  id: string;
  commandName: string;
  displayName: string;
  companyName: string;
  sourceUrl: string;
  defaultPolymarketUrl: string;
  defaultChannelName: string;
  alertRoleName: string;
  alertRoleEmoji: string;
  slugCompanyPart: string;
  autoDiscoverMonthlyMarkets?: boolean;
};

export type NpmValuationSnapshot = {
  companyName: string;
  asOf: string;
  valuation: string;
  pricePerShare: string;
  sourceUrl: string;
};

type NpmValuationSettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastNpmValuationDiscoveryAt?: string;
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
  creationDate?: unknown;
  createdAt?: unknown;
  endDate?: unknown;
};

type NpmPublicCompanyResponse = {
  latest_npm_price?: {
    price?: unknown;
    date?: unknown;
    implied_valuation?: unknown;
  };
  latest_tape_d?: {
    price?: unknown;
    date?: unknown;
    implied_valuation?: unknown;
  };
  company?: {
    dba_name?: unknown;
  };
};

const configs: NpmValuationConfig[] = [
  {
    id: "npm-anthropic-valuation",
    commandName: "anthropicvaluation",
    displayName: "NPM Anthropic Valuation",
    companyName: "Anthropic",
    sourceUrl: "https://fe.secondmarket.com/companies/company-3e197763-4ff8-4d8c-bd1f-cc2792937757/data",
    defaultPolymarketUrl: "https://polymarket.com/event/will-anthropics-valuation-hit-by-december-31",
    defaultChannelName: "npm-anthropic-valuation",
    alertRoleName: "NPM Anthropic Valuation Alerts",
    alertRoleEmoji: "\uD83E\uDDE0",
    slugCompanyPart: "anthropics"
  },
  {
    id: "npm-openai-valuation",
    commandName: "openaivaluation",
    displayName: "NPM OpenAI Valuation",
    companyName: "OpenAI",
    sourceUrl: "https://fe.secondmarket.com/companies/company-30839e0b-2730-4495-839f-1bf638fa9cca/data",
    defaultPolymarketUrl: "https://polymarket.com/event/will-openais-valuation-hit-by-december-31",
    defaultChannelName: "npm-openai-valuation",
    alertRoleName: "NPM OpenAI Valuation Alerts",
    alertRoleEmoji: "\uD83E\uDD16",
    slugCompanyPart: "openais"
  },
  {
    id: "npm-stripe-valuation",
    commandName: "stripevaluation",
    displayName: "NPM Stripe Valuation",
    companyName: "Stripe",
    sourceUrl: "https://fe.secondmarket.com/companies/company-6edded11-6786-4392-9695-3cce6fda0de0/data",
    defaultPolymarketUrl: "https://polymarket.com/event/will-stripes-valuation-hit-by-december-31",
    defaultChannelName: "npm-stripe-valuation",
    alertRoleName: "NPM Stripe Valuation Alerts",
    alertRoleEmoji: "\uD83D\uDCB3",
    slugCompanyPart: "stripes"
  },
  {
    id: "npm-databricks-valuation",
    commandName: "databricksvaluation",
    displayName: "NPM Databricks Valuation",
    companyName: "Databricks",
    sourceUrl: "https://fe.secondmarket.com/companies/company-53787f17-a704-47a9-895a-cb54833bdb1f/data",
    defaultPolymarketUrl: "https://polymarket.com/event/will-databricks-valuation-hit-by-june-30",
    defaultChannelName: "npm-databricks-valuation",
    alertRoleName: "NPM Databricks Valuation Alerts",
    alertRoleEmoji: "\uD83E\uDDF1",
    slugCompanyPart: "databricks",
    autoDiscoverMonthlyMarkets: true
  },
  {
    id: "npm-neuralink-valuation",
    commandName: "neuralinkvaluation",
    displayName: "NPM Neuralink Valuation",
    companyName: "Neuralink",
    sourceUrl: "https://fe.secondmarket.com/companies/company-782c0a32-4727-4097-a40b-9a2602f243e7/data",
    defaultPolymarketUrl: "https://polymarket.com/event/will-neuralinks-valuation-hit-by-june-30",
    defaultChannelName: "npm-neuralink-valuation",
    alertRoleName: "NPM Neuralink Valuation Alerts",
    alertRoleEmoji: "\uD83E\uDDEC",
    slugCompanyPart: "neuralinks",
    autoDiscoverMonthlyMarkets: true
  },
  {
    id: "npm-perplexity-valuation",
    commandName: "perplexityvaluation",
    displayName: "NPM Perplexity Valuation",
    companyName: "Perplexity",
    sourceUrl: "https://fe.secondmarket.com/companies/company-802a7f97-3625-4614-a13d-d999cf139330/data",
    defaultPolymarketUrl: "https://polymarket.com/event/will-perplexitys-valuation-hit-by-june-30",
    defaultChannelName: "npm-perplexity-valuation",
    alertRoleName: "NPM Perplexity Valuation Alerts",
    alertRoleEmoji: "\uD83D\uDD0E",
    slugCompanyPart: "perplexitys",
    autoDiscoverMonthlyMarkets: true
  },
  {
    id: "npm-kraken-valuation",
    commandName: "krakenvaluation",
    displayName: "NPM Kraken Valuation",
    companyName: "Kraken",
    sourceUrl: "https://fe.secondmarket.com/companies/company-ab5413cb-1c83-497e-b03e-2ed7ca70117d/data",
    defaultPolymarketUrl: "https://polymarket.com/event/will-krakens-valuation-hit-by-june-30",
    defaultChannelName: "npm-kraken-valuation",
    alertRoleName: "NPM Kraken Valuation Alerts",
    alertRoleEmoji: "\uD83D\uDC19",
    slugCompanyPart: "krakens",
    autoDiscoverMonthlyMarkets: true
  },
  {
    id: "npm-lambda-valuation",
    commandName: "lambdavaluation",
    displayName: "NPM Lambda Valuation",
    companyName: "Lambda",
    sourceUrl: "https://fe.secondmarket.com/companies/company-86eda4f2-01af-4275-9c70-0ff3c347c62b/data",
    defaultPolymarketUrl: "https://polymarket.com/event/will-lambdas-valuation-hit-by-june-30",
    defaultChannelName: "npm-lambda-valuation",
    alertRoleName: "NPM Lambda Valuation Alerts",
    alertRoleEmoji: "\uD83D\uDD3A",
    slugCompanyPart: "lambdas",
    autoDiscoverMonthlyMarkets: true
  },
  {
    id: "npm-epic-games-valuation",
    commandName: "epicgamesvaluation",
    displayName: "NPM Epic Games Valuation",
    companyName: "Epic Games",
    sourceUrl: "https://fe.secondmarket.com/companies/company-625e5f47-7ff7-45c4-be95-0305665164bd/data",
    defaultPolymarketUrl: "https://polymarket.com/event/will-epic-games-valuation-hit-by-june-30",
    defaultChannelName: "npm-epic-games-valuation",
    alertRoleName: "NPM Epic Games Valuation Alerts",
    alertRoleEmoji: "\uD83C\uDFAE",
    slugCompanyPart: "epic-games",
    autoDiscoverMonthlyMarkets: true
  },
  {
    id: "npm-canva-valuation",
    commandName: "canvavaluation",
    displayName: "NPM Canva Valuation",
    companyName: "Canva",
    sourceUrl: "https://fe.secondmarket.com/companies/company-5e0e75a3-96d6-4893-8f23-9d9bac0ec1db/data",
    defaultPolymarketUrl: "https://polymarket.com/event/will-canvas-valuation-hit-by-june-30",
    defaultChannelName: "npm-canva-valuation",
    alertRoleName: "NPM Canva Valuation Alerts",
    alertRoleEmoji: "\uD83C\uDFA8",
    slugCompanyPart: "canvas",
    autoDiscoverMonthlyMarkets: true
  },
  {
    id: "npm-anduril-valuation",
    commandName: "andurilvaluation",
    displayName: "NPM Anduril Valuation",
    companyName: "Anduril",
    sourceUrl: "https://fe.secondmarket.com/companies/company-c62b8140-fdeb-428d-a9a6-d04eb3b24b49/data",
    defaultPolymarketUrl: "https://polymarket.com/event/will-andurils-valuation-hit-by-december-31",
    defaultChannelName: "npm-anduril-valuation",
    alertRoleName: "NPM Anduril Valuation Alerts",
    alertRoleEmoji: "\uD83D\uDEE1",
    slugCompanyPart: "andurils"
  },
  {
    id: "npm-glean-valuation",
    commandName: "gleanvaluation",
    displayName: "NPM Glean Valuation",
    companyName: "Glean",
    sourceUrl: "https://fe.secondmarket.com/companies/company-77127aa8-38b7-4737-b764-a5024345b19b/data",
    defaultPolymarketUrl: "https://polymarket.com/event/will-gleans-valuation-hit-by-july-31-20260630191932865",
    defaultChannelName: "npm-glean-valuation",
    alertRoleName: "NPM Glean Valuation Alerts",
    alertRoleEmoji: "\uD83D\uDCDA",
    slugCompanyPart: "gleans",
    autoDiscoverMonthlyMarkets: true
  },
  {
    id: "npm-bytedance-valuation",
    commandName: "bytedancevaluation",
    displayName: "NPM ByteDance Valuation",
    companyName: "ByteDance",
    sourceUrl: "https://fe.secondmarket.com/companies/company-f364d2ab-34b7-48c9-a2b7-af62da804953/data",
    defaultPolymarketUrl: "https://polymarket.com/event/will-bytedances-valuation-hit-by-july-31-20260630191802167",
    defaultChannelName: "npm-bytedance-valuation",
    alertRoleName: "NPM ByteDance Valuation Alerts",
    alertRoleEmoji: "\uD83C\uDFB5",
    slugCompanyPart: "bytedances",
    autoDiscoverMonthlyMarkets: true
  },
  {
    id: "npm-revolut-valuation",
    commandName: "revolutvaluation",
    displayName: "NPM Revolut Valuation",
    companyName: "Revolut",
    sourceUrl: "https://fe.secondmarket.com/companies/company-70f3c3d1-565b-491a-83df-54d0c8b08186/data",
    defaultPolymarketUrl: "https://polymarket.com/event/will-revoluts-valuation-hit-by-july-31-20260630191941630",
    defaultChannelName: "npm-revolut-valuation",
    alertRoleName: "NPM Revolut Valuation Alerts",
    alertRoleEmoji: "\uD83D\uDCB8",
    slugCompanyPart: "revoluts",
    autoDiscoverMonthlyMarkets: true
  }
];

export const npmPrivateValuationAdapters = configs.map(createNpmPrivateValuationAdapter);

export function createNpmPrivateValuationAdapter(config: NpmValuationConfig): WebsiteAdapter {
  return {
    id: config.id,
    commandName: config.commandName,
    displayName: config.displayName,
    sourceUrl: config.sourceUrl,
    defaultPolymarketUrl: config.defaultPolymarketUrl,
    defaultChannelName: config.defaultChannelName,
    alertRoleName: config.alertRoleName,
    alertRoleEmoji: config.alertRoleEmoji,
    getPollIntervalMinutes: getNpmValuationPollIntervalMinutes,
    getPollIntervalReason: getNpmValuationPollIntervalReason,
    shouldAlertOnChange: shouldAlertOnNpmValuationChange,
    ...(config.autoDiscoverMonthlyMarkets
      ? {
          async refreshSettings(integration: Integration): Promise<string> {
            return (await refreshNpmValuationPolymarketQueue(integration, config)).settingsJson ?? integration.settingsJson ?? "{}";
          },
          async upsertPolymarketMarket(
            integration: Integration,
            url: string
          ): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
            return upsertNpmValuationPolymarketQueueUrl(integration, config, url);
          }
        }
      : {}),
    async fetchCurrentValue(): Promise<AdapterValue> {
      const snapshot = await fetchNpmValuationSnapshot(config);
      return {
        value: formatNpmValuationValue(snapshot),
        rawValue: `${snapshot.companyName}|${snapshot.asOf}|${snapshot.valuation}|${snapshot.pricePerShare}`,
        unit: "NPM private valuation",
        observedAt: new Date()
      };
    }
  };
}

export function getNpmValuationPollIntervalMinutes(_integration: Integration, now: Date = new Date()): number {
  return isNpmValuationBurstWindow(now) ? burstPollIntervalMinutes : normalPollIntervalMinutes;
}

export function getNpmValuationPollIntervalReason(_integration: Integration, now: Date = new Date()): string {
  return isNpmValuationBurstWindow(now)
    ? "NPM 1:00 PM ET release window: polling every 10 seconds from 12:50 PM to 1:10 PM ET"
    : "NPM valuation monitor: polling every minute outside the 1:00 PM ET release window";
}

export function isNpmValuationBurstWindow(now: Date = new Date()): boolean {
  const parts = getEasternTimeParts(now);
  const secondsSinceMidnight = parts.hour * 3600 + parts.minute * 60 + parts.second;
  return secondsSinceMidnight >= 12 * 3600 + 50 * 60 && secondsSinceMidnight <= 13 * 3600 + 10 * 60;
}

export function extractNpmValuationSnapshot(markdown: string, sourceUrl: string): NpmValuationSnapshot {
  const companyName = matchSingleLine(markdown, /^##\s+(.+)$/m);
  const asOf = matchSingleLine(markdown, /^As of\s+(.+)$/m);
  const valuation = matchAfterHeading(markdown, "Valuation");
  const pricePerShare = matchAfterHeading(markdown, "Price Per Share");
  if (!companyName || !asOf || !valuation || !pricePerShare) {
    throw new Error("Could not parse NPM valuation snapshot from rendered markdown");
  }

  return {
    companyName,
    asOf,
    valuation: normalizeNpmDollarString(valuation),
    pricePerShare: normalizeNpmDollarString(pricePerShare),
    sourceUrl
  };
}

export function extractNpmValuationSnapshotFromApi(payload: NpmPublicCompanyResponse, sourceUrl: string): NpmValuationSnapshot {
  const latestPrice = payload.latest_npm_price ?? payload.latest_tape_d;
  const companyName = typeof payload.company?.dba_name === "string" ? payload.company.dba_name.trim() : "";
  const asOf = typeof latestPrice?.date === "string" ? formatNpmApiDate(latestPrice.date) : "";
  const valuation = formatNpmDollarValue(latestPrice?.implied_valuation, 3);
  const pricePerShare = formatNpmDollarValue(latestPrice?.price, 2);
  if (!companyName || !asOf || !valuation || !pricePerShare) {
    throw new Error("Could not parse NPM valuation snapshot from public API");
  }

  return {
    companyName,
    asOf,
    valuation,
    pricePerShare,
    sourceUrl
  };
}

export function formatNpmValuationValue(snapshot: NpmValuationSnapshot): string {
  return [
    "Metric: NPM private company valuation",
    `Company: ${snapshot.companyName}`,
    `As of: ${snapshot.asOf}`,
    `Valuation: ${normalizeNpmDollarString(snapshot.valuation)}`,
    `Price per share: ${normalizeNpmDollarString(snapshot.pricePerShare)}`,
    "Expected update: 1:00 PM ET on NPM business days",
    `Resolution: ${snapshot.sourceUrl}`
  ].join("\n");
}

export function shouldAlertOnNpmValuationChange(previousValue: string | null, currentValue: string): boolean {
  return previousValue !== null && normalizeNpmValuationValueForComparison(previousValue) !== normalizeNpmValuationValueForComparison(currentValue);
}

export function normalizeNpmValuationValueForComparison(value: string): string {
  return value.replace(/\$-?\d+(?:,\d{3})*(?:\.\d+)?[TBM]?/g, (match) => normalizeNpmDollarString(match));
}

export async function refreshNpmValuationPolymarketQueue(
  integration: Integration,
  config: NpmValuationConfig,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseNpmValuationSettings(resolved.settingsJson);
  if (!isNpmValuationDiscoveryDue(settings.lastNpmValuationDiscoveryAt, now)) {
    return resolved;
  }

  settings = { ...settings, lastNpmValuationDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    let markets = normalizeNpmValuationQueueMarkets(settings.polymarketMarkets);
    const existingSlugs = new Set(markets.map((market) => market.slug));
    for (const candidate of await fetchNpmValuationMarketSearchCandidates(config, now)) {
      if (existingSlugs.has(candidate.slug)) {
        continue;
      }

      markets = upsertNpmValuationQueueMarket(markets, candidate);
      existingSlugs.add(candidate.slug);
    }

    settings = { ...settings, polymarketMarkets: sortMarkets(markets) };
    return resolveIntegrationPolymarketQueue(
      {
        ...integration,
        settingsJson: JSON.stringify(settings),
        polymarketUrl: resolved.activeUrl ?? integration.polymarketUrl
      },
      now
    );
  } catch {
    return resolved;
  }
}

export async function upsertNpmValuationPolymarketQueueUrl(
  integration: Integration,
  config: NpmValuationConfig,
  url: string,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  const settings = parseNpmValuationSettings(integration.settingsJson);
  const markets = upsertNpmValuationQueueMarket(
    normalizeNpmValuationQueueMarkets(settings.polymarketMarkets),
    (await fetchNpmValuationMarketByUrl(config, url, now).catch(() => null)) ?? buildNpmValuationQueueMarketFromUrl(url, now)
  );

  return resolveIntegrationPolymarketQueue(
    {
      ...integration,
      settingsJson: JSON.stringify({
        ...settings,
        polymarketMarkets: sortMarkets(markets)
      })
    },
    now
  );
}

export function normalizeNpmValuationMarketSearchEvent(
  event: GammaSearchEvent,
  config: NpmValuationConfig,
  now: Date = new Date()
): PolymarketQueueMarket | null {
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
  if (!isMatchingMonthlyValuationSlug(slug, config)) {
    return null;
  }

  const url = `https://polymarket.com/event/${slug}`;
  const market = buildNpmValuationQueueMarketFromUrl(url, now);
  return {
    ...market,
    startAt:
      parseGammaDate(event.startDate)?.toISOString() ??
      parseGammaDate(event.creationDate)?.toISOString() ??
      parseGammaDate(event.createdAt)?.toISOString() ??
      market.startAt,
    endAt: market.endAt
  };
}

async function fetchNpmValuationSnapshot(config: NpmValuationConfig): Promise<NpmValuationSnapshot> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchNpmValuationSnapshotFromApi(config.sourceUrl);
    } catch (error) {
      lastError = error;
      try {
        const markdown = await fetchNpmValuationMarkdown(config.sourceUrl);
        return extractNpmValuationSnapshot(markdown, config.sourceUrl);
      } catch (fallbackError) {
        lastError = fallbackError;
        await delay(1_000);
      }
    }
  }

  throw new Error(
    `Could not parse NPM valuation data for ${config.companyName}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

async function fetchNpmValuationSnapshotFromApi(sourceUrl: string): Promise<NpmValuationSnapshot> {
  const companyGuid = parseNpmCompanyGuid(sourceUrl);
  if (!companyGuid) {
    throw new Error(`Could not parse NPM company id from ${sourceUrl}`);
  }

  const response = await fetchWithTimeout(`${secondMarketPublicApiBaseUrl}/${encodeURIComponent(companyGuid)}`, {
    headers: {
      accept: "application/json",
      "user-agent": userAgent
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`NPM public API returned HTTP ${response.status}: ${text.slice(0, 160)}`);
  }

  return extractNpmValuationSnapshotFromApi(JSON.parse(text) as NpmPublicCompanyResponse, sourceUrl);
}

async function fetchNpmValuationMarkdown(sourceUrl: string): Promise<string> {
  const response = await fetchWithTimeout(`${secondMarketRenderPrefix}${sourceUrl}`, {
    headers: {
      accept: "text/plain",
      "user-agent": userAgent
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Rendered NPM valuation page returned HTTP ${response.status}: ${text.slice(0, 160)}`);
  }

  return text;
}

async function fetchNpmValuationMarketSearchCandidates(
  config: NpmValuationConfig,
  now: Date
): Promise<PolymarketQueueMarket[]> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", `will ${config.companyName} valuation hit`);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": userAgent }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? [])
    .map((event) => normalizeNpmValuationMarketSearchEvent(event, config, now))
    .filter((market): market is PolymarketQueueMarket => market !== null);
}

async function fetchNpmValuationMarketByUrl(
  config: NpmValuationConfig,
  url: string,
  now: Date
): Promise<PolymarketQueueMarket | null> {
  const slug = getPolymarketSlug(url);
  if (!slug || !isMatchingMonthlyValuationSlug(slug, config)) {
    return null;
  }

  const response = await fetchWithTimeout(`${gammaEventsUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: { "user-agent": userAgent }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const events = (await response.json()) as GammaSearchEvent[];
  return normalizeNpmValuationMarketSearchEvent(events[0] ?? {}, config, now);
}

function buildNpmValuationQueueMarketFromUrl(url: string, now: Date): PolymarketQueueMarket {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${url}`);
  }

  const target = parseNpmValuationTargetFromSlug(slug, now);
  return {
    url,
    slug,
    startAt: now.toISOString(),
    endAt: target.endAt,
    addedAt: now.toISOString()
  };
}

function parseNpmValuationTargetFromSlug(slug: string, now: Date = new Date()): { month: number; day: number; year: number; endAt: string | null } {
  const parts = slug.split("-").map((part) => part.toLowerCase());
  const byIndex = parts.findIndex((part) => part === "by");
  const month = monthNumber(parts[byIndex + 1]);
  const day = parseDay(parts[byIndex + 2]);
  if (!month || !day) {
    throw new Error(`Could not parse NPM valuation target date from ${slug}`);
  }

  const explicitYear = parts.slice(byIndex + 3).map(parseYear).find((value): value is number => value !== null);
  const year = explicitYear ?? inferTargetYear(month, now);
  const reportDate = addUtcDays(`${year}-${padNumber(month)}-${padNumber(day)}`, 1);
  const endAt = parseManualEasternDateTime(`${reportDate} 13:10`)?.toISOString() ?? null;
  return { month, day, year, endAt };
}

function isMatchingMonthlyValuationSlug(slug: string, config: NpmValuationConfig): boolean {
  if (!slug.startsWith(`will-${config.slugCompanyPart}-valuation-hit-by-`)) {
    return false;
  }

  const target = parseNpmValuationTargetFromSlug(slug);
  return target.month !== 12;
}

function parseNpmValuationSettings(settingsJson: string | null): NpmValuationSettings {
  const settings = parseSettingsJson(settingsJson) as NpmValuationSettings;
  return {
    ...settings,
    polymarketMarkets: normalizeNpmValuationQueueMarkets(settings.polymarketMarkets),
    lastNpmValuationDiscoveryAt:
      typeof settings.lastNpmValuationDiscoveryAt === "string" ? settings.lastNpmValuationDiscoveryAt : undefined
  };
}

function normalizeNpmValuationQueueMarkets(value: unknown): PolymarketQueueMarket[] {
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

function upsertNpmValuationQueueMarket(markets: PolymarketQueueMarket[], market: PolymarketQueueMarket): PolymarketQueueMarket[] {
  const existingIndex = markets.findIndex((candidate) => candidate.slug === market.slug);
  if (existingIndex === -1) {
    return sortMarkets([...markets, market]);
  }

  const next = [...markets];
  next[existingIndex] = { ...next[existingIndex], ...market, addedAt: next[existingIndex].addedAt };
  return sortMarkets(next);
}

function sortMarkets(markets: PolymarketQueueMarket[]): PolymarketQueueMarket[] {
  return [...markets].sort((left, right) => {
    const leftEnd = left.endAt ? Date.parse(left.endAt) : Number.MAX_SAFE_INTEGER;
    const rightEnd = right.endAt ? Date.parse(right.endAt) : Number.MAX_SAFE_INTEGER;
    return leftEnd - rightEnd || left.slug.localeCompare(right.slug);
  });
}

function isNpmValuationDiscoveryDue(lastDiscoveryAt: string | undefined, now: Date): boolean {
  if (!lastDiscoveryAt) {
    return true;
  }

  const lastDiscoveryMs = Date.parse(lastDiscoveryAt);
  return Number.isNaN(lastDiscoveryMs) || now.getTime() - lastDiscoveryMs >= discoveryIntervalMs;
}

function matchSingleLine(value: string, pattern: RegExp): string | null {
  const match = value.match(pattern);
  return match?.[1]?.trim() || null;
}

function matchAfterHeading(markdown: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.match(new RegExp(`^${escaped}\\s*\\n\\s*##\\s*([^\\n]+)`, "m"))?.[1]?.trim() ?? null;
}

function parseNpmCompanyGuid(sourceUrl: string): string | null {
  const match = sourceUrl.match(/\/companies\/([^/?#]+)\/data/i);
  return match?.[1] ?? null;
}

function formatNpmApiDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatNpmDollarValue(value: unknown, decimals: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const absValue = Math.abs(value);
  const units = [
    { suffix: "T", divisor: 1_000_000_000_000 },
    { suffix: "B", divisor: 1_000_000_000 },
    { suffix: "M", divisor: 1_000_000 }
  ];
  const unit = units.find((candidate) => absValue >= candidate.divisor);
  if (!unit) {
    return `$${value.toFixed(decimals)}`;
  }

  return `$${trimTrailingZeros((value / unit.divisor).toFixed(decimals))}${unit.suffix}`;
}

function trimTrailingZeros(value: string): string {
  return value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function normalizeNpmDollarString(value: string): string {
  return value.replace(/\$-?\d+(?:,\d{3})*(?:\.\d+)?[TBM]?/g, normalizeNpmDollarMatch);
}

function normalizeNpmDollarMatch(match: string): string {
  const parsed = match.match(/^\$(-?\d+(?:,\d{3})*(?:\.\d+)?)([TBM]?)$/);
  if (!parsed) {
    return match;
  }

  const suffix = parsed[2];
  const numeric = parsed[1].replace(/,/g, "");
  const sign = numeric.startsWith("-") ? "-" : "";
  const absolute = sign ? numeric.slice(1) : numeric;
  const [integerPart, fractionPart = ""] = absolute.split(".");
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "") || "0";
  const normalizedFraction = fractionPart.replace(/0+$/, "");
  const fraction = normalizedFraction ? `.${normalizedFraction}` : "";
  return `$${sign}${addThousandsSeparators(normalizedInteger)}${fraction}${suffix}`;
}

function addThousandsSeparators(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function getEasternTimeParts(date: Date): { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  return {
    hour: parsePart(parts, "hour"),
    minute: parsePart(parts, "minute"),
    second: parsePart(parts, "second")
  };
}

function parsePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  return Number(parts.find((part) => part.type === type)?.value ?? 0);
}

function parseGammaDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function inferTargetYear(month: number, now: Date): number {
  const easternYear = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric"
    }).format(now)
  );
  const easternMonth = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "2-digit"
    }).format(now)
  );
  return month + 2 < easternMonth ? easternYear + 1 : easternYear;
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
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
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 31 ? parsed : null;
}

function parseYear(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2020 && parsed <= 2100 ? parsed : null;
}

function padNumber(value: number): string {
  return value.toString().padStart(2, "0");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function describeNpmValuationMarketWindow(slug: string, now: Date = new Date()): string {
  const target = parseNpmValuationTargetFromSlug(slug, now);
  return target.endAt ? `NPM target report window ends ${formatEasternDateTime(target.endAt)}` : "NPM target report window not parsed";
}
