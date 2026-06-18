import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractFredEggPriceValue,
  extractFredNextReleaseDate,
  fredEggPriceAdapter,
  getFredEggPricePollIntervalMinutes,
  getFredEggPriceSettings,
  parseFredEggObservations,
  refreshFredEggPricePolymarketQueue
} from "../src/integrations/fredEggPrice.js";
import type { Integration } from "../src/integrations/types.js";

const csv = [
  "observation_date,APU0000708111",
  "2026-02-01,5.897",
  "2026-03-01,6.227",
  "2026-04-01,6.500",
  "2026-06-01,4.321"
].join("\n");

const html = `
  <html>
    <body>
      <div>Next Release Date: May 12, 2026</div>
    </body>
  </html>
`;

const integration = {
  adapterId: "fred-egg-price",
  pollIntervalMinutes: 5,
  lastValue: "Next release date: May 12, 2026"
} as Integration;

describe("FRED egg price adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("parses FRED CSV observations", () => {
    expect(parseFredEggObservations(`${csv}\n2026-05-01,.`)).toEqual([
      { date: "2026-02-01", value: "5.897" },
      { date: "2026-03-01", value: "6.227" },
      { date: "2026-04-01", value: "6.500" },
      { date: "2026-06-01", value: "4.321" }
    ]);
  });

  it("extracts the next release date", () => {
    expect(extractFredNextReleaseDate(html)).toBe("May 12, 2026");
  });

  it("formats the April egg price", () => {
    expect(extractFredEggPriceValue(csv, html, { year: 2026, month: 4 })).toBe(
      [
        "Series: Eggs, Grade A, Large (Cost per Dozen) in U.S. City Average",
        "Period: 2026-04",
        "Value: $6.500 per dozen",
        "Observation date: 2026-04-01",
        "Next release date: May 12, 2026"
      ].join("\n")
    );
  });

  it("formats the configured monthly egg price period", () => {
    expect(extractFredEggPriceValue(csv, html, { year: 2026, month: 6 })).toContain("Period: 2026-06\nValue: $4.321 per dozen");
  });

  it("reads configured year and month settings", () => {
    expect(getFredEggPriceSettings({ settingsJson: JSON.stringify({ year: 2026, month: 6 }) } as Integration)).toEqual({
      year: 2026,
      month: 6
    });
  });

  it("uses one-minute polling on the day before and day of release in ET", () => {
    expect(getFredEggPricePollIntervalMinutes(integration, new Date("2026-05-11T16:00:00.000Z"))).toBe(1);
    expect(getFredEggPricePollIntervalMinutes(integration, new Date("2026-05-12T16:00:00.000Z"))).toBe(1);
    expect(getFredEggPricePollIntervalMinutes(integration, new Date("2026-05-13T16:00:00.000Z"))).toBe(60);
  });

  it("discovers and activates the current monthly egg Polymarket URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "price-of-dozen-eggs-in-june-20260615183505948",
              title: "Price of Dozen Eggs in June",
              active: true,
              closed: false
            }
          ]
        })
      })
    );

    const result = await refreshFredEggPricePolymarketQueue(
      {
        settingsJson: null,
        polymarketUrl: "https://polymarket.com/event/price-of-dozen-eggs-in-april-799"
      } as Integration,
      new Date("2026-06-16T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      year?: number;
      month?: number;
      polymarketMarkets?: Array<{ slug: string }>;
    };

    expect(result.activeUrl).toBe("https://polymarket.com/event/price-of-dozen-eggs-in-june-20260615183505948");
    expect(settings.year).toBe(2026);
    expect(settings.month).toBe(6);
    expect(settings.polymarketMarkets).toEqual([
      expect.objectContaining({ slug: "price-of-dozen-eggs-in-june-20260615183505948" })
    ]);
  });

  it("refetches once if a FRED response body was already consumed", async () => {
    let csvFetches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("fredgraph.csv")) {
          csvFetches += 1;
          return {
            ok: true,
            status: 200,
            text: async () => {
              if (csvFetches === 1) {
                throw new TypeError("Body is unusable: Body has already been read");
              }
              return csv;
            }
          };
        }

        return {
          ok: true,
          status: 200,
          text: async () => html
        };
      })
    );

    const result = await fredEggPriceAdapter.fetchCurrentValue({ settingsJson: JSON.stringify({ year: 2026, month: 4 }) } as Integration);

    expect(result.value).toContain("Value: $6.500 per dozen");
    expect(csvFetches).toBe(2);
  });

  it("exposes monthly period and discovery hooks", () => {
    expect(fredEggPriceAdapter.supportsPeriod).toBe(true);
    expect(fredEggPriceAdapter.refreshSettings).toBeDefined();
  });
});
