import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractTsaPassengerValue,
  extractTsaPassengerVolumes,
  formatTsaPassengerRangeValue,
  parsePolymarketTsaDateRange,
  refreshTsaPolymarketQueue
} from "../src/integrations/tsaPassengers.js";
import type { Integration } from "../src/integrations/types.js";

const html = `
  <table>
    <tbody>
      <tr><td>5/6/2026</td><td>2,251,410</td></tr>
      <tr><td>5/5/2026</td><td>2,040,845</td></tr>
      <tr><td>5/4/2026</td><td>2,540,806</td></tr>
    </tbody>
  </table>
`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TSA passengers adapter", () => {
  it("parses TSA passenger volume table rows", () => {
    expect(extractTsaPassengerVolumes(html)).toEqual([
      { date: "2026-05-06", passengers: 2251410 },
      { date: "2026-05-05", passengers: 2040845 },
      { date: "2026-05-04", passengers: 2540806 }
    ]);
  });

  it("parses the market date range from the Polymarket slug", () => {
    expect(
      parsePolymarketTsaDateRange(
        "https://polymarket.com/event/number-of-tsa-passengers-may-4-may-10",
        new Date("2026-05-07T00:00:00.000Z")
      )
    ).toEqual({ startDate: "2026-05-04", endDate: "2026-05-10" });
  });

  it("parses same-month shorthand date ranges", () => {
    expect(
      parsePolymarketTsaDateRange(
        "https://polymarket.com/event/number-of-tsa-passengers-june-1-7",
        new Date("2026-06-02T00:00:00.000Z")
      )
    ).toEqual({ startDate: "2026-06-01", endDate: "2026-06-07" });
  });

  it("formats partial range sums with missing dates", () => {
    expect(
      formatTsaPassengerRangeValue(extractTsaPassengerVolumes(html), { startDate: "2026-05-04", endDate: "2026-05-06" })
    ).toBe(
      [
        "Metric: TSA daily checkpoint throughput sum",
        "Latest source day: 2026-05-06",
        "Latest daily throughput: 2,251,410",
        "Market window: 2026-05-04 to 2026-05-06",
        "Market status: complete",
        "Window reported days: 3/3",
        "Window total: 6,833,061",
        "Missing window dates: none",
        "Window daily values: 2026-05-04: 2,540,806 | 2026-05-05: 2,040,845 | 2026-05-06: 2,251,410"
      ].join("\n")
    );
  });

  it("formats the current market range from TSA HTML and Polymarket URL", () => {
    expect(
      extractTsaPassengerValue(
        html,
        "https://polymarket.com/event/number-of-tsa-passengers-may-4-may-10",
        new Date("2026-05-07T00:00:00.000Z")
      )
    ).toContain("Missing window dates: 2026-05-07, 2026-05-08, 2026-05-09, 2026-05-10");
  });

  it("discovers and queues the next TSA market when the active week is near expiry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "number-of-tsa-passengers-january-2",
              title: "Number of TSA passengers January 2?",
              active: true,
              closed: true,
              tags: [{ slug: "tsa" }]
            },
            {
              slug: "number-of-tsa-passengers-may-18-may-24",
              title: "Number of TSA passengers May 18 - May 24?",
              active: true,
              closed: false,
              tags: [{ slug: "tsa" }, { slug: "travel" }]
            }
          ]
        })
      })
    );

    const result = await refreshTsaPolymarketQueue(
      {
        settingsJson: JSON.stringify({
          polymarketMarkets: [
            {
              url: "https://polymarket.com/event/number-of-tsa-passengers-may-11-may-17",
              slug: "number-of-tsa-passengers-may-11-may-17",
              startAt: "2026-05-11T04:00:00.000Z",
              endAt: "2026-05-18T03:59:00.000Z",
              addedAt: "2026-05-11T04:00:00.000Z"
            }
          ]
        }),
        polymarketUrl: "https://polymarket.com/event/number-of-tsa-passengers-may-11-may-17"
      } as Integration,
      new Date("2026-05-16T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      lastTsaDiscoveryAt?: string;
      polymarketMarkets?: Array<{ slug: string; url: string }>;
    };

    expect(settings.lastTsaDiscoveryAt).toBe("2026-05-16T12:00:00.000Z");
    expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual([
      "number-of-tsa-passengers-may-11-may-17",
      "number-of-tsa-passengers-may-18-may-24"
    ]);
    expect(result.activeUrl).toBe("https://polymarket.com/event/number-of-tsa-passengers-may-11-may-17");
  });

  it("discovers and activates the current TSA market after the stored week expires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "number-of-tsa-passengers-may-18-may-24",
              title: "Number of TSA passengers May 18 - May 24?",
              active: true,
              closed: false,
              tags: [{ slug: "tsa" }]
            }
          ]
        })
      })
    );

    const result = await refreshTsaPolymarketQueue(
      {
        settingsJson: JSON.stringify({
          polymarketMarkets: [
            {
              url: "https://polymarket.com/event/number-of-tsa-passengers-may-11-may-17",
              slug: "number-of-tsa-passengers-may-11-may-17",
              startAt: "2026-05-11T04:00:00.000Z",
              endAt: "2026-05-18T03:59:00.000Z",
              addedAt: "2026-05-11T04:00:00.000Z"
            }
          ]
        }),
        polymarketUrl: "https://polymarket.com/event/number-of-tsa-passengers-may-11-may-17"
      } as Integration,
      new Date("2026-05-18T12:00:00.000Z")
    );

    expect(result.activeUrl).toBe("https://polymarket.com/event/number-of-tsa-passengers-may-18-may-24");
  });
});
