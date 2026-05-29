import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.powerball.com/";
const nextDrawingUrl = "https://www.powerball.com/v1/gameapi/next-drawing?gamecode=powerball&language=en";
const targetJackpotMillions = 1_000;

export type PowerballJackpotSnapshot = {
  reportDateEt: string;
  nextDrawingDate: string;
  nextDrawingUtc: string | null;
  estimatedJackpot: string;
  estimatedJackpotMillions: number | null;
  cashValue: string;
  cashValueMillions: number | null;
};

export function extractPowerballJackpotValue(html: string, observedAt: Date = new Date()): string {
  const snapshot = extractPowerballJackpotSnapshot(html, observedAt);
  return [
    `Report date (ET): ${snapshot.reportDateEt}`,
    `Estimated jackpot: ${snapshot.estimatedJackpot}`,
    `Target: $1 Billion`,
    `Target status: ${formatTargetStatus(snapshot.estimatedJackpotMillions)}`,
    `Cash value: ${snapshot.cashValue}`,
    `Next drawing: ${snapshot.nextDrawingDate}`,
    `Draw time UTC: ${snapshot.nextDrawingUtc ?? "unknown"}`
  ].join("\n");
}

export function extractPowerballJackpotSnapshot(html: string, observedAt: Date = new Date()): PowerballJackpotSnapshot {
  const $ = cheerio.load(html);
  const nextDrawingDate = normalizeText($(".next-card .title-date").first().text());
  const nextDrawingUtc = normalizePowerballUtc($("#nextDraw").attr("data-drawdateutc") ?? null);
  const labeledValues = extractLabeledValues($);
  const estimatedJackpot = labeledValues.get("estimated jackpot") ?? "";
  const cashValue = labeledValues.get("cash value") ?? "";

  if (!nextDrawingDate || !estimatedJackpot) {
    throw new Error("Could not find Powerball next drawing jackpot data");
  }

  return {
    reportDateEt: formatEasternDate(observedAt),
    nextDrawingDate,
    nextDrawingUtc,
    estimatedJackpot,
    estimatedJackpotMillions: parseJackpotMillions(estimatedJackpot),
    cashValue: cashValue || "unknown",
    cashValueMillions: parseJackpotMillions(cashValue)
  };
}

export const powerballJackpotAdapter: WebsiteAdapter = {
  id: "powerball-jackpot",
  commandName: "powerball",
  displayName: "Powerball Jackpot",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/will-the-powerball-jackpot-hit-1-billion-by-july-31",
  defaultChannelName: "powerball",
  alertRoleName: "Powerball Jackpot Alerts",
  alertRoleEmoji: "\uD83C\uDFB0",
  getPollIntervalMinutes: () => 1_440,
  getPollIntervalReason: () => "Fixed daily Powerball jackpot trend check",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const observedAt = new Date();
    const response = await fetchWithTimeout(nextDrawingUrl, {
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1",
        "x-requested-with": "XMLHttpRequest"
      }
    });

    if (!response.ok) {
      throw new Error(`Powerball returned HTTP ${response.status}`);
    }

    const value = extractPowerballJackpotValue(await response.text(), observedAt);
    return {
      value,
      rawValue: value,
      unit: "estimated jackpot",
      observedAt
    };
  }
};

function extractLabeledValues($: cheerio.CheerioAPI): Map<string, string> {
  const values = new Map<string, string>();
  $(".game-detail-group, .winners-group").each((_, row) => {
    const label = normalizeText($(row).find(".game-title").first().text()).toLowerCase();
    const value = normalizeText($(row).find(".game-jackpot-number").first().text());
    if (label && value) {
      values.set(label, value);
    }
  });
  return values;
}

function parseJackpotMillions(value: string): number | null {
  const match = value.replace(/,/g, "").match(/\$?([0-9]+(?:\.[0-9]+)?)\s*(billion|million)?/i);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return null;
  }

  const unit = match[2]?.toLowerCase();
  return unit === "billion" ? amount * 1_000 : amount;
}

function formatTargetStatus(estimatedJackpotMillions: number | null): string {
  if (estimatedJackpotMillions === null) {
    return "unknown";
  }

  const progress = `${(estimatedJackpotMillions / targetJackpotMillions * 100).toFixed(1)}%`;
  if (estimatedJackpotMillions >= targetJackpotMillions) {
    return `at/above target (${progress}, ${formatMillions(estimatedJackpotMillions - targetJackpotMillions)} above)`;
  }

  return `below target (${progress}, ${formatMillions(targetJackpotMillions - estimatedJackpotMillions)} to go)`;
}

function formatMillions(value: number): string {
  if (value >= 1_000) {
    return `$${formatNumber(value / 1_000)} Billion`;
  }

  return `$${formatNumber(value)} Million`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function normalizePowerballUtc(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().replace(/\.(\d{3})\d*Z$/i, ".$1Z");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value.trim() : date.toISOString();
}

function formatEasternDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}
