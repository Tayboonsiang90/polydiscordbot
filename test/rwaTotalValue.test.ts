import { Buffer } from "node:buffer";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  decodeRwaCompressedPayload,
  extractLatestRwaTotalValuePoint,
  extractRwaTotalValuePoints,
  formatRwaTotalValue,
  rwaTotalValueAdapter
} from "../src/integrations/rwaTotalValue.js";

const sampleDecodedResponse = {
  results: [
    {
      group: { id: 27, name: "US Treasury Debt" },
      points: [
        ["2026-05-15", 900_000_000],
        ["2026-06-07", 950_000_000],
        ["2026-06-13", 1_000_000_000],
        ["2026-06-14", 1_250_000_000]
      ]
    },
    {
      group: { id: 37, name: "Commodities" },
      points: [
        ["2026-05-15", 400_000_000],
        ["2026-06-07", 550_000_000],
        ["2026-06-13", 500_000_000],
        ["2026-06-14", 600_000_000]
      ]
    },
    {
      group: { id: 36, name: "Real Estate" },
      points: [["2026-06-13", 10_000_000]]
    }
  ]
};

describe("RWA Total Value integration", () => {
  it("sums the latest chart date across asset-class series", () => {
    const point = extractLatestRwaTotalValuePoint(sampleDecodedResponse);

    expect(point).toMatchObject({
      date: "2026-06-14",
      totalValue: 1_850_000_000,
      groups: [
        { name: "US Treasury Debt", value: 1_250_000_000 },
        { name: "Commodities", value: 600_000_000 }
      ]
    });
  });

  it("formats the monitored value with source mode context", () => {
    const points = extractRwaTotalValuePoints(sampleDecodedResponse);
    const value = formatRwaTotalValue(extractLatestRwaTotalValuePoint(sampleDecodedResponse), points);

    expect(value).toContain("Metric: RWA.xyz Total RWA Value");
    expect(value).toContain("Chart date: 2026-06-14");
    expect(value).toContain("Total RWA Value: $1.85B ($1,850,000,000.00)");
    expect(value).toContain("Rate of change:");
    expect(value).toContain("7d: +$350M (+23.33%), +$50M/day vs 2026-06-07");
    expect(value).toContain("30d: +$550M (+42.31%), +$18.33M/day vs 2026-05-15");
    expect(value).toContain("Chart mode: Distributed assets, excluding stablecoins and cryptocurrency");
    expect(value).toContain("Top categories: US Treasury Debt $1.25B; Commodities $600M");
  });

  it("decodes the compressed RWA.xyz tRPC payload wrapper", () => {
    const payload = encodeRwaPayloadForTest(sampleDecodedResponse);

    expect(decodeRwaCompressedPayload(payload)).toEqual(sampleDecodedResponse);
  });

  it("defines the expected Discord metadata", () => {
    expect(rwaTotalValueAdapter).toMatchObject({
      id: "rwa-total-value",
      commandName: "rwatotal",
      defaultChannelName: "rwatotal",
      alertRoleName: "RWA Total Value Alerts"
    });
  });
});

function encodeRwaPayloadForTest(value: unknown): string {
  const reversedJson = Buffer.from(JSON.stringify(value), "utf8").reverse();
  const compressed = gzipSync(reversedJson).toString("base64");
  return `${"x".repeat(20)}${compressed}${"y".repeat(25)}`;
}
