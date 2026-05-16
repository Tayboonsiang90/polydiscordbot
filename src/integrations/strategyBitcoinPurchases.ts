import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import { parsePolymarketDateRangeWindow } from "../polymarketQueue.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.strategy.com/purchases";
const defaultPolymarketUrl = "https://polymarket.com/event/will-microstrategy-announce-a-bitcoin-purchase-may-12-18";

type StrategyPurchaseRow = {
  uid?: string;
  date_of_purchase?: string;
  title?: string;
  count?: number;
  purchase_price?: number;
  total_purchase_price?: number;
  btc_holdings?: number;
  average_price?: number;
  x_post_plain_text?: string;
  sec?: { url?: string; filename?: string };
  publish_details?: { time?: string };
};

type StrategyNextData = {
  props?: {
    pageProps?: {
      bitcoinData?: StrategyPurchaseRow[];
    };
  };
};

export type StrategyBitcoinPurchase = {
  id: string;
  date: string;
  title: string;
  count: number;
  purchasePrice: number | null;
  totalPurchasePrice: number | null;
  btcHoldings: number | null;
  averagePrice: number | null;
  publishedAt: string | null;
  secUrl: string | null;
  xPostText: string | null;
};

export function extractStrategyBitcoinPurchaseValue(html: string, polymarketUrl: string | null, now = new Date()): string {
  const purchases = extractStrategyBitcoinPurchases(html);
  const range = getMarketDateRange(polymarketUrl ?? defaultPolymarketUrl, now);
  const matchingPurchase = range
    ? purchases.find((purchase) => purchase.date >= range.startDate && purchase.date <= range.endDate)
    : purchases[0];

  if (!matchingPurchase) {
    return [
      `Status: no Strategy BTC purchase announced${range ? " in market range" : ""}`,
      ...(range ? [`Market range: ${range.startDate} to ${range.endDate}`] : []),
      `Latest purchase date: ${purchases[0]?.date ?? "none"}`,
      `Latest purchase title: ${purchases[0]?.title ?? "none"}`
    ].join("\n");
  }

  return formatStrategyBitcoinPurchaseValue(matchingPurchase, range);
}

export function extractStrategyBitcoinPurchases(html: string): StrategyBitcoinPurchase[] {
  const nextData = extractNextData(html);
  const rows = nextData.props?.pageProps?.bitcoinData;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Could not find Strategy bitcoin purchase rows");
  }

  return rows
    .map(normalizePurchaseRow)
    .filter((purchase) => purchase !== null)
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function formatStrategyBitcoinPurchaseValue(
  purchase: StrategyBitcoinPurchase,
  range?: { startDate: string; endDate: string } | null
): string {
  return [
    "Status: Strategy BTC purchase announced",
    ...(range ? [`Market range: ${range.startDate} to ${range.endDate}`] : []),
    `Purchase date: ${purchase.date}`,
    `Title: ${purchase.title}`,
    `BTC acquired: ${formatNumber(purchase.count)}`,
    `Average purchase price: ${formatCurrency(purchase.purchasePrice)}`,
    `Purchase value: ${formatCurrency(purchase.totalPurchasePrice)}`,
    `Total BTC holdings: ${formatNumber(purchase.btcHoldings)}`,
    `Average BTC cost: ${formatCurrency(purchase.averagePrice)}`,
    `Published at: ${purchase.publishedAt ?? "not available"}`,
    `SEC filing: ${purchase.secUrl ?? "not available"}`,
    `Post: ${purchase.xPostText ?? "not available"}`
  ].join("\n");
}

export const strategyBitcoinPurchasesAdapter: WebsiteAdapter = {
  id: "strategy-bitcoin-purchases",
  commandName: "strategybtc",
  displayName: "Strategy Bitcoin Purchases",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "strategybtc",
  alertRoleName: "Strategy BTC Alerts",
  alertRoleEmoji: "\u20BF",
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html"
      }
    });

    if (!response.ok) {
      throw new Error(`Strategy returned HTTP ${response.status}`);
    }

    const value = extractStrategyBitcoinPurchaseValue(await response.text(), integration?.polymarketUrl ?? defaultPolymarketUrl);
    return {
      value,
      rawValue: value,
      unit: "bitcoin purchase announcement",
      observedAt: new Date()
    };
  }
};

function extractNextData(html: string): StrategyNextData {
  const $ = cheerio.load(html);
  const json = $("#__NEXT_DATA__").first().text();
  if (!json) {
    throw new Error("Could not find Strategy Next.js data");
  }

  try {
    return JSON.parse(json) as StrategyNextData;
  } catch {
    throw new Error("Could not parse Strategy Next.js data");
  }
}

function normalizePurchaseRow(row: StrategyPurchaseRow): StrategyBitcoinPurchase | null {
  if (!row.date_of_purchase || typeof row.count !== "number") {
    return null;
  }

  return {
    id: row.uid ?? row.date_of_purchase,
    date: row.date_of_purchase,
    title: row.title ?? row.date_of_purchase,
    count: row.count,
    purchasePrice: numberOrNull(row.purchase_price),
    totalPurchasePrice: numberOrNull(row.total_purchase_price),
    btcHoldings: numberOrNull(row.btc_holdings),
    averagePrice: numberOrNull(row.average_price),
    publishedAt: row.publish_details?.time ?? null,
    secUrl: row.sec?.url ?? null,
    xPostText: row.x_post_plain_text ?? null
  };
}

function getMarketDateRange(polymarketUrl: string, now: Date): { startDate: string; endDate: string } | null {
  const window = parsePolymarketDateRangeWindow(polymarketUrl, now);
  if (!window) {
    return null;
  }

  return {
    startDate: formatEasternDate(new Date(window.startAt)),
    endDate: formatEasternDate(new Date(window.endAt))
  };
}

function formatEasternDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatNumber(value: number | null): string {
  return value === null ? "not available" : new Intl.NumberFormat("en-US").format(value);
}

function formatCurrency(value: number | null): string {
  if (value === null) {
    return "not available";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}
