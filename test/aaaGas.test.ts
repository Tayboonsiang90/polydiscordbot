import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aaaRegularGasAdapter,
  extractAaaRegularGasCurrentAvg,
  formatAaaRegularGasValue,
  refreshAaaGasPolymarketQueue
} from "../src/integrations/aaaGas.js";
import type { Integration } from "../src/integrations/types.js";

const integration: Integration = {
  id: 1,
  guildId: "guild",
  channelId: "channel",
  adapterId: "aaa-regular-gas",
  displayName: "AAA Regular Gas",
  sourceUrl: "https://gasprices.aaa.com/",
  polymarketUrl: "https://polymarket.com/event/will-gas-hit-by-end-of-may",
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
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z"
};

describe("extractAaaRegularGasCurrentAvg", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("extracts Regular from the Current Avg. table row", () => {
    const html = `
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Regular</th>
            <th>Mid-Grade</th>
            <th>Premium</th>
            <th>Diesel</th>
            <th>E85</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Current Avg.</th>
            <td>$4.483</td>
            <td>$4.967</td>
            <td>$5.341</td>
            <td>$5.659</td>
            <td>$3.627</td>
          </tr>
        </tbody>
      </table>
    `;

    expect(extractAaaRegularGasCurrentAvg(html)).toBe("4.483");
  });

  it("extracts Regular from normalized page text", () => {
    const html = `
      <html>
        <body>
          <h1>National average gas prices</h1>
          Regular Mid-Grade Premium Diesel E85
          Current Avg. $4.483 $4.967 $5.341 $5.659 $3.627
        </body>
      </html>
    `;

    expect(extractAaaRegularGasCurrentAvg(html)).toBe("4.483");
  });

  it("extracts Regular from the headline fallback with a curly apostrophe", () => {
    const html = "<html><body>Today’s AAA National Average $4.483</body></html>";

    expect(extractAaaRegularGasCurrentAvg(html)).toBe("4.483");
  });

  it("throws when no current average is present", () => {
    expect(() => extractAaaRegularGasCurrentAvg("<html><body>No gas price here</body></html>")).toThrow(
      "Could not find AAA Current Avg. Regular gas price"
    );
  });

  it("uses the market-rule first two decimals without rounding", () => {
    expect(formatAaaRegularGasValue("4.098")).toBe(
      [
        "Metric: AAA national regular gas",
        "Market price: $4.09 per gallon (first two decimals; no rounding)",
        "Published price: $4.098 per gallon"
      ].join("\n")
    );
    expect(
      aaaRegularGasAdapter.shouldAlertOnChange?.(
        formatAaaRegularGasValue("4.091"),
        formatAaaRegularGasValue("4.098")
      )
    ).toBe(false);
    expect(aaaRegularGasAdapter.alertOnChangeDuringMarketRollover).toBe(true);
  });

  it("auto-discovers the active end-of-month gas market", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "will-gas-hit-by-end-of-july-20260630204747602",
              title: "Will gas hit $4 by end of July?",
              active: true,
              closed: false,
              tags: []
            }
          ]
        })
      })
    );

    const result = await refreshAaaGasPolymarketQueue(integration, new Date("2026-07-16T12:00:00.000Z"));
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      lastAaaGasDiscoveryAt: string;
      polymarketMarkets: Array<{ slug: string; startAt: string; endAt: string }>;
    };

    expect(result.activeUrl).toBe("https://polymarket.com/event/will-gas-hit-by-end-of-july-20260630204747602");
    expect(settings.lastAaaGasDiscoveryAt).toBe("2026-07-16T12:00:00.000Z");
    expect(settings.polymarketMarkets).toContainEqual(
      expect.objectContaining({
        slug: "will-gas-hit-by-end-of-july-20260630204747602",
        startAt: "2026-07-01T04:00:00.000Z",
        endAt: "2026-08-01T03:59:00.000Z"
      })
    );
    expect(settings.polymarketMarkets).toContainEqual(
      expect.objectContaining({
        slug: "will-gas-hit-by-end-of-august",
        startAt: "2026-08-01T04:00:00.000Z",
        endAt: "2026-09-01T03:59:00.000Z"
      })
    );
  });

  it("seeds the August market even when Gamma discovery is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503
      })
    );

    const result = await refreshAaaGasPolymarketQueue(integration, new Date("2026-07-30T12:00:00.000Z"));
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      polymarketMarkets: Array<{ slug: string; startAt: string; endAt: string }>;
    };

    expect(settings.polymarketMarkets).toContainEqual(
      expect.objectContaining({
        slug: "will-gas-hit-by-end-of-august",
        startAt: "2026-08-01T04:00:00.000Z",
        endAt: "2026-09-01T03:59:00.000Z"
      })
    );
  });
});
