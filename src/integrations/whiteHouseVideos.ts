import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { fetchWithTimeout } from "../http.js";
import { formatEasternDateTime } from "../time.js";
import type { AdapterValue, EventMonitorPost, EventMonitorResult, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.whitehouse.gov/videos/";
const maxVideos = 20;

export type WhiteHouseVideoFormat = "Livestream" | "Short" | "Video";

export type WhiteHouseVideo = {
  id: string;
  title: string;
  url: string;
  publishedAt: Date;
  duration: string | null;
  format: WhiteHouseVideoFormat;
  youtubeUrl: string | null;
};

type VideoJsonLd = {
  "@type"?: unknown;
  embedUrl?: unknown;
};

export const whiteHouseVideosAdapter: WebsiteAdapter = {
  id: "white-house-videos",
  commandName: "whvideos",
  displayName: "White House Videos",
  sourceUrl,
  defaultChannelName: "whvideos",
  alertRoleName: "White House Video Alerts",
  alertRoleEmoji: "\u{1F3AC}",
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "Fixed 1-minute check for new or revised videos on the official White House Videos page",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const videos = await fetchWhiteHouseVideos();
    const value = formatWhiteHouseVideoValue(videos[0]);
    return {
      value,
      rawValue: formatWhiteHouseVideoFingerprint(videos[0]),
      unit: "latest White House video",
      observedAt: new Date()
    };
  },
  async fetchEventUpdates(_integration: Integration): Promise<EventMonitorResult> {
    const observedAt = new Date();
    const videos = await fetchWhiteHouseVideos();
    const posts = videos.slice(0, maxVideos).map(toEventPost);
    return {
      posts,
      strikeTerms: [],
      checkTitle: "Latest White House videos",
      checkFields: [
        { name: "Videos scanned", value: String(posts.length), inline: true },
        { name: "Latest", value: videos[0]?.title ?? "none", inline: false },
        { name: "Published (ET)", value: videos[0] ? formatEasternDateTime(videos[0].publishedAt) : "unknown", inline: true },
        { name: "Watch", value: videos[0]?.url ?? sourceUrl, inline: false }
      ],
      observedAt
    };
  }
};

export function extractWhiteHouseVideos(html: string): WhiteHouseVideo[] {
  const $ = cheerio.load(html);
  const videos = $(".wp-block-post")
    .toArray()
    .map((element) => {
      const post = $(element);
      const card = post.find(".wp-block-whitehouse-past-event").first();
      const titleLink = card.find(".wp-block-whitehouse-past-event__title a, h2 a, h3 a").first();
      const title = normalizeText(titleLink.text()) || normalizeText(titleLink.attr("title") ?? "");
      const href = titleLink.attr("href");
      const datetime = card.find("time[datetime]").first().attr("datetime");
      const publishedAt = datetime ? new Date(datetime) : null;
      if (!title || !href || !publishedAt || Number.isNaN(publishedAt.getTime())) {
        return null;
      }

      const url = normalizeWhiteHouseVideoUrl(href);
      if (!url) {
        return null;
      }

      return {
        id: getStableVideoId(url),
        title,
        url,
        publishedAt,
        duration: normalizeText(card.find(".wp-block-whitehouse-past-event__duration").first().text()) || null,
        format: parseWhiteHouseVideoFormat(post.attr("class") ?? ""),
        youtubeUrl: extractYoutubeUrl($, card)
      } satisfies WhiteHouseVideo;
    })
    .filter((video): video is WhiteHouseVideo => video !== null);

  if (videos.length === 0) {
    throw new Error("Could not find White House video posts");
  }

  return dedupeVideos(videos).sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime());
}

export function formatWhiteHouseVideoValue(video: WhiteHouseVideo): string {
  return [
    `Title: ${video.title}`,
    `Format: ${video.format}`,
    `Published at: ${formatEasternDateTime(video.publishedAt)}`,
    `Duration: ${video.duration ?? "not listed"}`,
    `White House: ${video.url}`,
    `YouTube: ${video.youtubeUrl ?? "not listed"}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

async function fetchWhiteHouseVideos(): Promise<WhiteHouseVideo[]> {
  const response = await fetchWithTimeout(sourceUrl, {
    headers: {
      accept: "text/html",
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`White House Videos returned HTTP ${response.status}`);
  }

  return extractWhiteHouseVideos(await response.text());
}

function toEventPost(video: WhiteHouseVideo): EventMonitorPost {
  return {
    id: `white-house-video:${video.id}:${formatWhiteHouseVideoFingerprint(video)}`,
    type: "White House video",
    alertTitle: "New or updated White House video",
    sourceLabel: "White House",
    buttonLabel: "Watch video",
    mentionAlertRole: true,
    textFieldName: "Video",
    text: video.title,
    qualifyingText: video.title,
    postedAt: video.publishedAt,
    url: video.url,
    summaryFields: [
      { name: "Title", value: video.title, inline: false },
      { name: "Format", value: video.format, inline: true },
      { name: "Duration", value: video.duration ?? "not listed", inline: true },
      ...(video.youtubeUrl ? [{ name: "YouTube", value: video.youtubeUrl, inline: false }] : [])
    ],
    hideLinksField: true,
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

function extractYoutubeUrl($: cheerio.CheerioAPI, card: cheerio.Cheerio<AnyNode>): string | null {
  for (const script of card.find('script[type="application/ld+json"]').toArray()) {
    const rawJson = $(script).contents().text().trim();
    if (!rawJson) {
      continue;
    }

    try {
      const parsed = JSON.parse(rawJson) as VideoJsonLd;
      if (parsed["@type"] !== "VideoObject" || typeof parsed.embedUrl !== "string") {
        continue;
      }

      const url = new URL(parsed.embedUrl);
      if (/^(?:www\.)?youtube\.com$/i.test(url.hostname) || /^youtu\.be$/i.test(url.hostname)) {
        return url.toString();
      }
    } catch {
      continue;
    }
  }

  return null;
}

function parseWhiteHouseVideoFormat(classes: string): WhiteHouseVideoFormat {
  if (/\bpast_event_type-live\b/.test(classes)) {
    return "Livestream";
  }
  if (/\bpast_event_type-short\b/.test(classes)) {
    return "Short";
  }
  return "Video";
}

function formatWhiteHouseVideoFingerprint(video: WhiteHouseVideo): string {
  return createHash("sha256")
    .update([video.title, video.format, video.publishedAt.toISOString(), video.duration ?? "", video.youtubeUrl ?? ""].join("|"))
    .digest("hex")
    .slice(0, 16);
}

function normalizeWhiteHouseVideoUrl(value: string): string | null {
  try {
    const url = new URL(value, sourceUrl);
    if (url.hostname !== "www.whitehouse.gov" || !url.pathname.startsWith("/videos/")) {
      return null;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function getStableVideoId(url: string): string {
  return new URL(url).pathname.replace(/^\/videos\//, "").replace(/\/$/, "");
}

function dedupeVideos(videos: WhiteHouseVideo[]): WhiteHouseVideo[] {
  const seen = new Set<string>();
  return videos.filter((video) => {
    if (seen.has(video.id)) {
      return false;
    }
    seen.add(video.id);
    return true;
  });
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
