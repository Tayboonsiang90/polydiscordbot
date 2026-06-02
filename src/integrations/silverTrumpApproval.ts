import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.natesilver.net/p/trump-approval-ratings-nate-silver-bulletin";
const datawrapperChartUrl = "https://datawrapper.dwcdn.net/kSCt4/";
const targetDate = "2026-06-05";
const easternTimeZone = "America/New_York";

export type SilverApprovalRow = {
  date: string;
  approve: number;
  disapprove: number | null;
};

export const silverTrumpApprovalAdapter: WebsiteAdapter = {
  id: "silver-trump-approval",
  commandName: "trumpapproval",
  displayName: "Silver Trump Approval",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/trump-approval-rating-on-june-5",
  defaultChannelName: "trumpapproval",
  alertRoleName: "Trump Approval Alerts",
  alertRoleEmoji: "\uD83D\uDCCA",
  getPollIntervalMinutes: getSilverTrumpApprovalPollIntervalMinutes,
  getPollIntervalReason: getSilverTrumpApprovalPollIntervalReason,
  shouldAlertOnChange: silverTrumpApprovalShouldAlertOnChange,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const datasetUrl = await fetchLatestSilverApprovalDatasetUrl();
    const response = await fetchWithTimeout(datasetUrl, {
      headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
    });
    if (!response.ok) {
      throw new Error(`Silver Bulletin Datawrapper dataset returned HTTP ${response.status}`);
    }

    const value = extractSilverTrumpApprovalValue(await response.text(), datasetUrl);
    return {
      value,
      rawValue: extractRawApproval(value) ?? value,
      unit: "approval percentage",
      observedAt: new Date()
    };
  }
};

export function extractSilverTrumpApprovalValue(csv: string, datasetUrl: string): string {
  const rows = parseSilverApprovalRows(csv);
  const target = rows.find((row) => row.date === targetDate) ?? null;
  const latest = rows.at(-1) ?? null;
  const nextAfterTarget = rows.find((row) => row.date > targetDate) ?? null;
  const finalized = Boolean(target && nextAfterTarget);

  if (target && finalized) {
    return [
      "Metric: Silver Bulletin Trump approval rating",
      `Target date: ${targetDate}`,
      "Target status: finalized",
      `Approval: ${formatPercent(target.approve)}`,
      `Disapproval: ${formatNullablePercent(target.disapprove)}`,
      `Finalized by next data point: ${nextAfterTarget?.date ?? "not available"}`,
      `Latest available: ${formatRow(latest)}`,
      `Chart data: ${datasetUrl}`,
      `Resolution: ${sourceUrl}`
    ].join("\n");
  }

  return [
    "Metric: Silver Bulletin Trump approval rating",
    `Target date: ${targetDate}`,
    `Target status: ${target ? "published; waiting for next data point to finalize" : "not published yet"}`,
    `Approval: ${target ? formatPercent(target.approve) : "not published yet"}`,
    `Disapproval: ${target ? formatNullablePercent(target.disapprove) : "not published yet"}`,
    "Finalized by next data point: not yet",
    `Latest available: ${formatRow(latest)}`,
    `Chart data: ${datasetUrl}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function parseSilverApprovalRows(csv: string): SilverApprovalRow[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return [];
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  const modelDateIndex = headers.indexOf("modeldate");
  const approveIndex = headers.indexOf("approve");
  const disapproveIndex = headers.indexOf("disapprove");
  if (modelDateIndex === -1 || approveIndex === -1) {
    return [];
  }

  return lines
    .slice(1)
    .map((line) => {
      const cells = splitCsvLine(line);
      const date = formatModelDate(cells[modelDateIndex]);
      const approve = parseNumber(cells[approveIndex]);
      if (!date || approve === null) {
        return null;
      }

      return {
        date,
        approve,
        disapprove: disapproveIndex === -1 ? null : parseNumber(cells[disapproveIndex])
      };
    })
    .filter((row): row is SilverApprovalRow => row !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function resolveSilverDatawrapperDatasetUrl(html: string): string | null {
  const match = html.match(/https:\/\/datawrapper\.dwcdn\.net\/kSCt4\/(\d+)\//) ?? html.match(/kSCt4\/(\d+)\//);
  return match ? `https://datawrapper.dwcdn.net/kSCt4/${match[1]}/dataset.csv` : null;
}

export function getSilverTrumpApprovalPollIntervalMinutes(integration: Integration, now: Date = new Date()): number {
  if (integration.lastValue?.includes("Target status: finalized")) {
    return 1_440;
  }

  const easternDate = getEasternDate(now);
  if (easternDate < targetDate) {
    return 1_440;
  }

  return easternDate <= "2026-06-10" ? 1 : 60;
}

export function getSilverTrumpApprovalPollIntervalReason(integration: Integration, now: Date = new Date()): string {
  if (integration.lastValue?.includes("Target status: finalized")) {
    return "Silver Bulletin target date finalized; daily verification only";
  }

  const easternDate = getEasternDate(now);
  if (easternDate < targetDate) {
    return "Silver Bulletin normal mode before June 5, 2026 ET; daily check only";
  }

  return easternDate <= "2026-06-10"
    ? "Silver Bulletin release watch until the June 5 value is finalized by the next data point"
    : "Silver Bulletin fallback hourly mode; target value still not finalized";
}

export function silverTrumpApprovalShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  return currentValue.includes("Target status: finalized") && !(previousValue?.includes("Target status: finalized") ?? false);
}

async function fetchLatestSilverApprovalDatasetUrl(): Promise<string> {
  const response = await fetchWithTimeout(datawrapperChartUrl, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Silver Bulletin Datawrapper chart returned HTTP ${response.status}`);
  }

  const datasetUrl = resolveSilverDatawrapperDatasetUrl(await response.text());
  if (!datasetUrl) {
    throw new Error("Could not find the latest Silver Bulletin approval chart dataset URL");
  }

  return datasetUrl;
}

function formatModelDate(value: string | undefined): string | null {
  const match = value?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year)) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells;
}

function formatRow(row: SilverApprovalRow | null): string {
  return row ? `${row.date} = ${formatPercent(row.approve)} approval, ${formatNullablePercent(row.disapprove)} disapproval` : "none";
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatNullablePercent(value: number | null): string {
  return value === null ? "not available" : formatPercent(value);
}

function extractRawApproval(value: string): string | null {
  return value.match(/^Approval:\s*(.+)$/m)?.[1] ?? null;
}

function getEasternDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: easternTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
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
