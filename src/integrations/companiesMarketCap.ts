import { fetchWithTimeout } from "../http.js";
import { resolveIntegrationPolymarketQueue, upsertPolymarketQueueUrl } from "../polymarketQueue.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://companiesmarketcap.com/";
const csvUrl = "https://companiesmarketcap.com/?download=csv";
const userAgent = "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1";

const polymarketUrls = [
  "https://polymarket.com/event/largest-company-end-of-august-20260715202138598",
  "https://polymarket.com/event/2nd-largest-company-end-of-august-20260715202554129",
  "https://polymarket.com/event/3rd-largest-company-end-of-august-20260715203029875"
];

export type CompaniesMarketCapRow = {
  rank: number;
  name: string;
  symbol: string;
  marketCap: number;
  priceUsd: number | null;
  country: string;
};

export const companiesMarketCapAdapter: WebsiteAdapter = {
  id: "companies-market-cap-top10",
  commandName: "companyrank",
  displayName: "CompaniesMarketCap Top 10",
  sourceUrl,
  defaultPolymarketUrl: polymarketUrls[0],
  defaultChannelName: "companyrank",
  alertRoleName: "Company Rank Alerts",
  alertRoleEmoji: "\uD83C\uDFE2",
  getPollIntervalMinutes: () => 5,
  getPollIntervalReason: () => "5-minute CompaniesMarketCap top-10 checks; alerts only when company rank order changes.",
  getErrorNoticeWindowMinutes: () => 30,
  shouldAlertOnChange: shouldAlertOnCompaniesMarketCapChange,
  async refreshSettings(integration: Integration): Promise<string> {
    return seedCompaniesMarketCapPolymarkets(integration).settingsJson ?? integration.settingsJson ?? "{}";
  },
  upsertPolymarketMarket(integration: Integration, url: string): { settingsJson: string | null; activeUrl: string | null } {
    return upsertPolymarketQueueUrl(integration, url);
  },
  async fetchCurrentValue(_integration?: Integration): Promise<AdapterValue> {
    const response = await fetchWithTimeout(csvUrl, {
      headers: {
        accept: "text/csv,application/octet-stream,text/plain,*/*",
        "user-agent": userAgent
      }
    });

    if (!response.ok) {
      throw new Error(`CompaniesMarketCap CSV returned HTTP ${response.status}`);
    }

    const value = formatCompaniesMarketCapValue(extractCompaniesMarketCapTopRows(await response.text(), 10));
    return {
      value,
      rawValue: value,
      unit: "company market cap rank",
      observedAt: new Date()
    };
  }
};

export function extractCompaniesMarketCapTopRows(csv: string, limit = 10): CompaniesMarketCapRow[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) {
    throw new Error("Could not find CompaniesMarketCap CSV rows");
  }

  const header = rows[0].map((value) => normalizeHeader(value));
  const indexByHeader = new Map(header.map((value, index) => [value, index]));
  const rankIndex = requireCsvColumn(indexByHeader, "rank");
  const nameIndex = requireCsvColumn(indexByHeader, "name");
  const symbolIndex = requireCsvColumn(indexByHeader, "symbol");
  const marketCapIndex = requireCsvColumn(indexByHeader, "marketcap");
  const priceIndex = indexByHeader.get("priceusd") ?? indexByHeader.get("price");
  const countryIndex = indexByHeader.get("country");

  const parsedRows = rows.slice(1).flatMap((row): CompaniesMarketCapRow[] => {
    const rank = Number(row[rankIndex]);
    const marketCap = Number(row[marketCapIndex]);
    const name = row[nameIndex]?.trim();
    const symbol = row[symbolIndex]?.trim();
    if (!Number.isInteger(rank) || !name || !symbol || !Number.isFinite(marketCap)) {
      return [];
    }

    return [
      {
        rank,
        name,
        symbol,
        marketCap,
        priceUsd: priceIndex === undefined ? null : parseNullableNumber(row[priceIndex]),
        country: countryIndex === undefined ? "unknown" : row[countryIndex]?.trim() || "unknown"
      }
    ];
  });

  if (parsedRows.length === 0) {
    throw new Error("Could not parse CompaniesMarketCap top companies");
  }

  return parsedRows.sort((left, right) => left.rank - right.rank).slice(0, limit);
}

export function formatCompaniesMarketCapValue(rows: CompaniesMarketCapRow[]): string {
  if (rows.length === 0) {
    throw new Error("Cannot format empty CompaniesMarketCap ranking");
  }

  const topThree = rows.slice(0, 3).map((row) => `#${row.rank} ${formatCompany(row)}`).join(" | ");
  return [
    "Metric: CompaniesMarketCap largest companies by market cap",
    `Top 3: ${topThree}`,
    ...rows.map((row) => `Rank ${row.rank}: ${formatCompany(row)} - ${formatMarketCap(row.marketCap)}`),
    "Tracking scope: top 10 rank order only",
    `CSV: ${csvUrl}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function shouldAlertOnCompaniesMarketCapChange(previousValue: string | null, currentValue: string): boolean {
  if (previousValue === null) {
    return false;
  }

  return buildCompaniesMarketCapRankSignature(previousValue) !== buildCompaniesMarketCapRankSignature(currentValue);
}

export function buildCompaniesMarketCapRankSignature(value: string | null): string {
  if (!value) {
    return "";
  }

  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = line.match(/^Rank\s+(\d+):\s+(.+?)\s+-\s+\$/);
      return match ? [`${match[1]}:${match[2].trim()}`] : [];
    })
    .join("|");
}

function seedCompaniesMarketCapPolymarkets(
  integration: Integration,
  now = new Date()
): { settingsJson: string | null; activeUrl: string | null } {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let workingIntegration: Integration = {
    ...integration,
    settingsJson: resolved.settingsJson,
    polymarketUrl: resolved.activeUrl ?? integration.polymarketUrl
  };

  for (const url of polymarketUrls) {
    resolved = upsertPolymarketQueueUrl(workingIntegration, url, now);
    workingIntegration = {
      ...workingIntegration,
      settingsJson: resolved.settingsJson,
      polymarketUrl: resolved.activeUrl ?? workingIntegration.polymarketUrl
    };
  }

  return resolved;
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }
  return rows;
}

function requireCsvColumn(indexByHeader: Map<string, number>, name: string): number {
  const index = indexByHeader.get(name);
  if (index === undefined) {
    throw new Error(`CompaniesMarketCap CSV missing required column: ${name}`);
  }
  return index;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseNullableNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCompany(row: CompaniesMarketCapRow): string {
  return `${row.name} (${row.symbol})`;
}

function formatMarketCap(value: number): string {
  if (value >= 1_000_000_000_000) {
    return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  return `$${Math.round(value).toLocaleString("en-US")}`;
}
