import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractLatestTeslaDeliveryReleaseFromFilings,
  extractTeslaDeliveryReleaseFromExhibit,
  formatTeslaDeliveryReleaseValue,
  parseTeslaDeliveryMarketWindow,
  refreshTeslaPolymarketQueue
} from "../src/integrations/teslaDeliveries.js";
import type { Integration } from "../src/integrations/types.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Tesla deliveries parsing", () => {
  it("extracts 8-K filing candidates from SEC recent filings", () => {
    const candidates = extractLatestTeslaDeliveryReleaseFromFilings({
      filings: {
        recent: {
          form: ["4", "8-K", "8-K"],
          accessionNumber: ["ignored", "0001628280-26-022956", "0001628280-26-003837"],
          filingDate: ["2026-05-01", "2026-04-02", "2026-01-28"],
          items: ["", "2.02,9.01", "9.01"]
        }
      }
    });

    expect(candidates).toEqual([
      {
        accessionNumber: "0001628280-26-022956",
        accessionPath: "000162828026022956",
        filingDate: "2026-04-02"
      }
    ]);
  });

  it("extracts a Tesla deliveries release from exhibit text", () => {
    const release = extractTeslaDeliveryReleaseFromExhibit(
      `
        <body>
          <div>Tesla First Quarter 2026 Production, Deliveries &amp; Deployments</div>
          <div>Q1 2026 Production Deliveries Subject to operating lease accounting</div>
          <div>Model 3/Y 394,611 341,893 1%</div>
          <div>Other Models 13,775 16,130 2%</div>
          <div>Total 408,386 358,023 1%</div>
        </body>
      `,
      "2026-04-02",
      "https://www.sec.gov/Archives/edgar/data/1318605/000162828026022956/exhibit9911111.htm"
    );

    expect(release).toEqual({
      title: "Tesla First Quarter 2026 Production, Deliveries & Deployments",
      date: "2026-04-02",
      totalDeliveries: "358,023",
      pressUrl: "https://ir.tesla.com/press-release/tesla-first-quarter-2026-production-deliveries-and-deployments",
      filingUrl: "https://www.sec.gov/Archives/edgar/data/1318605/000162828026022956/exhibit9911111.htm"
    });
  });

  it("formats the stable monitor value", () => {
    const value = formatTeslaDeliveryReleaseValue({
      title: "Tesla Second Quarter 2026 Production, Deliveries & Deployments",
      date: "2026-07-02",
      totalDeliveries: "400,000",
      pressUrl: "https://ir.tesla.com/press-release/tesla-second-quarter-2026-production-deliveries-and-deployments",
      filingUrl: "https://www.sec.gov/example"
    });

    expect(value).toContain("Total Deliveries: 400,000");
    expect(value).toContain("Press URL: https://ir.tesla.com/press-release/tesla-second-quarter-2026-production-deliveries-and-deployments");
  });

  it("parses Tesla quarterly market windows", () => {
    expect(
      parseTeslaDeliveryMarketWindow(
        "https://polymarket.com/event/how-many-tesla-deliveries-in-q2-2026",
        undefined,
        new Date("2026-05-29T00:00:00.000Z")
      )
    ).toEqual({
      startAt: "2026-04-01T04:00:00.000Z",
      endAt: "2026-07-01T03:59:00.000Z"
    });
  });

  it("discovers and queues the next Tesla deliveries market near quarter end", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "how-many-tesla-deliveries-in-q1-2026",
              title: "How many Tesla deliveries in Q1 2026?",
              active: true,
              closed: true
            },
            {
              slug: "how-many-tesla-deliveries-in-q3-2026",
              title: "How many Tesla deliveries in Q3 2026?",
              active: true,
              closed: false
            }
          ]
        })
      })
    );

    const result = await refreshTeslaPolymarketQueue(
      {
        settingsJson: JSON.stringify({
          polymarketMarkets: [
            {
              url: "https://polymarket.com/event/how-many-tesla-deliveries-in-q2-2026",
              slug: "how-many-tesla-deliveries-in-q2-2026",
              startAt: "2026-04-01T04:00:00.000Z",
              endAt: "2026-07-01T03:59:00.000Z",
              addedAt: "2026-04-01T04:00:00.000Z"
            }
          ]
        }),
        polymarketUrl: "https://polymarket.com/event/how-many-tesla-deliveries-in-q2-2026"
      } as Integration,
      new Date("2026-06-25T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      lastTeslaDiscoveryAt?: string;
      polymarketMarkets?: Array<{ slug: string }>;
    };

    expect(settings.lastTeslaDiscoveryAt).toBe("2026-06-25T12:00:00.000Z");
    expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual([
      "how-many-tesla-deliveries-in-q2-2026",
      "how-many-tesla-deliveries-in-q3-2026"
    ]);
    expect(result.activeUrl).toBe("https://polymarket.com/event/how-many-tesla-deliveries-in-q2-2026");
  });

  it("discovers and activates the current Tesla deliveries market after the stored quarter expires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "how-many-tesla-deliveries-in-q3-2026",
              title: "How many Tesla deliveries in Q3 2026?",
              active: true,
              closed: false
            }
          ]
        })
      })
    );

    const result = await refreshTeslaPolymarketQueue(
      {
        settingsJson: JSON.stringify({
          polymarketMarkets: [
            {
              url: "https://polymarket.com/event/how-many-tesla-deliveries-in-q2-2026",
              slug: "how-many-tesla-deliveries-in-q2-2026",
              startAt: "2026-04-01T04:00:00.000Z",
              endAt: "2026-07-01T03:59:00.000Z",
              addedAt: "2026-04-01T04:00:00.000Z"
            }
          ]
        }),
        polymarketUrl: "https://polymarket.com/event/how-many-tesla-deliveries-in-q2-2026"
      } as Integration,
      new Date("2026-07-01T12:00:00.000Z")
    );

    expect(result.activeUrl).toBe("https://polymarket.com/event/how-many-tesla-deliveries-in-q3-2026");
  });
});
