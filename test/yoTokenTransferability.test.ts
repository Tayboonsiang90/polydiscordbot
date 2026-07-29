import { describe, expect, it, vi } from "vitest";
import {
  buildYoTransferCallData,
  fetchYoTokenTransferability,
  isYoTransferabilityEnabled,
  parseYoTransferSimulation,
  yoTokenAddress,
  yoTokenTransferabilityAdapter
} from "../src/integrations/yoTokenTransferability.js";

describe("$YO transferability monitor", () => {
  it("builds zero-value transfer calls against the expected token", () => {
    expect(yoTokenAddress).toBe("0x1925450f5e5fb974b0aae1f3408cf5286fbd1a72");
    expect(buildYoTransferCallData("transfer")).toMatch(/^0xa9059cbb[0-9a-f]{128}$/);
    expect(buildYoTransferCallData("transferFrom")).toMatch(/^0x23b872dd[0-9a-f]{192}$/);
    expect(buildYoTransferCallData("transfer").endsWith("0".repeat(64))).toBe(true);
  });

  it("treats UNAUTHORIZED reverts as blocked and successful calls as enabled", () => {
    expect(parseYoTransferSimulation({ error: { code: 3, message: "execution reverted: UNAUTHORIZED" } })).toBe(false);
    expect(parseYoTransferSimulation({ result: `0x${"0".repeat(63)}1` })).toBe(true);
    expect(parseYoTransferSimulation({ result: `0x${"0".repeat(64)}` })).toBe(false);
  });

  it("checks both transfer methods through read-only Base eth_call requests", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: UNAUTHORIZED" } }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${"0".repeat(63)}1` }), { status: 200 })
      );

    await expect(fetchYoTokenTransferability({ fetchImpl, rpcUrls: ["https://base.test"] })).resolves.toEqual({
      transferEnabled: false,
      transferFromEnabled: true
    });

    for (const call of fetchImpl.mock.calls) {
      const body = JSON.parse(String(call[1]?.body)) as {
        method: string;
        params: Array<{ from: string; to: string; data: string } | string>;
      };
      expect(body.method).toBe("eth_call");
      expect(body.params[0]).toMatchObject({
        from: "0x000000000000000000000000000000000000dead",
        to: yoTokenAddress
      });
      expect(body.params[1]).toBe("latest");
    }
  });

  it("alerts only on a transition to publicly enabled", () => {
    const blocked = "Transferability: NOT PUBLICLY ENABLED";
    const enabled = "Transferability: ENABLED";
    expect(isYoTransferabilityEnabled(blocked)).toBe(false);
    expect(isYoTransferabilityEnabled(enabled)).toBe(true);
    expect(yoTokenTransferabilityAdapter.shouldAlertOnChange?.(blocked, enabled)).toBe(true);
    expect(yoTokenTransferabilityAdapter.shouldAlertOnChange?.(enabled, blocked)).toBe(false);
    expect(yoTokenTransferabilityAdapter.shouldAlertOnChange?.(enabled, enabled)).toBe(false);
  });
});
