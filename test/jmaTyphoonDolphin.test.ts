import { describe, expect, it } from "vitest";
import {
  formatJmaTyphoonDolphinValue,
  isChineseLandLocation,
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
      name: { jp: "ドルフィン", en: "Dolphin" },
      category: { jp: "台風", en: "TY" }
    },
    {
      part: { jp: "実況", en: "Analysis" },
      advancedHours: 0,
      category: { jp: "台風", en: overrides.category ?? "TY" },
      intensity: "非常に強い",
      position: { deg: [overrides.latitude ?? 20.5, overrides.longitude ?? 158] },
      location: overrides.location ?? "南鳥島近海",
      course: "西北西",
      speed: { "km/h": "20", kt: "10" },
      pressure: "925",
      maximumWind: {
        sustained: { "m/s": "50", kt: "100" },
        gust: { "m/s": "70", kt: "140" }
      },
      validtime: { UTC: "2026-08-01T03:00:00Z" }
    },
    {
      part: { jp: "予報　１２時間後", en: "Forecast for 12 hours ahead" },
      advancedHours: 12,
      category: { jp: "台風", en: "TY" },
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
      location: "南鳥島近海",
      sustainedWindKmh: 180,
      sustainedWindKt: 100,
      gustKmh: 252,
      gustKt: 140,
      pressureHpa: 925
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
    expect(value).toContain("Current center: 20.5°N, 158.0°E");
    expect(value).toContain("JMA location: Near Minamitorishima (南鳥島近海)");
    expect(value).toContain("Current class: TY (Very strong / 非常に強い)");
    expect(value).toContain("Sustained winds: 180 km/h / 100 kt");
    expect(value).toContain("Movement: WNW / 西北西 at 20 km/h");
    expect(value).toContain("Forecast track: +12h 21.8°N, 155.7°E TY");
  });

  it("alerts on every new or revised JMA advisory but not the baseline", () => {
    const first = formatJmaTyphoonDolphinValue(parseJmaTyphoonDolphinReport(advisory()), null);
    const revised = formatJmaTyphoonDolphinValue(
      parseJmaTyphoonDolphinReport(advisory({ issue: "2026-08-01T06:45:00Z", latitude: 21.1, longitude: 157.2 })),
      first
    );

    expect(shouldAlertOnJmaTyphoonDolphinChange(null, first)).toBe(false);
    expect(shouldAlertOnJmaTyphoonDolphinChange(first, first)).toBe(false);
    expect(shouldAlertOnJmaTyphoonDolphinChange(first, revised)).toBe(true);
  });

  it("flags explicit Chinese land labels without treating nearby seas as land", () => {
    expect(isChineseLandLocation("広東省")).toBe(true);
    expect(isChineseLandLocation("Hong Kong")).toBe(true);
    expect(isChineseLandLocation("South China Sea")).toBe(false);
    expect(isChineseLandLocation("東シナ海")).toBe(false);

    const value = formatJmaTyphoonDolphinValue(
      parseJmaTyphoonDolphinReport(advisory({ location: "広東省", latitude: 22.3, longitude: 114.1 })),
      null
    );
    expect(value).toContain("Outcome watch: URGENT REVIEW");
    expect(value).toContain("China-land review ever triggered: yes");
  });

  it("identifies an extratropical terminal classification", () => {
    const value = formatJmaTyphoonDolphinValue(
      parseJmaTyphoonDolphinReport(advisory({ category: "EX", location: "東シナ海" })),
      null
    );

    expect(value).toContain("Outcome watch: POSSIBLE NO");
    expect(value).toContain("Terminal classification: yes");
  });

  it("defines standard Discord monitor metadata", () => {
    expect(jmaTyphoonDolphinAdapter).toMatchObject({
      id: "jma-typhoon-dolphin",
      commandName: "typhoondolphin",
      defaultChannelName: "typhoon-dolphin",
      alertRoleName: "Typhoon Dolphin Alerts",
      alertRoleEmoji: "\uD83C\uDF00"
    });
  });
});
