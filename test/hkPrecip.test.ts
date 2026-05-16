import { describe, expect, it } from "vitest";
import {
  extractHkPrecipitationValue,
  getHkPrecipSettings,
  isValidHkPrecipPeriod
} from "../src/integrations/hkPrecip.js";
import type { Integration } from "../src/integrations/types.js";

const hkPrecipIntegration: Integration = {
  id: 1,
  guildId: "guild",
  channelId: "channel",
  adapterId: "hk-precip",
  displayName: "HKO Hong Kong Precipitation",
  sourceUrl: "https://www.weather.gov.hk/en/cis/dailyExtract.htm",
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

describe("HKO Hong Kong precipitation adapter", () => {
  it("extracts Mean/Total rainfall from the HKO Daily Extract response", () => {
    const value = extractHkPrecipitationValue(
      {
        stn: {
          data: [
            {
              month: 5,
              dayData: [
                ["01", "1014.2", "26.9", "24.0", "22.1", "19.4", "76", "82", "Trace"],
                ["Mean/Total", "1013.2", "26.8", "23.9", "22.1", "20.7", "83", "88", " 74.7"]
              ]
            }
          ]
        }
      },
      { year: 2026, month: 5 }
    );

    expect(value).toBe("74.7 mm (2026-05)");
  });

  it("keeps trace rainfall as Trace", () => {
    const value = extractHkPrecipitationValue(
      {
        stn: {
          data: [{ month: 5, dayData: [["Mean/Total", "", "", "", "", "", "", "", "Trace"]] }]
        }
      },
      { year: 2026, month: 5 }
    );

    expect(value).toBe("Trace mm (2026-05)");
  });

  it("reads stored year and month settings", () => {
    expect(getHkPrecipSettings(hkPrecipIntegration)).toEqual({ year: 2026, month: 6 });
  });

  it("validates supported periods", () => {
    expect(isValidHkPrecipPeriod(2026, 5)).toBe(true);
    expect(isValidHkPrecipPeriod(2026, 13)).toBe(false);
  });
});
