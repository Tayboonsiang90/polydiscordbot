import { describe, expect, it } from "vitest";
import { extractPythStrikesFromGamma, extractTopPythFeed } from "../src/integrations/pythPriceStrikes.js";
import { xauUsdConfig } from "../src/integrations/pythXauUsd.js";

describe("Pyth XAUUSD strike monitor", () => {
  it("selects the stable XAUUSD feed", () => {
    expect(
      extractTopPythFeed(
        {
          data: [
            { name: "XAUUSD", state: "stable", symbol: "Metal.XAU/USD" },
            { name: "XAUUSD_DEPRECATED", state: "inactive", symbol: "Metal.XAU/USD_DEPRECATED" }
          ]
        },
        xauUsdConfig.feedNamePattern
      )
    ).toEqual({ name: "XAUUSD", state: "stable", symbol: "Metal.XAU/USD" });
  });

  it("extracts unresolved XAUUSD strikes with comma prices", () => {
    expect(
      extractPythStrikesFromGamma([
        {
          markets: [
            { question: "Will Gold (XAUUSD) hit (HIGH) $5,400 in May?", outcomePrices: '["0.03","0.97"]' },
            { question: "Will Gold (XAUUSD) hit (LOW) $4,700 in May?", closed: true, outcomePrices: '["1","0"]' },
            { question: "Will Gold (XAUUSD) hit (LOW) $4,500 in May?", outcomePrices: '["0.39","0.61"]' }
          ]
        }
      ])
    ).toEqual([
      { display: "$4,500.00", value: 4500 },
      { display: "$5,400.00", value: 5400 }
    ]);
  });
});
