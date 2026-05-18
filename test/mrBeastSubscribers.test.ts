import { describe, expect, it } from "vitest";
import {
  buildMrBeastSubscriberValue,
  extractMrBeastSubscriberTargetsFromGamma,
  extractMrBeastSubscribers,
  parseMrBeastStoredSubscribers,
  parseMrBeastSubscriberMarketDeadline,
  mrBeastSubscribersAdapter
} from "../src/integrations/mrBeastSubscribers.js";

describe("MrBeast YouTube subscribers adapter", () => {
  it("extracts rounded subscribers from the YouTube about page metadata", () => {
    expect(extractMrBeastSubscribers('"subscriberCountText":"487M subscribers"')).toBe(487_000_000);
    expect(extractMrBeastSubscribers('"subscriberCountText":{"simpleText":"487M subscribers"}')).toBe(487_000_000);
  });

  it("extracts million-subscriber market targets from Gamma child markets", () => {
    expect(
      extractMrBeastSubscriberTargetsFromGamma([
        {
          question: "Will MrBeast hit 485 million subscribers by June 30?",
          closed: true,
          outcomes: '["Yes","No"]',
          outcomePrices: '["1","0"]'
        },
        {
          question: "Will MrBeast hit 500 million subscribers by June 30?",
          closed: false,
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.647","0.353"]'
        }
      ])
    ).toEqual([
      { label: "485M", subscribers: 485_000_000, resolved: true },
      { label: "500M", subscribers: 500_000_000, resolved: false }
    ]);
  });

  it("parses the market deadline from the Polymarket URL", () => {
    expect(
      parseMrBeastSubscriberMarketDeadline(
        "https://polymarket.com/event/will-mrbeast-hit-million-subscribers-by-june-30",
        new Date("2026-05-19T00:00:00.000Z")
      )?.toISOString()
    ).toBe("2026-07-01T03:59:00.000Z");
  });

  it("parses previous stored subscriber totals from bot values", () => {
    expect(parseMrBeastStoredSubscribers("Metric: MrBeast YouTube channel subscribers\nSubscribers: 487,000,000")).toBe(
      487_000_000
    );
  });

  it("formats rate and projection table data", () => {
    const value = buildMrBeastSubscriberValue(
      {
        currentSubscribers: 488_000_000,
        previousSubscribers: 487_000_000,
        previousCheckedAt: new Date("2026-05-18T00:00:00.000Z"),
        dailyRate: 1_000_000,
        deadline: new Date("2026-07-01T03:59:00.000Z"),
        targets: [
          { label: "485M", subscribers: 485_000_000, resolved: true },
          { label: "491M", subscribers: 491_000_000, resolved: false }
        ]
      },
      new Date("2026-05-19T00:00:00.000Z")
    );

    expect(value).toContain("Subscribers: 488,000,000");
    expect(value).toContain("Change since previous check: +1,000,000");
    expect(value).toContain("Dailyized rate: +1,000,000/day");
    expect(value).toContain("Target | Stat | Needed");
    expect(value).toContain("491M");
    expect(value).toContain("2026-05-21");
  });

  it("alerts only when the actual subscriber counter changes", () => {
    const previous = [
      "Metric: MrBeast YouTube channel subscribers",
      "Subscribers: 487,000,000",
      "Target | Stat | Needed  | Projected  | Req/day"
    ].join("\n");
    const currentProjectionOnly = [
      "Metric: MrBeast YouTube channel subscribers",
      "Subscribers: 487,000,000",
      "Target | Stat | Needed  | Projected  | Req/day"
    ].join("\n");
    const currentSubscribersChanged = [
      "Metric: MrBeast YouTube channel subscribers",
      "Subscribers: 488,000,000",
      "Target | Stat | Needed  | Projected  | Req/day"
    ].join("\n");

    expect(mrBeastSubscribersAdapter.shouldAlertOnChange?.(previous, currentProjectionOnly)).toBe(false);
    expect(mrBeastSubscribersAdapter.shouldAlertOnChange?.(previous, currentSubscribersChanged)).toBe(true);
  });
});
