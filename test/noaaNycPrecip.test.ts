import { describe, expect, it } from "vitest";
import {
  extractNoaaNycPrecipitationValue,
  getNoaaNycPrecipSettings,
  isValidNoaaPeriod
} from "../src/integrations/noaaNycPrecip.js";
import type { Integration } from "../src/integrations/types.js";

const noaaIntegration: Integration = {
  id: 1,
  guildId: "guild",
  channelId: "channel",
  adapterId: "noaa-nyc-precip",
  displayName: "NOAA NYC Precipitation",
  sourceUrl: "https://www.weather.gov/wrh/climate?wfo=okx",
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

describe("NOAA NYC precipitation adapter", () => {
  it("extracts Sum precipitation from the NOAA monthly response", () => {
    const value = extractNoaaNycPrecipitationValue({ data: [["2026-05", "0.02"]] }, { year: 2026, month: 5 });

    expect(value).toBe("0.02 inches (2026-05)");
  });

  it("keeps trace precipitation as T", () => {
    const value = extractNoaaNycPrecipitationValue({ data: [["2026-05", "T"]] }, { year: 2026, month: 5 });

    expect(value).toBe("T inches (2026-05)");
  });

  it("reads stored year and month settings", () => {
    expect(getNoaaNycPrecipSettings(noaaIntegration)).toEqual({ year: 2026, month: 6 });
  });

  it("validates supported periods", () => {
    expect(isValidNoaaPeriod(2026, 5)).toBe(true);
    expect(isValidNoaaPeriod(2026, 13)).toBe(false);
  });
});
