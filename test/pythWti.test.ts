import { describe, expect, it } from "vitest";
import { extractPythStrikesFromGamma, extractTopPythFeed } from "../src/integrations/pythPriceStrikes.js";
import { wtiConfig } from "../src/integrations/pythWti.js";

describe("Pyth WTI strike monitor", () => {
  it("selects only the top stable WTI feed", () => {
    expect(
      extractTopPythFeed(
        {
          data: [
            { name: "WTIM6", state: "stable", symbol: "Commodities.WTIM6/USD" },
            { name: "WTIN6", state: "stable", symbol: "Commodities.WTIN6/USD" },
            { name: "WTIUSD", state: "inactive", symbol: "Commodities.WTI/USD" }
          ]
        },
        wtiConfig.feedNamePattern
      )
    ).toEqual({ name: "WTIM6", state: "stable", symbol: "Commodities.WTIM6/USD" });
  });

  it("extracts unresolved WTI strikes and ignores resolved markets", () => {
    expect(
      extractPythStrikesFromGamma([
        {
          markets: [
            { question: "Will WTI Crude Oil (WTI) hit (HIGH) $150 in May?", outcomePrices: '["0.03","0.97"]' },
            { question: "Will WTI Crude Oil (WTI) hit (HIGH) $100 in May?", closed: true, outcomePrices: '["1","0"]' },
            { question: "Will WTI Crude Oil (WTI) hit (LOW) $80 in May?", outcomePrices: '["0.28","0.72"]' }
          ]
        }
      ])
    ).toEqual([
      { display: "$80.00", value: 80 },
      { display: "$150.00", value: 150 }
    ]);
  });
});
