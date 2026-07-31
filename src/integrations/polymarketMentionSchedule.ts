import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const polymarketMentionsUrl = "https://polymarket.com/mentions";
const gammaMentionsUrl =
  "https://gamma-api.polymarket.com/events?tag_id=100343&active=true&closed=false&archived=false&limit=100&order=createdAt&ascending=false";
const singaporeTimeZone = "Asia/Singapore";
const utcTimeZone = "UTC";

const monthNumbers = new Map([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12]
]);

type GammaMentionEvent = {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  description?: unknown;
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
};

export type PolymarketMentionListing = {
  slug: string;
  title: string;
  listedLabel: string;
  listedAt: Date | null;
};

export type PolymarketMentionScheduleRow = {
  title: string;
  slug: string;
  url: string;
  scheduledAt: Date;
  scheduledAtSgt: string;
  originalListedTime: string;
};

type RuleSchedule = {
  scheduledAt: Date;
  originalListedTime: string;
};

export const polymarketMentionScheduleAdapter: WebsiteAdapter = {
  id: "polymarket-mention-schedule",
  commandName: "mentionsschedule",
  displayName: "Polymarket Mentions Schedule",
  sourceUrl: polymarketMentionsUrl,
  defaultChannelName: "mentions-schedule",
  alertRoleName: "Polymarket Mentions Schedule Alerts",
  alertRoleEmoji: "🗓️",
  dailySnapshot: {
    timeZone: singaporeTimeZone,
    hour: 18,
    minute: 0,
    windowMinutes: 10,
    label: "6:00 PM SGT next-24-hours briefing",
    alwaysAlert: true
  },
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Hourly silent refresh; one scheduled briefing at 6:00 PM SGT",
  shouldAlertOnChange: () => false,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const observedAt = new Date();
    const [html, events] = await Promise.all([fetchMentionsHtml(), fetchGammaMentionEvents()]);
    const value = buildPolymarketMentionScheduleValue(events, html, observedAt);
    return {
      value,
      rawValue: value,
      unit: "next 24 hours mention markets",
      observedAt
    };
  }
};

export function buildPolymarketMentionScheduleValue(events: GammaMentionEvent[], mentionsHtml: string, now = new Date()): string {
  const listings = new Map(extractPolymarketMentionListings(mentionsHtml, now).map((listing) => [listing.slug, listing]));
  const window = getNextTwentyFourHourWindow(now);
  const rows = buildPolymarketMentionScheduleRows(events, listings, window.startAt, window.endAt).sort(
    (left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime() || left.title.localeCompare(right.title)
  );

  return [
    "Metric: Polymarket Mentions next 24 hours schedule",
    `Window SGT: ${formatZonedDateTime(window.startAt, singaporeTimeZone, "SGT")} to ${formatZonedDateTime(window.endAt, singaporeTimeZone, "SGT")}`,
    `Markets scheduled: ${rows.length}`,
    ...(rows.length
      ? [
          "Schedule:",
          ...rows.map(
            (row, index) =>
              `${index + 1}. **${row.scheduledAtSgt} — ${row.title}** · [Polymarket](${row.url}) · Original: ${row.originalListedTime}`
          )
        ]
      : ["Schedule: none"]),
    `Source: ${polymarketMentionsUrl}`,
    `Gamma API: ${gammaMentionsUrl}`
  ].join("\n");
}

export function buildPolymarketMentionScheduleRows(
  events: GammaMentionEvent[],
  listings: Map<string, PolymarketMentionListing>,
  startAt: Date,
  endAt: Date
): PolymarketMentionScheduleRow[] {
  return events.flatMap((event) => {
    if (event.active === false || event.closed === true || event.archived === true) {
      return [];
    }

    const slug = firstNonEmptyString(event.slug);
    const title = firstNonEmptyString(event.title);
    if (!slug || !title) {
      return [];
    }

    const listing = listings.get(slug);
    const ruleSchedule = parsePolymarketMentionRuleSchedule(firstNonEmptyString(event.description) ?? "");
    const scheduledAt = ruleSchedule?.scheduledAt ?? listing?.listedAt ?? null;
    if (!scheduledAt || scheduledAt < startAt || scheduledAt >= endAt) {
      return [];
    }

    return [
      {
        title,
        slug,
        url: `https://polymarket.com/event/${slug}`,
        scheduledAt,
        scheduledAtSgt: formatZonedDisplayDateTime(scheduledAt, singaporeTimeZone, "SGT"),
        originalListedTime:
          ruleSchedule?.originalListedTime ??
          (listing ? `${listing.listedLabel} (timezone not shown on Polymarket card; treated as UTC)` : "not shown")
      }
    ];
  });
}

export function getNextTwentyFourHourWindow(now: Date): { startAt: Date; endAt: Date } {
  const parts = getZonedDateParts(now, singaporeTimeZone);
  const startAt =
    parts.hour === 18 && parts.minute < 10
      ? zonedDateTimeToUtc(
          { year: parts.year, month: parts.month, day: parts.day, hour: 18, minute: 0 },
          singaporeTimeZone
        )
      : new Date(Math.floor(now.getTime() / 60_000) * 60_000);

  return { startAt, endAt: new Date(startAt.getTime() + 24 * 60 * 60_000) };
}

export function extractPolymarketMentionListings(html: string, now = new Date()): PolymarketMentionListing[] {
  const $ = cheerio.load(html);
  const listings = new Map<string, PolymarketMentionListing>();

  $("a[href^='/event/']").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const slug = href.match(/^\/event\/([^/?#]+)/)?.[1];
    const title = normalizeText($(element).find("h2").first().text());
    if (!slug || !title || listings.has(slug)) {
      return;
    }

    const spanTexts = $(element)
      .find("span")
      .toArray()
      .map((span) => normalizeText($(span).text()))
      .filter(Boolean);
    const dateParts = extractListingDateParts(spanTexts);
    const timeLabel = spanTexts.find((text) => /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+\d{1,2}:\d{2}\s+[AP]M$/i.test(text));
    const listedAt = dateParts && timeLabel ? parsePolymarketCardUtcDateTime(dateParts.day, dateParts.month, timeLabel, now) : null;

    listings.set(slug, {
      slug,
      title,
      listedLabel: dateParts && timeLabel ? `${dateParts.day} ${dateParts.monthLabel}, ${timeLabel}` : "not shown",
      listedAt
    });
  });

  return [...listings.values()];
}

export function parsePolymarketMentionRuleSchedule(description: string): RuleSchedule | null {
  const scheduledSegments = description
    .split(/\n+/)
    .flatMap((paragraph) => paragraph.split(/(?<=\.)\s+/))
    .map(normalizeText)
    .filter((segment) => /\bscheduled\b/i.test(segment) && /\b(?:at|@)\b/i.test(segment));

  for (const segment of scheduledSegments) {
    const parsed = parseDateTimeWithZone(segment);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function parseDateTimeWithZone(value: string): RuleSchedule | null {
  const match = value.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2}),\s*(\d{4})(?:,?\s*(?:at|@)\s*)?(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*(ET|EST|EDT|UTC|GMT|PT|PST|PDT|CT|CST|CDT)\b/i
  );
  if (!match) {
    return null;
  }

  const month = monthNumbers.get(match[1].toLowerCase());
  const day = Number(match[2]);
  const year = Number(match[3]);
  const hour = parseHour(match[4], match[6]);
  const minute = match[5] ? Number(match[5]) : 0;
  const zoneAbbreviation = match[7].toUpperCase();
  const timeZone = mapTimeZoneAbbreviation(zoneAbbreviation);
  if (!month || !isValidDateParts(year, month, day, hour, minute)) {
    return null;
  }

  const scheduledAt =
    timeZone === utcTimeZone
      ? new Date(Date.UTC(year, month - 1, day, hour, minute))
      : zonedDateTimeToUtc({ year, month, day, hour, minute }, timeZone);

  return {
    scheduledAt,
    originalListedTime: `${monthLabel(month)} ${day}, ${year}, ${formatTwelveHour(hour, minute)} ${zoneAbbreviation}`
  };
}

async function fetchMentionsHtml(): Promise<string> {
  const response = await fetchWithTimeout(polymarketMentionsUrl, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Mentions page returned HTTP ${response.status}`);
  }
  return response.text();
}

async function fetchGammaMentionEvents(): Promise<GammaMentionEvent[]> {
  const response = await fetchWithTimeout(gammaMentionsUrl, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma Mentions returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  if (Array.isArray(payload)) {
    return payload as GammaMentionEvent[];
  }
  if (payload && typeof payload === "object" && Array.isArray((payload as { events?: unknown }).events)) {
    return (payload as { events: GammaMentionEvent[] }).events;
  }
  return [];
}

function extractListingDateParts(texts: string[]): { day: number; month: number; monthLabel: string } | null {
  for (let index = 0; index < texts.length - 1; index += 1) {
    const day = Number(texts[index]);
    const monthLabelText = texts[index + 1];
    const month = monthNumbers.get(monthLabelText.toLowerCase());
    if (Number.isInteger(day) && day >= 1 && day <= 31 && month) {
      return { day, month, monthLabel: monthLabel(month) };
    }
  }
  return null;
}

function parsePolymarketCardUtcDateTime(day: number, month: number, timeLabel: string, now: Date): Date | null {
  const match = timeLabel.match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+(\d{1,2}):(\d{2})\s+([AP]M)$/i);
  if (!match) {
    return null;
  }

  const year = inferListingYear(month, day, now);
  const hour = parseHour(match[1], match[3]);
  const minute = Number(match[2]);
  return isValidDateParts(year, month, day, hour, minute) ? new Date(Date.UTC(year, month - 1, day, hour, minute)) : null;
}

function inferListingYear(month: number, day: number, now: Date): number {
  const current = getZonedDateParts(now, singaporeTimeZone);
  const candidate = Date.UTC(current.year, month - 1, day);
  const today = Date.UTC(current.year, current.month - 1, current.day);
  const diffDays = Math.round((candidate - today) / 86_400_000);
  if (diffDays < -180) {
    return current.year + 1;
  }
  if (diffDays > 180) {
    return current.year - 1;
  }
  return current.year;
}

function parseHour(hourText: string, periodText: string): number {
  const hour = Number(hourText);
  const normalizedPeriod = periodText.toUpperCase();
  if (normalizedPeriod === "AM") {
    return hour === 12 ? 0 : hour;
  }
  return hour === 12 ? 12 : hour + 12;
}

function mapTimeZoneAbbreviation(value: string): string {
  if (["ET", "EST", "EDT"].includes(value)) {
    return "America/New_York";
  }
  if (["PT", "PST", "PDT"].includes(value)) {
    return "America/Los_Angeles";
  }
  if (["CT", "CST", "CDT"].includes(value)) {
    return "America/Chicago";
  }
  return utcTimeZone;
}

function zonedDateTimeToUtc(parts: { year: number; month: number; day: number; hour: number; minute: number }, timeZone: string): Date {
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const firstPass = localAsUtc - getTimeZoneOffsetMs(new Date(localAsUtc), timeZone);
  const secondPass = localAsUtc - getTimeZoneOffsetMs(new Date(firstPass), timeZone);
  return new Date(secondPass);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedDateParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function formatZonedDateTime(date: Date, timeZone: string, suffix: string): string {
  const parts = getZonedDateParts(date, timeZone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)} ${suffix}`;
}

function formatZonedDisplayDateTime(date: Date, timeZone: string, suffix: string): string {
  const parts = getZonedDateParts(date, timeZone);
  return `${monthLabel(parts.month)} ${parts.day}, ${parts.year}, ${formatTwelveHour(parts.hour, parts.minute)} ${suffix}`;
}

function getZonedDateParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function isValidDateParts(year: number, month: number, day: number, hour: number, minute: number): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12 &&
    Number.isInteger(day) &&
    day >= 1 &&
    day <= 31 &&
    Number.isInteger(hour) &&
    hour >= 0 &&
    hour <= 23 &&
    Number.isInteger(minute) &&
    minute >= 0 &&
    minute <= 59
  );
}

function monthLabel(month: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: utcTimeZone }).format(new Date(Date.UTC(2026, month - 1, 1)));
}

function formatTwelveHour(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${pad2(minute)} ${period}`;
}

function firstNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
