import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import {
  parsePolymarketDateRangeWindow,
  resolveIntegrationPolymarketQueue,
  type PolymarketQueueMarket,
  upsertPolymarketQueueUrl
} from "../polymarketQueue.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const rollCallUrl = "https://rollcall.com/factbase/trump/calendar/";
const forthUrl = "https://www.forth.news/whpool";
const bnoWhPoolUrl = "https://bnonews.com/whpool";
const defaultPolymarketUrl =
  "https://polymarket.com/event/will-the-white-house-call-a-full-lid-by-630-pm-may-11-16";
const cutoffMinutesEt = 18 * 60 + 30;
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const fullLidMarketSearchQuery = "full lid";
const fullLidMarketSearchTag = "lid";
const marketDiscoveryActiveIntervalMs = 2 * 60 * 60_000;
const marketDiscoveryNoActiveIntervalMs = 30 * 60_000;
const marketDiscoveryLookaheadMs = 72 * 60 * 60_000;

export type FullLidResult = {
  dateEt: string;
  found: boolean;
  source: "Roll Call" | "Forth" | "BNO" | "none";
  timeEt: string;
  detail: string;
  sourceUrl?: string;
  beforeCutoff: boolean | null;
  rollCallStatus: string;
  forthStatus: string;
  bnoStatus: string;
};

export type RollCallRecentWatchRow = {
  dateEt: string;
  status: string;
};

type LidCandidate = {
  source: "Roll Call" | "Forth" | "BNO";
  dateEt: string;
  timeEt: string;
  detail: string;
  minutesEt: number | null;
  url?: string;
};

type FullLidDiscoverySettings = {
  polymarketMarkets?: PolymarketQueueMarket[];
  lastFullLidDiscoveryAt?: string;
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

export function extractRollCallFullLid(html: string, targetDateEt: string): LidCandidate | null {
  const $ = cheerio.load(html);
  let currentDateEt: string | null = null;
  const candidates: LidCandidate[] = [];

  $("tr").each((_, row) => {
    const text = normalizeText($(row).text());
    const date = parseRollCallDate(text);
    if (date) {
      currentDateEt = date;
      return;
    }

    if (currentDateEt !== targetDateEt || !/\bfull lid\b/i.test(text)) {
      return;
    }

    const timeEt = extractTimeEt(text);
    candidates.push({
      source: "Roll Call",
      dateEt: currentDateEt,
      timeEt: timeEt ?? "not listed",
      detail: extractLidDetail(text),
      minutesEt: timeEt ? parseTimeToMinutes(timeEt) : null
    });
  });

  return candidates.sort(compareLidCandidates)[0] ?? null;
}

export function extractForthFullLid(html: string, targetDateEt: string): LidCandidate | null {
  const $ = cheerio.load(html);
  const text = normalizeText($.text());
  if (!/\bfull lid\b/i.test(text) && !/\blid\b/i.test(text)) {
    return null;
  }

  const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const dateEt = dateMatch?.[1] ?? targetDateEt;
  if (dateEt !== targetDateEt) {
    return null;
  }

  const lidIndex = text.toLowerCase().indexOf("lid");
  const nearby = lidIndex === -1 ? text.slice(0, 300) : text.slice(Math.max(0, lidIndex - 160), lidIndex + 260);
  const timeEt = extractTimeEt(nearby) ?? extractTimeEt(text);

  return {
    source: "Forth",
    dateEt,
    timeEt: timeEt ?? "not listed",
    detail: nearby,
    minutesEt: timeEt ? parseTimeToMinutes(timeEt) : null
  };
}

export function extractBnoFullLid(html: string, targetDateEt: string, sourceUrl?: string): LidCandidate | null {
  return extractBnoArticleFullLid(html, targetDateEt, sourceUrl) ?? extractBnoListingFullLid(html, targetDateEt);
}

function extractBnoListingFullLid(html: string, targetDateEt: string): LidCandidate | null {
  const $ = cheerio.load(html);
  const candidates: LidCandidate[] = [];

  $("article.report-card").each((_, article) => {
    const card = $(article);
    const title = normalizeText(card.find("h2").text());
    const excerpt = normalizeText(card.find(".excerpt").text());
    const publishedAt = parseDate(card.find("time").attr("datetime"));
    const dateEt = publishedAt ? getEasternParts(publishedAt).date : parseBnoVisibleDate(card.find("time").text()) ?? targetDateEt;
    if (dateEt !== targetDateEt || !isBnoFinalLidText(`${title} ${excerpt}`)) {
      return;
    }

    const href = card.find("h2 a").attr("href");
    const url = href ? new URL(href, bnoWhPoolUrl).toString() : undefined;
    candidates.push({
      source: "BNO",
      dateEt,
      timeEt: "not listed",
      detail: normalizeText(`${title}: ${excerpt}${url ? ` (${url})` : ""}`).slice(0, 500),
      minutesEt: null,
      url
    });
  });

  return candidates.sort(compareLidCandidates)[0] ?? null;
}

function extractBnoArticleFullLid(html: string, targetDateEt: string, sourceUrl?: string): LidCandidate | null {
  const $ = cheerio.load(html);
  const article = $("article.full-report").first();
  if (!article.length) {
    return null;
  }

  const title = normalizeText(article.find("h1").first().text());
  const body = normalizeText(article.find(".report-body-html").text() || article.text());
  const publishedAt = parseDate(
    $('meta[property="article:published_time"]').attr("content") ?? article.find("time").attr("datetime")
  );
  const dateEt = parseBnoSentDate(body) ?? (publishedAt ? getEasternParts(publishedAt).date : targetDateEt);
  if (dateEt !== targetDateEt || !isBnoFinalLidText(`${title} ${body}`)) {
    return null;
  }

  const timeEt = extractBnoLidTimeEt(`${title}. ${body}`, publishedAt);
  return {
    source: "BNO",
    dateEt,
    timeEt: timeEt ?? "not listed",
    detail: extractBnoLidDetail(title, body, sourceUrl),
    minutesEt: timeEt ? parseTimeToMinutes(timeEt) : null,
    url: sourceUrl
  };
}

export function formatFullLidValue(result: FullLidResult, rollCallRecentWatch: RollCallRecentWatchRow[] = []): string {
  const cutoffStatus =
    result.beforeCutoff === null ? "unknown" : result.beforeCutoff ? "BEFORE 6:30 PM ET" : "AFTER 6:30 PM ET";
  const lines = [
    `Date ET: ${result.dateEt}`,
    "Cutoff: 6:30 PM ET",
    `Lid found: ${result.found ? "yes" : "no"}`,
    `Alert Date: ${result.found ? result.dateEt : "none"}`,
    `First lid source: ${result.source}`,
    `First lid time: ${result.timeEt}`,
    `First lid URL: ${result.found ? result.sourceUrl ?? "not available" : "none"}`,
    `Cutoff status: ${cutoffStatus}`,
    `Detail: ${result.detail}`,
    `Roll Call: ${result.rollCallStatus}`,
    `Forth: ${result.forthStatus}`,
    `BNO alpha: ${result.bnoStatus}`,
    `Resolution: ${rollCallUrl}`,
    `Fallback: ${forthUrl}`,
    `Alpha: ${bnoWhPoolUrl}`
  ];

  if (rollCallRecentWatch.length > 0) {
    lines.push("Roll Call recent watch:", ...rollCallRecentWatch.map((row) => `${row.dateEt}: ${row.status}`));
  }

  return lines.join("\n");
}

export function fullLidShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  if (hasRollCallRecentWatchChanged(previousValue, currentValue)) {
    return true;
  }

  if (!/^Lid found:\s*yes$/m.test(currentValue)) {
    return false;
  }

  const currentAlertDate = currentValue.match(/^Alert Date:\s*(.+)$/m)?.[1]?.trim();
  const previousAlertDate = previousValue?.match(/^Alert Date:\s*(.+)$/m)?.[1]?.trim();
  if (!currentAlertDate || currentAlertDate === "none") {
    return false;
  }

  if (!previousValue || currentAlertDate !== previousAlertDate) {
    return true;
  }

  return currentValue !== previousValue;
}

export function getWhiteHouseFullLidPollIntervalMinutes(_integration: unknown, now = new Date()): number {
  const parts = getEasternParts(now);
  const minutes = parts.hour * 60 + parts.minute;
  return minutes >= 8 * 60 && minutes <= 20 * 60 + 30 ? 1 : 60;
}

export function getWhiteHouseFullLidPollIntervalReason(_integration: unknown, now = new Date()): string {
  return getWhiteHouseFullLidPollIntervalMinutes(_integration, now) === 1
    ? "Daily full-lid watch: 8:00 AM-8:30 PM ET"
    : "Off-hours hourly full-lid check";
}

export const whiteHouseFullLidAdapter: WebsiteAdapter = {
  id: "white-house-full-lid",
  commandName: "fulllid",
  displayName: "White House Full Lid",
  sourceUrl: rollCallUrl,
  defaultPolymarketUrl,
  defaultChannelName: "fulllid",
  alertRoleName: "White House Lid Alerts",
  alertRoleEmoji: "\uD83E\uDDE2",
  getPollIntervalMinutes: getWhiteHouseFullLidPollIntervalMinutes,
  getPollIntervalReason: getWhiteHouseFullLidPollIntervalReason,
  shouldAlertOnChange: fullLidShouldAlertOnChange,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshWhiteHouseFullLidPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(): Promise<AdapterValue> {
    const dateEt = getEasternParts(new Date()).date;
    const [result, rollCallRecentWatch] = await Promise.all([
      fetchFullLidResult(dateEt),
      fetchRollCallRecentWatch(dateEt).catch(() => [])
    ]);
    const value = formatFullLidValue(result, rollCallRecentWatch);
    return {
      value,
      rawValue: value,
      unit: "daily full lid status",
      observedAt: new Date()
    };
  }
};

export async function refreshWhiteHouseFullLidPolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let settings = parseFullLidDiscoverySettings(resolved.settingsJson);
  if (!shouldDiscoverFullLidMarkets(settings, now)) {
    return resolved;
  }

  settings = { ...settings, lastFullLidDiscoveryAt: now.toISOString() };
  resolved = {
    settingsJson: JSON.stringify(settings),
    activeUrl: resolved.activeUrl
  };

  try {
    const candidates = await fetchFullLidMarketSearchCandidates(now);
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
      existingSlugs.add(candidate.slug);
    }

    return resolved;
  } catch {
    return resolved;
  }
}

async function fetchRollCallRecentWatch(anchorDateEt: string): Promise<RollCallRecentWatchRow[]> {
  const response = await fetchWithTimeout(rollCallUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`Roll Call calendar returned HTTP ${response.status}`);
  }

  const html = await response.text();
  return getRecentEasternDates(anchorDateEt, 4).map((dateEt) => {
    const candidate = extractRollCallFullLid(html, dateEt);
    return {
      dateEt,
      status: candidate ? `full lid found at ${candidate.timeEt}` : "no full lid found"
    };
  });
}

async function fetchFullLidResult(dateEt: string): Promise<FullLidResult> {
  const [rollCall, forth, bno] = await Promise.all([fetchRollCallLid(dateEt), fetchForthLid(dateEt), fetchBnoLid(dateEt)]);
  const firstLid = [rollCall.candidate, forth.candidate, bno.candidate]
    .filter((candidate): candidate is LidCandidate => Boolean(candidate))
    .sort(compareLidCandidates)[0];

  if (!firstLid) {
    if (!rollCall.ok && !forth.ok && !bno.ok) {
      throw new Error(`Could not check full lid sources. Roll Call: ${rollCall.status}; Forth: ${forth.status}; BNO: ${bno.status}`);
    }

    return {
      dateEt,
      found: false,
      source: "none",
      timeEt: "not found",
      detail: "No full lid found yet for today's ET date",
      sourceUrl: undefined,
      beforeCutoff: null,
      rollCallStatus: rollCall.status,
      forthStatus: forth.status,
      bnoStatus: bno.status
    };
  }

  return {
    dateEt,
    found: true,
    source: firstLid.source,
    timeEt: firstLid.timeEt,
    detail: firstLid.detail,
    sourceUrl: getFullLidSourceUrl(firstLid),
    beforeCutoff: firstLid.minutesEt === null ? null : firstLid.minutesEt <= cutoffMinutesEt,
    rollCallStatus: rollCall.status,
    forthStatus: forth.status,
    bnoStatus: bno.status
  };
}

function getFullLidSourceUrl(candidate: LidCandidate): string {
  if (candidate.url) {
    return candidate.url;
  }

  if (candidate.source === "Roll Call") {
    return rollCallUrl;
  }

  if (candidate.source === "Forth") {
    return forthUrl;
  }

  return bnoWhPoolUrl;
}

async function fetchRollCallLid(dateEt: string): Promise<{ ok: boolean; status: string; candidate: LidCandidate | null }> {
  const response = await fetchWithTimeout(rollCallUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  if (!response.ok) {
    return { ok: false, status: `unavailable HTTP ${response.status}`, candidate: null };
  }

  const candidate = extractRollCallFullLid(await response.text(), dateEt);
  return { ok: true, status: candidate ? `full lid found at ${candidate.timeEt}` : "no full lid found", candidate };
}

async function fetchForthLid(dateEt: string): Promise<{ ok: boolean; status: string; candidate: LidCandidate | null }> {
  const response = await fetchWithTimeout(forthUrl, {
    headers: {
      accept: "text/html",
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  if (!response.ok) {
    return { ok: false, status: `unavailable HTTP ${response.status}`, candidate: null };
  }

  const candidate = extractForthFullLid(await response.text(), dateEt);
  return { ok: true, status: candidate ? `full lid found at ${candidate.timeEt}` : "no full lid found", candidate };
}

async function fetchBnoLid(dateEt: string): Promise<{ ok: boolean; status: string; candidate: LidCandidate | null }> {
  const response = await fetchWithTimeout(bnoWhPoolUrl, {
    headers: {
      accept: "text/html",
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  if (!response.ok) {
    return { ok: false, status: `unavailable HTTP ${response.status}`, candidate: null };
  }

  const listingHtml = await response.text();
  const listingCandidate = extractBnoListingFullLid(listingHtml, dateEt);
  if (!listingCandidate?.url) {
    return { ok: true, status: listingCandidate ? `lid report found at ${listingCandidate.timeEt}` : "no lid report found", candidate: listingCandidate };
  }

  try {
    const articleResponse = await fetchWithTimeout(listingCandidate.url, {
      headers: {
        accept: "text/html",
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });
    if (!articleResponse.ok) {
      return { ok: true, status: `lid report found; detail page HTTP ${articleResponse.status}`, candidate: listingCandidate };
    }

    const articleCandidate = extractBnoArticleFullLid(await articleResponse.text(), dateEt, listingCandidate.url);
    const candidate = articleCandidate ?? listingCandidate;
    return { ok: true, status: `lid report found at ${candidate.timeEt}`, candidate };
  } catch (error) {
    return { ok: true, status: `lid report found; detail fetch failed: ${error instanceof Error ? error.message : String(error)}`, candidate: listingCandidate };
  }
}

async function fetchFullLidMarketSearchCandidates(now: Date): Promise<Array<{ slug: string; url: string }>> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", fullLidMarketSearchQuery);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "10");
  searchUrl.searchParams.append("events_tag", fullLidMarketSearchTag);

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  return (payload.events ?? []).map((event) => normalizeFullLidSearchEvent(event, now)).filter((candidate) => candidate !== null);
}

function normalizeFullLidSearchEvent(event: GammaSearchEvent, now: Date): { slug: string; url: string } | null {
  if (event.active === false || event.closed === true || !isNonEmptyString(event.slug) || !isNonEmptyString(event.title)) {
    return null;
  }

  if (!isFullLidMarketSlug(event.slug) || !isFullLidMarketTitle(event.title)) {
    return null;
  }

  const tagSlugs = new Set((event.tags ?? []).map((tag) => tag.slug).filter(isNonEmptyString));
  if (!tagSlugs.has(fullLidMarketSearchTag)) {
    return null;
  }

  const url = `https://polymarket.com/event/${event.slug}`;
  return parsePolymarketDateRangeWindow(url, now) ? { slug: event.slug, url } : null;
}

function isFullLidMarketSlug(slug: string): boolean {
  return /^will-the-white-house-call-a-full-lid-by-630-?pm(?:-|$)|^will-the-white-house-call-a-full-lid-by-630pm(?:-|$)/.test(
    slug
  );
}

function isFullLidMarketTitle(title: string): boolean {
  return /^will the white house call a full lid by 6:30\s?pm\b/i.test(title);
}

function shouldDiscoverFullLidMarkets(settings: FullLidDiscoverySettings, now: Date): boolean {
  const markets = normalizeFullLidQueueMarkets(settings.polymarketMarkets);
  if (hasQueuedFutureMarket(markets, now)) {
    return false;
  }

  const activeMarket = getActiveMarket(markets, now);
  const intervalMs = activeMarket ? marketDiscoveryActiveIntervalMs : marketDiscoveryNoActiveIntervalMs;
  if (!isDiscoveryIntervalDue(settings.lastFullLidDiscoveryAt, now, intervalMs)) {
    return false;
  }

  if (!activeMarket) {
    return true;
  }

  return Date.parse(activeMarket.endAt ?? "") - now.getTime() <= marketDiscoveryLookaheadMs;
}

function parseFullLidDiscoverySettings(settingsJson: string | null): FullLidDiscoverySettings {
  if (!settingsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(settingsJson) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const settings = parsed as FullLidDiscoverySettings;
    return {
      ...settings,
      polymarketMarkets: normalizeFullLidQueueMarkets(settings.polymarketMarkets),
      lastFullLidDiscoveryAt: typeof settings.lastFullLidDiscoveryAt === "string" ? settings.lastFullLidDiscoveryAt : undefined
    };
  } catch {
    return {};
  }
}

function normalizeFullLidQueueMarkets(value: unknown): PolymarketQueueMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((market) => {
    if (!market || typeof market !== "object") {
      return [];
    }

    const candidate = market as Partial<PolymarketQueueMarket>;
    if (!isNonEmptyString(candidate.url)) {
      return [];
    }

    const slug = isNonEmptyString(candidate.slug) ? candidate.slug : getPolymarketSlug(candidate.url);
    if (!slug) {
      return [];
    }

    return [
      {
        url: candidate.url,
        slug,
        startAt: typeof candidate.startAt === "string" ? candidate.startAt : null,
        endAt: typeof candidate.endAt === "string" ? candidate.endAt : null,
        addedAt: typeof candidate.addedAt === "string" ? candidate.addedAt : new Date(0).toISOString()
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

function getRecentEasternDates(anchorDateEt: string, count: number): string[] {
  const anchor = new Date(`${anchorDateEt}T12:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(anchor.getTime() - index * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  });
}

function hasRollCallRecentWatchChanged(previousValue: string | null, currentValue: string): boolean {
  const previousRows = parseRollCallRecentWatchRows(previousValue);
  const currentRows = parseRollCallRecentWatchRows(currentValue);
  if (previousRows.size === 0 || currentRows.size === 0) {
    return false;
  }

  for (const [dateEt, currentStatus] of currentRows) {
    const previousStatus = previousRows.get(dateEt);
    if (previousStatus !== undefined && previousStatus !== currentStatus) {
      return true;
    }
  }

  return false;
}

function parseRollCallRecentWatchRows(value: string | null): Map<string, string> {
  const rows = new Map<string, string>();
  if (!value) {
    return rows;
  }

  for (const match of value.matchAll(/^(\d{4}-\d{2}-\d{2}):\s*(.+)$/gm)) {
    rows.set(match[1], match[2].trim());
  }
  return rows;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseBnoVisibleDate(value: string): string | null {
  const match = normalizeText(value).match(/\b([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4}),\s+\d{1,2}:\d{2}\s+(?:AM|PM)\s+EDT\b/i);
  if (!match) {
    return null;
  }

  const month = monthNumber(match[1]);
  return month ? `${match[3]}-${month}-${match[2].padStart(2, "0")}` : null;
}

function parseBnoSentDate(text: string): string | null {
  const match = text.match(/\bSent:\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+\d{1,2}:\d{2}\s*(?:AM|PM)?/i);
  if (!match) {
    return null;
  }

  const month = monthNumber(match[1]);
  return month ? `${match[3]}-${month}-${match[2].padStart(2, "0")}` : null;
}

function isBnoFinalLidText(text: string): boolean {
  const normalized = normalizeText(text);
  if (!/\blid\b/i.test(normalized)) {
    return false;
  }

  return !/\blunch\s+lid\b|\blid\s+until\b/i.test(normalized);
}

function extractBnoLidTimeEt(text: string, publishedAt: Date | null): string | null {
  const explicitLidDeclaration = text.match(/\blid\s+(?:was\s+)?declared\s+(?:at\s+)?(\d{1,2}[:;]\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?|\d{3,4})\b/i);
  if (explicitLidDeclaration) {
    return parseBnoTimeToken(explicitLidDeclaration[1], publishedAt);
  }

  const lidIndex = text.toLowerCase().lastIndexOf("lid");
  const nearby = lidIndex === -1 ? text.slice(0, 400) : text.slice(Math.max(0, lidIndex - 40), lidIndex + 220);

  const compact = nearby.match(/\b(?:at|as of|declared)\s+(\d{3,4})\s*(?:ET|EDT)?\b/i);
  if (compact) {
    const raw = compact[1].padStart(4, "0");
    const hour24 = Number(raw.slice(0, -2));
    const minute = Number(raw.slice(-2));
    return formatHourMinute(hour24, minute);
  }

  const numeric = nearby.match(/\b(?:at|as of|declared)\s+(\d{1,2})[:;](\d{2})\s*(a\.?m\.?|p\.?m\.?)?\b/i);
  if (numeric) {
    const hour = Number(numeric[1]);
    const minute = Number(numeric[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 1 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }

    const meridiem = numeric[3]?.toUpperCase().replaceAll(".", "");
    if (meridiem === "AM" || meridiem === "PM") {
      const hour24 = meridiem === "PM" && hour !== 12 ? hour + 12 : meridiem === "AM" && hour === 12 ? 0 : hour;
      return formatHourMinute(hour24, minute);
    }

    const publishedParts = publishedAt ? getEasternParts(publishedAt) : null;
    const inferredHour24 =
      hour > 12 ? hour : publishedParts && publishedParts.hour < 12 ? (hour === 12 ? 0 : hour) : hour === 12 ? 12 : hour + 12;
    return formatHourMinute(inferredHour24, minute);
  }

  return extractTimeEt(nearby);
}

function parseBnoTimeToken(value: string, publishedAt: Date | null): string | null {
  const token = value.trim();
  const compact = token.match(/^(\d{3,4})$/);
  if (compact) {
    const raw = compact[1].padStart(4, "0");
    return formatHourMinute(Number(raw.slice(0, -2)), Number(raw.slice(-2)));
  }

  const numeric = token.match(/^(\d{1,2})[:;](\d{2})\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (!numeric) {
    return null;
  }

  const hour = Number(numeric[1]);
  const minute = Number(numeric[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 1 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  const meridiem = numeric[3]?.toUpperCase().replaceAll(".", "");
  if (meridiem === "AM" || meridiem === "PM") {
    const hour24 = meridiem === "PM" && hour !== 12 ? hour + 12 : meridiem === "AM" && hour === 12 ? 0 : hour;
    return formatHourMinute(hour24, minute);
  }

  const publishedParts = publishedAt ? getEasternParts(publishedAt) : null;
  const inferredHour24 =
    hour > 12 ? hour : publishedParts && publishedParts.hour < 12 ? (hour === 12 ? 0 : hour) : hour === 12 ? 12 : hour + 12;
  return formatHourMinute(inferredHour24, minute);
}

function extractBnoLidDetail(title: string, body: string, sourceUrl?: string): string {
  const lidIndex = body.toLowerCase().indexOf("lid");
  const nearby = lidIndex === -1 ? body.slice(0, 350) : body.slice(Math.max(0, lidIndex - 140), lidIndex + 260);
  return normalizeText(`${title}: ${nearby}${sourceUrl ? ` (${sourceUrl})` : ""}`).slice(0, 500);
}

function formatHourMinute(hour24: number, minute: number): string | null {
  if (!Number.isInteger(hour24) || !Number.isInteger(minute) || hour24 < 0 || hour24 > 23 || minute < 0 || minute > 59) {
    return null;
  }

  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function compareLidCandidates(left: LidCandidate, right: LidCandidate): number {
  return (left.minutesEt ?? Number.MAX_SAFE_INTEGER) - (right.minutesEt ?? Number.MAX_SAFE_INTEGER);
}

function parseRollCallDate(text: string): string | null {
  const match = text.match(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\b/);
  if (!match) {
    return null;
  }

  const month = monthNumber(match[1]);
  if (!month) {
    return null;
  }

  return `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

function monthNumber(month: string): string | null {
  const index = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december"
  ].indexOf(month.toLowerCase());
  return index === -1 ? null : String(index + 1).padStart(2, "0");
}

function extractTimeEt(text: string): string | null {
  return text.match(/\b(\d{1,2}:\d{2}\s*(?:AM|PM))/i)?.[1].replace(/\s+/g, " ").toUpperCase() ?? null;
}

function parseTimeToMinutes(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (match[3].toUpperCase() === "PM" && hour !== 12) {
    hour += 12;
  }
  if (match[3].toUpperCase() === "AM" && hour === 12) {
    hour = 0;
  }

  return hour * 60 + minute;
}

function extractLidDetail(text: string): string {
  const match = text.match(/(?:White House Press Office:\s*)?[^.]*\bfull lid\b[^.]*\.?/i);
  return normalizeText(match?.[0] ?? text).slice(0, 500);
}

function getEasternParts(date: Date): { date: string; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
