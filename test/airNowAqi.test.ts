import { describe, expect, it } from "vitest";
import {
  buildAirNowDailyAqiReport,
  buildAirNowHistoricalStateUrl,
  buildAirNowStadiumReport,
  formatAirNowDailyAqiValue,
  formatAirNowStadiumValue,
  shouldAlertOnAirNowDailyChange,
  shouldAlertOnAirNowStadiumChange
} from "../src/integrations/airNowAqi.js";

describe("AirNow AQI adapters", () => {
  it("builds the public state historical endpoint URL", () => {
    expect(buildAirNowHistoricalStateUrl("New_York", "2026-07-17")).toBe(
      "https://airnowgovapi.com/v2/andata/States/New_York/2026/7/17.json"
    );
  });

  it("extracts finalized PM2.5 rows for the configured reporting area", () => {
    const report = buildAirNowDailyAqiReport(
      { cityLabel: "NYC", reportingArea: "New York City Region", stateName: "New York" },
      ["2026-07-17", "2026-07-18"],
      [
        {
          state: "New York",
          fileWrittenDateTime: "20260718T090745Z",
          reportingAreas: [
            { "New York City Region": { pm25: 155, pm10: -999, ozone: 67 } },
            { "Long Island Region": { pm25: 121, pm10: -999, ozone: 67 } }
          ]
        },
        null
      ]
    );

    expect(report.rows).toEqual([
      { date: "2026-07-17", pm25: 155, pm10: null, ozone: 67, fileWrittenDateTime: "20260718T090745Z" }
    ]);
    expect(report.missingDates).toEqual(["2026-07-18"]);
    expect(formatAirNowDailyAqiValue(report, "https://www.airnow.gov/state/?name=new-york")).toContain(
      "Below 100 observed: not yet"
    );
  });

  it("flags the first below-100 finalized PM2.5 day", () => {
    const report = buildAirNowDailyAqiReport(
      { cityLabel: "Philadelphia", reportingArea: "Philadelphia", stateName: "Pennsylvania" },
      ["2026-07-17", "2026-07-18"],
      [
        { reportingAreas: [{ Philadelphia: { pm25: 244, pm10: 103, ozone: 100 } }] },
        { reportingAreas: [{ Philadelphia: { pm25: 82, pm10: 30, ozone: 42 } }] }
      ]
    );

    const value = formatAirNowDailyAqiValue(report, "https://www.airnow.gov/state/?name=pennsylvania");
    expect(value).toContain("Below 100 observed: YES - 2026-07-18 = 82");
    expect(value).toContain("Minimum PM2.5 AQI: 82 on 2026-07-18");
  });

  it("alerts daily AQI only when finalized row values change", () => {
    const previousValue = "Alert key: 2026-07-17=155";
    expect(shouldAlertOnAirNowDailyChange(null, "Alert key: 2026-07-17=155")).toBe(false);
    expect(shouldAlertOnAirNowDailyChange(previousValue, "Alert key: 2026-07-17=155")).toBe(false);
    expect(shouldAlertOnAirNowDailyChange(previousValue, "Alert key: 2026-07-17=155|2026-07-18=82")).toBe(true);
  });

  it("uses Union City High School PM2.5 for the stadium high-water mark", () => {
    const records = [
      {
        validDate: "07/19/26",
        timezone: "EDT",
        time: "15:00",
        dataType: "O",
        reportingArea: "Northeast Urban",
        siteName: "Other Monitor",
        siteID: "other",
        parameter: "PM2.5",
        aqi: 170,
        category: "Unhealthy"
      },
      {
        validDate: "07/19/26",
        timezone: "EDT",
        time: "15:00",
        dataType: "O",
        reportingArea: "Northeast Urban",
        siteName: "Union City High School",
        siteID: "840340170008",
        parameter: "PM2.5",
        aqi: 154,
        category: "Unhealthy"
      }
    ];

    const report = buildAirNowStadiumReport(records, null, new Date("2026-07-19T19:00:00.000Z"));
    const value = formatAirNowStadiumValue(report);
    expect(value).toContain("Current PM2.5 AQI: 154");
    expect(value).toContain("Current monitor: Union City High School (840340170008)");
    expect(value).toContain("Highest tracked AQI: 154");
    expect(value).toContain("Hit thresholds: 60, 90, 120, 150");
  });

  it("alerts stadium AQI when current source readings update before or during the game", () => {
    expect(shouldAlertOnAirNowStadiumChange(null, "Highest tracked AQI: 154")).toBe(false);
    expect(
      shouldAlertOnAirNowStadiumChange(
        "Highest tracked AQI: not started\nAlert key: highest=none|current=61@07/19/26 08:00 EDT@840340170008|thresholds=none",
        "Highest tracked AQI: not started\nAlert key: highest=none|current=61@07/19/26 08:00 EDT@840340170008|thresholds=none"
      )
    ).toBe(false);
    expect(
      shouldAlertOnAirNowStadiumChange(
        "Highest tracked AQI: not started\nAlert key: highest=none|current=61@07/19/26 08:00 EDT@840340170008|thresholds=none",
        "Highest tracked AQI: not started\nAlert key: highest=none|current=64@07/19/26 09:00 EDT@840340170008|thresholds=none"
      )
    ).toBe(true);
    expect(
      shouldAlertOnAirNowStadiumChange(
        "Highest tracked AQI: 154\nAlert key: highest=154|current=154@07/19/26 15:00 EDT@840340170008|thresholds=60,90,120,150",
        "Highest tracked AQI: 160\nAlert key: highest=160|current=160@07/19/26 16:00 EDT@840340170008|thresholds=60,90,120,150"
      )
    ).toBe(true);
    expect(
      shouldAlertOnAirNowStadiumChange(
        "Highest tracked AQI: 160\nAlert key: highest=160|current=160@07/19/26 16:00 EDT@840340170008|thresholds=60,90,120,150",
        "Highest tracked AQI: 160\nAlert key: highest=160|current=ignored-after-window|thresholds=60,90,120,150"
      )
    ).toBe(false);
  });
});
