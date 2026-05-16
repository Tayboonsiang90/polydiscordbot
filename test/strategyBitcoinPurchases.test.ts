import { describe, expect, it } from "vitest";
import {
  extractStrategyBitcoinPurchases,
  extractStrategyBitcoinPurchaseValue
} from "../src/integrations/strategyBitcoinPurchases.js";

const marketUrl = "https://polymarket.com/event/will-microstrategy-announce-a-bitcoin-purchase-may-12-18";

function htmlWithRows(rows: unknown[]): string {
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { bitcoinData: rows } }
  })}</script></body></html>`;
}

describe("Strategy bitcoin purchases adapter", () => {
  it("extracts Strategy purchase rows from Next.js data newest first", () => {
    const rows = [
      { uid: "old", date_of_purchase: "2026-05-11", title: "May 2026", count: 535 },
      { uid: "new", date_of_purchase: "2026-05-12", title: "May 2026", count: 1020 }
    ];

    const purchases = extractStrategyBitcoinPurchases(htmlWithRows(rows));

    expect(purchases).toMatchObject([
      { id: "new", date: "2026-05-12", count: 1020 },
      { id: "old", date: "2026-05-11", count: 535 }
    ]);
  });

  it("reports a purchase when it falls inside the active Polymarket range", () => {
    const rows = [
      { uid: "outside", date_of_purchase: "2026-05-11", title: "May 2026", count: 535 },
      {
        uid: "inside",
        date_of_purchase: "2026-05-12",
        title: "May 2026",
        count: 1020,
        purchase_price: 101000,
        total_purchase_price: 103020000,
        btc_holdings: 819889,
        average_price: 75610,
        sec: { url: "https://example.com/sec.pdf" },
        publish_details: { time: "2026-05-12T12:01:34.128Z" },
        x_post_plain_text: "@Strategy has acquired 1,020 BTC."
      }
    ];

    const value = extractStrategyBitcoinPurchaseValue(htmlWithRows(rows), marketUrl, new Date("2026-05-13T00:00:00.000Z"));

    expect(value).toContain("Status: Strategy BTC purchase announced");
    expect(value).toContain("Market range: 2026-05-12 to 2026-05-18");
    expect(value).toContain("Purchase date: 2026-05-12");
    expect(value).toContain("BTC acquired: 1,020");
    expect(value).toContain("SEC filing: https://example.com/sec.pdf");
  });

  it("keeps the latest purchase visible when no purchase is inside the market range", () => {
    const rows = [{ uid: "outside", date_of_purchase: "2026-05-11", title: "May 2026", count: 535 }];

    const value = extractStrategyBitcoinPurchaseValue(htmlWithRows(rows), marketUrl, new Date("2026-05-13T00:00:00.000Z"));

    expect(value).toContain("Status: no Strategy BTC purchase announced in market range");
    expect(value).toContain("Market range: 2026-05-12 to 2026-05-18");
    expect(value).toContain("Latest purchase date: 2026-05-11");
    expect(value).toContain("Latest purchase title: May 2026");
  });
});
