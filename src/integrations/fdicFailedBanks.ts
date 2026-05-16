import * as cheerio from "cheerio";
import type { AdapterValue, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";

const sourceUrl = "https://www.fdic.gov/resources/resolutions/bank-failures/failed-bank-list/";

export type FdicFailedBank = {
  bankName: string;
  city: string;
  state: string;
  cert: string;
  acquiringInstitution: string;
  closingDate: string;
  fund: string;
};

export function extractLatestFdicFailedBankValue(html: string): string {
  const bank = extractLatestFdicFailedBank(html);
  return [
    `Bank: ${bank.bankName}`,
    `Location: ${bank.city}, ${bank.state}`,
    `Closing date: ${bank.closingDate}`,
    `Acquiring institution: ${bank.acquiringInstitution}`,
    `Cert: ${bank.cert}`,
    `Fund: ${bank.fund}`
  ].join("\n");
}

export function extractLatestFdicFailedBank(html: string): FdicFailedBank {
  const $ = cheerio.load(html);
  const row = $("tbody tr").first();
  const cells = row
    .find("td")
    .map((_, cell) => normalizeText($(cell).text()))
    .get();

  if (cells.length < 7 || !cells[0] || !cells[5]) {
    throw new Error("Could not find the latest failed bank row in the FDIC response");
  }

  return {
    bankName: cells[0],
    city: cells[1],
    state: cells[2],
    cert: cells[3],
    acquiringInstitution: cells[4],
    closingDate: cells[5],
    fund: cells[6]
  };
}

export const fdicFailedBanksAdapter: WebsiteAdapter = {
  id: "fdic-failed-banks",
  commandName: "fdic",
  displayName: "FDIC Failed Bank List",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/us-bank-failure-by-may-31-911",
  defaultChannelName: "fdic-failed-banks",
  alertRoleName: "FDIC Failed Bank Alerts",
  alertRoleEmoji: "\uD83C\uDFE6",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`FDIC returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const value = extractLatestFdicFailedBankValue(html);
    return {
      value,
      rawValue: value,
      unit: "latest failed bank row",
      observedAt: new Date()
    };
  }
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

