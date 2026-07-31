import { afterEach, describe, expect, it, vi } from "vitest";
import {
  refreshGammaPolymarketQueue,
  upsertGammaPolymarketQueueUrl,
  type GammaPolymarketDiscoveryConfig
} from "../src/integrations/gammaPolymarketDiscovery.js";
import type { Integration } from "../src/integrations/types.js";

const config: GammaPolymarketDiscoveryConfig = {
  searchQuery: "example market",
  slugPrefixes: ["example-market-"],
  titlePrefixes: ["Example market"],
  lastDiscoveryAtKey: "lastExampleDiscoveryAt"
};

const integration = {
  settingsJson: null,
  polymarketUrl: "https://polymarket.com/event/example-market-old"
} as Integration;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Gamma Polymarket discovery helper", () => {
  it("uses Gamma start and end timestamps instead of guessing from the slug", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [{
          slug: "example-market-september-30",
          title: "Example market September 30",
          active: true,
          closed: false,
          startDate: "2026-06-30T12:00:00.000Z",
          endDate: "2026-10-01T03:59:00.000Z"
        }]
      })
    }));

    const result = await refreshGammaPolymarketQueue(integration, config, new Date("2026-07-31T00:00:00.000Z"));
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      polymarketMarkets?: Array<{ slug: string; startAt: string; endAt: string }>;
    };

    expect(result.activeUrl).toBe("https://polymarket.com/event/example-market-september-30");
    expect(settings.polymarketMarkets).toEqual([{
      url: "https://polymarket.com/event/example-market-september-30",
      slug: "example-market-september-30",
      startAt: "2026-06-30T12:00:00.000Z",
      endAt: "2026-10-01T03:59:00.000Z",
      addedAt: "2026-07-31T00:00:00.000Z"
    }]);
  });

  it("enriches a manually supplied URL with exact Gamma timestamps", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{
        slug: "example-market-september-30",
        title: "Example market September 30",
        active: true,
        closed: false,
        creationDate: "2026-06-30T12:00:00.000Z",
        endDate: "2026-10-01T03:59:00.000Z"
      }]
    }));

    const result = await upsertGammaPolymarketQueueUrl(
      integration,
      "https://polymarket.com/event/example-market-september-30",
      config,
      new Date("2026-07-31T00:00:00.000Z")
    );

    expect(result.activeUrl).toBe("https://polymarket.com/event/example-market-september-30");
    expect(JSON.parse(result.settingsJson ?? "{}").polymarketMarkets[0]).toMatchObject({
      startAt: "2026-06-30T12:00:00.000Z",
      endAt: "2026-10-01T03:59:00.000Z"
    });
  });
});
