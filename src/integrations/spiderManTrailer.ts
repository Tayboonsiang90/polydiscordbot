import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { EventMonitorPost, EventMonitorResult, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.youtube.com/@spiderman/videos";
const defaultPolymarketUrl =
  "https://polymarket.com/event/what-will-be-said-in-the-next-spider-man-trailer-20260612155048566";
const marketOpenedAt = new Date("2026-06-12T16:38:00.000Z");
const noTrailerValue = "No qualifying Spider-Man: Brand New Day trailer found after market creation.";

type SpiderManTrailerFeed = {
  channelName: string;
  channelUrl: string;
  feedUrl: string;
};

export type SpiderManTrailerVideo = {
  id: string;
  title: string;
  publishedAt: Date;
  url: string;
  channelName: string;
  channelUrl: string;
};

const feeds: SpiderManTrailerFeed[] = [
  {
    channelName: "Spider-Man",
    channelUrl: "https://www.youtube.com/@spiderman/videos",
    feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCP8AC-LXl5Jmp64IRIsdacg"
  },
  {
    channelName: "Sony Pictures Entertainment",
    channelUrl: "https://www.youtube.com/@sonypictures/videos",
    feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCz97F7dMxBNOfGYu3rx8aCw"
  },
  {
    channelName: "Marvel Entertainment",
    channelUrl: "https://www.youtube.com/@marvel/videos",
    feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCvC4D8onUfXzvjTOM-dBfEA"
  },
  {
    channelName: "Sony",
    channelUrl: "https://www.youtube.com/@Sony/videos",
    feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCVjS9AuBloqJJjhsy3vIfug"
  }
];

export const spiderManTrailerAdapter: WebsiteAdapter = {
  id: "spider-man-trailer",
  commandName: "spiderman",
  displayName: "Spider-Man Trailer",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "spiderman",
  alertRoleName: "Spider-Man Trailer Alerts",
  alertRoleEmoji: "\uD83D\uDD77\uFE0F",
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "YouTube RSS polling every minute across Spider-Man, Sony Pictures, Marvel, and Sony channels.",
  async fetchCurrentValue(): Promise<{ value: string; rawValue: string; unit: string; observedAt: Date }> {
    const result = await fetchSpiderManTrailerUpdates();
    const value = result.posts[0] ? formatSpiderManTrailerValue(eventPostToVideo(result.posts[0])) : noTrailerValue;
    return {
      value,
      rawValue: value,
      unit: "latest qualifying trailer",
      observedAt: result.observedAt
    };
  },
  async fetchEventUpdates(integration: Integration): Promise<EventMonitorResult> {
    return fetchSpiderManTrailerUpdates(integration);
  },
  shouldAlertOnEventPost: () => true
};

export async function fetchSpiderManTrailerUpdates(integration?: Integration): Promise<EventMonitorResult> {
  const observedAt = new Date();
  const results = await Promise.allSettled(feeds.map(fetchSpiderManFeedVideos));
  const videos = results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((video) => video.publishedAt.getTime() >= marketOpenedAt.getTime())
    .filter((video) => isQualifyingSpiderManTrailerTitle(video.title))
    .sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime());
  const failures = results
    .map((result, index) => (result.status === "rejected" ? `${feeds[index].channelName}: ${formatFailure(result.reason)}` : null))
    .filter((failure): failure is string => failure !== null);

  if (failures.length === feeds.length) {
    throw new Error(`All Spider-Man trailer feeds failed: ${failures.join("; ")}`);
  }

  return {
    posts: videos.map((video) => toEventPost(video, integration?.polymarketUrl ?? defaultPolymarketUrl, failures)),
    strikeTerms: [],
    observedAt,
    checkTitle: "Spider-Man trailer check complete",
    checkFields: [
      { name: "Qualifying trailers", value: String(videos.length), inline: true },
      { name: "Latest qualifying trailer", value: videos[0] ? formatSpiderManTrailerValue(videos[0]) : noTrailerValue, inline: false },
      { name: "Detection rule", value: "Title must mention Spider-Man/Spiderman, Brand New Day, and trailer/teaser.", inline: false },
      { name: "Market opened", value: marketOpenedAt.toISOString(), inline: false },
      { name: "Channels checked", value: feeds.map((feed) => feed.channelName).join(", "), inline: false },
      ...(failures.length ? [{ name: "Feed warnings", value: failures.join("\n"), inline: false }] : [])
    ]
  };
}

export function extractSpiderManTrailerVideos(feedXml: string, feed: SpiderManTrailerFeed): SpiderManTrailerVideo[] {
  const $ = cheerio.load(feedXml, { xmlMode: true });
  return $("entry")
    .toArray()
    .flatMap((element) => {
      const entry = $(element);
      const title = normalizeText(entry.find("title").first().text());
      const videoId = normalizeText(entry.find("yt\\:videoId").first().text());
      const href = entry.find('link[rel="alternate"]').first().attr("href");
      const publishedAt = parseDate(normalizeText(entry.find("published").first().text()));
      if (!title || !publishedAt || (!href && !videoId)) {
        return [];
      }

      return [
        {
          id: videoId || href || title,
          title,
          publishedAt,
          url: href ?? `https://www.youtube.com/watch?v=${videoId}`,
          channelName: feed.channelName,
          channelUrl: feed.channelUrl
        }
      ];
    });
}

export function isQualifyingSpiderManTrailerTitle(title: string): boolean {
  const normalized = normalizeTitle(title);
  const mentionsSpiderMan = /\bspider[\s-]?man\b/.test(normalized);
  const mentionsBrandNewDay = /\bbrand\s+new\s+day\b/.test(normalized);
  const mentionsTrailer = /\b(teaser|trailer|official\s+trailer|official\s+teaser)\b/.test(normalized);
  const disqualified =
    /\b(livestream|live\s+stream|tickets?\s+on\s+sale|practical\s+production|behind\s+the\s+scenes|bts|featurette|clip|shorts?)\b/.test(
      normalized
    );
  return mentionsSpiderMan && mentionsBrandNewDay && mentionsTrailer && !disqualified;
}

function toEventPost(video: SpiderManTrailerVideo, polymarketUrl: string, failures: string[]): EventMonitorPost {
  return {
    id: video.id,
    type: "Trailer",
    alertTitle: "Spider-Man trailer detected",
    sourceLabel: "YouTube",
    buttonLabel: "Open trailer",
    mentionAlertRole: true,
    textFieldName: "Video title",
    text: video.title,
    qualifyingText: video.title,
    postedAt: video.publishedAt,
    url: video.url,
    polymarketUrl,
    summaryFields: [
      { name: "Channel", value: video.channelName, inline: true },
      { name: "Detection", value: "Matched Spider-Man + Brand New Day + trailer/teaser after market creation.", inline: false }
    ],
    hiddenFields: [
      { name: "Channel URL", value: video.channelUrl, inline: false },
      { name: "Market opened UTC", value: marketOpenedAt.toISOString(), inline: false },
      { name: "Feeds checked", value: feeds.map((feed) => `${feed.channelName}: ${feed.feedUrl}`).join("\n"), inline: false },
      ...(failures.length ? [{ name: "Feed warnings", value: failures.join("\n"), inline: false }] : [])
    ],
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

async function fetchSpiderManFeedVideos(feed: SpiderManTrailerFeed): Promise<SpiderManTrailerVideo[]> {
  const response = await fetchWithTimeout(feed.feedUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`${feed.channelName} YouTube feed returned HTTP ${response.status}`);
  }

  return extractSpiderManTrailerVideos(await response.text(), feed);
}

function eventPostToVideo(post: EventMonitorPost): SpiderManTrailerVideo {
  return {
    id: post.id,
    title: post.text,
    publishedAt: post.postedAt,
    url: post.url,
    channelName: post.summaryFields?.find((field) => field.name === "Channel")?.value ?? "unknown",
    channelUrl: post.hiddenFields?.find((field) => field.name === "Channel URL")?.value ?? "unknown"
  };
}

function formatSpiderManTrailerValue(video: SpiderManTrailerVideo): string {
  return [
    `Title: ${video.title}`,
    `Channel: ${video.channelName}`,
    `Published: ${video.publishedAt.toISOString()}`,
    `URL: ${video.url}`,
    "Source: YouTube RSS"
  ].join("\n");
}

function normalizeTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[’']/g, "'")
    .replace(/[‐‑‒–—]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
