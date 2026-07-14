import { load } from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.metadao.fi/projects/credible/fundraise";
const defaultPolymarketUrl = "https://polymarket.com/event/total-commitments-for-the-credible-public-sale-on-metadao-20260708134325640";
const pageTimeoutMs = 20_000;
const usdcDecimals = 6n;
const usdcScale = 10n ** usdcDecimals;

export type MetaDaoFundraiseSnapshot = {
  minimumRaiseAmount: bigint;
  totalCommittedAmount: bigint;
  contributorCount: number;
  state: string;
  dataSource: string;
  allowanceAmount: bigint | null;
};

export const metadaoCredibleFundraiseAdapter: WebsiteAdapter = {
  id: "metadao-credible-fundraise",
  commandName: "metadao",
  displayName: "MetaDAO Credible Fundraise",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "metadao-credible",
  alertRoleName: "MetaDAO Credible Alerts",
  alertRoleEmoji: "\uD83C\uDFDB\uFE0F",
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Fixed hourly check for MetaDAO Credible committed amount and contributor count",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const observedAt = new Date();
    const snapshot = await fetchCredibleFundraiseSnapshot();
    const value = formatMetaDaoCredibleFundraiseValue(snapshot);

    return {
      value,
      rawValue: value,
      unit: "fundraise committed amount",
      observedAt
    };
  }
};

export async function fetchCredibleFundraiseSnapshot(): Promise<MetaDaoFundraiseSnapshot> {
  return parseMetaDaoFundraisePageSnapshot(await fetchMetaDaoFundraisePageText());
}

export function parseMetaDaoFundraisePageSnapshot(pageText: string): MetaDaoFundraiseSnapshot {
  const text = normalizeWhitespace(pageText);
  assertUsableMetaDaoPageText(text);

  const totalCommittedAmount = extractDollarAmount(text, /\$([\d,]+(?:\.\d+)?)\s+committed/i, "committed total");
  const contributorCount = extractInteger(text, /(?:Loading contributors\.\.\.\s*)?([\d,]+)\s+Contributors\b/i, "contributors");
  const progressAndMinimum =
    text.match(/([\d,.]+)%\s*of\s*\$([\d,]+(?:\.\d+)?)\s+minimum/i) ??
    text.match(/([\d,.]+)%of\s*\$([\d,]+(?:\.\d+)?)\s+minimum/i);
  const minimumRaiseAmount = progressAndMinimum ? parseDollarAmountToUsdc(progressAndMinimum[2]) : 2_000_000n * usdcScale;
  const state = text.match(/\bcommitted\s+([A-Za-z][A-Za-z ]{1,40}?)\s+[\d,.]+%\s*of/i)?.[1]?.trim() ?? "visible on official page";
  const allowanceAmount = parseOptionalDollarAmount(text, /\$([\d,]+(?:\.\d+)?)\s+allowance/i);

  return {
    minimumRaiseAmount,
    totalCommittedAmount,
    contributorCount,
    state,
    dataSource: "Official MetaDAO fundraise page",
    allowanceAmount
  };
}

export function formatMetaDaoCredibleFundraiseValue(snapshot: MetaDaoFundraiseSnapshot): string {
  const progress =
    snapshot.minimumRaiseAmount > 0n
      ? (Number(snapshot.totalCommittedAmount) / Number(snapshot.minimumRaiseAmount)) * 100
      : null;

  return [
    "Metric: MetaDAO Credible public sale",
    `Total committed: ${formatUsdc(snapshot.totalCommittedAmount)}`,
    `Contributors: ${formatInteger(snapshot.contributorCount)}`,
    `Status: ${snapshot.state}`,
    `Minimum raise: ${formatUsdc(snapshot.minimumRaiseAmount)}`,
    `Progress to minimum: ${progress === null ? "unknown" : `${formatDecimal(progress, 2)}%`}`,
    ...(snapshot.allowanceAmount ? [`Allowance: ${formatUsdc(snapshot.allowanceAmount)}`] : []),
    `Data source: ${snapshot.dataSource}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

async function fetchMetaDaoFundraisePageText(): Promise<string> {
  const response = await fetchWithTimeout(
    sourceUrl,
    {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    },
    pageTimeoutMs
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`MetaDAO fundraise page returned HTTP ${response.status}; refusing to emit a zero committed value.`);
  }

  return htmlToVisibleText(body);
}

function htmlToVisibleText(body: string): string {
  const $ = load(body);
  $("script,style,noscript").remove();
  return normalizeWhitespace($.root().text());
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function assertUsableMetaDaoPageText(text: string): void {
  if (/Vercel Security Checkpoint|verifying your browser|Enable JavaScript to continue/i.test(text)) {
    throw new Error("MetaDAO fundraise page returned a Vercel security checkpoint; refusing to emit a zero committed value.");
  }
}

function extractDollarAmount(text: string, pattern: RegExp, label: string): bigint {
  const match = text.match(pattern);
  if (!match) {
    throw new Error(`Could not parse MetaDAO ${label} from official fundraise page.`);
  }
  return parseDollarAmountToUsdc(match[1]);
}

function parseOptionalDollarAmount(text: string, pattern: RegExp): bigint | null {
  const match = text.match(pattern);
  return match ? parseDollarAmountToUsdc(match[1]) : null;
}

function extractInteger(text: string, pattern: RegExp, label: string): number {
  const match = text.match(pattern);
  if (!match) {
    throw new Error(`Could not parse MetaDAO ${label} from official fundraise page.`);
  }

  const parsed = Number(match[1].replace(/,/g, ""));
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Could not parse MetaDAO ${label} from official fundraise page.`);
  }
  return parsed;
}

function parseDollarAmountToUsdc(value: string): bigint {
  const normalized = value.replace(/,/g, "");
  const match = normalized.match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) {
    throw new Error(`Invalid dollar amount: ${value}`);
  }

  return BigInt(match[1]) * usdcScale + BigInt((match[2] ?? "").padEnd(6, "0"));
}

function formatUsdc(amount: bigint): string {
  const cents = (amount + 5_000n) / 10_000n;
  const dollars = cents / 100n;
  const centRemainder = cents % 100n;
  return `$${groupDigits(dollars)}.${centRemainder.toString().padStart(2, "0")}`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatDecimal(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(value);
}

function groupDigits(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
