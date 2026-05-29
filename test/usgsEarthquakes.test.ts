import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildUsgsApiUrl,
  extractLatestUsgsEarthquakeValue,
  formatUsgsEarthquake,
  refreshEarthquakePolymarketQueue,
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
    time: Date.parse("2026-05-07T12:34:56.000Z"),
    url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000test"
  },
  geometry: {
    coordinates: [120.1, 12.3, 35]
  }
};

describe("USGS earthquakes adapter", () => {
  it("formats the latest qualifying 5.5+ earthquake", () => {
    expect(extractLatestUsgsEarthquakeValue({ features: [feature] })).toBe(
      [
        "Event ID: us7000test",
        "Magnitude: 6.2",
        "Location: 10 km S of Test City",
        "Time: 2026-05-07T12:34:56.000Z",
        "Depth: 35 km",
        "USGS: https://earthquake.usgs.gov/earthquakes/eventpage/us7000test"
      ].join("\n")
    );
  });

  it("returns a stable no-event value when the market window has no events", () => {
    expect(
      extractLatestUsgsEarthquakeValue(
        { features: [] },
        "https://polymarket.com/event/how-many-5pt5-or-above-earthquakes-may-25-may-31"
      )
    ).toBe(
      "No 5.5+ USGS earthquakes found in the 2026-05-25 to 2026-05-31 market window."
    );
  });

  it("rejects non-qualifying magnitudes", () => {
    expect(() => formatUsgsEarthquake({ ...feature, properties: { ...feature.properties, mag: 5.4 } })).toThrow(
      "qualifying 5.5+ earthquake"
    );
  });

  it("builds a USGS API URL from the active Polymarket date window", () => {
    const url = new URL(buildUsgsApiUrl("https://polymarket.com/event/how-many-5pt5-or-above-earthquakes-may-25-may-31"));

    expect(url.searchParams.get("minmagnitude")).toBe("5.5");
    expect(url.searchParams.get("starttime")).toBe("2026-05-25T04:00:00.000Z");
    expect(url.searchParams.get("endtime")).toBe("2026-06-01T03:59:00.000Z");
  });

  it("discovers and queues the next weekly 5.5 earthquake market near expiry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "how-many-6pt5-or-above-earthquakes-may-25-may-31",
              title: "How many 6.5 or above earthquakes May 25 - May 31?",
              active: true,
              closed: false,
              tags: [{ slug: "earthquakes" }]
            },
            {
              slug: "how-many-5pt5-or-above-earthquakes-may-25-may-31",
              title: "How many 5.5 or above earthquakes May 25 - May 31?",
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
              url: "https://polymarket.com/event/how-many-5pt5-or-above-earthquakes-may-18-may-24",
              slug: "how-many-5pt5-or-above-earthquakes-may-18-may-24",
              startAt: "2026-05-18T04:00:00.000Z",
              endAt: "2026-05-25T03:59:00.000Z",
              addedAt: "2026-05-18T04:00:00.000Z"
            }
          ]
        }),
        polymarketUrl: "https://polymarket.com/event/how-many-5pt5-or-above-earthquakes-may-18-may-24"
      } as Integration,
      new Date("2026-05-23T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      lastEarthquakeDiscoveryAt?: string;
      polymarketMarkets?: Array<{ slug: string }>;
    };

    expect(settings.lastEarthquakeDiscoveryAt).toBe("2026-05-23T12:00:00.000Z");
    expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual([
      "how-many-5pt5-or-above-earthquakes-may-18-may-24",
      "how-many-5pt5-or-above-earthquakes-may-25-may-31"
    ]);
    expect(result.activeUrl).toBe("https://polymarket.com/event/how-many-5pt5-or-above-earthquakes-may-18-may-24");
  });
});
