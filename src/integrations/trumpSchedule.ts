import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://rollcall.com/factbase/trump/calendar/";
const easternTimeZone = "America/New_York";
const activeStartMinutesEt = 7 * 60;
const activeEndMinutesEt = 22 * 60;

export type TrumpScheduleItem = {
  timeEt: string;
  type: string;
  detail: string;
  location: string;
  press: string;
};

export type TrumpSchedule = {
  dateEt: string;
  items: TrumpScheduleItem[];
  sourceUrl: string;
};

export function extractTrumpSchedule(html: string, targetDateEt: string): TrumpSchedule {
  const $ = cheerio.load(html);
  let currentDateEt: string | null = null;
  const items: TrumpScheduleItem[] = [];

  $("tr").each((_, row) => {
    const rowText = normalizeText($(row).text());
    const dateEt = parseRollCallDate(rowText);
    if (dateEt) {
      currentDateEt = dateEt;
      return;
    }

    if (currentDateEt !== targetDateEt) {
      return;
    }

    const item = extractTrumpScheduleItem($, row);
    if (item) {
      items.push(item);
    }
  });

  return {
    dateEt: targetDateEt,
    items: sortScheduleItems(items),
    sourceUrl
  };
}

export function formatTrumpScheduleValue(schedule: TrumpSchedule): string {
  const flags = summarizeScheduleFlags(schedule.items);
  return [
    `Date ET: ${schedule.dateEt}`,
    `Items: ${schedule.items.length}`,
    `Flags: ${flags.join(" | ")}`,
    "Schedule:",
    ...(schedule.items.length ? schedule.items.map(formatScheduleItem) : ["No public schedule items found for this ET date yet."]),
    `Source: ${schedule.sourceUrl}`
  ].join("\n");
}

export function getTrumpSchedulePollIntervalMinutes(_integration: Integration, now = new Date()): number {
  const parts = getEasternParts(now);
  const minutes = parts.hour * 60 + parts.minute;
  return minutes >= activeStartMinutesEt && minutes <= activeEndMinutesEt ? 15 : 60;
}

export function getTrumpSchedulePollIntervalReason(_integration: Integration, now = new Date()): string {
  return getTrumpSchedulePollIntervalMinutes(_integration, now) === 15
    ? "Trump schedule watch: 7:00 AM-10:00 PM ET"
    : "Trump schedule off-hours hourly check";
}

export const trumpScheduleAdapter: WebsiteAdapter = {
  id: "trump-schedule",
  commandName: "trumpschedule",
  displayName: "Trump Schedule",
  sourceUrl,
  defaultChannelName: "trumpschedule",
  alertRoleName: "Trump Schedule Alerts",
  alertRoleEmoji: "\uD83D\uDDD3\uFE0F",
  getPollIntervalMinutes: getTrumpSchedulePollIntervalMinutes,
  getPollIntervalReason: getTrumpSchedulePollIntervalReason,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Roll Call calendar returned HTTP ${response.status}`);
    }

    const dateEt = getEasternParts(new Date()).date;
    const value = formatTrumpScheduleValue(extractTrumpSchedule(await response.text(), dateEt));
    return {
      value,
      rawValue: value,
      unit: "daily schedule",
      observedAt: new Date()
    };
  }
};

function extractTrumpScheduleItem($: cheerio.CheerioAPI, row: AnyNode): TrumpScheduleItem | null {
  const rowText = normalizeText($(row).text());
  const timeEt = extractTimeEt(rowText);
  const detail = normalizeText(
    $(row)
      .find("div")
      .filter((_, element) => {
        const className = $(element).attr("class") ?? "";
        return className.includes("text-gray-600") && className.includes("mt-2");
      })
      .first()
      .text()
  );

  if (!timeEt || !detail) {
    return null;
  }

  const type = normalizeText($(row).find("[data-tooltip]").first().attr("data-tooltip") ?? "Schedule item");
  const location = normalizeText(
    $(row)
      .find("div")
      .filter((_, element) => ($(element).attr("class") ?? "") === "inline mr-2")
      .first()
      .text()
  );
  const press = normalizeText(
    $(row)
      .find("div")
      .filter((_, element) => ($(element).attr("class") ?? "") === "inline")
      .first()
      .text()
  );

  return {
    timeEt,
    type: type || "Schedule item",
    detail,
    location: location || "not listed",
    press: press || "not listed"
  };
}

function formatScheduleItem(item: TrumpScheduleItem): string {
  return `${item.timeEt} - ${item.detail} | ${item.location} | ${item.press} | ${item.type}`;
}

function summarizeScheduleFlags(items: TrumpScheduleItem[]): string[] {
  const allText = items.map((item) => `${item.detail} ${item.location} ${item.press} ${item.type}`).join(" ");
  return [
    `lid: ${/\bfull lid\b/i.test(allText) ? "full" : /\blunch lid\b/i.test(allText) ? "lunch" : "none"}`,
    `travel: ${/\btravel\b|\bjoint base andrews\b|\bair force one\b/i.test(allText) ? "yes" : "no"}`,
    `press: ${/\bpress\b|\bpool\b|\bon camera\b|\bbriefing\b/i.test(allText) ? "yes" : "no"}`,
    `remarks: ${/\bremarks\b|\bspeech\b|\baddress\b/i.test(allText) ? "yes" : "no"}`
  ];
}

function sortScheduleItems(items: TrumpScheduleItem[]): TrumpScheduleItem[] {
  return [...items].sort((left, right) => (parseTimeToMinutes(left.timeEt) ?? 0) - (parseTimeToMinutes(right.timeEt) ?? 0));
}

function parseRollCallDate(text: string): string | null {
  const match = text.match(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\b/);
  if (!match) {
    return null;
  }

  const month = monthNumber(match[1]);
  if (!month) {
    return null;
  }

  return `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

function monthNumber(month: string): string | null {
  const index = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december"
  ].indexOf(month.toLowerCase());
  return index === -1 ? null : String(index + 1).padStart(2, "0");
}

function extractTimeEt(text: string): string | null {
  return text.match(/\b(\d{1,2}:\d{2}\s*(?:AM|PM))/i)?.[1].replace(/\s+/g, " ").toUpperCase() ?? null;
}

function parseTimeToMinutes(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (match[3].toUpperCase() === "PM" && hour !== 12) {
    hour += 12;
  }
  if (match[3].toUpperCase() === "AM" && hour === 12) {
    hour = 0;
  }

  return hour * 60 + minute;
}

function getEasternParts(date: Date): { date: string; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: easternTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
