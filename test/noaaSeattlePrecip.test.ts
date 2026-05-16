import { describe, expect, it } from "vitest";
import {
  extractNoaaSeattlePrecipitationValue,
  getNoaaSeattlePrecipSettings,
  isValidNoaaSeattlePeriod
} from "../src/integrations/noaaSeattlePrecip.js";
import type { Integration } from "../src/integrations/types.js";

const noaaIntegration: Integration = {
  id: 1,
  guildId: "guild",
  channelId: "channel",
  adapterId: "noaa-seattle-precip",
  displayName: "NOAA Seattle Precipitation",
  sourceUrl: "https://www.weather.gov/wrh/climate?wfo=sew",
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

describe("NOAA Seattle precipitation adapter", () => {
  it("extracts Sum precipitation from the NOAA monthly response", () => {
    const value = extractNoaaSeattlePrecipitationValue({ data: [["2026-05", "1.23"]] }, { year: 2026, month: 5 });

    expect(value).toBe("1.23 inches (2026-05)");
  });

  it("keeps trace precipitation as T", () => {
    const value = extractNoaaSeattlePrecipitationValue({ data: [["2026-05", "T"]] }, { year: 2026, month: 5 });

    expect(value).toBe("T inches (2026-05)");
  });

  it("reads stored year and month settings", () => {
    expect(getNoaaSeattlePrecipSettings(noaaIntegration)).toEqual({ year: 2026, month: 6 });
  });

  it("validates supported periods", () => {
    expect(isValidNoaaSeattlePeriod(2026, 5)).toBe(true);
    expect(isValidNoaaSeattlePeriod(2026, 13)).toBe(false);
  });
});
