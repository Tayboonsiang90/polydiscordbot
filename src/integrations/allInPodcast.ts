import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://allin.com/episodes";

export type AllInEpisode = {
  title: string;
  date: string;
  url: string;
};

export function extractLatestAllInEpisodeValue(html: string): string {
  const episode = extractLatestAllInEpisode(html);
  return [`Title: ${episode.title}`, `Date: ${episode.date}`, `URL: ${episode.url}`].join("\n");
}

export function extractLatestAllInEpisode(html: string): AllInEpisode {
  const $ = cheerio.load(html);
  const link = $('a[href^="https://youtube.com/v/"]')
    .filter((_, anchor) => normalizeText($(anchor).text()).length > 0)
    .first();
  const title = normalizeText(link.text());
  const href = link.attr("href");
  const date = normalizeText(link.parent().prev().text()).replace(/[\[\]\u00a0]/g, "").trim();

  if (!title || !href || !date) {
    throw new Error("Could not find the latest All-In episode on allin.com");
  }

  return {
    title,
    date,
    url: normalizeYoutubeUrl(href)
  };
}

export const allInPodcastAdapter: WebsiteAdapter = {
  id: "all-in-podcast",
  commandName: "allin",
  displayName: "All-In Podcast",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/what-will-be-said-on-the-next-all-in-podcast-may-8",
  defaultChannelName: "allinpod",
  alertRoleName: "All-In Podcast Alerts",
  alertRoleEmoji: "\uD83C\uDFA7",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`All-In returned HTTP ${response.status}`);
    }

    const value = extractLatestAllInEpisodeValue(await response.text());
    return {
      value,
      rawValue: value,
      unit: "latest episode",
      observedAt: new Date()
    };
  }
};

function normalizeYoutubeUrl(url: string): string {
  const videoId = url.split("/v/").at(-1)?.split(/[?#]/)[0];
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : url;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
