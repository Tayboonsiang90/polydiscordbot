import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import { resolveIntegrationPolymarketQueue, type PolymarketQueueMarket } from "../polymarketQueue.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.gettyimages.com.mx/search/2/image?family=editorial&sort=newest&specificpeople=118600";
const defaultPolymarketUrl = "https://polymarket.com/event/will-trump-be-photographed-every-day-this-week-61-67";
const gettyPublicSearchUrl = "https://www.gettyimages.com/search/2/image";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const jinaReaderBaseUrl = "https://r.jina.ai/http://r.jina.ai/http://";
const marketSearchQuery = "trump photographed every day this week";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 72 * 60 * 60_000;
const maxGettyPages = 1;
const maxPhotosPerDay = 3;
const maxGettyDetailFetches = 5;

export type TrumpGettyMarketWindow = {
  startDate: string;
  endDate: string;
  uploadDeadlineDate: string;
  startAt: string;
  endAt: string;
  label: string;
  qualifyingDates: string[];
};

export type GettyPhoto = {
  id: string;
  title: string;
  dateCreated: string;
  url: string;
  thumbnailUrl: string | null;
};

type GettyPhotoCandidate = Omit<GettyPhoto, "dateCreated"> & {
  dateCreated: string | null;
};

type TrumpGettyDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastTrumpGettyMarketDiscoveryAt?: string;
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

export const trumpGettyPhotosAdapter: WebsiteAdapter = {
  id: "trump-getty-photos",
  commandName: "trumpgetty",
  displayName: "Trump Getty Photos",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "trumpgetty",
  alertRoleName: "Trump Getty Alerts",
  alertRoleEmoji: "\uD83D\uDCF8",
  getPollIntervalMinutes(): number {
    return 60;
  },
  getPollIntervalReason(): string {
    return "Hourly Getty tagged-photo coverage check and recurring market discovery.";
  },
  getErrorNoticeWindowMinutes(): number {
    return 30;
  },
  shouldAlertOnChange: trumpGettyShouldAlertOnChange,
  upsertPolymarketMarket(integration: Integration, url: string): { settingsJson: string | null; activeUrl: string | null } {
    return upsertTrumpGettyPolymarketMarket(integration, url);
  },
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshTrumpGettyPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const polymarketUrl = integration?.polymarketUrl ?? defaultPolymarketUrl;
    const window = parseTrumpGettyMarketWindow(polymarketUrl);
    if (!window) {
      throw new Error(`Could not parse Trump Getty market window from Polymarket URL: ${polymarketUrl}`);
    }

    const photos = await fetchTrumpGettyPhotos(window);
    const value = buildTrumpGettyValue(photos, window, polymarketUrl);
    return {
      value,
      rawValue: extractRawCoverage(value) ?? value,
      unit: "qualifying Getty photo days",
      observedAt: new Date()
    };
  }
};

export function parseTrumpGettyMarketWindow(url: string, now = new Date()): TrumpGettyMarketWindow | null {
  const slug = getPolymarketSlug(url) ?? url;
  const match = slug.match(/will-trump-be-photographed-every-day-this-week-(\d{2,4})-(\d{2,4})(?:-\d+)?$/);
  if (!match) {
    return null;
  }

  const start = parseCompactMonthDay(match[1]);
  const end = parseCompactMonthDay(match[2]);
  if (!start || !end) {
    return null;
  }

  const currentYear = getEasternYear(now);
  const endYear = currentYear;
  const startYear = end.month < start.month ? currentYear - 1 : currentYear;
  const startAt = parseManualEasternDateTime(`${startYear}-${padNumber(start.month)}-${padNumber(start.day)} 00:00`);
  const endAt = parseManualEasternDateTime(`${endYear}-${padNumber(end.month)}-${padNumber(end.day)} 23:59`);
  const uploadDeadlineDate = formatDate(addUtcDays(endYear, end.month, end.day, 1));
  const uploadDeadlineAt = parseManualEasternDateTime(`${uploadDeadlineDate} 23:59`);
  if (!startAt || !endAt || !uploadDeadlineAt || startAt.getTime() > endAt.getTime()) {
    return null;
  }

  const qualifyingDates = buildDateRange(formatDateParts(startYear, start.month, start.day), formatDateParts(endYear, end.month, end.day));
  if (qualifyingDates.length === 0) {
    return null;
  }

  return {
    startDate: qualifyingDates[0],
    endDate: qualifyingDates.at(-1) ?? qualifyingDates[0],
    uploadDeadlineDate,
    startAt: startAt.toISOString(),
    endAt: uploadDeadlineAt.toISOString(),
    label: `${formatMonthDay(start.month, start.day)}-${formatMonthDay(end.month, end.day)} ${endYear}`,
    qualifyingDates
  };
}

export function buildTrumpGettyValue(photos: GettyPhoto[], window: TrumpGettyMarketWindow, polymarketUrl: string): string {
  const photosByDate = groupPhotosByDate(photos, window);
  const coveredDates = window.qualifyingDates.filter((date) => (photosByDate.get(date)?.length ?? 0) > 0);
  const missingDates = window.qualifyingDates.filter((date) => !coveredDates.includes(date));
  const completed = missingDates.length === 0;

  return [
    "Metric: Getty Images tagged editorial Donald Trump photos",
    `Window: ${window.startDate} to ${window.endDate}`,
    `Upload deadline: ${window.uploadDeadlineDate} 23:59 ET`,
    `Covered days: ${coveredDates.length}/${window.qualifyingDates.length}`,
    `Covered dates: ${coveredDates.length ? coveredDates.join(", ") : "none"}`,
    `Missing dates: ${missingDates.length ? missingDates.join(", ") : "none"}`,
    `Every day covered: ${completed ? "yes" : "no"}`,
    `Photos by day: ${formatPhotosByDay(photosByDate, window.qualifyingDates)}`,
    `Latest photos: ${formatLatestPhotos(photos)}`,
    `Resolution: ${sourceUrl}`,
    `Polymarket: ${polymarketUrl}`
  ].join("\n");
}

export function trumpGettyShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  const previousDates = parseCoveredDates(previousValue);
  const currentDates = parseCoveredDates(currentValue);
  if (currentDates.length <= previousDates.length) {
    return false;
  }

  return currentDates.some((date) => !previousDates.includes(date));
}

export function upsertTrumpGettyPolymarketMarket(
  integration: Integration,
  url: string,
  now = new Date()
): { settingsJson: string | null; activeUrl: string | null } {
  const settings = parseTrumpGettyDiscoverySettings(integration.settingsJson);
  const markets = upsertMarket(settings.polymarketMarkets ?? [], buildTrumpGettyQueueMarket(url, now));
  return resolveTrumpGettyQueue({ ...settings, polymarketMarkets: markets }, integration.polymarketUrl, now);
}

export async function refreshTrumpGettyPolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let settings = parseTrumpGettyDiscoverySettings(integration.settingsJson);
  const baseUrl = integration.polymarketUrl ?? defaultPolymarketUrl;
  settings = {
    ...settings,
    polymarketMarkets: upsertMarket(settings.polymarketMarkets ?? [], buildTrumpGettyQueueMarket(baseUrl, now))
  };
  let resolved = resolveTrumpGettyQueue(settings, integration.polymarketUrl, now);
  settings = parseTrumpGettyDiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverTrumpGettyMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastTrumpGettyMarketDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const existingSlugs = new Set((settings.polymarketMarkets ?? []).map((market) => market.slug));
    for (const candidate of await fetchTrumpGettyMarketSearchCandidates(now)) {
      if (existingSlugs.has(candidate.slug)) {
        continue;
      }

      const nextSettings = parseTrumpGettyDiscoverySettings(resolved.settingsJson);
      resolved = resolveTrumpGettyQueue(
        {
          ...nextSettings,
          polymarketMarkets: upsertMarket(nextSettings.polymarketMarkets ?? [], buildTrumpGettyQueueMarket(candidate.url, now))
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

async function fetchTrumpGettyPhotos(window: TrumpGettyMarketWindow): Promise<GettyPhoto[]> {
  const photos: GettyPhoto[] = [];
  const seen = new Set<string>();
  let detailFetches = 0;
  let foundAnyCandidates = false;

  for (let page = 1; page <= maxGettyPages; page += 1) {
    const searchMarkdown = await fetchGettyPublicSearchMarkdown(page);
    const candidates = extractGettyPublicSearchPhotos(searchMarkdown);
    if (candidates.length === 0) {
      break;
    }

    foundAnyCandidates = true;
    for (const candidate of candidates) {
      if (seen.has(candidate.id)) {
        continue;
      }

      seen.add(candidate.id);
      let dateCreated = candidate.dateCreated;
      if (!dateCreated) {
        dateCreated = extractGettyDateCreatedFromTextForWindow(candidate.title, window);
        if (!dateCreated && extractEnglishMonthDay(candidate.title)) {
          continue;
        }
      }

      if (!dateCreated && detailFetches < maxGettyDetailFetches) {
        detailFetches += 1;
        dateCreated = await fetchGettyDetailDateCreated(candidate.url);
      }

      if (!dateCreated || !window.qualifyingDates.includes(dateCreated)) {
        continue;
      }

      photos.push({ ...candidate, dateCreated });
    }
  }

  if (!foundAnyCandidates) {
    throw new Error("Getty public scraper could not find photo results on the Getty search page.");
  }

  return uniquePhotos(photos);
}

async function fetchGettyPublicSearchMarkdown(page: number): Promise<string> {
  const url = new URL(gettyPublicSearchUrl);
  url.searchParams.set("family", "editorial");
  url.searchParams.set("sort", "newest");
  url.searchParams.set("specificpeople", "118600");
  if (page > 1) {
    url.searchParams.set("page", String(page));
  }

  return fetchJinaReaderText(buildJinaReaderUrl(url.toString()), "Getty public scraper");
}

async function fetchGettyDetailDateCreated(url: string): Promise<string | null> {
  try {
    const text = await fetchJinaReaderText(buildJinaReaderUrl(url), "Getty detail scraper");
    return extractGettyDetailDateCreated(text);
  } catch {
    return null;
  }
}

async function fetchJinaReaderText(url: string, errorLabel: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchWithTimeout(url, {
      headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
    });
    const text = await response.text();
    if (response.status === 429 && attempt === 0) {
      await delay(Math.min(parseJinaRetryAfterMs(text), 30_000));
      continue;
    }

    if (!response.ok) {
      throw new Error(`${errorLabel} returned HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    return text;
  }

  throw new Error(`${errorLabel} did not return a response after retrying.`);
}

export function extractGettyPublicSearchPhotos(markdown: string): GettyPhotoCandidate[] {
  const photos: GettyPhotoCandidate[] = [];
  const resultPattern =
    /\[!\[Image\s+\d+:\s*([^\]]+)\]\((https:\/\/media\.gettyimages\.com\/id\/(\d+)\/[^)]+)\)\s*([^\]]*?)\]\((https:\/\/www\.gettyimages\.com\/detail\/[^)\s]+)\)/g;
  for (const match of markdown.matchAll(resultPattern)) {
    const imageId = match[3];
    const detailUrl = match[5];
    const id = extractGettyIdFromUrl(detailUrl) ?? imageId;
    const title = normalizeText(`${match[1]} ${match[4]}`).slice(0, 180);
    photos.push({
      id,
      title: title || `Getty image ${id}`,
      dateCreated: extractGettyDateCreatedFromText(title),
      url: detailUrl,
      thumbnailUrl: match[2]
    });
  }

  return uniqueCandidates(photos);
}

export function extractGettyDetailDateCreated(markdown: string): string | null {
  const dateCreatedSection = markdown.match(/Date created:\s*([\s\S]{0,80})/i)?.[1];
  if (dateCreatedSection) {
    const dateFromSection = extractGettyDateCreatedFromText(dateCreatedSection);
    if (dateFromSection) {
      return dateFromSection;
    }
  }

  return extractGettyDateCreatedFromText(markdown);
}

export function extractGettyDateCreatedFromText(text: string): string | null {
  const normalized = normalizeText(text);
  const patterns = [
    /\bDate created:?\s*([A-Z][a-z]+\.?\s+\d{1,2},\s+20\d{2})/i,
    /\bon\s+([A-Z][a-z]+\.?\s+\d{1,2},\s+20\d{2})\b/i,
    /\b([A-Z][a-z]+\.?\s+\d{1,2},\s+20\d{2})\b/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const date = match ? parseEnglishMonthDate(match[1]) : null;
    if (date) {
      return date;
    }
  }

  return null;
}

function extractGettyDateCreatedFromTextForWindow(text: string, window: TrumpGettyMarketWindow): string | null {
  const explicitDate = extractGettyDateCreatedFromText(text);
  if (explicitDate) {
    return explicitDate;
  }

  const monthDay = extractEnglishMonthDay(text);
  if (!monthDay) {
    return null;
  }

  const suffix = `-${padNumber(monthDay.month)}-${padNumber(monthDay.day)}`;
  return window.qualifyingDates.find((date) => date.endsWith(suffix)) ?? null;
}

async function fetchTrumpGettyMarketSearchCandidates(now: Date): Promise<Array<{ slug: string; url: string }>> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", marketSearchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? []).map((event) => normalizeTrumpGettySearchEvent(event, now)).filter((event) => event !== null);
}

function normalizeTrumpGettySearchEvent(event: GammaSearchEvent, now: Date): { slug: string; url: string } | null {
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
  const title = event.title.toLowerCase();
  const url = `https://polymarket.com/event/${slug}`;
  if (!slug.startsWith("will-trump-be-photographed-every-day-this-week-") || !title.includes("trump be photographed")) {
    return null;
  }

  return parseTrumpGettyMarketWindow(url, now) ? { slug, url } : null;
}

function resolveTrumpGettyQueue(
  settings: TrumpGettyDiscoverySettings,
  currentUrl: string | null,
  now: Date
): { settingsJson: string | null; activeUrl: string | null } {
  return resolveIntegrationPolymarketQueue(
    {
      id: 0,
      guildId: "",
      channelId: "",
      adapterId: trumpGettyPhotosAdapter.id,
      displayName: trumpGettyPhotosAdapter.displayName,
      sourceUrl,
      polymarketUrl: currentUrl,
      alertRoleId: null,
      roleMessageId: null,
      roleChannelId: null,
      roleEmoji: null,
      settingsJson: JSON.stringify({ ...settings, polymarketMarkets: sortMarkets(settings.polymarketMarkets ?? []) }),
      pollIntervalMinutes: 60,
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

function buildTrumpGettyQueueMarket(url: string, now: Date): PolymarketQueueMarket {
  const slug = getPolymarketSlug(url);
  const window = parseTrumpGettyMarketWindow(url, now);
  if (!slug || !window) {
    throw new Error(`Could not parse Trump Getty market from Polymarket URL: ${url}`);
  }

  return {
    url,
    slug,
    startAt: window.startAt,
    endAt: window.endAt,
    addedAt: now.toISOString()
  };
}

function shouldDiscoverTrumpGettyMarkets(settings: TrumpGettyDiscoverySettings, now: Date): boolean {
  const markets = normalizeTrumpGettyQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastTrumpGettyMarketDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

function parseTrumpGettyDiscoverySettings(settingsJson: string | null): TrumpGettyDiscoverySettings {
  const settings = parseSettingsJson(settingsJson) as TrumpGettyDiscoverySettings;
  return {
    ...settings,
    polymarketMarkets: normalizeTrumpGettyQueueMarkets(settings.polymarketMarkets),
    lastTrumpGettyMarketDiscoveryAt:
      typeof settings.lastTrumpGettyMarketDiscoveryAt === "string" ? settings.lastTrumpGettyMarketDiscoveryAt : undefined
  };
}

function normalizeTrumpGettyQueueMarkets(value: unknown): PolymarketQueueMarket[] {
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

function upsertMarket(markets: PolymarketQueueMarket[], market: PolymarketQueueMarket): PolymarketQueueMarket[] {
  const existingIndex = markets.findIndex((candidate) => candidate.slug === market.slug);
  const nextMarkets = [...markets];
  if (existingIndex === -1) {
    nextMarkets.push(market);
  } else {
    nextMarkets[existingIndex] = { ...nextMarkets[existingIndex], ...market, addedAt: nextMarkets[existingIndex].addedAt };
  }

  return sortMarkets(nextMarkets);
}

function groupPhotosByDate(photos: GettyPhoto[], window: TrumpGettyMarketWindow): Map<string, GettyPhoto[]> {
  const groups = new Map<string, GettyPhoto[]>();
  for (const date of window.qualifyingDates) {
    groups.set(date, []);
  }

  for (const photo of sortPhotos(photos)) {
    const datePhotos = groups.get(photo.dateCreated);
    if (datePhotos) {
      datePhotos.push(photo);
    }
  }

  return groups;
}

function formatPhotosByDay(photosByDate: Map<string, GettyPhoto[]>, qualifyingDates: string[]): string {
  return qualifyingDates
    .map((date) => {
      const photos = photosByDate.get(date) ?? [];
      const examples = photos.slice(0, maxPhotosPerDay).map((photo) => `${photo.id} ${photo.title} ${photo.url}`).join(" || ");
      return `${date}: ${photos.length}${examples ? ` (${examples})` : ""}`;
    })
    .join(" | ");
}

function formatLatestPhotos(photos: GettyPhoto[]): string {
  const latest = [...sortPhotos(photos)].reverse().slice(0, 5);
  return latest.length ? latest.map((photo) => `${photo.dateCreated} ${photo.id} ${photo.title} ${photo.url}`).join(" | ") : "none";
}

function parseCoveredDates(value: string | null): string[] {
  if (!value) {
    return [];
  }

  const line = value.match(/^Covered dates:\s*(.+)$/m)?.[1]?.trim();
  return !line || line === "none" ? [] : line.split(",").map((date) => date.trim()).filter(Boolean);
}

function extractRawCoverage(value: string): string | null {
  return value.match(/^Covered days:\s*(.+)$/m)?.[1] ?? null;
}

function sortPhotos(photos: GettyPhoto[]): GettyPhoto[] {
  return [...photos].sort((left, right) => left.dateCreated.localeCompare(right.dateCreated) || left.id.localeCompare(right.id));
}

function uniquePhotos(photos: GettyPhoto[]): GettyPhoto[] {
  const seen = new Set<string>();
  return sortPhotos(photos).filter((photo) => {
    if (seen.has(photo.id)) {
      return false;
    }

    seen.add(photo.id);
    return true;
  });
}

function uniqueCandidates(photos: GettyPhotoCandidate[]): GettyPhotoCandidate[] {
  const seen = new Set<string>();
  return photos.filter((photo) => {
    if (seen.has(photo.id)) {
      return false;
    }

    seen.add(photo.id);
    return true;
  });
}

function buildJinaReaderUrl(url: string): string {
  return `${jinaReaderBaseUrl}${url}`;
}

function extractGettyIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const id = parsed.pathname.split("/").filter(Boolean).at(-1);
    return id && /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function parseJinaRetryAfterMs(text: string): number {
  try {
    const payload = JSON.parse(text) as { retryAfter?: unknown; retryAfterDate?: unknown };
    if (typeof payload.retryAfter === "number" && Number.isFinite(payload.retryAfter)) {
      return Math.max(1_000, Math.ceil(payload.retryAfter * 1000) + 1_000);
    }

    if (typeof payload.retryAfterDate === "string") {
      const retryAt = Date.parse(payload.retryAfterDate);
      if (!Number.isNaN(retryAt)) {
        return Math.max(1_000, retryAt - Date.now() + 1_000);
      }
    }
  } catch {
    return 10_000;
  }

  return 10_000;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseEnglishMonthDate(value: string): string | null {
  const match = value.trim().match(/^([A-Z][a-z]+)\.?\s+(\d{1,2}),\s+(20\d{2})$/i);
  if (!match) {
    return null;
  }

  const month = englishMonthNumber(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month || day < 1 || day > 31) {
    return null;
  }

  return formatDateParts(year, month, day);
}

function extractEnglishMonthDay(value: string): { month: number; day: number } | null {
  const match = normalizeText(value).match(/\b(?:on\s+)?([A-Z][a-z]+)\.?\s+(\d{1,2})(?:,|\b)/i);
  if (!match) {
    return null;
  }

  const month = englishMonthNumber(match[1]);
  const day = Number(match[2]);
  return month && day >= 1 && day <= 31 ? { month, day } : null;
}

function englishMonthNumber(value: string): number | null {
  const months = new Map([
    ["jan", 1],
    ["january", 1],
    ["feb", 2],
    ["february", 2],
    ["mar", 3],
    ["march", 3],
    ["apr", 4],
    ["april", 4],
    ["may", 5],
    ["jun", 6],
    ["june", 6],
    ["jul", 7],
    ["july", 7],
    ["aug", 8],
    ["august", 8],
    ["sep", 9],
    ["sept", 9],
    ["september", 9],
    ["oct", 10],
    ["october", 10],
    ["nov", 11],
    ["november", 11],
    ["dec", 12],
    ["december", 12]
  ]);
  return months.get(value.toLowerCase().replace(/\.$/, "")) ?? null;
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

function sortMarkets(markets: PolymarketQueueMarket[]): PolymarketQueueMarket[] {
  return [...markets].sort((left, right) => {
    const leftTime = left.startAt ? Date.parse(left.startAt) : Number.MAX_SAFE_INTEGER;
    const rightTime = right.startAt ? Date.parse(right.startAt) : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime || left.slug.localeCompare(right.slug);
  });
}

function parseCompactMonthDay(value: string): { month: number; day: number } | null {
  const candidates = [1, 2]
    .filter((splitIndex) => splitIndex < value.length)
    .map((splitIndex) => ({
      month: Number(value.slice(0, splitIndex)),
      day: Number(value.slice(splitIndex))
    }))
    .filter((candidate) => candidate.month >= 1 && candidate.month <= 12 && candidate.day >= 1 && candidate.day <= 31);
  return candidates[0] ?? null;
}

function buildDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = new Date(cursor.getTime() + 24 * 60 * 60_000)) {
    dates.push(formatDate(cursor));
  }

  return dates;
}

function addUtcDays(year: number, month: number, day: number, days: number): Date {
  return new Date(Date.UTC(year, month - 1, day + days));
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${year}-${padNumber(month)}-${padNumber(day)}`;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getEasternYear(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(date));
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

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
