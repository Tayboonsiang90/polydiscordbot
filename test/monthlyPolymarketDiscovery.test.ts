import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshMonthlyPolymarketQueue, type MonthlyPolymarketDiscoveryConfig } from "../src/integrations/monthlyPolymarketDiscovery.js";
import type { Integration } from "../src/integrations/types.js";

const config: MonthlyPolymarketDiscoveryConfig = {
  searchQuery: "precipitation in london",
  slugPrefix: "precipitation-in-london-in-",
  titlePrefix: "Precipitation in London in",
  lastDiscoveryAtKey: "lastLondonPrecipDiscoveryAt",
  requiredTagSlugs: ["precipitation"]
};

const integration = {
  settingsJson: JSON.stringify({ year: 2026, month: 5 }),
  polymarketUrl: "https://polymarket.com/event/precipitation-in-london-in-may"
} as Integration;

describe("monthly Polymarket discovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("queues the next monthly market while preserving the active month", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "precipitation-in-london-in-may",
              title: "Precipitation in London in May?",
              active: true,
              closed: false,
              tags: [{ slug: "precipitation" }]
            },
            {
              slug: "precipitation-in-london-in-june",
              title: "Precipitation in London in June?",
              active: true,
              closed: false,
              tags: [{ slug: "precipitation" }]
            }
          ]
        })
      })
    );

    const result = await refreshMonthlyPolymarketQueue(integration, config, new Date("2026-05-29T12:00:00.000Z"));
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      year: number;
      month: number;
      polymarketMarkets: Array<{ slug: string; startAt: string; endAt: string }>;
    };

    expect(result.activeUrl).toBe("https://polymarket.com/event/precipitation-in-london-in-may");
    expect(settings.year).toBe(2026);
    expect(settings.month).toBe(5);
    expect(settings.polymarketMarkets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "precipitation-in-london-in-june",
          startAt: "2026-06-01T04:00:00.000Z",
          endAt: "2026-07-01T03:59:00.000Z"
        })
      ])
    );
  });

  it("switches settings to the queued month after rollover", async () => {
    const result = await refreshMonthlyPolymarketQueue(
      {
        ...integration,
        settingsJson: JSON.stringify({
          year: 2026,
          month: 5,
          polymarketMarkets: [
            {
              url: "https://polymarket.com/event/precipitation-in-london-in-june",
              slug: "precipitation-in-london-in-june",
              startAt: "2026-06-01T04:00:00.000Z",
              endAt: "2026-07-01T03:59:00.000Z",
              addedAt: "2026-05-29T12:00:00.000Z"
            }
          ]
        })
      } as Integration,
      config,
      new Date("2026-06-01T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as { year: number; month: number };

    expect(result.activeUrl).toBe("https://polymarket.com/event/precipitation-in-london-in-june");
    expect(settings).toMatchObject({ year: 2026, month: 6 });
  });
});
