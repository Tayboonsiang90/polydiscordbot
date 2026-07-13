import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import { parseSettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.the-numbers.com";
const renderedSourcePrefix = "https://r.jina.ai/http://";
const gammaEventsUrl = "https://gamma-api.polymarket.com/events";
const gammaSearchUrl = "https://gamma-api.polymarket.com/public-search";
const discoveryIntervalMs = 30 * 60_000;
const staleMarketGraceMs = 30 * 24 * 60 * 60_000;
const requestHeaders = {
  accept: "text/html,application/xhtml+xml,application/json,text/markdown",
  "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
};
const renderedRequestHeaders = {
  accept: "text/markdown,text/plain,*/*",
  "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
};

const defaultPolymarketUrls = [
  "https://polymarket.com/event/toy-story-5-4th-weekend-box-office-20260708231025962",
  "https://polymarket.com/event/minions-monsters-2nd-weekend-box-office-20260708231158488",
  "https://polymarket.com/event/moana-2026-opening-weekend-box-office-20260706135043555",
  "https://polymarket.com/event/evil-dead-burn-opening-weekend-box-office-20260706163531731",
  "https://polymarket.com/event/evil-dead-burn-opening-weekend-box-office-lower-brackets-20260710141402015",
  "https://polymarket.com/event/the-odyssey-opening-weekend-box-office-20260623143428166",
  "https://polymarket.com/event/spider-man-brand-new-day-opening-weekend-box-office-20260618144048824",
  "https://polymarket.com/event/paw-patrol-the-dino-movie-opening-weekend-box-office-20260708164748952"
];

export type BoxOfficeWeekendMarket = {
  url: string;
  slug: string;
  title: string;
  releaseYear: number | null;
  weekendLabel: string;
  startDate: string | null;
  endDate: string | null;
  includePreview: boolean;
  bracketLabels: string[];
  endAt: string | null;
  movieUrl: string | null;
  addedAt: string;
};

export type BoxOfficeDailyRow = {
  date: string;
  rank: string;
  gross: number | null;
  rawGross: string;
};

type BoxOfficeWeekendSettings = {
  markets?: BoxOfficeWeekendMarket[];
  lastBoxOfficeDiscoveryAt?: string;
};

type GammaEvent = {
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
  tags?: Array<{ slug?: unknown; label?: unknown }>;
  markets?: GammaMarket[];
};

type GammaMarket = {
  question?: unknown;
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
  groupItemTitle?: unknown;
  outcomePrices?: unknown;
};

type GammaSearchResponse = {
  events?: GammaEvent[];
};

type WeekendSnapshot = {
  market: BoxOfficeWeekendMarket;
  sourceUrl: string;
  totalGross: number | null;
  status: "pending" | "partial" | "complete" | "error";
  reportedWindowDays: number;
  expectedWindowDays: number;
  previewGross: number | null;
  rows: BoxOfficeDailyRow[];
  currentBracket: string | null;
  error?: string;
};

export const boxOfficeWeekendsAdapter: WebsiteAdapter = {
  id: "box-office-weekends",
  commandName: "boxoffice",
  displayName: "Box Office Weekends",
  sourceUrl,
  defaultPolymarketUrl: defaultPolymarketUrls[0],
  defaultChannelName: "boxoffice",
  alertRoleName: "Box Office Alerts",
  alertRoleEmoji: "🎬",
  getPollIntervalMinutes: () => 5,
  getPollIntervalReason: () =>
    "5-minute The Numbers polling; alerts only when a tracked weekend market becomes complete and bondable, or its complete bracket changes.",
  getErrorNoticeWindowMinutes: () => 30,
  shouldAlertOnChange: shouldAlertOnBoxOfficeStateChange,
  async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
    return (
      await refreshBoxOfficeWeekendMarkets(integration, new Date(), {
        force: options?.force ?? false
      })
    ).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async upsertPolymarketMarket(integration: Integration, url: string): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertBoxOfficeWeekendMarket(integration, url);
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const settings = parseBoxOfficeWeekendSettings(integration?.settingsJson ?? null);
    const markets = getCurrentBoxOfficeWeekendMarkets(settings.markets ?? [], new Date());
    const snapshots = await Promise.all(markets.map(fetchWeekendSnapshot));
    const previousBondable = extractBoxOfficeBondableMap(integration?.lastValue ?? null);
    const value = formatBoxOfficeWeekendValue(snapshots, previousBondable);
    return {
      value,
      rawValue: value,
      unit: "domestic weekend box office",
      observedAt: new Date()
    };
  }
};

export async function refreshBoxOfficeWeekendMarkets(
  integration: Integration,
  now = new Date(),
  options: { force?: boolean } = {}
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  let settings = parseBoxOfficeWeekendSettings(integration.settingsJson);
  let markets = settings.markets ?? [];
  const seedUrls = markets.length === 0 ? [...defaultPolymarketUrls, integration.polymarketUrl] : [integration.polymarketUrl];

  for (const url of seedUrls.filter(isNonEmptyString)) {
    if (!markets.some((market) => market.url === url)) {
      const market = await fetchBoxOfficeWeekendMarketByUrl(url, now).catch(() => buildFallbackBoxOfficeWeekendMarket(url, now));
      if (market) {
        markets = upsertBoxOfficeWeekendMarketRecord(markets, market);
      }
    }
  }

  if (options.force || isDiscoveryDue(settings.lastBoxOfficeDiscoveryAt, now)) {
    settings = { ...settings, lastBoxOfficeDiscoveryAt: now.toISOString() };
    for (const market of await fetchBoxOfficeWeekendMarketSearchCandidates(now).catch(() => [])) {
      markets = upsertBoxOfficeWeekendMarketRecord(markets, market);
    }
  }

  markets = pruneBoxOfficeWeekendMarkets(markets, now);
  return {
    settingsJson: JSON.stringify({ ...settings, markets }),
    activeUrl: selectPrimaryBoxOfficeWeekendMarket(markets, now)?.url ?? integration.polymarketUrl
  };
}

export async function upsertBoxOfficeWeekendMarket(
  integration: Integration,
  url: string,
  now = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  const settings = parseBoxOfficeWeekendSettings(integration.settingsJson);
  const market = (await fetchBoxOfficeWeekendMarketByUrl(url, now).catch(() => null)) ?? buildFallbackBoxOfficeWeekendMarket(url, now);
  if (!market) {
    throw new Error(`Could not parse Box Office Polymarket URL: ${url}`);
  }

  const markets = pruneBoxOfficeWeekendMarkets(upsertBoxOfficeWeekendMarketRecord(settings.markets ?? [], market), now);
  return {
    settingsJson: JSON.stringify({ ...settings, markets }),
    activeUrl: selectPrimaryBoxOfficeWeekendMarket(markets, now)?.url ?? url
  };
}

export function normalizeBoxOfficeGammaEvent(event: GammaEvent, now = new Date()): BoxOfficeWeekendMarket | null {
  if (
    event.active === false ||
    event.closed === true ||
    event.archived === true ||
    !isNonEmptyString(event.slug) ||
    !isNonEmptyString(event.title) ||
    !isBoxOfficeWeekendEvent(event)
  ) {
    return null;
  }

  const parsedTitle = parseBoxOfficeMovieTitle(event.title);
  if (!parsedTitle) {
    return null;
  }

  const description = isNonEmptyString(event.description) ? event.description : "";
  const endAt = parseGammaDate(event.endDate)?.toISOString() ?? null;
  const weekendWindow = parseWeekendWindow(description, endAt);
  const releaseYear = parsedTitle.releaseYear ?? parseReleaseYear(description) ?? parseYearFromDate(endAt);
  const title = parsedTitle.title;
  return {
    url: `https://polymarket.com/event/${event.slug}`,
    slug: event.slug,
    title,
    releaseYear,
    weekendLabel: parseWeekendLabel(event.title),
    startDate: weekendWindow?.startDate ?? null,
    endDate: weekendWindow?.endDate ?? null,
    includePreview: /opening weekend/i.test(event.title),
    bracketLabels: parseBoxOfficeBracketLabels(event.markets ?? []),
    endAt,
    movieUrl: buildTheNumbersMovieUrlCandidates(title, releaseYear)[0] ?? null,
    addedAt: (parseGammaDate(event.startDate) ?? parseGammaDate(event.creationDate) ?? parseGammaDate(event.createdAt) ?? now).toISOString()
  };
}

export function parseDailyBoxOfficeRows(markdown: string): BoxOfficeDailyRow[] {
  const rows = parseMarkdownTable(markdown, "Daily Box Office Performance");
  return rows.flatMap((row) => {
    const date = parseTheNumbersDate(row.Date);
    if (!date) {
      return [];
    }

    return [
      {
        date,
        rank: normalizeText(row.Rank ?? ""),
        gross: parseDollarAmount(row.Gross),
        rawGross: normalizeText(row.Gross ?? "")
      }
    ];
  });
}

export function formatBoxOfficeWeekendValue(snapshots: WeekendSnapshot[], previousBondable = new Map<string, string>()): string {
  const lines = [
    "Metric: The Numbers domestic weekend box office",
    `Tracked active markets: ${snapshots.length}`,
    "Alert rule: alerts only when a market becomes complete and bondable, or its complete bracket changes.",
    "Data rule: Daily rows; opening weekends include preview row when present.",
    "Movies:"
  ];

  if (snapshots.length === 0) {
    lines.push("none");
  }

  for (const snapshot of snapshots) {
    lines.push(formatWeekendSnapshotLine(snapshot, previousBondable));
  }

  lines.push(`Bondable: ${formatBoxOfficeBondableState(snapshots, previousBondable)}`);
  lines.push(`State: ${formatBoxOfficeState(snapshots)}`);
  lines.push(`Resolution: ${sourceUrl}`);
  return lines.join("\n");
}

export function shouldAlertOnBoxOfficeStateChange(previousValue: string | null, currentValue: string): boolean {
  if (!previousValue) {
    return false;
  }

  const previousBondable = extractBoxOfficeBondableMap(previousValue);
  const currentBondable = extractBoxOfficeBondableMap(currentValue);
  const previousState = extractBoxOfficeStateMap(previousValue);
  for (const [key, value] of currentBondable) {
    const previousValueForKey = previousBondable.get(key);
    if (previousValueForKey === value) {
      continue;
    }

    if (!previousBondable.has(key) && isCompleteBoxOfficeState(previousState.get(key))) {
      continue;
    }

    if (previousValueForKey !== value) {
      return true;
    }
  }

  return false;
}

export function extractBoxOfficeBondableMap(value: string | null): Map<string, string> {
  const bondable = new Map<string, string>();
  if (!value) {
    return bondable;
  }

  for (const match of value.matchAll(/^Bondable:\s*(.+)$/gm)) {
    if (match[1].trim() === "none") {
      continue;
    }
    for (const entry of match[1].split(";")) {
      const [key, stateValue] = entry.split("=").map((part) => part.trim());
      if (key && stateValue) {
        bondable.set(key, stateValue);
      }
    }
  }
  return bondable;
}

export function extractBoxOfficeStateMap(value: string | null): Map<string, string> {
  const state = new Map<string, string>();
  if (!value) {
    return state;
  }

  for (const match of value.matchAll(/^State:\s*(.+)$/gm)) {
    for (const entry of match[1].split(";")) {
      const [key, stateValue] = entry.split("=").map((part) => part.trim());
      if (key && stateValue) {
        state.set(key, stateValue);
      }
    }
  }
  return state;
}

async function fetchWeekendSnapshot(market: BoxOfficeWeekendMarket): Promise<WeekendSnapshot> {
  try {
    const page = await fetchTheNumbersMovieMarkdown(market);
    const rows = parseDailyBoxOfficeRows(page.markdown);
    const snapshot = buildWeekendSnapshot(market, rows, page.url);
    return snapshot;
  } catch (error) {
    return {
      market,
      sourceUrl: market.movieUrl ?? sourceUrl,
      totalGross: null,
      status: "error",
      reportedWindowDays: 0,
      expectedWindowDays: countInclusiveDates(market.startDate, market.endDate),
      previewGross: null,
      rows: [],
      currentBracket: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function buildWeekendSnapshot(
  market: BoxOfficeWeekendMarket,
  rows: BoxOfficeDailyRow[],
  sourceMovieUrl: string
): WeekendSnapshot {
  const expectedWindowDays = countInclusiveDates(market.startDate, market.endDate);
  const windowRows = rows.filter((row) => isDateInRange(row.date, market.startDate, market.endDate));
  const startDate = market.startDate;
  const previewRow =
    market.includePreview && startDate
      ? rows.find((row) => row.date === addDays(startDate, -1) && row.rank.toUpperCase() === "P")
      : undefined;
  const includedRows = [...(previewRow ? [previewRow] : []), ...windowRows];
  const totalGross = includedRows.reduce((sum, row) => sum + (row.gross ?? 0), 0);
  const status =
    includedRows.length === 0 || totalGross <= 0
      ? "pending"
      : windowRows.length >= expectedWindowDays
        ? "complete"
        : "partial";

  return {
    market,
    sourceUrl: sourceMovieUrl,
    totalGross: status === "pending" ? null : totalGross,
    status,
    reportedWindowDays: windowRows.length,
    expectedWindowDays,
    previewGross: previewRow?.gross ?? null,
    rows: includedRows,
    currentBracket: status === "pending" ? null : findCurrentBracketLabel(totalGross, market.bracketLabels)
  };
}

async function fetchTheNumbersMovieMarkdown(market: BoxOfficeWeekendMarket): Promise<{ markdown: string; url: string }> {
  const candidates = uniqueStrings([
    market.movieUrl,
    ...buildTheNumbersMovieUrlCandidates(market.title, market.releaseYear)
  ].filter(isNonEmptyString));

  const errors: string[] = [];
  for (const url of candidates) {
    const renderedUrl = `${renderedSourcePrefix}${url}`;
    const response = await fetchWithTimeout(renderedUrl, { headers: renderedRequestHeaders }, 30_000);
    if (!response.ok) {
      errors.push(`${url} HTTP ${response.status}`);
      continue;
    }

    const markdown = await response.text();
    if (isValidTheNumbersMoviePage(markdown)) {
      return { markdown, url };
    }
    errors.push(`${url} did not render a movie box-office page`);
  }

  throw new Error(`Could not fetch The Numbers page for ${market.title}: ${errors.join("; ") || "no candidates"}`);
}

async function fetchBoxOfficeWeekendMarketSearchCandidates(now: Date): Promise<BoxOfficeWeekendMarket[]> {
  const searchUrl = new URL(gammaSearchUrl);
  searchUrl.searchParams.set("q", "weekend box office");
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "50");
  searchUrl.searchParams.append("events_tag", "box-office");

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: requestHeaders
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  const candidates: BoxOfficeWeekendMarket[] = [];
  for (const event of payload.events ?? []) {
    const normalized = normalizeBoxOfficeGammaEvent(event, now);
    if (!normalized) {
      continue;
    }

    candidates.push((await fetchBoxOfficeWeekendMarketByUrl(normalized.url, now).catch(() => null)) ?? normalized);
  }

  return candidates;
}

async function fetchBoxOfficeWeekendMarketByUrl(url: string, now: Date): Promise<BoxOfficeWeekendMarket | null> {
  const slug = getPolymarketSlug(url);
  if (!slug) {
    return null;
  }

  const response = await fetchWithTimeout(`${gammaEventsUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: requestHeaders
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const events = (await response.json()) as GammaEvent[];
  return normalizeBoxOfficeGammaEvent(events[0] ?? {}, now);
}

function formatWeekendSnapshotLine(snapshot: WeekendSnapshot, previousBondable: Map<string, string>): string {
  const market = snapshot.market;
  const key = shortStateKey(market.slug);
  const previousActionable = previousBondable.get(key);
  const amountStatus =
    snapshot.status === "error" && previousActionable
      ? `fetch failed, kept bondable ${previousActionable}`
      : snapshot.totalGross === null
        ? snapshot.status
        : `${formatMillions(snapshot.totalGross)} ${snapshot.status}`;
  const dates = market.startDate && market.endDate ? `${shortDate(market.startDate)}-${shortDate(market.endDate)}` : "dates ?";
  const preview = snapshot.previewGross !== null ? ` + P ${formatMillions(snapshot.previewGross)}` : "";
  const bracket = snapshot.currentBracket ? `, bracket ${snapshot.currentBracket}` : "";
  return [
    "-",
    `${compactMovieLabel(market)}:`,
    amountStatus,
    `(${snapshot.reportedWindowDays}/${snapshot.expectedWindowDays} days${preview})`,
    `${dates}${bracket}`
  ].join(" ");
}

function formatBoxOfficeBondableState(snapshots: WeekendSnapshot[], previousBondable: Map<string, string>): string {
  const entries = snapshots.flatMap((snapshot) => {
    const key = shortStateKey(snapshot.market.slug);
    const currentBondable = getBoxOfficeBondableValue(snapshot);
    const previousActionable = previousBondable.get(key);
    if (currentBondable) {
      return [`${key}=${currentBondable}`];
    }
    if (snapshot.status === "error" && previousActionable) {
      return [`${key}=${previousActionable}`];
    }
    return [];
  });
  return entries.length ? entries.join("; ") : "none";
}

function getBoxOfficeBondableValue(snapshot: WeekendSnapshot): string | null {
  if (snapshot.status !== "complete" || snapshot.totalGross === null) {
    return null;
  }
  return snapshot.currentBracket ?? `complete:${snapshot.totalGross}`;
}

function formatBoxOfficeState(snapshots: WeekendSnapshot[]): string {
  return snapshots
    .map((snapshot) => {
      const key = shortStateKey(snapshot.market.slug);
      const value =
        snapshot.totalGross === null
          ? snapshot.status
          : `${snapshot.totalGross}:${snapshot.reportedWindowDays}:${snapshot.status}`;
      return `${key}=${value}`;
    })
    .join("; ");
}

function isCompleteBoxOfficeState(value: string | undefined): boolean {
  return Boolean(value && value.split(":")[2] === "complete");
}

function parseMarkdownTable(markdown: string, sectionTitle: string): Array<Record<string, string>> {
  const sectionIndex = markdown.indexOf(`## ${sectionTitle}`);
  if (sectionIndex < 0) {
    return [];
  }

  const nextSectionIndex = markdown.indexOf("\n## ", sectionIndex + sectionTitle.length + 3);
  const section = markdown.slice(sectionIndex, nextSectionIndex >= 0 ? nextSectionIndex : undefined);
  const tableLines = section.split(/\r?\n/).filter((line) => line.trim().startsWith("|"));
  if (tableLines.length < 3) {
    return [];
  }

  const headers = splitMarkdownTableRow(tableLines[0]);
  return tableLines.slice(2).flatMap((line) => {
    const cells = splitMarkdownTableRow(line);
    if (cells.length < headers.length) {
      return [];
    }

    return [
      Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))
    ];
  });
}

function splitMarkdownTableRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => normalizeText(cell));
}

function parseBoxOfficeMovieTitle(value: unknown): { title: string; releaseYear: number | null } | null {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const normalized = normalizeText(value);
  const quoted = normalized.match(/[“"](.+?)[”"]\s+[\w\d]+.*Weekend Box Office/i)?.[1];
  const unquoted = normalized.match(/^(.+?)\s+[\w\d]+.*Weekend Box Office/i)?.[1];
  const rawTitle = quoted ?? unquoted;
  if (!rawTitle) {
    return null;
  }

  const year = rawTitle.match(/\((20\d{2})\)/)?.[1];
  return {
    title: normalizeText(rawTitle.replace(/\((20\d{2})\)/, "")),
    releaseYear: year ? Number(year) : null
  };
}

function parseWeekendLabel(value: unknown): string {
  if (!isNonEmptyString(value)) {
    return "weekend";
  }

  const opening = value.match(/\bOpening Weekend\b/i);
  if (opening) {
    return "opening";
  }

  const numbered = value.match(/\b(\d+)(st|nd|rd|th)\s+Weekend\b/i);
  return numbered ? `${numbered[1]}${numbered[2].toLowerCase()}` : "weekend";
}

function parseWeekendWindow(description: string, endAt: string | null): { startDate: string; endDate: string } | null {
  const match = description.match(/\b3-day(?:\s+opening)?\s+weekend\s*\(([^)]+?)\s*-\s*([^)]+?)\)/i);
  if (!match) {
    return null;
  }

  const endYear = parseYearFromDate(endAt) ?? new Date().getUTCFullYear();
  const start = parseMonthDay(match[1], null, endYear);
  const end = parseMonthDay(match[2], start?.month ?? null, endYear);
  if (!start || !end) {
    return null;
  }

  return {
    startDate: toIsoDate(start.year, start.month, start.day),
    endDate: toIsoDate(end.year, end.month, end.day)
  };
}

function parseMonthDay(value: string, fallbackMonth: number | null, year: number): { year: number; month: number; day: number } | null {
  const match = normalizeText(value).match(/^([A-Za-z]+)?\s*(\d{1,2})$/);
  if (!match) {
    return null;
  }

  const month = monthNumber(match[1]) ?? fallbackMonth;
  const day = Number(match[2]);
  if (!month || !Number.isInteger(day) || day < 1 || day > 31) {
    return null;
  }

  return { year, month, day };
}

function parseTheNumbersDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/([A-Za-z]{3,9})\s+(\d{1,2}),\s*(20\d{2})/);
  if (!match) {
    return null;
  }

  const month = monthNumber(match[1]);
  return month ? toIsoDate(Number(match[3]), month, Number(match[2])) : null;
}

function parseBoxOfficeBracketLabels(markets: GammaMarket[]): string[] {
  return markets
    .filter(isOpenMarket)
    .map((market) => normalizeText(String(market.groupItemTitle ?? "")))
    .filter(isNonEmptyString);
}

function parseReleaseYear(description: string): number | null {
  const match = description.match(/\((20\d{2})\)/);
  return match ? Number(match[1]) : null;
}

function parseDollarAmount(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/\$([0-9,]+)/);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function findCurrentBracketLabel(value: number, bracketLabels: string[]): string | null {
  for (const label of bracketLabels) {
    if (isValueInBracket(value, label)) {
      return label;
    }
  }
  return null;
}

function isValueInBracket(value: number, label: string): boolean {
  const millions = value / 1_000_000;
  const lessThan = label.match(/^<\s*(\d+(?:\.\d+)?)m?$/i);
  if (lessThan) {
    return millions < Number(lessThan[1]);
  }

  const greaterThan = label.match(/^(?:>|\+|at least)\s*(\d+(?:\.\d+)?)m?\+?$/i);
  if (greaterThan) {
    return millions >= Number(greaterThan[1]);
  }

  const plus = label.match(/^(\d+(?:\.\d+)?)m?\+$/i);
  if (plus) {
    return millions >= Number(plus[1]);
  }

  const range = label.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)m?$/i);
  if (range) {
    return millions >= Number(range[1]) && millions < Number(range[2]);
  }

  return false;
}

function buildTheNumbersMovieUrlCandidates(title: string, releaseYear: number | null): string[] {
  const suffix = releaseYear ? `-%28${releaseYear}%29` : "";
  const slug = slugifyTheNumbersTitle(title);
  const articleMoved = moveLeadingArticleToEnd(title);
  return uniqueStrings([
    `${sourceUrl}/movie/${slug}${suffix}`,
    ...(articleMoved ? [`${sourceUrl}/movie/${slugifyTheNumbersTitle(articleMoved)}${suffix}`] : [])
  ]);
}

function slugifyTheNumbersTitle(title: string): string {
  return normalizeText(title)
    .replace(/&/g, "and")
    .replace(/[’']/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function moveLeadingArticleToEnd(title: string): string | null {
  const match = normalizeText(title).match(/^(The|A|An)\s+(.+)$/i);
  return match ? `${match[2]}-${capitalizeWord(match[1].toLowerCase())}` : null;
}

function buildFallbackBoxOfficeWeekendMarket(url: string, now: Date): BoxOfficeWeekendMarket | null {
  const slug = getPolymarketSlug(url);
  if (!slug || !slug.includes("weekend-box-office")) {
    return null;
  }

  const title = slug
    .replace(/-opening-weekend-box-office.*$/i, "")
    .replace(/-\d+(st|nd|rd|th)-weekend-box-office.*$/i, "")
    .split("-")
    .map(capitalizeWord)
    .join(" ");
  const releaseYear = parseYearFromDate(now.toISOString());
  return {
    url,
    slug,
    title,
    releaseYear,
    weekendLabel: slug.includes("opening-weekend") ? "opening" : "weekend",
    startDate: null,
    endDate: null,
    includePreview: slug.includes("opening-weekend"),
    bracketLabels: [],
    endAt: null,
    movieUrl: buildTheNumbersMovieUrlCandidates(title, releaseYear)[0] ?? null,
    addedAt: now.toISOString()
  };
}

function parseBoxOfficeWeekendSettings(settingsJson: string | null): BoxOfficeWeekendSettings {
  const settings = parseSettingsJson(settingsJson) as BoxOfficeWeekendSettings;
  return {
    ...settings,
    markets: normalizeBoxOfficeWeekendMarkets(settings.markets),
    lastBoxOfficeDiscoveryAt:
      typeof settings.lastBoxOfficeDiscoveryAt === "string" ? settings.lastBoxOfficeDiscoveryAt : undefined
  };
}

function normalizeBoxOfficeWeekendMarkets(value: unknown): BoxOfficeWeekendMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const market = item as Partial<BoxOfficeWeekendMarket>;
    if (!isNonEmptyString(market.url) || !isNonEmptyString(market.slug) || !isNonEmptyString(market.title)) {
      return [];
    }

    return [
      {
        url: market.url,
        slug: market.slug,
        title: market.title,
        releaseYear: typeof market.releaseYear === "number" && Number.isInteger(market.releaseYear) ? market.releaseYear : null,
        weekendLabel: isNonEmptyString(market.weekendLabel) ? market.weekendLabel : "weekend",
        startDate: typeof market.startDate === "string" ? market.startDate : null,
        endDate: typeof market.endDate === "string" ? market.endDate : null,
        includePreview: market.includePreview === true,
        bracketLabels: Array.isArray(market.bracketLabels) ? market.bracketLabels.filter(isNonEmptyString) : [],
        endAt: typeof market.endAt === "string" ? market.endAt : null,
        movieUrl: typeof market.movieUrl === "string" ? market.movieUrl : null,
        addedAt: typeof market.addedAt === "string" ? market.addedAt : new Date(0).toISOString()
      }
    ];
  }).sort(compareBoxOfficeWeekendMarkets);
}

function upsertBoxOfficeWeekendMarketRecord(markets: BoxOfficeWeekendMarket[], market: BoxOfficeWeekendMarket): BoxOfficeWeekendMarket[] {
  const existingIndex = markets.findIndex((candidate) => candidate.slug === market.slug);
  const nextMarkets = [...markets];
  if (existingIndex === -1) {
    nextMarkets.push(market);
  } else {
    const existing = nextMarkets[existingIndex];
    nextMarkets[existingIndex] = {
      ...existing,
      ...market,
      releaseYear: market.releaseYear ?? existing.releaseYear,
      startDate: market.startDate ?? existing.startDate,
      endDate: market.endDate ?? existing.endDate,
      endAt: market.endAt ?? existing.endAt,
      movieUrl: market.movieUrl ?? existing.movieUrl,
      bracketLabels: uniqueStrings([...(existing.bracketLabels ?? []), ...(market.bracketLabels ?? [])]),
      addedAt: existing.addedAt
    };
  }

  return nextMarkets.sort(compareBoxOfficeWeekendMarkets);
}

function getCurrentBoxOfficeWeekendMarkets(markets: BoxOfficeWeekendMarket[], now: Date): BoxOfficeWeekendMarket[] {
  return pruneBoxOfficeWeekendMarkets(markets, now)
    .filter((market) => !isMarketExpired(market, now))
    .sort(compareBoxOfficeWeekendMarkets);
}

function pruneBoxOfficeWeekendMarkets(markets: BoxOfficeWeekendMarket[], now: Date): BoxOfficeWeekendMarket[] {
  return markets
    .filter((market) => !isMarketExpired(market, now, staleMarketGraceMs))
    .sort(compareBoxOfficeWeekendMarkets);
}

function isMarketExpired(market: BoxOfficeWeekendMarket, now: Date, graceMs = 0): boolean {
  const deadline = market.endAt ?? market.endDate;
  return Boolean(deadline && Date.parse(deadline) + graceMs < now.getTime());
}

function selectPrimaryBoxOfficeWeekendMarket(markets: BoxOfficeWeekendMarket[], now: Date): BoxOfficeWeekendMarket | null {
  return getCurrentBoxOfficeWeekendMarkets(markets, now)[0] ?? markets[0] ?? null;
}

function compareBoxOfficeWeekendMarkets(left: BoxOfficeWeekendMarket, right: BoxOfficeWeekendMarket): number {
  const leftTime = left.startDate ? Date.parse(left.startDate) : Date.parse(left.endAt ?? "") || Number.MAX_SAFE_INTEGER;
  const rightTime = right.startDate ? Date.parse(right.startDate) : Date.parse(right.endAt ?? "") || Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime || left.title.localeCompare(right.title) || left.slug.localeCompare(right.slug);
}

function isBoxOfficeWeekendEvent(event: GammaEvent): boolean {
  const title = isNonEmptyString(event.title) ? event.title.toLowerCase() : "";
  const tagSlugs = new Set((event.tags ?? []).map((tag) => tag.slug).filter(isNonEmptyString));
  return title.includes("weekend box office") && (tagSlugs.has("box-office") || tagSlugs.has("movies"));
}

function isOpenMarket(market: GammaMarket): boolean {
  return market.active !== false && market.closed !== true && market.archived !== true && !isResolvedOutcomePrices(market.outcomePrices);
}

function isResolvedOutcomePrices(value: unknown): boolean {
  const prices = typeof value === "string" ? parseJsonArray(value) : Array.isArray(value) ? value : [];
  return prices.some((price) => Number(price) >= 0.999);
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isDiscoveryDue(lastDiscoveryAt: string | undefined, now: Date): boolean {
  if (!lastDiscoveryAt) {
    return true;
  }

  const lastDiscoveryMs = Date.parse(lastDiscoveryAt);
  return Number.isNaN(lastDiscoveryMs) || now.getTime() - lastDiscoveryMs >= discoveryIntervalMs;
}

function isValidTheNumbersMoviePage(markdown: string): boolean {
  return markdown.includes("Box Office and Financial Information");
}

function isDateInRange(date: string, startDate: string | null, endDate: string | null): boolean {
  if (!startDate || !endDate) {
    return false;
  }

  return date >= startDate && date <= endDate;
}

function countInclusiveDates(startDate: string | null, endDate: string | null): number {
  if (!startDate || !endDate) {
    return 0;
  }

  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return 0;
  }

  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function parseGammaDate(value: unknown): Date | null {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseYearFromDate(value: string | null): number | null {
  const year = value?.match(/\b(20\d{2})\b/)?.[1];
  return year ? Number(year) : null;
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${padNumber(month)}-${padNumber(day)}`;
}

function shortDate(date: string): string {
  return date.slice(5);
}

function shortStateKey(slug: string): string {
  let hash = 0;
  for (let index = 0; index < slug.length; index += 1) {
    hash = (hash * 31 + slug.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36).slice(0, 6);
}

function compactMovieLabel(market: BoxOfficeWeekendMarket): string {
  const suffix = market.weekendLabel === "opening" ? "OW" : `${market.weekendLabel} wknd`;
  return `${market.title}${market.releaseYear ? ` ${market.releaseYear}` : ""} ${suffix}`;
}

function formatMillions(value: number): string {
  return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
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

function capitalizeWord(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter(isNonEmptyString))];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
