import { describe, expect, it } from "vitest";
import {
  advanceLastScannedBlock,
  formatEthGetLogsBackfillMode,
  getEthGetLogsChunkBlocks,
  isAlchemyRpcUrl,
  planEthGetLogsScan
} from "../src/rpcProviders.js";

describe("RPC provider helpers", () => {
  it("caps eth_getLogs chunks for Alchemy Free tier endpoints", () => {
    expect(getEthGetLogsChunkBlocks("https://polygon-mainnet.g.alchemy.com/v2/key", 100)).toBe(10);
    expect(getEthGetLogsChunkBlocks("wss://polygon-mainnet.g.alchemy.com/v2/key", 100)).toBe(10);
    expect(isAlchemyRpcUrl("https://polygon-mainnet.g.alchemy.com/v2/key")).toBe(true);
  });

  it("keeps the configured chunk size for non-Alchemy endpoints", () => {
    expect(getEthGetLogsChunkBlocks("https://polygon-bor-rpc.publicnode.com", 100)).toBe(100);
    expect(isAlchemyRpcUrl("https://polygon-bor-rpc.publicnode.com")).toBe(false);
  });

  it("uses a live-tail scan when an Alchemy cursor is stale", () => {
    const plan = planEthGetLogsScan("https://polygon-mainnet.g.alchemy.com/v2/key", 101, 1000, 250);

    expect(plan).toEqual({
      requestedFromBlock: 101,
      fromBlock: 991,
      toBlock: 1000,
      confirmedLatestBlock: 1000,
      maxScanBlocks: 10,
      skippedToLiveHead: true,
      cursorAheadOfHead: false
    });
    expect(formatEthGetLogsBackfillMode(plan)).toContain("Skipped stale cursor from block 101 to 991");
  });

  it("keeps normal progressive scans for non-Alchemy endpoints", () => {
    expect(planEthGetLogsScan("https://polygon-bor-rpc.publicnode.com", 101, 1000, 250)).toMatchObject({
      fromBlock: 101,
      toBlock: 350,
      skippedToLiveHead: false
    });
  });

  it("detects when an RPC head is behind the stored cursor", () => {
    const plan = planEthGetLogsScan("https://polygon-bor-rpc.publicnode.com", 1001, 995, 250);

    expect(plan).toMatchObject({
      fromBlock: 1001,
      toBlock: 995,
      cursorAheadOfHead: true
    });
    expect(formatEthGetLogsBackfillMode(plan)).toContain("RPC head 995 is behind stored cursor 1000");
    expect(advanceLastScannedBlock(1000, plan.toBlock)).toBe(1000);
  });
});
