import { describe, expect, it } from "vitest";
import {
  appendNycHourlyPrecipitationAlpha,
  buildNoaaNycPrecipRequestBody,
  extractNycHourlyPrecipObservations,
  extractNycHourlyPrecipObservationsFromHtml,
  extractNoaaNycPrecipitationValue,
  getNoaaNycPrecipSettings,
  isValidNoaaPeriod,
  noaaNycPrecipAdapter,
  shouldAlertOnNycPrecipChange,
  type NycHourlyPrecipObservation
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
  const currentEtDay = new Date("2026-08-01T03:30:00.000Z");
  const firstRainObservation: NycHourlyPrecipObservation = {
    localDate: "2026-07-31",
    localTime: "18:51",
    precipitation: 0.03
  };

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
    expect(value).toContain("Location: Central Park NY");
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

  it("requests NOAA's Central Park NY thread", () => {
    const request = JSON.parse(buildNoaaNycPrecipRequestBody({ year: 2026, month: 7 }).get("params") ?? "{}") as {
      sid?: string;
    };

    expect(request.sid).toBe("NYCthr 9");
  });

  it("keeps only positive routine KNYC METAR precipitation from the current ET date", () => {
    const observations = extractNycHourlyPrecipObservations(
      [
        {
          metarType: "METAR",
          obsTime: new Date("2026-07-31T22:51:00.000Z").getTime() / 1_000,
          precip: 0.03
        },
        {
          metarType: "METAR",
          obsTime: new Date("2026-07-31T21:51:00.000Z").getTime() / 1_000,
          precip: 0
        },
        {
          metarType: "SPECI",
          obsTime: new Date("2026-07-31T22:20:00.000Z").getTime() / 1_000,
          precip: 0.02
        },
        {
          metarType: "METAR",
          obsTime: new Date("2026-07-31T03:51:00.000Z").getTime() / 1_000,
          precip: 0.01
        },
        {
          metarType: "METAR",
          obsTime: new Date("2026-08-01T04:51:00.000Z").getTime() / 1_000,
          precip: 0.04
        }
      ],
      currentEtDay
    );

    expect(observations).toEqual([firstRainObservation]);
  });

  it("uses positive and trace one-hour values from the NWS history fallback", () => {
    const html = `<table><tbody>
      ${buildHourlyHistoryRow("31", "18:51", "0.03")}
      ${buildHourlyHistoryRow("31", "17:51", "0.00")}
      ${buildHourlyHistoryRow("31", "16:51", "T")}
      ${buildHourlyHistoryRow("30", "23:51", "0.02")}
    </tbody></table>`;

    const observations = extractNycHourlyPrecipObservationsFromHtml(html, currentEtDay);

    expect(observations).toHaveLength(2);
    expect(observations[0]).toEqual({ localDate: "2026-07-31", localTime: "16:51", precipitation: null });
    expect(observations[1]).toEqual({ localDate: "2026-07-31", localTime: "18:51", precipitation: 0.03 });
  });

  it("adds readable hourly alpha totals and the latest positive hour", () => {
    const value = appendNycHourlyPrecipitationAlpha(
      "Total precipitation: 1.25 inches",
      [
        { localDate: "2026-07-31", localTime: "16:51", precipitation: null },
        firstRainObservation
      ],
      "https://example.com/hourly",
      currentEtDay
    );

    expect(value).toContain("Hourly alpha date local: 2026-07-31 (ET)");
    expect(value).toContain("Hourly alpha total: 0.03 inches (plus 1 trace hour)");
    expect(value).toContain("Positive hourly reports: 2");
    expect(value).toContain("Latest positive hour local: 2026-07-31 18:51 ET");
    expect(value).toContain("Latest positive hour precipitation: 0.03 inches");
  });

  it("alerts for a new or revised positive hour but not for zero-only rollover removal", () => {
    const officialValue = "Total precipitation: 1.25 inches\nLatest reported day: 2026-07-31";
    const previousValue = appendNycHourlyPrecipitationAlpha(
      officialValue,
      [firstRainObservation],
      "https://example.com/hourly",
      currentEtDay
    );
    const secondObservation = {
      localDate: "2026-07-31",
      localTime: "19:51",
      precipitation: 0.02
    };
    const withNewHour = appendNycHourlyPrecipitationAlpha(
      officialValue,
      [firstRainObservation, secondObservation],
      "https://example.com/hourly",
      currentEtDay
    );
    const withRevision = appendNycHourlyPrecipitationAlpha(
      officialValue,
      [{ ...firstRainObservation, precipitation: 0.04 }],
      "https://example.com/hourly",
      currentEtDay
    );
    const afterRollover = appendNycHourlyPrecipitationAlpha(
      officialValue,
      [],
      "https://example.com/hourly",
      new Date("2026-08-01T05:00:00.000Z")
    );

    expect(shouldAlertOnNycPrecipChange(previousValue, previousValue)).toBe(false);
    expect(shouldAlertOnNycPrecipChange(previousValue, withNewHour)).toBe(true);
    expect(shouldAlertOnNycPrecipChange(previousValue, withRevision)).toBe(true);
    expect(shouldAlertOnNycPrecipChange(previousValue, afterRollover)).toBe(false);
    expect(shouldAlertOnNycPrecipChange(previousValue, previousValue.replace("1.25", "1.30"))).toBe(true);
  });

  it("polls every minute for the hourly alpha source", () => {
    expect(noaaNycPrecipAdapter.getPollIntervalMinutes?.(noaaIntegration)).toBe(1);
    expect(noaaNycPrecipAdapter.getPollIntervalReason?.(noaaIntegration)).toContain("zero-hour reports are ignored");
  });
});

function buildHourlyHistoryRow(day: string, time: string, oneHourPrecipitation: string): string {
  const cells = [day, time, ...Array.from({ length: 13 }, () => ""), oneHourPrecipitation, "", ""];
  return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
}
