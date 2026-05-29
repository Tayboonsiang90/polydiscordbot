import { describe, expect, it } from "vitest";
import {
  extractHeathrowClimateRows,
  extractLondonPrecipitationValue,
  getLondonPrecipSettings,
  isValidLondonPrecipPeriod,
  londonPrecipShouldAlertOnChange
} from "../src/integrations/londonPrecip.js";
import type { Integration } from "../src/integrations/types.js";

const sampleText = `
Heathrow (London Airport)
   yyyy  mm   tmax    tmin      af    rain     sun
   2026   4   17.8     6.8       0     4.8   223.1#  Provisional
   2026   5   19.4    10.1       0    42.6   180.0#  Provisional
`;

const londonIntegration: Integration = {
  id: 1,
  guildId: "guild",
  channelId: "channel",
  adapterId: "met-office-london-precip",
  displayName: "Met Office London Precipitation",
  sourceUrl: "https://www.metoffice.gov.uk/pub/data/weather/uk/climate/stationdata/heathrowdata.txt",
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

describe("Met Office London precipitation adapter", () => {
  it("extracts Heathrow monthly rain from Met Office station data", () => {
    expect(extractHeathrowClimateRows(sampleText)).toEqual([
      { year: 2026, month: 4, rainText: "4.8", provisional: true },
      { year: 2026, month: 5, rainText: "42.6", provisional: true }
    ]);

    expect(extractLondonPrecipitationValue(sampleText, { year: 2026, month: 5 })).toBe(
      ["Metric: Met Office Heathrow precipitation", "Period: 2026-05", "Value: 42.6 mm", "Status: Provisional"].join("\n")
    );
  });

  it("returns a stable not-published value before the monthly row appears", () => {
    expect(extractLondonPrecipitationValue(sampleText, { year: 2026, month: 6 })).toContain("Value: not published yet");
    expect(extractLondonPrecipitationValue(sampleText, { year: 2026, month: 6 })).toContain("Latest available: 2026-05 = 42.6 mm");
  });

  it("alerts only when the displayed value changes", () => {
    expect(
      londonPrecipShouldAlertOnChange(
        "Metric: Met Office Heathrow precipitation\nValue: 42.6 mm\nStatus: Provisional",
        "Metric: Met Office Heathrow precipitation\nValue: 42.6 mm\nStatus: Final"
      )
    ).toBe(false);
    expect(londonPrecipShouldAlertOnChange("Value: not published yet", "Value: 42.6 mm")).toBe(true);
  });

  it("reads stored year and month settings", () => {
    expect(getLondonPrecipSettings(londonIntegration)).toEqual({ year: 2026, month: 6 });
  });

  it("validates supported periods", () => {
    expect(isValidLondonPrecipPeriod(2026, 5)).toBe(true);
    expect(isValidLondonPrecipPeriod(1947, 12)).toBe(false);
    expect(isValidLondonPrecipPeriod(2026, 13)).toBe(false);
  });
});
