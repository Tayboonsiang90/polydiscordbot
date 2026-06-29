import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMrBeastViewValue,
  extractMrBeastTargetsFromGamma,
  extractMrBeastTotalViews,
  normalizeMrBeastViewSearchEvent,
  parseMrBeastMarketDeadline,
  parseMrBeastStoredViews,
  mrBeastViewsAdapter,
  refreshMrBeastViewsPolymarketQueue
} from "../src/integrations/mrBeastViews.js";
import type { Integration } from "../src/integrations/types.js";

describe("MrBeast YouTube views adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("extracts total views from the YouTube about page metadata", () => {
    const html = [
      '"viewCountText":{"simpleText":"641,313,287 views"}',
      '"subscriberCountText":"494M subscribers","viewCountText":"123,020,785,579 views","joinedDateText":{"content":"Joined Feb 19, 2012"}'
    ].join(",");

    expect(extractMrBeastTotalViews(html)).toBe(123_020_785_579);
    expect(extractMrBeastTotalViews('"viewCountText":"123,020,785,579 views"')).toBe(123_020_785_579);
    expect(extractMrBeastTotalViews('"viewCountText":{"simpleText":"123\u00a0020\u00a0785\u00a0579 views"}')).toBe(123_020_785_579);
  });

  it("rejects video-level view counts as channel totals", () => {
    expect(() => extractMrBeastTotalViews('"viewCountText":{"simpleText":"641,313,287 views"}')).toThrow(
      "Could not find MrBeast YouTube channel total views"
    );
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

    expect(
      parseMrBeastMarketDeadline(
        "https://polymarket.com/event/will-mrbeast-hit-billion-views-by-july-31-20260623145505885",
        new Date("2026-06-29T00:00:00.000Z")
      )?.toISOString()
    ).toBe("2026-08-01T03:59:00.000Z");
  });

  it("recognizes active MrBeast billion-view search results", () => {
    expect(
      normalizeMrBeastViewSearchEvent(
        {
          slug: "will-mrbeast-hit-billion-views-by-july-31-20260623145505885",
          title: "Will MrBeast hit ___ Billion views by July 31?",
          active: true,
          closed: false,
          startDate: "2026-06-23T20:36:31.255Z",
          endDate: "2026-07-31T23:59:00Z"
        },
        new Date("2026-06-29T00:00:00.000Z")
      )
    ).toEqual({
      slug: "will-mrbeast-hit-billion-views-by-july-31-20260623145505885",
      url: "https://polymarket.com/event/will-mrbeast-hit-billion-views-by-july-31-20260623145505885",
      title: "Will MrBeast hit ___ Billion views by July 31?",
      startDate: "2026-06-23T20:36:31.255Z",
      endDate: "2026-08-01T03:59:00.000Z"
    });
  });

  it("parses previous stored view totals from bot values", () => {
    expect(parseMrBeastStoredViews("Metric: MrBeast YouTube channel total views\nTotal views: 123,020,785,579")).toBe(
      123_020_785_579
    );
    expect(parseMrBeastStoredViews("Metric: MrBeast YouTube channel total views\nTotal views: 123.021B")).toBe(
      123_021_000_000
    );
  });

  it("formats compact rate and target data", () => {
    const value = buildMrBeastViewValue(
      {
        currentViews: 123_500_000_000,
        previousViews: 123_000_000_000,
        previousChangedAt: new Date("2026-05-18T00:00:00.000Z"),
        dailyRate: 500_000_000,
        deadline: new Date("2026-06-01T03:59:00.000Z"),
        targets: [
          { label: "123B", views: 123_000_000_000, resolved: true },
          { label: "124B", views: 124_000_000_000, resolved: false }
        ]
      },
      new Date("2026-05-19T00:00:00.000Z")
    );

    expect(value).toContain("Total views: 123.5B");
    expect(value).toContain("Change: +500M since last stored total");
    expect(value).toContain("Rate: +500M/day since last counter change");
    expect(value).toContain("Next target: 124B - 500M away");
    expect(value).toContain("Needed by deadline: 38M/day");
    expect(value).toContain("Targets: 1 hit, 1 open (124B)");
  });

  it("alerts only when the actual view counter changes", () => {
    const previous = [
      "Metric: MrBeast YouTube channel total views",
      "Total views: 123.021B",
      "Needed by deadline: 22.5M/day"
    ].join("\n");
    const currentProjectionOnly = [
      "Metric: MrBeast YouTube channel total views",
      "Total views: 123.021B",
      "Needed by deadline: 22.6M/day"
    ].join("\n");
    const currentViewsChanged = [
      "Metric: MrBeast YouTube channel total views",
      "Total views: 123.022B",
      "Needed by deadline: 22.6M/day"
    ].join("\n");

    expect(mrBeastViewsAdapter.shouldAlertOnChange?.(previous, currentProjectionOnly)).toBe(false);
    expect(mrBeastViewsAdapter.shouldAlertOnChange?.(previous, currentViewsChanged)).toBe(true);
  });

  it("suppresses one-time alert spam when recovering from a bad video-count parse", () => {
    const previousBadVideoCount = [
      "Metric: MrBeast YouTube channel total views",
      "Total views: 641.3M",
      "Needed by deadline: 4.044B/day"
    ].join("\n");
    const correctedChannelCount = [
      "Metric: MrBeast YouTube channel total views",
      "Total views: 126.211B",
      "Needed by deadline: 25.5M/day"
    ].join("\n");

    expect(mrBeastViewsAdapter.shouldAlertOnChange?.(previousBadVideoCount, correctedChannelCount)).toBe(false);
  });

  it("polls the YouTube counter every minute", () => {
    expect(mrBeastViewsAdapter.getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(mrBeastViewsAdapter.getPollIntervalReason?.({} as never)).toContain("every minute");
  });

  it("auto-discovers the active July 31 billion-view market", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "will-mrbeast-hit-billion-views-by-july-31-20260623145505885",
              title: "Will MrBeast hit ___ Billion views by July 31?",
              active: true,
              closed: false,
              startDate: "2026-06-23T20:36:31.255Z",
              endDate: "2026-07-31T23:59:00Z"
            }
          ]
        })
      })
    );

    const queue = await refreshMrBeastViewsPolymarketQueue(
      {
        settingsJson: null,
        polymarketUrl: "https://polymarket.com/event/will-mrbeast-hit-billion-views-by-june-30"
      } as Integration,
      new Date("2026-06-29T00:00:00.000Z")
    );

    expect(queue.activeUrl).toBe(
      "https://polymarket.com/event/will-mrbeast-hit-billion-views-by-july-31-20260623145505885"
    );
    expect(queue.settingsJson).toContain("will-mrbeast-hit-billion-views-by-july-31-20260623145505885");
  });
});
