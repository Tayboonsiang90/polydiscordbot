import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractEthereumGasMonthlySnapshot,
  extractEthereumGasMonthlySnapshotFromEtherscanCsv,
  extractEthereumGasMonthlyValue,
  extractEthereumGasMonthlyValueFromEtherscanCsv,
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

const sampleEtherscanCsv = `"Date(UTC)","UnixTimeStamp","Value (Wei)"
"4/29/2026","1777420800","1000000000"
"4/30/2026","1777507200","3000000000"
"5/1/2026","1777593600","10000000000"
"5/2/2026","1777680000","20000000000"
"6/1/2026","1780272000","5000000000"`;

describe("Ethereum monthly gas adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

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
    expect(value).toContain("Data source: Dune API");
    expect(value).toContain("Thresholds hit: 10 Gwei");
    expect(value).toContain("Open thresholds: 15 Gwei, 20 Gwei, 25 Gwei, 40 Gwei");
    expect(value).toContain("Resolution: https://dune.com/nibty/eth-gas-prices");
  });

  it("uses Etherscan public CSV as the no-key finalized monthly fallback", () => {
    expect(extractEthereumGasMonthlySnapshotFromEtherscanCsv(sampleEtherscanCsv)).toEqual({
      finalized: { month: "2026-05", meanGasGwei: 15 },
      latestDashboardPoint: { month: "2026-06", meanGasGwei: 5 }
    });

    const value = extractEthereumGasMonthlyValueFromEtherscanCsv(sampleEtherscanCsv);
    expect(value).toContain("Finalized month: 2026-05");
    expect(value).toContain("Finalized mean_gas: 15 Gwei");
    expect(value).toContain("Data source: Etherscan public CSV fallback");
    expect(value).toContain("Calculation note: Fallback calculation averages Etherscan daily average gas-price rows by month");
    expect(value).toContain("Thresholds hit: 10 Gwei, 15 Gwei");
  });

  it("fetches Etherscan instead of Dune when DUNE_API_KEY is absent", async () => {
    vi.stubEnv("DUNE_API_KEY", "");
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(url.toString()).toBe("https://etherscan.io/chart/gasprice?output=csv");
      return {
        ok: true,
        text: async () => sampleEtherscanCsv
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await ethereumGasMonthlyAdapter.fetchCurrentValue();

    expect(result.value).toContain("Data source: Etherscan public CSV fallback");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to Etherscan when a configured Dune key fails", async () => {
    vi.stubEnv("DUNE_API_KEY", "bad-key");
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (url.toString() === "https://api.dune.com/api/v1/query/1887488/results") {
        return { ok: false, status: 401 };
      }
      if (url.toString() === "https://etherscan.io/chart/gasprice?output=csv") {
        return {
          ok: true,
          text: async () => sampleEtherscanCsv
        };
      }
      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await ethereumGasMonthlyAdapter.fetchCurrentValue();

    expect(result.value).toContain("Data source: Etherscan public CSV fallback");
    expect(result.value).toContain("Dune API failed (Dune returned HTTP 401)");
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
