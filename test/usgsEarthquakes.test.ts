import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildUsgsApiUrl,
  extractUsgsEarthquakeCountValue,
  formatUsgsEarthquake,
  refreshEarthquakePolymarketQueue,
  shouldAlertOnUsgsEarthquakeCountChange,
  type UsgsEarthquakeFeature
} from "../src/integrations/usgsEarthquakes.js";
import type { Integration } from "../src/integrations/types.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const feature: UsgsEarthquakeFeature = {
  id: "us7000test",
  properties: {
    mag: 6.2,
    place: "10 km S of Test City",
    time: Date.parse("2026-06-09T12:34:56.000Z"),
    url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000test"
  },
  geometry: {
    coordinates: [120.1, 12.3, 35]
  }
};

describe("USGS earthquakes adapter", () => {
  it("formats the active market count with matching USGS search parameters", () => {
    expect(
      extractUsgsEarthquakeCountValue(
        { metadata: { count: 1 }, features: [feature] },
        "https://polymarket.com/event/how-many-5pt5-or-above-earthquakes-june-8-june-14-20260605212535734"
      )
    ).toBe(
      [
        "Metric: USGS 5.5+ earthquake count",
        "Window ET: 2026-06-08 00:00 to 2026-06-14 23:59",
        "Window UTC: 2026-06-08T04:00:00.000Z to 2026-06-15T03:59:00.000Z",
        "Minimum magnitude: 5.5",
        "Total earthquakes: 1",
        "Events: us7000test: M6.2, 10 km S of Test City, 2026-06-09T12:34:56.000Z",
        "Resolution: https://earthquake.usgs.gov/earthquakes/search/"
      ].join("\n")
    );
  });

  it("returns a stable zero-count value when the market window has no events", () => {
    expect(
      extractUsgsEarthquakeCountValue(
        { metadata: { count: 0 }, features: [] },
        "https://polymarket.com/event/how-many-5pt5-or-above-earthquakes-may-25-may-31"
      )
    ).toBe(
      [
        "Metric: USGS 5.5+ earthquake count",
        "Window ET: 2026-05-25 00:00 to 2026-05-31 23:59",
        "Window UTC: 2026-05-25T04:00:00.000Z to 2026-06-01T03:59:00.000Z",
        "Minimum magnitude: 5.5",
        "Total earthquakes: 0",
        "Events: none",
        "Resolution: https://earthquake.usgs.gov/earthquakes/search/"
      ].join("\n")
    );
  });

  it("rejects non-qualifying magnitudes in the event detail formatter", () => {
    expect(() => formatUsgsEarthquake({ ...feature, properties: { ...feature.properties, mag: 5.4 } })).toThrow(
      "qualifying 5.5+ earthquake"
    );
  });

  it("alerts when the qualifying earthquake count changes in either direction", () => {
    const previous = [
      "Metric: USGS 5.5+ earthquake count",
      "Total earthquakes: 2",
      "Events: us7000spqc: M6, 33 km NW of Valparaiso, Chile, 2026-05-31T21:34:18.009Z"
    ].join("\n");
    const sameCountWithCorrectedTime = [
      "Metric: USGS 5.5+ earthquake count",
      "Total earthquakes: 2",
      "Events: us7000spqc: M6, 33 km NW of Valparaiso, Chile, 2026-05-31T21:34:18.026Z"
    ].join("\n");
    const higherCount = sameCountWithCorrectedTime.replace("Total earthquakes: 2", "Total earthquakes: 3");
    const lowerCount = sameCountWithCorrectedTime.replace("Total earthquakes: 2", "Total earthquakes: 1");

    expect(shouldAlertOnUsgsEarthquakeCountChange(previous, sameCountWithCorrectedTime)).toBe(false);
    expect(shouldAlertOnUsgsEarthquakeCountChange(previous, higherCount)).toBe(true);
    expect(shouldAlertOnUsgsEarthquakeCountChange(previous, lowerCount)).toBe(true);
    expect(shouldAlertOnUsgsEarthquakeCountChange("Event ID: legacy", higherCount)).toBe(false);
  });

  it("uses the market rules UTC window for June 1 through June 7", () => {
    const url = new URL(
      buildUsgsApiUrl("https://polymarket.com/event/how-many-5pt5-or-above-earthquakes-june-1-june-7-20260603201822187")
    );

    expect(url.searchParams.get("starttime")).toBe("2026-06-01T04:00:00.000Z");
    expect(url.searchParams.get("endtime")).toBe("2026-06-08T03:59:00.000Z");
  });

  it("builds a USGS API URL from the active Polymarket date window", () => {
    const url = new URL(
      buildUsgsApiUrl("https://polymarket.com/event/how-many-5pt5-or-above-earthquakes-june-8-june-14-20260605212535734")
    );

    expect(url.searchParams.get("format")).toBe("geojson");
    expect(url.searchParams.get("minmagnitude")).toBe("5.5");
    expect(url.searchParams.get("starttime")).toBe("2026-06-08T04:00:00.000Z");
    expect(url.searchParams.get("endtime")).toBe("2026-06-15T03:59:00.000Z");
    expect(url.searchParams.has("limit")).toBe(false);
  });

  it("tracks the 6.5+ weekly market date window", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ metadata: { count: 2 }, features: [feature] })
      })
    );
    const { usgsSixPointFiveEarthquakesAdapter } = await import("../src/integrations/usgsEarthquakes.js");

    const result = await usgsSixPointFiveEarthquakesAdapter.fetchCurrentValue!({
      polymarketUrl: "https://polymarket.com/event/how-many-6pt5-or-above-earthquakes-june-15-june-21-20260612155039384"
    } as Integration);
    const requestedUrl = new URL(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]));

    expect(requestedUrl.searchParams.get("minmagnitude")).toBe("6.5");
    expect(requestedUrl.searchParams.get("starttime")).toBe("2026-06-15T04:00:00.000Z");
    expect(requestedUrl.searchParams.get("endtime")).toBe("2026-06-22T03:59:00.000Z");
    expect(result.value).toContain("Metric: USGS 6.5+ earthquake count");
    expect(result.value).toContain("Window ET: 2026-06-15 00:00 to 2026-06-21 23:59");
    expect(result.rawValue).toBe("2");
  });

  it("tracks the fixed 7.0+ by-June-30 market rules window", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ metadata: { count: 6 }, features: [feature] })
      })
    );
    const { usgsSevenPlusEarthquakesAdapter } = await import("../src/integrations/usgsEarthquakes.js");

    const result = await usgsSevenPlusEarthquakesAdapter.fetchCurrentValue!({
      polymarketUrl: "https://polymarket.com/event/how-many-7pt0-or-above-earthquakes-by-june-30-higher-strikes"
    } as Integration);
    const requestedUrl = new URL(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]));

    expect(requestedUrl.searchParams.get("minmagnitude")).toBe("7.0");
    expect(requestedUrl.searchParams.get("starttime")).toBe("2025-12-04T17:00:00.000Z");
    expect(requestedUrl.searchParams.get("endtime")).toBe("2026-07-01T03:59:00.000Z");
    expect(result.value).toContain("Metric: USGS 7.0+ earthquake count");
    expect(result.value).toContain("Window ET: 2025-12-04 12:00 to 2026-06-30 23:59");
    expect(result.value).toContain("Minimum magnitude: 7.0");
    expect(result.rawValue).toBe("6");
  });

  it("tracks the separate full-year 2026 7.0+ market rules window", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ metadata: { count: 12 }, features: [feature] })
      })
    );
    const { usgsSevenPlusEarthquakesYearAdapter } = await import("../src/integrations/usgsEarthquakes.js");

    const result = await usgsSevenPlusEarthquakesYearAdapter.fetchCurrentValue!({
      polymarketUrl: "https://polymarket.com/event/how-many-7pt0-or-above-earthquakes-in-2026"
    } as Integration);
    const requestedUrl = new URL(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]));

    expect(requestedUrl.searchParams.get("minmagnitude")).toBe("7.0");
    expect(requestedUrl.searchParams.get("starttime")).toBe("2026-01-01T05:00:00.000Z");
    expect(requestedUrl.searchParams.get("endtime")).toBe("2027-01-01T04:59:00.000Z");
    expect(result.value).toContain("Metric: USGS 7.0+ earthquake count in 2026");
    expect(result.value).toContain("Window ET: 2026-01-01 00:00 to 2026-12-31 23:59");
    expect(result.value).toContain("Minimum magnitude: 7.0");
    expect(result.rawValue).toBe("12");
  });

  it("discovers and queues the next weekly 5.5 earthquake market with a timestamped slug near expiry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "how-many-6pt5-or-above-earthquakes-june-8-june-14-20260605212054030",
              title: "How many 6.5 or above earthquakes June 8 - June 14?",
              active: true,
              closed: false,
              tags: [{ slug: "earthquakes" }]
            },
            {
              slug: "how-many-5pt5-or-above-earthquakes-june-8-june-14-20260605212535734",
              title: "How many 5.5 or above earthquakes June 8 - June 14?",
              active: true,
              closed: false,
              tags: [{ slug: "earthquakes" }]
            }
          ]
        })
      })
    );

    const result = await refreshEarthquakePolymarketQueue(
      {
        settingsJson: JSON.stringify({
          polymarketMarkets: [
            {
              url: "https://polymarket.com/event/how-many-5pt5-or-above-earthquakes-june-1-june-7-20260603201822187",
              slug: "how-many-5pt5-or-above-earthquakes-june-1-june-7-20260603201822187",
              startAt: "2026-06-01T04:00:00.000Z",
              endAt: "2026-06-08T03:59:00.000Z",
              addedAt: "2026-06-01T04:00:00.000Z"
            }
          ]
        }),
        polymarketUrl: "https://polymarket.com/event/how-many-5pt5-or-above-earthquakes-june-1-june-7-20260603201822187"
      } as Integration,
      new Date("2026-06-06T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      lastEarthquakeDiscoveryAt?: string;
      polymarketMarkets?: Array<{ slug: string }>;
    };

    expect(settings.lastEarthquakeDiscoveryAt).toBe("2026-06-06T12:00:00.000Z");
    expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual([
      "how-many-5pt5-or-above-earthquakes-june-1-june-7-20260603201822187",
      "how-many-5pt5-or-above-earthquakes-june-8-june-14-20260605212535734"
    ]);
    expect(result.activeUrl).toBe("https://polymarket.com/event/how-many-5pt5-or-above-earthquakes-june-1-june-7-20260603201822187");
  });

  it("discovers and queues weekly 6.5 earthquake markets separately", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "how-many-5pt5-or-above-earthquakes-june-22-june-28-20260619000000000",
              title: "How many 5.5 or above earthquakes June 22 - June 28?",
              active: true,
              closed: false,
              tags: [{ slug: "earthquakes" }]
            },
            {
              slug: "how-many-6pt5-or-above-earthquakes-june-22-june-28-20260619000000001",
              title: "How many 6.5 or above earthquakes June 22 - June 28?",
              active: true,
              closed: false,
              tags: [{ slug: "earthquakes" }]
            }
          ]
        })
      })
    );
    const { usgsSixPointFiveEarthquakesAdapter } = await import("../src/integrations/usgsEarthquakes.js");

    const settingsJson = await usgsSixPointFiveEarthquakesAdapter.refreshSettings!(
      {
        settingsJson: JSON.stringify({
          polymarketMarkets: [
            {
              url: "https://polymarket.com/event/how-many-6pt5-or-above-earthquakes-june-15-june-21-20260612155039384",
              slug: "how-many-6pt5-or-above-earthquakes-june-15-june-21-20260612155039384",
              startAt: "2026-06-15T04:00:00.000Z",
              endAt: "2026-06-22T03:59:00.000Z",
              addedAt: "2026-06-15T04:00:00.000Z"
            }
          ]
        }),
        polymarketUrl: "https://polymarket.com/event/how-many-6pt5-or-above-earthquakes-june-15-june-21-20260612155039384"
      } as Integration
    );
    const settings = JSON.parse(settingsJson) as {
      lastEarthquake65DiscoveryAt?: string;
      polymarketMarkets?: Array<{ slug: string }>;
    };

    expect(settings.lastEarthquake65DiscoveryAt).toBeTruthy();
    expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual([
      "how-many-6pt5-or-above-earthquakes-june-15-june-21-20260612155039384",
      "how-many-6pt5-or-above-earthquakes-june-22-june-28-20260619000000001"
    ]);
  });
});
