import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.stats.gov.cn/english/PressRelease/";

export type NbsPressRelease = {
  title: string;
  date: string;
  url: string;
};

export function extractLatestNbsPressReleaseValue(html: string): string {
  const release = extractLatestNbsPressRelease(html);
  return [`Title: ${release.title}`, `Date: ${release.date}`, `URL: ${release.url}`].join("\n");
}

export function extractLatestNbsPressRelease(html: string): NbsPressRelease {
  const $ = cheerio.load(html);
  const candidates = $("a")
    .map((_, anchor) => {
      const link = $(anchor);
      const title = normalizeTitle(link.text());
      const href = link.attr("href");
      const date = findDate(link.parent().text()) ?? findDate(link.closest("li").text()) ?? findDate(link.closest("tr").text());
      if (!title || !href || !date || !isPressReleaseLink(href)) {
        return null;
      }

      return {
        title,
        date,
        url: new URL(href, sourceUrl).toString()
      };
    })
    .get()
    .filter((release): release is NbsPressRelease => Boolean(release));

  if (candidates.length === 0) {
    throw new Error("Could not find the latest NBS press release row");
  }

  return candidates[0];
}

export const nbsPressReleaseAdapter: WebsiteAdapter = {
  id: "nbs-press-release",
  commandName: "nbs",
  displayName: "NBS Press Releases",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/china-gdp-growth-yy-in-q2-2026",
  defaultChannelName: "nbs-press",
  alertRoleName: "NBS Press Release Alerts",
  alertRoleEmoji: "\uD83C\uDDE8\uD83C\uDDF3",
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Fixed hourly check for new NBS press releases",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`NBS returned HTTP ${response.status}`);
    }

    const value = extractLatestNbsPressReleaseValue(await response.text());
    return {
      value,
      rawValue: value,
      unit: "latest NBS press release",
      observedAt: new Date()
    };
  }
};

function isPressReleaseLink(href: string): boolean {
  return /(?:^\.?\/?\d{6}\/|\/english\/PressRelease\/\d{6}\/|\/english\/PressRelease\/\d{4})/.test(href);
}

function findDate(value: string): string | null {
  return value.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] ?? null;
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/^\d+\.\s*/, "");
}
