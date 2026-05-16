import { describe, expect, it } from "vitest";
import {
  extractFredGroundBeefNextReleaseDate,
  extractFredGroundBeefValue,
  getFredGroundBeefPollIntervalMinutes,
  parseFredGroundBeefObservations
} from "../src/integrations/fredGroundBeef.js";
import type { Integration } from "../src/integrations/types.js";

const csv = [
  "observation_date,APU0000703112",
  "2025-12-01,5.812",
  "2026-01-01,5.921",
  "2026-02-01,6.044"
].join("\n");

const html = `
  <html>
    <body>
      <div>Next Release Date: May 12, 2026</div>
    </body>
  </html>
`;

const integration = {
  adapterId: "fred-ground-beef",
  pollIntervalMinutes: 5,
  lastValue: "Next release date: May 12, 2026"
} as Integration;

describe("FRED ground beef adapter", () => {
  it("parses FRED CSV observations", () => {
    expect(parseFredGroundBeefObservations(`${csv}\n2026-03-01,.`)).toEqual([
      { date: "2025-12-01", value: "5.812" },
      { date: "2026-01-01", value: "5.921" },
      { date: "2026-02-01", value: "6.044" }
    ]);
  });

  it("extracts the next release date", () => {
    expect(extractFredGroundBeefNextReleaseDate(html)).toBe("May 12, 2026");
  });

  it("formats the latest 2026 ground beef price", () => {
    expect(extractFredGroundBeefValue(csv, html)).toBe(
      [
        "Series: Ground beef, 100% beef (Cost per Pound) in U.S. City Average",
        "Year: 2026",
        "Latest 2026 period: 2026-02",
        "Value: $6.044 per pound",
        "Observation date: 2026-02-01",
        "Next release date: May 12, 2026"
      ].join("\n")
    );
  });

  it("uses one-minute polling on the day before and day of release in ET", () => {
    expect(getFredGroundBeefPollIntervalMinutes(integration, new Date("2026-05-11T16:00:00.000Z"))).toBe(1);
    expect(getFredGroundBeefPollIntervalMinutes(integration, new Date("2026-05-12T16:00:00.000Z"))).toBe(1);
    expect(getFredGroundBeefPollIntervalMinutes(integration, new Date("2026-05-13T16:00:00.000Z"))).toBe(60);
  });
});
