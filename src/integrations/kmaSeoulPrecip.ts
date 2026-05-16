import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";

const sourceUrl = "https://data.kma.go.kr/climate/RankState/selectRankStatisticsDivisionList.do";
const ajaxUrl = "https://data.kma.go.kr/climate/RankState/selectRankStatisticsDivisionAjax.do";
const defaultYear = 2026;
const defaultMonth = 5;

type KmaSettings = {
  year: number;
  month: number;
};

type KmaPrecipitationRow = {
  stnId?: number;
  stnNm?: string;
  tma?: string;
  sumRn?: string;
};

type KmaResponse = {
  code?: string;
  data?: KmaPrecipitationRow[];
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

  const row = response.data?.find((candidate) => candidate.stnId === 108 || candidate.stnNm === "ì„œìš¸");
  if (!row?.sumRn) {
    throw new Error("Could not find Seoul monthly precipitation in the KMA response");
  }

  const value = Number(row.sumRn);
  if (!Number.isFinite(value) || value < 0 || value >= 3000) {
    throw new Error(`Invalid KMA Seoul precipitation value: ${row.sumRn}`);
  }

  const period = row.tma ?? `${settings.year}-${padMonth(settings.month)}`;
  return `${value.toFixed(1)} mm (${period})`;
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
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const settings = getKmaSeoulPrecipSettings(integration);
    const response = await fetchWithTimeout(ajaxUrl, {
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
    const value = extractKmaSeoulPrecipitationValue(json, settings);
    return {
      value,
      rawValue: value,
      unit: "monthly precipitation",
      observedAt: new Date()
    };
  }
};

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
    txtStnNm: "ì„œìš¸",
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

function padMonth(month: number): string {
  return String(month).padStart(2, "0");
}

