import { describe, expect, it } from "vitest";
import {
  bonbastUsdIrrAdapter,
  extractBonbastGraphPoints,
  extractBonbastUsdIrrValue,
  formatBonbastUsdIrrValue,
  normalizeBonbastMarketSearchEvent,
  refreshBonbastPolymarketQueue
} from "../src/integrations/bonbast.js";
import type { Integration } from "../src/integrations/types.js";

describe("extractBonbastUsdIrrValue", () => {
  it("extracts a currency-like number from page text", () => {
    const html = `
      <html>
        <body>
          <h1>USD</h1>
          <span>Last price</span>
          <strong>612,500</strong>
        </body>
      </html>
    `;

    expect(extractBonbastUsdIrrValue(html)).toBe("6125000");
  });

  it("extracts a currency-like number from chart scripts", () => {
    const html = `
      <html>
        <body></body>
        <script>
          const chartData = [[1710000000000, 601200], [1710000100000, 602100]];
        </script>
      </html>
    `;

    expect(extractBonbastUsdIrrValue(html)).toBe("6021000");
  });

  it("shows provisional toman and finalized IRR values from graph history", () => {
    const html = `
      <script>
        const chart = {
          labels: [new Date('2026-07-29'), new Date('2026-07-30')],
          datasets: [{ label: 'usd', data: [193600, 193300] }]
        };
      </script>
    `;

    expect(extractBonbastGraphPoints(html)).toEqual([
      { date: "2026-07-29", toman: 193600, irr: 1936000 },
      { date: "2026-07-30", toman: 193300, irr: 1933000 }
    ]);
    expect(formatBonbastUsdIrrValue(html)).toContain("Latest finalized: 1,936,000 IRR per USD (193,600 toman)");
    expect(formatBonbastUsdIrrValue(html)).toContain("Latest provisional: 1,933,000 IRR per USD (193,300 toman)");
    expect(bonbastUsdIrrAdapter.shouldAlertOnChange?.(
      formatBonbastUsdIrrValue(html),
      formatBonbastUsdIrrValue(html).replace("Day change: -3,000", "Day change: -4,000")
    )).toBe(false);
  });

  it("throws when no plausible value exists", () => {
    expect(() => extractBonbastUsdIrrValue("<html><body>No values</body></html>")).toThrow(
      "Could not find a Bonbast USD/IRR value"
    );
  });

  it("normalizes only active future USD/IRR Polymarket markets", () => {
    const now = new Date("2026-06-02T00:00:00.000Z");
    expect(
      normalizeBonbastMarketSearchEvent(
        {
          slug: "will-usd-hit-iranian-rials-by-june-30",
          title: "Will USD hit ___ Iranian rials by June 30?",
          active: true,
          closed: false,
          startDate: "2026-06-01T22:56:51.460143Z",
          endDate: "2026-06-30T00:00:00Z"
        },
        now
      )
    ).toEqual({
      url: "https://polymarket.com/event/will-usd-hit-iranian-rials-by-june-30",
      slug: "will-usd-hit-iranian-rials-by-june-30",
      startAt: "2026-06-01T22:56:51.460Z",
      endAt: "2026-06-30T00:00:00.000Z",
      addedAt: now.toISOString()
    });

    expect(
      normalizeBonbastMarketSearchEvent(
        {
          slug: "will-usd-hit-iranian-rials-by-may-31",
          title: "Will USD hit ___ Iranian rials by May 31?",
          active: true,
          closed: false,
          startDate: "2026-04-30T19:26:44.768447Z",
          endDate: "2026-05-31T00:00:00Z"
        },
        now
      )
    ).toBeNull();

    expect(
      normalizeBonbastMarketSearchEvent(
        {
          slug: "usd-x-iranian-rials-end-of-june",
          title: "USD x Iranian rials End of June?",
          active: true,
          closed: false,
          startDate: "2026-06-01T22:56:56.361492Z",
          endDate: "2026-06-30T00:00:00Z"
        },
        now
      )
    ).toEqual({
      url: "https://polymarket.com/event/usd-x-iranian-rials-end-of-june",
      slug: "usd-x-iranian-rials-end-of-june",
      startAt: "2026-06-01T22:56:56.361Z",
      endAt: "2026-06-30T00:00:00.000Z",
      addedAt: now.toISOString()
    });
  });

  it("discovers and activates current Bonbast Polymarket markets", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          events: [
            {
              slug: "will-usd-hit-iranian-rials-by-june-30",
              title: "Will USD hit ___ Iranian rials by June 30?",
              active: true,
              closed: false,
              startDate: "2026-06-01T22:56:51.460143Z",
              endDate: "2026-06-30T00:00:00Z"
            },
            {
              slug: "usd-x-iranian-rials-end-of-june",
              title: "USD x Iranian rials End of June?",
              active: true,
              closed: false,
              startDate: "2026-06-01T22:56:56.361492Z",
              endDate: "2026-06-30T00:00:00Z"
            }
          ]
        })
      );

    try {
      const result = await refreshBonbastPolymarketQueue(buildIntegration(), new Date("2026-06-02T00:00:00.000Z"), {
        force: true
      });
      expect(result.activeUrl).toBe("https://polymarket.com/event/will-usd-hit-iranian-rials-by-june-30");
      const settings = JSON.parse(result.settingsJson ?? "{}") as { polymarketMarkets?: { slug: string }[] };
      expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual([
        "will-usd-hit-iranian-rials-by-june-30",
        "usd-x-iranian-rials-end-of-june"
      ]);
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
    adapterId: "bonbast-usd-irr",
    displayName: "Bonbast USD/IRR",
    sourceUrl: "https://www.bonbast.com/graph/usd",
    polymarketUrl: null,
    alertRoleId: null,
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: null,
    settingsJson: null,
    pollIntervalMinutes: 5,
    status: "active",
    lastValue: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    snapshotValue: null,
    snapshotCheckedAt: null,
    snapshotDate: null,
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z"
  };
}
