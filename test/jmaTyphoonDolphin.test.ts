import { describe, expect, it } from "vitest";
import {
  classifyDolphinCoordinate,
  formatJmaTyphoonDolphinValue,
  jmaTyphoonDolphinAdapter,
  parseJmaTyphoonDolphinReport,
  shouldAlertOnJmaTyphoonDolphinChange
} from "../src/integrations/jmaTyphoonDolphin.js";

function advisory(overrides: { issue?: string; latitude?: number; longitude?: number; category?: string; location?: string } = {}) {
  return [
    {
      part: "title",
      issue: { UTC: overrides.issue ?? "2026-08-01T03:45:00Z" },
      typhoonNumber: "2613",
      name: { en: "Dolphin" },
      category: { en: "TY" }
    },
    {
      part: { en: "Analysis" },
      advancedHours: 0,
      category: { en: overrides.category ?? "TY" },
      intensity: "Very strong",
      position: { deg: [overrides.latitude ?? 20.5, overrides.longitude ?? 158] },
      location: overrides.location ?? "Near Minamitorishima",
      course: "WNW",
      speed: { "km/h": "20", kt: "10" },
      pressure: "925",
      maximumWind: {
        sustained: { "m/s": "50", kt: "100" },
        gust: { "m/s": "70", kt: "140" }
      },
      validtime: { UTC: "2026-08-01T03:00:00Z" }
    },
    {
      part: { en: "Forecast for 12 hours ahead" },
      advancedHours: 12,
      category: { en: "TY" },
      position: { deg: [21.8, 155.7] },
      validtime: { UTC: "2026-08-01T15:00:00Z" }
    }
  ];
}

describe("JMA Typhoon Dolphin adapter", () => {
  it("parses the official JMA advisory parts", () => {
    const report = parseJmaTyphoonDolphinReport(advisory());

    expect(report).toMatchObject({
      stormName: "Dolphin",
      typhoonNumber: "2613",
      issuedAt: "2026-08-01T03:45:00Z",
      validAt: "2026-08-01T03:00:00Z",
      latitude: 20.5,
      longitude: 158,
      category: "TY",
      sustainedWindKmh: 180,
      sustainedWindKt: 100,
      gustKmh: 252,
      gustKt: 140,
      pressureHpa: 925,
      chinaCoordinateOnLand: false,
      japanCoordinateOnLand: false,
      qualifyingTropicalCyclone: true
    });
    expect(report.forecast).toEqual([
      {
        advancedHours: 12,
        validAt: "2026-08-01T15:00:00Z",
        latitude: 21.8,
        longitude: 155.7,
        category: "TY"
      }
    ]);
  });

  it("formats a human-readable monitoring report", () => {
    const value = formatJmaTyphoonDolphinValue(parseJmaTyphoonDolphinReport(advisory()), null);

    expect(value).toContain("Outcome watch: MONITORING");
    expect(value).toContain("Current center: 20.5");
    expect(value).toContain("JMA location: Near Minamitorishima");
    expect(value).toContain("Current class: TY (Very strong)");
    expect(value).toContain("Sustained winds: 180 km/h / 100 kt");
    expect(value).toContain("Movement: WNW at 20 km/h");
    expect(value).toContain("Coordinate territory: none");
  });

  it("suppresses ordinary advisory changes and alerts once when a rule territory is first satisfied", () => {
    const first = formatJmaTyphoonDolphinValue(parseJmaTyphoonDolphinReport(advisory()), null);
    const revised = formatJmaTyphoonDolphinValue(
      parseJmaTyphoonDolphinReport(advisory({ issue: "2026-08-01T06:45:00Z", latitude: 21.1, longitude: 157.2 })),
      first
    );
    const japanHit = formatJmaTyphoonDolphinValue(
      parseJmaTyphoonDolphinReport(advisory({ issue: "2026-08-01T07:45:00Z", latitude: 35.7, longitude: 139.7 })),
      revised
    );
    const repeatedJapanHit = formatJmaTyphoonDolphinValue(
      parseJmaTyphoonDolphinReport(advisory({ issue: "2026-08-01T08:45:00Z", latitude: 35.7, longitude: 139.7 })),
      japanHit
    );

    expect(shouldAlertOnJmaTyphoonDolphinChange(null, first)).toBe(false);
    expect(shouldAlertOnJmaTyphoonDolphinChange(first, revised)).toBe(false);
    expect(shouldAlertOnJmaTyphoonDolphinChange(revised, japanHit)).toBe(true);
    expect(shouldAlertOnJmaTyphoonDolphinChange(japanHit, repeatedJapanHit)).toBe(false);
  });

  it("classifies China, Hong Kong, Macau, Japan, and Taiwan according to the market boundaries", () => {
    expect(classifyDolphinCoordinate(31.2, 121.5)).toEqual({ china: true, japan: false });
    expect(classifyDolphinCoordinate(22.4, 114.1)).toEqual({ china: true, japan: false });
    expect(classifyDolphinCoordinate(22.2, 113.5)).toEqual({ china: true, japan: false });
    expect(classifyDolphinCoordinate(35.7, 139.7)).toEqual({ china: false, japan: true });
    expect(classifyDolphinCoordinate(26.2, 127.7)).toEqual({ china: false, japan: true });
    expect(classifyDolphinCoordinate(25.0, 121.5)).toEqual({ china: false, japan: false });
    expect(classifyDolphinCoordinate(25.0, 130.0)).toEqual({ china: false, japan: false });
  });

  it("marks a qualifying China coordinate and rejects terminal classifications", () => {
    const chinaValue = formatJmaTyphoonDolphinValue(
      parseJmaTyphoonDolphinReport(advisory({ location: "Shanghai", latitude: 31.2, longitude: 121.5 })),
      null
    );
    const terminalValue = formatJmaTyphoonDolphinValue(
      parseJmaTyphoonDolphinReport(advisory({ category: "EX", location: "East China Sea" })),
      null
    );

    expect(chinaValue).toContain("Outcome watch: \uD83D\uDEA8 RULE SATISFIED");
    expect(chinaValue).toContain("Coordinate territory: China");
    expect(chinaValue).toContain("China rule satisfied now: yes");
    expect(terminalValue).toContain("Outcome watch: NO QUALIFYING CROSSING NOW");
    expect(terminalValue).toContain("Qualifying tropical cyclone class: no");
  });

  it("uses the immediately prior advisory classification for a coastline crossing", () => {
    const tropicalSea = formatJmaTyphoonDolphinValue(parseJmaTyphoonDolphinReport(advisory()), null);
    const extratropicalJapanCrossing = formatJmaTyphoonDolphinValue(
      parseJmaTyphoonDolphinReport(advisory({ category: "EX", latitude: 35.7, longitude: 139.7 })),
      tropicalSea
    );
    const extratropicalSea = formatJmaTyphoonDolphinValue(
      parseJmaTyphoonDolphinReport(advisory({ category: "EX", latitude: 25.0, longitude: 130.0 })),
      null
    );
    const tropicalJapanCrossing = formatJmaTyphoonDolphinValue(
      parseJmaTyphoonDolphinReport(advisory({ category: "TY", latitude: 35.7, longitude: 139.7 })),
      extratropicalSea
    );

    expect(extratropicalJapanCrossing).toContain("Crossing class used: TY (qualifying)");
    expect(extratropicalJapanCrossing).toContain("Japan rule ever satisfied: yes");
    expect(shouldAlertOnJmaTyphoonDolphinChange(tropicalSea, extratropicalJapanCrossing)).toBe(true);
    expect(tropicalJapanCrossing).toContain("Crossing class used: EX (not qualifying)");
    expect(tropicalJapanCrossing).toContain("Japan rule ever satisfied: no");
    expect(shouldAlertOnJmaTyphoonDolphinChange(extratropicalSea, tropicalJapanCrossing)).toBe(false);
  });

  it("defines both active markets and standard Discord monitor metadata", () => {
    expect(jmaTyphoonDolphinAdapter).toMatchObject({
      id: "jma-typhoon-dolphin",
      commandName: "typhoondolphin",
      defaultChannelName: "typhoon-dolphin",
      alertRoleName: "Typhoon Dolphin Alerts",
      alertRoleEmoji: "\uD83C\uDF00",
      suppressMarketRolloverAlerts: true
    });
    const markets = jmaTyphoonDolphinAdapter.defaultSettings?.polymarketMarkets as Array<{ slug: string }>;
    expect(markets.map((market) => market.slug)).toEqual([
      "will-super-typhoon-dolphin-hit-japan-20260730150614391",
      "will-super-typhoon-dolphin-hit-china-20260730202351925"
    ]);
  });
});
