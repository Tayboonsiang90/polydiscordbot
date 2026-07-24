import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const bigBrotherUrl = "https://www.cbs.com/shows/big_brother/";

export type BigBrotherEpisode = {
  title: string;
  season?: string;
  episode?: string;
  airDate?: string;
  url: string;
  source: "CBS JSON-LD" | "CBS episode cards";
};

type JsonLdEpisode = {
  "@type"?: unknown;
  name?: unknown;
  episodeNumber?: unknown;
  url?: unknown;
  publication?: unknown;
};

export function extractLatestBigBrotherEpisodeValue(html: string): string {
  return formatBigBrotherEpisodeValue(extractLatestBigBrotherEpisode(html));
}

export function extractLatestBigBrotherEpisode(html: string): BigBrotherEpisode {
  const jsonLdEpisode = extractLatestBigBrotherJsonLdEpisode(html);
  if (jsonLdEpisode) {
    return jsonLdEpisode;
  }

  const cardEpisode = extractLatestBigBrotherCardEpisode(html);
  if (cardEpisode) {
    return cardEpisode;
  }

  throw new Error("Could not find the latest Big Brother episode on CBS");
}

export const bigBrotherEpisodesAdapter: WebsiteAdapter = {
  id: "big-brother-episodes",
  commandName: "bigbrother",
  displayName: "Big Brother Episodes",
  sourceUrl: bigBrotherUrl,
  defaultChannelName: "bigbrother",
  alertRoleName: "Big Brother Alerts",
  alertRoleEmoji: "\uD83C\uDFE0",
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "CBS Big Brother show page polling every minute for newly listed full episodes",
  shouldAlertOnChange: shouldAlertOnBigBrotherChange,
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const response = await fetchWithTimeout(bigBrotherUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`CBS Big Brother page returned HTTP ${response.status}`);
    }

    const value = keepNewestBigBrotherEpisodeValue(extractLatestBigBrotherEpisodeValue(await response.text()), integration?.lastValue);
    return {
      value,
      rawValue: value,
      unit: "latest episode",
      observedAt: new Date()
    };
  }
};

export function shouldAlertOnBigBrotherChange(previousValue: string | null, currentValue: string): boolean {
  const previousUrl = extractValueLine(previousValue, "URL");
  const currentUrl = extractValueLine(currentValue, "URL");
  if (!previousUrl || !currentUrl) {
    return true;
  }

  return normalizeCbsUrl(previousUrl) !== normalizeCbsUrl(currentUrl);
}

function extractLatestBigBrotherJsonLdEpisode(html: string): BigBrotherEpisode | null {
  const $ = cheerio.load(html);
  const candidates: BigBrotherEpisode[] = [];
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    const rawJson = $(element).contents().text().trim();
    if (!rawJson) {
      continue;
    }

    try {
      candidates.push(...extractJsonLdEpisodes(JSON.parse(rawJson)));
    } catch {
      continue;
    }
  }

  return selectNewestEpisode(candidates);
}

function extractJsonLdEpisodes(value: unknown, season?: string): BigBrotherEpisode[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractJsonLdEpisodes(item, season));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const nextSeason = extractSeasonLabel(record.containsSeason) ?? season;
  const directEpisodes = extractJsonLdEpisodeList(record.episode, nextSeason);
  const seasonEpisodes = extractJsonLdEpisodes(record.containsSeason, nextSeason);
  return [...directEpisodes, ...seasonEpisodes];
}

function extractJsonLdEpisodeList(value: unknown, season?: string): BigBrotherEpisode[] {
  const episodes = Array.isArray(value) ? value : value ? [value] : [];
  return episodes.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const episode = item as JsonLdEpisode;
    const title = normalizeText(typeof episode.name === "string" ? episode.name : "");
    const url = normalizeCbsUrl(typeof episode.url === "string" ? episode.url : "");
    if (!title || !url) {
      return [];
    }

    return [
      {
        title,
        season,
        episode: typeof episode.episodeNumber === "string" || typeof episode.episodeNumber === "number" ? String(episode.episodeNumber) : undefined,
        airDate: extractPublicationDate(episode.publication),
        url,
        source: "CBS JSON-LD" as const
      }
    ];
  });
}

function extractLatestBigBrotherCardEpisode(html: string): BigBrotherEpisode | null {
  const $ = cheerio.load(html);
  const episodes = $('a[href^="/shows/video/"]')
    .toArray()
    .flatMap((element) => {
      const link = $(element);
      const tracking = link.attr("aa-link") ?? "";
      if (!tracking.toLowerCase().startsWith("full episodes||play|")) {
        return [];
      }

      const parts = tracking.split("|");
      const title = normalizeText(parts[5] ?? "");
      const season = normalizeText(parts[6] ?? "");
      const episode = normalizeText(parts[7] ?? "");
      const airDate = normalizeCardDate(parts[8] ?? "");
      const url = normalizeCbsUrl(link.attr("href") ?? "");
      if (!title || !url) {
        return [];
      }

      return [
        {
          title,
          season,
          episode,
          airDate,
          url,
          source: "CBS episode cards" as const
        }
      ];
    });

  return selectNewestEpisode(episodes);
}

function selectNewestEpisode(episodes: BigBrotherEpisode[]): BigBrotherEpisode | null {
  return [...episodes]
    .sort((left, right) => {
      const dateDiff = getEpisodeTime(right) - getEpisodeTime(left);
      if (dateDiff !== 0) {
        return dateDiff;
      }

      return parseEpisodeNumber(right.episode) - parseEpisodeNumber(left.episode);
    })
    .at(0) ?? null;
}

function formatBigBrotherEpisodeValue(episode: BigBrotherEpisode): string {
  return [
    "Metric: CBS Big Brother latest full episode",
    `Title: ${episode.title}`,
    episode.season ? `Season: ${episode.season}` : "",
    episode.episode ? `Episode: ${episode.episode}` : "",
    episode.airDate ? `Air date: ${episode.airDate}` : "",
    `URL: ${episode.url}`,
    `Source: ${episode.source}`
  ].filter(Boolean).join("\n");
}

function keepNewestBigBrotherEpisodeValue(currentValue: string, previousValue: string | null | undefined): string {
  if (!previousValue) {
    return currentValue;
  }

  const previousTime = Date.parse(extractValueLine(previousValue, "Air date") ?? "");
  const currentTime = Date.parse(extractValueLine(currentValue, "Air date") ?? "");
  if (!Number.isNaN(previousTime) && !Number.isNaN(currentTime) && currentTime < previousTime) {
    return previousValue;
  }

  const previousEpisode = parseEpisodeNumber(extractValueLine(previousValue, "Episode"));
  const currentEpisode = parseEpisodeNumber(extractValueLine(currentValue, "Episode"));
  if (currentTime === previousTime && currentEpisode < previousEpisode) {
    return previousValue;
  }

  return currentValue;
}

function extractSeasonLabel(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = Array.isArray(value) ? value[0] : value;
  if (!record || typeof record !== "object") {
    return undefined;
  }

  const name = (record as Record<string, unknown>).name;
  if (typeof name !== "string") {
    return undefined;
  }

  const match = name.match(/\bseason\s+(\d+)\b/i);
  return match?.[1] ?? normalizeText(name);
}

function extractPublicationDate(value: unknown): string | undefined {
  const publications = Array.isArray(value) ? value : value ? [value] : [];
  for (const publication of publications) {
    if (!publication || typeof publication !== "object") {
      continue;
    }

    const startDate = (publication as Record<string, unknown>).startDate;
    if (typeof startDate === "string" && startDate.trim()) {
      return normalizeDateOnly(startDate) ?? startDate.trim();
    }
  }

  return undefined;
}

function normalizeCardDate(value: string): string | undefined {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) {
    return undefined;
  }

  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function normalizeDateOnly(value: string): string | undefined {
  const sourceDate = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (sourceDate?.[1]) {
    return sourceDate[1];
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString().slice(0, 10);
}

function getEpisodeTime(episode: BigBrotherEpisode): number {
  const parsed = Date.parse(episode.airDate ?? "");
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseEpisodeNumber(value: string | undefined | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractValueLine(value: string | null | undefined, key: string): string | null {
  if (!value) {
    return null;
  }

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.match(new RegExp(`^${escapedKey}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim() ?? null;
}

function normalizeCbsUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const url = trimmed.startsWith("http") ? trimmed : new URL(trimmed, bigBrotherUrl).toString();
  return url.replace(/\/+$/, "/");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
