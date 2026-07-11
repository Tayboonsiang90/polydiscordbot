import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import { resolveIntegrationPolymarketQueue, type PolymarketQueueMarket } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.natesilver.net/p/trump-approval-ratings-nate-silver-bulletin";
const datawrapperChartUrl = "https://datawrapper.dwcdn.net/kSCt4/";
const staticDatasetUrl = "https://static.dwcdn.net/data/kSCt4.csv";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const gammaEventsUrl = "https://gamma-api.polymarket.com/events";
const defaultPolymarketUrl = "https://polymarket.com/event/trump-approval-rating-on-june-5";
const targetDate = "2026-06-05";
const easternTimeZone = "America/New_York";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 15 * 60_000;

export type SilverApprovalRow = {
  date: string;
  approve: number;
  disapprove: number | null;
};

export type SilverApprovalMarketMetadata = {
  slug: string;
  url: string;
  kind: "single-date" | "up-down";
  title: string;
  targetDate?: string;
  firstDate?: string;
  secondDate?: string;
  startAt: string | null;
  endAt: string | null;
  addedAt: string;
};

type SilverApprovalSettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  silverApprovalMarkets?: SilverApprovalMarketMetadata[];
  lastSilverApprovalMarketDiscoveryAt?: string;
};

type GammaSearchResponse = {
  events?: GammaSearchEvent[];
};

type GammaSearchEvent = {
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
};

export const silverTrumpApprovalAdapter: WebsiteAdapter = {
  id: "silver-trump-approval",
  commandName: "trumpapproval",
  displayName: "Silver Trump Approval",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "trumpapproval",
  alertRoleName: "Trump Approval Alerts",
  alertRoleEmoji: "\uD83D\uDCCA",
  getPollIntervalMinutes: getSilverTrumpApprovalPollIntervalMinutes,
  getPollIntervalReason: getSilverTrumpApprovalPollIntervalReason,
  shouldAlertOnChange: silverTrumpApprovalShouldAlertOnChange,
  async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
    return (await refreshSilverTrumpApprovalPolymarketQueue(integration, new Date(), options)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async upsertPolymarketMarket(
    integration: Integration,
    url: string
  ): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertSilverTrumpApprovalPolymarketQueueUrl(integration, url);
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const { csv, datasetUrl } = await fetchSilverApprovalCsv();
    const markets = getActiveSilverApprovalMarkets(integration);
    if (markets.length === 0 && isSilverApprovalTrackedUrl(integration?.polymarketUrl)) {
      throw new Error("Could not parse Silver Approval Polymarket metadata from Gamma yet");
    }

    const value =
      markets.length > 1
        ? extractSilverTrumpApprovalMultiMarketValue(csv, datasetUrl, markets, new Date())
        : extractSilverTrumpApprovalValue(csv, datasetUrl, markets[0] ?? null, new Date());
    return {
      value,
      rawValue: extractRawApproval(value) ?? value,
      unit: "approval percentage",
      observedAt: new Date()
    };
  }
};

export function extractSilverTrumpApprovalMultiMarketValue(
  csv: string,
  datasetUrl: string,
  markets: SilverApprovalMarketMetadata[],
  now: Date = new Date()
): string {
  const rows = parseSilverApprovalRows(csv);
  return [
    "Metric: Silver Bulletin Trump approval markets",
    `Active markets: ${markets.length}`,
    ...markets.flatMap((market, index) => [
      "",
      `Tracked market ${index + 1}: ${market.title}`,
      market.kind === "up-down" ? buildSilverUpDownValue(rows, datasetUrl, market, now) : buildSingleDateApprovalValue(rows, datasetUrl, market)
    ])
  ].join("\n");
}

export function extractSilverTrumpApprovalValue(
  csv: string,
  datasetUrl: string,
  market: SilverApprovalMarketMetadata | null = null,
  now: Date = new Date()
): string {
  const rows = parseSilverApprovalRows(csv);
  if (market?.kind === "up-down") {
    return buildSilverUpDownValue(rows, datasetUrl, market, now);
  }

  return buildSingleDateApprovalValue(rows, datasetUrl, market);
}

function buildSingleDateApprovalValue(rows: SilverApprovalRow[], datasetUrl: string, market: SilverApprovalMarketMetadata | null = null): string {
  const activeTargetDate = market?.kind === "single-date" && market.targetDate ? market.targetDate : targetDate;
  const target = rows.find((row) => row.date === activeTargetDate) ?? null;
  const latest = rows.at(-1) ?? null;
  const nextAfterTarget = rows.find((row) => row.date > activeTargetDate) ?? null;
  const finalized = Boolean(target && nextAfterTarget);

  if (target && finalized) {
    return [
      "Metric: Silver Bulletin Trump approval rating",
      `Market: ${market?.title ?? "Trump approval rating"}`,
      `Target date: ${activeTargetDate}`,
      "Target status: finalized",
      `Approval: ${formatPercent(target.approve)}`,
      `Disapproval: ${formatNullablePercent(target.disapprove)}`,
      `Finalized by next data point: ${nextAfterTarget?.date ?? "not available"}`,
      `Latest available: ${formatRow(latest)}`,
      `Chart data: ${datasetUrl}`,
      `Resolution: ${sourceUrl}`
    ].join("\n");
  }

  return [
    "Metric: Silver Bulletin Trump approval rating",
    `Market: ${market?.title ?? "Trump approval rating"}`,
    `Target date: ${activeTargetDate}`,
    `Target status: ${target ? "published; waiting for next data point to finalize" : "not published yet"}`,
    `Approval: ${target ? formatPercent(target.approve) : "not published yet"}`,
    `Disapproval: ${target ? formatNullablePercent(target.disapprove) : "not published yet"}`,
    "Finalized by next data point: not yet",
    `Latest available: ${formatRow(latest)}`,
    `Chart data: ${datasetUrl}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

function buildSilverUpDownValue(
  rows: SilverApprovalRow[],
  datasetUrl: string,
  market: SilverApprovalMarketMetadata,
  now: Date
): string {
  const firstDate = market.firstDate ?? targetDate;
  const secondDate = market.secondDate ?? targetDate;
  const firstReference = resolveFirstReference(rows, firstDate);
  const secondReference = resolveSecondReference(rows, secondDate, now);
  const latest = rows.at(-1) ?? null;
  const deadlineAt = getSecondReferenceFallbackDeadline(secondDate);
  const result = firstReference.row && secondReference.row ? compareApprovalRows(firstReference.row, secondReference.row) : "Pending";
  const status = getUpDownStatus(firstReference, secondReference);
  const resultPrefix = status === "finalized" ? "Final" : status === "pending" ? "Pending" : "Tentative";

  return [
    "Metric: Silver Bulletin Trump approval Up/Down",
    `Market: ${market.title}`,
    `Reference dates: ${firstDate} vs ${secondDate}`,
    `Status: ${formatUpDownStatus(status, secondDate, deadlineAt, secondReference)}`,
    `Result: ${result === "Pending" ? "Pending" : `${resultPrefix} ${result}`}`,
    `First reference: ${formatReference(firstReference, firstDate)}`,
    `Second reference: ${formatReference(secondReference, secondDate)}`,
    `Comparison: ${formatComparison(firstReference.row, secondReference.row)}`,
    `Fallback deadline: ${deadlineAt.toISOString()} (12:00 PM ET on third calendar day after second date)`,
    `Latest available: ${formatRow(latest)}`,
    `Chart data: ${datasetUrl}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function parseSilverApprovalRows(csv: string): SilverApprovalRow[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return [];
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  const modelDateIndex = headers.indexOf("modeldate");
  const approveIndex = headers.indexOf("approve");
  const disapproveIndex = headers.indexOf("disapprove");
  if (modelDateIndex === -1 || approveIndex === -1) {
    return [];
  }

  return lines
    .slice(1)
    .map((line) => {
      const cells = splitCsvLine(line);
      const date = formatModelDate(cells[modelDateIndex]);
      const approve = parseNumber(cells[approveIndex]);
      if (!date || approve === null) {
        return null;
      }

      return {
        date,
        approve,
        disapprove: disapproveIndex === -1 ? null : parseNumber(cells[disapproveIndex])
      };
    })
    .filter((row): row is SilverApprovalRow => row !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function resolveSilverDatawrapperDatasetUrl(html: string): string | null {
  const match = html.match(/https:\/\/datawrapper\.dwcdn\.net\/kSCt4\/(\d+)\//) ?? html.match(/kSCt4\/(\d+)\//);
  return match ? `https://datawrapper.dwcdn.net/kSCt4/${match[1]}/dataset.csv` : null;
}

export function getSilverTrumpApprovalPollIntervalMinutes(integration: Integration, now: Date = new Date()): number {
  if (integration.lastValue?.includes("Target status: finalized") || integration.lastValue?.includes("Status: finalized")) {
    return 1_440;
  }

  const marketIntervals = getActiveSilverApprovalMarkets(integration, now).map((market) => getSilverApprovalMarketPollIntervalMinutes(market, now));
  if (marketIntervals.length > 0) {
    return Math.min(...marketIntervals);
  }

  const easternDate = getEasternDate(now);
  if (easternDate < targetDate) {
    return 1_440;
  }

  return easternDate <= "2026-06-10" ? 1 : 60;
}

export function getSilverTrumpApprovalPollIntervalReason(integration: Integration, now: Date = new Date()): string {
  if (integration.lastValue?.includes("Target status: finalized") || integration.lastValue?.includes("Status: finalized")) {
    return "Silver Bulletin target date finalized; daily verification only";
  }

  const markets = getActiveSilverApprovalMarkets(integration, now);
  if (markets.length > 0) {
    const fastest = markets
      .map((market) => ({ market, interval: getSilverApprovalMarketPollIntervalMinutes(market, now) }))
      .sort((left, right) => left.interval - right.interval)[0];
    return `${formatSilverApprovalMarketKind(fastest.market)} market "${fastest.market.title}" controls polling: ${getSilverApprovalMarketPollIntervalReason(fastest.market, now)}`;
  }

  const easternDate = getEasternDate(now);
  if (easternDate < targetDate) {
    return "Silver Bulletin normal mode before June 5, 2026 ET; daily check only";
  }

  return easternDate <= "2026-06-10"
    ? "Silver Bulletin release watch until the June 5 value is finalized by the next data point"
    : "Silver Bulletin fallback hourly mode; target value still not finalized";
}

export function silverTrumpApprovalShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  if (currentValue.includes("Metric: Silver Bulletin Trump approval markets")) {
    const previousStates = new Set(extractSilverApprovalAlertStates(previousValue));
    return extractSilverApprovalAlertStates(currentValue).some((state) => !previousStates.has(state));
  }

  if (currentValue.includes("Metric: Silver Bulletin Trump approval Up/Down")) {
    const currentResult = extractUpDownResult(currentValue);
    if (!currentResult || currentResult === "Pending") {
      return false;
    }

    const previousResult = extractUpDownResult(previousValue);
    const currentReferenceDates = extractUpDownReferenceDatesLine(currentValue);
    const previousReferenceDates = extractUpDownReferenceDatesLine(previousValue);
    const currentFinalized = currentValue.includes("Status: finalized");
    const previousFinalized = previousValue?.includes("Status: finalized") ?? false;
    return currentResult !== previousResult || currentReferenceDates !== previousReferenceDates || (currentFinalized && !previousFinalized);
  }

  const currentFinalized = currentValue.includes("Target status: finalized") || currentValue.includes("Status: finalized");
  const previousFinalized = previousValue?.includes("Target status: finalized") || previousValue?.includes("Status: finalized");
  return currentFinalized && !previousFinalized;
}

function extractSilverApprovalAlertStates(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/\n\nTracked market \d+:\s*/)
    .flatMap((section) => {
      const title = section.match(/^(.+)$/m)?.[1]?.trim() ?? "unknown market";
      const referenceDates = section.match(/^Reference dates:\s*(.+)$/m)?.[1]?.trim();
      const result = section.match(/^Result:\s*(.+)$/m)?.[1]?.trim();
      if (referenceDates && result && result !== "Pending") {
        const finalized = section.includes("Status: finalized");
        return [`up-down|${title}|${referenceDates}|${result}|finalized=${finalized}`];
      }

      const target = section.match(/^Target date:\s*(.+)$/m)?.[1]?.trim();
      const approval = section.match(/^Approval:\s*(.+)$/m)?.[1]?.trim();
      if (target && approval && approval !== "not published yet" && section.includes("Target status: finalized")) {
        return [`single-date|${title}|${target}|${approval}`];
      }

      return [];
    });
}

export async function refreshSilverTrumpApprovalPolymarketQueue(
  integration: Integration,
  now = new Date(),
  options: { force?: boolean } = {}
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseSilverApprovalSettings(resolved.settingsJson);
  let changed = false;

  const currentUrl = resolved.activeUrl ?? integration.polymarketUrl;
  if (currentUrl) {
    const currentMetadata = await fetchMissingSilverApprovalMetadata(currentUrl, settings, now);
    if (currentMetadata) {
      settings = upsertSilverApprovalMetadata(settings, currentMetadata);
      changed = true;
    }
  }

  if (options.force || shouldDiscoverSilverApprovalMarkets(settings, now)) {
    settings = { ...settings, lastSilverApprovalMarketDiscoveryAt: now.toISOString() };
    changed = true;
    try {
      for (const metadata of await fetchSilverApprovalMarketSearchCandidates(now)) {
        settings = upsertSilverApprovalMetadata(settings, metadata);
      }
    } catch {
      return changed
        ? resolveIntegrationPolymarketQueue({ ...integration, settingsJson: JSON.stringify(settings), polymarketUrl: resolved.activeUrl }, now)
        : resolved;
    }
  }

  if (!changed) {
    return resolved;
  }

  return resolveIntegrationPolymarketQueue({ ...integration, settingsJson: JSON.stringify(settings), polymarketUrl: resolved.activeUrl }, now);
}

export async function upsertSilverTrumpApprovalPolymarketQueueUrl(
  integration: Integration,
  url: string,
  now = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let settings = parseSilverApprovalSettings(integration.settingsJson);
  const metadata = await fetchSilverApprovalMarketByUrl(url, now).catch(() => null);
  if (metadata) {
    settings = upsertSilverApprovalMetadata(settings, metadata);
  } else {
    settings = upsertSilverApprovalQueueUrl(settings, url, now);
  }

  return resolveIntegrationPolymarketQueue({ ...integration, settingsJson: JSON.stringify(settings) }, now);
}

async function fetchSilverApprovalCsv(): Promise<{ csv: string; datasetUrl: string }> {
  const staticResponse = await fetchWithTimeout(staticDatasetUrl, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  }, 10_000).catch(() => null);
  if (staticResponse?.ok) {
    return { csv: await staticResponse.text(), datasetUrl: staticDatasetUrl };
  }

  const datasetUrl = await fetchLatestSilverApprovalDatasetUrl();
  const response = await fetchWithTimeout(datasetUrl, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  }, 10_000);
  if (!response.ok) {
    throw new Error(`Silver Bulletin Datawrapper dataset returned HTTP ${response.status}`);
  }

  return { csv: await response.text(), datasetUrl };
}

async function fetchLatestSilverApprovalDatasetUrl(): Promise<string> {
  const response = await fetchWithTimeout(datawrapperChartUrl, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  }, 10_000);
  if (!response.ok) {
    throw new Error(`Silver Bulletin Datawrapper chart returned HTTP ${response.status}`);
  }

  const datasetUrl = resolveSilverDatawrapperDatasetUrl(await response.text());
  if (!datasetUrl) {
    throw new Error("Could not find the latest Silver Bulletin approval chart dataset URL");
  }

  return datasetUrl;
}

async function fetchMissingSilverApprovalMetadata(
  url: string,
  settings: SilverApprovalSettings,
  now: Date
): Promise<SilverApprovalMarketMetadata | null> {
  const slug = getPolymarketSlug(url);
  if (!slug || !isSilverApprovalTrackedSlug(slug) || settings.silverApprovalMarkets?.some((market) => market.slug === slug)) {
    return null;
  }

  return fetchSilverApprovalMarketByUrl(url, now).catch(() => null);
}

async function fetchSilverApprovalMarketByUrl(url: string, now: Date): Promise<SilverApprovalMarketMetadata | null> {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    return null;
  }

  const apiUrl = new URL(gammaEventsUrl);
  apiUrl.searchParams.set("slug", slug);
  const response = await fetchWithTimeout(apiUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  }, 10_000);
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const events = (await response.json()) as GammaSearchEvent[];
  return normalizeSilverApprovalSearchEvent(events[0] ?? {}, now);
}

async function fetchSilverApprovalMarketSearchCandidates(now: Date): Promise<SilverApprovalMarketMetadata[]> {
  const searches = await Promise.all([
    fetchSilverApprovalMarketSearch("trump approval up or down", now),
    fetchSilverApprovalMarketSearch("trump approval rating on", now)
  ]);
  const bySlug = new Map<string, SilverApprovalMarketMetadata>();
  for (const market of searches.flat()) {
    bySlug.set(market.slug, market);
  }

  return sortSilverApprovalMarkets([...bySlug.values()]);
}

async function fetchSilverApprovalMarketSearch(query: string, now: Date): Promise<SilverApprovalMarketMetadata[]> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  }, 10_000);
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? [])
    .map((event) => normalizeSilverApprovalSearchEvent(event, now))
    .filter((market): market is SilverApprovalMarketMetadata => market !== null);
}

export function normalizeSilverApprovalSearchEvent(event: GammaSearchEvent, now: Date = new Date()): SilverApprovalMarketMetadata | null {
  if (
    event.active === false ||
    event.closed === true ||
    event.archived === true ||
    !isNonEmptyString(event.slug) ||
    !isNonEmptyString(event.title) ||
    !isNonEmptyString(event.description)
  ) {
    return null;
  }

  const slug = event.slug.trim();
  const title = event.title.trim();
  if (!isSilverApprovalTrackedSlug(slug) || !title.toLowerCase().includes("trump approval")) {
    return null;
  }

  const startAt = parseGammaDate(event.startDate) ?? parseGammaDate(event.creationDate) ?? parseGammaDate(event.createdAt);
  if (isSilverApprovalUpDownSlug(slug)) {
    const referenceDates = extractSilverApprovalUpDownReferenceDates(event.description);
    if (!referenceDates) {
      return null;
    }

    const fallbackDeadlineAt = getSecondReferenceFallbackDeadline(referenceDates.secondDate).toISOString();
    if (Date.parse(fallbackDeadlineAt) < now.getTime()) {
      return null;
    }

    return {
      slug,
      url: `https://polymarket.com/event/${slug}`,
      kind: "up-down",
      title,
      firstDate: referenceDates.firstDate,
      secondDate: referenceDates.secondDate,
      startAt,
      endAt: fallbackDeadlineAt,
      addedAt: now.toISOString()
    };
  }

  const target = extractSilverApprovalSingleTargetDate(event.description) ?? extractSilverApprovalSingleTargetDate(title);
  if (!target) {
    return null;
  }

  const fallbackDeadlineAt = getSingleDateFallbackDeadline(target).toISOString();
  if (Date.parse(fallbackDeadlineAt) < now.getTime()) {
    return null;
  }

  return {
    slug,
    url: `https://polymarket.com/event/${slug}`,
    kind: "single-date",
    title,
    targetDate: target,
    startAt,
    endAt: fallbackDeadlineAt,
    addedAt: now.toISOString()
  };
}

export function extractSilverApprovalUpDownReferenceDates(description: string): { firstDate: string; secondDate: string } | null {
  const match = description.match(/resolve to\s+"Up"[\s\S]*?higher on ([A-Za-z]+ \d{1,2}, 20\d{2}), than on ([A-Za-z]+ \d{1,2}, 20\d{2})/i);
  if (!match) {
    return null;
  }

  const secondDate = parseWrittenDate(match[1]);
  const firstDate = parseWrittenDate(match[2]);
  return firstDate && secondDate ? { firstDate, secondDate } : null;
}

export function extractSilverApprovalSingleTargetDate(description: string): string | null {
  const match = description.match(/approval rating (?:for Donald Trump )?on ([A-Za-z]+ \d{1,2}, 20\d{2})/i);
  return match ? parseWrittenDate(match[1]) : null;
}

function upsertSilverApprovalMetadata(
  settings: SilverApprovalSettings,
  metadata: SilverApprovalMarketMetadata
): SilverApprovalSettings {
  const metadataBySlug = new Map(normalizeSilverApprovalMarketMetadata(settings.silverApprovalMarkets).map((market) => [market.slug, market]));
  const queueBySlug = new Map(normalizeSilverApprovalQueueMarkets(settings.polymarketMarkets).map((market) => [market.slug, market]));
  const existingMetadata = metadataBySlug.get(metadata.slug);
  metadataBySlug.set(metadata.slug, {
    ...metadata,
    addedAt: existingMetadata?.addedAt ?? metadata.addedAt
  });

  const existingQueueMarket = queueBySlug.get(metadata.slug);
  queueBySlug.set(metadata.slug, {
    url: metadata.url,
    slug: metadata.slug,
    startAt: metadata.startAt,
    endAt: metadata.endAt,
    addedAt: existingQueueMarket?.addedAt ?? metadata.addedAt
  });

  return {
    ...settings,
    silverApprovalMarkets: sortSilverApprovalMarkets([...metadataBySlug.values()]),
    polymarketMarkets: sortQueueMarkets([...queueBySlug.values()])
  };
}

function upsertSilverApprovalQueueUrl(settings: SilverApprovalSettings, url: string, now: Date): SilverApprovalSettings {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    return settings;
  }

  const queueBySlug = new Map(normalizeSilverApprovalQueueMarkets(settings.polymarketMarkets).map((market) => [market.slug, market]));
  const existing = queueBySlug.get(slug);
  queueBySlug.set(slug, {
    url,
    slug,
    startAt: existing?.startAt ?? null,
    endAt: existing?.endAt ?? null,
    addedAt: existing?.addedAt ?? now.toISOString()
  });
  return { ...settings, polymarketMarkets: sortQueueMarkets([...queueBySlug.values()]) };
}

function parseSilverApprovalSettings(settingsJson: string | null): SilverApprovalSettings {
  const settings = parseSettingsJson(settingsJson) as SilverApprovalSettings;
  return {
    ...settings,
    polymarketMarkets: normalizeSilverApprovalQueueMarkets(settings.polymarketMarkets),
    silverApprovalMarkets: normalizeSilverApprovalMarketMetadata(settings.silverApprovalMarkets),
    lastSilverApprovalMarketDiscoveryAt:
      typeof settings.lastSilverApprovalMarketDiscoveryAt === "string" ? settings.lastSilverApprovalMarketDiscoveryAt : undefined
  };
}

function shouldDiscoverSilverApprovalMarkets(settings: SilverApprovalSettings, now: Date): boolean {
  const activeMarket = getActiveQueueMarket(normalizeSilverApprovalQueueMarkets(settings.polymarketMarkets), now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  return isDiscoveryIntervalDue(settings.lastSilverApprovalMarketDiscoveryAt, now, intervalMs);
}

function getActiveSilverApprovalMarkets(integration?: Integration, now = new Date()): SilverApprovalMarketMetadata[] {
  if (!integration?.polymarketUrl) {
    return [];
  }

  const slug = getPolymarketSlug(integration.polymarketUrl);
  if (!slug) {
    return [];
  }

  const markets = parseSilverApprovalSettings(integration.settingsJson).silverApprovalMarkets ?? [];
  const activeMarkets = markets.filter((market) => isSilverApprovalMarketActive(market, now));
  if (activeMarkets.length > 0) {
    return activeMarkets;
  }

  const selectedMarket = markets.find((market) => market.slug === slug) ?? null;
  return selectedMarket ? [selectedMarket] : [];
}

function isSilverApprovalMarketActive(market: SilverApprovalMarketMetadata, now: Date): boolean {
  if (!market.startAt || !market.endAt) {
    return false;
  }

  const nowMs = now.getTime();
  return nowMs >= Date.parse(market.startAt) && nowMs <= Date.parse(market.endAt);
}

function getSilverApprovalMarketPollIntervalMinutes(market: SilverApprovalMarketMetadata, now: Date): number {
  const easternDate = getEasternDate(now);
  if (market.kind === "up-down" && market.secondDate) {
    if (easternDate < market.secondDate) {
      return 1_440;
    }

    return now.getTime() <= getSecondReferenceFallbackDeadline(market.secondDate).getTime() ? 1 : 60;
  }

  if (market.kind === "single-date" && market.targetDate) {
    if (easternDate < market.targetDate) {
      return 1_440;
    }

    return now.getTime() <= getSingleDateFallbackDeadline(market.targetDate).getTime() ? 1 : 60;
  }

  return 1_440;
}

function getSilverApprovalMarketPollIntervalReason(market: SilverApprovalMarketMetadata, now: Date): string {
  const easternDate = getEasternDate(now);
  if (market.kind === "up-down" && market.secondDate) {
    if (easternDate < market.secondDate) {
      return `before ${market.secondDate} ET; daily check only`;
    }

    return now.getTime() <= getSecondReferenceFallbackDeadline(market.secondDate).getTime()
      ? `finalization watch until ${market.secondDate} is finalized by a subsequent data point`
      : "fallback hourly mode; second reference date still not finalized";
  }

  if (market.kind === "single-date" && market.targetDate) {
    if (easternDate < market.targetDate) {
      return `before ${market.targetDate} ET; daily check only`;
    }

    return now.getTime() <= getSingleDateFallbackDeadline(market.targetDate).getTime()
      ? `release watch until the ${market.targetDate} value is finalized by the next data point`
      : "fallback hourly mode; target value still not finalized";
  }

  return "daily check only";
}

function formatSilverApprovalMarketKind(market: SilverApprovalMarketMetadata): string {
  return market.kind === "up-down" ? "Up/Down" : "single-date";
}

function normalizeSilverApprovalMarketMetadata(value: unknown): SilverApprovalMarketMetadata[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return sortSilverApprovalMarkets(
    value.flatMap((item): SilverApprovalMarketMetadata[] => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const market = item as Partial<SilverApprovalMarketMetadata>;
      if (!isNonEmptyString(market.slug) || !isNonEmptyString(market.url) || !isNonEmptyString(market.title)) {
        return [];
      }

      if (market.kind === "up-down" && isIsoDate(market.firstDate) && isIsoDate(market.secondDate)) {
        return [
          {
            slug: market.slug,
            url: market.url,
            kind: "up-down" as const,
            title: market.title,
            firstDate: market.firstDate,
            secondDate: market.secondDate,
            startAt: typeof market.startAt === "string" ? market.startAt : null,
            endAt: typeof market.endAt === "string" ? market.endAt : getSecondReferenceFallbackDeadline(market.secondDate).toISOString(),
            addedAt: typeof market.addedAt === "string" ? market.addedAt : new Date(0).toISOString()
          }
        ];
      }

      if (market.kind === "single-date" && isIsoDate(market.targetDate)) {
        return [
          {
            slug: market.slug,
            url: market.url,
            kind: "single-date" as const,
            title: market.title,
            targetDate: market.targetDate,
            startAt: typeof market.startAt === "string" ? market.startAt : null,
            endAt: typeof market.endAt === "string" ? market.endAt : getSingleDateFallbackDeadline(market.targetDate).toISOString(),
            addedAt: typeof market.addedAt === "string" ? market.addedAt : new Date(0).toISOString()
          }
        ];
      }

      return [];
    })
  );
}

function normalizeSilverApprovalQueueMarkets(value: unknown): PolymarketQueueMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return sortQueueMarkets(
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

function sortSilverApprovalMarkets(markets: SilverApprovalMarketMetadata[]): SilverApprovalMarketMetadata[] {
  return [...markets].sort((left, right) => getSilverApprovalSortDate(left).localeCompare(getSilverApprovalSortDate(right)) || left.slug.localeCompare(right.slug));
}

function getSilverApprovalSortDate(market: SilverApprovalMarketMetadata): string {
  return market.kind === "single-date" ? (market.targetDate ?? "") : (market.secondDate ?? "");
}

function sortQueueMarkets(markets: PolymarketQueueMarket[]): PolymarketQueueMarket[] {
  return [...markets].sort((left, right) => {
    const leftTime = left.startAt ? Date.parse(left.startAt) : Number.MAX_SAFE_INTEGER;
    const rightTime = right.startAt ? Date.parse(right.startAt) : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime || left.slug.localeCompare(right.slug);
  });
}

type ReferenceResolution = {
  row: SilverApprovalRow | null;
  requestedDate: string;
  usedDate: string | null;
  source: "exact" | "prior" | "missing";
  finalized: boolean;
};

function resolveFirstReference(rows: SilverApprovalRow[], requestedDate: string): ReferenceResolution {
  const exact = rows.find((row) => row.date === requestedDate) ?? null;
  if (exact) {
    return { row: exact, requestedDate, usedDate: exact.date, source: "exact", finalized: true };
  }

  const prior = findLatestOnOrBefore(rows, requestedDate);
  return prior
    ? { row: prior, requestedDate, usedDate: prior.date, source: "prior", finalized: true }
    : { row: null, requestedDate, usedDate: null, source: "missing", finalized: false };
}

function resolveSecondReference(rows: SilverApprovalRow[], requestedDate: string, now: Date): ReferenceResolution {
  const exact = rows.find((row) => row.date === requestedDate) ?? null;
  const nextAfterTarget = rows.find((row) => row.date > requestedDate) ?? null;
  if (exact) {
    return { row: exact, requestedDate, usedDate: exact.date, source: "exact", finalized: Boolean(nextAfterTarget) };
  }

  if (now.getTime() >= getSecondReferenceFallbackDeadline(requestedDate).getTime()) {
    const prior = findLatestOnOrBefore(rows, requestedDate);
    return prior
      ? { row: prior, requestedDate, usedDate: prior.date, source: "prior", finalized: true }
      : { row: null, requestedDate, usedDate: null, source: "missing", finalized: true };
  }

  return { row: null, requestedDate, usedDate: null, source: "missing", finalized: false };
}

function getUpDownStatus(
  firstReference: ReferenceResolution,
  secondReference: ReferenceResolution
): "pending" | "tentative" | "finalized" {
  if (!firstReference.row || !secondReference.row) {
    return "pending";
  }

  if (secondReference.finalized) {
    return "finalized";
  }

  return "tentative";
}

function compareApprovalRows(firstReference: SilverApprovalRow, secondReference: SilverApprovalRow): "Up" | "Down" | "50-50" {
  const firstApproval = roundOneDecimal(firstReference.approve);
  const secondApproval = roundOneDecimal(secondReference.approve);
  if (secondApproval > firstApproval) {
    return "Up";
  }
  if (firstApproval > secondApproval) {
    return "Down";
  }
  return "50-50";
}

function formatUpDownStatus(
  status: "pending" | "tentative" | "finalized",
  secondDate: string,
  deadlineAt: Date,
  secondReference: ReferenceResolution
): string {
  if (status === "finalized") {
    return secondReference.source === "prior" ? "finalized by fallback to most recent prior data point" : "finalized";
  }

  if (status === "tentative") {
    return `tentative; waiting for a data point after ${secondDate} to finalize`;
  }

  return `pending; waiting for ${secondDate} data or fallback deadline ${deadlineAt.toISOString()}`;
}

function formatReference(reference: ReferenceResolution, requestedDate: string): string {
  if (!reference.row) {
    return `${requestedDate} = not published yet`;
  }

  const value = `${reference.usedDate} = ${formatPercent(reference.row.approve)} approval`;
  if (reference.source === "prior") {
    return `${value} (fallback for missing ${requestedDate})`;
  }

  return `${value} (${reference.finalized ? "finalized" : "published; waiting for next data point"})`;
}

function formatComparison(firstReference: SilverApprovalRow | null, secondReference: SilverApprovalRow | null): string {
  if (!firstReference || !secondReference) {
    return "not available yet";
  }

  return `${formatPercent(firstReference.approve)} vs ${formatPercent(secondReference.approve)} after one-decimal rounding`;
}

function findLatestOnOrBefore(rows: SilverApprovalRow[], date: string): SilverApprovalRow | null {
  return [...rows].reverse().find((row) => row.date <= date) ?? null;
}

function getSecondReferenceFallbackDeadline(secondDate: string): Date {
  const deadlineDate = addIsoDays(secondDate, 3);
  return parseManualEasternDateTime(`${deadlineDate} 12:00`) ?? new Date(`${deadlineDate}T16:00:00.000Z`);
}

function getSingleDateFallbackDeadline(date: string): Date {
  const deadlineDate = addIsoDays(date, 5);
  return parseManualEasternDateTime(`${deadlineDate} 12:00`) ?? new Date(`${deadlineDate}T16:00:00.000Z`);
}

function addIsoDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function parseWrittenDate(value: string): string | null {
  const match = value.trim().match(/^([A-Za-z]+) (\d{1,2}), (20\d{2})$/);
  if (!match) {
    return null;
  }

  const month = monthNumber(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month || day < 1 || day > 31) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseGammaDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getActiveQueueMarket(markets: PolymarketQueueMarket[], now: Date): PolymarketQueueMarket | null {
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

function isDiscoveryIntervalDue(value: string | undefined, now: Date, intervalMs: number): boolean {
  if (!value) {
    return true;
  }

  const lastCheckedAt = Date.parse(value);
  return Number.isNaN(lastCheckedAt) || now.getTime() - lastCheckedAt >= intervalMs;
}

function isSilverApprovalTrackedUrl(url: string | null | undefined): boolean {
  const slug = url ? getPolymarketSlug(url) : null;
  return Boolean(slug && isSilverApprovalTrackedSlug(slug));
}

function isSilverApprovalTrackedSlug(slug: string): boolean {
  return isSilverApprovalUpDownSlug(slug) || isSilverApprovalSingleDateSlug(slug);
}

function isSilverApprovalUpDownSlug(slug: string): boolean {
  return slug.startsWith("trump-approval-up-or-down-this-week");
}

function isSilverApprovalSingleDateSlug(slug: string): boolean {
  return slug.startsWith("trump-approval-rating-on-");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
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

function roundOneDecimal(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function formatModelDate(value: string | undefined): string | null {
  const match = value?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year)) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells;
}

function formatRow(row: SilverApprovalRow | null): string {
  return row ? `${row.date} = ${formatPercent(row.approve)} approval, ${formatNullablePercent(row.disapprove)} disapproval` : "none";
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatNullablePercent(value: number | null): string {
  return value === null ? "not available" : formatPercent(value);
}

function extractRawApproval(value: string): string | null {
  return value.match(/^Result:\s*(.+)$/m)?.[1] ?? value.match(/^Approval:\s*(.+)$/m)?.[1] ?? null;
}

function extractUpDownResult(value: string | null): string | null {
  const result = value?.match(/^Result:\s*(.+)$/m)?.[1]?.trim() ?? null;
  return result && result !== "Pending" ? result.replace(/^(Tentative|Final)\s+/, "") : result;
}

function extractUpDownReferenceDatesLine(value: string | null): string | null {
  return value?.match(/^Reference dates:\s*(.+)$/m)?.[1]?.trim() ?? null;
}

function getEasternDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: easternTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/[,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

  return Number(normalized);
}
