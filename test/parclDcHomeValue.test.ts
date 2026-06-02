import { describe, expect, it } from "vitest";
import {
  buildParclDcHomeValueApiUrl,
  extractParclDcHomeValue,
  extractParclPriceFeedRows,
  getParclDcHomeValuePollIntervalMinutes,
  parclDcHomeValueShouldAlertOnChange
} from "../src/integrations/parclDcHomeValue.js";
import type { Integration } from "../src/integrations/types.js";

describe("Parcl DC Metro home value adapter", () => {
  it("extracts Parcl price-feed rows", () => {
    expect(
      extractParclPriceFeedRows({
        items: [
          { date: "2026-06-02", price_feed: 311.25 },
          { date: "bad", price_feed: 1 },
          { date: "2026-06-01", price_feed: "310.52" }
        ]
      })
    ).toEqual([
      { date: "2026-06-01", pricePerSqft: 310.52 },
      { date: "2026-06-02", pricePerSqft: 311.25 }
    ]);
  });

  it("formats target-date settlement when June 30 data is published", () => {
    const value = extractParclDcHomeValue(
      [
        { date: "2026-06-29", pricePerSqft: 310 },
        { date: "2026-06-30", pricePerSqft: 312.34 }
      ],
      new Date("2026-07-01T12:00:00.000Z")
    );

    expect(value).toContain("Target date status: published");
    expect(value).toContain("Price index: $312.34 per sqft");
    expect(value).toContain("Settlement home value: $562,212");
    expect(value).toContain("Fallback status: not needed");
  });

  it("formats waiting and fallback states before target data is published", () => {
    const waiting = extractParclDcHomeValue([{ date: "2026-06-29", pricePerSqft: 310 }], new Date("2026-07-01T12:00:00.000Z"));
    const fallback = extractParclDcHomeValue([{ date: "2026-06-29", pricePerSqft: 310 }], new Date("2026-07-11T04:00:00.000Z"));

    expect(waiting).toContain("Target date status: not published yet");
    expect(waiting).toContain("Fallback status: waiting until 2026-07-10 23:59 ET");
    expect(fallback).toContain("Fallback status: active; use latest available data if 2026-06-30 remains unavailable");
  });

  it("polls daily before June 30, per minute during release watch, then hourly after fallback deadline", () => {
    expect(getParclDcHomeValuePollIntervalMinutes(buildIntegration(), new Date("2026-06-29T16:00:00.000Z"))).toBe(1_440);
    expect(getParclDcHomeValuePollIntervalMinutes(buildIntegration(), new Date("2026-06-30T16:00:00.000Z"))).toBe(1);
    expect(getParclDcHomeValuePollIntervalMinutes(buildIntegration(), new Date("2026-07-11T04:00:00.000Z"))).toBe(60);
    expect(
      getParclDcHomeValuePollIntervalMinutes(
        buildIntegration("Target date status: published\nSettlement home value: $562,212"),
        new Date("2026-07-01T16:00:00.000Z")
      )
    ).toBe(1_440);
  });

  it("alerts only when target data publishes or fallback becomes active", () => {
    const waiting = "Target date status: not published yet\nFallback status: waiting until 2026-07-10 23:59 ET";
    const published = "Target date status: published\nSettlement home value: $562,212";
    const fallback = "Target date status: not published yet\nFallback status: active; use latest available data if 2026-06-30 remains unavailable";

    expect(parclDcHomeValueShouldAlertOnChange(waiting, published)).toBe(true);
    expect(parclDcHomeValueShouldAlertOnChange(waiting, fallback)).toBe(true);
    expect(parclDcHomeValueShouldAlertOnChange(waiting, waiting.replace("23:59", "23:59"))).toBe(false);
  });

  it("uses the Parcl page proxy with the DC Metro Parcl ID", () => {
    expect(buildParclDcHomeValueApiUrl()).toBe(
      "https://app.parcllabs.com/api/price-feed?parclId=2900475&startDate=2026-05-01&endDate=2026-06-30&limit=1000"
    );
  });
});

function buildIntegration(lastValue: string | null = null): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "parcl-dc-home-value",
    displayName: "Parcl DC Metro Home Value",
    sourceUrl: "https://app.parcllabs.com/prediction-market-resolutions/45",
    polymarketUrl: "https://polymarket.com/event/what-will-the-median-home-value-in-the-dc-metro-area-be-on-june-30-20260602001432202",
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
