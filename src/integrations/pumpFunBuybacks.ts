import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://fees.pump.fun/";
const defaultPolymarketUrl = "https://polymarket.com/event/will-pumpfun-buybacks-hit-500m-by-december-31";
const targetUsd = 500_000_000;
const requestTimeoutMs = 30_000;

export type PumpFunBuybackPoint = {
  date: string;
  buybacksUsd: number;
  pumpTokensBought: number;
  transactionCount: number;
  cumulativeUsd: number;
};

export const pumpFunBuybacksAdapter: WebsiteAdapter = {
  id: "pump-fun-buybacks",
  commandName: "pumpbuybacks",
  displayName: "Pump.fun Buybacks",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "pumpbuybacks",
  alertRoleName: "Pump Buyback Alerts",
  alertRoleEmoji: "💚",
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Hourly official Pump.fun cumulative buyback check",
  shouldAlertOnChange: shouldAlertOnPumpFunBuybackChange,
  async fetchCurrentValue(): Promise<AdapterValue> {
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
      throw new Error(`Pump.fun buyback tracker returned HTTP ${response.status}`);
    }

    const points = parsePumpFunBuybackPoints(html);
    const value = formatPumpFunBuybackValue(points);
    return {
      value,
      rawValue: points.at(-1)?.cumulativeUsd.toFixed(2) ?? value,
      unit: "USD cumulative buybacks",
      observedAt: new Date()
    };
  }
};

export function parsePumpFunBuybackPoints(html: string): PumpFunBuybackPoint[] {
  const normalized = html.replace(/\\"/g, '"').replace(/&quot;/g, '"');
  const number = "-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
  const pointPattern = new RegExp(
    `\\{"date":"(\\d{4}-\\d{2}-\\d{2})","stableRevenue":${number},"revenueUsd":${number},` +
      `"buybacksSol":${number},"buybacksUsd":(${number}),"buybackPercentage":${number},` +
      `"pumpTokensBought":(${number}),"transactionCount":(${number}),"cumulativeUsd":(${number})\\}`,
    "g"
  );
  const pointByDate = new Map<string, PumpFunBuybackPoint>();

  for (const match of normalized.matchAll(pointPattern)) {
    const point = {
      date: match[1],
      buybacksUsd: Number(match[2]),
      pumpTokensBought: Number(match[3]),
      transactionCount: Number(match[4]),
      cumulativeUsd: Number(match[5])
    };
    if (Object.values(point).every((value) => typeof value === "string" || Number.isFinite(value))) {
      pointByDate.set(point.date, point);
    }
  }

  const points = [...pointByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  if (points.length < 2) {
    throw new Error("Could not parse Pump.fun cumulative buyback history from the official tracker");
  }
  return points;
}

export function formatPumpFunBuybackValue(points: PumpFunBuybackPoint[]): string {
  const latest = points.at(-1);
  const finalized = points.at(-2);
  if (!latest || !finalized) {
    throw new Error("Pump.fun buyback history needs at least two daily points");
  }

  const finalizedWindow = points.slice(Math.max(0, points.length - 8), -1);
  const sevenDayPurchases = finalizedWindow.reduce((sum, point) => sum + point.buybacksUsd, 0);
  const sevenDayAverage = finalizedWindow.length ? sevenDayPurchases / finalizedWindow.length : 0;
  const remaining = Math.max(0, targetUsd - latest.cumulativeUsd);
  const progress = Math.min(100, (latest.cumulativeUsd / targetUsd) * 100);

  return [
    "Metric: Pump.fun Total $PUMP Purchases (USD)",
    `Total purchases: ${formatUsd(latest.cumulativeUsd)}`,
    `Target: ${formatUsd(targetUsd)}`,
    `Target reached: ${latest.cumulativeUsd >= targetUsd ? "yes" : "no"}`,
    `Progress: ${formatDecimal(progress, 2)}%`,
    `Remaining: ${formatUsd(remaining)}`,
    `Latest data date: ${latest.date}`,
    `Latest provisional purchases: ${formatUsd(latest.buybacksUsd)}`,
    `Finalized date: ${finalized.date}`,
    `Finalized day purchases: ${formatUsd(finalized.buybacksUsd)}`,
    `Finalized day PUMP bought: ${formatCompactNumber(finalized.pumpTokensBought)}`,
    `Finalized day transactions: ${formatInteger(finalized.transactionCount)}`,
    `7-day purchases: ${formatUsd(sevenDayPurchases)}`,
    `7-day daily average: ${formatUsd(sevenDayAverage)}`,
    `Estimated target date at 7-day pace: ${estimateTargetDate(latest.date, remaining, sevenDayAverage)}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function shouldAlertOnPumpFunBuybackChange(previousValue: string | null, currentValue: string): boolean {
  if (!previousValue) {
    return false;
  }

  const previousReached = extractLine(previousValue, "Target reached") === "yes";
  const currentReached = extractLine(currentValue, "Target reached") === "yes";
  if (!previousReached && currentReached) {
    return true;
  }

  const previousFinalizedDate = extractLine(previousValue, "Finalized date");
  const currentFinalizedDate = extractLine(currentValue, "Finalized date");
  return Boolean(previousFinalizedDate && currentFinalizedDate && previousFinalizedDate !== currentFinalizedDate);
}

function estimateTargetDate(date: string, remaining: number, dailyAverage: number): string {
  if (remaining <= 0) {
    return "target already reached";
  }
  if (!Number.isFinite(dailyAverage) || dailyAverage <= 0) {
    return "unavailable";
  }

  const estimate = new Date(`${date}T00:00:00.000Z`);
  estimate.setUTCDate(estimate.getUTCDate() + Math.ceil(remaining / dailyAverage));
  return estimate.toISOString().slice(0, 10);
}

function extractLine(value: string, label: string): string | null {
  return value.match(new RegExp(`^${escapeRegExp(label)}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value);
}

function formatDecimal(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(value);
}
