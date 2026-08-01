import { describe, expect, it } from "vitest";
import {
  extractStrategyStrcStrikes,
  formatStrategyStrcMarketCapValue,
  parseStrategyStrcMarketCapSnapshot,
  shouldAlertOnStrategyStrcMarketCapChange,
  strategyStrcMarketCapAdapter
} from "../src/integrations/strategyStrcMarketCap.js";

const polymarketUrl = "https://polymarket.com/event/what-market-cap-will-strc-reach-by-july-31-2026";

describe("Strategy STRC market cap adapter", () => {
  it("parses the official Strategy KPI response", () => {
    expect(
      parseStrategyStrcMarketCapSnapshot({
        marketCap: 9358,
        prevDayMarketCap: 9362.2,
        marketCapVarVal: "4.2",
        marketCapVarPerc: "0.04",
        marketCapNeg: true,
        timeStampUtc: "2026-07-31T20:00:00"
      })
    ).toEqual({
      marketCapMillions: 9358,
      previousDayMarketCapMillions: 9362.2,
      changeMillions: -4.2,
      changePercent: -0.04,
      sourceTimestamp: "2026-07-31T20:00:00.000Z"
    });

    expect(parseStrategyStrcMarketCapSnapshot([{ marketCap: 9358 }]).marketCapMillions).toBe(9358);
  });

  it("extracts unresolved market-cap strikes from Gamma", () => {
    expect(
      extractStrategyStrcStrikes({
        markets: [
          { active: true, question: "Will STRC market cap hit $10B by July 31?" },
          { active: true, question: "Will STRC market cap hit $12B by July 31?" },
          { active: true, question: "Will STRC market cap hit $14B by July 31?", outcomePrices: "[\"1\",\"0\"]" },
          { closed: true, question: "Will STRC market cap hit $16B by July 31?" }
        ]
      })
    ).toEqual([10_000, 12_000]);
  });

  it("alerts once when a strike is reached and preserves the high-water", () => {
    const baseline = formatStrategyStrcMarketCapValue(
      {
        marketCapMillions: 9358,
        previousDayMarketCapMillions: 9362.2,
        changeMillions: -4.2,
        changePercent: -0.04,
        sourceTimestamp: "2026-07-31T20:00:00.000Z"
      },
      [10_000, 12_000, 14_000, 16_000],
      null,
      polymarketUrl
    );
    const crossing = formatStrategyStrcMarketCapValue(
      {
        marketCapMillions: 10_005,
        previousDayMarketCapMillions: 9358,
        changeMillions: 647,
        changePercent: 6.91,
        sourceTimestamp: "2026-08-01T14:30:00.000Z"
      },
      [10_000, 12_000, 14_000, 16_000],
      baseline,
      polymarketUrl
    );
    const pullback = formatStrategyStrcMarketCapValue(
      {
        marketCapMillions: 9900,
        previousDayMarketCapMillions: 10_005,
        changeMillions: -105,
        changePercent: -1.05,
        sourceTimestamp: "2026-08-01T15:00:00.000Z"
      },
      [10_000, 12_000, 14_000, 16_000],
      crossing,
      polymarketUrl
    );

    expect(baseline).toContain("Next open strike: $10B ($642.0M away)");
    expect(crossing).toContain("Newly hit strikes: $10B");
    expect(crossing).toContain("Monitoring high-water: $10,005.0M ($10.005B)");
    expect(shouldAlertOnStrategyStrcMarketCapChange(baseline, crossing)).toBe(true);
    expect(pullback).toContain("Newly hit strikes: none");
    expect(pullback).toContain("Monitoring high-water: $10,005.0M ($10.005B)");
    expect(shouldAlertOnStrategyStrcMarketCapChange(crossing, pullback)).toBe(false);
  });

  it("defines standard monitor metadata", () => {
    expect(strategyStrcMarketCapAdapter).toMatchObject({
      id: "strategy-strc-market-cap",
      commandName: "strcmarketcap",
      defaultChannelName: "strcmarketcap",
      alertRoleName: "STRC Market Cap Alerts",
      alertRoleEmoji: "\uD83D\uDCC8"
    });
  });
});
