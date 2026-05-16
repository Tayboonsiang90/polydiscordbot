import { describe, expect, it } from "vitest";
import { extractPythStrikesFromGamma, extractTopPythFeed } from "../src/integrations/pythPriceStrikes.js";
import { xagUsdConfig } from "../src/integrations/pythXagUsd.js";

describe("Pyth XAGUSD strike monitor", () => {
  it("selects the stable XAGUSD feed", () => {
    expect(
      extractTopPythFeed(
        {
          data: [
            { name: "XAGUSD", state: "stable", symbol: "Metal.XAG/USD" },
            { name: "XAGUSD_DEPRECATED", state: "inactive", symbol: "Metal.XAG/USD_DEPRECATED" }
          ]
        },
        xagUsdConfig.feedNamePattern
      )
    ).toEqual({ name: "XAGUSD", state: "stable", symbol: "Metal.XAG/USD" });
  });

  it("extracts unresolved XAGUSD strikes and ignores resolved markets", () => {
    expect(
      extractPythStrikesFromGamma([
        {
          markets: [
            { question: "Will Silver (XAGUSD) hit (HIGH) $50 in May?", outcomePrices: '["0.03","0.97"]' },
            { question: "Will Silver (XAGUSD) hit (LOW) $40 in May?", closed: true, outcomePrices: '["1","0"]' },
            { question: "Will Silver (XAGUSD) hit (LOW) $45 in May?", outcomePrices: '["0.39","0.61"]' }
          ]
        }
      ])
    ).toEqual([
      { display: "$45.00", value: 45 },
      { display: "$50.00", value: 50 }
    ]);
  });
});
