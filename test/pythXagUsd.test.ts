import { describe, expect, it } from "vitest";
import {
  extractPythStrikesFromGamma,
  extractTopPythFeed,
  fetchPythPriceStrikeMonitorValue,
  formatPythPriceStrikeMonitorValue
} from "../src/integrations/pythPriceStrikes.js";
import { xagUsdConfig } from "../src/integrations/pythXagUsd.js";
import type { Integration } from "../src/integrations/types.js";

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
      { display: "$45.00", triggerDirection: "down", value: 45 },
      { display: "$50.00", triggerDirection: "up", value: 50 }
    ]);
  });

  it("does not fail when Gamma has no unresolved XAGUSD strikes", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const value = String(url);
      if (value.includes("gamma-api.polymarket.com")) {
        return new Response(JSON.stringify([]));
      }
      if (value.includes("pyth.dourolabs.app/v1/symbols")) {
        return new Response(JSON.stringify([{ name: "XAGUSD", state: "stable", symbol: "Metal.XAG/USD" }]));
      }
      if (value.includes("/api/price-feeds?")) {
        return new Response(JSON.stringify({ data: [{ name: "XAGUSD", state: "stable", symbol: "Metal.XAG/USD" }] }));
      }
      if (value.includes("/history")) {
        return new Response(JSON.stringify([{ high: 83, low: 81, close: 82, timestamp: "2026-05-21T00:00:00.000Z" }]));
      }
      throw new Error(`Unexpected URL ${value}`);
    };

    try {
      await expect(fetchPythPriceStrikeMonitorValue(xagUsdConfig)).resolves.toContain("Tracked Strikes:\nnone");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to the last stored XAGUSD strike list when Gamma is empty", async () => {
    const polymarketUrl = xagUsdConfig.defaultPolymarketUrl;
    const previousValue = formatPythPriceStrikeMonitorValue({
      sourceUrl: xagUsdConfig.sourceUrl!,
      polymarketUrl,
      feed: { name: "XAGUSD", state: "stable", symbol: "Metal.XAG/USD" },
      lastPrice: 80,
      lastPriceTime: "2026-05-21T00:00:00.000Z",
      strikes: [
        { display: "$82.00", value: 82 },
        { display: "$84.00", value: 84 }
      ],
      crossings: []
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const value = String(url);
      if (value.includes("gamma-api.polymarket.com")) {
        return new Response(JSON.stringify([]));
      }
      if (value.includes("pyth.dourolabs.app/v1/symbols")) {
        return new Response(JSON.stringify([{ name: "XAGUSD", state: "stable", symbol: "Metal.XAG/USD" }]));
      }
      if (value.includes("/api/price-feeds?")) {
        return new Response(JSON.stringify({ data: [{ name: "XAGUSD", state: "stable", symbol: "Metal.XAG/USD" }] }));
      }
      if (value.includes("/history")) {
        return new Response(JSON.stringify([{ high: 83, low: 81, close: 82, timestamp: "2026-05-21T00:00:00.000Z" }]));
      }
      throw new Error(`Unexpected URL ${value}`);
    };

    try {
      await expect(
        fetchPythPriceStrikeMonitorValue(xagUsdConfig, {
          polymarketUrl,
          lastValue: previousValue
        } as Integration)
      ).resolves.toContain("Tracked Strikes:\n$82.00, $84.00");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
