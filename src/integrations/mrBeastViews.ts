import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug, parseManualEasternDateTime } from "../marketEnd.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.youtube.com/@MrBeast/about";
const defaultPolymarketUrl = "https://polymarket.com/event/will-mrbeast-hit-billion-views-by-june-30";
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

export type MrBeastViewTarget = {
  label: string;
  views: number;
  resolved: boolean;
};

export type MrBeastViewProjection = {
  currentViews: number;
  previousViews: number | null;
  previousCheckedAt: Date | null;
  dailyRate: number | null;
  deadline: Date | null;
  targets: MrBeastViewTarget[];
};

export function extractMrBeastTotalViews(html: string): number {
  const patterns = [
    /"viewCountText"\s*:\s*"([\d,\s\u00a0.]+)\s+views"/i,
    /"viewCountText"\s*:\s*\{\s*"simpleText"\s*:\s*"([\d,\s\u00a0.]+)\s+views"/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = parseViewCount(match?.[1]);
    if (value !== null) {
      return value;
    }
  }

  throw new Error("Could not find MrBeast YouTube channel total views");
}

export function extractMrBeastTargetsFromGamma(markets: GammaMarket[]): MrBeastViewTarget[] {
  const targets = markets.flatMap((market) => {
    const match = market.question?.match(/MrBeast hit ([\d.]+)\s+billion views/i);
    if (!match) {
      return [];
    }

    return [
      {
        label: `${match[1]}B`,
        views: Math.round(Number(match[1]) * 1_000_000_000),
        resolved: isResolvedYesMarket(market)
      }
    ];
  });

  return targets
    .filter((target) => Number.isFinite(target.views))
    .sort((left, right) => left.views - right.views);
}

export function parseMrBeastMarketDeadline(polymarketUrl: string | null, now = new Date()): Date | null {
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

export function parseMrBeastStoredViews(value: string | null): number | null {
  const match = value?.match(/Total views:\s*([\d,]+)/i);
  return parseViewCount(match?.[1]);
}

export function buildMrBeastViewValue(input: MrBeastViewProjection, observedAt = new Date()): string {
  const dailyRate = input.dailyRate;
  const openTargets = input.targets.filter((target) => !target.resolved);
  const nextTarget = openTargets.find((target) => target.views > input.currentViews) ?? openTargets[0] ?? input.targets.at(-1) ?? null;
  const deadlineDays = input.deadline ? Math.max(0, (input.deadline.getTime() - observedAt.getTime()) / 86_400_000) : null;

  return [
    "Metric: MrBeast YouTube channel total views",
    `Total views: ${formatInteger(input.currentViews)}`,
    `Previous views: ${input.previousViews === null ? "not available" : formatInteger(input.previousViews)}`,
    `Change since previous check: ${input.previousViews === null ? "not available" : formatSignedInteger(input.currentViews - input.previousViews)}`,
    `Dailyized rate: ${dailyRate === null ? "not available" : `${formatSignedInteger(Math.round(dailyRate))}/day`}`,
    `Market deadline: ${input.deadline ? formatEasternDateTime(input.deadline) : "not parsed"}`,
    `Next open target: ${nextTarget ? formatTargetStatus(nextTarget, input.currentViews, dailyRate, observedAt) : "not available"}`,
    `Views needed by deadline: ${formatViewsNeededByDeadline(nextTarget, input.currentViews, deadlineDays)}`,
    `Market targets: ${formatTargetList(input.targets, input.currentViews)}`
  ].join("\n");
}

export const mrBeastViewsAdapter: WebsiteAdapter = {
  id: "mrbeast-views",
  commandName: "mrbeast",
  displayName: "MrBeast YouTube Views",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "mrbeast",
  alertRoleName: "MrBeast Views Alerts",
  alertRoleEmoji: "\uD83D\uDC40",
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const [channelResponse, targets] = await Promise.all([
      fetchWithTimeout(sourceUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1",
          "accept-language": "en-US,en;q=0.9"
        }
      }),
      fetchMrBeastTargets(integration?.polymarketUrl ?? defaultPolymarketUrl).catch(() => [])
    ]);

    if (!channelResponse.ok) {
      throw new Error(`YouTube returned HTTP ${channelResponse.status}`);
    }

    const currentViews = extractMrBeastTotalViews(await channelResponse.text());
    const previousViews = parseMrBeastStoredViews(integration?.lastValue ?? null);
    const previousCheckedAt = integration?.lastCheckedAt ? new Date(integration.lastCheckedAt) : null;
    const observedAt = new Date();
    const dailyRate = calculateDailyRate(currentViews, previousViews, previousCheckedAt, observedAt);
    const value = buildMrBeastViewValue(
      {
        currentViews,
        previousViews,
        previousCheckedAt: previousCheckedAt && !Number.isNaN(previousCheckedAt.getTime()) ? previousCheckedAt : null,
        dailyRate,
        deadline: parseMrBeastMarketDeadline(integration?.polymarketUrl ?? defaultPolymarketUrl, observedAt),
        targets
      },
      observedAt
    );

    return {
      value,
      rawValue: String(currentViews),
      unit: "views",
      observedAt
    };
  }
};

async function fetchMrBeastTargets(polymarketUrl: string | null): Promise<MrBeastViewTarget[]> {
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
  return extractMrBeastTargetsFromGamma(events.flatMap((event) => event.markets ?? []));
}

function calculateDailyRate(currentViews: number, previousViews: number | null, previousCheckedAt: Date | null, observedAt: Date): number | null {
  if (previousViews === null || !previousCheckedAt || Number.isNaN(previousCheckedAt.getTime())) {
    return null;
  }

  const elapsedDays = (observedAt.getTime() - previousCheckedAt.getTime()) / 86_400_000;
  return elapsedDays > 0 ? (currentViews - previousViews) / elapsedDays : null;
}

function formatTargetStatus(target: MrBeastViewTarget, currentViews: number, dailyRate: number | null, observedAt: Date): string {
  if (currentViews >= target.views || target.resolved) {
    return `${target.label} hit`;
  }

  const remaining = target.views - currentViews;
  if (dailyRate === null || dailyRate <= 0) {
    return `${target.label}, ${formatInteger(remaining)} views remaining`;
  }

  const projectedAt = new Date(observedAt.getTime() + (remaining / dailyRate) * 86_400_000);
  return `${target.label}, projected ${formatEasternDate(projectedAt)} ET`;
}

function formatViewsNeededByDeadline(target: MrBeastViewTarget | null, currentViews: number, deadlineDays: number | null): string {
  if (!target || deadlineDays === null) {
    return "not available";
  }

  const remaining = Math.max(0, target.views - currentViews);
  if (remaining === 0) {
    return "0/day";
  }

  return deadlineDays > 0 ? `${formatInteger(Math.ceil(remaining / deadlineDays))}/day` : "deadline passed";
}

function formatTargetList(targets: MrBeastViewTarget[], currentViews: number): string {
  if (targets.length === 0) {
    return "not available";
  }

  return targets
    .map((target) => `${target.label} ${target.resolved || currentViews >= target.views ? "hit" : "open"}`)
    .join(" | ");
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

function parseViewCount(value: string | undefined): number | null {
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
