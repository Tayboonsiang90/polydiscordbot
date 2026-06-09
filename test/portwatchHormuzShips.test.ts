import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractPortwatchHormuzValue,
  formatPortwatchHormuzValue,
  normalizeHormuzSearchEvent,
  normalizePortwatchHormuzRows,
  refreshHormuzShipsPolymarketQueue
} from "../src/integrations/portwatchHormuzShips.js";
import type { Integration } from "../src/integrations/types.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const rows = normalizePortwatchHormuzRows({
  features: [
    {
      attributes: {
        date: "2026-06-01",
        portid: "chokepoint6",
        portname: "Strait of Hormuz",
        n_container: 1,
        n_dry_bulk: 2,
        n_general_cargo: 1,
        n_roro: 0,
        n_tanker: 1,
        n_total: 5,
        ObjectId: 17884
      }
    },
    {
      attributes: {
        date: "2026-06-02",
        portid: "chokepoint6",
        portname: "Strait of Hormuz",
        n_container: 1,
        n_dry_bulk: 3,
        n_general_cargo: 1,
        n_roro: 1,
        n_tanker: 4,
        n_total: 10,
        ObjectId: 17885
      }
    },
    {
      attributes: {
        date: "2026-06-02",
        portid: "chokepoint28",
        portname: "Kerch Strait",
        n_total: 99,
        ObjectId: 1
      }
    }
  ]
});

describe("IMF Portwatch Hormuz ships adapter", () => {
  it("normalizes only Strait of Hormuz daily rows", () => {
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: "2026-06-01", n_total: 5, n_tanker: 1 });
    expect(rows[1]).toMatchObject({ date: "2026-06-02", n_total: 10, n_roro: 1 });
  });

  it("formats total and average transit calls for the active weekly window", () => {
    expect(formatPortwatchHormuzValue(rows, "2026-06-01", "2026-06-07")).toContain(
      [
        "Status: partial",
        "Reported days: 2/7",
        "Total transit calls: 15",
        "Average daily calls: 7.5",
        "Latest data date: 2026-06-02"
      ].join("\n")
    );
  });

  it("parses week-of Polymarket URLs into the correct seven-day value window", () => {
    expect(
      extractPortwatchHormuzValue(
        rows,
        "https://polymarket.com/event/how-many-ships-transit-the-strait-of-hormuz-week-of-june-1",
        new Date("2026-06-03T00:00:00.000Z")
      )
    ).toContain("Window: 2026-06-01 to 2026-06-07");
  });

  it("normalizes active weekly Hormuz market search events", () => {
    expect(
      normalizeHormuzSearchEvent(
        {
          slug: "how-many-ships-transit-the-strait-of-hormuz-week-of-june-8",
          title: "How many ships transit the Strait of Hormuz week of June 8?",
          active: true,
          closed: false
        },
        new Date("2026-06-03T00:00:00.000Z")
      )
    ).toEqual({
      slug: "how-many-ships-transit-the-strait-of-hormuz-week-of-june-8",
      url: "https://polymarket.com/event/how-many-ships-transit-the-strait-of-hormuz-week-of-june-8"
    });
  });

  it("discovers and queues the next weekly Hormuz ships market near expiry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "how-many-ships-transit-the-strait-of-hormuz-week-of-june-8",
              title: "How many ships transit the Strait of Hormuz week of June 8?",
              active: true,
              closed: false
            }
          ]
        })
      })
    );

    const result = await refreshHormuzShipsPolymarketQueue(
      {
        settingsJson: JSON.stringify({
          polymarketMarkets: [
            {
              url: "https://polymarket.com/event/how-many-ships-transit-the-strait-of-hormuz-week-of-june-1",
              slug: "how-many-ships-transit-the-strait-of-hormuz-week-of-june-1",
              startAt: "2026-06-01T04:00:00.000Z",
              endAt: "2026-06-08T03:59:00.000Z",
              addedAt: "2026-06-01T04:00:00.000Z"
            }
          ]
        }),
        polymarketUrl: "https://polymarket.com/event/how-many-ships-transit-the-strait-of-hormuz-week-of-june-1"
      } as Integration,
      new Date("2026-06-06T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      lastHormuzShipsDiscoveryAt?: string;
      polymarketMarkets?: Array<{ slug: string }>;
    };

    expect(settings.lastHormuzShipsDiscoveryAt).toBe("2026-06-06T12:00:00.000Z");
    expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual([
      "how-many-ships-transit-the-strait-of-hormuz-week-of-june-1",
      "how-many-ships-transit-the-strait-of-hormuz-week-of-june-8"
    ]);
    expect(result.activeUrl).toBe("https://polymarket.com/event/how-many-ships-transit-the-strait-of-hormuz-week-of-june-1");
  });
});
