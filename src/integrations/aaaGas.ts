import * as cheerio from "cheerio";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";
import { upsertPolymarketQueueUrl } from "../polymarketQueue.js";
import { refreshMonthlyPolymarketQueue, type MonthlyPolymarketDiscoveryConfig } from "./monthlyPolymarketDiscovery.js";

const sourceUrl = "https://gasprices.aaa.com/";
const defaultPolymarketUrl = "https://polymarket.com/event/will-gas-hit-by-end-of-august";

const monthlyDiscoveryConfig: MonthlyPolymarketDiscoveryConfig = {
  searchQuery: "will gas hit",
  slugPrefix: "will-gas-hit-by-end-of-",
  titlePrefix: "Will gas hit",
  lastDiscoveryAtKey: "lastAaaGasDiscoveryAt"
};

export function extractAaaRegularGasCurrentAvg(html: string): string {
  const $ = cheerio.load(html);

  for (const row of $("tr").toArray()) {
    const cells = $(row)
      .find("th, td")
      .map((_, cell) => normalizeText($(cell).text()))
      .get()
      .filter(Boolean);

    if (cells.length >= 2 && /^current avg\.?$/i.test(cells[0])) {
      return normalizeGasPrice(cells[1]);
    }
  }

  const pageText = normalizeText($.root().text());
  const tablePattern =
    /Regular\s+Mid-Grade\s+Premium\s+Diesel\s+E85\s+Current Avg\.?\s+\$?(\d+(?:\.\d+)?)/i;
  const tableMatch = pageText.match(tablePattern);
  if (tableMatch) {
    return normalizeGasPrice(tableMatch[1]);
  }

  const headlinePattern = /Today(?:'|’)?s AAA National Average\s+\$?(\d+(?:\.\d+)?)/i;
  const headlineMatch = pageText.match(headlinePattern);
  if (headlineMatch) {
    return normalizeGasPrice(headlineMatch[1]);
  }

  throw new Error("Could not find AAA Current Avg. Regular gas price in the response");
}

export function formatAaaRegularGasValue(publishedPrice: string): string {
  const published = Number(publishedPrice);
  const marketPrice = Math.floor(published * 100) / 100;
  return [
    "Metric: AAA national regular gas",
    `Market price: $${marketPrice.toFixed(2)} per gallon (first two decimals; no rounding)`,
    `Published price: $${published.toFixed(3)} per gallon`
  ].join("\n");
}

export const aaaRegularGasAdapter: WebsiteAdapter = {
  id: "aaa-regular-gas",
  commandName: "aaa",
  displayName: "AAA Regular Gas",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "aaa-regular-gas",
  alertRoleName: "AAA Gas Alerts",
  alertRoleEmoji: "\u26fd",
  alertOnChangeDuringMarketRollover: true,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshAaaGasPolymarketQueue(integration)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`AAA returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const value = formatAaaRegularGasValue(extractAaaRegularGasCurrentAvg(html));
    return {
      value,
      rawValue: value,
      unit: "USD per gallon",
      observedAt: new Date()
    };
  },
  shouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
    return extractMarketPrice(previousValue) !== extractMarketPrice(currentValue);
  }
};

export async function refreshAaaGasPolymarketQueue(
  integration: Integration,
  now = new Date()
): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
  const discovered = await refreshMonthlyPolymarketQueue(integration, monthlyDiscoveryConfig, now);
  return upsertPolymarketQueueUrl(
    {
      ...integration,
      settingsJson: discovered.settingsJson,
      polymarketUrl: discovered.activeUrl ?? integration.polymarketUrl
    },
    defaultPolymarketUrl,
    now
  );
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeGasPrice(value: string): string {
  const normalized = value.replace(/[$,\s]/g, "");
  const price = Number(normalized);
  if (!Number.isFinite(price) || price <= 0 || price >= 20) {
    throw new Error(`Invalid AAA Regular gas price: ${value}`);
  }

  return price.toFixed(3);
}

function extractMarketPrice(value: string | null): string {
  return value?.match(/^Market price:\s*(.+)$/m)?.[1] ?? value ?? "";
}

