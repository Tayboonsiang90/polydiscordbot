import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.pbc.gov.cn/en/3688110/3688181/index.html";
const defaultPolymarketUrl = "https://polymarket.com/event/peoples-bank-of-china-rate-change-in-june";
const pbocRetryDelaysMs = [10_000, 30_000];
const pbocFetchTimeoutMs = 30_000;

export type PbocAnnouncement = {
  title: string;
  date: string;
  url: string;
};

export type PbocAnnouncementDetail = {
  rates: string[];
  summary: string;
};

export const pbocRateChangeAdapter: WebsiteAdapter = {
  id: "pboc-rate-change",
  commandName: "pboc",
  displayName: "PBoC Rate Change",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "pboc",
  alertRoleName: "PBoC Rate Alerts",
  alertRoleEmoji: "\uD83C\uDFE6",
  getPollIntervalMinutes: () => 15,
  getPollIntervalReason: () => "Fixed 15-minute check for PBoC announcement/rate changes",
  shouldAlertOnChange: pbocRateChangeShouldAlertOnChange,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const latest = await fetchLatestPbocAnnouncement();
    const detail = await fetchPbocAnnouncementDetail(latest.url);
    const value = formatPbocAnnouncementValue(latest, detail);
    return {
      value,
      rawValue: extractRateLine(value) ?? value,
      unit: "latest PBoC announcement rate",
      observedAt: new Date()
    };
  }
};

export function extractLatestPbocAnnouncementValue(html: string, detail: PbocAnnouncementDetail = { rates: [], summary: "not fetched" }): string {
  return formatPbocAnnouncementValue(extractLatestPbocAnnouncement(html), detail);
}

export function extractLatestPbocAnnouncement(html: string): PbocAnnouncement {
  const $ = cheerio.load(html);
  const candidates = $("a")
    .map((_, anchor) => {
      const link = $(anchor);
      const title = normalizeText(link.text());
      const href = link.attr("href");
      const parentText = normalizeText(link.parent().text());
      const date = findDate(parentText);
      if (!title || !href || !date || !isPbocAnnouncementLink(href) || !isRateRelevantAnnouncement(title)) {
        return null;
      }

      return {
        title,
        date,
        url: new URL(href, sourceUrl).toString()
      };
    })
    .get()
    .filter((announcement): announcement is PbocAnnouncement => Boolean(announcement));

  if (candidates.length === 0) {
    throw new Error("Could not find the latest PBoC rate-relevant announcement row");
  }

  return candidates[0];
}

export function extractPbocAnnouncementDetail(html: string): PbocAnnouncementDetail {
  const $ = cheerio.load(html);
  const contentText = normalizeText($(".content").first().text());
  if (!contentText) {
    return { rates: [], summary: "not found" };
  }

  return {
    rates: extractRates(contentText),
    summary: extractSummary(contentText)
  };
}

export function formatPbocAnnouncementValue(announcement: PbocAnnouncement, detail: PbocAnnouncementDetail): string {
  return [
    `Title: ${announcement.title}`,
    `Date: ${announcement.date}`,
    `Rate(s): ${detail.rates.length ? detail.rates.join(", ") : "not found"}`,
    `Summary: ${detail.summary}`,
    `URL: ${announcement.url}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function pbocRateChangeShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  const previousRates = extractRateLine(previousValue);
  const currentRates = extractRateLine(currentValue);
  return Boolean(currentRates && currentRates !== "not found" && previousRates !== currentRates);
}

async function fetchLatestPbocAnnouncement(): Promise<PbocAnnouncement> {
  const response = await fetchPbocUrl(sourceUrl);

  if (!response.ok) {
    throw new Error(`PBoC announcements page returned HTTP ${response.status}`);
  }

  return extractLatestPbocAnnouncement(await response.text());
}

async function fetchPbocAnnouncementDetail(url: string): Promise<PbocAnnouncementDetail> {
  const response = await fetchPbocUrl(url);

  if (!response.ok) {
    throw new Error(`PBoC announcement detail returned HTTP ${response.status}`);
  }

  return extractPbocAnnouncementDetail(await response.text());
}

export async function fetchPbocUrl(url: string, retryDelaysMs = pbocRetryDelaysMs): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await fetchWithTimeout(
        url,
        {
          headers: {
            "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
          }
        },
        pbocFetchTimeoutMs
      );
    } catch (error) {
      lastError = error;
      if (!isTransientPbocNetworkError(error) || attempt === retryDelaysMs.length) {
        break;
      }

      await delay(retryDelaysMs[attempt]);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isPbocAnnouncementLink(href: string): boolean {
  return /\/en\/3688110\/3688181\/\d{14,}\/index\.html$/.test(href);
}

function isRateRelevantAnnouncement(title: string): boolean {
  return /open market|reverse repo|central bank bill|interest rate|lpr|loan prime rate|mlf|slf|rate/i.test(title);
}

function findDate(value: string): string | null {
  return value.match(/20\d{2}-\d{2}-\d{2}/)?.[0] ?? null;
}

function extractRates(value: string): string[] {
  return [...new Set(value.match(/\b\d+(?:\.\d+)?%/g) ?? [])];
}

function extractSummary(value: string): string {
  const withoutTitle = value.replace(/^Announcement on[^)]*\)\s*/i, "");
  const sentence = withoutTitle.match(/The People[’']s Bank of China[^.]+\./i)?.[0] ?? withoutTitle;
  return normalizeText(sentence).slice(0, 600) || "not found";
}

function extractRateLine(value: string | null): string | null {
  return value?.match(/^Rate\(s\):\s*(.+)$/m)?.[1]?.trim() ?? null;
}

function isTransientPbocNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const codes = collectErrorCodes(error).map((code) => code.toLowerCase());
  const transientCodes = new Set([
    "eai_again",
    "econnaborted",
    "econnrefused",
    "econnreset",
    "ehostunreach",
    "etimedout",
    "und_err_connect_timeout"
  ]);

  return (
    codes.some((code) => transientCodes.has(code)) ||
    message.includes("eai_again") ||
    message.includes("connect timeout") ||
    message.includes("connection reset") ||
    message.includes("econnaborted") ||
    message.includes("econnrefused") ||
    message.includes("ehostunreach") ||
    message.includes("etimedout") ||
    message.includes("timed out") ||
    message.includes("und_err_connect_timeout")
  );
}

function collectErrorCodes(error: unknown): string[] {
  if (!error || typeof error !== "object") {
    return [];
  }

  const record = error as { code?: unknown; cause?: unknown };
  const codes = typeof record.code === "string" ? [record.code] : [];
  return [...codes, ...collectErrorCodes(record.cause)];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
