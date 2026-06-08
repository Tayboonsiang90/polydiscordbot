import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractStrategyBitcoinPurchases,
  extractStrategyBitcoinPurchaseValue,
  refreshStrategyBitcoinPurchasesPolymarketQueue
} from "../src/integrations/strategyBitcoinPurchases.js";
import type { Integration } from "../src/integrations/types.js";

const marketUrl = "https://polymarket.com/event/will-microstrategy-announce-a-bitcoin-purchase-may-12-18";
const juneMarketUrl = "https://polymarket.com/event/will-microstrategy-announce-a-bitcoin-purchase-june-2-8";

function htmlWithRows(rows: unknown[]): string {
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { bitcoinData: rows } }
  })}</script></body></html>`;
}

describe("Strategy bitcoin purchases adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("auto-discovers and activates the June 2-8 weekly Strategy purchase market", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "will-microstrategy-announce-a-bitcoin-purchase-june-2-8",
              title: "Will Microstrategy announce a Bitcoin purchase June 2-8?",
              active: true,
              closed: false,
              tags: [{ slug: "microstrategy" }, { slug: "weekly" }, { slug: "recurring" }, { slug: "crypto" }]
            }
          ]
        })
      })
    );

    const result = await refreshStrategyBitcoinPurchasesPolymarketQueue(
      integration({
        polymarketUrl: "https://polymarket.com/event/will-microstrategy-announce-a-bitcoin-purchase-may-12-18"
      }),
      new Date("2026-06-06T03:30:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      lastStrategyDiscoveryAt?: string;
      polymarketMarkets?: Array<{ slug: string; startAt: string; endAt: string }>;
    };

    expect(result.activeUrl).toBe(juneMarketUrl);
    expect(settings.lastStrategyDiscoveryAt).toBe("2026-06-06T03:30:00.000Z");
    expect(settings.polymarketMarkets).toMatchObject([
      {
        slug: "will-microstrategy-announce-a-bitcoin-purchase-june-2-8",
        startAt: "2026-06-02T04:00:00.000Z",
        endAt: "2026-06-09T03:59:00.000Z"
      }
    ]);
    expect(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain("events_tag=microstrategy");
  });
});

function integration(input: Partial<Integration> = {}): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "strategy-bitcoin-purchases",
    displayName: "Strategy Bitcoin Purchases",
    sourceUrl: "https://www.strategy.com/purchases",
    polymarketUrl: marketUrl,
    alertRoleId: null,
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: null,
    settingsJson: null,
    pollIntervalMinutes: 60,
    status: "active",
    lastValue: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    snapshotValue: null,
    snapshotCheckedAt: null,
    snapshotDate: null,
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
    ...input
  };
}
