import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { fetchWithTimeout } from "../http.js";
import { upsertPolymarketQueueUrl } from "../polymarketQueue.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://pokerdb.thehendonmob.com/ranking/11059/";
const defaultPolymarketUrl = "https://polymarket.com/event/poker-2026-money-list-1-20260714173014547";
const userAgent = "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1";
const knownCountries = new Set([
  "Argentina",
  "Australia",
  "Austria",
  "Belarus",
  "Belgium",
  "Brazil",
  "Bulgaria",
  "Canada",
  "China",
  "Czech Republic",
  "Denmark",
  "Estonia",
  "Finland",
  "France",
  "Germany",
  "Greece",
  "Hungary",
  "India",
  "Ireland",
  "Israel",
  "Italy",
  "Japan",
  "Latvia",
  "Lithuania",
  "Mexico",
  "Netherlands",
  "Norway",
  "Poland",
  "Portugal",
  "Romania",
  "Russia",
  "Serbia",
  "Slovakia",
  "Slovenia",
  "South Korea",
  "Spain",
  "Sweden",
  "Switzerland",
  "Taiwan",
  "Ukraine",
  "United Arab Emirates",
  "United Kingdom",
  "United States"
]);

export type HendonMobMoneyListRow = {
  rank: number;
  player: string;
  country: string | null;
  winnings: string | null;
};

export const hendonMobMoneyListAdapter: WebsiteAdapter = {
  id: "hendon-mob-money-list",
  commandName: "pokermoney",
  displayName: "Poker 2026 Money List",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "pokermoney",
  alertRoleName: "Poker Money List Alerts",
  alertRoleEmoji: "\uD83C\uDCCF",
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Hourly Hendon Mob 2026 Money List checks; alerts only when the top 3 rank order changes.",
  getErrorNoticeWindowMinutes: () => 30,
  shouldAlertOnChange: shouldAlertOnHendonMobMoneyListChange,
  upsertPolymarketMarket(integration: Integration, url: string): { settingsJson: string | null; activeUrl: string | null } {
    return upsertPolymarketQueueUrl(integration, url);
  },
  async fetchCurrentValue(): Promise<AdapterValue> {
    const fetchUrl = getHendonMobSourceUrl();
    const response = await fetchWithTimeout(fetchUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": userAgent
      }
    });
    const body = await response.text();

    if (!response.ok) {
      if (isCloudflareChallenge(body)) {
        throw new Error(
          `Hendon Mob returned HTTP ${response.status} with a Cloudflare/browser verification page. Official source: ${sourceUrl}`
        );
      }
      throw new Error(`Hendon Mob returned HTTP ${response.status}`);
    }

    if (isCloudflareChallenge(body)) {
      throw new Error(`Hendon Mob returned a Cloudflare/browser verification page. Official source: ${sourceUrl}`);
    }

    const value = formatHendonMobMoneyListValue(extractHendonMobMoneyListRows(body, 10), fetchUrl);
    return {
      value,
      rawValue: value,
      unit: "Hendon Mob 2026 Money List top 3",
      observedAt: new Date()
    };
  }
};

export function extractHendonMobMoneyListRows(html: string, limit = 10): HendonMobMoneyListRow[] {
  const $ = cheerio.load(html);
  const rows: HendonMobMoneyListRow[] = [];

  $("table tr").each((_, rowElement) => {
    const row = $(rowElement);
    const cells = row.find("td");
    if (cells.length === 0) {
      return;
    }

    const rank = extractRank(row.text());
    const player = extractPlayerName($, row);
    if (!rank || !player) {
      return;
    }

    rows.push({
      rank,
      player,
      country: extractCountry($, row),
      winnings: extractWinnings(row.text())
    });
  });

  const sortedRows = rows
    .filter((row, index, allRows) => allRows.findIndex((candidate) => candidate.rank === row.rank) === index)
    .sort((left, right) => left.rank - right.rank)
    .slice(0, limit);

  if (sortedRows.length === 0) {
    throw new Error("Could not parse Hendon Mob 2026 Money List rows from the official source page");
  }

  return sortedRows;
}

export function formatHendonMobMoneyListValue(rows: HendonMobMoneyListRow[], fetchUrl = sourceUrl): string {
  if (rows.length === 0) {
    throw new Error("Cannot format empty Hendon Mob money list");
  }

  const topThree = rows.slice(0, 3).map((row) => `#${row.rank} ${formatPlayer(row)}`).join(" | ");
  return [
    "Metric: The Hendon Mob 2026 Money List",
    `Top 3: ${topThree}`,
    ...rows.map((row) => `Rank ${row.rank}: ${formatPlayer(row)}${row.winnings ? ` - ${row.winnings}` : ""}`),
    "Tracking scope: top 3 rank order only",
    `Fetch source: ${fetchUrl}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function shouldAlertOnHendonMobMoneyListChange(previousValue: string | null, currentValue: string): boolean {
  if (previousValue === null) {
    return false;
  }

  return buildHendonMobTopThreeSignature(previousValue) !== buildHendonMobTopThreeSignature(currentValue);
}

export function buildHendonMobTopThreeSignature(value: string | null): string {
  if (!value) {
    return "";
  }

  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = line.match(/^Rank\s+([1-3]):\s+(.+?)(?:\s+-\s+.+)?$/);
      return match ? [`${match[1]}:${match[2].trim()}`] : [];
    })
    .join("|");
}

function getHendonMobSourceUrl(): string {
  const configuredUrl = process.env.HENDON_MOB_MONEY_LIST_SOURCE_URL?.trim();
  return configuredUrl || sourceUrl;
}

function extractRank(text: string): number | null {
  const match = normalizeText(text).match(/\b(\d+)(?:st|nd|rd|th)?\b/);
  if (!match) {
    return null;
  }

  const rank = Number(match[1]);
  return Number.isInteger(rank) && rank > 0 ? rank : null;
}

function extractPlayerName($: cheerio.CheerioAPI, row: cheerio.Cheerio<AnyNode>): string | null {
  const linkedNames = row
    .find("a")
    .map((_, element) => normalizeText($(element).text()))
    .get()
    .filter((value) => value.length > 0 && !looksLikeCountry(value) && !looksLikeMoney(value));
  const linkedName = linkedNames.find((value) => /[A-Za-zÀ-ž]/.test(value));
  if (linkedName) {
    return linkedName;
  }

  const cellTexts = row
    .find("td")
    .map((_, element) => normalizeText($(element).text()))
    .get()
    .filter((value) => value.length > 0);
  return (
    cellTexts.find(
      (value) =>
        /[A-Za-zÀ-ž]/.test(value) &&
        !extractRank(value) &&
        !looksLikeCountry(value) &&
        !looksLikeMoney(value) &&
        !/^(rank|country|prize|winnings|score)$/i.test(value)
    ) ?? null
  );
}

function extractCountry($: cheerio.CheerioAPI, row: cheerio.Cheerio<AnyNode>): string | null {
  const imageCountry =
    row
      .find("img")
      .map((_, element) => normalizeText($(element).attr("alt") ?? $(element).attr("title") ?? ""))
      .get()[0] ?? null;
  if (imageCountry) {
    return imageCountry;
  }

  const countryCandidate = row
    .find("td")
    .map((_, element) => normalizeText(row.find(element).text()))
    .get()
    .find((value) => looksLikeCountry(value));
  return countryCandidate ?? null;
}

function extractWinnings(text: string): string | null {
  const match = normalizeText(text).match(/(?:US)?\$\s*[\d,]+(?:\.\d+)?/i);
  if (!match) {
    return null;
  }

  return match[0].replace(/\s+/g, "");
}

function formatPlayer(row: HendonMobMoneyListRow): string {
  return `${row.player}${row.country ? ` (${row.country})` : ""}`;
}

function looksLikeCountry(value: string): boolean {
  return knownCountries.has(value);
}

function looksLikeMoney(value: string): boolean {
  return /\$\s*[\d,]+/.test(value);
}

function isCloudflareChallenge(html: string): boolean {
  const normalized = html.toLowerCase();
  return (
    normalized.includes("just a moment") ||
    normalized.includes("cloudflare") ||
    normalized.includes("cf-chl") ||
    normalized.includes("performing security verification")
  );
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
