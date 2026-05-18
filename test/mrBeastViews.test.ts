import { describe, expect, it } from "vitest";
import {
  buildMrBeastViewValue,
  extractMrBeastTargetsFromGamma,
  extractMrBeastTotalViews,
  parseMrBeastMarketDeadline,
  parseMrBeastStoredViews,
  mrBeastViewsAdapter
} from "../src/integrations/mrBeastViews.js";

describe("MrBeast YouTube views adapter", () => {
  it("extracts total views from the YouTube about page metadata", () => {
    expect(extractMrBeastTotalViews('"viewCountText":"123,020,785,579 views"')).toBe(123_020_785_579);
    expect(extractMrBeastTotalViews('"viewCountText":{"simpleText":"123\u00a0020\u00a0785\u00a0579 views"}')).toBe(123_020_785_579);
  });

  it("extracts billion-view market targets from Gamma child markets", () => {
    expect(
      extractMrBeastTargetsFromGamma([
        {
          question: "Will MrBeast hit 121.5 billion views by May 31?",
          closed: true,
          outcomes: '["Yes","No"]',
          outcomePrices: '["1","0"]'
        },
        {
          question: "Will MrBeast hit 124 billion views by May 31?",
          closed: false,
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.9275","0.0725"]'
        }
      ])
    ).toEqual([
      { label: "121.5B", views: 121_500_000_000, resolved: true },
      { label: "124B", views: 124_000_000_000, resolved: false }
    ]);
  });

  it("parses the market deadline from the Polymarket URL", () => {
    expect(
      parseMrBeastMarketDeadline(
        "https://polymarket.com/event/will-mrbeast-hit-billion-views-by-june-30",
        new Date("2026-05-19T00:00:00.000Z")
      )?.toISOString()
    ).toBe("2026-07-01T03:59:00.000Z");
  });

  it("parses previous stored view totals from bot values", () => {
    expect(parseMrBeastStoredViews("Metric: MrBeast YouTube channel total views\nTotal views: 123,020,785,579")).toBe(
      123_020_785_579
    );
  });

  it("formats rate and projection data", () => {
    const value = buildMrBeastViewValue(
      {
        currentViews: 123_500_000_000,
        previousViews: 123_000_000_000,
        previousCheckedAt: new Date("2026-05-18T00:00:00.000Z"),
        dailyRate: 500_000_000,
        deadline: new Date("2026-06-01T03:59:00.000Z"),
        targets: [
          { label: "123B", views: 123_000_000_000, resolved: true },
          { label: "124B", views: 124_000_000_000, resolved: false }
        ]
      },
      new Date("2026-05-19T00:00:00.000Z")
    );

    expect(value).toContain("Total views: 123,500,000,000");
    expect(value).toContain("Change since previous check: +500,000,000");
    expect(value).toContain("Dailyized rate: +500,000,000/day");
    expect(value).toContain("Next open target: 124B, projected 2026-05-19 ET");
    expect(value).toContain("Market targets: 123B hit | 124B open");
  });

  it("alerts only when the actual view counter changes", () => {
    const previous = [
      "Metric: MrBeast YouTube channel total views",
      "Total views: 123,020,785,579",
      "Views needed by deadline: 22,523,772/day"
    ].join("\n");
    const currentProjectionOnly = [
      "Metric: MrBeast YouTube channel total views",
      "Total views: 123,020,785,579",
      "Views needed by deadline: 22,524,131/day"
    ].join("\n");
    const currentViewsChanged = [
      "Metric: MrBeast YouTube channel total views",
      "Total views: 123,020,785,580",
      "Views needed by deadline: 22,524,131/day"
    ].join("\n");

    expect(mrBeastViewsAdapter.shouldAlertOnChange?.(previous, currentProjectionOnly)).toBe(false);
    expect(mrBeastViewsAdapter.shouldAlertOnChange?.(previous, currentViewsChanged)).toBe(true);
  });
});
