import { describe, expect, it } from "vitest";
import {
  extractLatestUsgsEarthquakeValue,
  formatUsgsEarthquake,
  type UsgsEarthquakeFeature
} from "../src/integrations/usgsEarthquakes.js";

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
    expect(extractLatestUsgsEarthquakeValue({ features: [] })).toBe(
      "No 5.5+ USGS earthquakes found in the May 4-May 10 market window."
    );
  });

  it("rejects non-qualifying magnitudes", () => {
    expect(() => formatUsgsEarthquake({ ...feature, properties: { ...feature.properties, mag: 5.4 } })).toThrow(
      "qualifying 5.5+ earthquake"
    );
  });
});
