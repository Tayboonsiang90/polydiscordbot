import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://claude-commits.polymarket.com/";
const apiDataUrl = "https://claude-commits.polymarket.com/api/data";
const gammaApiUrl = "https://gamma-api.polymarket.com/events";
const githubCommitSearchUrl = "https://api.github.com/search/commits";
const defaultPolymarketUrl = "https://polymarket.com/event/claude-code-commits-end-of-june";
const rollingAverageDays = 7;
const defaultGithubAlphaQuery = "\"Co-Authored-By: Claude\"";

export type ClaudeAverageRow = {
  date: string;
  commits: number;
  githubTotalCount: number | null;
  claudePctOfGithub: number | null;
  marketSharePct: number | null;
};

export type ClaudeAverageBracket = {
  label: string;
  min: number | null;
  max: number | null;
};

export type ClaudeGithubAlpha = {
  status: "available";
  query: string;
  dayStartUtc: string;
  checkedAtUtc: string;
  daySoFarCount: number;
  previousHourStartUtc: string;
  previousHourEndUtc: string;
  previousHourCount: number;
  dailyizedRunRate: number;
  incompleteResults: boolean;
};

export type ClaudeGithubAlphaUnavailable = {
  status: "unavailable";
  query: string;
  reason: string;
};

export type ClaudeGithubAlphaResult = ClaudeGithubAlpha | ClaudeGithubAlphaUnavailable;

type GammaEvent = {
  endDate?: string;
  markets?: GammaMarket[];
};

type GammaMarket = {
  active?: boolean;
  archived?: boolean;
  closed?: boolean;
  question?: string;
  groupItemTitle?: string;
};

export const claudeCodeCommitsAverageAdapter: WebsiteAdapter = {
  id: "claude-code-commits-average",
  commandName: "claudeavg",
  displayName: "Claude Code 7D Avg",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "claudeavg",
  alertRoleName: "Claude Avg Alerts",
  alertRoleEmoji: "\uD83D\uDCC8",
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Fixed hourly check for Claude Code 7D Avg Commits updates",
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const observedAt = new Date();
    const polymarketUrl = integration?.polymarketUrl ?? defaultPolymarketUrl;
    const [rows, market, githubAlpha] = await Promise.all([
      fetchClaudeAverageRows(),
      fetchClaudeAverageMarket(polymarketUrl),
      fetchClaudeGithubAlphaSafe(observedAt)
    ]);
    const value = formatClaudeAverageValue({
      rows,
      brackets: market.brackets,
      sourceUrl,
      polymarketUrl,
      resolutionDate: market.resolutionDate,
      githubAlpha
    });

    return {
      value,
      rawValue: buildClaudeAverageRawValue(rows),
      unit: "7D Avg Commits",
      observedAt
    };
  }
};

export function extractClaudeAverageRows(payload: unknown): ClaudeAverageRow[] {
  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  return data
    .filter(isRecord)
    .map((row) => {
      const date = formatSourceDate(row.date);
      const commits = parseNumber(row.claude_code_count);
      if (!date || commits === null) {
        return null;
      }

      return {
        date,
        commits,
        githubTotalCount: parseNumber(row.github_total_count),
        claudePctOfGithub: parseNumber(row.claude_pct_of_github),
        marketSharePct: parseNumber(row.market_share_pct)
      };
    })
    .filter((row): row is ClaudeAverageRow => row !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function extractClaudeAverageBracketsFromGamma(data: unknown): { brackets: ClaudeAverageBracket[]; resolutionDate: string } {
  const event = Array.isArray(data) ? (data[0] as GammaEvent | undefined) : (data as GammaEvent | undefined);
  const brackets = (event?.markets ?? [])
    .filter((market) => !isResolvedGammaMarket(market))
    .map(extractClaudeAverageBracket)
    .filter((bracket): bracket is ClaudeAverageBracket => bracket !== null)
    .sort(compareBrackets);

  return {
    brackets,
    resolutionDate: formatSourceDate(event?.endDate) ?? "2026-06-30"
  };
}

export function formatClaudeAverageValue(input: {
  rows: ClaudeAverageRow[];
  brackets: ClaudeAverageBracket[];
  sourceUrl: string;
  polymarketUrl: string;
  resolutionDate: string;
  githubAlpha?: ClaudeGithubAlphaResult;
}): string {
  const latest = input.rows.at(-1) ?? null;
  const previous = input.rows.length > 1 ? input.rows.at(-2) ?? null : null;
  const periodHigh = maxRow(input.rows);
  const rollingAverage = getRollingAverage(input.rows);
  const finalWindow = getFinalWindow(input.resolutionDate);
  const knownFinalRows = input.rows.filter((row) => finalWindow.includes(row.date));
  const knownFinalSum = knownFinalRows.reduce((sum, row) => sum + row.commits, 0);
  const remainingFinalDays = rollingAverageDays - knownFinalRows.length;
  const worstCaseAverage = knownFinalSum / rollingAverageDays;
  const likelyBracket = rollingAverage === null ? null : findBracket(input.brackets, rollingAverage);

  return [
    "Metric: Claude Code 7D Avg Commits",
    `Latest date: ${latest?.date ?? "not available"}`,
    `Latest day: ${latest ? formatCompact(latest.commits) : "not available"}`,
    `Day-over-day: ${formatDayOverDay(latest, previous)}`,
    `% of GitHub: ${latest?.claudePctOfGithub === null || latest?.claudePctOfGithub === undefined ? "not available" : `${formatDecimal(latest.claudePctOfGithub)}%`}`,
    `AI share: ${latest?.marketSharePct === null || latest?.marketSharePct === undefined ? "not available" : `${formatDecimal(latest.marketSharePct)}%`}`,
    `Period high: ${periodHigh ? `${formatCompact(periodHigh.commits)} on ${periodHigh.date}` : "not available"}`,
    `7D Avg: ${rollingAverage === null ? "not available" : formatCompact(rollingAverage)}`,
    `Current bracket by latest 7D avg: ${likelyBracket?.label ?? "not available"}`,
    `Resolution date: ${input.resolutionDate}`,
    `Final 7D window: ${finalWindow[0]} to ${finalWindow.at(-1)}`,
    `Known final-window days: ${knownFinalRows.length}/${rollingAverageDays}`,
    `Worst-case final 7D avg if unknown final-window days are 0: ${formatCompact(worstCaseAverage)}`,
    "Remaining-day averages needed:",
    formatNeededAverages(input.brackets, knownFinalSum, remainingFinalDays),
    ...formatClaudeGithubAlphaLines(input.githubAlpha),
    `Resolution: ${input.sourceUrl}`,
    `Polymarket: ${input.polymarketUrl}`
  ].join("\n");
}

export async function fetchClaudeGithubAlphaSafe(now = new Date()): Promise<ClaudeGithubAlphaResult> {
  const query = getClaudeGithubAlphaQuery();
  try {
    return await fetchClaudeGithubAlpha(now, query);
  } catch (error) {
    return {
      status: "unavailable",
      query,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function fetchClaudeGithubAlpha(now: Date, query = getClaudeGithubAlphaQuery()): Promise<ClaudeGithubAlpha> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const currentHourStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 0, 0));
  const previousHourStart = new Date(currentHourStart.getTime() - 60 * 60_000);
  const [daySoFar, previousHour] = await Promise.all([
    fetchGithubCommitSearchCount(query, dayStart, now),
    fetchGithubCommitSearchCount(query, previousHourStart, currentHourStart)
  ]);
  const elapsedHours = Math.max((now.getTime() - dayStart.getTime()) / (60 * 60_000), 1 / 60);

  return {
    status: "available",
    query,
    dayStartUtc: formatUtcMinute(dayStart),
    checkedAtUtc: formatUtcMinute(now),
    daySoFarCount: daySoFar.count,
    previousHourStartUtc: formatUtcMinute(previousHourStart),
    previousHourEndUtc: formatUtcMinute(currentHourStart),
    previousHourCount: previousHour.count,
    dailyizedRunRate: Math.round((daySoFar.count / elapsedHours) * 24),
    incompleteResults: daySoFar.incompleteResults || previousHour.incompleteResults
  };
}

export function formatClaudeGithubAlphaLines(alpha: ClaudeGithubAlphaResult | undefined): string[] {
  if (!alpha) {
    return [];
  }

  if (alpha.status === "unavailable") {
    return [
      "GitHub alpha (not resolution):",
      `Query: ${alpha.query}`,
      `Status: unavailable (${alpha.reason})`
    ];
  }

  return [
    "GitHub alpha (not resolution):",
    `Query: ${alpha.query}`,
    `UTC day so far: ${formatCompact(alpha.daySoFarCount)} commits (${alpha.dayStartUtc} to ${alpha.checkedAtUtc})`,
    `Previous full hour: ${formatCompact(alpha.previousHourCount)} commits (${alpha.previousHourStartUtc} to ${alpha.previousHourEndUtc})`,
    `Dailyized alpha run rate: ${formatCompact(alpha.dailyizedRunRate)}/day`,
    `GitHub incomplete results: ${alpha.incompleteResults ? "yes" : "no"}`
  ];
}

export function buildClaudeGithubCommitSearchQuery(baseQuery: string, start: Date, end: Date): string {
  return `${baseQuery} committer-date:${formatGithubSearchDate(start)}..${formatGithubSearchDate(end)}`;
}

function buildClaudeAverageRawValue(rows: ClaudeAverageRow[]): string {
  const latest = rows.at(-1);
  const rollingAverage = getRollingAverage(rows);
  return latest && rollingAverage !== null ? `${latest.date}:${Math.round(rollingAverage)}` : "not available";
}

async function fetchClaudeAverageRows(): Promise<ClaudeAverageRow[]> {
  const response = await fetchWithTimeout(apiDataUrl, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Claude Code Commits tracker returned HTTP ${response.status}`);
  }

  const rows = extractClaudeAverageRows(await response.json());
  if (!rows.length) {
    throw new Error("Could not find Claude Code Commit rows in tracker response");
  }
  return rows;
}

async function fetchGithubCommitSearchCount(query: string, start: Date, end: Date): Promise<{ count: number; incompleteResults: boolean }> {
  const url = new URL(githubCommitSearchUrl);
  url.searchParams.set("q", buildClaudeGithubCommitSearchQuery(query, start, end));
  url.searchParams.set("per_page", "1");
  const headers: Record<string, string> = {
    accept: "application/vnd.github.cloak-preview+json",
    "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetchWithTimeout(url.toString(), { headers });
  if (!response.ok) {
    throw new Error(`GitHub commit search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  if (!isRecord(payload) || typeof payload.total_count !== "number") {
    throw new Error("GitHub commit search did not return a total_count");
  }

  return {
    count: payload.total_count,
    incompleteResults: payload.incomplete_results === true
  };
}

async function fetchClaudeAverageMarket(polymarketUrl: string): Promise<{ brackets: ClaudeAverageBracket[]; resolutionDate: string }> {
  const slug = getPolymarketSlug(polymarketUrl);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${polymarketUrl}`);
  }

  const response = await fetchWithTimeout(`${gammaApiUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const market = extractClaudeAverageBracketsFromGamma(await response.json());
  if (!market.brackets.length) {
    throw new Error("Could not find unresolved Claude Code 7D Avg brackets from Polymarket Gamma");
  }
  return market;
}

function extractClaudeAverageBracket(market: GammaMarket): ClaudeAverageBracket | null {
  const label = normalizeText(market.groupItemTitle ?? market.question ?? "");
  const question = normalizeText(market.question ?? "");
  const source = label || question;
  const lessThan = source.match(/(?:<|less than)\s*([\d,.]+\s*[kmb]?)/i);
  if (lessThan?.[1]) {
    return { label, min: null, max: parseCompactNumber(lessThan[1]) };
  }

  const atLeast = source.match(/(?:at least\s*([\d,.]+\s*[kmb]?)|([\d,.]+\s*[kmb]?)\s*\+)/i);
  if (atLeast?.[1]) {
    return { label, min: parseCompactNumber(atLeast[1]), max: null };
  }
  if (atLeast?.[2]) {
    return { label, min: parseCompactNumber(atLeast[2]), max: null };
  }

  const range = source.match(/([\d,.]+)\s*[-–]\s*([\d,.]+)\s*([kmb]?)/i);
  if (range) {
    const suffix = range[3] ?? "";
    return {
      label,
      min: parseCompactNumber(`${range[1]}${suffix}`),
      max: parseCompactNumber(`${range[2]}${suffix}`)
    };
  }

  return null;
}

function isResolvedGammaMarket(market: GammaMarket): boolean {
  return Boolean(market.closed || market.archived || market.active === false);
}

function getRollingAverage(rows: ClaudeAverageRow[]): number | null {
  const latestRows = rows.slice(-rollingAverageDays);
  if (latestRows.length < rollingAverageDays) {
    return null;
  }

  return latestRows.reduce((sum, row) => sum + row.commits, 0) / rollingAverageDays;
}

function getFinalWindow(resolutionDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${resolutionDate}T12:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() - (rollingAverageDays - 1));
  for (let index = 0; index < rollingAverageDays; index += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function formatNeededAverages(brackets: ClaudeAverageBracket[], knownFinalSum: number, remainingFinalDays: number): string {
  if (remainingFinalDays <= 0) {
    return "final window complete";
  }

  return brackets
    .map((bracket) => {
      const threshold = bracket.min ?? bracket.max;
      if (threshold === null) {
        return null;
      }
      const needed = Math.max(0, (threshold * rollingAverageDays - knownFinalSum) / remainingFinalDays);
      return bracket.min === null
        ? `${bracket.label}: remaining days must average below ${formatCompact(needed)}/day`
        : `${bracket.label}: remaining days must average at least ${formatCompact(needed)}/day`;
    })
    .filter((line): line is string => line !== null)
    .join("\n") || "not available";
}

function findBracket(brackets: ClaudeAverageBracket[], value: number): ClaudeAverageBracket | null {
  return (
    brackets.find((bracket) => {
      const aboveMin = bracket.min === null || value >= bracket.min;
      const belowMax = bracket.max === null || value < bracket.max;
      return aboveMin && belowMax;
    }) ?? null
  );
}

function maxRow(rows: ClaudeAverageRow[]): ClaudeAverageRow | null {
  return rows.reduce<ClaudeAverageRow | null>((best, row) => (!best || row.commits > best.commits ? row : best), null);
}

function compareBrackets(left: ClaudeAverageBracket, right: ClaudeAverageBracket): number {
  return (left.min ?? Number.NEGATIVE_INFINITY) - (right.min ?? Number.NEGATIVE_INFINITY);
}

function formatDayOverDay(latest: ClaudeAverageRow | null, previous: ClaudeAverageRow | null): string {
  if (!latest || !previous) {
    return "not available";
  }

  const change = latest.commits - previous.commits;
  const percent = previous.commits === 0 ? null : (change / previous.commits) * 100;
  return `${formatSignedCompact(change)}${percent === null ? "" : ` (${formatSignedDecimal(percent)})`}`;
}

function formatSourceDate(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  }

  return date.toISOString().slice(0, 10);
}

function parseCompactNumber(value: string): number | null {
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kmb])?/i);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix === "b" ? 1_000_000_000 : suffix === "m" ? 1_000_000 : suffix === "k" ? 1_000 : 1;
  return Number.isFinite(amount) ? Math.round(amount * multiplier) : null;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/[,\s]/g, "");
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : null;
}

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${formatDecimal(value / 1_000_000)}M`;
  }
  if (abs >= 1_000) {
    return `${formatDecimal(value / 1_000)}K`;
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatSignedCompact(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatCompact(Math.abs(value))}`;
}

function formatSignedDecimal(value: number): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(1)}%`;
}

function getClaudeGithubAlphaQuery(): string {
  return process.env.CLAUDE_GITHUB_ALPHA_QUERY?.trim() || defaultGithubAlphaQuery;
}

function formatGithubSearchDate(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function formatUtcMinute(value: Date): string {
  return value.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
