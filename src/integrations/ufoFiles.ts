import * as cheerio from "cheerio";
import { createHash } from "crypto";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.archives.gov/research/catalog/catalog-bulk-downloads/uap-bulk-download";
const defaultPolymarketUrl = "https://polymarket.com/event/trump-declassifies-new-ufo-files-byptptpt-20260710184334563";
const gammaApiUrl = "https://gamma-api.polymarket.com/events";
const userAgent = "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1";
const settingsRefreshMs = 6 * 60 * 60_000;

type UfoFileSource = {
  name: string;
  displayUrl: string;
  fetchUrl: string;
  mode: "html" | "markdown";
};

const sources: UfoFileSource[] = [
  {
    name: "NARA UAP Bulk Downloads",
    displayUrl: "https://www.archives.gov/research/catalog/catalog-bulk-downloads/uap-bulk-download",
    fetchUrl: "https://www.archives.gov/research/catalog/catalog-bulk-downloads/uap-bulk-download",
    mode: "html"
  },
  {
    name: "NARA Record Group 615",
    displayUrl: "https://www.archives.gov/research/topics/uaps/rg-615",
    fetchUrl: "https://www.archives.gov/research/topics/uaps/rg-615",
    mode: "html"
  },
  {
    name: "AARO UAP Records",
    displayUrl: "https://www.aaro.mil/UAP-Records/",
    fetchUrl: "https://r.jina.ai/http://https://www.aaro.mil/UAP-Records/",
    mode: "markdown"
  },
  {
    name: "AARO Official UAP Imagery",
    displayUrl: "https://www.aaro.mil/UAP-Cases/Official-UAP-Imagery/",
    fetchUrl: "https://r.jina.ai/http://https://www.aaro.mil/UAP-Cases/Official-UAP-Imagery/",
    mode: "markdown"
  },
  {
    name: "FBI Vault UFO",
    displayUrl: "https://vault.fbi.gov/UFO",
    fetchUrl: "https://r.jina.ai/http://https://vault.fbi.gov/UFO",
    mode: "markdown"
  }
];

export type UfoFileRecord = {
  source: string;
  title: string;
  url: string;
};

type UfoFilesSettings = {
  deadlines?: string[];
  parsedFromUrl?: string;
  lastParsedAt?: string;
};

type GammaEvent = {
  markets?: GammaMarket[];
};

type GammaMarket = {
  question?: unknown;
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
  endDate?: unknown;
  groupItemTitle?: unknown;
};

export const ufoFilesAdapter: WebsiteAdapter = {
  id: "ufo-files",
  commandName: "ufofiles",
  displayName: "UFO Files",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "ufofiles",
  alertRoleName: "UFO Files Alerts",
  alertRoleEmoji: "\uD83D\uDEF8",
  getPollIntervalMinutes: () => 5,
  getPollIntervalReason: () => "UFO/UAP file monitor: 5-minute checks across official U.S. government sources.",
  shouldAlertOnChange: shouldAlertOnUfoFileChange,
  async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
    const settings = parseUfoFilesSettings(integration.settingsJson);
    const polymarketUrl = integration.polymarketUrl ?? defaultPolymarketUrl;
    if (!options?.force && !shouldRefreshSettings(settings, polymarketUrl)) {
      return JSON.stringify(settings);
    }

    return JSON.stringify(await parseUfoFilesMarket(polymarketUrl));
  },
  async upsertPolymarketMarket(_integration: Integration, url: string): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return { settingsJson: JSON.stringify(await parseUfoFilesMarket(url)), activeUrl: url };
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const settings = parseUfoFilesSettings(integration?.settingsJson ?? null);
    const snapshots = await fetchUfoFileSnapshots();
    const value = formatUfoFilesValue(
      snapshots,
      settings.deadlines ?? [],
      settings.parsedFromUrl ?? integration?.polymarketUrl ?? defaultPolymarketUrl
    );
    return {
      value,
      rawValue: extractFingerprint(value) ?? value,
      unit: "UFO/UAP file inventory",
      observedAt: new Date()
    };
  }
};

export function extractUfoFileRecordsFromHtml(html: string, baseUrl: string, sourceName: string): UfoFileRecord[] {
  const document = cheerio.load(html);
  return dedupeRecords(
    document("a[href]")
      .toArray()
      .map((element) => {
        const link = document(element);
        const href = link.attr("href") ?? "";
        return toUfoFileRecord(href, normalizeText(link.text()), baseUrl, sourceName);
      })
      .filter((record): record is UfoFileRecord => record !== null)
  );
}

export function extractUfoFileRecordsFromMarkdown(markdown: string, baseUrl: string, sourceName: string): UfoFileRecord[] {
  const records: UfoFileRecord[] = [];
  for (const match of markdown.matchAll(/\[([^\]]+)]\((https?:\/\/[^)\s"]+)(?:\s+"[^"]*")?\)/g)) {
    const record = toUfoFileRecord(match[2], normalizeText(match[1]), baseUrl, sourceName);
    if (record) {
      records.push(record);
    }
  }

  for (const match of markdown.matchAll(/https?:\/\/[^\s)]+/g)) {
    const record = toUfoFileRecord(match[0], "", baseUrl, sourceName);
    if (record) {
      records.push(record);
    }
  }

  return dedupeRecords(records);
}

export function buildUfoFilesFingerprint(records: UfoFileRecord[]): string {
  const payload = JSON.stringify(
    [...records]
      .map((record) => ({ source: record.source, title: record.title, url: record.url }))
      .sort((left, right) => left.url.localeCompare(right.url) || left.title.localeCompare(right.title))
  );
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function formatUfoFilesValue(snapshots: Array<{ source: UfoFileSource; records: UfoFileRecord[] }>, deadlines: string[], polymarketUrl: string): string {
  const records = dedupeRecords(snapshots.flatMap((snapshot) => snapshot.records));
  const fingerprint = buildUfoFilesFingerprint(records);
  const sourceLines = snapshots.map((snapshot) => {
    const sourceFingerprint = buildUfoFilesFingerprint(snapshot.records);
    return `${snapshot.source.name}: ${snapshot.records.length} tracked file link(s), fp ${sourceFingerprint}`;
  });
  const sampleRecords = snapshots
    .map((snapshot) => {
      const record = dedupeRecords(snapshot.records)[0];
      return record ? `${snapshot.source.name}: ${formatUfoFileSample(record)}` : `${snapshot.source.name}: none found`;
    })
    .slice(0, 8);

  return [
    "Metric: Official UFO/UAP file inventory",
    `Tracked files: ${records.length}`,
    `Fingerprint: ${fingerprint}`,
    `Polymarket deadlines: ${deadlines.length ? deadlines.join(", ") : "not parsed"}`,
    "Sources:",
    ...sourceLines,
    "Tracked link sample by source (not a diff):",
    ...(sampleRecords.length ? sampleRecords : ["none found"]),
    `Resolution: ${sourceUrl}`,
    `Polymarket: ${polymarketUrl}`
  ].join("\n");
}

export async function parseUfoFilesMarket(polymarketUrl: string, now = new Date()): Promise<UfoFilesSettings> {
  const slug = getPolymarketSlug(polymarketUrl);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${polymarketUrl}`);
  }

  const response = await fetchWithTimeout(`${gammaApiUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: { "user-agent": userAgent }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const events = (await response.json()) as GammaEvent[];
  const deadlines = parseUfoFilesDeadlines(events.flatMap((event) => event.markets ?? []));
  return {
    deadlines,
    parsedFromUrl: polymarketUrl,
    lastParsedAt: now.toISOString()
  };
}

export function parseUfoFilesDeadlines(markets: GammaMarket[]): string[] {
  return uniqueStrings(
    markets
      .filter((market) => market.active !== false && market.closed !== true && market.archived !== true)
      .map((market) => {
        const label =
          (typeof market.groupItemTitle === "string" && market.groupItemTitle.trim()) ||
          parseDeadlineFromQuestion(typeof market.question === "string" ? market.question : "");
        const endDate = typeof market.endDate === "string" ? market.endDate.slice(0, 10) : "";
        if (label && endDate) {
          return `${label} (${endDate})`;
        }
        return label || endDate || null;
      })
      .filter((value): value is string => Boolean(value))
  );
}

function shouldAlertOnUfoFileChange(previousValue: string | null, currentValue: string): boolean {
  const previousFingerprint = extractFingerprint(previousValue);
  const currentFingerprint = extractFingerprint(currentValue);
  return Boolean(currentFingerprint && previousFingerprint && currentFingerprint !== previousFingerprint);
}

async function fetchUfoFileSnapshots(): Promise<Array<{ source: UfoFileSource; records: UfoFileRecord[] }>> {
  const settled = await Promise.allSettled(sources.map(fetchUfoFileSource));
  const failures = settled.map((result) => (result.status === "rejected" ? result.reason : null)).filter(Boolean);
  if (failures.length > 0) {
    throw new Error(`Could not fetch all UFO/UAP file sources: ${failures.map(String).join(" | ")}`);
  }

  return settled.map((result) => {
    if (result.status === "rejected") {
      throw result.reason;
    }
    return result.value;
  });
}

async function fetchUfoFileSource(source: UfoFileSource): Promise<{ source: UfoFileSource; records: UfoFileRecord[] }> {
  const response = await fetchWithTimeout(source.fetchUrl, {
    headers: {
      accept: source.mode === "markdown" ? "text/plain,text/markdown,*/*" : "text/html,application/xhtml+xml",
      "user-agent": userAgent
    }
  });
  if (!response.ok) {
    throw new Error(`${source.name} returned HTTP ${response.status}`);
  }

  const body = await response.text();
  const records =
    source.mode === "markdown"
      ? extractUfoFileRecordsFromMarkdown(body, source.displayUrl, source.name)
      : extractUfoFileRecordsFromHtml(body, source.displayUrl, source.name);
  return { source, records };
}

function toUfoFileRecord(href: string, title: string, baseUrl: string, sourceName: string): UfoFileRecord | null {
  if (!href || href.startsWith("#") || href.startsWith("mailto:")) {
    return null;
  }

  let url: string;
  try {
    url = new URL(href, baseUrl).toString();
  } catch {
    return null;
  }

  if (!isTrackedUfoFileUrl(url)) {
    return null;
  }

  return {
    source: sourceName,
    title: title || inferTitleFromUrl(url),
    url
  };
}

function isTrackedUfoFileUrl(url: string): boolean {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (host === "catalog.archives.gov" && path.startsWith("/id/")) {
    return true;
  }

  if (host === "s3.amazonaws.com" && path.includes("/naraprodstorage/") && path.includes("/uaps/")) {
    return /\.(json|zip|pdf|mp4|mov|csv|xml)$/i.test(path);
  }

  if (host.endsWith("archives.gov") && path.includes("/research/topics/uaps/")) {
    return true;
  }

  if (host.endsWith("aaro.mil") && (path.includes("/pdfs/") || path.includes("/uap-"))) {
    return true;
  }

  if (host === "vault.fbi.gov" && path.toLowerCase().includes("ufo")) {
    return true;
  }

  return /\.(pdf|zip|json|mp4|mov|wmv|docx?|xlsx?|csv|xml)$/i.test(path);
}

function parseUfoFilesSettings(settingsJson: string | null): UfoFilesSettings {
  const settings = parseSettingsJson(settingsJson) as UfoFilesSettings;
  return {
    deadlines: Array.isArray(settings.deadlines) ? settings.deadlines.filter(isNonEmptyString) : undefined,
    parsedFromUrl: typeof settings.parsedFromUrl === "string" ? settings.parsedFromUrl : undefined,
    lastParsedAt: typeof settings.lastParsedAt === "string" ? settings.lastParsedAt : undefined
  };
}

function shouldRefreshSettings(settings: UfoFilesSettings, polymarketUrl: string, now = new Date()): boolean {
  if (settings.parsedFromUrl !== polymarketUrl || !settings.deadlines?.length || !settings.lastParsedAt) {
    return true;
  }

  const lastParsedAt = Date.parse(settings.lastParsedAt);
  return Number.isNaN(lastParsedAt) || now.getTime() - lastParsedAt >= settingsRefreshMs;
}

function parseDeadlineFromQuestion(question: string): string | null {
  return question.match(/\bby\s+([A-Za-z]+\s+\d{1,2})\?/i)?.[1] ?? null;
}

function extractFingerprint(value: string | null): string | null {
  return value?.match(/^Fingerprint:\s*([a-f0-9]+)$/m)?.[1] ?? null;
}

function dedupeRecords(records: UfoFileRecord[]): UfoFileRecord[] {
  const byUrl = new Map<string, UfoFileRecord>();
  for (const record of records) {
    byUrl.set(record.url, record);
  }

  return [...byUrl.values()].sort((left, right) => left.source.localeCompare(right.source) || left.title.localeCompare(right.title) || left.url.localeCompare(right.url));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function inferTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.split("/").filter(Boolean).at(-1) ?? url);
  } catch {
    return url;
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function formatUfoFileSample(record: UfoFileRecord): string {
  const title = record.title || inferTitleFromUrl(record.url);
  return `${truncateText(title, 72)} - ${record.url}`;
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}
