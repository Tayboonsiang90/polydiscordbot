import { describe, expect, it } from "vitest";
import {
  extractKmaAsosDailyPrecipitationRows,
  extractKmaSeoulHourlyPrecipitation,
  extractKmaSeoulPrecipitationValue,
  getKmaSeoulPrecipSettings,
  isKmaSeoulMonthlyPrecipitationPending,
  isValidKmaPeriod,
  kmaSeoulPrecipAdapter,
  summarizeKmaAsosDailyPrecipitationRows
} from "../src/integrations/kmaSeoulPrecip.js";
import type { Integration } from "../src/integrations/types.js";

const kmaIntegration: Integration = {
  id: 1,
  guildId: "guild",
  channelId: "channel",
  adapterId: "kma-seoul-precip",
  displayName: "KMA Seoul Precipitation",
  sourceUrl: "https://data.kma.go.kr/climate/RankState/selectRankStatisticsDivisionList.do",
  polymarketUrl: null,
  alertRoleId: null,
  roleMessageId: null,
  roleChannelId: null,
  roleEmoji: null,
  settingsJson: JSON.stringify({ year: 2026, month: 6 }),
  pollIntervalMinutes: 5,
  status: "active",
  lastValue: null,
  lastCheckedAt: null,
  lastChangedAt: null,
  snapshotValue: null,
  snapshotCheckedAt: null,
  snapshotDate: null,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z"
};

describe("KMA Seoul precipitation adapter", () => {
  it("extracts Seoul monthly precipitation from the KMA JSON response", () => {
    const value = extractKmaSeoulPrecipitationValue(
      {
        code: "00",
        data: [{ stnId: 108, stnNm: "\uC11C\uC6B8", tma: "2026-05", sumRn: "18.0" }]
      },
      { year: 2026, month: 5 }
    );

    expect(value).toBe(
      [
        "Metric: KMA Seoul precipitation",
        "Period: 2026-05",
        "Current total: 18.0 mm",
        "Data status: official KMA monthly total"
      ].join("\n")
    );
  });

  it("detects a present Seoul monthly row with no monthly precipitation total", () => {
    expect(
      isKmaSeoulMonthlyPrecipitationPending({
        code: "00",
        data: [{ stnId: 108, stnNm: "\uC11C\uC6B8", tma: "2026-06" }]
      })
    ).toBe(true);
    expect(isKmaSeoulMonthlyPrecipitationPending({ code: "00", data: [] })).toBe(true);
  });

  it("extracts KMA ASOS daily precipitation rows from the result page script", () => {
    const rows = extractKmaAsosDailyPrecipitationRows(`
      <script>
        var egovMapList1 = '[{"RNUM":1,"SUM_RN":1.4,"STN_NM":"\\uC11C\\uC6B8","TM":"2026-06-01","STN_ID":108}]';
      </script>
    `);

    expect(rows).toEqual([{ RNUM: 1, SUM_RN: 1.4, STN_NM: "\uC11C\uC6B8", TM: "2026-06-01", STN_ID: 108 }]);
  });

  it("sums KMA ASOS daily Seoul rainfall rows", () => {
    const summary = summarizeKmaAsosDailyPrecipitationRows([
      { STN_ID: 108, STN_NM: "\uC11C\uC6B8", TM: "2026-06-01", SUM_RN: 1.4 },
      { STN_ID: 108, STN_NM: "\uC11C\uC6B8", TM: "2026-06-02", SUM_RN: "2.6" },
      { STN_ID: 159, STN_NM: "Busan", TM: "2026-06-02", SUM_RN: 99 }
    ]);

    expect(summary).toEqual({
      total: 4,
      latestDate: "2026-06-02",
      rowCount: 2
    });
  });

  it("treats an empty KMA ASOS daily row list as zero rainfall", () => {
    expect(summarizeKmaAsosDailyPrecipitationRows([])).toEqual({
      total: 0,
      latestDate: null,
      rowCount: 0
    });
  });

  it("keeps positive hourly rainfall from exact KMA Seoul station 108", () => {
    expect(
      extractKmaSeoulHourlyPrecipitation(
        {
          items: [
            { awsStnId: 108, awsStnName: "서울", tm: "202608010800", awsPcpHr1: "2.4" },
            { awsStnId: 108, awsStnName: "서울", tm: "202608010700", awsPcpHr1: "0" },
            { awsStnId: 159, awsStnName: "부산", tm: "202608010800", awsPcpHr1: "9.9" }
          ]
        },
        new Date("2026-08-01T00:05:00Z")
      )
    ).toEqual([{ localDate: "2026-08-01", localTime: "08:00", precipitation: 2.4 }]);
  });

  it("polls every minute for Seoul station 108 hourly rainfall", () => {
    expect(kmaSeoulPrecipAdapter.getPollIntervalMinutes?.(kmaIntegration)).toBe(1);
    expect(kmaSeoulPrecipAdapter.getPollIntervalReason?.(kmaIntegration)).toContain("zero-hour reports are ignored");
  });

  it("reads stored year and month settings", () => {
    expect(getKmaSeoulPrecipSettings(kmaIntegration)).toEqual({ year: 2026, month: 6 });
  });

  it("validates supported periods", () => {
    expect(isValidKmaPeriod(2026, 5)).toBe(true);
    expect(isValidKmaPeriod(2026, 13)).toBe(false);
  });
});
