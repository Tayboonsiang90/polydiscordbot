import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://dune.com/nibty/eth-gas-prices";
const queryUrl = "https://dune.com/queries/1887488";
const queryResultsUrl = "https://api.dune.com/api/v1/query/1887488/results";
const thresholdsGwei = [10, 15, 20, 25, 40];

export type EthereumGasMonthlyPoint = {
  month: string;
  meanGasGwei: number;
};

export type EthereumGasMonthlySnapshot = {
  finalized: EthereumGasMonthlyPoint;
  latestDashboardPoint: EthereumGasMonthlyPoint;
};

export function extractEthereumGasMonthlySnapshot(data: unknown): EthereumGasMonthlySnapshot {
  const points = extractDuneRows(data)
    .map(parseEthereumGasMonthlyPoint)
    .filter((point): point is EthereumGasMonthlyPoint => Boolean(point))
    .sort((left, right) => left.month.localeCompare(right.month));

  if (points.length < 2) {
    throw new Error("Could not find at least two Ethereum monthly gas rows in Dune response");
  }

  return {
    finalized: points[points.length - 2],
    latestDashboardPoint: points[points.length - 1]
  };
}

export function extractEthereumGasMonthlyValue(data: unknown, sourceLabel = "Dune API"): string {
  return formatEthereumGasMonthlyValue(extractEthereumGasMonthlySnapshot(data), sourceLabel);
}

export const ethereumGasMonthlyAdapter: WebsiteAdapter = {
  id: "ethereum-gas-monthly-average",
  commandName: "ethgasmonthly",
  displayName: "Ethereum Monthly Gas",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/what-will-the-average-monthly-ethereum-gas-price-hit-before-2027",
  defaultChannelName: "ethgasmonthly",
  alertRoleName: "ETH Gas Monthly Alerts",
  alertRoleEmoji: "\u26FD",
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Fixed hourly check for finalized monthly Ethereum gas averages",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const apiKey = process.env.DUNE_API_KEY?.trim();
    if (!apiKey || apiKey === "...") {
      throw new Error("Missing DUNE_API_KEY. Add it to .env to monitor Ethereum monthly gas.");
    }

    const value = await fetchDuneEthereumGasMonthlyValue(apiKey);

    return {
      value,
      rawValue: value,
      unit: "mean_gas",
      observedAt: new Date()
    };
  }
};

async function fetchDuneEthereumGasMonthlyValue(apiKey: string): Promise<string> {
  const response = await fetchWithTimeout(queryResultsUrl, {
    headers: {
      "x-dune-api-key": apiKey,
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Dune returned HTTP ${response.status}`);
  }

  return extractEthereumGasMonthlyValue(await response.json());
}

function formatEthereumGasMonthlyValue(snapshot: EthereumGasMonthlySnapshot, sourceLabel: string): string {
  const hitThresholds = thresholdsGwei.filter((threshold) => snapshot.finalized.meanGasGwei >= threshold);
  const openThresholds = thresholdsGwei.filter((threshold) => snapshot.finalized.meanGasGwei < threshold);

  return [
    "Metric: Ethereum monthly average gas price",
    `Finalized month: ${snapshot.finalized.month}`,
    `Finalized mean_gas: ${formatGwei(snapshot.finalized.meanGasGwei)}`,
    `Latest dashboard month: ${snapshot.latestDashboardPoint.month} (${formatGwei(snapshot.latestDashboardPoint.meanGasGwei)}; not finalized until next month appears)`,
    `Data source: ${sourceLabel}`,
    `Thresholds hit: ${hitThresholds.length ? hitThresholds.map(formatThreshold).join(", ") : "none"}`,
    `Open thresholds: ${openThresholds.length ? openThresholds.map(formatThreshold).join(", ") : "none"}`,
    `Query: ${queryUrl}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

function extractDuneRows(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") {
    return [];
  }

  const candidate = data as {
    result?: { rows?: unknown };
    rows?: unknown;
  };
  const rows = candidate.result?.rows ?? candidate.rows;
  return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

function parseEthereumGasMonthlyPoint(row: Record<string, unknown>): EthereumGasMonthlyPoint | null {
  const monthEntry = Object.entries(row).find(([key, value]) => isMonthKey(key) && parseMonthValue(value));
  const meanGasEntry = Object.entries(row).find(([key, value]) => isMeanGasKey(key) && parseNumberValue(value) !== null);
  const month = monthEntry ? parseMonthValue(monthEntry[1]) : null;
  const meanGasGwei = meanGasEntry ? parseNumberValue(meanGasEntry[1]) : null;

  return month && meanGasGwei !== null ? { month, meanGasGwei } : null;
}

function isMonthKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return ["month", "date", "time", "blockmonth", "blockdate"].includes(normalized) || normalized.endsWith("month");
}

function isMeanGasKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return normalized === "meangas" || (normalized.includes("mean") && normalized.includes("gas"));
}

function parseMonthValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 7);
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const text = String(value).trim();
  const directMonth = text.match(/^(\d{4})-(\d{2})(?:$|-\d{2}|[\sT])/);
  if (directMonth) {
    return `${directMonth[1]}-${directMonth[2]}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 7);
}

function parseNumberValue(value: unknown): number | null {
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

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatGwei(value: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value)} Gwei`;
}

function formatThreshold(value: number): string {
  return `${value} Gwei`;
}
