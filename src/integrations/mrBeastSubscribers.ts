import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.youtube.com/@MrBeast/about";
const defaultPolymarketUrl = "https://polymarket.com/event/will-mrbeast-hit-million-subscribers-by-june-30";
const gammaApiUrl = "https://gamma-api.polymarket.com/events";

type GammaEvent = {
  markets?: GammaMarket[];
};

type GammaMarket = {
  question?: string;
  closed?: boolean;
  outcomePrices?: string[] | string;
  outcomes?: string[] | string;
};

export type MrBeastSubscriberTarget = {
  label: string;
  subscribers: number;
  resolved: boolean;
};

export type MrBeastSubscriberProjection = {
  currentSubscribers: number;
  previousSubscribers: number | null;
  previousCheckedAt: Date | null;
  dailyRate: number | null;
  deadline: Date | null;
  targets: MrBeastSubscriberTarget[];
};

export function extractMrBeastSubscribers(html: string): number {
  const patterns = [
    /"subscriberCountText"\s*:\s*"([\d.,\s\u00a0]+)\s*([KM]?)\s+subscribers"/i,
    /"subscriberCountText"\s*:\s*\{[^{}]*"simpleText"\s*:\s*"([\d.,\s\u00a0]+)\s*([KM]?)\s+subscribers"/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = parseAbbreviatedCount(match?.[1], match?.[2]);
    if (value !== null) {
      return value;
    }
  }

  throw new Error("Could not find MrBeast YouTube subscriber count");
}

export function extractMrBeastSubscriberTargetsFromGamma(markets: GammaMarket[]): MrBeastSubscriberTarget[] {
  const targets = markets.flatMap((market) => {
    const match = market.question?.match(/MrBeast hit ([\d.]+)\s+million subscribers/i);
    if (!match) {
      return [];
    }

    return [
      {
        label: `${match[1]}M`,
        subscribers: Math.round(Number(match[1]) * 1_000_000),
        resolved: isResolvedYesMarket(market)
      }
    ];
  });

  return targets
    .filter((target) => Number.isFinite(target.subscribers))
    .sort((left, right) => left.subscribers - right.subscribers);
}

export function parseMrBeastSubscriberMarketDeadline(polymarketUrl: string | null, now = new Date()): Date | null {
  const slug = polymarketUrl ? getPolymarketSlug(polymarketUrl) : null;
  const match = slug?.match(/by-([a-z]+)-(\d{1,2})$/i);
  if (!match) {
    return null;
  }

  const month = monthNumber(match[1]);
  const day = Number(match[2]);
  if (!month || day < 1 || day > 31) {
    return null;
  }

  return parseManualEasternDateTime(`${getEasternYear(now)}-${padNumber(month)}-${padNumber(day)} 23:59`);
}

export function parseMrBeastStoredSubscribers(value: string | null): number | null {
  const match = value?.match(/Subscribers:\s*([\d,]+)/i);
  return parseInteger(match?.[1]);
}

export function buildMrBeastSubscriberValue(input: MrBeastSubscriberProjection, observedAt = new Date()): string {
  const openTargets = input.targets.filter((target) => !target.resolved);
  const nextTarget = openTargets.find((target) => target.subscribers > input.currentSubscribers) ?? openTargets[0] ?? input.targets.at(-1) ?? null;
  const deadlineDays = input.deadline ? Math.max(0, (input.deadline.getTime() - observedAt.getTime()) / 86_400_000) : null;

  return [
    "Metric: MrBeast YouTube channel subscribers",
    "Note: YouTube displays this count rounded at channel scale.",
    `Subscribers: ${formatInteger(input.currentSubscribers)}`,
    `Previous subscribers: ${input.previousSubscribers === null ? "not available" : formatInteger(input.previousSubscribers)}`,
    `Change since previous check: ${
      input.previousSubscribers === null ? "not available" : formatSignedInteger(input.currentSubscribers - input.previousSubscribers)
    }`,
    `Dailyized rate: ${input.dailyRate === null ? "not available" : `${formatSignedInteger(Math.round(input.dailyRate))}/day`}`,
    `Market deadline: ${input.deadline ? formatEasternDateTime(input.deadline) : "not parsed"}`,
    "Projection table:",
    formatProjectionTable(input.targets, input.currentSubscribers, input.dailyRate, observedAt, deadlineDays),
    `Next open target: ${nextTarget ? formatTargetStatus(nextTarget, input.currentSubscribers, input.dailyRate, observedAt) : "not available"}`
  ].join("\n");
}

export const mrBeastSubscribersAdapter: WebsiteAdapter = {
  id: "mrbeast-subscribers",
  commandName: "mrbeastsubs",
  displayName: "MrBeast YouTube Subscribers",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "mrbeastsubs",
  alertRoleName: "MrBeast Subs Alerts",
  alertRoleEmoji: "\uD83D\uDC65",
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const [channelResponse, targets] = await Promise.all([
      fetchWithTimeout(sourceUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1",
          "accept-language": "en-US,en;q=0.9"
        }
      }),
      fetchMrBeastSubscriberTargets(integration?.polymarketUrl ?? defaultPolymarketUrl).catch(() => [])
    ]);

    if (!channelResponse.ok) {
      throw new Error(`YouTube returned HTTP ${channelResponse.status}`);
    }

    const currentSubscribers = extractMrBeastSubscribers(await channelResponse.text());
    const previousSubscribers = parseMrBeastStoredSubscribers(integration?.lastValue ?? null);
    const previousCheckedAt = integration?.lastCheckedAt ? new Date(integration.lastCheckedAt) : null;
    const observedAt = new Date();
    const dailyRate = calculateDailyRate(currentSubscribers, previousSubscribers, previousCheckedAt, observedAt);
    const value = buildMrBeastSubscriberValue(
      {
        currentSubscribers,
        previousSubscribers,
        previousCheckedAt: previousCheckedAt && !Number.isNaN(previousCheckedAt.getTime()) ? previousCheckedAt : null,
        dailyRate,
        deadline: parseMrBeastSubscriberMarketDeadline(integration?.polymarketUrl ?? defaultPolymarketUrl, observedAt),
        targets
      },
      observedAt
    );

    return {
      value,
      rawValue: String(currentSubscribers),
      unit: "subscribers",
      observedAt
    };
  }
};

async function fetchMrBeastSubscriberTargets(polymarketUrl: string | null): Promise<MrBeastSubscriberTarget[]> {
  const slug = polymarketUrl ? getPolymarketSlug(polymarketUrl) : null;
  if (!slug) {
    return [];
  }

  const response = await fetchWithTimeout(`${gammaApiUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const events = (await response.json()) as GammaEvent[];
  return extractMrBeastSubscriberTargetsFromGamma(events.flatMap((event) => event.markets ?? []));
}

function calculateDailyRate(
  currentSubscribers: number,
  previousSubscribers: number | null,
  previousCheckedAt: Date | null,
  observedAt: Date
): number | null {
  if (previousSubscribers === null || !previousCheckedAt || Number.isNaN(previousCheckedAt.getTime())) {
    return null;
  }

  const elapsedDays = (observedAt.getTime() - previousCheckedAt.getTime()) / 86_400_000;
  return elapsedDays > 0 ? (currentSubscribers - previousSubscribers) / elapsedDays : null;
}

function formatProjectionTable(
  targets: MrBeastSubscriberTarget[],
  currentSubscribers: number,
  dailyRate: number | null,
  observedAt: Date,
  deadlineDays: number | null
): string {
  if (targets.length === 0) {
    return "not available";
  }

  const rows = targets.map((target) => {
    const remaining = Math.max(0, target.subscribers - currentSubscribers);
    return [
      target.label.padEnd(6),
      (target.resolved || currentSubscribers >= target.subscribers ? "hit" : "open").padEnd(4),
      formatCompactInteger(remaining).padStart(7),
      formatProjectedDate(target, currentSubscribers, dailyRate, observedAt).padEnd(10),
      formatNeededPerDay(remaining, deadlineDays).padStart(9)
    ].join(" | ");
  });

  return ["Target | Stat | Needed  | Projected  | Req/day", "-------|------|---------|------------|---------", ...rows].join("\n");
}

function formatTargetStatus(
  target: MrBeastSubscriberTarget,
  currentSubscribers: number,
  dailyRate: number | null,
  observedAt: Date
): string {
  if (currentSubscribers >= target.subscribers || target.resolved) {
    return `${target.label} hit`;
  }

  const remaining = target.subscribers - currentSubscribers;
  if (dailyRate === null || dailyRate <= 0) {
    return `${target.label}, ${formatInteger(remaining)} subscribers remaining`;
  }

  const projectedAt = new Date(observedAt.getTime() + (remaining / dailyRate) * 86_400_000);
  return `${target.label}, projected ${formatEasternDate(projectedAt)} ET`;
}

function formatProjectedDate(
  target: MrBeastSubscriberTarget,
  currentSubscribers: number,
  dailyRate: number | null,
  observedAt: Date
): string {
  if (target.resolved || currentSubscribers >= target.subscribers) {
    return "hit";
  }

  const remaining = target.subscribers - currentSubscribers;
  if (dailyRate === null || dailyRate <= 0) {
    return "n/a";
  }

  return formatEasternDate(new Date(observedAt.getTime() + (remaining / dailyRate) * 86_400_000));
}

function formatNeededPerDay(remaining: number, deadlineDays: number | null): string {
  if (remaining === 0) {
    return "0/day";
  }

  if (deadlineDays === null) {
    return "n/a";
  }

  return deadlineDays > 0 ? `${formatCompactInteger(Math.ceil(remaining / deadlineDays))}/d` : "late";
}

function isResolvedYesMarket(market: GammaMarket): boolean {
  if (!market.closed) {
    return false;
  }

  const prices = parseJsonStringArray(market.outcomePrices).map(Number);
  const outcomes = parseJsonStringArray(market.outcomes);
  const yesIndex = outcomes.findIndex((outcome) => outcome.toLowerCase() === "yes");
  return prices[yesIndex === -1 ? 0 : yesIndex] === 1;
}

function parseJsonStringArray(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseAbbreviatedCount(value: string | undefined, suffix: string | undefined): number | null {
  const numericValue = Number(value?.replace(/[\s\u00a0,]/g, "").trim());
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  const multiplier = suffix?.toUpperCase() === "M" ? 1_000_000 : suffix?.toUpperCase() === "K" ? 1_000 : 1;
  return Math.round(numericValue * multiplier);
}

function parseInteger(value: string | undefined): number | null {
  const normalized = value?.replace(/[\s\u00a0,]/g, "").trim() ?? "";
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  return Number(normalized);
}

function monthNumber(value: string): number | null {
  const months: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12
  };
  return months[value.toLowerCase()] ?? null;
}

function getEasternYear(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(date));
}

function formatEasternDateTime(date: Date): string {
  return `${formatEasternDate(date)} ${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date)} ET`;
}

function formatEasternDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatSignedInteger(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatInteger(Math.abs(value))}`;
}

function formatCompactInteger(value: number): string {
  if (value >= 1_000_000) {
    return `${formatDecimal(value / 1_000_000)}M`;
  }

  if (value >= 1_000) {
    return `${formatDecimal(value / 1_000)}K`;
  }

  return formatInteger(value);
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}
