import { describe, expect, it } from "vitest";
import { extractMarineTrafficAlphaSnapshot, formatMarineTrafficAlphaSnapshot } from "../src/integrations/marineTrafficAlpha.js";

describe("MarineTraffic alpha helper", () => {
  it("summarizes unique vessels from MarineTraffic DATA payloads", () => {
    const snapshot = extractMarineTrafficAlphaSnapshot(
      {
        DATA: [
          {
            SHIP_ID: "1",
            MMSI: "111",
            SHIPNAME: "ALPHA",
            AIS_TYPE_SUMMARY: "Tanker",
            TIMESTAMP: "2026-06-25T01:00:00.000Z"
          },
          {
            SHIP_ID: "1",
            MMSI: "111",
            SHIPNAME: "ALPHA DUPLICATE",
            AIS_TYPE_SUMMARY: "Tanker",
            TIMESTAMP: "2026-06-25T01:01:00.000Z"
          },
          {
            SHIP_ID: 2,
            MMSI: "222",
            SHIPNAME: "BRAVO",
            AIS_TYPE_SUMMARY: "Cargo",
            TIMESTAMP: "2026-06-25T01:02:00.000Z"
          }
        ]
      },
      "Strait of Hormuz",
      "https://services.marinetraffic.com/api/exportvessels-custom-area/example"
    );

    expect(snapshot).toEqual({
      areaLabel: "Strait of Hormuz",
      sourceUrl: "https://services.marinetraffic.com/api/exportvessels-custom-area/example",
      vesselCount: 2,
      latestTimestamp: "2026-06-25T01:02:00.000Z",
      typeSummary: "Cargo 1; Tanker 1",
      sampleVessels: "ALPHA; BRAVO"
    });
  });

  it("formats no lines when alpha is not configured", () => {
    expect(formatMarineTrafficAlphaSnapshot(null)).toEqual([]);
  });
});
