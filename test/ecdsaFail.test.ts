import { describe, expect, it } from "vitest";
import { calculateGoogleAheadPercent, extractEcdsaFailValue } from "../src/integrations/ecdsaFail.js";

describe("ECDSA.fail adapter", () => {
  it("calculates the percent ahead of Google's classified circuit", () => {
    expect(calculateGoogleAheadPercent(1_697_398_113)).toBeCloseTo(43.28, 2);
  });

  it("extracts the official challenge benchmark value", () => {
    const value = extractEcdsaFailValue({
      benchmarks: [
        {
          status: "open",
          name: "gpsanant/ecdsafail-test",
          sourceUrl: "https://github.com/ecdsafail/ecadd-challenge-test",
          currentBestScore: 10_753_444_395,
          baselineScore: 10_753_444_395,
          updatedAt: "2026-05-30T07:12:07.659Z"
        },
        {
          status: "open",
          name: "gpsanant/ecdsafail-challenge",
          sourceUrl: "https://github.com/ecdsafail/ecdsafail-challenge",
          currentBestScore: 1_697_398_113,
          currentBestMetrics: { qubits: 1203, toffoli: 1410971 },
          baselineScore: 10_758_874_395,
          baselineMetrics: { qubits: 2715, toffoli: 3962753 },
          updatedAt: "2026-06-12T21:18:53.640Z"
        }
      ]
    });

    expect(value).toContain("Metric: ECDSA.fail quantum benchmark progress");
    expect(value).toContain("Google classified circuit score: 2,992,500,000");
    expect(value).toContain("Current best score: 1,697,398,113");
    expect(value).toContain("Ahead of Google: 43.28%");
    expect(value).toContain("Current best metrics: 1,203 qubits × 1,410,971 Toffoli");
    expect(value).toContain("Benchmark: gpsanant/ecdsafail-challenge");
  });

  it("throws when the official challenge is missing", () => {
    expect(() => extractEcdsaFailValue({ benchmarks: [] })).toThrow("official ECDSA.fail challenge benchmark");
  });
});
