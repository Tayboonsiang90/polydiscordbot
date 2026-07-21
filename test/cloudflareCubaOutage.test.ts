import { describe, expect, it } from "vitest";
import {
  extractCloudflareCubaOutageValue,
  getQualifyingCubaPowerOutages,
  shouldAlertOnCloudflareCubaOutageChange,
  type CloudflareRadarOutageAnnotation,
  type CloudflareRadarOutagesResponse
} from "../src/integrations/cloudflareCubaOutage.js";

const baseResponse: CloudflareRadarOutagesResponse = {
  success: true,
  result: {
    annotations: []
  }
};

describe("Cloudflare Cuba outage adapter", () => {
  it("keeps a stable no-qualifying value when only non-qualifying Cuba outages exist", () => {
    const value = extractCloudflareCubaOutageValue({
      success: true,
      result: {
        annotations: [
          cubaOutage({ id: "regional-power", outageType: "REGIONAL", outageCause: "POWER_OUTAGE" }),
          cubaOutage({ id: "nationwide-cable", outageType: "NATIONWIDE", outageCause: "CABLE_CUT" })
        ]
      }
    });

    expect(value).toContain("Status: No qualifying nationwide power outage found");
    expect(value).toContain("Qualifying outages: 0");
    expect(value).toContain("Qualifying keys: none");
    expect(value).toContain("Recent Cuba outage rows: 2");
  });

  it("qualifies a Cuba nationwide power outage inside the market window", () => {
    const response: CloudflareRadarOutagesResponse = {
      success: true,
      result: {
        annotations: [cubaOutage({ id: "qualifying-1", outageType: "NATIONWIDE", outageCause: "POWER_OUTAGE" })]
      }
    };

    const qualifying = getQualifyingCubaPowerOutages(response);
    const value = extractCloudflareCubaOutageValue(response);

    expect(qualifying).toHaveLength(1);
    expect(value).toContain("QUALIFYING NATIONWIDE POWER OUTAGE FOUND");
    expect(value).toContain("Qualifying deadlines: July 31, August 31, December 31");
    expect(value).toContain("Type: NATIONWIDE");
    expect(value).toContain("Cause: POWER_OUTAGE");
  });

  it("accepts equivalent national and power-failure labels", () => {
    const qualifying = getQualifyingCubaPowerOutages({
      success: true,
      result: {
        annotations: [cubaOutage({ id: "equivalent-labels", outageType: "National", outageCause: "Power failure" })]
      }
    });

    expect(qualifying.map((outage) => outage.id)).toEqual(["equivalent-labels"]);
  });

  it("rejects outages before market creation", () => {
    const qualifying = getQualifyingCubaPowerOutages({
      success: true,
      result: {
        annotations: [
          cubaOutage({
            id: "too-early",
            startDate: "2026-07-20T20:40:00.000Z",
            outageType: "NATIONWIDE",
            outageCause: "POWER_OUTAGE"
          })
        ]
      }
    });

    expect(qualifying).toHaveLength(0);
  });

  it("only alerts when qualifying outage keys change", () => {
    const previous = extractCloudflareCubaOutageValue({
      success: true,
      result: {
        annotations: [cubaOutage({ id: "regional-power", outageType: "REGIONAL", outageCause: "POWER_OUTAGE" })]
      }
    });
    const latestNonQualifyingChanged = extractCloudflareCubaOutageValue({
      success: true,
      result: {
        annotations: [cubaOutage({ id: "different-regional", outageType: "REGIONAL", outageCause: "POWER_OUTAGE" })]
      }
    });
    const qualifyingAdded = extractCloudflareCubaOutageValue({
      success: true,
      result: {
        annotations: [cubaOutage({ id: "qualifying-1", outageType: "NATIONWIDE", outageCause: "POWER_OUTAGE" })]
      }
    });

    expect(shouldAlertOnCloudflareCubaOutageChange(null, qualifyingAdded)).toBe(false);
    expect(shouldAlertOnCloudflareCubaOutageChange(previous, latestNonQualifyingChanged)).toBe(false);
    expect(shouldAlertOnCloudflareCubaOutageChange(previous, qualifyingAdded)).toBe(true);
  });

  it("throws when the API response has no annotations list", () => {
    expect(() => extractCloudflareCubaOutageValue(baseResponse)).not.toThrow();
    expect(() => extractCloudflareCubaOutageValue({ success: true, result: {} })).toThrow("Could not find Cloudflare Radar outage annotations");
  });
});

function cubaOutage(overrides: {
  id: string;
  startDate?: string;
  outageType: string;
  outageCause: string;
}): CloudflareRadarOutageAnnotation {
  return {
    id: overrides.id,
    dataSource: "RADAR",
    startDate: overrides.startDate ?? "2026-07-21T12:00:00.000Z",
    endDate: null,
    eventType: "OUTAGE",
    locations: ["CU"],
    locationsDetails: [{ code: "CU", name: "Cuba" }],
    outage: {
      outageType: overrides.outageType,
      outageCause: overrides.outageCause
    }
  };
}
