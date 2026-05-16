import { describe, expect, it } from "vitest";
import {
  extractLatestKaitoPolymarketMindsharePoint,
  extractLatestKaitoPolymarketMindshareValue
} from "../src/integrations/kaitoMindshare.js";

describe("Kaito Polymarket mindshare parsing", () => {
  it("extracts the latest finalized Polymarket historical data row", () => {
    const point = extractLatestKaitoPolymarketMindsharePoint({
      data: [
        { date: "2026-05-07", project: "Kalshi", mindshare: 0.18, finalized: true },
        { date: "2026-05-07", project: "Polymarket", mindshare: 0.42123, finalized: true },
        { date: "2026-05-08", project: "Polymarket", mindshare: 44.56, finalized: "finalized" },
        { date: "2026-05-09", project: "Polymarket", mindshare: 50.01, finalized: false }
      ]
    });

    expect(point).toEqual({
      date: "2026-05-08",
      mindsharePercent: 44.56
    });
  });

  it("formats the stable monitor value", () => {
    const value = extractLatestKaitoPolymarketMindshareValue({
      result: {
        rows: [{ day: "2026-05-08T00:00:00.000Z", name: "Polymarket", mindshare_percent: "42.125%" }]
      }
    });

    expect(value).toBe(
      [
        "Metric: Polymarket Kaito Info Markets mindshare",
        "Date: 2026-05-08",
        "Mindshare: 42.125%",
        "Resolution: https://kaito.ai/mindshare-arena/infomarkets"
      ].join("\n")
    );
  });
});
