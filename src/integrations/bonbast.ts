import * as cheerio from "cheerio";
import type { AdapterValue, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";

const sourceUrl = "https://www.bonbast.com/graph/usd";

export function extractBonbastUsdIrrValue(html: string): string {
  const $ = cheerio.load(html);
  const text = $.root().text();
  const scriptText = $("script")
    .map((_, element) => $(element).text())
    .get()
    .join("\n");
  const searchableText = `${text}\n${scriptText}`;
  const numericMatches = searchableText.match(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d{5,9}(?:\.\d+)?\b/g) ?? [];

  const candidates = numericMatches
    .map((match) => Number(match.replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value >= 10_000 && value <= 10_000_000);

  if (candidates.length === 0) {
    throw new Error("Could not find a Bonbast USD/IRR value in the response");
  }

  return String(candidates.at(-1));
}

export const bonbastUsdIrrAdapter: WebsiteAdapter = {
  id: "bonbast-usd-irr",
  commandName: "bonbast",
  displayName: "Bonbast USD/IRR",
  sourceUrl,
  defaultChannelName: "bonbast-usd-irr",
  alertRoleName: "Bonbast Alerts",
  alertRoleEmoji: "\uD83D\uDCB1",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Bonbast returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const value = extractBonbastUsdIrrValue(html);
    return {
      value,
      rawValue: value,
      unit: "IRR per USD",
      observedAt: new Date()
    };
  }
};

