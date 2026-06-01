import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeUmaVoteCommitLog,
  umaVoteCommitsAdapter,
  voteCommittedTopic,
  type EthereumLog
} from "../src/integrations/umaVoteCommits.js";
import type { Integration } from "../src/integrations/types.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const sampleLog: EthereumLog = {
  address: "0x004395edb43efca9885cedad51ec9faf93bd34ac",
  topics: [
    "0xcb3360a5c92f7310d655266c30a450dae6323bc9773aad5959198ed60a03111b",
    "0x0000000000000000000000007baa3b328603535006d76d7b80af7260fd8a946a",
    "0x0000000000000000000000007baa3b328603535006d76d7b80af7260fd8a946a",
    "0x5945535f4f525f4e4f5f51554552590000000000000000000000000000000000"
  ],
  data:
    "0x00000000000000000000000000000000000000000000000000000000000027d7" +
    "00000000000000000000000000000000000000000000000000000000690b46ef" +
    "0000000000000000000000000000000000000000000000000000000000000060" +
    "00000000000000000000000000000000000000000000000000000000000000ea" +
    "616e63696c6c61727944617461486173683a6366616339333838646233363239" +
    "3039373566353962653532366235316339336637646436303631393434643332" +
    "3434613139356666303334666664353533622c6368696c64426c6f636b4e756d" +
    "6265723a37383632343530342c6368696c644f7261636c653a61633630333533" +
    "3361353438373363343436313031323136383239613661393863646262633366" +
    "33642c6368696c645265717565737465723a3263303336376139646232333164" +
    "64656264383861393462346636343631613665343763353862312c6368696c64" +
    "436861696e49643a31333700000000000000000000000000000000000000000000",
  blockNumber: "0x16a3532",
  blockTimestamp: "0x690c1a1b",
  transactionHash: "0xdd814984e52dcb83638f4702144a5faa98778ab71eb923ec3662a3507810d89c",
  logIndex: "0x13c"
};

describe("UMA vote commit adapter", () => {
  it("uses the current Voting v2 VoteCommitted event topic", () => {
    expect(voteCommittedTopic).toBe("0xcb3360a5c92f7310d655266c30a450dae6323bc9773aad5959198ed60a03111b");
  });

  it("decodes Voting v2 commit logs and tracks recommits by voter/request key", () => {
    const seen = new Map<string, number>();
    const first = decodeUmaVoteCommitLog(sampleLog, seen);
    const second = decodeUmaVoteCommitLog({ ...sampleLog, logIndex: "0x13d" }, seen);

    expect(first).toMatchObject({
      voter: "0x7baa3b328603535006d76d7b80af7260fd8a946a",
      caller: "0x7baa3b328603535006d76d7b80af7260fd8a946a",
      roundId: 10199,
      requestTime: 1762346735,
      blockNumber: 23737650,
      blockTimestamp: 1762400795,
      transactionHash: "0xdd814984e52dcb83638f4702144a5faa98778ab71eb923ec3662a3507810d89c",
      logIndex: 316,
      previousCommitCount: 0
    });
    expect(first?.ancillaryDataText).toContain("childRequester:2c0367a9db231ddebd88a94b4f6461a6e47c58b1");
    expect(second?.commitKey).toBe(first?.commitKey);
    expect(second?.previousCommitCount).toBe(1);
  });

  it("updates threshold settings without changing scan state", async () => {
    const integration = buildIntegration(JSON.stringify({ lastScannedBlock: 123 }));
    const result = await umaVoteCommitsAdapter.updateThreshold!(integration, "250k");

    expect(result).toMatchObject({
      changed: true,
      thresholdLabel: "Minimum voter stake",
      thresholdValue: "250,000 UMA"
    });
    expect(JSON.parse(result.settingsJson)).toMatchObject({
      lastScannedBlock: 123,
      umaCommitThresholdWei: "250000000000000000000000"
    });
  });

  it("fetches Ethereum commit logs and flags repeated commits as recommits", async () => {
    const decoded = decodeUmaVoteCommitLog(sampleLog);
    expect(decoded).not.toBeNull();
    let statusCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        return jsonResponse([
          {
            ancillaryData: decoded!.ancillaryDataHex,
            timestamp: decoded!.requestTime,
            question: "Will the highest temperature in Moscow be 4C or below on May 29?",
            answer: "P4"
          }
        ]);
      }

      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      if (body.method === "eth_blockNumber") {
        return jsonRpcResponse("0x16a3534");
      }
      if (body.method === "eth_getLogs") {
        return jsonRpcResponse([sampleLog, { ...sampleLog, logIndex: "0x13d" }]);
      }
      if (body.method === "eth_call") {
        const call = body.params[0] as { data?: string };
        if (call.data?.startsWith("0xcb1330f5")) {
          return jsonRpcResponse(abiWord(400000n * 10n ** 18n));
        }

        statusCallCount += 1;
        return jsonRpcResponse(statusCallCount === 1 ? abiWord(10199n) : abiWord(0n));
      }
      throw new Error(`Unhandled RPC method ${body.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await umaVoteCommitsAdapter.fetchEventUpdates!(buildIntegration(JSON.stringify({
      rpcUrls: "https://rpc.example",
      lastScannedBlock: 23737649,
      umaCommitThresholdWei: "250000000000000000000000"
    })));

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      alertTitle: "Large UMA vote commits/recommits",
      type: "UMA vote commits/recommits",
      mentionAlertRole: true,
      text: "0x7baa3b328603535006d76d7b80af7260fd8a946a committed 2 requests above threshold in 1 round."
    });
    expect(result.posts[0].summaryFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Commit count", value: "2" }),
        expect.objectContaining({ name: "Recommits", value: "1" }),
        expect.objectContaining({ name: "Estimated stake", value: "400,000 UMA" })
      ])
    );
    expect(result.posts[0].summaryFields).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "Commits" })]));
    expect(result.posts[0].hiddenFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Committed requests", value: expect.stringContaining("recommit #2") }),
        expect.objectContaining({ name: "Latest request metadata", value: expect.stringContaining("childRequester") })
      ])
    );
    expect(result.posts[0].hiddenFields).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Included commit logs" }),
        expect.objectContaining({ name: "Latest ancillary data hex" })
      ])
    );
    expect(JSON.parse(result.settingsJson ?? "{}")).toMatchObject({
      lastScannedBlock: 23737650,
      lastRpcUrl: "https://rpc.example",
      umaCommitThresholdWei: "250000000000000000000000"
    });
  });
});

function buildIntegration(settingsJson: string | null): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "uma-vote-commits",
    displayName: "UMA Vote Commits",
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
