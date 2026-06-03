import { describe, expect, it } from "vitest";
import { getEthGetLogsChunkBlocks, isAlchemyRpcUrl } from "../src/rpcProviders.js";

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
});
