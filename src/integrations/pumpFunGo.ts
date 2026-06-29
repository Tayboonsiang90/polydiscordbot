import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://pump.fun/go";
const marketUrl = "https://predict.fun/market/will-pump-fun-disable-go-before-july-2026";
const apiBaseUrl = "https://livestream-api.pump.fun";
const statsUrl = `${apiBaseUrl}/bounties/v2/stats`;
const openTasksUrl = `${apiBaseUrl}/bounties/v2/tasks?limit=5&phase=OPEN`;
const requestTimeoutMs = 15_000;

type PumpGoStatusKey = "available" | "review-go-api" | "possibly-disabled";

export type PumpGoStats = {
  liveCount: number | null;
  unclaimedRewardTotalUsd: number | null;
  submissionCount: number | null;
  paidOutTotalUsd: number | null;
};

export type PumpGoTask = {
  taskId: string;
  title: string;
  status: string;
  publishedAt: string | null;
  expiresAt: string | null;
};

export type PumpGoTaskList = {
  items: PumpGoTask[];
};

export type PumpGoSnapshot = {
  statusKey: PumpGoStatusKey;
  statusLabel: string;
  pageStatus: string;
  pageHasGoMarkers: boolean | null;
  statsStatus: string;
  tasksStatus: string;
  stats: PumpGoStats | null;
  tasks: PumpGoTaskList | null;
  checkedAt: Date;
};

type FetchOutcome<T> =
  | {
      ok: true;
      status: number;
      value: T;
    }
  | {
      ok: false;
      status: number | null;
      error: string;
    };

type PageOutcome =
  | {
      ok: true;
      status: number;
      html: string;
      hasGoMarkers: boolean;
    }
  | {
      ok: false;
      status: number | null;
      error: string;
    };

export const pumpFunGoAdapter: WebsiteAdapter = {
  id: "pump-fun-go",
  commandName: "pumpgo",
  displayName: "Pump.fun GO",
  sourceUrl,
  defaultPolymarketUrl: marketUrl,
  defaultChannelName: "pumpgo",
  alertRoleName: "Pump GO Alerts",
  alertRoleEmoji: "\uD83C\uDFC1",
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "Fixed 1-minute GO availability check",
  getErrorNoticeWindowMinutes: () => 30,
  shouldAlertOnChange: shouldAlertOnPumpGoChange,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const checkedAt = new Date();
    const [page, stats, tasks] = await Promise.all([
      fetchPumpGoPage(),
      fetchJsonOutcome(statsUrl, parsePumpGoStats),
      fetchJsonOutcome(openTasksUrl, parsePumpGoTaskList)
    ]);

    if (!page.ok && !stats.ok && !tasks.ok) {
      throw new Error(
        [
          "Could not reach pump.fun GO page or public bounties API.",
          `Page: ${formatFailure(page)}`,
          `Stats API: ${formatFailure(stats)}`,
          `Task list API: ${formatFailure(tasks)}`
        ].join("\n")
      );
    }

    const snapshot = buildPumpGoSnapshot(page, stats, tasks, checkedAt);
    const value = formatPumpGoValue(snapshot);
    return {
      value,
      rawValue: value,
      unit: "GO availability",
      observedAt: checkedAt
    };
  }
};

export function parsePumpGoStats(data: unknown): PumpGoStats {
  if (!data || typeof data !== "object") {
    throw new Error("Pump.fun GO stats response was not an object");
  }

  return {
    liveCount: readNullableNumber(data, "liveCount"),
    unclaimedRewardTotalUsd: readNullableNumber(data, "unclaimedRewardTotalUsd"),
    submissionCount: readNullableNumber(data, "submissionCount"),
    paidOutTotalUsd: readNullableNumber(data, "paidOutTotalUsd")
  };
}

export function parsePumpGoTaskList(data: unknown): PumpGoTaskList {
  if (!data || typeof data !== "object" || !Array.isArray((data as { items?: unknown }).items)) {
    throw new Error("Pump.fun GO task list response did not include an items array");
  }

  const items = (data as { items: unknown[] }).items.map((item) => parsePumpGoTask(item)).filter((item) => item.title);
  return { items };
}

export function isPumpGoHtmlFeaturePresent(html: string): boolean {
  return [
    "/go/bounties",
    "/go/submissions",
    "bounties/v2/tasks",
    "BOUNTY_",
    "Create bounty",
    "Post bounty",
    "Bounties"
  ].some((marker) => html.includes(marker));
}

export function formatPumpGoValue(snapshot: PumpGoSnapshot): string {
  const latestTask = snapshot.tasks?.items[0] ?? null;
  return [
    `GO status: ${snapshot.statusLabel}`,
    `Status key: ${snapshot.statusKey}`,
    `Page status: ${snapshot.pageStatus}`,
    `Page GO markers: ${formatBoolean(snapshot.pageHasGoMarkers)}`,
    `Stats API: ${snapshot.statsStatus}`,
    `Task list API: ${snapshot.tasksStatus}`,
    `Live bounties: ${formatInteger(snapshot.stats?.liveCount)}`,
    `Total submissions: ${formatInteger(snapshot.stats?.submissionCount)}`,
    `Unclaimed reward pool: ${formatUsd(snapshot.stats?.unclaimedRewardTotalUsd)}`,
    `Paid out total: ${formatUsd(snapshot.stats?.paidOutTotalUsd)}`,
    `Latest open bounty: ${latestTask ? truncate(latestTask.title, 120) : "none found"}`,
    `Latest open bounty status: ${latestTask?.status || "none found"}`,
    `Latest open bounty published: ${latestTask?.publishedAt ?? "unknown"}`,
    `Resolution: ${sourceUrl}`,
    `Market: ${marketUrl}`
  ].join("\n");
}

export function extractPumpGoStatusKey(value: string | null): string | null {
  return value?.match(/^Status key:\s*(.+)$/m)?.[1]?.trim() ?? null;
}

export function shouldAlertOnPumpGoChange(previousValue: string | null, currentValue: string): boolean {
  if (!previousValue) {
    return false;
  }

  const previousStatus = extractPumpGoStatusKey(previousValue);
  const currentStatus = extractPumpGoStatusKey(currentValue);
  if (!previousStatus || !currentStatus) {
    return previousValue !== currentValue;
  }

  return previousStatus !== currentStatus;
}

function buildPumpGoSnapshot(
  page: PageOutcome,
  stats: FetchOutcome<PumpGoStats>,
  tasks: FetchOutcome<PumpGoTaskList>,
  checkedAt: Date
): PumpGoSnapshot {
  const hasGoApi = stats.ok || tasks.ok;
  const pageHasGoMarkers = page.ok ? page.hasGoMarkers : null;
  const statusKey: PumpGoStatusKey = hasGoApi
    ? "available"
    : page.ok && page.hasGoMarkers
      ? "review-go-api"
      : "possibly-disabled";

  return {
    statusKey,
    statusLabel: formatStatusLabel(statusKey),
    pageStatus: formatOutcomeStatus(page),
    pageHasGoMarkers,
    statsStatus: formatOutcomeStatus(stats),
    tasksStatus: formatOutcomeStatus(tasks),
    stats: stats.ok ? stats.value : null,
    tasks: tasks.ok ? tasks.value : null,
    checkedAt
  };
}

async function fetchPumpGoPage(): Promise<PageOutcome> {
  try {
    const response = await fetchWithTimeout(
      sourceUrl,
      {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
        }
      },
      requestTimeoutMs
    );
    const html = await response.text();
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status, html, hasGoMarkers: isPumpGoHtmlFeaturePresent(html) };
  } catch (error) {
    return { ok: false, status: null, error: formatError(error) };
  }
}

async function fetchJsonOutcome<T>(url: string, parser: (data: unknown) => T): Promise<FetchOutcome<T>> {
  try {
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          accept: "application/json",
          origin: "https://pump.fun",
          referer: sourceUrl,
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1",
          "x-pump-platform": "web",
          "x-pump-source": "WEB"
        }
      },
      requestTimeoutMs
    );
    const body = await response.text();
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }

    const data = JSON.parse(body) as unknown;
    return { ok: true, status: response.status, value: parser(data) };
  } catch (error) {
    return { ok: false, status: null, error: formatError(error) };
  }
}

function parsePumpGoTask(data: unknown): PumpGoTask {
  if (!data || typeof data !== "object") {
    return {
      taskId: "",
      title: "",
      status: "",
      publishedAt: null,
      expiresAt: null
    };
  }

  return {
    taskId: readString(data, "taskId"),
    title: readString(data, "title"),
    status: readString(data, "status"),
    publishedAt: readNullableString(data, "publishedAt"),
    expiresAt: readNullableString(data, "expiresAt")
  };
}

function readString(data: object, key: string): string {
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function readNullableString(data: object, key: string): string | null {
  const value = readString(data, key);
  return value || null;
}

function readNullableNumber(data: object, key: string): number | null {
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatStatusLabel(statusKey: PumpGoStatusKey): string {
  if (statusKey === "available") {
    return "available";
  }
  if (statusKey === "review-go-api") {
    return "review needed - GO page is reachable but the public bounties API is unavailable";
  }
  return "possibly disabled - GO page is reachable but GO markers/API are missing";
}

function formatOutcomeStatus(outcome: FetchOutcome<unknown> | PageOutcome): string {
  if (outcome.ok) {
    return `HTTP ${outcome.status}`;
  }
  return outcome.status ? `HTTP ${outcome.status} - ${outcome.error}` : `error - ${outcome.error}`;
}

function formatFailure(outcome: FetchOutcome<unknown> | PageOutcome): string {
  return outcome.ok ? `HTTP ${outcome.status}` : formatOutcomeStatus(outcome);
}

function formatBoolean(value: boolean | null): string {
  if (value === null) {
    return "unknown";
  }
  return value ? "yes" : "no";
}

function formatInteger(value: number | null | undefined): string {
  return typeof value === "number" ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value) : "unknown";
}

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "unknown";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
