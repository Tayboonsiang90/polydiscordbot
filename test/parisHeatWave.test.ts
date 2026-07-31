import { describe, expect, it } from "vitest";
import {
  buildParisHeatReport,
  buildWundergroundHistoryApiUrl,
  extractParisHeatDays,
  formatParisHeatWaveValue,
  parisHeatWaveShouldAlertOnChange,
  splitWundergroundDateRange
} from "../src/integrations/parisHeatWave.js";

function observation(dateTimeUtc: string, temp: number, obsId = "LFPB") {
  return {
    obs_id: obsId,
    valid_time_gmt: Math.floor(Date.parse(dateTimeUtc) / 1000),
    temp
  };
}

describe("Paris Heat Wave adapter", () => {
  it("extracts daily station-local high temperatures from Wunderground observations", () => {
    expect(
      extractParisHeatDays([
        observation("2026-06-30T10:00:00.000Z", 31),
        observation("2026-06-30T14:00:00.000Z", 36),
        observation("2026-07-01T12:00:00.000Z", 34),
        observation("2026-07-01T13:00:00.000Z", 35, "LFPG")
      ])
    ).toEqual([
      { date: "2026-06-30", highCelsius: 36, observationCount: 2 },
      { date: "2026-07-01", highCelsius: 34, observationCount: 1 }
    ]);
  });

  it("detects the three-day 35C heat-wave trigger", () => {
    const report = buildParisHeatReport(
      {
        metadata: { status_code: 200 },
        observations: [
          observation("2026-07-02T12:00:00.000Z", 35),
          observation("2026-07-03T12:00:00.000Z", 36),
          observation("2026-07-04T12:00:00.000Z", 35),
          observation("2026-07-05T12:00:00.000Z", 28)
        ]
      },
      "2026-07-05"
    );

    expect(report.triggerReached).toBe(true);
    expect(report.longestStreak.map((day) => day.date)).toEqual(["2026-07-02", "2026-07-03", "2026-07-04"]);
    expect(formatParisHeatWaveValue(report)).toContain("Status: YES trigger reached");
  });

  it("alerts only when qualifying dates or trigger status changes", () => {
    const noQualifying = formatParisHeatWaveValue(
      buildParisHeatReport({ observations: [observation("2026-07-01T12:00:00.000Z", 34)] }, "2026-07-01")
    );
    const stillNoQualifying = formatParisHeatWaveValue(
      buildParisHeatReport({ observations: [observation("2026-07-01T12:00:00.000Z", 34), observation("2026-07-02T12:00:00.000Z", 33)] }, "2026-07-02")
    );
    const oneQualifying = formatParisHeatWaveValue(
      buildParisHeatReport({ observations: [observation("2026-07-01T12:00:00.000Z", 35)] }, "2026-07-01")
    );

    expect(parisHeatWaveShouldAlertOnChange(null, oneQualifying)).toBe(false);
    expect(parisHeatWaveShouldAlertOnChange(noQualifying, stillNoQualifying)).toBe(false);
    expect(parisHeatWaveShouldAlertOnChange(noQualifying, oneQualifying)).toBe(true);
    expect(parisHeatWaveShouldAlertOnChange(oneQualifying, noQualifying)).toBe(true);
  });

  it("builds the Weather.com historical API URL for Wunderground data", () => {
    expect(buildWundergroundHistoryApiUrl("2026-06-30", "2026-07-31")).toContain(
      "https://api.weather.com/v1/location/LFPB:9:FR/observations/historical.json"
    );
    expect(buildWundergroundHistoryApiUrl("2026-06-30", "2026-07-31")).toContain("units=m");
    expect(buildWundergroundHistoryApiUrl("2026-06-30", "2026-07-31")).toContain("startDate=20260630");
    expect(buildWundergroundHistoryApiUrl("2026-06-30", "2026-07-31")).toContain("endDate=20260731");
  });

  it("splits history requests at the Weather.com 31-day inclusive limit", () => {
    expect(splitWundergroundDateRange("2026-06-30", "2026-07-31")).toEqual([
      { startDate: "2026-06-30", endDate: "2026-07-30" },
      { startDate: "2026-07-31", endDate: "2026-07-31" }
    ]);
    expect(splitWundergroundDateRange("2026-07-01", "2026-07-31")).toEqual([
      { startDate: "2026-07-01", endDate: "2026-07-31" }
    ]);
  });
});
