import { fetchWithTimeout } from "../http.js";
import { formatEasternDateTime } from "../time.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.ticketdata.com/events/855416";
const renderedSourceUrl = `https://r.jina.ai/http://${sourceUrl}`;
const defaultPolymarketUrl = "https://polymarket.com/event/world-cup-final-get-in-ticket-price-20260716200417439";
const userAgent = "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1";
const kickoffAt = new Date("2026-07-19T19:00:00.000Z");
const fastPollingStartAt = new Date("2026-07-18T04:00:00.000Z");
const finalDeadlineAt = new Date("2026-08-01T03:59:00.000Z");

type TicketDataSourceText = {
  text: string;
  sourceStatus: string;
};

export type TicketDataWorldCupSnapshot = {
  eventTitle: string;
  finalGetInPrice: number | null;
  currentGetInPrice: number | null;
  marketBracket: string;
  finalStatus: "not final yet" | "final";
  sourceStatus: string;
};

export const ticketDataWorldCupFinalAdapter: WebsiteAdapter = {
  id: "ticketdata-world-cup-final",
  commandName: "wcticket",
  displayName: "World Cup Final Ticket Price",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "wcticket",
  alertRoleName: "World Cup Ticket Alerts",
  alertRoleEmoji: "\uD83C\uDF9F\uFE0F",
  getPollIntervalMinutes: (_integration, now = new Date()) => getTicketDataPollIntervalMinutes(now),
  getPollIntervalReason: (_integration, now = new Date()) =>
    getTicketDataPollIntervalMinutes(now) === 1
      ? "1-minute TicketData checks from the pre-final window through the July 31 final-price deadline"
      : "Hourly TicketData checks outside the World Cup Final price window",
  getErrorNoticeWindowMinutes: () => 30,
  shouldAlertOnChange: shouldAlertOnTicketDataWorldCupChange,
  async fetchCurrentValue(_integration?: Integration): Promise<AdapterValue> {
    const source = await fetchTicketDataWorldCupSourceText();
    const snapshot = extractTicketDataWorldCupSnapshot(source.text, source.sourceStatus);
    const value = formatTicketDataWorldCupValue(snapshot);
    return {
      value,
      rawValue: value,
      unit: "get-in ticket price",
      observedAt: new Date()
    };
  }
};

export function getTicketDataPollIntervalMinutes(now = new Date()): number {
  return now >= fastPollingStartAt && now <= finalDeadlineAt ? 1 : 60;
}

export function extractTicketDataWorldCupSnapshot(text: string, sourceStatus = "TicketData"): TicketDataWorldCupSnapshot {
  const normalizedText = normalizeWhitespace(text);
  const eventTitle =
    text.match(/^Title:\s*(.+)$/im)?.[1]?.trim() ??
    normalizedText.match(/\[(?:M104|M\s*104)\]\s+([^|]+?)\s+Tickets/i)?.[1]?.trim() ??
    "2026 FIFA World Cup Final";
  const finalGetInPrice = parsePriceAfterLabel(text, /Final\s+Get[-\s]?In\s+Price/i);
  const currentGetInPrice =
    parsePriceAfterLabel(text, /Current\s+Get[-\s]?In\s+Price/i) ??
    parsePriceAfterHeading(text, "Current Get-In Price");
  const marketPrice = finalGetInPrice ?? currentGetInPrice;

  if (marketPrice === null && !/Get[-\s]?In\s+Price/i.test(text)) {
    throw new Error("Could not find TicketData get-in price text for World Cup Final event 855416");
  }

  return {
    eventTitle,
    finalGetInPrice,
    currentGetInPrice,
    marketBracket: marketPrice === null ? "unknown" : getTicketPriceBracket(marketPrice),
    finalStatus: finalGetInPrice === null ? "not final yet" : "final",
    sourceStatus
  };
}

export function formatTicketDataWorldCupValue(snapshot: TicketDataWorldCupSnapshot): string {
  return [
    "Metric: TicketData World Cup Final get-in ticket price",
    `Final status: ${snapshot.finalStatus}`,
    `Final price published: ${snapshot.finalGetInPrice === null ? "no" : "yes"}`,
    `Final Get-In Price: ${formatPrice(snapshot.finalGetInPrice)}`,
    `Current get-in price: ${formatPrice(snapshot.currentGetInPrice)}`,
    `Market bracket: ${snapshot.marketBracket}`,
    `Event: ${snapshot.eventTitle}`,
    `Kickoff: ${formatEasternDateTime(kickoffAt)}`,
    `Final deadline: ${formatEasternDateTime(finalDeadlineAt)}`,
    `Source status: ${snapshot.sourceStatus}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function getTicketPriceBracket(price: number): string {
  if (price < 6_000) {
    return "< $6,000";
  }
  if (price < 6_500) {
    return "$6,000-$6,500";
  }
  if (price < 7_000) {
    return "$6,500-$7,000";
  }
  if (price < 7_500) {
    return "$7,000-$7,500";
  }
  if (price < 8_000) {
    return "$7,500-$8,000";
  }
  if (price < 8_500) {
    return "$8,000-$8,500";
  }
  if (price < 9_000) {
    return "$8,500-$9,000";
  }
  return ">= $9,000";
}

export function shouldAlertOnTicketDataWorldCupChange(previousValue: string | null, currentValue: string): boolean {
  if (previousValue === null) {
    return false;
  }

  const previousFinalStatus = extractValueLine(previousValue, "Final status");
  const currentFinalStatus = extractValueLine(currentValue, "Final status");
  const previousFinalPrice = extractValueLine(previousValue, "Final Get-In Price");
  const currentFinalPrice = extractValueLine(currentValue, "Final Get-In Price");

  if (previousFinalStatus !== currentFinalStatus || previousFinalPrice !== currentFinalPrice) {
    return true;
  }

  if (currentFinalStatus === "final") {
    return false;
  }

  return extractValueLine(previousValue, "Market bracket") !== extractValueLine(currentValue, "Market bracket");
}

async function fetchTicketDataWorldCupSourceText(): Promise<TicketDataSourceText> {
  const directResponse = await fetchWithTimeout(
    sourceUrl,
    {
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain,*/*",
        "user-agent": userAgent
      }
    },
    20_000
  ).catch(() => null);

  if (directResponse?.ok) {
    const text = await directResponse.text();
    if (!isCloudflareBlock(text) && /Get[-\s]?In\s+Price/i.test(text)) {
      return { text, sourceStatus: "TicketData direct" };
    }
  }

  const renderedResponse = await fetchWithTimeout(
    renderedSourceUrl,
    {
      headers: {
        accept: "text/markdown,text/plain,*/*",
        "user-agent": userAgent,
        "x-no-cache": "true"
      }
    },
    30_000
  );
  if (!renderedResponse.ok) {
    throw new Error(`TicketData rendered page returned HTTP ${renderedResponse.status}`);
  }
  const renderedText = await renderedResponse.text();
  if (isCloudflareBlock(renderedText)) {
    throw new Error("TicketData rendered page returned Cloudflare block content");
  }
  return { text: renderedText, sourceStatus: "TicketData via r.jina.ai reader" };
}

function parsePriceAfterLabel(text: string, label: RegExp): number | null {
  const labelMatch = text.match(label);
  if (!labelMatch?.index && labelMatch?.index !== 0) {
    return null;
  }

  const afterLabel = text.slice(labelMatch.index + labelMatch[0].length, labelMatch.index + labelMatch[0].length + 180);
  const priceMatch = afterLabel.match(/\$\s*([0-9][0-9,]*(?:\.\d+)?)/);
  return priceMatch ? parsePrice(priceMatch[1]) : null;
}

function parsePriceAfterHeading(text: string, heading: string): number | null {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escapedHeading}\\s+\\$\\s*([0-9][0-9,]*(?:\\.\\d+)?)`, "i"));
  return match ? parsePrice(match[1]) : null;
}

function parsePrice(value: string): number {
  return Number(value.replace(/,/g, ""));
}

function formatPrice(value: number | null): string {
  if (value === null) {
    return "not posted yet";
  }
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function extractValueLine(value: string, label: string): string | null {
  return value.match(new RegExp(`^${escapeRegExp(label)}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isCloudflareBlock(text: string): boolean {
  return /cloudflare|just a moment|attention required|cf-chl|challenge-platform/i.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
