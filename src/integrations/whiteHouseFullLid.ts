import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const rollCallUrl = "https://rollcall.com/factbase/trump/calendar/";
const forthUrl = "https://www.forth.news/whpool";
const defaultPolymarketUrl =
  "https://polymarket.com/event/will-the-white-house-call-a-full-lid-by-630-pm-may-11-16";
const cutoffMinutesEt = 18 * 60 + 30;

export type FullLidResult = {
  dateEt: string;
  found: boolean;
  source: "Roll Call" | "Forth" | "none";
  timeEt: string;
  detail: string;
  beforeCutoff: boolean | null;
  rollCallStatus: string;
  forthStatus: string;
};

type LidCandidate = {
  source: "Roll Call" | "Forth";
  dateEt: string;
  timeEt: string;
  detail: string;
  minutesEt: number | null;
};

export function extractRollCallFullLid(html: string, targetDateEt: string): LidCandidate | null {
  const $ = cheerio.load(html);
  let currentDateEt: string | null = null;
  const candidates: LidCandidate[] = [];

  $("tr").each((_, row) => {
    const text = normalizeText($(row).text());
    const date = parseRollCallDate(text);
    if (date) {
      currentDateEt = date;
      return;
    }

    if (currentDateEt !== targetDateEt || !/\bfull lid\b/i.test(text)) {
      return;
    }

    const timeEt = extractTimeEt(text);
    candidates.push({
      source: "Roll Call",
      dateEt: currentDateEt,
      timeEt: timeEt ?? "not listed",
      detail: extractLidDetail(text),
      minutesEt: timeEt ? parseTimeToMinutes(timeEt) : null
    });
  });

  return candidates.sort(compareLidCandidates)[0] ?? null;
}

export function extractForthFullLid(html: string, targetDateEt: string): LidCandidate | null {
  const $ = cheerio.load(html);
  const text = normalizeText($.text());
  if (!/\bfull lid\b/i.test(text) && !/\blid\b/i.test(text)) {
    return null;
  }

  const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const dateEt = dateMatch?.[1] ?? targetDateEt;
  if (dateEt !== targetDateEt) {
    return null;
  }

  const lidIndex = text.toLowerCase().indexOf("lid");
  const nearby = lidIndex === -1 ? text.slice(0, 300) : text.slice(Math.max(0, lidIndex - 160), lidIndex + 260);
  const timeEt = extractTimeEt(nearby) ?? extractTimeEt(text);

  return {
    source: "Forth",
    dateEt,
    timeEt: timeEt ?? "not listed",
    detail: nearby,
    minutesEt: timeEt ? parseTimeToMinutes(timeEt) : null
  };
}

export function formatFullLidValue(result: FullLidResult): string {
  const cutoffStatus =
    result.beforeCutoff === null ? "unknown" : result.beforeCutoff ? "BEFORE 6:30 PM ET" : "AFTER 6:30 PM ET";
  return [
    `Date ET: ${result.dateEt}`,
    "Cutoff: 6:30 PM ET",
    `Lid found: ${result.found ? "yes" : "no"}`,
    `Alert Date: ${result.found ? result.dateEt : "none"}`,
    `First lid source: ${result.source}`,
    `First lid time: ${result.timeEt}`,
    `Cutoff status: ${cutoffStatus}`,
    `Detail: ${result.detail}`,
    `Roll Call: ${result.rollCallStatus}`,
    `Forth: ${result.forthStatus}`,
    `Resolution: ${rollCallUrl}`,
    `Fallback: ${forthUrl}`
  ].join("\n");
}

export function fullLidShouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
  if (!/^Lid found:\s*yes$/m.test(currentValue)) {
    return false;
  }

  const currentAlertDate = currentValue.match(/^Alert Date:\s*(.+)$/m)?.[1]?.trim();
  const previousAlertDate = previousValue?.match(/^Alert Date:\s*(.+)$/m)?.[1]?.trim();
  return Boolean(currentAlertDate && currentAlertDate !== "none" && currentAlertDate !== previousAlertDate);
}

export function getWhiteHouseFullLidPollIntervalMinutes(_integration: unknown, now = new Date()): number {
  const parts = getEasternParts(now);
  const minutes = parts.hour * 60 + parts.minute;
  return minutes >= 8 * 60 && minutes <= 20 * 60 + 30 ? 1 : 60;
}

export function getWhiteHouseFullLidPollIntervalReason(_integration: unknown, now = new Date()): string {
  return getWhiteHouseFullLidPollIntervalMinutes(_integration, now) === 1
    ? "Daily full-lid watch: 8:00 AM-8:30 PM ET"
    : "Off-hours hourly full-lid check";
}

export const whiteHouseFullLidAdapter: WebsiteAdapter = {
  id: "white-house-full-lid",
  commandName: "fulllid",
  displayName: "White House Full Lid",
  sourceUrl: rollCallUrl,
  defaultPolymarketUrl,
  defaultChannelName: "fulllid",
  alertRoleName: "White House Lid Alerts",
  alertRoleEmoji: "\uD83E\uDDE2",
  getPollIntervalMinutes: getWhiteHouseFullLidPollIntervalMinutes,
  getPollIntervalReason: getWhiteHouseFullLidPollIntervalReason,
  shouldAlertOnChange: fullLidShouldAlertOnChange,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const dateEt = getEasternParts(new Date()).date;
    const result = await fetchFullLidResult(dateEt);
    const value = formatFullLidValue(result);
    return {
      value,
      rawValue: value,
      unit: "daily full lid status",
      observedAt: new Date()
    };
  }
};

async function fetchFullLidResult(dateEt: string): Promise<FullLidResult> {
  const [rollCall, forth] = await Promise.all([fetchRollCallLid(dateEt), fetchForthLid(dateEt)]);
  const firstLid = [rollCall.candidate, forth.candidate].filter((candidate): candidate is LidCandidate => Boolean(candidate)).sort(compareLidCandidates)[0];

  if (!firstLid) {
    if (!rollCall.ok && !forth.ok) {
      throw new Error(`Could not check full lid sources. Roll Call: ${rollCall.status}; Forth: ${forth.status}`);
    }

    return {
      dateEt,
      found: false,
      source: "none",
      timeEt: "not found",
      detail: "No full lid found yet for today's ET date",
      beforeCutoff: null,
      rollCallStatus: rollCall.status,
      forthStatus: forth.status
    };
  }

  return {
    dateEt,
    found: true,
    source: firstLid.source,
    timeEt: firstLid.timeEt,
    detail: firstLid.detail,
    beforeCutoff: firstLid.minutesEt === null ? null : firstLid.minutesEt <= cutoffMinutesEt,
    rollCallStatus: rollCall.status,
    forthStatus: forth.status
  };
}

async function fetchRollCallLid(dateEt: string): Promise<{ ok: boolean; status: string; candidate: LidCandidate | null }> {
  const response = await fetchWithTimeout(rollCallUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  if (!response.ok) {
    return { ok: false, status: `unavailable HTTP ${response.status}`, candidate: null };
  }

  const candidate = extractRollCallFullLid(await response.text(), dateEt);
  return { ok: true, status: candidate ? `full lid found at ${candidate.timeEt}` : "no full lid found", candidate };
}

async function fetchForthLid(dateEt: string): Promise<{ ok: boolean; status: string; candidate: LidCandidate | null }> {
  const response = await fetchWithTimeout(forthUrl, {
    headers: {
      accept: "text/html",
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  if (!response.ok) {
    return { ok: false, status: `unavailable HTTP ${response.status}`, candidate: null };
  }

  const candidate = extractForthFullLid(await response.text(), dateEt);
  return { ok: true, status: candidate ? `full lid found at ${candidate.timeEt}` : "no full lid found", candidate };
}

function compareLidCandidates(left: LidCandidate, right: LidCandidate): number {
  return (left.minutesEt ?? Number.MAX_SAFE_INTEGER) - (right.minutesEt ?? Number.MAX_SAFE_INTEGER);
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

function extractLidDetail(text: string): string {
  const match = text.match(/(?:White House Press Office:\s*)?[^.]*\bfull lid\b[^.]*\.?/i);
  return normalizeText(match?.[0] ?? text).slice(0, 500);
}

function getEasternParts(date: Date): { date: string; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
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
