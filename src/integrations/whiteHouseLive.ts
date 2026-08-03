import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { fetchWithTimeout } from "../http.js";
import { formatEasternDateTime } from "../time.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.whitehouse.gov/live/";

export type WhiteHouseLiveStatus = "Live" | "Scheduled" | "Offline";

export type WhiteHouseLiveSnapshot = {
  status: WhiteHouseLiveStatus;
  pageDate: string | null;
  eventTitle: string | null;
  scheduledAt: Date | null;
  watchUrl: string | null;
  message: string | null;
};

export const whiteHouseLiveAdapter: WebsiteAdapter = {
  id: "white-house-live",
  commandName: "whlive",
  displayName: "White House Live",
  sourceUrl,
  defaultChannelName: "whlive",
  alertRoleName: "White House Live Alerts",
  alertRoleEmoji: "📺",
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "Fixed 1-minute check for White House livestream schedule and status changes",
  shouldAlertOnChange: whiteHouseLiveShouldAlertOnChange,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        accept: "text/html",
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });
    if (!response.ok) {
      throw new Error(`White House Live returned HTTP ${response.status}`);
    }

    const snapshot = extractWhiteHouseLiveSnapshot(await response.text());
    const value = formatWhiteHouseLiveValue(snapshot);
    return {
      value,
      rawValue: formatWhiteHouseLiveAlertKey(snapshot),
      unit: "White House livestream status",
      observedAt: new Date()
    };
  }
};

export function extractWhiteHouseLiveSnapshot(html: string): WhiteHouseLiveSnapshot {
  const $ = cheerio.load(html);
  const schedule = $(".wp-block-whitehouse-live-schedule").first();
  if (!schedule.length) {
    throw new Error("Could not find the White House live schedule");
  }

  const pageDate = normalizeText($(".wp-block-whitehouse-topper__deck").first().text()) || null;
  const scheduleText = normalizeText(schedule.text());
  const emptyMessage = normalizeText(schedule.find(".wp-block-whitehouse-live-schedule__empty").first().text());
  if (emptyMessage) {
    return {
      status: "Offline",
      pageDate,
      eventTitle: null,
      scheduledAt: null,
      watchUrl: null,
      message: emptyMessage
    };
  }

  if (!scheduleText && !schedule.find("iframe[src], a[href], time[datetime]").length) {
    return {
      status: "Offline",
      pageDate,
      eventTitle: null,
      scheduledAt: null,
      watchUrl: null,
      message: "No livestream is currently listed."
    };
  }

  const title = extractLiveEventTitle(schedule) ?? (scheduleText || null);
  const scheduledAt = extractLiveScheduledAt(schedule);
  const watchUrl = extractLiveWatchUrl($, schedule);
  const status = isExplicitlyLive(schedule, scheduleText) ? "Live" : "Scheduled";
  return {
    status,
    pageDate,
    eventTitle: title,
    scheduledAt,
    watchUrl,
    message: null
  };
}

export function formatWhiteHouseLiveValue(snapshot: WhiteHouseLiveSnapshot): string {
  return [
    `Status: ${snapshot.status}`,
    `Event: ${snapshot.eventTitle ?? "none"}`,
    `Scheduled at: ${snapshot.scheduledAt ? formatEasternDateTime(snapshot.scheduledAt) : "not listed"}`,
    `Watch: ${snapshot.watchUrl ?? "not available"}`,
    `Page date: ${snapshot.pageDate ?? "not listed"}`,
    `Message: ${snapshot.message ?? "none"}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function whiteHouseLiveShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  if (!previousValue || extractValueLine(currentValue, "Status") === "Offline") {
    return false;
  }

  return extractWhiteHouseLiveValueAlertKey(previousValue) !== extractWhiteHouseLiveValueAlertKey(currentValue);
}

function extractLiveEventTitle(schedule: cheerio.Cheerio<AnyNode>): string | null {
  const selectors = [
    "[class*='live-schedule__event'] h2",
    "[class*='live-schedule__event'] h3",
    "[class*='live-event'] h2",
    "[class*='live-event'] h3",
    "article h2",
    "article h3",
    "h2",
    "h3"
  ];
  for (const selector of selectors) {
    const title = normalizeText(schedule.find(selector).first().text());
    if (title && !/^subscribe to live alerts$/i.test(title)) {
      return title;
    }
  }

  return null;
}

function extractLiveScheduledAt(schedule: cheerio.Cheerio<AnyNode>): Date | null {
  const datetime = schedule.find("time[datetime]").first().attr("datetime");
  if (!datetime) {
    return null;
  }

  const date = new Date(datetime);
  return Number.isNaN(date.getTime()) ? null : date;
}

function extractLiveWatchUrl($: cheerio.CheerioAPI, schedule: cheerio.Cheerio<AnyNode>): string | null {
  const candidates = [
    schedule.find("iframe[src]").first().attr("src"),
    ...schedule
      .find("a[href]")
      .toArray()
      .map((element) => $(element).attr("href"))
      .filter((href): href is string => Boolean(href))
  ].filter((url): url is string => Boolean(url));

  const preferred = candidates.find((url) => /youtube|youtu\.be|livestream|\/live(?:\/|$)|watch/i.test(url));
  return normalizeSourceUrl(preferred ?? candidates[0]);
}

function isExplicitlyLive(schedule: cheerio.Cheerio<AnyNode>, text: string): boolean {
  const statusValues = [
    schedule.attr("data-status"),
    ...schedule
      .find("[data-status]")
      .toArray()
      .map((element) => element.attribs?.["data-status"])
  ];
  if (statusValues.some((value) => /^live$/i.test(value?.trim() ?? ""))) {
    return true;
  }

  const classTokens = [schedule.attr("class"), ...schedule.find("[class]").toArray().map((element) => element.attribs?.class)]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(/\s+/));

  return (
    classTokens.some((value) => /^(?:is-live|live-now|currently-live)$/i.test(value)) ||
    /\b(?:live now|now live|currently live)\b/i.test(text)
  );
}

function formatWhiteHouseLiveAlertKey(snapshot: WhiteHouseLiveSnapshot): string {
  return [snapshot.status, snapshot.eventTitle ?? "", snapshot.scheduledAt?.toISOString() ?? "", snapshot.watchUrl ?? ""].join("|");
}

function extractWhiteHouseLiveValueAlertKey(value: string): string {
  return ["Status", "Event", "Scheduled at", "Watch"].map((label) => extractValueLine(value, label) ?? "").join("|");
}

function extractValueLine(value: string, label: string): string | null {
  const match = value.match(new RegExp(`^${escapeRegExp(label)}:\\s*(.*)$`, "m"));
  return match?.[1]?.trim() ?? null;
}

function normalizeSourceUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value, sourceUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
