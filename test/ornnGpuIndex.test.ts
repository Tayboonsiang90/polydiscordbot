import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOrnnGpuApiUrl,
  extractLatestFinalizedOrnnGpuValue,
  normalizeOrnnGpuMarketSearchEvent,
  refreshOrnnGpuPolymarketQueue,
  shouldAlertOnOrnnGpuValueChange,
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
  it("uses the ORNN API's H100 SXM name for H100 requests", () => {
    expect(buildOrnnGpuApiUrl("H100")).toBe(
      "https://ornn-backend-api-135941626504.us-central1.run.app/api/gpu/H100%20SXM/index-history"
    );
    expect(buildOrnnGpuApiUrl("H200")).toBe(
      "https://ornn-backend-api-135941626504.us-central1.run.app/api/gpu/H200/index-history"
    );
  });

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

  it("normalizes July up/down and 2026 GPU rental market shapes", () => {
    const now = new Date("2026-07-11T00:00:00.000Z");
    expect(
      normalizeOrnnGpuMarketSearchEvent(
        {
          slug: "gpu-rental-prices-h200-up-or-down-in-july-20260709173352389",
          title: "GPU rental prices (H200) Up or Down in July?",
          active: true,
          closed: false,
          archived: false,
          startDate: "2026-07-10T14:27:49.414297Z",
          endDate: "2026-07-31T23:59:00Z"
        },
        "H200",
        now
      )
    ).toMatchObject({
      slug: "gpu-rental-prices-h200-up-or-down-in-july-20260709173352389",
      endAt: "2026-07-31T23:59:00.000Z"
    });
    expect(
      normalizeOrnnGpuMarketSearchEvent(
        {
          slug: "gpu-rental-prices-h200-hit-in-2026-20260709171105503",
          title: "GPU rental prices (H200) hit___ in 2026?",
          active: true,
          closed: false,
          archived: false,
          startDate: "2026-07-10T22:35:51.531515Z",
          endDate: "2026-12-31T00:00:00Z"
        },
        "H200",
        now
      )
    ).toMatchObject({
      slug: "gpu-rental-prices-h200-hit-in-2026-20260709171105503",
      endAt: "2026-12-31T00:00:00.000Z"
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

  it("queues multiple concurrent active GPU rental markets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "gpu-rental-prices-h200-end-of-july-20260626215340357",
              title: "GPU rental prices (H200) end of July?",
              active: true,
              closed: false,
              archived: false,
              endDate: "2026-07-31T23:59:00Z",
              startDate: "2026-06-26T21:53:40.000Z"
            },
            {
              slug: "gpu-rental-prices-h200-up-or-down-in-july-20260709173352389",
              title: "GPU rental prices (H200) Up or Down in July?",
              active: true,
              closed: false,
              archived: false,
              endDate: "2026-07-31T23:59:00Z",
              startDate: "2026-07-10T14:27:49.414Z"
            },
            {
              slug: "gpu-rental-prices-h200-hit-in-2026-20260709171105503",
              title: "GPU rental prices (H200) hit___ in 2026?",
              active: true,
              closed: false,
              archived: false,
              endDate: "2026-12-31T00:00:00Z",
              startDate: "2026-07-10T22:35:51.531Z"
            },
            {
              slug: "gpu-rental-prices-h200-end-of-2026-20260709164949059",
              title: "GPU rental prices (H200) end of 2026?",
              active: true,
              closed: false,
              archived: false,
              endDate: "2026-12-31T23:59:00Z",
              startDate: "2026-07-10T14:15:37.832Z"
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
      new Date("2026-07-11T00:00:00.000Z"),
      { force: true }
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      polymarketMarkets?: Array<{ slug: string }>;
    };

    expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual(
      expect.arrayContaining([
        "gpu-rental-prices-h200-end-of-july-20260626215340357",
        "gpu-rental-prices-h200-up-or-down-in-july-20260709173352389",
        "gpu-rental-prices-h200-hit-in-2026-20260709171105503",
        "gpu-rental-prices-h200-end-of-2026-20260709164949059"
      ])
    );
    expect(settings.polymarketMarkets).toHaveLength(4);
  });

  it("shows active markets but ignores market-list-only changes for alerts", () => {
    const data = {
      data: [
        { timestamp: "2026-07-08T20:00:00.000Z", index_value: 2.41 },
        { timestamp: "2026-07-09T20:00:00.000Z", index_value: "2.55" },
        { timestamp: "2026-07-10T20:00:00.000Z", index_value: 2.62 }
      ]
    };
    const base = extractLatestFinalizedOrnnGpuValue(data, "H200");
    const withMarkets = extractLatestFinalizedOrnnGpuValue(data, "H200", [
      {
        url: "https://polymarket.com/event/gpu-rental-prices-h200-up-or-down-in-july-20260709173352389",
        slug: "gpu-rental-prices-h200-up-or-down-in-july-20260709173352389",
        startAt: "2026-07-10T14:27:49.414Z",
        endAt: "2026-07-31T23:59:00.000Z",
        addedAt: "2026-07-11T00:00:00.000Z"
      },
      {
        url: "https://polymarket.com/event/gpu-rental-prices-h200-hit-in-2026-20260709171105503",
        slug: "gpu-rental-prices-h200-hit-in-2026-20260709171105503",
        startAt: "2026-07-10T22:35:51.531Z",
        endAt: "2026-12-31T00:00:00.000Z",
        addedAt: "2026-07-11T00:00:00.000Z"
      }
    ]);

    expect(withMarkets).toContain("Active Polymarket markets:");
    expect(shouldAlertOnOrnnGpuValueChange(base, withMarkets)).toBe(false);
    expect(shouldAlertOnOrnnGpuValueChange(base, withMarkets.replace("Index Value: 2.55", "Index Value: 2.56"))).toBe(true);
  });
});
