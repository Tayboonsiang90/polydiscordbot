import { describe, expect, it } from "vitest";
import {
  extractFredEggPriceValue,
  extractFredNextReleaseDate,
  getFredEggPricePollIntervalMinutes,
  parseFredEggObservations
} from "../src/integrations/fredEggPrice.js";
import type { Integration } from "../src/integrations/types.js";

const csv = [
  "observation_date,APU0000708111",
  "2026-02-01,5.897",
  "2026-03-01,6.227",
  "2026-04-01,6.500"
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
  it("parses FRED CSV observations", () => {
    expect(parseFredEggObservations(`${csv}\n2026-05-01,.`)).toEqual([
      { date: "2026-02-01", value: "5.897" },
      { date: "2026-03-01", value: "6.227" },
      { date: "2026-04-01", value: "6.500" }
    ]);
  });

  it("extracts the next release date", () => {
    expect(extractFredNextReleaseDate(html)).toBe("May 12, 2026");
  });

  it("formats the April egg price", () => {
    expect(extractFredEggPriceValue(csv, html)).toBe(
      [
        "Series: Eggs, Grade A, Large (Cost per Dozen) in U.S. City Average",
        "Period: 2026-04",
        "Value: $6.500 per dozen",
        "Observation date: 2026-04-01",
        "Next release date: May 12, 2026"
      ].join("\n")
    );
  });

  it("uses one-minute polling on the day before and day of release in ET", () => {
    expect(getFredEggPricePollIntervalMinutes(integration, new Date("2026-05-11T16:00:00.000Z"))).toBe(1);
    expect(getFredEggPricePollIntervalMinutes(integration, new Date("2026-05-12T16:00:00.000Z"))).toBe(1);
    expect(getFredEggPricePollIntervalMinutes(integration, new Date("2026-05-13T16:00:00.000Z"))).toBe(60);
  });
});
