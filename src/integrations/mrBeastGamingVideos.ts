import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const mrBeastGamingChannelUrl = "https://www.youtube.com/@MrBeastGaming/videos";
const mrBeastGamingFeedUrl = "https://www.youtube.com/feeds/videos.xml?channel_id=UCIPPMRA040LQr5QPyJEbmXA";
const defaultPolymarketUrl =
  "https://polymarket.com/event/what-will-mrbeast-say-during-his-next-gaming-youtube-video-20260615190245037";

export type MrBeastGamingVideo = {
  title: string;
  publishedAt: string;
  url: string;
  videoId: string;
};

export function extractLatestMrBeastGamingVideoValue(feedXml: string): string {
  return formatMrBeastGamingVideoValue(extractLatestMrBeastGamingVideo(feedXml));
}

export function extractLatestMrBeastGamingVideo(feedXml: string): MrBeastGamingVideo {
  const $ = cheerio.load(feedXml, { xmlMode: true });
  const entry = $("entry").first();
  const title = normalizeText(entry.find("title").first().text());
  const videoId = normalizeText(entry.find("yt\\:videoId").first().text());
  const href = entry.find('link[rel="alternate"]').first().attr("href");
  const publishedAt = normalizeText(entry.find("published").first().text());

  if (!title || !videoId || !publishedAt) {
    throw new Error("Could not find the latest MrBeast Gaming video in the YouTube feed");
  }

  return {
    title,
    publishedAt,
    url: href ?? `https://www.youtube.com/watch?v=${videoId}`,
    videoId
  };
}

export const mrBeastGamingVideosAdapter: WebsiteAdapter = {
  id: "mrbeast-gaming-video",
  commandName: "mrbeastgaming",
  displayName: "MrBeast Gaming Videos",
  sourceUrl: mrBeastGamingChannelUrl,
  defaultPolymarketUrl,
  defaultChannelName: "mrbeastgaming",
  alertRoleName: "MrBeast Gaming Alerts",
  alertRoleEmoji: "\uD83C\uDFAE",
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "YouTube channel RSS polling every minute for new MrBeast Gaming uploads",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(mrBeastGamingFeedUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`MrBeast Gaming YouTube feed returned HTTP ${response.status}`);
    }

    const value = extractLatestMrBeastGamingVideoValue(await response.text());
    return {
      value,
      rawValue: value,
      unit: "latest YouTube upload",
      observedAt: new Date()
    };
  }
};

function formatMrBeastGamingVideoValue(video: MrBeastGamingVideo): string {
  return [`Title: ${video.title}`, `Published: ${video.publishedAt}`, `URL: ${video.url}`, "Source: YouTube RSS"].join(
    "\n"
  );
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
