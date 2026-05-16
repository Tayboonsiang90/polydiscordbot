import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.bls.gov/bls/news-release/cpi.htm";

export type BlsCpiRelease = {
  title: string;
  url: string;
};

export function extractLatestBlsCpiReleaseValue(html: string): string {
  const release = extractLatestBlsCpiRelease(html);
  return [`Title: ${release.title}`, `URL: ${release.url}`].join("\n");
}

export function extractLatestBlsCpiRelease(html: string): BlsCpiRelease {
  const $ = cheerio.load(html);
  const currentYearHeading = $("h4")
    .filter((_, heading) => /^\d{4} Consumer Price Index$/.test(normalizeText($(heading).text())))
    .first();
  const link = currentYearHeading.next("ul").find('a[href^="/news.release/archives/cpi_"][href$=".htm"]').first();
  const title = normalizeText(link.text());
  const href = link.attr("href");

  if (!title || !href) {
    throw new Error("Could not find the latest BLS CPI archive release");
  }

  return {
    title,
    url: new URL(href, sourceUrl).toString()
  };
}

export const blsCpiReleasesAdapter: WebsiteAdapter = {
  id: "bls-cpi-releases",
  commandName: "blscpi",
  displayName: "BLS CPI Releases",
  sourceUrl,
  defaultChannelName: "blscpi-releases",
  alertRoleName: "BLS CPI Release Alerts",
  alertRoleEmoji: "\uD83D\uDCC8",
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Fixed hourly check for new BLS CPI articles",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`BLS returned HTTP ${response.status}`);
    }

    const value = extractLatestBlsCpiReleaseValue(await response.text());
    return {
      value,
      rawValue: value,
      unit: "latest BLS CPI release",
      observedAt: new Date()
    };
  }
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
