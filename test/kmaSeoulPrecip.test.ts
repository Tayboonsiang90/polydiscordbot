import { describe, expect, it } from "vitest";
import {
  extractKmaSeoulPrecipitationValue,
  getKmaSeoulPrecipSettings,
  isValidKmaPeriod
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
        data: [{ stnId: 108, stnNm: "서울", tma: "2026-05", sumRn: "18.0" }]
      },
      { year: 2026, month: 5 }
    );

    expect(value).toBe("18.0 mm (2026-05)");
  });

  it("reads stored year and month settings", () => {
    expect(getKmaSeoulPrecipSettings(kmaIntegration)).toEqual({ year: 2026, month: 6 });
  });

  it("validates supported periods", () => {
    expect(isValidKmaPeriod(2026, 5)).toBe(true);
    expect(isValidKmaPeriod(2026, 13)).toBe(false);
  });
});
