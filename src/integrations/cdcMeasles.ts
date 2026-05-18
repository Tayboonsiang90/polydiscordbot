import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.cdc.gov/measles/data-research/index.html";
const measlesCounterUrl = "https://www.cdc.gov/wcms/vizdata/measles/measles_hosp.json";
const defaultPolymarketUrl = "https://polymarket.com/event/measles-cases-in-us-by-may-31";

type CdcMeaslesCounterJson = Record<string, { total_cases?: unknown }>;

export type CdcMeaslesCounter = {
  totalCases: number;
  asOfDate?: string;
};

export function extractCdcMeaslesCounterFromJson(payload: unknown, year = "2026"): CdcMeaslesCounter {
  const yearData = payload && typeof payload === "object" ? (payload as CdcMeaslesCounterJson)[year] : undefined;
  const totalCases = parseCounterValue(Array.isArray(yearData?.total_cases) ? yearData?.total_cases[0] : yearData?.total_cases);
  if (totalCases === null) {
    throw new Error(`Could not find CDC measles ${year} total_cases counter`);
  }

  return { totalCases };
}

export function extractCdcMeaslesAsOfDate(html: string): string | undefined {
  const $ = cheerio.load(html);
  const text = $.root().text().replace(/\s+/g, " ").trim();
  const match = text.match(/As of ([A-Z][a-z]+ \d{1,2}, \d{4}),\s*[\d,]+\s+confirmed\*?\s+measles cases were reported/i);
  return match?.[1];
}

export function extractCdcMeaslesCounterFromHtml(html: string): CdcMeaslesCounter {
  const $ = cheerio.load(html);
  const text = $.root().text().replace(/\s+/g, " ").trim();
  const match = text.match(/As of ([A-Z][a-z]+ \d{1,2}, \d{4}),\s*([\d,]+)\s+confirmed\*?\s+measles cases were reported/i);
  if (!match) {
    throw new Error("Could not find CDC measles confirmed case sentence");
  }

  return {
    totalCases: Number(match[2].replace(/,/g, "")),
    asOfDate: match[1]
  };
}

export function formatCdcMeaslesValue(counter: CdcMeaslesCounter): string {
  return [
    "Metric: CDC confirmed U.S. measles cases in 2026",
    `Total cases: ${formatInteger(counter.totalCases)}`,
    `As of: ${counter.asOfDate ?? "not listed"}`
  ].join("\n");
}

export const cdcMeaslesAdapter: WebsiteAdapter = {
  id: "cdc-measles",
  commandName: "measles",
  displayName: "CDC Measles Cases",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "measles",
  alertRoleName: "CDC Measles Alerts",
  alertRoleEmoji: "\uD83E\uDDA0",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const [counterResponse, pageResponse] = await Promise.all([
      fetchWithTimeout(measlesCounterUrl, {
        headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
      }),
      fetchWithTimeout(sourceUrl, {
        headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
      })
    ]);

    if (!counterResponse.ok) {
      throw new Error(`CDC measles counter returned HTTP ${counterResponse.status}`);
    }
    if (!pageResponse.ok) {
      throw new Error(`CDC measles page returned HTTP ${pageResponse.status}`);
    }

    const counter = extractCdcMeaslesCounterFromJson(await counterResponse.json());
    const asOfDate = extractCdcMeaslesAsOfDate(await pageResponse.text());
    const value = formatCdcMeaslesValue({ ...counter, asOfDate });
    return {
      value,
      rawValue: String(counter.totalCases),
      unit: "confirmed cases",
      observedAt: new Date()
    };
  }
};

function parseCounterValue(value: unknown): number | null {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  return Number(normalized);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}
