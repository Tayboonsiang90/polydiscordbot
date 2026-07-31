import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildVolmexBvivHistoryUrl,
  extractVolmexBvivCandles,
  extractVolmexBvivLowStrikesFromGamma,
  extractVolmexBvivStrikesFromGamma,
  fetchVolmexBvivCandles,
  filterNewVolmexBvivStrikeCrossings,
  findVolmexBvivLowStrikeCrossings,
  findVolmexBvivStrikeCrossings,
  formatVolmexBvivStrikeMonitorValue,
  volmexBvivShouldAlertOnChange
} from "../src/integrations/volmexBviv.js";

describe("Volmex BVIV low strike monitor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts only unresolved low strikes from Polymarket Gamma markets", () => {
    expect(
      extractVolmexBvivLowStrikesFromGamma([
        {
          markets: [
            { question: "Will the Bitcoin Volatility Index hit 60 by May 31?", groupItemTitle: "↑ 60", active: true },
            { question: "Will the Bitcoin Volatility Index dip to 30 by May 31?", groupItemTitle: "↓ 30", active: true },
            { question: "Will the Bitcoin Volatility Index dip to 25 by May 31?", groupItemTitle: "↓ 25", closed: true },
            {
              question: "Will the Bitcoin Volatility Index dip to 20 by May 31?",
              groupItemTitle: "↓ 20",
              outcomePrices: "[\"1\", \"0\"]"
            }
          ]
        }
      ])
    ).toEqual([{ display: "30", value: 30, direction: "low" }]);
  });

  it("tracks unresolved high and low market strikes together", () => {
    const strikes = extractVolmexBvivStrikesFromGamma([{
      markets: [
        { question: "Will BVIV hit 70 by July 31?", groupItemTitle: "↑ 70", active: true },
        { question: "Will BVIV dip to 40 by July 31?", groupItemTitle: "↓ 40", active: true }
      ]
    }]);
    expect(strikes).toEqual([
      { display: "↓ 40", value: 40, direction: "low" },
      { display: "↑ 70", value: 70, direction: "high" }
    ]);
    expect(
      findVolmexBvivStrikeCrossings(strikes, 55, [{
        high: 71,
        low: 39,
        close: 55,
        timestamp: "2026-07-31T12:00:00.000Z"
      }]).map((crossing) => crossing.display)
    ).toEqual(["↓ 40", "↑ 70"]);
  });

  it("extracts Volmex UDF history candles", () => {
    expect(
      extractVolmexBvivCandles({
        s: "ok",
        t: [1_780_000_000, 1_780_000_060],
        h: [32.4, 31.8],
        l: [31.9, 29.8],
        c: [32.1, 30.5]
      })
    ).toEqual([
      {
        high: 32.4,
        low: 31.9,
        close: 32.1,
        timestamp: "2026-05-28T20:26:40.000Z"
      },
      {
        high: 31.8,
        low: 29.8,
        close: 30.5,
        timestamp: "2026-05-28T20:27:40.000Z"
      }
    ]);
  });

  it("detects downside crossings from the previous stored price", () => {
    const candles = extractVolmexBvivCandles({
      t: [1_780_000_000, 1_780_000_060],
      h: [32, 31],
      l: [30.1, 24.9],
      c: [30.5, 25.2]
    });

    expect(findVolmexBvivLowStrikeCrossings([{ display: "25", value: 25 }], 31, candles)).toEqual([
      {
        display: "25",
        value: 25,
        price: 24.9,
        timestamp: "2026-05-28T20:27:40.000Z"
      }
    ]);
  });

  it("keeps low strike alerts one-shot for the active Polymarket URL", () => {
    const polymarketUrl =
      "https://polymarket.com/event/what-will-the-bitcoin-implied-volatility-index-hit-by-may-31/will-the-bitcoin-volatility-index-dip-to-25-by-may-31";
    const previousValue = formatVolmexBvivStrikeMonitorValue({
      polymarketUrl,
      lastPrice: 24.9,
      lastPriceTime: "2026-05-29T00:27:40.000Z",
      strikes: [{ display: "25", value: 25 }],
      crossings: [{ display: "25", value: 25, price: 24.9, timestamp: "2026-05-29T00:27:40.000Z" }],
      alertedStrikes: ["25"]
    });

    expect(
      filterNewVolmexBvivStrikeCrossings(previousValue, polymarketUrl, [
        { display: "25", value: 25, price: 24.8, timestamp: "2026-05-29T00:28:40.000Z" }
      ])
    ).toEqual({ crossings: [], alertedStrikes: ["25"] });
  });

  it("formats state and only alerts when a low crossing exists", () => {
    const noCrossingValue = formatVolmexBvivStrikeMonitorValue({
      lastPrice: 31,
      lastPriceTime: "2026-05-29T00:26:40.000Z",
      strikes: [{ display: "25", value: 25 }],
      crossings: []
    });
    const crossingValue = formatVolmexBvivStrikeMonitorValue({
      lastPrice: 24.9,
      lastPriceTime: "2026-05-29T00:27:40.000Z",
      strikes: [{ display: "25", value: 25 }],
      crossings: [{ display: "25", value: 25, price: 24.9, timestamp: "2026-05-29T00:27:40.000Z" }]
    });

    expect(noCrossingValue).toContain("Crossed Strikes:\nnone");
    expect(crossingValue).toContain("25 crossed down; BVIV 1m low 24.9");
    expect(volmexBvivShouldAlertOnChange(noCrossingValue, noCrossingValue)).toBe(false);
    expect(volmexBvivShouldAlertOnChange(noCrossingValue, crossingValue)).toBe(true);
  });

  it("requests 1-minute BVIV candles from Volmex", () => {
    expect(
      buildVolmexBvivHistoryUrl({
        from: new Date("2026-05-29T00:00:00.000Z"),
        to: new Date("2026-05-29T00:10:00.000Z")
      })
    ).toBe("https://rest-v2.volmex.finance/public/history?symbol=BVIV&resolution=1&from=1780012800&to=1780013400");
  });

  it("falls back to hourly BVIV candles when the 1-minute endpoint fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          t: [1_780_000_000],
          h: [30.2],
          l: [24.9],
          c: [25.1]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchVolmexBvivCandles({
        from: new Date("2026-05-29T00:00:00.000Z"),
        to: new Date("2026-05-29T00:10:00.000Z")
      })
    ).resolves.toEqual([
      {
        high: 30.2,
        low: 24.9,
        close: 25.1,
        timestamp: "2026-05-28T20:26:40.000Z"
      }
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("resolution=1");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("resolution=60");
  });
});
