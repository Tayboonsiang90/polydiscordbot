import { fetchWithTimeout } from "../http.js";
import { formatEasternDateTime } from "../time.js";
import type { AdapterValue, EventMonitorPost, EventMonitorResult, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.youtube.com/@WhiteHouse/streams";
const maxStreams = 15;

export type WhiteHouseYoutubeStreamStatus = "Live" | "Scheduled" | "Streamed";

export type WhiteHouseYoutubeStream = {
  videoId: string;
  title: string;
  status: WhiteHouseYoutubeStreamStatus;
  scheduledAt: Date | null;
  listedText: string | null;
  url: string;
};

export const whiteHouseYoutubeStreamsAdapter: WebsiteAdapter = {
  id: "white-house-youtube-streams",
  commandName: "whstreams",
  displayName: "White House YouTube Streams",
  sourceUrl,
  defaultChannelName: "whstreams",
  alertRoleName: "White House Stream Alerts",
  alertRoleEmoji: "\u{1F4FA}",
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "Fixed 1-minute check of the official White House YouTube Streams page",
  shouldAlertOnChange: shouldAlertOnWhiteHouseYoutubeStreamChange,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const streams = await fetchWhiteHouseYoutubeStreams();
    const value = formatWhiteHouseYoutubeStreamValue(streams[0]);
    return {
      value,
      rawValue: formatWhiteHouseYoutubeStreamAlertKey(streams[0]),
      unit: "latest White House YouTube stream",
      observedAt: new Date()
    };
  },
  async fetchEventUpdates(_integration: Integration): Promise<EventMonitorResult> {
    const observedAt = new Date();
    const streams = await fetchWhiteHouseYoutubeStreams();
    return {
      posts: streams.slice(0, maxStreams).map((stream) => toEventPost(stream, observedAt)),
      strikeTerms: [],
      checkTitle: "Latest official YouTube streams",
      checkFields: [
        { name: "Latest stream", value: streams[0]?.title ?? "none", inline: false },
        { name: "Status", value: streams[0]?.status ?? "unknown", inline: true },
        { name: "Watch", value: streams[0]?.url ?? sourceUrl, inline: false }
      ],
      observedAt
    };
  }
};

export function extractWhiteHouseYoutubeStreams(html: string): WhiteHouseYoutubeStream[] {
  const initialData = extractYtInitialData(html);
  const streams: WhiteHouseYoutubeStream[] = [];
  const seen = new Set<string>();

  walkJson(initialData, (record) => {
    const candidates = [record.lockupViewModel, record.videoRenderer, record.gridVideoRenderer];
    for (const candidate of candidates) {
      const stream = parseStreamRenderer(candidate);
      if (!stream || seen.has(stream.videoId)) {
        continue;
      }

      seen.add(stream.videoId);
      streams.push(stream);
    }
  });

  if (streams.length === 0) {
    throw new Error("Could not find any streams on the official White House YouTube Streams page");
  }

  return streams;
}

export function formatWhiteHouseYoutubeStreamValue(stream: WhiteHouseYoutubeStream): string {
  return [
    `Status: ${stream.status}`,
    `Title: ${stream.title}`,
    `Scheduled at: ${stream.scheduledAt ? formatEasternDateTime(stream.scheduledAt) : "not listed"}`,
    `Listed: ${stream.listedText ?? "not listed"}`,
    `URL: ${stream.url}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function shouldAlertOnWhiteHouseYoutubeStreamChange(previousValue: string | null, currentValue: string): boolean {
  if (!previousValue) {
    return false;
  }

  return extractWhiteHouseYoutubeStreamValueAlertKey(previousValue) !== extractWhiteHouseYoutubeStreamValueAlertKey(currentValue);
}

async function fetchWhiteHouseYoutubeStreams(): Promise<WhiteHouseYoutubeStream[]> {
  const response = await fetchWithTimeout(sourceUrl, {
    headers: {
      accept: "text/html",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`White House YouTube Streams returned HTTP ${response.status}`);
  }

  return extractWhiteHouseYoutubeStreams(await response.text());
}

function parseStreamRenderer(value: unknown): WhiteHouseYoutubeStream | null {
  const renderer = asRecord(value);
  if (!renderer) {
    return null;
  }

  const videoId = readString(renderer.contentId) ?? readString(renderer.videoId);
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return null;
  }

  const title =
    readStringAt(renderer, ["metadata", "lockupMetadataViewModel", "title", "content"]) ??
    readText(renderer.title);
  if (!title) {
    return null;
  }

  const metadataSource =
    readAt(renderer, ["metadata", "lockupMetadataViewModel", "metadata", "contentMetadataViewModel"]) ?? renderer.publishedTimeText;
  const statusSource = [renderer.contentImage, renderer.thumbnailOverlays, renderer.badges, renderer.upcomingEventData];
  const metadataText = collectDisplayText(metadataSource);
  const statusText = collectDisplayText(statusSource);
  const scheduledAt = extractScheduledAt(renderer);
  const status = classifyStreamStatus(renderer, statusText, scheduledAt);
  const listedText = selectListedText([...metadataText, ...statusText]);

  return {
    videoId,
    title,
    status,
    scheduledAt,
    listedText,
    url: `https://www.youtube.com/watch?v=${videoId}`
  };
}

function classifyStreamStatus(
  renderer: Record<string, unknown>,
  statusText: string[],
  scheduledAt: Date | null
): WhiteHouseYoutubeStreamStatus {
  const statusJson = JSON.stringify([renderer.contentImage, renderer.thumbnailOverlays, renderer.badges]);
  if (
    /"(?:style|badgeStyle)":"[^"]*LIVE(?:_NOW)?[^"]*"/i.test(statusJson) ||
    statusText.some((value) => /^(?:live|live now|currently live)$/i.test(value))
  ) {
    return "Live";
  }

  if (
    scheduledAt ||
    renderer.upcomingEventData !== undefined ||
    /"(?:style|badgeStyle)":"[^"]*(?:UPCOMING|PREMIERE)[^"]*"/i.test(statusJson) ||
    statusText.some((value) => /^(?:upcoming|scheduled|premiere)/i.test(value))
  ) {
    return "Scheduled";
  }

  return "Streamed";
}

function extractScheduledAt(renderer: Record<string, unknown>): Date | null {
  const timestamp = findTimestamp(renderer.upcomingEventData ?? renderer, new Set(["startTime", "startTimeSeconds"]));
  if (timestamp === null) {
    return null;
  }

  const milliseconds = timestamp > 10_000_000_000 ? timestamp : timestamp * 1_000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date;
}

function findTimestamp(value: unknown, keys: Set<string>): number | null {
  const record = asRecord(value);
  if (!record) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const timestamp = findTimestamp(item, keys);
        if (timestamp !== null) {
          return timestamp;
        }
      }
    }
    return null;
  }

  for (const [key, child] of Object.entries(record)) {
    if (keys.has(key)) {
      const numeric = typeof child === "number" ? child : typeof child === "string" ? Number(child) : Number.NaN;
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
    }

    const timestamp = findTimestamp(child, keys);
    if (timestamp !== null) {
      return timestamp;
    }
  }

  return null;
}

function toEventPost(stream: WhiteHouseYoutubeStream, observedAt: Date): EventMonitorPost {
  const scheduled = stream.scheduledAt ? formatEasternDateTime(stream.scheduledAt) : "not listed";
  return {
    id: `white-house-youtube:${formatWhiteHouseYoutubeStreamAlertKey(stream)}`,
    type: "White House YouTube stream",
    alertTitle: stream.status === "Live" ? "White House is live" : stream.status === "Scheduled" ? "White House stream scheduled" : "New White House stream",
    sourceLabel: "White House YouTube",
    buttonLabel: "Watch stream",
    mentionAlertRole: true,
    textFieldName: "Stream",
    text: stream.title,
    qualifyingText: stream.title,
    postedAt: stream.scheduledAt ?? observedAt,
    url: stream.url,
    fields: [
      { name: "Status", value: stream.status, inline: true },
      { name: "Scheduled (ET)", value: scheduled, inline: true },
      ...(stream.listedText ? [{ name: "YouTube listing", value: stream.listedText, inline: false }] : [])
    ],
    hideLinksField: true,
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

function formatWhiteHouseYoutubeStreamAlertKey(stream: WhiteHouseYoutubeStream): string {
  return [stream.videoId, stream.status, stream.title, stream.scheduledAt?.toISOString() ?? ""].join(":");
}

function extractWhiteHouseYoutubeStreamValueAlertKey(value: string): string {
  return ["Status", "Title", "Scheduled at", "URL"].map((label) => extractValueLine(value, label) ?? "").join("|");
}

function extractYtInitialData(html: string): unknown {
  const markers = ["var ytInitialData =", "window[\"ytInitialData\"] =", "ytInitialData ="];
  for (const marker of markers) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) {
      continue;
    }

    const jsonStart = html.indexOf("{", markerIndex + marker.length);
    if (jsonStart < 0) {
      continue;
    }

    const json = extractBalancedJsonObject(html, jsonStart);
    if (!json) {
      continue;
    }

    try {
      return JSON.parse(json);
    } catch {
      continue;
    }
  }

  throw new Error("Could not parse YouTube initial page data from the White House Streams page");
}

function extractBalancedJsonObject(value: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return null;
}

function walkJson(value: unknown, visit: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      walkJson(item, visit);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  visit(record);
  for (const child of Object.values(record)) {
    walkJson(child, visit);
  }
}

function collectDisplayText(value: unknown): string[] {
  const texts: string[] = [];
  walkJson(value, (record) => {
    for (const candidate of [record.content, record.simpleText, record.label, record.text]) {
      const text = readText(candidate);
      if (text && !texts.includes(text)) {
        texts.push(text);
      }
    }
  });
  return texts;
}

function selectListedText(values: string[]): string | null {
  return values.find((value) => /^(?:streamed|scheduled|premiere|started|live)\b/i.test(value)) ?? null;
}

function readText(value: unknown): string | null {
  if (typeof value === "string") {
    return normalizeText(value) || null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const direct = readString(record.simpleText) ?? readString(record.content);
  if (direct) {
    return normalizeText(direct) || null;
  }

  if (Array.isArray(record.runs)) {
    const text = record.runs.map((run) => readString(asRecord(run)?.text) ?? "").join("");
    return normalizeText(text) || null;
  }

  return null;
}

function readAt(record: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    current = asRecord(current)?.[key];
    if (current === undefined) {
      return undefined;
    }
  }
  return current;
}

function readStringAt(record: Record<string, unknown>, path: string[]): string | null {
  return readString(readAt(record, path));
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function extractValueLine(value: string, label: string): string | null {
  const match = value.match(new RegExp(`^${escapeRegExp(label)}:\\s*(.*)$`, "m"));
  return match?.[1]?.trim() ?? null;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
