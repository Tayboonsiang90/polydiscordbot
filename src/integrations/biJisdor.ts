import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.bi.go.id/en/statistik/informasi-kurs/jisdor/Default.aspx";

export type BiJisdorRate = {
  date: string;
  rate: string;
  rawRate: string;
};

export function extractLatestBiJisdorValue(html: string): string {
  const row = extractLatestBiJisdorRate(html);
  return [
    "Metric: Bank Indonesia JISDOR USD/IDR",
    `Date: ${row.date}`,
    `Rate: ${row.rate} IDR per USD`,
    `Raw rate: ${row.rawRate}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function extractLatestBiJisdorRate(html: string): BiJisdorRate {
  const $ = cheerio.load(html);

  for (const row of $("tr").toArray()) {
    const cells = $(row)
      .find("th, td")
      .map((_, cell) => normalizeText($(cell).text()))
      .get()
      .filter(Boolean);

    if (cells.length < 2 || !isJisdorDate(cells[0]) || !/Rp/i.test(cells[1])) {
      continue;
    }

    return {
      date: cells[0],
      rate: normalizeJisdorRate(cells[1]),
      rawRate: cells[1]
    };
  }

  throw new Error("Could not find the latest Bank Indonesia JISDOR USD/IDR row");
}

export const biJisdorAdapter: WebsiteAdapter = {
  id: "bi-jisdor-usd-idr",
  commandName: "jisdor",
  displayName: "Bank Indonesia JISDOR USD/IDR",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/will-usd-hit-indonesian-rupiah-by-june-30",
  defaultChannelName: "jisdor",
  alertRoleName: "BI JISDOR Alerts",
  alertRoleEmoji: "\uD83C\uDDEE\uD83C\uDDE9",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Bank Indonesia JISDOR returned HTTP ${response.status}`);
    }

    const value = extractLatestBiJisdorValue(await response.text());
    return {
      value,
      rawValue: value,
      unit: "IDR per USD",
      observedAt: new Date()
    };
  }
};

function isJisdorDate(value: string): boolean {
  return /^\d{1,2}\s+[A-Za-z]+\s+20\d{2}$/.test(value);
}

function normalizeJisdorRate(value: string): string {
  const normalized = value.replace(/Rp/gi, "").replace(/[,\s]/g, "");
  const rate = Number(normalized);
  if (!Number.isFinite(rate) || rate < 1_000 || rate > 100_000) {
    throw new Error(`Invalid Bank Indonesia JISDOR rate: ${value}`);
  }

  return rate.toFixed(2);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
