import { describe, expect, it } from "vitest";
import {
  buildVolmexEvivHistoryUrl,
  extractVolmexEvivCandles,
  extractVolmexEvivHighStrikesFromGamma,
  filterNewVolmexEvivStrikeCrossings,
  findVolmexEvivHighStrikeCrossings,
  formatVolmexEvivStrikeMonitorValue,
  volmexEvivShouldAlertOnChange
} from "../src/integrations/volmexEviv.js";

describe("Volmex EVIV high strike monitor", () => {
  it("extracts only unresolved high strikes from Polymarket Gamma markets", () => {
    expect(
      extractVolmexEvivHighStrikesFromGamma([
        {
          markets: [
            { question: "Will the Ethereum Volatility Index dip to 40 by June 30?", groupItemTitle: "↓ 40", active: true },
            { question: "Will the Ethereum Volatility Index hit 100 by June 30?", groupItemTitle: "↑ 100", active: true },
            { question: "Will the Ethereum Volatility Index hit 80 by June 30?", groupItemTitle: "↑ 80", active: true },
            { question: "Will the Ethereum Volatility Index hit 65 by June 30?", groupItemTitle: "↑ 65", closed: true },
            {
              question: "Will the Ethereum Volatility Index hit 60 by June 30?",
              groupItemTitle: "↑ 60",
              outcomePrices: "[\"1\", \"0\"]"
            }
          ]
        }
      ])
    ).toEqual([
      { display: "80", value: 80 },
      { display: "100", value: 100 }
    ]);
  });

  it("extracts Volmex UDF history candles", () => {
    expect(
      extractVolmexEvivCandles({
        s: "ok",
        t: [1_780_000_000, 1_780_000_060],
        h: [59.9, 60.2],
        l: [59.1, 59.8],
        c: [59.8, 60.1]
      })
    ).toEqual([
      {
        high: 59.9,
        low: 59.1,
        close: 59.8,
        timestamp: "2026-05-28T20:26:40.000Z"
      },
      {
        high: 60.2,
        low: 59.8,
        close: 60.1,
        timestamp: "2026-05-28T20:27:40.000Z"
      }
    ]);
  });

  it("detects upside crossings from the previous stored price", () => {
    const candles = extractVolmexEvivCandles({
      t: [1_780_000_000, 1_780_000_060],
      h: [59.9, 60.2],
      l: [59.1, 59.8],
      c: [59.8, 60.1]
    });

    expect(findVolmexEvivHighStrikeCrossings([{ display: "60", value: 60 }], 59.5, candles)).toEqual([
      {
        display: "60",
        value: 60,
        price: 60.2,
        timestamp: "2026-05-28T20:27:40.000Z"
      }
    ]);
  });

  it("keeps high strike alerts one-shot for the active Polymarket URL", () => {
    const polymarketUrl = "https://polymarket.com/event/what-will-the-ethereum-implied-volatility-index-hit-by-june-30";
    const previousValue = formatVolmexEvivStrikeMonitorValue({
      polymarketUrl,
      lastPrice: 60.1,
      lastPriceTime: "2026-05-29T00:27:40.000Z",
      strikes: [{ display: "60", value: 60 }],
      crossings: [{ display: "60", value: 60, price: 60.2, timestamp: "2026-05-29T00:27:40.000Z" }],
      alertedStrikes: ["60"]
    });

    expect(
      filterNewVolmexEvivStrikeCrossings(previousValue, polymarketUrl, [
        { display: "60", value: 60, price: 60.3, timestamp: "2026-05-29T00:28:40.000Z" }
      ])
    ).toEqual({ crossings: [], alertedStrikes: ["60"] });
  });

  it("formats state and only alerts when a high crossing exists", () => {
    const noCrossingValue = formatVolmexEvivStrikeMonitorValue({
      lastPrice: 59,
      lastPriceTime: "2026-05-29T00:26:40.000Z",
      strikes: [{ display: "60", value: 60 }],
      crossings: []
    });
    const crossingValue = formatVolmexEvivStrikeMonitorValue({
      lastPrice: 60.2,
      lastPriceTime: "2026-05-29T00:27:40.000Z",
      strikes: [{ display: "60", value: 60 }],
      crossings: [{ display: "60", value: 60, price: 60.2, timestamp: "2026-05-29T00:27:40.000Z" }]
    });

    expect(noCrossingValue).toContain("Crossed High Strikes:\nnone");
    expect(crossingValue).toContain("60 crossed up; EVIV 1m high 60.2");
    expect(volmexEvivShouldAlertOnChange(noCrossingValue, noCrossingValue)).toBe(false);
    expect(volmexEvivShouldAlertOnChange(noCrossingValue, crossingValue)).toBe(true);
  });

  it("requests 1-minute EVIV candles from Volmex", () => {
    expect(
      buildVolmexEvivHistoryUrl({
        from: new Date("2026-05-29T00:00:00.000Z"),
        to: new Date("2026-05-29T00:10:00.000Z")
      })
    ).toBe("https://rest-v2.volmex.finance/public/history?symbol=EVIV&resolution=1&from=1780012800&to=1780013400");
  });
});
