import { describe, expect, it } from "vitest";
import {
  extractBonbastUsdIrrValue,
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

    expect(extractBonbastUsdIrrValue(html)).toBe("612500");
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

    expect(extractBonbastUsdIrrValue(html)).toBe("602100");
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
  });

  it("discovers and activates the current Bonbast Polymarket market", async () => {
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
            }
          ]
        })
      );

    try {
      const result = await refreshBonbastPolymarketQueue(buildIntegration(), new Date("2026-06-02T00:00:00.000Z"), {
        force: true
      });
      expect(result.activeUrl).toBe("https://polymarket.com/event/will-usd-hit-iranian-rials-by-june-30");
      expect(result.settingsJson).toContain("will-usd-hit-iranian-rials-by-june-30");
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
