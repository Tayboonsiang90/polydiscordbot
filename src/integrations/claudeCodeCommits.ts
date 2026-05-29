import { getPolymarketSlug } from "../marketEnd.js";
import { fetchWithTimeout } from "../http.js";
import { parseSettingsJson, stringifySettingsJson } from "../settingsJson.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://claude-commits.polymarket.com/";
const apiDataUrl = "https://claude-commits.polymarket.com/api/data";
const gammaApiUrl = "https://gamma-api.polymarket.com/events";
const defaultPolymarketUrl = "https://polymarket.com/event/claude-code-commits-hit-by-june-30";

export type ClaudeCommitRow = {
  date: string;
  commits: number;
  githubTotalCount: number | null;
  claudePctOfGithub: number | null;
  marketSharePct: number | null;
  updatedAt: string | null;
  collectedAt: string | null;
};

export type ClaudeCommitTarget = {
  label: string;
  direction: "high" | "low";
  threshold: number;
};

export type ClaudeCommitHit = {
  target: ClaudeCommitTarget;
  row: ClaudeCommitRow;
};

export type ClaudeCommitsSettings = {
  claudeCommitTargets?: ClaudeCommitTarget[];
  parsedFromUrl?: string;
  lastParsedAt?: string;
  windowStartDate?: string;
  windowEndDate?: string;
};

type GammaEvent = {
  startDate?: string;
  creationDate?: string;
  endDate?: string;
  markets?: GammaMarket[];
};

type GammaMarket = {
  active?: boolean;
  archived?: boolean;
  closed?: boolean;
  question?: string;
  groupItemTitle?: string;
  outcomePrices?: string[] | string;
  outcomes?: string[] | string;
};

export const claudeCodeCommitsAdapter: WebsiteAdapter = {
  id: "claude-code-commits",
  commandName: "claudecommits",
  displayName: "Claude Code Commits",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "claudecommits",
  alertRoleName: "Claude Commits Alerts",
  alertRoleEmoji: "\uD83D\uDCBB",
  supportsStrikes: true,
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Fixed hourly check for new daily Claude Code Commit data",
  shouldAlertOnChange: claudeCommitsShouldAlertOnChange,
  async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
    return refreshClaudeCommitsSettings(integration, options);
  },
  getStrikeTerms(integration: Integration): { strikeTerms: string[]; parsedFromUrl?: string; lastParsedAt?: string } {
    const settings = parseClaudeCommitsSettings(integration.settingsJson);
    return {
      strikeTerms: settings.claudeCommitTargets?.map(formatTargetLabel) ?? [],
      parsedFromUrl: settings.parsedFromUrl,
      lastParsedAt: settings.lastParsedAt
    };
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const observedAt = new Date();
    const polymarketUrl = integration?.polymarketUrl ?? defaultPolymarketUrl;
    const settings = parseClaudeCommitsSettings(integration?.settingsJson);
    const market =
      settings.claudeCommitTargets?.length
        ? {
            targets: settings.claudeCommitTargets,
            windowStartDate: settings.windowStartDate,
            windowEndDate: settings.windowEndDate
          }
        : await fetchClaudeCommitMarket(polymarketUrl);
    const targets = market.targets;
    const rows = await fetchClaudeCommitRows();
    const hits = findClaudeCommitHits(rows, targets, {
      startDate: market.windowStartDate,
      endDate: market.windowEndDate
    });
    const alertState = filterNewClaudeCommitHits(integration?.lastValue ?? null, polymarketUrl, hits);
    const value = formatClaudeCommitsMonitorValue({
      rows,
      targets,
      hits: alertState.hits,
      alertedTargets: alertState.alertedTargets,
      sourceUrl,
      polymarketUrl,
      windowStartDate: market.windowStartDate,
      windowEndDate: market.windowEndDate
    });

    return {
      value,
      rawValue: latestClaudeCommitRow(rows)?.commits.toString() ?? value,
      unit: "daily commits",
      observedAt
    };
  }
};

export function extractClaudeCommitRows(payload: unknown): ClaudeCommitRow[] {
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
        marketSharePct: parseNumber(row.market_share_pct),
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
        collectedAt: typeof row.collected_at === "string" ? row.collected_at : null
      };
    })
    .filter((row): row is ClaudeCommitRow => row !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function extractClaudeCommitTargetsFromGamma(data: unknown): {
  targets: ClaudeCommitTarget[];
  windowStartDate?: string;
  windowEndDate?: string;
} {
  const event = Array.isArray(data) ? (data[0] as GammaEvent | undefined) : (data as GammaEvent | undefined);
  const seen = new Set<string>();
  const targets: ClaudeCommitTarget[] = [];

  for (const market of event?.markets ?? []) {
    if (isResolvedGammaMarket(market)) {
      continue;
    }

    const target = extractClaudeCommitTarget(market);
    if (target && !seen.has(formatTargetKey(target))) {
      seen.add(formatTargetKey(target));
      targets.push(target);
    }
  }

  return {
    targets: targets.sort(compareTargets),
    windowStartDate: formatSourceDate(event?.startDate ?? event?.creationDate),
    windowEndDate: formatSourceDate(event?.endDate)
  };
}

export function findClaudeCommitHits(
  rows: ClaudeCommitRow[],
  targets: ClaudeCommitTarget[],
  window: { startDate?: string; endDate?: string } = {}
): ClaudeCommitHit[] {
  const windowRows = rows.filter((row) => isDateInWindow(row.date, window.startDate, window.endDate));
  return targets
    .map((target) => {
      const row = windowRows.find((candidate) =>
        target.direction === "high" ? candidate.commits >= target.threshold : candidate.commits <= target.threshold
      );
      return row ? { target, row } : null;
    })
    .filter((hit): hit is ClaudeCommitHit => hit !== null);
}

export function filterNewClaudeCommitHits(
  previousValue: string | null,
  polymarketUrl: string,
  hits: ClaudeCommitHit[]
): { hits: ClaudeCommitHit[]; alertedTargets: string[] } {
  const alertedTargets = parseStoredAlertedTargets(previousValue, polymarketUrl);
  const newHits = hits.filter((hit) => !alertedTargets.has(formatTargetLabel(hit.target)));
  for (const hit of newHits) {
    alertedTargets.add(formatTargetLabel(hit.target));
  }

  return {
    hits: newHits,
    alertedTargets: [...alertedTargets].sort(compareTargetLabels)
  };
}

export function formatClaudeCommitsMonitorValue(input: {
  rows: ClaudeCommitRow[];
  targets: ClaudeCommitTarget[];
  hits: ClaudeCommitHit[];
  alertedTargets?: string[];
  sourceUrl: string;
  polymarketUrl: string;
  windowStartDate?: string;
  windowEndDate?: string;
}): string {
  const latest = latestClaudeCommitRow(input.rows);
  const previous = input.rows.length > 1 ? input.rows[input.rows.length - 2] : null;
  const windowRows = input.rows.filter((row) => isDateInWindow(row.date, input.windowStartDate, input.windowEndDate));
  const high = maxRow(windowRows);
  const low = minRow(windowRows);

  return [
    "Metric: Daily Claude Code Commits",
    `Latest date: ${latest?.date ?? "not available"}`,
    `Latest commits: ${latest ? formatInteger(latest.commits) : "not available"}`,
    `Previous date: ${previous?.date ?? "not available"}`,
    `Previous commits: ${previous ? formatInteger(previous.commits) : "not available"}`,
    `Day-over-day: ${formatDayOverDay(latest, previous)}`,
    `Window: ${input.windowStartDate ?? "unknown"} to ${input.windowEndDate ?? "unknown"}`,
    `Window high: ${high ? `${formatInteger(high.commits)} on ${high.date}` : "not available"}`,
    `Window low: ${low ? `${formatInteger(low.commits)} on ${low.date}` : "not available"}`,
    "Newly Hit Targets:",
    input.hits.length ? input.hits.map(formatHit).join("\n") : "none",
    "Alerted Targets:",
    input.alertedTargets?.length ? input.alertedTargets.join(", ") : "none",
    "Tracked Targets:",
    input.targets.length ? input.targets.map(formatTrackedTarget).join("\n") : "none",
    `Resolution: ${input.sourceUrl}`,
    `Alerted For: ${input.polymarketUrl}`
  ].join("\n");
}

export function claudeCommitsShouldAlertOnChange(_previousValue: string | null, currentValue: string): boolean {
  return parseCurrentClaudeCommitHits(currentValue).length > 0;
}

export function parseClaudeCommitsSettings(settingsJson: string | null | undefined): ClaudeCommitsSettings {
  const settings = parseSettingsJson(settingsJson);
  const targets = Array.isArray(settings.claudeCommitTargets)
    ? settings.claudeCommitTargets.map(normalizeStoredTarget).filter((target): target is ClaudeCommitTarget => target !== null)
    : undefined;

  return {
    claudeCommitTargets: targets,
    parsedFromUrl: typeof settings.parsedFromUrl === "string" ? settings.parsedFromUrl : undefined,
    lastParsedAt: typeof settings.lastParsedAt === "string" ? settings.lastParsedAt : undefined,
    windowStartDate: isSourceDate(settings.windowStartDate) ? settings.windowStartDate : undefined,
    windowEndDate: isSourceDate(settings.windowEndDate) ? settings.windowEndDate : undefined
  };
}

async function refreshClaudeCommitsSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
  const existing = parseClaudeCommitsSettings(integration.settingsJson);
  const polymarketUrl = integration.polymarketUrl ?? existing.parsedFromUrl ?? defaultPolymarketUrl;
  try {
    const market = await fetchClaudeCommitMarket(polymarketUrl);
    return stringifySettingsJson({
      ...parseSettingsJson(integration.settingsJson),
      claudeCommitTargets: market.targets,
      parsedFromUrl: polymarketUrl,
      lastParsedAt: new Date().toISOString(),
      windowStartDate: market.windowStartDate,
      windowEndDate: market.windowEndDate ?? parseEndDateFromSlug(polymarketUrl)
    });
  } catch (error) {
    if (!options?.force && existing.claudeCommitTargets?.length) {
      return integration.settingsJson ?? stringifySettingsJson(existing as Record<string, unknown>);
    }

    throw error;
  }
}

async function fetchClaudeCommitMarket(polymarketUrl: string): Promise<ReturnType<typeof extractClaudeCommitTargetsFromGamma>> {
  const slug = getPolymarketSlug(polymarketUrl);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${polymarketUrl}`);
  }

  const response = await fetchWithTimeout(`${gammaApiUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const market = extractClaudeCommitTargetsFromGamma(await response.json());
  if (market.targets.length === 0) {
    throw new Error("Could not find unresolved Claude Code Commit targets from Polymarket Gamma");
  }

  return {
    ...market,
    windowEndDate: market.windowEndDate ?? parseEndDateFromSlug(polymarketUrl)
  };
}

async function fetchClaudeCommitRows(): Promise<ClaudeCommitRow[]> {
  const response = await fetchWithTimeout(apiDataUrl, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`Claude Code Commits tracker returned HTTP ${response.status}`);
  }

  const rows = extractClaudeCommitRows(await response.json());
  if (rows.length === 0) {
    throw new Error("Could not find Claude Code Commit rows in tracker response");
  }
  return rows;
}

function extractClaudeCommitTarget(market: GammaMarket): ClaudeCommitTarget | null {
  const title = normalizeText(market.groupItemTitle ?? "");
  const question = normalizeText(market.question ?? "");
  const direction = /↑|high/i.test(title) || /\(high\)/i.test(question) ? "high" : /↓|low/i.test(title) || /\(low\)/i.test(question) ? "low" : null;
  const questionTarget = question.match(/hit\s*\((?:high|low)\)\s*([\d,.]+\s*[kmb]?)/i)?.[1] ?? "";
  const targetText = title || questionTarget;
  const threshold = parseCompactNumber(targetText);

  if (!direction || threshold === null) {
    return null;
  }

  return {
    label: title || `${direction === "high" ? "↑" : "↓"} ${formatCompactThreshold(threshold)}`,
    direction,
    threshold
  };
}

function isResolvedGammaMarket(market: GammaMarket): boolean {
  if (market.closed || market.archived || market.active === false) {
    return true;
  }

  const outcomes = parseJsonStringArray(market.outcomes);
  const yesIndex = outcomes.findIndex((outcome) => outcome.toLowerCase() === "yes");
  const prices = parseJsonStringArray(market.outcomePrices).map(Number);
  return prices[yesIndex === -1 ? 0 : yesIndex] === 1;
}

function normalizeStoredTarget(value: unknown): ClaudeCommitTarget | null {
  if (!isRecord(value)) {
    return null;
  }

  const direction = value.direction === "high" || value.direction === "low" ? value.direction : null;
  const threshold = parseNumber(value.threshold);
  const label = typeof value.label === "string" ? normalizeText(value.label) : "";
  return direction && threshold !== null && label ? { direction, threshold, label } : null;
}

function parseStoredAlertedTargets(value: string | null, polymarketUrl: string): Set<string> {
  if (!value || !value.includes(`Alerted For: ${polymarketUrl}`)) {
    return new Set();
  }

  const lines = value.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "Alerted Targets:");
  const end = lines.findIndex((line) => line === "Tracked Targets:");
  if (start === -1 || end === -1 || end <= start) {
    return new Set();
  }

  const text = lines.slice(start + 1, end).join(" ").trim();
  if (!text || text === "none") {
    return new Set();
  }

  return new Set(text.split(",").map(normalizeText).filter(Boolean));
}

function parseCurrentClaudeCommitHits(value: string): string[] {
  const lines = value.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "Newly Hit Targets:");
  const end = lines.findIndex((line) => line === "Alerted Targets:");
  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  return lines.slice(start + 1, end).filter((line) => line && line !== "none");
}

function formatHit(hit: ClaudeCommitHit): string {
  return `${formatTargetLabel(hit.target)} hit ${hit.target.direction} at ${formatInteger(hit.row.commits)} on ${hit.row.date}`;
}

function formatTrackedTarget(target: ClaudeCommitTarget): string {
  return `${formatTargetLabel(target)} (${target.direction === "high" ? ">=" : "<="} ${formatInteger(target.threshold)})`;
}

function formatTargetLabel(target: ClaudeCommitTarget): string {
  return normalizeText(target.label);
}

function formatTargetKey(target: ClaudeCommitTarget): string {
  return `${target.direction}:${target.threshold}`;
}

function compareTargets(left: ClaudeCommitTarget, right: ClaudeCommitTarget): number {
  if (left.direction !== right.direction) {
    return left.direction === "low" ? -1 : 1;
  }

  return left.threshold - right.threshold;
}

function compareTargetLabels(left: string, right: string): number {
  return left.localeCompare(right, "en-US", { numeric: true });
}

function latestClaudeCommitRow(rows: ClaudeCommitRow[]): ClaudeCommitRow | null {
  return rows.at(-1) ?? null;
}

function maxRow(rows: ClaudeCommitRow[]): ClaudeCommitRow | null {
  return rows.reduce<ClaudeCommitRow | null>((best, row) => (!best || row.commits > best.commits ? row : best), null);
}

function minRow(rows: ClaudeCommitRow[]): ClaudeCommitRow | null {
  return rows.reduce<ClaudeCommitRow | null>((best, row) => (!best || row.commits < best.commits ? row : best), null);
}

function formatDayOverDay(latest: ClaudeCommitRow | null, previous: ClaudeCommitRow | null): string {
  if (!latest || !previous) {
    return "not available";
  }

  const change = latest.commits - previous.commits;
  const percent = previous.commits === 0 ? null : (change / previous.commits) * 100;
  return `${formatSignedInteger(change)}${percent === null ? "" : ` (${formatSignedDecimal(percent)}%)`}`;
}

function parseEndDateFromSlug(polymarketUrl: string): string | undefined {
  const slug = getPolymarketSlug(polymarketUrl);
  const match = slug?.match(/by-([a-z]+)-(\d{1,2})/i);
  if (!match) {
    return undefined;
  }

  const month = monthNumber(match[1]);
  const day = Number(match[2]);
  return month && day >= 1 && day <= 31 ? `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : undefined;
}

function isDateInWindow(date: string, startDate?: string, endDate?: string): boolean {
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

function formatSourceDate(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return isSourceDate(value) ? value : undefined;
  }

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function isSourceDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseJsonStringArray(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseCompactNumber(value: string): number | null {
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kmb])?/i);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return null;
  }

  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix === "b" ? 1_000_000_000 : suffix === "m" ? 1_000_000 : suffix === "k" ? 1_000 : 1;
  return Math.round(amount * multiplier);
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

function formatCompactThreshold(value: number): string {
  if (value >= 1_000_000) {
    return `${formatDecimal(value / 1_000_000)}m`;
  }

  if (value >= 1_000) {
    return `${formatDecimal(value / 1_000)}k`;
  }

  return formatInteger(value);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatSignedInteger(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatInteger(Math.abs(value))}`;
}

function formatSignedDecimal(value: number): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(1)}`;
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function monthNumber(value: string): number | null {
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

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
