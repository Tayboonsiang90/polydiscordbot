import { fetchWithTimeout } from "./http.js";
import type { BotDatabase } from "./database.js";
import type { Integration } from "./integrations/types.js";
import { parseSettingsJson } from "./settingsJson.js";

export type MarketEndReminderKey = "24h" | "12h" | "1h" | "end";

export type MarketEndReminder = {
  key: MarketEndReminderKey;
  label: string;
  dueAt: Date;
  endAt: Date;
};

type GammaEvent = {
  endDate?: string | null;
  endDateIso?: string | null;
};

const gammaApiUrl = "https://gamma-api.polymarket.com/events";
const failedMarketEndLookupBackoffMs = 30 * 60_000;
const failedMarketEndLookups = new Map<string, { retryAfterMs: number }>();

const reminders: Array<{ key: MarketEndReminderKey; label: string; offsetMs: number }> = [
  { key: "24h", label: "24 hours before market end", offsetMs: 24 * 60 * 60 * 1000 },
  { key: "12h", label: "12 hours before market end", offsetMs: 12 * 60 * 60 * 1000 },
  { key: "1h", label: "1 hour before market end", offsetMs: 60 * 60 * 1000 },
  { key: "end", label: "Market end reached", offsetMs: 0 }
];

export type MarketEndLookupResult = {
  endAt: Date | null;
  missingWarningDue: boolean;
};

export function parseManualEasternDateTime(value: string): Date | null {
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, meridiem] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  let hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText ?? "0");

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return null;
    }
    hour = meridiem.toUpperCase() === "PM" ? (hour % 12) + 12 : hour % 12;
  }

  if (!isValidDateTimeParts(year, month, day, hour, minute, second)) {
    return null;
  }

  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstPass = localAsUtc - getTimeZoneOffsetMs(new Date(localAsUtc), "America/New_York");
  const secondPass = localAsUtc - getTimeZoneOffsetMs(new Date(firstPass), "America/New_York");
  const parsed = new Date(secondPass);

  return matchesEasternParts(parsed, { year, month, day, hour, minute, second }) ? parsed : null;
}

export async function getDueMarketEndReminders(
  database: BotDatabase,
  integration: Integration,
  now: Date = new Date()
): Promise<MarketEndReminder[]> {
  const { endAt } = await getStoredOrFetchPolymarketEndDate(database, integration, now);
  if (!endAt) {
    return [];
  }

  return reminders
    .map((reminder) => ({
      key: reminder.key,
      label: reminder.label,
      dueAt: new Date(endAt.getTime() - reminder.offsetMs),
      endAt
    }))
    .filter((reminder) => now.getTime() >= reminder.dueAt.getTime());
}

export async function getStoredOrFetchPolymarketEndDate(
  database: BotDatabase,
  integration: Integration,
  now: Date = new Date()
): Promise<MarketEndLookupResult> {
  if (!integration.polymarketUrl) {
    return { endAt: null, missingWarningDue: false };
  }

  const queuedEndAt = getQueuedMarketEndAt(integration);
  if (queuedEndAt) {
    return { endAt: queuedEndAt, missingWarningDue: false };
  }

  const existing = database.getMarketEndMetadata(integration.id, integration.polymarketUrl);
  if (existing) {
    return {
      endAt: existing.endAt ? new Date(existing.endAt) : null,
      missingWarningDue: !existing.endAt && !existing.missingWarnedAt
    };
  }

  if (isMarketEndLookupBackedOff(integration.polymarketUrl, now)) {
    return { endAt: null, missingWarningDue: false };
  }

  let endAt: Date | null;
  try {
    endAt = await fetchPolymarketEndDateFromGamma(integration.polymarketUrl);
    failedMarketEndLookups.delete(integration.polymarketUrl);
  } catch (error) {
    failedMarketEndLookups.set(integration.polymarketUrl, {
      retryAfterMs: now.getTime() + failedMarketEndLookupBackoffMs
    });
    throw error;
  }

  database.recordMarketEndMetadata(integration.id, integration.polymarketUrl, endAt, now);
  return { endAt, missingWarningDue: !endAt };
}

export function clearMarketEndLookupBackoff(): void {
  failedMarketEndLookups.clear();
}

export async function fetchPolymarketEndDateFromGamma(polymarketUrl: string | null): Promise<Date | null> {
  if (!polymarketUrl) {
    return null;
  }

  const slug = getPolymarketSlug(polymarketUrl);
  return slug ? parseGammaEndDate(await fetchGammaEventsBySlug(slug)) : null;
}

export function parseGammaEndDate(events: GammaEvent[]): Date | null {
  const event = events.find((candidate) => candidate.endDate || candidate.endDateIso);
  const endDate = event?.endDate ?? event?.endDateIso;
  if (!endDate) {
    return null;
  }

  const parsed = new Date(endDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getPolymarketSlug(polymarketUrl: string): string | null {
  try {
    const parsed = new URL(polymarketUrl);
    if (!["polymarket.com", "www.polymarket.com"].includes(parsed.hostname.toLowerCase())) {
      return null;
    }

    return parsed.pathname.split("/").filter(Boolean).at(-1) ?? null;
  } catch {
    return null;
  }
}

async function fetchGammaEventsBySlug(slug: string): Promise<GammaEvent[]> {
  const response = await fetchWithTimeout(`${gammaApiUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: {
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  return Array.isArray(data) ? (data as GammaEvent[]) : [];
}

function isValidDateTimeParts(year: number, month: number, day: number, hour: number, minute: number, second: number): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    Number.isInteger(hour) &&
    Number.isInteger(minute) &&
    Number.isInteger(second) &&
    year >= 2020 &&
    year <= 2100 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= 31 &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  );
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getTimeZoneParts(date, timeZone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return localAsUtc - date.getTime();
}

function matchesEasternParts(
  date: Date,
  expected: { year: number; month: number; day: number; hour: number; minute: number; second: number }
): boolean {
  const parts = getTimeZoneParts(date, "America/New_York");
  return (
    parts.year === expected.year &&
    parts.month === expected.month &&
    parts.day === expected.day &&
    parts.hour === expected.hour &&
    parts.minute === expected.minute &&
    parts.second === expected.second
  );
}

function getTimeZoneParts(date: Date, timeZone: string) {
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

function isMarketEndLookupBackedOff(polymarketUrl: string, now: Date): boolean {
  const failure = failedMarketEndLookups.get(polymarketUrl);
  if (!failure) {
    return false;
  }

  if (now.getTime() < failure.retryAfterMs) {
    return true;
  }

  failedMarketEndLookups.delete(polymarketUrl);
  return false;
}

function getQueuedMarketEndAt(integration: Integration): Date | null {
  const settings = parseSettingsJson(integration.settingsJson);
  const market = [...normalizeQueuedMarkets(settings.polymarketMarkets), ...normalizeQueuedMarkets(settings.markets)].find(
    (candidate) => candidate.url === integration.polymarketUrl
  );
  if (!market?.endAt) {
    return null;
  }

  const endAt = new Date(market.endAt);
  return Number.isNaN(endAt.getTime()) ? null : endAt;
}

function normalizeQueuedMarkets(value: unknown): Array<{ url: string; endAt: string | null }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const market = item as { url?: unknown; endAt?: unknown };
    return typeof market.url === "string" ? [{ url: market.url, endAt: typeof market.endAt === "string" ? market.endAt : null }] : [];
  });
}
