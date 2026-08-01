import { describe, expect, it } from "vitest";
import {
  buildHkPrecipitationAlphaValue,
  extractHkoObservatoryHourlyPrecipitation,
  extractHkoYesterdayRainfall,
  extractHkPrecipitationValue,
  extractHkPrecipitationOfficialValue,
  getHkPrecipSettings,
  hkPrecipAdapter,
  hkPrecipShouldAlertOnChange,
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

  it("adds yesterday report rainfall when Daily Extract has not caught up", () => {
    const official = extractHkPrecipitationOfficialValue(
      {
        stn: {
          data: [
            {
              month: 5,
              dayData: [
                ["20", "1008.1", "30.7", "28.0", "25.9", "25.0", "84", "88", "  3.2"],
                ["Mean/Total", "1011.0", "27.7", "25.3", "23.8", "22.2", "83", "84", "147.9"]
              ]
            }
          ]
        }
      },
      { year: 2026, month: 5 }
    );
    const yesterday = extractHkoYesterdayRainfall(`
      <span>Bulletin issued at 00:15 HKT 22/May/2026</span>
      <pre>Rainfall                                    66.1 mm</pre>
    `);

    expect(buildHkPrecipitationAlphaValue(official, yesterday, { year: 2026, month: 5 })).toContain(
      "Current total: 214.0 mm (2026-05)"
    );
  });

  it("parses abbreviated issued months from HKO Yesterday's Weather", () => {
    expect(
      extractHkoYesterdayRainfall(`
        <span>Bulletin issued at 00:15 HKT 16/Jun/2026</span>
        <pre>Rainfall                                   122.6 mm</pre>
      `)
    ).toEqual({
      issuedDate: "2026-06-16",
      rainfallText: "122.6",
      rainfall: 122.6,
      yesterdayDate: "2026-06-15"
    });
  });

  it("carries previous alpha rainfall until Daily Extract catches up", () => {
    const official = extractHkPrecipitationOfficialValue(
      {
        stn: {
          data: [
            {
              month: 5,
              dayData: [
                ["28", "1008.1", "30.7", "28.0", "25.9", "25.0", "84", "88", "  0.0"],
                ["Mean/Total", "1011.0", "27.7", "25.3", "23.8", "22.2", "83", "84", "215.0"]
              ]
            }
          ]
        }
      },
      { year: 2026, month: 5 }
    );
    const previousValue = [
      "Current total: 227.2 mm (2026-05)",
      "Data status: alpha daily report added",
      "Official Daily Extract total: 215.0 mm",
      "Official latest day: 28",
      "Yesterday report rainfall: 12.2 mm (2026-05-29)"
    ].join("\n");
    const yesterday = extractHkoYesterdayRainfall(`
      <span>Bulletin issued at 00:15 HKT 31/May/2026</span>
      <pre>Rainfall                                    0.0 mm</pre>
    `);

    const value = buildHkPrecipitationAlphaValue(official, yesterday, { year: 2026, month: 5 }, previousValue);

    expect(value).toContain("Current total: 227.2 mm (2026-05)");
    expect(value).toContain("Alpha pending daily reports: 2026-05-29: 12.2 mm; 2026-05-30: 0.0 mm");
  });

  it("drops carried alpha rainfall after Daily Extract includes that day", () => {
    const official = extractHkPrecipitationOfficialValue(
      {
        stn: {
          data: [
            {
              month: 5,
              dayData: [
                ["29", "1008.1", "30.7", "28.0", "25.9", "25.0", "84", "88", "  12.2"],
                ["Mean/Total", "1011.0", "27.7", "25.3", "23.8", "22.2", "83", "84", "227.2"]
              ]
            }
          ]
        }
      },
      { year: 2026, month: 5 }
    );
    const previousValue = "Alpha pending daily reports: 2026-05-29: 12.2 mm; 2026-05-30: 0.0 mm";
    const yesterday = extractHkoYesterdayRainfall(`
      <span>Bulletin issued at 00:15 HKT 31/May/2026</span>
      <pre>Rainfall                                    0.0 mm</pre>
    `);

    const value = buildHkPrecipitationAlphaValue(official, yesterday, { year: 2026, month: 5 }, previousValue);

    expect(value).toContain("Current total: 227.2 mm (2026-05)");
    expect(value).toContain("Alpha pending daily reports: 2026-05-30: 0.0 mm");
    expect(value).not.toContain("2026-05-29: 12.2 mm");
  });

  it("does not alert when only HK alpha metadata changes", () => {
    expect(
      hkPrecipShouldAlertOnChange(
        "Current total: 214.0 mm (2026-05)\nData status: alpha daily report added",
        "Current total: 214.0 mm (2026-05)\nData status: official daily extract"
      )
    ).toBe(false);
    expect(hkPrecipShouldAlertOnChange("Current total: 214.0 mm (2026-05)", "Current total: 215.0 mm (2026-05)")).toBe(
      true
    );
  });

  it("keeps only non-overlapping top-of-hour RF023 snapshots", () => {
    const payload = {
      obsTime: "2026-08-01T08:00:00+08:00",
      hourlyRainfall: [
        { automaticWeatherStation: "Hong Kong Observatory", automaticWeatherStationID: "RF023", value: "8", unit: "mm" }
      ]
    };
    expect(extractHkoObservatoryHourlyPrecipitation(payload, new Date("2026-08-01T00:05:00Z"))).toEqual([
      { localDate: "2026-08-01", localTime: "08:00", precipitation: 8 }
    ]);
    expect(
      extractHkoObservatoryHourlyPrecipitation(
        { ...payload, obsTime: "2026-08-01T08:15:00+08:00" },
        new Date("2026-08-01T00:16:00Z")
      )
    ).toEqual([]);
  });

  it("polls every minute for the exact-station hourly alpha", () => {
    expect(hkPrecipAdapter.getPollIntervalMinutes?.(hkPrecipIntegration)).toBe(1);
    expect(hkPrecipAdapter.getPollIntervalReason?.(hkPrecipIntegration)).toContain("zero reports are ignored");
  });

  it("reads stored year and month settings", () => {
    expect(getHkPrecipSettings(hkPrecipIntegration)).toEqual({ year: 2026, month: 6 });
  });

  it("validates supported periods", () => {
    expect(isValidHkPrecipPeriod(2026, 5)).toBe(true);
    expect(isValidHkPrecipPeriod(2026, 13)).toBe(false);
  });
});
