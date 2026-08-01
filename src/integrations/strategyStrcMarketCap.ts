import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import {
  refreshGammaPolymarketQueue,
  upsertGammaPolymarketQueueUrl,
  type GammaPolymarketDiscoveryConfig
} from "./gammaPolymarketDiscovery.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.strategy.com/strc";
const apiUrl = "https://api.strategy.com/btc/strcKpiData";
const defaultPolymarketUrl = "https://polymarket.com/event/what-market-cap-will-strc-reach-by-july-31-2026";
const defaultStrikesMillions = [10_000, 12_000, 14_000, 16_000];
const discoveryConfig: GammaPolymarketDiscoveryConfig = {
  searchQuery: "STRC market cap",
  slugPrefixes: ["what-market-cap-will-strc-reach-by-"],
  titlePrefixes: ["What market cap will STRC reach by"],
  lastDiscoveryAtKey: "lastStrategyStrcMarketDiscoveryAt",
  limit: 20
};

export type StrategyStrcMarketCapSnapshot = {
  marketCapMillions: number;
  previousDayMarketCapMillions: number | null;
  changeMillions: number | null;
  changePercent: number | null;
  sourceTimestamp: string | null;
};

type GammaEvent = {
  markets?: Array<{
    active?: boolean;
    archived?: boolean;
    closed?: boolean;
    question?: string;
    groupItemTitle?: string;
    outcomePrices?: string;
  }>;
};

export const strategyStrcMarketCapAdapter: WebsiteAdapter = {
  id: "strategy-strc-market-cap",
  commandName: "strcmarketcap",
  displayName: "Strategy STRC Market Cap",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "strcmarketcap",
  alertRoleName: "STRC Market Cap Alerts",
  alertRoleEmoji: "\uD83D\uDCC8",
  getPollIntervalMinutes: () => 0.25,
  getPollIntervalReason: () => "Fixed 15-second official STRC market-cap strike watch; ordinary value changes do not alert",
  getErrorNoticeWindowMinutes: () => 30,
  shouldAlertOnChange: shouldAlertOnStrategyStrcMarketCapChange,
  async refreshSettings(integration: Integration): Promise<string> {
    return (
      await refreshGammaPolymarketQueue(integration, discoveryConfig)
    ).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async upsertPolymarketMarket(
    integration: Integration,
    url: string
  ): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertGammaPolymarketQueueUrl(integration, url, discoveryConfig);
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const response = await fetchWithTimeout(apiUrl, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });
    if (!response.ok) {
      throw new Error(`Strategy STRC KPI API returned HTTP ${response.status}`);
    }

    const snapshot = parseStrategyStrcMarketCapSnapshot(await response.json());
    const polymarketUrl = integration?.polymarketUrl ?? defaultPolymarketUrl;
    const storedStrikes = parseStoredStrikes(integration?.lastValue ?? null, polymarketUrl);
    const strikes = storedStrikes.length ? storedStrikes : await fetchStrategyStrcStrikes(polymarketUrl);
    const value = formatStrategyStrcMarketCapValue(snapshot, strikes, integration?.lastValue ?? null, polymarketUrl);
    return {
      value,
      rawValue: snapshot.marketCapMillions.toFixed(1),
      unit: "USD millions market cap",
      observedAt: new Date()
    };
  }
};

export function parseStrategyStrcMarketCapSnapshot(data: unknown): StrategyStrcMarketCapSnapshot {
  const record = Array.isArray(data) ? data[0] : data;
  if (!isRecord(record)) {
    throw new Error("Strategy STRC KPI response was not an object");
  }

  const marketCapMillions = parseNumber(record.marketCap);
  if (marketCapMillions === null || marketCapMillions <= 0) {
    throw new Error("Could not parse Strategy STRC Market Cap ($M)");
  }

  const previousDayMarketCapMillions = parseNumber(record.prevDayMarketCap);
  const rawChange = parseNumber(record.marketCapVarVal);
  const changeMillions = rawChange === null ? null : record.marketCapNeg === true ? -Math.abs(rawChange) : Math.abs(rawChange);
  const rawPercent = parseNumber(record.marketCapVarPerc);
  const changePercent = rawPercent === null ? null : record.marketCapNeg === true ? -Math.abs(rawPercent) : Math.abs(rawPercent);
  const sourceTimestamp = normalizeUtcTimestamp(record.timeStampUtc);

  return {
    marketCapMillions,
    previousDayMarketCapMillions,
    changeMillions,
    changePercent,
    sourceTimestamp
  };
}

export function extractStrategyStrcStrikes(data: unknown): number[] {
  const event = Array.isArray(data) ? (data[0] as GammaEvent | undefined) : (data as GammaEvent | undefined);
  const strikes = new Set<number>();

  for (const market of event?.markets ?? []) {
    if (isResolvedMarket(market)) {
      continue;
    }

    const text = [market.groupItemTitle, market.question].filter(Boolean).join(" ");
    const match = text.match(/\$([\d,.]+)\s*B\b/i);
    const billions = match ? Number(match[1].replace(/,/g, "")) : Number.NaN;
    if (Number.isFinite(billions) && billions > 0) {
      strikes.add(billions * 1_000);
    }
  }

  return [...strikes].sort((left, right) => left - right);
}

export function formatStrategyStrcMarketCapValue(
  snapshot: StrategyStrcMarketCapSnapshot,
  strikesMillions: number[],
  previousValue: string | null,
  polymarketUrl: string
): string {
  const sameMarket = extractLine(previousValue, "Alerted For") === polymarketUrl;
  const previousHighWater = sameMarket ? parseNumber(extractLine(previousValue, "Monitoring high-water ($M)")) : null;
  const highWater = Math.max(snapshot.marketCapMillions, previousHighWater ?? snapshot.marketCapMillions);
  const alerted = sameMarket ? new Set(parseStrikeList(extractLine(previousValue, "Alerted strikes"))) : new Set<number>();

  if (!sameMarket || !previousValue) {
    for (const strike of strikesMillions) {
      if (strike <= snapshot.marketCapMillions) {
        alerted.add(strike);
      }
    }
  }

  const newlyHit = previousValue && sameMarket
    ? strikesMillions.filter((strike) => strike <= highWater && !alerted.has(strike))
    : [];
  for (const strike of newlyHit) {
    alerted.add(strike);
  }

  const openStrikes = strikesMillions.filter((strike) => !alerted.has(strike));
  const nextStrike = openStrikes.find((strike) => strike > highWater) ?? null;
  return [
    "Metric: Strategy STRC Market Cap ($M)",
    `Market cap: ${formatMarketCap(snapshot.marketCapMillions)}`,
    `Previous day market cap: ${snapshot.previousDayMarketCapMillions === null ? "not available" : formatMarketCap(snapshot.previousDayMarketCapMillions)}`,
    `Daily change: ${formatChange(snapshot.changeMillions, snapshot.changePercent)}`,
    `Monitoring high-water: ${formatMarketCap(highWater)}`,
    `Monitoring high-water ($M): ${highWater.toFixed(1)}`,
    `Newly hit strikes: ${newlyHit.length ? newlyHit.map(formatStrike).join(", ") : "none"}`,
    `Alerted strikes: ${alerted.size ? [...alerted].sort((left, right) => left - right).map(formatStrike).join(", ") : "none"}`,
    `Tracked strikes: ${strikesMillions.length ? strikesMillions.map(formatStrike).join(", ") : "none"}`,
    `Next open strike: ${nextStrike === null ? "none" : `${formatStrike(nextStrike)} (${formatMillions(nextStrike - highWater)} away)`}`,
    `Source time: ${formatEasternTimestamp(snapshot.sourceTimestamp)}`,
    `Resolution: ${sourceUrl}`,
    `Alerted For: ${polymarketUrl}`
  ].join("\n");
}

export function shouldAlertOnStrategyStrcMarketCapChange(_previousValue: string | null, currentValue: string): boolean {
  const newlyHit = extractLine(currentValue, "Newly hit strikes");
  return Boolean(newlyHit && newlyHit !== "none");
}

async function fetchStrategyStrcStrikes(polymarketUrl: string): Promise<number[]> {
  const slug = getPolymarketSlug(polymarketUrl);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${polymarketUrl}`);
  }

  try {
    const response = await fetchWithTimeout(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });
    if (response.ok) {
      const strikes = extractStrategyStrcStrikes(await response.json());
      if (strikes.length) {
        return strikes;
      }
    }
  } catch {
    // The known July strikes remain usable if Gamma is temporarily unavailable.
  }

  return slug === getPolymarketSlug(defaultPolymarketUrl) ? defaultStrikesMillions : [];
}

function parseStoredStrikes(previousValue: string | null, polymarketUrl: string): number[] {
  if (extractLine(previousValue, "Alerted For") !== polymarketUrl) {
    return [];
  }
  return parseStrikeList(extractLine(previousValue, "Tracked strikes"));
}

function parseStrikeList(value: string | null): number[] {
  if (!value || value === "none") {
    return [];
  }
  return [...value.matchAll(/\$([\d,.]+)B/g)]
    .map((match) => Number(match[1].replace(/,/g, "")) * 1_000)
    .filter((strike) => Number.isFinite(strike) && strike > 0);
}

function isResolvedMarket(market: NonNullable<GammaEvent["markets"]>[number]): boolean {
  if (market.closed || market.archived || market.active === false) {
    return true;
  }
  if (!market.outcomePrices) {
    return false;
  }
  try {
    const prices = JSON.parse(market.outcomePrices) as unknown;
    return Array.isArray(prices) && prices.some((price) => Number(price) === 1);
  } catch {
    return false;
  }
}

function extractLine(value: string | null, label: string): string | null {
  if (!value) {
    return null;
  }
  return value.match(new RegExp(`^${escapeRegExp(label)}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
}

function parseNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function normalizeUtcTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const timestamp = value.endsWith("Z") ? value : `${value}Z`;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function formatMarketCap(valueMillions: number): string {
  return `${formatMillions(valueMillions)} (${formatBillions(valueMillions)})`;
}

function formatMillions(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
}

function formatBillions(valueMillions: number): string {
  return `$${(valueMillions / 1_000).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}B`;
}

function formatStrike(valueMillions: number): string {
  return `$${(valueMillions / 1_000).toLocaleString("en-US", { maximumFractionDigits: 3 })}B`;
}

function formatChange(changeMillions: number | null, changePercent: number | null): string {
  if (changeMillions === null && changePercent === null) {
    return "not available";
  }
  const amount = changeMillions === null ? "not available" : `${changeMillions >= 0 ? "+" : "-"}$${Math.abs(changeMillions).toFixed(1)}M`;
  const percent = changePercent === null ? "" : ` (${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%)`;
  return `${amount}${percent}`;
}

function formatEasternTimestamp(value: string | null): string {
  if (!value) {
    return "not available";
  }
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).format(new Date(value))} ET`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
