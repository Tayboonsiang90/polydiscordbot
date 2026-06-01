import { describe, expect, it } from "vitest";
import { extractLatestBiJisdorRate, extractLatestBiJisdorValue } from "../src/integrations/biJisdor.js";

const sampleHtml = `
  <table>
    <thead>
      <tr class="table-header">
        <th scope="col" class="text-center">Date</th>
        <th scope="col" class="text-center">Rates</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="text-center">29 May 2026</td>
        <td class="text-center">Rp17,883.00</td>
      </tr>
      <tr>
        <td class="text-center">26 May 2026</td>
        <td class="text-center">Rp17,789.00</td>
      </tr>
    </tbody>
  </table>
`;

describe("Bank Indonesia JISDOR adapter", () => {
  it("extracts the latest USD/IDR JISDOR row", () => {
    expect(extractLatestBiJisdorRate(sampleHtml)).toEqual({
      date: "29 May 2026",
      rate: "17883.00",
      rawRate: "Rp17,883.00"
    });
  });

  it("formats the latest JISDOR row as a stable monitor value", () => {
    expect(extractLatestBiJisdorValue(sampleHtml)).toBe(
      [
        "Metric: Bank Indonesia JISDOR USD/IDR",
        "Date: 29 May 2026",
        "Rate: 17883.00 IDR per USD",
        "Raw rate: Rp17,883.00",
        "Resolution: https://www.bi.go.id/en/statistik/informasi-kurs/jisdor/Default.aspx"
      ].join("\n")
    );
  });

  it("throws when no JISDOR row is present", () => {
    expect(() => extractLatestBiJisdorRate("<html></html>")).toThrow(
      "Could not find the latest Bank Indonesia JISDOR USD/IDR row"
    );
  });
});
