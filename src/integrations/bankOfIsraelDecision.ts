import { fetchWithTimeout } from "../http.js";
import { upsertPolymarketQueueUrl } from "../polymarketQueue.js";
import {
  refreshMonthlyPolymarketQueue,
  type MonthlyPolymarketDiscoveryConfig
} from "./monthlyPolymarketDiscovery.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.boi.org.il/en/economic-roles/monetary-policy/interest-rate-announcement-dates-2025-2026/";
const pressReleasesUrl = "https://www.boi.org.il/en/communication-and-publications/press-releases/?category=interest-rate";
const interestApiUrl = "https://www.boi.org.il/PublicApi/GetInterest";
const defaultPolymarketUrl = "https://polymarket.com/event/bank-of-israel-decision-in-august";
const requestHeaders = {
  "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
};
const monthlyDiscoveryConfig: MonthlyPolymarketDiscoveryConfig = {
  searchQuery: "bank of israel decision",
  slugPrefix: "bank-of-israel-decision-in-",
  titlePrefix: "Bank of Israel decision in",
  lastDiscoveryAtKey: "lastBankOfIsraelDecisionDiscoveryAt",
  activeIntervalMs: 2 * 60 * 60_000,
  noActiveIntervalMs: 30 * 60_000,
  lookaheadMs: 60 * 24 * 60 * 60_000
};
const easternTimeZone = "America/New_York";

export type BankOfIsraelAnnouncement = {
  date: string;
  title: string;
  url: string;
};

export type BankOfIsraelDecisionDetail = {
  decision: string;
  rate: string;
  documentUrl: string | null;
  summary: string;
};

export type BankOfIsraelScheduleEntry = {
  publicationDate: string;
  publicationDateIso: string;
  rawLine: string;
};

export type BankOfIsraelInterestSnapshot = {
  currentInterest: number;
  nextInterestDate: string;
  lastPublishedDate: string | null;
};

export const bankOfIsraelDecisionAdapter: WebsiteAdapter = {
  id: "bank-of-israel-decision",
  commandName: "boidecision",
  displayName: "Bank of Israel Decision",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "boidecision",
  alertRoleName: "Bank of Israel Alerts",
  alertRoleEmoji: "\uD83C\uDDEE\uD83C\uDDF1",
  getPollIntervalMinutes: getBankOfIsraelDecisionPollIntervalMinutes,
  getPollIntervalReason: getBankOfIsraelDecisionPollIntervalReason,
  shouldAlertOnChange: shouldAlertOnBankOfIsraelDecisionChange,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshBankOfIsraelDecisionPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async upsertPolymarketMarket(
    integration: Integration,
    url: string
  ): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertPolymarketQueueUrl(integration, url);
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const snapshot = await fetchBankOfIsraelInterestSnapshot();
    const previousRate = extractStoredRate(integration?.lastValue ?? null);
    const value = buildBankOfIsraelInterestValue(
      snapshot,
      getBankOfIsraelDecisionDirection(previousRate, snapshot.currentInterest),
      integration?.polymarketUrl ?? defaultPolymarketUrl
    );

    return {
      value,
      rawValue: `${snapshot.currentInterest}:${snapshot.lastPublishedDate ?? "unknown"}`,
      unit: "Bank of Israel interest rate decision",
      observedAt: new Date()
    };
  }
};

export function extractBankOfIsraelInterestSnapshot(data: unknown): BankOfIsraelInterestSnapshot {
  if (!isRecord(data)) {
    throw new Error("Bank of Israel interest API returned an invalid payload");
  }

  const currentInterest = Number(data.currentInterest);
  const nextInterestDate = typeof data.nextInterestDate === "string" ? data.nextInterestDate : "";
  const lastPublishedDate = typeof data.lastPublishedDate === "string" ? data.lastPublishedDate : null;
  if (!Number.isFinite(currentInterest) || !isValidIsoDate(nextInterestDate)) {
    throw new Error("Bank of Israel interest API omitted the current rate or next publication date");
  }

  return {
    currentInterest,
    nextInterestDate,
    lastPublishedDate: lastPublishedDate && isValidIsoDate(lastPublishedDate) ? lastPublishedDate : null
  };
}

export function buildBankOfIsraelInterestValue(
  snapshot: BankOfIsraelInterestSnapshot,
  decision: string,
  polymarketUrl: string
): string {
  return [
    "Report: Bank of Israel interest rate decision",
    `Decision: ${decision}`,
    `Rate: ${formatInterestRate(snapshot.currentInterest)}`,
    `Last official update: ${snapshot.lastPublishedDate ? formatEasternTimestamp(snapshot.lastPublishedDate) : "not found"}`,
    `Next scheduled publication: ${snapshot.nextInterestDate.slice(0, 10)}`,
    `Official API: ${interestApiUrl}`,
    `Resolution: ${sourceUrl}`,
    `Press releases: ${pressReleasesUrl}`,
    `Polymarket: ${polymarketUrl}`
  ].join("\n");
}

export function getBankOfIsraelDecisionDirection(previousRate: number | null, currentRate: number): string {
  if (previousRate === null) {
    return "Current rate";
  }
  if (currentRate < previousRate) {
    return "Decrease";
  }
  if (currentRate > previousRate) {
    return "Increase";
  }
  return "No change";
}

export async function refreshBankOfIsraelDecisionPolymarketQueue(
  integration: Integration,
  now: Date = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  return refreshMonthlyPolymarketQueue(integration, monthlyDiscoveryConfig, now);
}

export function extractLatestBankOfIsraelInterestRateAnnouncement(markdown: string): BankOfIsraelAnnouncement | null {
  if (isRadwareLoader(markdown)) {
    throw new Error("Bank of Israel press releases page returned the Radware loader instead of release content");
  }

  const releasesSection = markdown.slice(Math.max(0, markdown.indexOf("## Press Releases")));
  const announcements = [...releasesSection.matchAll(/\[([^\]]+)]\((https:\/\/www\.boi\.org\.il\/en\/communication-and-publications\/press-releases\/[^)\s"]+)(?:\s+"[^"]*")?\)/g)]
    .map((match) => parseBankOfIsraelAnnouncementLink(match[1], match[2]))
    .filter((announcement): announcement is BankOfIsraelAnnouncement => announcement !== null);

  return announcements[0] ?? null;
}

export function extractBankOfIsraelDecisionDetail(markdown: string): BankOfIsraelDecisionDetail {
  if (isRadwareLoader(markdown)) {
    throw new Error("Bank of Israel decision detail returned the Radware loader instead of release content");
  }

  const text = normalizeText(markdown);
  const documentUrl = markdown.match(/\[To view this press release click here]\((https:\/\/www\.boi\.org\.il\/[^)]+)\)/i)?.[1] ?? null;
  return {
    decision: extractDecisionDirection(text),
    rate: extractDecisionRate(text),
    documentUrl,
    summary: extractDecisionSummary(text)
  };
}

export function extractBankOfIsraelSchedule(markdown: string): BankOfIsraelScheduleEntry[] {
  if (isRadwareLoader(markdown)) {
    throw new Error("Bank of Israel schedule page returned the Radware loader instead of schedule content");
  }

  const tableStart = markdown.indexOf("**Press conference**");
  const tableEnd = markdown.indexOf("[Interest rate announcement dates 2027", tableStart);
  if (tableStart === -1 || tableEnd === -1) {
    return [];
  }

  return markdown
    .slice(tableStart, tableEnd)
    .split(/\r?\n/)
    .flatMap((line) => {
      const dates = line.match(/\b\d{2}\/\d{2}\/20\d{2}\b/g) ?? [];
      const publicationDate = dates.at(-1);
      if (!publicationDate) {
        return [];
      }

      return [
        {
          publicationDate,
          publicationDateIso: ddmmyyyyToIso(publicationDate),
          rawLine: normalizeText(line)
        }
      ];
    })
    .sort((left, right) => left.publicationDateIso.localeCompare(right.publicationDateIso));
}

export function findNextBankOfIsraelPublicationDate(
  schedule: BankOfIsraelScheduleEntry[],
  now: Date = new Date()
): BankOfIsraelScheduleEntry | null {
  const currentDate = getEasternDate(now);
  return schedule.find((entry) => entry.publicationDateIso >= currentDate) ?? null;
}

export function buildBankOfIsraelDecisionValue(
  announcement: BankOfIsraelAnnouncement | null,
  detail: BankOfIsraelDecisionDetail | null,
  nextPublication: BankOfIsraelScheduleEntry | null,
  polymarketUrl: string
): string {
  const lines = [
    "Report: Bank of Israel interest rate decision",
    `Latest official decision: ${announcement ? announcement.date : "not found"}`,
    `Decision: ${detail?.decision ?? "not found"}`,
    `Rate: ${detail?.rate ?? "not found"}`,
    `Title: ${announcement?.title ?? "not found"}`,
    `Release URL: ${announcement?.url ?? "not found"}`,
    `Document URL: ${detail?.documentUrl ?? "not found"}`,
    `Next scheduled publication: ${nextPublication ? `${nextPublication.publicationDateIso} 16:00 Israel time` : "not found"}`,
    `Schedule row: ${nextPublication?.rawLine ?? "not found"}`,
    `Summary: ${detail?.summary ?? "not found"}`,
    `Resolution: ${sourceUrl}`,
    `Press releases: ${pressReleasesUrl}`,
    `Polymarket: ${polymarketUrl}`
  ];
  return lines.join("\n");
}

export function getBankOfIsraelDecisionPollIntervalMinutes(integration: Integration, now: Date = new Date()): number {
  return isBankOfIsraelReleaseWatchDay(integration, now) ? 1 : 60;
}

export function getBankOfIsraelDecisionPollIntervalReason(integration: Integration, now: Date = new Date()): string {
  const nextPublication = extractNextPublicationIso(integration.lastValue);
  if (!nextPublication) {
    return "Bank of Israel normal mode; next publication date not known yet";
  }

  return isBankOfIsraelReleaseWatchDay(integration, now)
    ? `Bank of Israel release watch: day before/day of ${nextPublication} ET`
    : `Bank of Israel normal mode outside day before/day of ${nextPublication} ET`;
}

export function shouldAlertOnBankOfIsraelDecisionChange(previousValue: string | null, currentValue: string): boolean {
  if (!previousValue) {
    return false;
  }

  const previousSignature = extractOfficialDecisionSignature(previousValue);
  const currentSignature = extractOfficialDecisionSignature(currentValue);
  return Boolean(currentSignature && previousSignature && currentSignature !== previousSignature);
}

function parseBankOfIsraelAnnouncementLink(label: string, url: string): BankOfIsraelAnnouncement | null {
  const normalized = normalizeText(label);
  const isTaggedInterestRateAnnouncement = /\*\s+Interest Rate Announcements\b/i.test(normalized);
  const match = normalized.match(/^(\d{2}\/\d{2}\/20\d{2})\s+(?:\*\s+Interest Rate Announcements\s+)?(.+)$/i);
  if (!match) {
    return null;
  }

  const title = normalizeText(match[2]);
  if (!isTaggedInterestRateAnnouncement && !/interest rate|monetary committee decides/i.test(title)) {
    return null;
  }

  return {
    date: match[1],
    title,
    url
  };
}

function isBankOfIsraelReleaseWatchDay(integration: Integration, now: Date): boolean {
  const nextPublication = extractNextPublicationIso(integration.lastValue);
  if (!nextPublication) {
    return false;
  }

  const currentDate = getEasternDate(now);
  return currentDate === nextPublication || currentDate === addDays(nextPublication, -1);
}

async function fetchBankOfIsraelMarkdown(url: string): Promise<string> {
  const response = await fetchWithTimeout(toJinaUrl(url), { headers: requestHeaders }, 30_000);
  if (!response.ok) {
    throw new Error(`Bank of Israel mirror returned HTTP ${response.status} for ${url}`);
  }

  return response.text();
}

async function fetchBankOfIsraelInterestSnapshot(): Promise<BankOfIsraelInterestSnapshot> {
  const response = await fetchWithTimeout(interestApiUrl, { headers: requestHeaders }, 30_000);
  if (!response.ok) {
    throw new Error(`Bank of Israel interest API returned HTTP ${response.status}`);
  }

  return extractBankOfIsraelInterestSnapshot(await response.json());
}

function toJinaUrl(url: string): string {
  return `https://r.jina.ai/http://${url}`;
}

function extractNextPublicationIso(value: string | null): string | null {
  return value?.match(/^Next scheduled publication:\s*(\d{4}-\d{2}-\d{2})\b/m)?.[1] ?? null;
}

function extractStoredRate(value: string | null): number | null {
  const rate = value?.match(/^Rate:\s*(\d+(?:\.\d+)?)%/m)?.[1];
  return rate ? Number(rate) : null;
}

function extractOfficialDecisionSignature(value: string): string | null {
  const rate = value.match(/^Rate:\s*(.+)$/m)?.[1]?.trim();
  const lastOfficialUpdate = value.match(/^Last official update:\s*(.+)$/m)?.[1]?.trim();
  return rate && lastOfficialUpdate ? `${rate}|${lastOfficialUpdate}` : null;
}

function extractDecisionDirection(text: string): string {
  if (/\b(lower|lowered|cut|decrease|decreased|reduce|reduced)\b[^.]{0,80}\binterest rate\b|\binterest rate\b[^.]{0,80}\b(lower|lowered|cut|decrease|decreased|reduce|reduced)\b/i.test(text)) {
    return "Decrease";
  }
  if (/\b(raise|raised|increase|increased|hike|hiked)\b[^.]{0,80}\binterest rate\b|\binterest rate\b[^.]{0,80}\b(raise|raised|increase|increased|hike|hiked)\b/i.test(text)) {
    return "Increase";
  }
  if (/\b(leave|left|keep|kept|unchanged|no change)\b[^.]{0,120}\binterest rate\b|\binterest rate\b[^.]{0,120}\b(unchanged|no change|remain|remains)\b/i.test(text)) {
    return "No change";
  }
  return "not found";
}

function extractDecisionRate(text: string): string {
  const match =
    text.match(/\binterest rate\b[^.]{0,120}\b(?:to|at|of|is|will be|remains?|unchanged at)\s+(\d{1,2}(?:\.\d+)?)\s*percent/i) ??
    text.match(/\b(\d{1,2}(?:\.\d+)?)\s*percent\b[^.]{0,120}\binterest rate\b/i);
  return match?.[1] ? `${Number.parseFloat(match[1]).toFixed(match[1].includes(".") ? 1 : 0)}%` : "not found";
}

function extractDecisionSummary(text: string): string {
  const cleaned = text
    .replace(/^Title:[\s\S]*?Markdown Content:/i, "")
    .replace(/\[To view this press release click here][^)]+\)/i, "");
  const bullet = cleaned.match(/\*\s+([^*]{30,500}?)(?=\s+\*|\s+\*\*|$)/)?.[1];
  const decisionSentence = cleaned.match(/The Monetary Committee[^.]+\./i)?.[0];
  return normalizeText(bullet ?? decisionSentence ?? cleaned).slice(0, 700) || "not found";
}

function isRadwareLoader(value: string): boolean {
  return /Title:\s*Radware Page|Verifying your browser before proceeding/i.test(value);
}

function ddmmyyyyToIso(value: string): string {
  const [day, month, year] = value.split("/");
  return `${year}-${month}-${day}`;
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

function formatEasternTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: easternTimeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).format(new Date(value)) + " ET";
}

function formatInterestRate(value: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value)}%`;
}

function isValidIsoDate(value: string): boolean {
  return value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
