import { describe, expect, it } from "vitest";
import {
  buildNoaaSeattlePrecipRequestBody,
  extractNoaaSeattlePrecipitationValue,
  getNoaaSeattlePrecipSettings,
  isValidNoaaSeattlePeriod,
  noaaSeattlePrecipAdapter,
  shouldAlertOnSeattlePrecipChange
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
  it("extracts monthly precipitation from NOAA daily rows", () => {
    const value = extractNoaaSeattlePrecipitationValue(
      {
        data: [
          ["2026-05-01", "1.20"],
          ["2026-05-02", "0.03"],
          ["2026-05-03", "0.00"]
        ]
      },
      { year: 2026, month: 5 }
    );

    expect(value).toContain("Metric: NOAA monthly precipitation");
    expect(value).toContain("Location: Seattle City Area");
    expect(value).toContain("Period: 2026-05");
    expect(value).toContain("Reported days: 3/31");
    expect(value).toContain("Total precipitation: 1.23 inches");
    expect(value).toContain("Latest reported day: 2026-05-03");
    expect(value).toContain("Latest day value: 0.00 inches");
  });

  it("keeps trace precipitation as a latest-day update", () => {
    const value = extractNoaaSeattlePrecipitationValue(
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

  it("keeps hourly polling usable before the first monthly row is published", () => {
    const value = extractNoaaSeattlePrecipitationValue({ data: [] }, { year: 2026, month: 8 });
    expect(value).toContain("Status: not published yet");
    expect(value).toContain("Total precipitation: not published yet");
  });

  it("reads stored year and month settings", () => {
    expect(getNoaaSeattlePrecipSettings(noaaIntegration)).toEqual({ year: 2026, month: 6 });
  });

  it("validates supported periods", () => {
    expect(isValidNoaaSeattlePeriod(2026, 5)).toBe(true);
    expect(isValidNoaaSeattlePeriod(2026, 13)).toBe(false);
  });

  it("polls every minute for KSEA hourly precipitation", () => {
    expect(noaaSeattlePrecipAdapter.getPollIntervalMinutes?.(noaaIntegration)).toBe(1);
    expect(noaaSeattlePrecipAdapter.getPollIntervalReason?.(noaaIntegration)).toContain("trace-only reports are ignored");
  });

  it("requests NOAA's Seattle City Area thread rather than the WFO Seattle station", () => {
    const request = JSON.parse(buildNoaaSeattlePrecipRequestBody({ year: 2026, month: 7 }).get("params") ?? "{}") as {
      sid?: string;
    };

    expect(request.sid).toBe("SEAthr 9");
  });

  it("stores a newly published zero day without sending an alert", () => {
    const previous = [
      "Reported days: 29/31",
      "Total precipitation: 0.42 inches",
      "Latest reported day: 2026-07-29",
      "Latest day value: 0.00 inches"
    ].join("\n");
    const current = [
      "Reported days: 30/31",
      "Total precipitation: 0.42 inches",
      "Latest reported day: 2026-07-30",
      "Latest day value: 0.00 inches"
    ].join("\n");

    expect(shouldAlertOnSeattlePrecipChange(previous, current)).toBe(false);
  });

  it("stores trace precipitation silently but still alerts for total revisions", () => {
    const previous = [
      "Total precipitation: 0.42 inches",
      "Latest reported day: 2026-07-29",
      "Latest day value: 0.00 inches"
    ].join("\n");
    const trace = [
      "Total precipitation: 0.42 inches",
      "Latest reported day: 2026-07-30",
      "Latest day value: T inches"
    ].join("\n");
    const revision = [
      "Total precipitation: 0.43 inches",
      "Latest reported day: 2026-07-30",
      "Latest day value: 0.01 inches"
    ].join("\n");

    expect(shouldAlertOnSeattlePrecipChange(previous, trace)).toBe(false);
    expect(shouldAlertOnSeattlePrecipChange(previous, revision)).toBe(true);
  });
});
