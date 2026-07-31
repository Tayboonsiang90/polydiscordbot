import { describe, expect, it } from "vitest";
import {
  extractNaturalGasStrikesFromGamma,
  filterNewPythStrikeCrossings,
  extractPythCandles,
  extractTopNaturalGasFeed,
  findPythStrikeCrossings,
  formatPythPriceStrikeMonitorValue,
  naturalGasConfig,
  naturalGasShouldAlertOnChange
} from "../src/integrations/pythNaturalGas.js";
import {
  fetchPythDependencyWithRetry,
  normalizePythPriceMarketSearchEvent,
  refreshPythPricePolymarketQueue
} from "../src/integrations/pythPriceStrikes.js";
import type { Integration } from "../src/integrations/types.js";

describe("Pyth Natural Gas strike monitor", () => {
  const feed = { name: "NGDM6", state: "stable", symbol: "Commodities.NGDM6/USD" };

  it("extracts strike prices from Polymarket Gamma markets", () => {
    const strikes = extractNaturalGasStrikesFromGamma([
      {
        markets: [
          { question: "Will Natural Gas (NG) hit (HIGH) $4.20 in May?", groupItemTitle: "↑ $4.20" },
          { question: "Will Natural Gas (NG) hit (HIGH) $4.00 in May?", groupItemTitle: "↑ $4.00" },
          { question: "Will Natural Gas (NG) hit (HIGH) $4.00 in May?", groupItemTitle: "↑ $4.00" },
          { question: "Will Natural Gas (NG) hit (LOW) $2.80 in May?", groupItemTitle: "↓ $2.80", closed: true },
          { question: "Will Natural Gas (NG) hit (LOW) $2.60 in May?", groupItemTitle: "↓ $2.60", outcomePrices: '["1","0"]' }
        ]
      }
    ]);

    expect(strikes).toEqual([
      { display: "$4.00", triggerDirection: "up", value: 4 },
      { display: "$4.20", triggerDirection: "up", value: 4.2 }
    ]);
  });

  it("selects only the top stable NGD feed", () => {
    expect(
      extractTopNaturalGasFeed({
        data: [
          { name: "NGDM6", state: "stable", symbol: "Commodities.NGDM6/USD" },
          { name: "NGDN6", state: "stable", symbol: "Commodities.NGDN6/USD" },
          { name: "NGDU6", state: "coming_soon", symbol: "Commodities.NGDU6/USD" }
        ]
      })
    ).toEqual(feed);
  });

  it("selects the front stable contract from Pyth's public symbols response", () => {
    expect(
      extractTopNaturalGasFeed([
        { name: "NGDQ6", state: "inactive", symbol: "Commodities.NGDQ6/USD" },
        { name: "NGDU6", state: "stable", symbol: "Commodities.NGDU6/USD" },
        { name: "NGDV6", state: "stable", symbol: "Commodities.NGDV6/USD" }
      ])
    ).toEqual({ name: "NGDU6", state: "stable", symbol: "Commodities.NGDU6/USD" });
  });

  it("parses Pyth's official TradingView history columns", () => {
    expect(
      extractPythCandles({
        s: "ok",
        t: [1785471900, 1785471960],
        h: [3.05, 3.08],
        l: [3.01, 3.02],
        c: [3.04, 3.06]
      })
    ).toEqual([
      {
        high: 3.05,
        low: 3.01,
        close: 3.04,
        timestamp: "2026-07-31T04:25:00.000Z"
      },
      {
        high: 3.08,
        low: 3.02,
        close: 3.06,
        timestamp: "2026-07-31T04:26:00.000Z"
      }
    ]);
  });

  it("detects upward and downward live crossings from the previous stored price", () => {
    const candles = extractPythCandles([
      { high: 3.02, low: 2.89, close: 3.01, timestamp: "2026-05-11T00:00:00.000Z" },
      { high: 3.01, low: 2.78, close: 2.79, timestamp: "2026-05-11T00:01:00.000Z" }
    ]);

    expect(
      findPythStrikeCrossings(
        [
          { display: "$2.80", value: 2.8 },
          { display: "$3.00", value: 3 }
        ],
        feed,
        2.95,
        candles
      )
    ).toEqual([
      {
        display: "$3.00",
        value: 3,
        direction: "up",
        feedName: "NGDM6",
        price: 3.02,
        timestamp: "2026-05-11T00:00:00.000Z"
      },
      {
        display: "$2.80",
        value: 2.8,
        direction: "down",
        feedName: "NGDM6",
        price: 2.78,
        timestamp: "2026-05-11T00:01:00.000Z"
      },
      {
        display: "$3.00",
        value: 3,
        direction: "down",
        feedName: "NGDM6",
        price: 2.78,
        timestamp: "2026-05-11T00:01:00.000Z"
      }
    ]);
  });

  it("honors Polymarket HIGH and LOW strike directions", () => {
    const candles = extractPythCandles([
      { high: 3.05, low: 2.75, close: 2.8, timestamp: "2026-05-11T00:00:00.000Z" }
    ]);

    expect(
      findPythStrikeCrossings(
        [
          { display: "$2.80", triggerDirection: "up", value: 2.8 },
          { display: "$3.00", triggerDirection: "down", value: 3 }
        ],
        feed,
        2.95,
        candles
      )
    ).toEqual([]);
  });

  it("formats state and only alerts when a crossing exists", () => {
    const noCrossingValue = formatPythPriceStrikeMonitorValue({
      sourceUrl: "https://pythdata.app/explore?search=NGD",
      feed,
      lastPrice: 2.95,
      lastPriceTime: "2026-05-11T00:00:00.000Z",
      strikes: [{ display: "$3.00", value: 3 }],
      crossings: []
    });
    const crossingValue = formatPythPriceStrikeMonitorValue({
      sourceUrl: "https://pythdata.app/explore?search=NGD",
      feed,
      lastPrice: 3.01,
      lastPriceTime: "2026-05-11T00:01:00.000Z",
      strikes: [{ display: "$3.00", value: 3 }],
      crossings: [
        {
          display: "$3.00",
          value: 3,
          direction: "up",
          feedName: "NGDM6",
          price: 3.01,
          timestamp: "2026-05-11T00:01:00.000Z"
        }
      ]
    });

    expect(noCrossingValue).toContain("Crossed Strikes:\nnone");
    expect(crossingValue).toContain("$3.00 crossed up on NGDM6 at 3.01");
    expect(naturalGasShouldAlertOnChange(noCrossingValue, noCrossingValue)).toBe(false);
    expect(naturalGasShouldAlertOnChange(noCrossingValue, crossingValue)).toBe(true);
  });

  it("keeps price strike alerts one-shot for the active Polymarket URL", () => {
    const polymarketUrl = "https://polymarket.com/event/what-price-will-ng-hit-in-may-2026";
    const previousValue = formatPythPriceStrikeMonitorValue({
      sourceUrl: "https://pythdata.app/explore?search=NGD",
      polymarketUrl,
      feed,
      lastPrice: 3.01,
      lastPriceTime: "2026-05-11T00:01:00.000Z",
      strikes: [{ display: "$3.00", value: 3 }],
      crossings: [
        {
          display: "$3.00",
          value: 3,
          direction: "up",
          feedName: "NGDM6",
          price: 3.01,
          timestamp: "2026-05-11T00:01:00.000Z"
        }
      ],
      alertedStrikes: ["$3.00"]
    });

    expect(
      filterNewPythStrikeCrossings(previousValue, polymarketUrl, [
        {
          display: "$3.00",
          value: 3,
          direction: "down",
          feedName: "NGDM6",
          price: 2.99,
          timestamp: "2026-05-11T00:02:00.000Z"
        }
      ])
    ).toEqual({ crossings: [], alertedStrikes: ["$3.00"] });
  });

  it("auto-discovers upcoming monthly price markets and ignores weekly markets", async () => {
    const now = new Date("2026-05-30T12:00:00.000Z");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const value = String(url);
      if (value.includes("gamma-api.polymarket.com/public-search")) {
        return new Response(
          JSON.stringify({
            events: [
              {
                slug: "will-ng-hit-week-of-june-1-2026",
                title: "What will Natural Gas (NG) hit Week of June 1 2026?",
                active: true,
                closed: false
              },
              {
                slug: "what-price-will-ng-hit-in-june-2026",
                title: "What will Natural Gas (NG) hit in June 2026?",
                active: true,
                closed: false
              }
            ]
          })
        );
      }

      throw new Error(`Unexpected URL ${value}`);
    };

    try {
      const result = await refreshPythPricePolymarketQueue(buildIntegration(), naturalGasConfig, now, { force: true });
      const settings = JSON.parse(result.settingsJson ?? "{}") as { polymarketMarkets?: Array<{ slug: string }> };
      expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual(["what-price-will-ng-hit-in-june-2026"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("normalizes only matching monthly Polymarket price events", () => {
    const now = new Date("2026-05-30T12:00:00.000Z");
    expect(
      normalizePythPriceMarketSearchEvent(
        {
          slug: "what-price-will-ng-hit-in-june-2026",
          title: "What will Natural Gas (NG) hit in June 2026?",
          active: true,
          closed: false
        },
        naturalGasConfig,
        now
      )
    ).toEqual({
      slug: "what-price-will-ng-hit-in-june-2026",
      url: "https://polymarket.com/event/what-price-will-ng-hit-in-june-2026"
    });

    expect(
      normalizePythPriceMarketSearchEvent(
        {
          slug: "will-ng-hit-week-of-june-1-2026",
          title: "What will Natural Gas (NG) hit Week of June 1 2026?",
          active: true,
          closed: false
        },
        naturalGasConfig,
        now
      )
    ).toBeNull();
  });

  it("retries transient Pyth HTTP rate limits", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return calls === 1
        ? new Response("rate limited", { status: 429, headers: { "retry-after": "0" } })
        : new Response("ok");
    };

    try {
      await expect(fetchPythDependencyWithRetry("https://pythdata.app/test-rate-limit", {})).resolves.toMatchObject({
        status: 200
      });
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function buildIntegration(): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: naturalGasConfig.id,
    displayName: naturalGasConfig.displayName,
    sourceUrl: "https://pythdata.app/explore?search=NGD",
    polymarketUrl: naturalGasConfig.defaultPolymarketUrl,
    alertRoleId: null,
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: null,
    settingsJson: null,
    pollIntervalMinutes: 1,
    status: "active",
    lastValue: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    snapshotValue: null,
    snapshotCheckedAt: null,
    snapshotDate: null,
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z"
  };
}
