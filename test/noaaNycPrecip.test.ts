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
  it("extracts monthly precipitation from NOAA daily rows", () => {
    const value = extractNoaaNycPrecipitationValue(
      {
        data: [
          ["2026-05-01", "T"],
          ["2026-05-02", "0.02"],
          ["2026-05-03", "0.00"]
        ]
      },
      { year: 2026, month: 5 }
    );

    expect(value).toContain("Metric: NOAA monthly precipitation");
    expect(value).toContain("Location: NY-Central Park Area");
    expect(value).toContain("Period: 2026-05");
    expect(value).toContain("Reported days: 3/31");
    expect(value).toContain("Total precipitation: 0.02 inches");
    expect(value).toContain("Latest reported day: 2026-05-03");
    expect(value).toContain("Latest day value: 0.00 inches");
  });

  it("keeps trace precipitation as a latest-day update", () => {
    const value = extractNoaaNycPrecipitationValue(
      {
        data: [
          ["2026-05-01", "0.00"],
          ["2026-05-02", "T"]
        ]
      },
      { year: 2026, month: 5 }
    );

    expect(value).toContain("Total precipitation: 0.00 inches");
    expect(value).toContain("Latest reported day: 2026-05-02");
    expect(value).toContain("Latest day value: T inches");
  });

  it("reads stored year and month settings", () => {
    expect(getNoaaNycPrecipSettings(noaaIntegration)).toEqual({ year: 2026, month: 6 });
  });

  it("validates supported periods", () => {
    expect(isValidNoaaPeriod(2026, 5)).toBe(true);
    expect(isValidNoaaPeriod(2026, 13)).toBe(false);
  });
});
