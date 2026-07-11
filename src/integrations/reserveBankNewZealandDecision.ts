import { fetchWithTimeout } from "../http.js";
import { upsertPolymarketQueueUrl } from "../polymarketQueue.js";
import {
  refreshMonthlyPolymarketQueue,
  type MonthlyPolymarketDiscoveryConfig
} from "./monthlyPolymarketDiscovery.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.rbnz.govt.nz/news-and-events/events";
const officialCashRateUrl = "https://www.rbnz.govt.nz/monetary-policy/about-monetary-policy/the-official-cash-rate";
const monetaryPolicyDecisionsUrl = "https://www.rbnz.govt.nz/monetary-policy/monetary-policy-decisions";
const defaultPolymarketUrl = "https://polymarket.com/event/reserve-bank-of-new-zealand-decision-in-september-20260710022000963";
const requestHeaders = {
  "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
};
const monthlyDiscoveryConfig: MonthlyPolymarketDiscoveryConfig = {
  searchQuery: "reserve bank of new zealand decision",
  slugPrefix: "reserve-bank-of-new-zealand-decision-in-",
  titlePrefix: "Reserve Bank of New Zealand decision in",
  lastDiscoveryAtKey: "lastReserveBankNewZealandDecisionDiscoveryAt",
  activeIntervalMs: 2 * 60 * 60_000,
  noActiveIntervalMs: 30 * 60_000,
  lookaheadMs: 60 * 24 * 60 * 60_000
};
const easternTimeZone = "America/New_York";

export type ReserveBankNewZealandDecision = {
  date: string;
  dateIso: string;
  rate: string;
  url: string;
};

export type ReserveBankNewZealandOcrStatus = {
  currentRate: string;
  lastUpdated: string;
  updatedAt: string;
  updatedAtEt: string;
  nextUpdate: string;
  nextUpdateDateIso: string | null;
  nextUpdateEt: string;
  nextUpdateEtDateIso: string | null;
};

export type ReserveBankNewZealandOcrEvent = {
  dateIso: string;
  title: string;
  rawLine: string;
};

export const reserveBankNewZealandDecisionAdapter: WebsiteAdapter = {
  id: "reserve-bank-new-zealand-decision",
  commandName: "rbnzdecision",
  displayName: "Reserve Bank of New Zealand Decision",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "rbnzdecision",
  alertRoleName: "RBNZ Decision Alerts",
  alertRoleEmoji: "\uD83C\uDDF3\uD83C\uDDFF",
  getPollIntervalMinutes: getReserveBankNewZealandDecisionPollIntervalMinutes,
  getPollIntervalReason: getReserveBankNewZealandDecisionPollIntervalReason,
  shouldAlertOnChange: shouldAlertOnReserveBankNewZealandDecisionChange,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshReserveBankNewZealandDecisionPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async upsertPolymarketMarket(
    integration: Integration,
    url: string
  ): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertPolymarketQueueUrl(integration, url);
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const [ocrMarkdown, decisionsMarkdown, eventsMarkdown] = await Promise.all([
      fetchReserveBankNewZealandMarkdown(officialCashRateUrl),
      fetchReserveBankNewZealandMarkdown(monetaryPolicyDecisionsUrl),
      fetchReserveBankNewZealandMarkdown(sourceUrl)
    ]);
    const status = extractReserveBankNewZealandOcrStatus(ocrMarkdown);
    const decisions = extractReserveBankNewZealandDecisions(decisionsMarkdown);
    const nextEvent = extractReserveBankNewZealandOcrEvents(eventsMarkdown)[0] ?? null;
    const value = buildReserveBankNewZealandDecisionValue(
      decisions[0] ?? null,
      decisions[1] ?? null,
      status,
      nextEvent,
      integration?.polymarketUrl ?? defaultPolymarketUrl
    );

    return {
      value,
      rawValue: extractDecisionKey(value) ?? "not published yet",
      unit: "RBNZ official cash rate decision",
      observedAt: new Date()
    };
  }
};

export async function refreshReserveBankNewZealandDecisionPolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  return refreshMonthlyPolymarketQueue(integration, monthlyDiscoveryConfig, now);
}

export function extractReserveBankNewZealandDecisions(markdown: string): ReserveBankNewZealandDecision[] {
  if (isReserveBankNewZealandBlocked(markdown)) {
    throw new Error("RBNZ monetary policy decisions page returned an access restriction instead of decision content");
  }

  return [...markdown.matchAll(/(\d{1,2}\s+[A-Z][a-z]+\s+20\d{2})\s+(\d{1,2}(?:\.\d+)?)\s*\[Media release]\((https:\/\/www\.rbnz\.govt\.nz\/news-and-events\/news\/[^)\s]+)\)/g)]
    .map((match) => ({
      date: normalizeText(match[1]),
      dateIso: parseLongDateToIso(match[1]) ?? "unknown",
      rate: `${normalizeRate(match[2])}%`,
      url: match[3]
    }))
    .filter((decision) => decision.dateIso !== "unknown")
    .sort((left, right) => right.dateIso.localeCompare(left.dateIso));
}

export function extractReserveBankNewZealandOcrStatus(markdown: string): ReserveBankNewZealandOcrStatus {
  if (isReserveBankNewZealandBlocked(markdown)) {
    throw new Error("RBNZ official cash rate page returned an access restriction instead of OCR content");
  }

  const text = normalizeText(markdown);
  const currentRate = text.match(/Official Cash Rate\s+(\d{1,2}(?:\.\d+)?)\s*%/i)?.[1] ?? "not found";
  const lastUpdated = text.match(/Last updated:\s*(\d{1,2}\s+[A-Za-z]+\s+20\d{2})/i)?.[1] ?? "not found";
  const updatedAt = text.match(/Updated:\s*(\d{1,2}:\d{2}(?:am|pm),\s*\d{1,2}\s+[A-Za-z]{3}\s+20\d{2})/i)?.[1] ?? "not found";
  const nextUpdate = text.match(/Next update:\s*(\d{1,2}:\d{2}(?:am|pm),\s*\d{1,2}\s+[A-Za-z]{3}\s+20\d{2})/i)?.[1] ?? "not found";
  const updatedAtDate = parseAucklandDateTime(updatedAt);
  const nextUpdateDate = parseAucklandDateTime(nextUpdate);
  return {
    currentRate: currentRate === "not found" ? currentRate : `${normalizeRate(currentRate)}%`,
    lastUpdated,
    updatedAt,
    updatedAtEt: updatedAtDate ? formatEasternDateTime(updatedAtDate) : "not found",
    nextUpdate,
    nextUpdateDateIso: parseShortDateTimeToIso(nextUpdate),
    nextUpdateEt: nextUpdateDate ? formatEasternDateTime(nextUpdateDate) : "not found",
    nextUpdateEtDateIso: nextUpdateDate ? getEasternDate(nextUpdateDate) : null
  };
}

export function extractReserveBankNewZealandOcrEvents(markdown: string): ReserveBankNewZealandOcrEvent[] {
  if (isReserveBankNewZealandBlocked(markdown)) {
    throw new Error("RBNZ events page returned an access restriction instead of event content");
  }

  const lines = markdown.split(/\r?\n/).map(normalizeText).filter(Boolean);
  const events: ReserveBankNewZealandOcrEvent[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const titleMatch = lines[index].match(/^##\s+(.+\bOCR\b.*)$/i);
    if (!titleMatch || !isOcrDecisionEventTitle(titleMatch[1])) {
      continue;
    }

    const dateLine = lines.slice(Math.max(0, index - 4), index).reverse().find((line) => /^\d{2}\s+-\s+\d{2}\s+[A-Za-z]{3}\s+20\d{2}\b|^\d{2}\s+[A-Za-z]{3}\s+20\d{2}\b/.test(line));
    const eventDateIso = dateLine ? parseEventDateLineToIso(dateLine) : null;
    if (dateLine && eventDateIso) {
      events.push({
        dateIso: eventDateIso,
        title: normalizeText(titleMatch[1]),
        rawLine: dateLine
      });
    }
  }

  return events.sort((left, right) => left.dateIso.localeCompare(right.dateIso));
}

export function buildReserveBankNewZealandDecisionValue(
  latestDecision: ReserveBankNewZealandDecision | null,
  previousDecision: ReserveBankNewZealandDecision | null,
  status: ReserveBankNewZealandOcrStatus,
  nextEvent: ReserveBankNewZealandOcrEvent | null,
  polymarketUrl: string
): string {
  const lines = [
    "Report: Reserve Bank of New Zealand official cash rate decision",
    `Latest official decision: ${latestDecision?.dateIso ?? "not found"}`,
    `Decision direction: ${getDecisionDirection(latestDecision, previousDecision)}`,
    `OCR after latest decision: ${latestDecision?.rate ?? "not found"}`,
    `Previous OCR: ${previousDecision?.rate ?? "not found"}`,
    `Current OCR page rate: ${status.currentRate}`,
    `OCR page updated: ${status.updatedAtEt}`,
    `Next OCR update: ${status.nextUpdateEtDateIso && status.nextUpdateEt !== "not found" ? status.nextUpdateEt : "not found"}`,
    `RBNZ local next update date: ${status.nextUpdateDateIso ?? "not found"}`,
    `Next scheduled OCR event: ${nextEvent ? `${nextEvent.dateIso} - ${nextEvent.title}` : "not found"}`,
    `Media release URL: ${latestDecision?.url ?? "not found"}`,
    `Decision key: ${latestDecision ? buildDecisionKey(latestDecision) : "not found"}`,
    `Resolution: ${sourceUrl}`,
    `OCR page: ${officialCashRateUrl}`,
    `Past decisions: ${monetaryPolicyDecisionsUrl}`,
    `Polymarket: ${polymarketUrl}`
  ];
  return lines.join("\n");
}

export function getReserveBankNewZealandDecisionPollIntervalMinutes(integration: Integration, now: Date = new Date()): number {
  return isReserveBankNewZealandReleaseWatchDay(integration, now) ? 1 : 60;
}

export function getReserveBankNewZealandDecisionPollIntervalReason(integration: Integration, now: Date = new Date()): string {
  const nextUpdate = extractNextOcrUpdateIso(integration.lastValue);
  if (!nextUpdate) {
    return "RBNZ normal mode; next OCR update date not known yet";
  }

  return isReserveBankNewZealandReleaseWatchDay(integration, now)
    ? `RBNZ OCR release watch: day before/day of ${nextUpdate} ET`
    : `RBNZ normal mode outside day before/day of ${nextUpdate} ET`;
}

export function shouldAlertOnReserveBankNewZealandDecisionChange(previousValue: string | null, currentValue: string): boolean {
  const previousKey = extractDecisionKey(previousValue);
  const currentKey = extractDecisionKey(currentValue);
  return Boolean(currentKey && currentKey !== "not found" && previousKey && currentKey !== previousKey);
}

async function fetchReserveBankNewZealandMarkdown(url: string): Promise<string> {
  const response = await fetchWithTimeout(toJinaUrl(url), { headers: requestHeaders }, 30_000);
  if (!response.ok) {
    throw new Error(`RBNZ mirror returned HTTP ${response.status} for ${url}`);
  }

  return response.text();
}

function toJinaUrl(url: string): string {
  return `https://r.jina.ai/http://${url}`;
}

function isReserveBankNewZealandReleaseWatchDay(integration: Integration, now: Date): boolean {
  const nextUpdate = extractNextOcrUpdateIso(integration.lastValue);
  if (!nextUpdate) {
    return false;
  }

  const currentDate = getEasternDate(now);
  return currentDate === nextUpdate || currentDate === addDays(nextUpdate, -1);
}

function getDecisionDirection(
  latestDecision: ReserveBankNewZealandDecision | null,
  previousDecision: ReserveBankNewZealandDecision | null
): string {
  if (!latestDecision || !previousDecision) {
    return "not found";
  }

  const latestRate = Number.parseFloat(latestDecision.rate);
  const previousRate = Number.parseFloat(previousDecision.rate);
  if (Number.isNaN(latestRate) || Number.isNaN(previousRate)) {
    return "not found";
  }

  if (latestRate > previousRate) {
    return "Increase";
  }
  if (latestRate < previousRate) {
    return "Decrease";
  }
  return "No change";
}

function isOcrDecisionEventTitle(value: string): boolean {
  return /\bMonetary Policy (Statement|Review)\b.*\bOCR\b/i.test(value);
}

function buildDecisionKey(decision: ReserveBankNewZealandDecision): string {
  return `${decision.dateIso}|${decision.rate}|${decision.url}`;
}

function extractDecisionKey(value: string | null): string | null {
  return value?.match(/^Decision key:\s*(.+)$/m)?.[1]?.trim() ?? null;
}

function extractNextOcrUpdateIso(value: string | null): string | null {
  return value?.match(/^Next OCR update:\s*(\d{4}-\d{2}-\d{2})\b/m)?.[1] ?? null;
}

function parseLongDateToIso(value: string): string | null {
  const match = normalizeText(value).match(/^(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})$/);
  if (!match) {
    return null;
  }

  const month = monthNumber(match[2]);
  return month ? `${match[3]}-${padNumber(month)}-${padNumber(Number(match[1]))}` : null;
}

function parseShortDateTimeToIso(value: string): string | null {
  const match = normalizeText(value).match(/^\d{1,2}:\d{2}(?:am|pm),\s*(\d{1,2})\s+([A-Za-z]{3})\s+(20\d{2})$/i);
  if (!match) {
    return null;
  }

  const month = monthNumber(match[2]);
  return month ? `${match[3]}-${padNumber(month)}-${padNumber(Number(match[1]))}` : null;
}

function parseAucklandDateTime(value: string): Date | null {
  const match = normalizeText(value).match(/^(\d{1,2}):(\d{2})(am|pm),\s*(\d{1,2})\s+([A-Za-z]{3})\s+(20\d{2})$/i);
  if (!match) {
    return null;
  }

  const month = monthNumber(match[5]);
  if (!month) {
    return null;
  }

  const hour = toTwentyFourHour(Number(match[1]), match[3]);
  const localAsUtc = Date.UTC(Number(match[6]), month - 1, Number(match[4]), hour, Number(match[2]));
  let utcDate = new Date(localAsUtc - getTimeZoneOffsetMs(new Date(localAsUtc), "Pacific/Auckland"));
  utcDate = new Date(localAsUtc - getTimeZoneOffsetMs(utcDate, "Pacific/Auckland"));
  return utcDate;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).formatToParts(date).map((part) => [part.type, part.value])
  );
  const zonedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return zonedAsUtc - date.getTime();
}

function formatEasternDateTime(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: easternTimeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ET`;
}

function toTwentyFourHour(hour: number, meridiem: string): number {
  const normalized = meridiem.toLowerCase();
  if (normalized === "am") {
    return hour === 12 ? 0 : hour;
  }
  return hour === 12 ? 12 : hour + 12;
}

function parseEventDateLineToIso(value: string): string | null {
  const normalized = normalizeText(value);
  const rangeMatch = normalized.match(/^\d{1,2}\s+-\s+(\d{1,2})\s+([A-Za-z]{3})\s+(20\d{2})\b/i);
  if (rangeMatch) {
    const month = monthNumber(rangeMatch[2]);
    return month ? `${rangeMatch[3]}-${padNumber(month)}-${padNumber(Number(rangeMatch[1]))}` : null;
  }

  const match = normalized.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(20\d{2})\b/i);
  if (!match) {
    return null;
  }

  const month = monthNumber(match[2]);
  return month ? `${match[3]}-${padNumber(month)}-${padNumber(Number(match[1]))}` : null;
}

function normalizeRate(value: string): string {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed.toFixed(value.includes(".") ? 2 : 0).replace(/0$/, "").replace(/\.$/, "") : value;
}

function isReserveBankNewZealandBlocked(value: string): boolean {
  return /Enable JavaScript and cookies to continue|access to the Reserve Bank website has been restricted|Title:\s*Website unavailable/i.test(value);
}

function addDays(value: string, days: number): string {
  const timestamp = Date.parse(`${value}T12:00:00.000Z`);
  return new Date(timestamp + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function getEasternDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: easternTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
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

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
