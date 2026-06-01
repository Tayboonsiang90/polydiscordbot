import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, EventMonitorPost, EventMonitorResult, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.whitehouse.gov/briefings-statements/";
const maxPosts = 10;

export type WhiteHouseBriefing = {
  id: string;
  title: string;
  url: string;
  publishedAt: Date;
  category: string;
};

export function extractWhiteHouseBriefings(html: string): WhiteHouseBriefing[] {
  const $ = cheerio.load(html);
  const posts = $(".wp-block-post")
    .toArray()
    .map((element) => {
      const post = $(element);
      const link = post.find(".wp-block-post-title a, h2 a, a").first();
      const title = normalizeText(link.text());
      const href = link.attr("href");
      const time = post.find("time").first();
      const datetime = time.attr("datetime");
      const publishedAt = datetime ? new Date(datetime) : null;
      const category = normalizeText(post.find(".taxonomy-category, .wp-block-post-terms").first().text()) || "Briefings & Statements";
      if (!title || !href || !publishedAt || Number.isNaN(publishedAt.getTime())) {
        return null;
      }

      const url = new URL(href, sourceUrl).toString();
      return {
        id: getWhiteHouseBriefingId(url),
        title,
        url,
        publishedAt,
        category
      };
    })
    .filter((post): post is WhiteHouseBriefing => post !== null);

  if (posts.length === 0) {
    throw new Error("Could not find White House briefing or statement posts");
  }

  return dedupeBriefings(posts).sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime());
}

export function extractLatestWhiteHouseBriefingValue(html: string): string {
  return formatWhiteHouseBriefingValue(extractWhiteHouseBriefings(html)[0]);
}

export function formatWhiteHouseBriefingValue(post: WhiteHouseBriefing): string {
  return [
    `Title: ${post.title}`,
    `Category: ${post.category}`,
    `Published at: ${post.publishedAt.toISOString()}`,
    `URL: ${post.url}`
  ].join("\n");
}

export const whiteHouseBriefingsAdapter: WebsiteAdapter = {
  id: "white-house-briefings",
  commandName: "whbriefings",
  displayName: "White House Briefings",
  sourceUrl,
  defaultChannelName: "whbriefings",
  alertRoleName: "White House Briefing Alerts",
  alertRoleEmoji: "\uD83C\uDFDB\uFE0F",
  getPollIntervalMinutes: () => 15,
  getPollIntervalReason: () => "Fixed 15-minute check for new White House briefings and statements",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const posts = await fetchWhiteHouseBriefings();
    const value = formatWhiteHouseBriefingValue(posts[0]);
    return {
      value,
      rawValue: value,
      unit: "latest White House briefing or statement",
      observedAt: new Date()
    };
  },
  async fetchEventUpdates(_integration: Integration): Promise<EventMonitorResult> {
    const posts = (await fetchWhiteHouseBriefings()).slice(0, maxPosts).map(toEventPost);
    return {
      posts,
      strikeTerms: [],
      checkTitle: "Latest briefings and statements",
      checkFields: [
        { name: "Posts scanned", value: String(posts.length), inline: true },
        { name: "Latest title", value: posts[0]?.text ?? "none", inline: false },
        { name: "Latest source", value: posts[0]?.url ?? "none", inline: false }
      ],
      observedAt: new Date()
    };
  }
};

async function fetchWhiteHouseBriefings(): Promise<WhiteHouseBriefing[]> {
  const response = await fetchWithTimeout(sourceUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`White House briefings returned HTTP ${response.status}`);
  }

  return extractWhiteHouseBriefings(await response.text());
}

function toEventPost(post: WhiteHouseBriefing): EventMonitorPost {
  return {
    id: post.id,
    type: "White House briefing/statement",
    alertTitle: "New briefing or statement",
    sourceLabel: "White House",
    buttonLabel: "Open statement",
    mentionAlertRole: true,
    textFieldName: "Title",
    text: post.title,
    qualifyingText: post.title,
    postedAt: post.publishedAt,
    url: post.url,
    fields: [{ name: "Category", value: post.category, inline: true }],
    hideLinksField: true,
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

function getWhiteHouseBriefingId(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/\/+$/, "") || parsed.toString();
  } catch {
    return url;
  }
}

function dedupeBriefings(posts: WhiteHouseBriefing[]): WhiteHouseBriefing[] {
  const seen = new Set<string>();
  const deduped: WhiteHouseBriefing[] = [];
  for (const post of posts) {
    if (seen.has(post.id)) {
      continue;
    }

    seen.add(post.id);
    deduped.push(post);
  }

  return deduped;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
