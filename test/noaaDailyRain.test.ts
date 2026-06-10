import { describe, expect, it } from "vitest";
import {
  extractNoaaDailyRainValue,
  getNoaaDailyRainSettings,
  isValidNoaaDailyRainDate
} from "../src/integrations/noaaDailyRain.js";
import type { Integration } from "../src/integrations/types.js";

const integration: Integration = {
  id: 1,
  guildId: "guild",
  channelId: "channel",
  adapterId: "noaa-san-francisco-rain",
  displayName: "NOAA San Francisco Rain",
  sourceUrl: "https://www.weather.gov/wrh/Climate?wfo=mtr",
  polymarketUrl: null,
  alertRoleId: null,
  roleMessageId: null,
  roleChannelId: null,
  roleEmoji: null,
  settingsJson: JSON.stringify({ year: 2026, month: 6, day: 9 }),
  pollIntervalMinutes: 5,
  status: "active",
  lastValue: null,
  lastCheckedAt: null,
  lastChangedAt: null,
  snapshotValue: null,
  snapshotCheckedAt: null,
  snapshotDate: null,
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-09T00:00:00.000Z"
};

describe("NOAA daily rain adapters", () => {
  it("extracts available daily precipitation", () => {
    const value = extractNoaaDailyRainValue(
      { data: [["2026-06-09", "0.12"]] },
      { year: 2026, month: 6, day: 9 },
      "San Francisco City, CA"
    );

    expect(value).toContain("Metric: NOAA daily precipitation");
    expect(value).toContain("Location: San Francisco City, CA");
    expect(value).toContain("Date: 2026-06-09");
    expect(value).toContain("Value: 0.12 inches");
    expect(value).toContain("Status: NOAA value available");
  });

  it("keeps trace precipitation as T", () => {
    const value = extractNoaaDailyRainValue(
      { data: [["2026-06-09", "T"]] },
      { year: 2026, month: 6, day: 9 },
      "Boston Area"
    );

    expect(value).toContain("Value: T inches");
  });

  it("keeps zero precipitation as an available finalized value", () => {
    const value = extractNoaaDailyRainValue(
      { data: [["2026-06-09", "0.00"]] },
      { year: 2026, month: 6, day: 9 },
      "Dallas Area"
    );

    expect(value).toContain("Value: 0.00 inches");
    expect(value).toContain("Status: NOAA value available");
  });

  it("stores pending status instead of throwing before NOAA finalizes", () => {
    const value = extractNoaaDailyRainValue(
      { data: [["2026-06-09", "M"]] },
      { year: 2026, month: 6, day: 9 },
      "Denver Area"
    );

    expect(value).toContain("Value: pending");
    expect(value).toContain("Status: not finalized on NOAA yet");
  });

  it("reads the configured market date", () => {
    expect(getNoaaDailyRainSettings(integration)).toEqual({ year: 2026, month: 6, day: 9 });
  });

  it("validates calendar dates", () => {
    expect(isValidNoaaDailyRainDate(2026, 6, 9)).toBe(true);
    expect(isValidNoaaDailyRainDate(2026, 2, 29)).toBe(false);
    expect(isValidNoaaDailyRainDate(2024, 2, 29)).toBe(true);
  });
});
