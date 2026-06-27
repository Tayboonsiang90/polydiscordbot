import { describe, expect, it } from "vitest";
import {
  extractEthereumGasMonthlySnapshot,
  extractEthereumGasMonthlyValue,
  ethereumGasMonthlyAdapter
} from "../src/integrations/ethereumGasMonthly.js";

const sampleDuneResponse = {
  result: {
    rows: [
      { month: "2026-04-01T00:00:00.000Z", mean_gas: 2.1 },
      { month: "2026-05-01T00:00:00.000Z", mean_gas: "10.2504" },
      { month: "2026-06-01T00:00:00.000Z", mean_gas: 3.5 }
    ]
  }
};

describe("Ethereum monthly gas adapter", () => {
  it("uses the second-latest monthly Dune row as the finalized value", () => {
    expect(extractEthereumGasMonthlySnapshot(sampleDuneResponse)).toEqual({
      finalized: { month: "2026-05", meanGasGwei: 10.2504 },
      latestDashboardPoint: { month: "2026-06", meanGasGwei: 3.5 }
    });
  });

  it("formats finalized mean_gas with threshold context", () => {
    const value = extractEthereumGasMonthlyValue(sampleDuneResponse);

    expect(value).toContain("Metric: Ethereum monthly average gas price");
    expect(value).toContain("Finalized month: 2026-05");
    expect(value).toContain("Finalized mean_gas: 10.25 Gwei");
    expect(value).toContain("Latest dashboard month: 2026-06 (3.5 Gwei; not finalized until next month appears)");
    expect(value).toContain("Thresholds hit: 10 Gwei");
    expect(value).toContain("Open thresholds: 15 Gwei, 20 Gwei, 25 Gwei, 40 Gwei");
    expect(value).toContain("Resolution: https://dune.com/nibty/eth-gas-prices");
  });

  it("throws when the Dune response has no finalized monthly row", () => {
    expect(() => extractEthereumGasMonthlySnapshot({ rows: [{ month: "2026-06-01", mean_gas: 3.5 }] })).toThrow(
      "Could not find at least two Ethereum monthly gas rows"
    );
  });

  it("defines the expected Discord metadata", () => {
    expect(ethereumGasMonthlyAdapter).toMatchObject({
      id: "ethereum-gas-monthly-average",
      commandName: "ethgasmonthly",
      defaultChannelName: "ethgasmonthly",
      alertRoleName: "ETH Gas Monthly Alerts"
    });
  });
});
