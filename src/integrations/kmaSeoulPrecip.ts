import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";
import { refreshMonthlyPolymarketQueue, type MonthlyPolymarketDiscoveryConfig } from "./monthlyPolymarketDiscovery.js";

const sourceUrl = "https://data.kma.go.kr/climate/RankState/selectRankStatisticsDivisionList.do";
const ajaxUrl = "https://data.kma.go.kr/climate/RankState/selectRankStatisticsDivisionAjax.do";
const dailyAsosUrl = "https://data.kma.go.kr/data/grnd/selectAsosRltmList.do?pgmNo=36";
const defaultYear = 2026;
const defaultMonth = 5;
const kmaFetchTimeoutMs = 30_000;
const kmaDailyMaxPages = 5;
const kmaDailyRowsPerPage = 31;
const monthlyDiscoveryConfig: MonthlyPolymarketDiscoveryConfig = {
  searchQuery: "precipitation in seoul",
  slugPrefix: "precipitation-in-seoul-in-",
  titlePrefix: "Precipitation in Seoul in",
  lastDiscoveryAtKey: "lastKmaSeoulPrecipDiscoveryAt",
  requiredTagSlugs: ["precipitation"],
  fallbackToCurrentMonthWhenExpired: true
};

type KmaSettings = {
  year: number;
  month: number;
};

type KmaPrecipitationRow = {
  stnId?: number | string;
  stnNm?: string;
  tma?: string;
  sumRn?: string;
};

type KmaResponse = {
  code?: string;
  data?: KmaPrecipitationRow[];
  dataList?: KmaPrecipitationRow[];
};

type KmaDailyPrecipitationRow = {
  STN_ID?: number | string;
  STN_NM?: string;
  TM?: string;
  SUM_RN?: number | string;
};

type KmaDailyPrecipitationSummary = {
  total: number;
  latestDate: string | null;
  rowCount: number;
};

export function getKmaSeoulPrecipSettings(integration?: Integration): KmaSettings {
  if (!integration?.settingsJson) {
    return { year: defaultYear, month: defaultMonth };
  }

  try {
    const settings = JSON.parse(integration.settingsJson) as Partial<KmaSettings>;
    const year = Number(settings.year);
    const month = Number(settings.month);
    if (isValidKmaPeriod(year, month)) {
      return { year, month };
    }
  } catch {
    return { year: defaultYear, month: defaultMonth };
  }

  return { year: defaultYear, month: defaultMonth };
}

export function extractKmaSeoulPrecipitationValue(response: KmaResponse, settings: KmaSettings): string {
  if (response.code !== "00") {
    throw new Error(`KMA returned code ${response.code ?? "unknown"}`);
  }

  const row = findKmaSeoulMonthlyRow(response);
  if (!row?.sumRn) {
    throw new Error("Could not find Seoul monthly precipitation in the KMA response");
  }

  const value = Number(row.sumRn);
  if (!Number.isFinite(value) || value < 0 || value >= 3000) {
    throw new Error(`Invalid KMA Seoul precipitation value: ${row.sumRn}`);
  }

  const period = row.tma ?? `${settings.year}-${padMonth(settings.month)}`;
  return formatKmaSeoulPrecipitationValue({
    period,
    currentTotal: `${value.toFixed(1)} mm`,
    dataStatus: "official KMA monthly total"
  });
}

export function isKmaSeoulMonthlyPrecipitationPending(response: KmaResponse): boolean {
  if (response.code !== "00") {
    return false;
  }

  const row = findKmaSeoulMonthlyRow(response);
  return Boolean(row && !row.sumRn);
}

export function extractKmaAsosDailyPrecipitationRows(html: string): KmaDailyPrecipitationRow[] {
  const match = html.match(/var\s+egovMapList1\s*=\s*'([\s\S]*?)';/);
  if (!match) {
    throw new Error("Could not find KMA ASOS daily precipitation rows in the response");
  }

  const rawRows = match[1].replace(/\\'/g, "'");
  const rows = JSON.parse(rawRows) as unknown;
  if (!Array.isArray(rows)) {
    throw new Error("Invalid KMA ASOS daily precipitation row payload");
  }

  return rows as KmaDailyPrecipitationRow[];
}

export function summarizeKmaAsosDailyPrecipitationRows(rows: KmaDailyPrecipitationRow[]): KmaDailyPrecipitationSummary {
  const dailyRows = new Map<string, KmaDailyPrecipitationRow>();
  for (const row of rows) {
    if (!isKmaSeoulDailyRow(row) || !row.TM) {
      continue;
    }

    dailyRows.set(row.TM, row);
  }

  let total = 0;
  let latestDate: string | null = null;
  for (const row of [...dailyRows.values()].sort((left, right) => String(left.TM).localeCompare(String(right.TM)))) {
    const value = Number(row.SUM_RN ?? 0);
    if (!Number.isFinite(value) || value < 0 || value >= 3000) {
      throw new Error(`Invalid KMA ASOS daily precipitation value: ${row.SUM_RN}`);
    }

    total += value;
    latestDate = row.TM ?? latestDate;
  }

  return {
    total,
    latestDate,
    rowCount: dailyRows.size
  };
}

export const kmaSeoulPrecipAdapter: WebsiteAdapter = {
  id: "kma-seoul-precip",
  commandName: "koreaprecip",
  displayName: "KMA Seoul Precipitation",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/precipitation-in-seoul-in-may",
  defaultChannelName: "koreaprecip",
  legacyChannelNames: ["kma-seoul-precip", "precipitationkorea"],
  alertRoleName: "KMA Seoul Precip Alerts",
  alertRoleEmoji: "\u2614",
  defaultSettings: { year: defaultYear, month: defaultMonth },
  supportsPeriod: true,
  async refreshSettings(integration: Integration): Promise<string> {
    return (await refreshMonthlyPolymarketQueue(integration, monthlyDiscoveryConfig)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const settings = getKmaSeoulPrecipSettings(integration);
    const response = await fetchKma(ajaxUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      },
      body: buildKmaRequestBody(settings)
    });

    if (!response.ok) {
      throw new Error(`KMA returned HTTP ${response.status}`);
    }

    const json = (await response.json()) as KmaResponse;
    const value = isKmaSeoulMonthlyPrecipitationPending(json)
      ? await fetchKmaSeoulDailyPrecipitationValue(settings)
      : extractKmaSeoulPrecipitationValue(json, settings);
    return {
      value,
      rawValue: value,
      unit: "monthly precipitation",
      observedAt: new Date()
    };
  }
};

async function fetchKmaSeoulDailyPrecipitationValue(settings: KmaSettings): Promise<string> {
  const summary = await fetchKmaSeoulDailyPrecipitationSummary(settings);
  const period = `${settings.year}-${padMonth(settings.month)}`;
  return formatKmaSeoulPrecipitationValue({
    period,
    currentTotal: `${summary.total.toFixed(1)} mm`,
    dataStatus: "ASOS daily fallback",
    reportedDays: String(summary.rowCount),
    latestReportedDay: summary.latestDate ?? "none"
  });
}

function formatKmaSeoulPrecipitationValue(input: {
  period: string;
  currentTotal: string;
  dataStatus: string;
  reportedDays?: string;
  latestReportedDay?: string;
}): string {
  return [
    "Metric: KMA Seoul precipitation",
    `Period: ${input.period}`,
    `Current total: ${input.currentTotal}`,
    `Data status: ${input.dataStatus}`,
    ...(input.reportedDays ? [`Reported days: ${input.reportedDays}`] : []),
    ...(input.latestReportedDay ? [`Latest reported day: ${input.latestReportedDay}`] : [])
  ].join("\n");
}

async function fetchKmaSeoulDailyPrecipitationSummary(settings: KmaSettings): Promise<KmaDailyPrecipitationSummary> {
  const dateRange = buildKmaDailyDateRange(settings);
  if (!dateRange) {
    return { total: 0, latestDate: null, rowCount: 0 };
  }

  const rows: KmaDailyPrecipitationRow[] = [];
  for (let pageIndex = 1; pageIndex <= kmaDailyMaxPages; pageIndex += 1) {
    const response = await fetchKma(dailyAsosUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      },
      body: buildKmaDailyRequestBody(settings, dateRange, pageIndex)
    });

    if (!response.ok) {
      throw new Error(`KMA ASOS daily data returned HTTP ${response.status}`);
    }

    const pageRows = extractKmaAsosDailyPrecipitationRows(await response.text());
    rows.push(...pageRows);
    if (pageRows.length === 0 || pageRows.length < 10) {
      break;
    }
  }

  return summarizeKmaAsosDailyPrecipitationRows(rows);
}

function findKmaSeoulMonthlyRow(response: KmaResponse): KmaPrecipitationRow | undefined {
  const rows = response.data ?? response.dataList ?? [];
  return rows.find((candidate) => Number(candidate.stnId) === 108 || candidate.stnNm === "\uC11C\uC6B8");
}

function isKmaSeoulDailyRow(row: KmaDailyPrecipitationRow): boolean {
  return Number(row.STN_ID) === 108 || row.STN_NM === "\uC11C\uC6B8";
}

function fetchKma(url: string, init: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init, kmaFetchTimeoutMs);
}

export function isValidKmaPeriod(year: number, month: number): boolean {
  return Number.isInteger(year) && Number.isInteger(month) && year >= 1904 && year <= 2100 && month >= 1 && month <= 12;
}

function buildKmaRequestBody(settings: KmaSettings): URLSearchParams {
  const month = padMonth(settings.month);
  return new URLSearchParams({
    isSample: "N",
    fileType: "",
    pgmNo: "",
    menuNo: "440",
    pageIndex: "",
    minTa: "25.0",
    stnGroupSns: "",
    selectType: "1",
    mddlClssCd: "SFC01",
    lastDayOfMonth: String(new Date(settings.year, settings.month, 0).getDate()),
    startDt: "",
    endDt: "",
    schType: "1",
    txtStnNm: "\uC11C\uC6B8",
    stnId: "108",
    areaId: "",
    ureaType: "2",
    dataFormCd: "2",
    startYear: String(settings.year),
    endYear: String(settings.year),
    precInputVal: "1",
    symbol: "1",
    inputInt: "",
    condit: "",
    symbol2: "1",
    inputInt2: "",
    monthCheck: "Y",
    startMonth: month,
    endMonth: month,
    startDay: "01",
    endDay: String(new Date(settings.year, settings.month, 0).getDate()),
    sesn: "1"
  });
}

function buildKmaDailyRequestBody(
  settings: KmaSettings,
  dateRange: { startDt: string; endDt: string },
  pageIndex: number
): URLSearchParams {
  return new URLSearchParams({
    fileType: "",
    cmmnCdList: "F00501,F00502,F00503,F00512,F00513",
    upperCmmnCode: "F005",
    lrgClssCd: "SFC",
    mddlClssCd: "SFC01",
    menuNo: "32",
    pageIndex: String(pageIndex),
    stnIds: "154_108",
    serviceSe: "F00102",
    elementCds: "SFC01014006",
    elementGroupSns: "103",
    dwldSetupPd: "",
    firstLoading: "N",
    pageRowCount: String(kmaDailyRowsPerPage),
    validateGbn: "",
    dataReqstSn: "",
    dataFormCd: "F00501",
    startDt: dateRange.startDt,
    endDt: dateRange.endDt,
    startHh: "00",
    endHh: "23",
    startMt: "00",
    endMt: "59",
    txtStnNm: "\uC11C\uC6B8",
    txtElementNm: "\uC77C\uAC15\uC218\uB7C9"
  });
}

function buildKmaDailyDateRange(settings: KmaSettings, now = new Date()): { startDt: string; endDt: string } | null {
  const start = new Date(Date.UTC(settings.year, settings.month - 1, 1));
  const monthEnd = new Date(Date.UTC(settings.year, settings.month, 0));
  const yesterdayKst = addUtcDays(getKstDate(now), -1);
  const end = monthEnd.getTime() < yesterdayKst.getTime() ? monthEnd : yesterdayKst;

  if (end.getTime() < start.getTime()) {
    return null;
  }

  return {
    startDt: formatBasicDate(start),
    endDt: formatBasicDate(end)
  };
}

function getKstDate(date: Date): Date {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function formatBasicDate(date: Date): string {
  return `${date.getUTCFullYear()}${padMonth(date.getUTCMonth() + 1)}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function padMonth(month: number): string {
  return String(month).padStart(2, "0");
}

