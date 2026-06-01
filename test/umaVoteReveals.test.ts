import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeUmaVoteRevealLog,
  formatUmaTokenAmount,
  parseUmaRevealThresholdWei,
  umaVoteRevealsAdapter,
  voteRevealedTopic,
  type EthereumLog
} from "../src/integrations/umaVoteReveals.js";
import type { Integration } from "../src/integrations/types.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const sampleLog: EthereumLog = {
  address: "0x004395edb43efca9885cedad51ec9faf93bd34ac",
  topics: [
    "0x97fd2ce926defea5c438a5e8084209a81af5ad8539d8198af200a52e0b7b374c",
    "0x0000000000000000000000006564c6c44ef87e3bb32d7987317869817380340c",
    "0x000000000000000000000000c636da66cfa5c363c4785835069dcaf85ab91feb",
    "0x5945535f4f525f4e4f5f51554552590000000000000000000000000000000000"
  ],
  data:
    "0x00000000000000000000000000000000000000000000000000000000000027be" +
    "0000000000000000000000000000000000000000000000000000000068c9584a" +
    "00000000000000000000000000000000000000000000000000000000000000a0" +
    "0000000000000000000000000000000000000000000000000de0b6b3a7640000" +
    "00000000000000000000000000000000000000000000590e232d876eedbd2b05" +
    "00000000000000000000000000000000000000000000000000000000000000ea" +
    "616e63696c6c61727944617461486173683a6365316434653764353234613339" +
    "6363633464653265323331313562353839663736333939323761643932323061" +
    "6335346361643631316638636233326134652c6368696c64426c6f636b4e756d" +
    "6265723a37363532323539352c6368696c644f7261636c653a61633630333533" +
    "3361353438373363343436313031323136383239613661393863646262633366" +
    "33642c6368696c645265717565737465723a6565336166653334376435633734" +
    "33313730343165323631386334393533346461663838376332342c6368696c64" +
    "436861696e49643a31333700000000000000000000000000000000000000000000",
  blockNumber: "0x164defa",
  transactionHash: "0x1908fc4987165f4c4fea1814615658c7e1eb67ace6b089d9ee070c2c372348ab",
  transactionIndex: "0xad",
  blockHash: "0xf944da1be617aa60fb24e5eb4430d8db00b6423c5564c08bd1bdc45ada4f0958",
  blockTimestamp: "0x68cb998b",
  logIndex: "0x1c1",
  removed: false
} as EthereumLog;

describe("UMA vote reveal adapter", () => {
  it("uses the current Voting v2 VoteRevealed event topic", () => {
    expect(voteRevealedTopic).toBe("0x97fd2ce926defea5c438a5e8084209a81af5ad8539d8198af200a52e0b7b374c");
  });

  it("decodes Voting v2 reveal logs including staked vote weight", () => {
    const event = decodeUmaVoteRevealLog(sampleLog);

    expect(event).toMatchObject({
      voter: "0x6564c6c44ef87e3bb32d7987317869817380340c",
      caller: "0xc636da66cfa5c363c4785835069dcaf85ab91feb",
      roundId: 10174,
      requestTime: 1758025802,
      price: 1000000000000000000n,
      blockNumber: 23387898,
      blockTimestamp: 1758173579,
      transactionHash: "0x1908fc4987165f4c4fea1814615658c7e1eb67ace6b089d9ee070c2c372348ab",
      logIndex: 449
    });
    expect(formatUmaTokenAmount(event?.numTokens ?? 0n)).toBe("420,551.4062");
    expect(event?.ancillaryDataText).toContain("childRequester:ee3afe347d5c74317041e2618c49534daf887c24");
  });

  it("parses configurable UMA threshold shorthand", () => {
    expect(parseUmaRevealThresholdWei("250k").toString()).toBe("250000000000000000000000");
    expect(parseUmaRevealThresholdWei("1.5m").toString()).toBe("1500000000000000000000000");
    expect(() => parseUmaRevealThresholdWei("nope")).toThrow(/Invalid UMA threshold/);
  });

  it("updates threshold settings without changing scan state", async () => {
    const integration = buildIntegration(JSON.stringify({ lastScannedBlock: 123 }));
    const result = await umaVoteRevealsAdapter.updateThreshold!(integration, "250k");

    expect(result).toMatchObject({
      changed: true,
      thresholdLabel: "Minimum vote weight",
      thresholdValue: "250,000 UMA"
    });
    expect(JSON.parse(result.settingsJson)).toMatchObject({
      lastScannedBlock: 123,
      umaRevealThresholdWei: "250000000000000000000000"
    });
  });

  it("fetches Ethereum reveal logs and groups multiple reveals from the same voter", async () => {
    const decoded = decodeUmaVoteRevealLog(sampleLog);
    expect(decoded).not.toBeNull();
    let ethCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        return jsonResponse([
          {
            ancillaryData: decoded!.ancillaryDataHex,
            timestamp: decoded!.requestTime,
            question: "US x Cuba diplomatic meeting by June 30?",
            answer: "P1"
          }
        ]);
      }

      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === "eth_blockNumber") {
        return jsonRpcResponse("0x164defc");
      }
      if (body.method === "eth_getLogs") {
        return jsonRpcResponse([sampleLog, { ...sampleLog, logIndex: "0x1c2" }]);
      }
      if (body.method === "eth_call") {
        ethCallCount += 1;
        return jsonRpcResponse(ethCallCount === 1 ? abiWord(10174n) : abiWord(1n));
      }
      throw new Error(`Unhandled RPC method ${body.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await umaVoteRevealsAdapter.fetchEventUpdates!(buildIntegration(JSON.stringify({
      rpcUrls: "https://rpc.example",
      lastScannedBlock: 23387897,
      umaRevealThresholdWei: "250000000000000000000000"
    })));

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      alertTitle: "Large UMA vote reveals",
      mentionAlertRole: true,
      text: expect.stringContaining("US x Cuba diplomatic meeting by June 30?")
    });
    expect(result.posts[0].summaryFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Reveal count", value: "2" }),
        expect.objectContaining({ name: "Vote weight", value: "420,551.4062 UMA" }),
        expect.objectContaining({ name: "Reveals", value: expect.stringContaining("committee P1") })
      ])
    );
    expect(result.posts[0].hiddenFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Revealed requests", value: expect.stringContaining("committee P1") }),
        expect.objectContaining({ name: "Latest request metadata", value: expect.stringContaining("childRequester") })
      ])
    );
    expect(result.posts[0].hiddenFields).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Included reveal logs" }),
        expect.objectContaining({ name: "Latest ancillary data hex" })
      ])
    );
    expect(JSON.parse(result.settingsJson ?? "{}")).toMatchObject({
      lastScannedBlock: 23387898,
      lastRpcUrl: "https://rpc.example",
      umaRevealThresholdWei: "250000000000000000000000"
    });
  });
});

function buildIntegration(settingsJson: string | null): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "uma-vote-reveals",
    displayName: "UMA Vote Reveals",
    sourceUrl: "https://etherscan.io/address/0x004395edb43efca9885cedad51ec9faf93bd34ac",
    polymarketUrl: null,
    alertRoleId: "role",
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: null,
    settingsJson,
    pollIntervalMinutes: 1,
    status: "active",
    lastValue: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    snapshotValue: null,
    snapshotCheckedAt: null,
    snapshotDate: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z"
  };
}

function jsonRpcResponse(result: unknown): Response {
  return jsonResponse({ jsonrpc: "2.0", id: 1, result });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function abiWord(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}
