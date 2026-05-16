import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.bea.gov/news/current-releases";

export type BeaCurrentRelease = {
  title: string;
  url: string;
  releaseDate: string;
};

export function extractLatestBeaCurrentReleaseValue(html: string): string {
  const release = extractLatestBeaCurrentRelease(html);
  return [`Title: ${release.title}`, `Date: ${release.releaseDate}`, `URL: ${release.url}`].join("\n");
}

export function extractLatestBeaCurrentRelease(html: string): BeaCurrentRelease {
  const $ = cheerio.load(html);
  const row = $("tr.release-row").first();
  const link = row.find('a[href^="/news/20"]').first();
  const title = normalizeText(link.text());
  const href = link.attr("href");
  const releaseDate = normalizeText(row.find("time").first().text());

  if (!title || !href || !releaseDate) {
    throw new Error("Could not find the latest BEA current release row");
  }

  return {
    title,
    url: new URL(href, sourceUrl).toString(),
    releaseDate
  };
}

export const beaCurrentReleasesAdapter: WebsiteAdapter = {
  id: "bea-current-releases",
  commandName: "bea",
  displayName: "BEA Current Releases",
  sourceUrl,
  defaultChannelName: "bea-releases",
  alertRoleName: "BEA Release Alerts",
  alertRoleEmoji: "\uD83D\uDCF0",
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Fixed hourly check for new BEA articles",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`BEA returned HTTP ${response.status}`);
    }

    const value = extractLatestBeaCurrentReleaseValue(await response.text());
    return {
      value,
      rawValue: value,
      unit: "latest BEA release",
      observedAt: new Date()
    };
  }
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
