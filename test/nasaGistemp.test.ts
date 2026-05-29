import { describe, expect, it } from "vitest";
import {
  extractNasaGistempObservations,
  extractNasaGistempValue,
  getNasaGistempSettings,
  nasaGistempAdapter,
  nasaGistempShouldAlertOnChange
} from "../src/integrations/nasaGistemp.js";
import type { Integration } from "../src/integrations/types.js";

const sampleTable = `
        GLOBAL Land-Ocean Temperature Index in 0.01 degrees Celsius   base period: 1951-1980

Year   Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec    J-D D-N    DJF  MAM  JJA  SON  Year
2025   138  127  138  124  108  106  102  117  125  119  120  107    119 121    130  123  108  121  2025
2026   108  124  130  118 **** **** **** **** **** **** **** ****   **** ***    113 **** **** ****  2026
`;

describe("NASA GISTEMP adapter", () => {
  it("parses monthly table cells as Celsius anomalies", () => {
    const observations = extractNasaGistempObservations(sampleTable);

    expect(observations).toContainEqual({
      year: 2025,
      month: 6,
      monthName: "Jun",
      tableValue: 106,
      anomalyCelsius: 1.06
    });
    expect(observations).toContainEqual({
      year: 2026,
      month: 4,
      monthName: "Apr",
      tableValue: 118,
      anomalyCelsius: 1.18
    });
    expect(observations.some((observation) => observation.year === 2026 && observation.month === 6)).toBe(false);
  });

  it("formats not-published target month with latest available observation", () => {
    expect(extractNasaGistempValue(sampleTable, { year: 2026, month: 6 })).toBe(
      [
        "Metric: NASA GISTEMP Global Land-Ocean Temperature Index",
        "Period: 2026-06",
        "Value: not published yet",
        "Source cell: row 2026, column Jun",
        "Latest available: 2026-04 = 1.18 °C (table value 118)",
        "Table units: 0.01 °C; displayed value is divided by 100"
      ].join("\n")
    );
  });

  it("formats a published target month", () => {
    expect(extractNasaGistempValue(sampleTable, { year: 2025, month: 6 })).toBe(
      [
        "Metric: NASA GISTEMP Global Land-Ocean Temperature Index",
        "Period: 2025-06",
        "Value: 1.06 °C anomaly",
        "Table value: 106",
        "Source cell: row 2025, column Jun",
        "Table units: 0.01 °C; displayed value is divided by 100"
      ].join("\n")
    );
  });

  it("alerts only when the target month becomes published", () => {
    const previousValue = extractNasaGistempValue(sampleTable, { year: 2026, month: 6 });
    const currentValue = extractNasaGistempValue(sampleTable.replace("118 **** ****", "118 **** 121"), {
      year: 2026,
      month: 6
    });

    expect(nasaGistempShouldAlertOnChange(previousValue, currentValue)).toBe(true);
    expect(nasaGistempShouldAlertOnChange(currentValue, currentValue.replace("1.21", "1.22").replace("121", "122"))).toBe(false);
  });

  it("uses month/year settings and exposes the period command", () => {
    expect(getNasaGistempSettings({ settingsJson: JSON.stringify({ year: 2025, month: 12 }) } as Integration)).toEqual({
      year: 2025,
      month: 12
    });
    expect(nasaGistempAdapter.supportsPeriod).toBe(true);
  });
});
