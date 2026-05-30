import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeOrnnGpuMarketSearchEvent,
  refreshOrnnGpuPolymarketQueue,
  type OrnnGpuIndexConfig
} from "../src/integrations/ornnGpuIndex.js";
import type { Integration } from "../src/integrations/types.js";

const h200Config: OrnnGpuIndexConfig = {
  id: "ornn-h200-index",
  commandName: "ornnh200",
  displayName: "ORNN H200 Index",
  gpuName: "H200",
  defaultPolymarketUrl: "https://polymarket.com/event/gpu-rental-prices-h200-hit-by-may-31",
  defaultChannelName: "ornnh200",
  alertRoleName: "ORNN H200 Alerts"
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ORNN GPU Polymarket discovery", () => {
  it("normalizes matching GPU rental markets from Gamma search", () => {
    expect(
      normalizeOrnnGpuMarketSearchEvent(
        {
          slug: "gpu-rental-prices-h200-end-of-june",
          title: "GPU rental prices (H200) end of June?",
          active: true,
          closed: false,
          endDate: "2026-06-30T00:00:00Z",
          startDate: "2026-05-29T15:31:26.000Z"
        },
        "H200",
        new Date("2026-05-30T00:00:00.000Z")
      )
    ).toMatchObject({
      slug: "gpu-rental-prices-h200-end-of-june",
      url: "https://polymarket.com/event/gpu-rental-prices-h200-end-of-june",
      startAt: "2026-05-29T15:31:26.000Z",
      endAt: "2026-06-30T00:00:00.000Z"
    });
  });

  it("rejects a different GPU series", () => {
    expect(
      normalizeOrnnGpuMarketSearchEvent(
        {
          slug: "gpu-rental-prices-b200-end-of-june",
          title: "GPU rental prices (B200) end of June?",
          active: true,
          closed: false,
          endDate: "2026-06-30T00:00:00Z"
        },
        "H200",
        new Date("2026-05-30T00:00:00.000Z")
      )
    ).toBeNull();
  });

  it("discovers and queues current and next GPU rental markets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "gpu-rental-prices-h200-end-of-june",
              title: "GPU rental prices (H200) end of June?",
              active: true,
              closed: false,
              endDate: "2026-06-30T00:00:00Z",
              startDate: "2026-05-29T15:31:26.000Z"
            },
            {
              slug: "gpu-rental-prices-h200-hit-by-may-31",
              title: "GPU rental prices (H200) hit___ by May 31?",
              active: true,
              closed: false,
              endDate: "2026-05-31T00:00:00Z",
              startDate: "2026-05-14T23:46:54.000Z"
            }
          ]
        })
      })
    );

    const result = await refreshOrnnGpuPolymarketQueue(
      {
        settingsJson: null,
        polymarketUrl: h200Config.defaultPolymarketUrl
      } as Integration,
      h200Config,
      new Date("2026-05-30T00:00:00.000Z"),
      { force: true }
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      polymarketMarkets?: Array<{ slug: string; endAt: string }>;
    };

    expect(result.activeUrl).toBe("https://polymarket.com/event/gpu-rental-prices-h200-hit-by-may-31");
    expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual([
      "gpu-rental-prices-h200-hit-by-may-31",
      "gpu-rental-prices-h200-end-of-june"
    ]);
  });
});
