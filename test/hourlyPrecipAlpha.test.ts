import { describe, expect, it } from "vitest";
import {
  appendHourlyPrecipitationAlpha,
  extractEnvironmentAgencyHourlyPrecipitation,
  hasNewOrRevisedHourlyPrecipitation,
  hasNewOrRevisedPositiveHourlyPrecipitation
} from "../src/integrations/hourlyPrecipAlpha.js";

const config = {
  station: "Test station",
  timeZone: "Europe/London",
  timeZoneLabel: "UK time",
  unit: "mm" as const,
  decimals: 1,
  source: "https://example.com/hourly"
};

describe("shared hourly precipitation alpha", () => {
  it("aggregates four Environment Agency quarter-hours into one completed local hour", () => {
    const observations = extractEnvironmentAgencyHourlyPrecipitation(
      {
        items: [
          { dateTime: "2026-08-01T09:15:00Z", value: 0.2 },
          { dateTime: "2026-08-01T09:30:00Z", value: 0 },
          { dateTime: "2026-08-01T09:45:00Z", value: 0.3 },
          { dateTime: "2026-08-01T10:00:00Z", value: 0.1 },
          { dateTime: "2026-08-01T10:15:00Z", value: 0 }
        ]
      },
      "Europe/London",
      new Date("2026-08-01T10:05:00Z")
    );

    expect(observations).toEqual([{ localDate: "2026-08-01", localTime: "11:00", precipitation: 0.6 }]);
  });

  it("keeps captured positive hours for the local day and ignores zero-only changes", () => {
    const now = new Date("2026-08-01T10:05:00Z");
    const previous = appendHourlyPrecipitationAlpha(
      "Current total: 4.0 mm",
      [{ localDate: "2026-08-01", localTime: "10:00", precipitation: 0.5 }],
      config,
      null,
      now
    );
    const current = appendHourlyPrecipitationAlpha(
      "Current total: 4.0 mm",
      [{ localDate: "2026-08-01", localTime: "11:00", precipitation: 0.6 }],
      config,
      previous,
      now
    );

    expect(current).toContain("Hourly alpha total: 1.1 mm");
    expect(current).toContain("Positive hourly reports: 2");
    expect(hasNewOrRevisedHourlyPrecipitation(previous, current)).toBe(true);
    expect(hasNewOrRevisedHourlyPrecipitation(current, current)).toBe(false);
  });

  it("drops yesterday's hourly alpha without treating the rollover as a new rain event", () => {
    const previous = appendHourlyPrecipitationAlpha(
      "Current total: 4.0 mm",
      [{ localDate: "2026-07-31", localTime: "23:00", precipitation: 0.5 }],
      config,
      null,
      new Date("2026-07-31T22:05:00Z")
    );
    const current = appendHourlyPrecipitationAlpha(
      "Current total: 4.0 mm",
      [],
      config,
      previous,
      new Date("2026-08-01T00:05:00Z")
    );

    expect(current).toContain("Positive hourly reports: 0");
    expect(hasNewOrRevisedHourlyPrecipitation(previous, current)).toBe(false);
  });

  it("can suppress trace-only hourly observations", () => {
    const now = new Date("2026-08-01T10:05:00Z");
    const previous = appendHourlyPrecipitationAlpha("Current total: 4.0 mm", [], config, null, now);
    const current = appendHourlyPrecipitationAlpha(
      "Current total: 4.0 mm",
      [{ localDate: "2026-08-01", localTime: "11:00", precipitation: null }],
      config,
      previous,
      now
    );

    expect(hasNewOrRevisedHourlyPrecipitation(previous, current)).toBe(true);
    expect(hasNewOrRevisedPositiveHourlyPrecipitation(previous, current)).toBe(false);
  });

  it("can keep the first rolling snapshot in an hour to prevent repeated alerts", () => {
    const now = new Date("2026-08-01T10:45:00Z");
    const rollingConfig = { ...config, preserveFirstValuePerHour: true };
    const previous = appendHourlyPrecipitationAlpha(
      "Current total: 4.0 mm",
      [{ localDate: "2026-08-01", localTime: "11:00", precipitation: 0.5 }],
      rollingConfig,
      null,
      now
    );
    const current = appendHourlyPrecipitationAlpha(
      "Current total: 4.0 mm",
      [{ localDate: "2026-08-01", localTime: "11:00", precipitation: 1.2 }],
      rollingConfig,
      previous,
      now
    );

    expect(current).toContain("2026-08-01T11:00=0.5");
    expect(hasNewOrRevisedHourlyPrecipitation(previous, current)).toBe(false);
  });
});
