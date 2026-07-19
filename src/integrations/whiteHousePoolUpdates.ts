import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, EventMonitorPost, EventMonitorResult, WebsiteAdapter } from "./types.js";

const bnoWhPoolUrl = "https://bnonews.com/whpool";
const forthWhPoolUrl = "https://www.forth.news/whpool";
const maxReports = 10;

export type WhiteHousePoolSource = "BNO" | "Forth";

export type WhiteHousePoolReport = {
  id: string;
  source: WhiteHousePoolSource;
  title: string;
  url: string;
  publishedAt: Date;
  sender?: string;
  excerpt?: string;
};

type SourceFetchResult = {
  source: WhiteHousePoolSource;
  ok: boolean;
  status: string;
  reports: WhiteHousePoolReport[];
};

export function parseBnoWhPoolReports(html: string, sourceUrl = bnoWhPoolUrl): WhiteHousePoolReport[] {
  const $ = cheerio.load(html);
  const reports: WhiteHousePoolReport[] = [];

  $("article.report-card").each((_, element) => {
    const card = $(element);
    const link = card.find("h2 a").first();
    const title = normalizeText(link.text());
    const href = link.attr("href");
    const publishedAt = parseDate(card.find("time").first().attr("datetime"));
    if (!title || !href || !publishedAt) {
      return;
    }

    const url = new URL(href, sourceUrl).toString();
    reports.push({
      id: `bno:${getStablePathId(url)}`,
      source: "BNO",
      title,
      url,
      publishedAt,
      sender: normalizeText(card.find(".sender").first().text()).replace(/^·\s*/, "") || undefined,
      excerpt: normalizeText(card.find(".excerpt").first().text()) || undefined
    });
  });

  return dedupeAndSortReports(reports);
}

export function parseForthWhPoolReports(html: string, sourceUrl = forthWhPoolUrl): WhiteHousePoolReport[] {
  const $ = cheerio.load(html);
  const reports: WhiteHousePoolReport[] = [];
  const seenUrls = new Set<string>();

  $("a[href]").each((_, element) => {
    const link = $(element);
    const href = link.attr("href");
    if (!href || !isForthPoolReportHref(href)) {
      return;
    }

    const url = new URL(href, sourceUrl).toString();
    if (seenUrls.has(url)) {
      return;
    }

    const title = normalizeText(link.text());
    if (!title || /^white house press pool$/i.test(title)) {
      return;
    }

    const container = link.closest("article, li, section, div");
    const publishedAt = parseDate(container.find("time").first().attr("datetime")) ?? parseDateFromText(container.text());
    if (!publishedAt) {
      return;
    }

    seenUrls.add(url);
    reports.push({
      id: `forth:${getStablePathId(url)}`,
      source: "Forth",
      title,
      url,
      publishedAt,
      excerpt: getExcerpt(container.text(), title)
    });
  });

  return dedupeAndSortReports(reports);
}

export const whiteHousePoolUpdatesAdapter: WebsiteAdapter = {
  id: "white-house-pool-updates",
  commandName: "whpool",
  displayName: "White House Pool Updates",
  sourceUrl: bnoWhPoolUrl,
  defaultChannelName: "whpool",
  alertRoleName: "White House Pool Alerts",
  alertRoleEmoji: "\uD83D\uDCF0",
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "Fixed 1-minute check for White House press pool updates",
  getErrorNoticeWindowMinutes: () => 30,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const result = await fetchWhiteHousePoolSources();
    const latest = getLatestReports(result)[0];
    const value = latest ? formatWhiteHousePoolReportValue(latest, result) : formatWhiteHousePoolSourceStatuses(result);
    if (!latest) {
      throw new Error(`Could not check White House pool sources. ${formatWhiteHousePoolSourceStatuses(result)}`);
    }

    return {
      value,
      rawValue: value,
      unit: "latest White House press pool update",
      observedAt: new Date()
    };
  },
  async fetchEventUpdates(): Promise<EventMonitorResult> {
    const result = await fetchWhiteHousePoolSources();
    const reports = getLatestReports(result).slice(0, maxReports);
    if (reports.length === 0) {
      throw new Error(`Could not check White House pool sources. ${formatWhiteHousePoolSourceStatuses(result)}`);
    }

    return {
      posts: reports.map((report) => toEventPost(report, result)),
      strikeTerms: [],
      checkTitle: "Latest White House pool updates",
      checkFields: [
        { name: "Reports scanned", value: String(reports.length), inline: true },
        { name: "BNO", value: getSourceStatus(result, "BNO"), inline: false },
        { name: "Forth", value: getSourceStatus(result, "Forth"), inline: false },
        { name: "Latest", value: reports[0] ? `${reports[0].source}: ${reports[0].title}\n${reports[0].url}` : "none", inline: false }
      ],
      observedAt: new Date()
    };
  }
};

async function fetchWhiteHousePoolSources(): Promise<SourceFetchResult[]> {
  return Promise.all([fetchBnoReports(), fetchForthReports()]);
}

async function fetchBnoReports(): Promise<SourceFetchResult> {
  try {
    const response = await fetchWithTimeout(bnoWhPoolUrl, {
      headers: {
        accept: "text/html",
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });
    if (!response.ok) {
      return { source: "BNO", ok: false, status: `unavailable HTTP ${response.status}`, reports: [] };
    }

    const reports = parseBnoWhPoolReports(await response.text());
    return {
      source: "BNO",
      ok: reports.length > 0,
      status: reports.length ? `${reports.length} report(s) parsed` : "no reports parsed",
      reports
    };
  } catch (error) {
    return { source: "BNO", ok: false, status: formatSourceError(error), reports: [] };
  }
}

async function fetchForthReports(): Promise<SourceFetchResult> {
  try {
    const response = await fetchWithTimeout(forthWhPoolUrl, {
      headers: {
        accept: "text/html",
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });
    if (!response.ok) {
      return { source: "Forth", ok: false, status: `unavailable HTTP ${response.status}`, reports: [] };
    }

    const reports = parseForthWhPoolReports(await response.text());
    return {
      source: "Forth",
      ok: reports.length > 0,
      status: reports.length ? `${reports.length} report(s) parsed` : "no reports parsed",
      reports
    };
  } catch (error) {
    return { source: "Forth", ok: false, status: formatSourceError(error), reports: [] };
  }
}

function toEventPost(report: WhiteHousePoolReport, sourceResults: SourceFetchResult[]): EventMonitorPost {
  return {
    id: report.id,
    type: "White House press pool update",
    alertTitle: `White House pool update - ${report.source}`,
    sourceLabel: report.source,
    buttonLabel: "Open report",
    mentionAlertRole: true,
    textFieldName: "Summary",
    text: report.excerpt ?? report.title,
    qualifyingText: `${report.title}\n${report.excerpt ?? ""}`,
    postedAt: report.publishedAt,
    url: report.url,
    summaryFields: [
      { name: "Source", value: report.source, inline: true },
      { name: "Title", value: report.title, inline: false },
      ...(report.sender ? [{ name: "Sender", value: report.sender, inline: true }] : [])
    ],
    hiddenFields: [{ name: "Source status", value: formatWhiteHousePoolSourceStatuses(sourceResults), inline: false }],
    hideLinksField: false,
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

function formatWhiteHousePoolReportValue(report: WhiteHousePoolReport, sourceResults: SourceFetchResult[]): string {
  return [
    "Metric: White House press pool updates",
    `Latest source: ${report.source}`,
    `Title: ${report.title}`,
    `Published at: ${report.publishedAt.toISOString()}`,
    ...(report.sender ? [`Sender: ${report.sender}`] : []),
    ...(report.excerpt ? [`Summary: ${report.excerpt}`] : []),
    `URL: ${report.url}`,
    formatWhiteHousePoolSourceStatuses(sourceResults),
    `BNO feed: ${bnoWhPoolUrl}`,
    `Forth feed: ${forthWhPoolUrl}`
  ].join("\n");
}

function formatWhiteHousePoolSourceStatuses(sourceResults: SourceFetchResult[]): string {
  return sourceResults.map((source) => `${source.source}: ${source.status}`).join("\n");
}

function getLatestReports(sourceResults: SourceFetchResult[]): WhiteHousePoolReport[] {
  return dedupeAndSortReports(sourceResults.flatMap((source) => source.reports));
}

function getSourceStatus(sourceResults: SourceFetchResult[], source: WhiteHousePoolSource): string {
  return sourceResults.find((result) => result.source === source)?.status ?? "not checked";
}

function dedupeAndSortReports(reports: WhiteHousePoolReport[]): WhiteHousePoolReport[] {
  const seen = new Set<string>();
  const deduped: WhiteHousePoolReport[] = [];
  for (const report of reports) {
    if (seen.has(report.id)) {
      continue;
    }

    seen.add(report.id);
    deduped.push(report);
  }

  return deduped.sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime());
}

function isForthPoolReportHref(href: string): boolean {
  try {
    const parsed = new URL(href, forthWhPoolUrl);
    return parsed.hostname === "www.forth.news" && /^\/(?:lists\/)?whpool\/[^/?#]+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function getStablePathId(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/\/+$/, "") || parsed.toString();
  } catch {
    return url;
  }
}

function parseDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateFromText(value: string): Date | null {
  const text = normalizeText(value);
  const isoMatch = text.match(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)?\b/);
  if (isoMatch) {
    return parseDate(isoMatch[0]);
  }

  const monthMatch = text.match(
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4}(?:\s+at\s+\d{1,2}:\d{2}\s*(?:AM|PM)\s*(?:EDT|EST|ET)?)?/i
  );
  if (!monthMatch) {
    return null;
  }

  return parseDate(monthMatch[0].replace(/\s+(EDT|EST|ET)$/i, ""));
}

function getExcerpt(value: string, title: string): string | undefined {
  const text = normalizeText(value).replace(title, "").trim();
  return text ? text.slice(0, 500) : undefined;
}

function formatSourceError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
