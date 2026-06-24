import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl =
  "https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/summary-of-receipts-outlays-and-the-deficit-surplus-of-the-u-s-government";
const apiUrl = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/mts/mts_table_1";
const defaultPolymarketUrl = "https://polymarket.com/event/will-trump-reduce-the-deficit-before-2027";
const baselineDate = "2025-09-30";
const baselineMonth = "September";

export type TreasuryMtsMonth = {
  reportDate: string;
  reportMonth: string;
  fiscalYearSection: string;
  deficitSurplusAmount: number;
  receiptsAmount: number | null;
  outlaysAmount: number | null;
};

type TreasuryMtsApiRow = {
  record_date?: string;
  classification_desc?: string;
  current_month_gross_rcpt_amt?: string;
  current_month_gross_outly_amt?: string;
  current_month_dfct_sur_amt?: string;
  data_type_cd?: string;
  record_type_cd?: string;
  sequence_number_cd?: string;
};

export const treasuryMtsDeficitAdapter: WebsiteAdapter = {
  id: "treasury-mts-deficit",
  commandName: "treasurymts",
  displayName: "Treasury MTS Deficit",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "treasurymts",
  alertRoleName: "Treasury MTS Alerts",
  alertRoleEmoji: "\uD83E\uDDFE",
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Fixed hourly check for newly published Monthly Treasury Statement rows",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const [latestData, baselineData] = await Promise.all([fetchLatestMtsRows(), fetchBaselineRows()]);
    const latest = extractLatestTreasuryMtsMonth(latestData);
    const baseline = extractTreasuryMtsMonth(baselineData, baselineDate, baselineMonth);
    const value = formatTreasuryMtsValue(latest, baseline);

    return {
      value,
      rawValue: `${latest.reportDate}:${latest.deficitSurplusAmount}`,
      unit: "current month deficit/surplus",
      observedAt: new Date()
    };
  }
};

export function extractLatestTreasuryMtsMonth(data: unknown): TreasuryMtsMonth {
  const rows = extractRows(data);
  const latestReportDate = rows
    .map((row) => row.record_date)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);

  if (!latestReportDate) {
    throw new Error("Could not find the latest MTS report date");
  }

  return extractTreasuryMtsMonth({ data: rows.filter((row) => row.record_date === latestReportDate) }, latestReportDate, monthNameFromDate(latestReportDate));
}

export function extractTreasuryMtsMonth(data: unknown, reportDate: string, monthName: string): TreasuryMtsMonth {
  const rows = extractRows(data).filter((row) => row.record_date === reportDate);
  const fiscalYearBySection = buildFiscalYearSectionMap(rows);
  const candidates = rows
    .filter((row) => isMonthlyDataRow(row) && normalizeText(row.classification_desc ?? "") === monthName)
    .map((row) => ({ row, section: sectionNumber(row.sequence_number_cd) }))
    .filter((candidate) => candidate.section !== null)
    .sort((left, right) => Number(right.section) - Number(left.section));

  const selected = candidates.at(0);
  const amount = parseNumber(selected?.row.current_month_dfct_sur_amt);
  if (!selected || amount === null) {
    throw new Error(`Could not find ${monthName} MTS current month deficit/surplus for ${reportDate}`);
  }

  return {
    reportDate,
    reportMonth: `${monthName} ${reportDate.slice(0, 4)}`,
    fiscalYearSection: fiscalYearBySection.get(selected.section ?? "") ?? "unknown",
    deficitSurplusAmount: amount,
    receiptsAmount: parseNumber(selected.row.current_month_gross_rcpt_amt),
    outlaysAmount: parseNumber(selected.row.current_month_gross_outly_amt)
  };
}

export function formatTreasuryMtsValue(latest: TreasuryMtsMonth, baseline: TreasuryMtsMonth): string {
  return [
    "Metric: Monthly Treasury Statement current month deficit/surplus",
    `Latest report: ${latest.reportMonth}`,
    `Report date: ${latest.reportDate}`,
    `Fiscal year section: ${latest.fiscalYearSection}`,
    `Current Month Deficit/Surplus Amount: ${formatDeficitSurplus(latest.deficitSurplusAmount)}`,
    `Receipts: ${formatOptionalCurrency(latest.receiptsAmount)}`,
    `Outlays: ${formatOptionalCurrency(latest.outlaysAmount)}`,
    "Market comparison:",
    `September 2025 baseline: ${formatDeficitSurplus(baseline.deficitSurplusAmount)}`,
    "December 2026 must report a lower monthly deficit than September 2025.",
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

async function fetchLatestMtsRows(): Promise<unknown> {
  const url = `${apiUrl}?sort=-record_date,print_order_nbr&page[size]=60`;
  return fetchFiscalData(url);
}

async function fetchBaselineRows(): Promise<unknown> {
  const url = `${apiUrl}?filter=record_date:eq:${baselineDate}&sort=print_order_nbr&page[size]=60`;
  return fetchFiscalData(url);
}

async function fetchFiscalData(url: string): Promise<unknown> {
  const response = await fetchWithTimeout(url, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`FiscalData Treasury MTS API returned HTTP ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

function extractRows(data: unknown): TreasuryMtsApiRow[] {
  if (!isRecord(data) || !Array.isArray(data.data)) {
    return [];
  }
  return data.data.filter(isRecord) as TreasuryMtsApiRow[];
}

function buildFiscalYearSectionMap(rows: TreasuryMtsApiRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const section = sectionNumber(row.sequence_number_cd);
    const label = normalizeText(row.classification_desc ?? "");
    if (section && row.data_type_cd === "S" && row.record_type_cd === "SL" && /^FY \d{4}$/.test(label)) {
      map.set(section, label);
    }
  }
  return map;
}

function isMonthlyDataRow(row: TreasuryMtsApiRow): boolean {
  return row.data_type_cd === "D" && row.record_type_cd === "MTH";
}

function sectionNumber(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  return value.split(".")[0] || null;
}

function monthNameFromDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(parsed);
}

function parseNumber(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : null;
}

function formatDeficitSurplus(value: number): string {
  const label = value < 0 ? "surplus" : "deficit";
  return `${formatCompactCurrency(Math.abs(value))} ${label} (${formatCurrency(value)})`;
}

function formatOptionalCurrency(value: number | null): string {
  return value === null ? "not available" : formatCurrency(value);
}

function formatCompactCurrency(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000_000) {
    return `$${formatDecimal(value / 1_000_000_000_000, 2)}T`;
  }
  if (absolute >= 1_000_000_000) {
    return `$${formatDecimal(value / 1_000_000_000, 2)}B`;
  }
  if (absolute >= 1_000_000) {
    return `$${formatDecimal(value / 1_000_000, 2)}M`;
  }
  return formatCurrency(value);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

function formatDecimal(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits
  }).format(value);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
