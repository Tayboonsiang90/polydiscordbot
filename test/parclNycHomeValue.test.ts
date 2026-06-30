import { describe, expect, it } from "vitest";
import {
  buildParclNycHomeValueApiUrl,
  extractParclNycHomeValue,
  extractParclNycPriceFeedRows,
  getParclNycHomeValuePollIntervalMinutes,
  parclNycHomeValueShouldAlertOnChange
} from "../src/integrations/parclNycHomeValue.js";
import type { Integration } from "../src/integrations/types.js";

describe("Parcl NYC home value adapter", () => {
  it("extracts Parcl price-feed rows", () => {
    expect(
      extractParclNycPriceFeedRows({
        series: {
          "5372594": {
            data: [
              { date: "2026-06-02", value: 603.71 },
              { date: "bad", value: 1 },
              { date: "2026-06-01", value: "603.70" }
            ]
          }
        }
      })
    ).toEqual([
      { date: "2026-06-01", pricePerSqft: 603.7 },
      { date: "2026-06-02", pricePerSqft: 603.71 }
    ]);
  });

  it("formats target-date settlement when June 30 data is published", () => {
    const value = extractParclNycHomeValue(
      [
        { date: "2026-06-29", pricePerSqft: 603.71 },
        { date: "2026-06-30", pricePerSqft: 606.25 }
      ],
      new Date("2026-07-01T12:00:00.000Z")
    );

    expect(value).toContain("Market: New York City, New York");
    expect(value).toContain("Parcl ID: 5372594");
    expect(value).toContain("Target date status: published");
    expect(value).toContain("Price index: $606.25 per sqft");
    expect(value).toContain("Median home size: 1,000 sqft");
    expect(value).toContain("Settlement home value: $606,250");
    expect(value).toContain("Fallback status: not needed");
  });

  it("formats waiting and fallback states before target data is published", () => {
    const waiting = extractParclNycHomeValue([{ date: "2026-06-29", pricePerSqft: 603.71 }], new Date("2026-07-01T12:00:00.000Z"));
    const fallback = extractParclNycHomeValue([{ date: "2026-06-29", pricePerSqft: 603.71 }], new Date("2026-07-11T04:00:00.000Z"));

    expect(waiting).toContain("Target date status: not published yet");
    expect(waiting).toContain("Fallback status: waiting until 2026-07-10 23:59 ET");
    expect(fallback).toContain("Fallback status: active; use latest available data if 2026-06-30 remains unavailable");
  });

  it("polls daily before June 30, per minute during release watch, then hourly after fallback deadline", () => {
    expect(getParclNycHomeValuePollIntervalMinutes(buildIntegration(), new Date("2026-06-29T16:00:00.000Z"))).toBe(1_440);
    expect(getParclNycHomeValuePollIntervalMinutes(buildIntegration(), new Date("2026-06-30T16:00:00.000Z"))).toBe(1);
    expect(getParclNycHomeValuePollIntervalMinutes(buildIntegration(), new Date("2026-07-11T04:00:00.000Z"))).toBe(60);
    expect(
      getParclNycHomeValuePollIntervalMinutes(
        buildIntegration("Target date status: published\nSettlement home value: $606,250"),
        new Date("2026-07-01T16:00:00.000Z")
      )
    ).toBe(1_440);
  });

  it("alerts only when target data publishes or fallback becomes active", () => {
    const waiting = "Target date status: not published yet\nFallback status: waiting until 2026-07-10 23:59 ET";
    const published = "Target date status: published\nSettlement home value: $606,250";
    const fallback = "Target date status: not published yet\nFallback status: active; use latest available data if 2026-06-30 remains unavailable";

    expect(parclNycHomeValueShouldAlertOnChange(waiting, published)).toBe(true);
    expect(parclNycHomeValueShouldAlertOnChange(waiting, fallback)).toBe(true);
    expect(parclNycHomeValueShouldAlertOnChange(waiting, waiting.replace("23:59", "23:59"))).toBe(false);
  });

  it("uses the current public Parcl price-feed history endpoint", () => {
    expect(buildParclNycHomeValueApiUrl()).toBe("https://api-app-service.parcllabs.com/v1/price-feeds/history");
  });
});

function buildIntegration(lastValue: string | null = null): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "parcl-nyc-home-value",
    displayName: "Parcl NYC Home Value",
    sourceUrl: "https://app.parcllabs.com/prediction-market-resolutions/42",
    polymarketUrl: "https://polymarket.com/event/what-will-the-median-home-value-in-new-york-city-be-on-june-30-20260602003325294",
    alertRoleId: null,
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: null,
    settingsJson: null,
    pollIntervalMinutes: 5,
    status: "active",
    lastValue,
    lastCheckedAt: null,
    lastChangedAt: null,
    snapshotValue: null,
    snapshotCheckedAt: null,
    snapshotDate: null,
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z"
  };
}
