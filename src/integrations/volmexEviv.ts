import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://charts.volmex.finance/symbol/EVIV";
const volmexHistoryBaseUrl = "https://rest-v2.volmex.finance/public/history";
const defaultPolymarketUrl = "https://polymarket.com/event/what-will-the-ethereum-implied-volatility-index-hit-by-june-30";

export type VolmexEvivCandle = {
  high: number;
  low: number;
  close: number;
  timestamp: string;
};

export type VolmexEvivStrike = {
  display: string;
  value: number;
};

export type VolmexEvivStrikeCrossing = VolmexEvivStrike & {
  price: number;
  timestamp: string;
};

type GammaEvent = {
  markets?: GammaMarket[];
};

type GammaMarket = {
  active?: boolean;
  archived?: boolean;
  closed?: boolean;
  question?: string;
  groupItemTitle?: string;
  outcomePrices?: string;
};

export const volmexEvivAdapter: WebsiteAdapter = {
  id: "volmex-eviv-high-strikes",
  commandName: "eviv",
  displayName: "Volmex EVIV High Strikes",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "eviv",
  alertRoleName: "EVIV Alerts",
  alertRoleEmoji: "\uD83D\uDCC8",
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "Fixed 1-minute EVIV high strike watch; normal value changes do not alert",
  getErrorNoticeWindowMinutes: () => 30,
  shouldAlertOnChange: volmexEvivShouldAlertOnChange,
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const value = await fetchVolmexEvivStrikeMonitorValue(integration);
    return {
      value,
      rawValue: value,
      unit: "EVIV 1m high strike crossings",
      observedAt: new Date()
    };
  }
};

export async function fetchVolmexEvivStrikeMonitorValue(integration?: Integration): Promise<string> {
  const polymarketUrl = integration?.polymarketUrl ?? defaultPolymarketUrl;
  const strikes = await fetchVolmexEvivHighStrikes(polymarketUrl, parseStoredTrackedStrikes(integration?.lastValue ?? null, polymarketUrl));
  const candles = await fetchVolmexEvivCandles(getHistoryRange(integration));
  const previousPrice = parseStoredLastPrice(integration?.lastValue ?? null);
  const allCrossings = previousPrice === null ? [] : findVolmexEvivHighStrikeCrossings(strikes, previousPrice, candles);
  const alertState = filterNewVolmexEvivStrikeCrossings(integration?.lastValue ?? null, polymarketUrl, allCrossings);
  const latestCandle = candles.at(-1);
  const lastPrice = latestCandle?.close ?? previousPrice;
  const lastPriceTime = latestCandle?.timestamp ?? "not available";

  return formatVolmexEvivStrikeMonitorValue({
    polymarketUrl,
    lastPrice,
    lastPriceTime,
    strikes,
    crossings: alertState.crossings,
    alertedStrikes: alertState.alertedStrikes
  });
}

export function extractVolmexEvivCandles(data: unknown): VolmexEvivCandle[] {
  if (!isRecord(data) || !Array.isArray(data.t) || !Array.isArray(data.h) || !Array.isArray(data.l) || !Array.isArray(data.c)) {
    return [];
  }

  const length = Math.min(data.t.length, data.h.length, data.l.length, data.c.length);
  const candles: VolmexEvivCandle[] = [];
  for (let index = 0; index < length; index += 1) {
    const timestampSeconds = parseNumber(data.t[index]);
    const high = parseNumber(data.h[index]);
    const low = parseNumber(data.l[index]);
    const close = parseNumber(data.c[index]);
    if (timestampSeconds === null || high === null || low === null || close === null) {
      continue;
    }

    candles.push({
      high,
      low,
      close,
      timestamp: new Date(timestampSeconds * 1_000).toISOString()
    });
  }

  return candles.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function extractVolmexEvivHighStrikesFromGamma(data: unknown): VolmexEvivStrike[] {
  const event = Array.isArray(data) ? (data[0] as GammaEvent | undefined) : (data as GammaEvent | undefined);
  const seen = new Set<string>();
  const strikes: VolmexEvivStrike[] = [];

  for (const market of event?.markets ?? []) {
    if (isResolvedGammaMarket(market)) {
      continue;
    }

    const strike = extractHighStrikeFromText([market.groupItemTitle, market.question].filter(Boolean).join(" "));
    if (strike && !seen.has(strike.display)) {
      seen.add(strike.display);
      strikes.push(strike);
    }
  }

  return strikes.sort((left, right) => left.value - right.value);
}

export function findVolmexEvivHighStrikeCrossings(
  strikes: VolmexEvivStrike[],
  previousPrice: number,
  candles: VolmexEvivCandle[]
): VolmexEvivStrikeCrossing[] {
  const crossings: VolmexEvivStrikeCrossing[] = [];
  let referencePrice = previousPrice;

  for (const candle of candles) {
    for (const strike of strikes) {
      if (referencePrice < strike.value && candle.high >= strike.value) {
        crossings.push({ ...strike, price: candle.high, timestamp: candle.timestamp });
      }
    }

    referencePrice = candle.close;
  }

  return dedupeCrossings(crossings);
}

export function filterNewVolmexEvivStrikeCrossings(
  previousValue: string | null,
  polymarketUrl: string,
  crossings: VolmexEvivStrikeCrossing[]
): { crossings: VolmexEvivStrikeCrossing[]; alertedStrikes: string[] } {
  const previouslyAlertedStrikes = parseStoredAlertedStrikes(previousValue, polymarketUrl);
  const newCrossings = crossings.filter((crossing) => !previouslyAlertedStrikes.has(crossing.display));
  const alertedStrikes = new Set(previouslyAlertedStrikes);
  for (const crossing of newCrossings) {
    alertedStrikes.add(crossing.display);
  }

  return {
    crossings: newCrossings,
    alertedStrikes: [...alertedStrikes].sort(compareStrikeDisplays)
  };
}

export function formatVolmexEvivStrikeMonitorValue(input: {
  polymarketUrl?: string;
  lastPrice: number | null;
  lastPriceTime: string;
  strikes: VolmexEvivStrike[];
  crossings: VolmexEvivStrikeCrossing[];
  alertedStrikes?: string[];
}): string {
  return [
    "Symbol: EVIV",
    `Last Price: ${input.lastPrice === null ? "not available" : formatPrice(input.lastPrice)}`,
    `Last Price Time: ${input.lastPriceTime}`,
    "Crossed High Strikes:",
    input.crossings.length > 0 ? input.crossings.map(formatCrossing).join("\n") : "none",
    "Alerted Strikes:",
    input.alertedStrikes && input.alertedStrikes.length > 0 ? input.alertedStrikes.join(", ") : "none",
    "Tracked High Strikes:",
    input.strikes.length > 0 ? input.strikes.map((strike) => strike.display).join(", ") : "none",
    `Resolution: ${sourceUrl}`,
    `Alerted For: ${input.polymarketUrl ?? "not set"}`
  ].join("\n");
}

export function volmexEvivShouldAlertOnChange(_previousValue: string | null, currentValue: string): boolean {
  return parseCurrentCrossings(currentValue).length > 0;
}

export function buildVolmexEvivHistoryUrl(range: { from: Date; to: Date }): string {
  const url = new URL(volmexHistoryBaseUrl);
  url.searchParams.set("symbol", "EVIV");
  url.searchParams.set("resolution", "1");
  url.searchParams.set("from", Math.floor(range.from.getTime() / 1_000).toString());
  url.searchParams.set("to", Math.floor(range.to.getTime() / 1_000).toString());
  return url.toString();
}

async function fetchVolmexEvivHighStrikes(polymarketUrl: string, fallbackStrikes: VolmexEvivStrike[] = []): Promise<VolmexEvivStrike[]> {
  let lastError: unknown = null;
  for (const slug of getPolymarketSlugCandidates(polymarketUrl)) {
    try {
      const response = await fetchWithTimeout(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`, {
        headers: {
          accept: "application/json",
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
        }
      });
      if (!response.ok) {
        throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
      }

      const strikes = extractVolmexEvivHighStrikesFromGamma(await response.json());
      if (strikes.length > 0) {
        return strikes;
      }
    } catch (error) {
      lastError = error;
    }
  }

  const explicitStrike = extractHighStrikeFromPolymarketUrl(polymarketUrl);
  if (explicitStrike) {
    return [explicitStrike];
  }
  if (fallbackStrikes.length > 0) {
    return fallbackStrikes;
  }
  if (lastError instanceof Error) {
    throw lastError;
  }

  return [];
}

async function fetchVolmexEvivCandles(range: { from: Date; to: Date }): Promise<VolmexEvivCandle[]> {
  const response = await fetchWithTimeout(buildVolmexEvivHistoryUrl(range), {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`Volmex EVIV history endpoint returned HTTP ${response.status}`);
  }

  return extractVolmexEvivCandles(await response.json());
}

function getHistoryRange(integration?: Integration): { from: Date; to: Date } {
  const to = new Date();
  if (!integration?.lastCheckedAt) {
    return {
      from: new Date(to.getTime() - 2 * 60 * 60_000),
      to
    };
  }

  const previousCheck = new Date(integration.lastCheckedAt);
  return {
    from: Number.isNaN(previousCheck.getTime()) ? new Date(to.getTime() - 2 * 60 * 60_000) : new Date(previousCheck.getTime() - 5 * 60_000),
    to
  };
}

function getPolymarketSlugCandidates(polymarketUrl: string): string[] {
  try {
    const parts = new URL(polymarketUrl).pathname.split("/").filter(Boolean);
    const eventIndex = parts.indexOf("event");
    const slugs = eventIndex >= 0 ? parts.slice(eventIndex + 1) : parts;
    return [...new Set([...slugs].reverse())];
  } catch {
    return [];
  }
}

function extractHighStrikeFromPolymarketUrl(polymarketUrl: string): VolmexEvivStrike | null {
  const slug = getPolymarketSlugCandidates(polymarketUrl)[0] ?? "";
  const normalized = decodeURIComponent(slug).toLowerCase();
  const match =
    normalized.match(/(?:hit|hits|high|above|over|reach|reaches|rise|rises)-to-([\d]+(?:pt[\d]+)?)/) ??
    normalized.match(/(?:hit|hits|high|above|over|reach|reaches|rise|rises)-([\d]+(?:pt[\d]+)?)/);
  if (!match) {
    return null;
  }

  const value = parseNumber(match[1].replace("pt", "."));
  return value === null ? null : { display: formatStrikeDisplay(value), value };
}

function extractHighStrikeFromText(text: string): VolmexEvivStrike | null {
  if (!/(?:↑|â†‘|hit|hits|high|above|over|reach|reaches|at least|greater)/i.test(text)) {
    return null;
  }

  const match =
    text.match(/(?:↑|â†‘|hit(?:s)?(?:\s+to)?|high|above|over|reach(?:es)?|at least|greater than|>=)\s*([\d,]+(?:\.\d+)?)/i) ??
    text.match(/([\d,]+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }

  const value = parseNumber(match[1]);
  return value === null ? null : { display: formatStrikeDisplay(value), value };
}

function isResolvedGammaMarket(market: GammaMarket): boolean {
  if (market.closed || market.archived || market.active === false) {
    return true;
  }

  if (!market.outcomePrices) {
    return false;
  }

  try {
    const prices = JSON.parse(market.outcomePrices) as unknown;
    return Array.isArray(prices) && prices.some((price) => Number(price) === 1);
  } catch {
    return false;
  }
}

function parseStoredLastPrice(value: string | null): number | null {
  const match = value?.match(/^Last Price:\s*([\d,.]+)/m);
  return match ? parseNumber(match[1]) : null;
}

function parseStoredAlertedStrikes(value: string | null, polymarketUrl: string): Set<string> {
  if (!value || !value.includes(`Alerted For: ${polymarketUrl}`)) {
    return new Set();
  }

  const lines = value.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "Alerted Strikes:");
  const end = lines.findIndex((line) => line === "Tracked High Strikes:");
  if (start === -1 || end === -1 || end <= start) {
    return new Set();
  }

  const alertedText = lines.slice(start + 1, end).join(" ");
  if (!alertedText || alertedText === "none") {
    return new Set();
  }

  return new Set(alertedText.match(/\b\d+(?:\.\d+)?\b/g) ?? []);
}

function parseStoredTrackedStrikes(value: string | null, polymarketUrl: string): VolmexEvivStrike[] {
  if (!value || !value.includes(`Alerted For: ${polymarketUrl}`)) {
    return [];
  }

  const lines = value.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "Tracked High Strikes:");
  const end = lines.findIndex((line, index) => index > start && line.startsWith("Resolution:"));
  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  const trackedText = lines.slice(start + 1, end).join(" ");
  if (!trackedText || trackedText === "none") {
    return [];
  }

  return (trackedText.match(/\b\d+(?:\.\d+)?\b/g) ?? [])
    .map((display) => {
      const value = parseNumber(display);
      return value === null ? null : { display: formatStrikeDisplay(value), value };
    })
    .filter((strike): strike is VolmexEvivStrike => strike !== null)
    .sort((left, right) => left.value - right.value);
}

function parseCurrentCrossings(value: string): string[] {
  const lines = value.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "Crossed High Strikes:");
  const alertedStart = lines.findIndex((line) => line === "Alerted Strikes:");
  const trackedStart = lines.findIndex((line) => line === "Tracked High Strikes:");
  const end = alertedStart === -1 ? trackedStart : alertedStart;
  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  return lines.slice(start + 1, end).filter((line) => line && line !== "none");
}

function dedupeCrossings(crossings: VolmexEvivStrikeCrossing[]): VolmexEvivStrikeCrossing[] {
  const seen = new Set<string>();
  const deduped: VolmexEvivStrikeCrossing[] = [];
  for (const crossing of crossings) {
    if (!seen.has(crossing.display)) {
      seen.add(crossing.display);
      deduped.push(crossing);
    }
  }

  return deduped;
}

function formatCrossing(crossing: VolmexEvivStrikeCrossing): string {
  return `${crossing.display} crossed up; EVIV 1m high ${formatPrice(crossing.price)} at ${crossing.timestamp}`;
}

function formatStrikeDisplay(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0
  }).format(value);
}

function compareStrikeDisplays(left: string, right: string): number {
  return (parseNumber(left) ?? 0) - (parseNumber(right) ?? 0);
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/[,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

  return Number(normalized);
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 5,
    minimumFractionDigits: 0
  }).format(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
