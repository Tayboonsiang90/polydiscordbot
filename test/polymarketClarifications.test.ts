import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEventPostEmbed } from "../src/embeds.js";
import {
  ancillaryDataUpdatedTopic,
  buildFastPolymarketPendingClarificationPostFromTransaction,
  decodeUmaCtfQuestionData,
  decodePendingPolymarketClarificationTransaction,
  decodeUtf8AbiBytes,
  defaultPolygonRpcUrls,
  buildFastPolymarketClarificationPostFromLog,
  fetchPolymarketClarificationUpdates,
  postUpdateSelector,
  normalizePolymarketClarificationLog,
  parsePolymarketAncillaryData,
  polymarketBulletinBoardAddress,
  type PolygonPendingTransaction,
  type PolygonLog
} from "../src/integrations/polymarketClarifications.js";
import type { Integration } from "../src/integrations/types.js";

const questionId = "0xa4c576609b4af948431f1ba84ee209a0e91e0ab722482f1e9810ea4337d26cdc";
const creator = "0x91430cad2d3975766499717fa0d66a78d814e5c5";
const transactionHash = "0xfd8e083f7ba43f100f5d662979bdd1a4d5726d626b1f2f47ddeb7bd3fe7fc988";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Polymarket clarification parsing", () => {
  it("parses title, market id, and initializer from UMA ancillary data", () => {
    const ancillaryData =
      "q: title: Trump kiss by May 31?, description: This market resolves to Yes. market_id: 2261347 res_data: p1: 0. initializer:91430cad2d3975766499717fa0d66a78d814e5c5";

    expect(parsePolymarketAncillaryData(ancillaryData)).toEqual({
      title: "Trump kiss by May 31?",
      marketId: "2261347",
      initializer: creator
    });
  });

  it("decodes ABI bytes update payloads", () => {
    expect(decodeUtf8AbiBytes(encodeAbiBytes("Clarification issued."))).toBe("Clarification issued.");
  });

  it("decodes getQuestion tuple output enough to recover creator and ancillary data", () => {
    const ancillaryData =
      "q: title: Trump kiss by May 31?, description: Rules. market_id: 2261347,initializer:91430cad2d3975766499717fa0d66a78d814e5c5";
    const decoded = decodeUmaCtfQuestionData(encodeQuestionDataResult(creator, ancillaryData));

    expect(decoded).toEqual({ creator, ancillaryData });
  });

  it("normalizes AncillaryDataUpdated logs into mentionable event posts", () => {
    const log = buildUpdateLog("We are aware of the dispute on this market.");
    const post = normalizePolymarketClarificationLog(log, {
      questionId,
      creator,
      marketId: "2261347",
      question: "Trump kiss by May 31?",
      slug: "trump-kiss-by-may-31"
    });

    expect(post).toMatchObject({
      id: `${transactionHash}:0xa8`,
      type: "Polymarket clarification",
      alertTitle: "Polymarket clarification",
      sourceLabel: "On-chain tx",
      buttonLabel: "Open transaction",
      mentionAlertRole: true,
      textFieldName: "Clarification",
      text: "We are aware of the dispute on this market.",
      url: `https://polygonscan.com/tx/${transactionHash}`,
      polymarketUrl: "https://polymarket.com/market/trump-kiss-by-may-31"
    });
    expect(post.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Gamma market", value: "2261347" }),
        expect.objectContaining({ name: "Question ID", value: questionId }),
        expect.objectContaining({ name: "Block", value: String(Number.parseInt("53218ef", 16)) })
      ])
    );
    expect(post.prioritySummary).toMatchObject({
      question: "Trump kiss by May 31?",
      questionUrl: "https://polymarket.com/market/trump-kiss-by-may-31",
      creator,
      clarification: "We are aware of the dispute on this market."
    });
    const embedFields = buildEventPostEmbed(buildIntegration(), post)[0].data.fields ?? [];
    expect(embedFields.slice(0, 6).map((field) => field.name)).toEqual([
      "Question",
      "Posted at (SGT)",
      "Posted at (ET)",
      "Clarification",
      "Creator",
      "Event type"
    ]);
    expect(embedFields[0]).toEqual({
      name: "Question",
      value: "**[Trump kiss by May 31?](https://polymarket.com/market/trump-kiss-by-may-31)**",
      inline: false
    });
    expect(embedFields).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "Links" })]));
    expect(post.postedAt.getTime()).toBe(Number.parseInt("6a0dbf9f", 16) * 1_000);
  });

  it("builds a fast alert post directly from the log without market enrichment", () => {
    const post = buildFastPolymarketClarificationPostFromLog(buildUpdateLog("Clarification issued."));

    expect(post).toMatchObject({
      id: `${transactionHash}:0xa8`,
      text: "Clarification issued.",
      url: `https://polygonscan.com/tx/${transactionHash}`
    });
    expect(post?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Question ID", value: questionId }),
        expect.objectContaining({ name: "Block", value: String(Number.parseInt("53218ef", 16)) })
      ])
    );
  });

  it("decodes pending bulletin-board postUpdate transactions", () => {
    const transaction = buildPendingUpdateTransaction("Pending clarification.");
    const update = decodePendingPolymarketClarificationTransaction(transaction, new Date("2026-05-22T17:14:23.000Z"));

    expect(update).toEqual({
      id: `pending:${transaction.hash}`,
      transactionHash: transaction.hash,
      updater: creator,
      questionId,
      text: "Pending clarification.",
      seenAt: new Date("2026-05-22T17:14:23.000Z")
    });
  });

  it("builds a fast alert post directly from a pending postUpdate transaction", () => {
    const transaction = buildPendingUpdateTransaction("Pending clarification.");
    const post = buildFastPolymarketPendingClarificationPostFromTransaction(
      transaction,
      new Date("2026-05-22T17:14:23.000Z")
    );

    expect(post).toMatchObject({
      id: `pending:${transaction.hash}`,
      type: "Pending Polymarket clarification",
      alertTitle: "Pending Polymarket clarification",
      sourceLabel: "Pending tx",
      text: "Pending clarification.",
      postedAt: new Date("2026-05-22T17:14:23.000Z"),
      url: `https://polygonscan.com/tx/${transaction.hash}`
    });
    expect(post?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Question ID", value: questionId }),
        expect.objectContaining({ name: "Mempool status", value: "pending - not mined yet" })
      ])
    );
  });
});

describe("fetchPolymarketClarificationUpdates", () => {
  it("scans confirmed Polygon logs, enriches from getQuestion and Gamma, and advances the cursor", async () => {
    const rpcUrl = "https://rpc.example";
    const ancillaryData =
      "q: title: Trump kiss by May 31?, description: Rules. market_id: 2261347,initializer:91430cad2d3975766499717fa0d66a78d814e5c5";
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      if (target === rpcUrl) {
        const body = JSON.parse(String(init?.body)) as { method: string };
        if (body.method === "eth_blockNumber") {
          return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x3e8" });
        }
        if (body.method === "eth_getLogs") {
          return jsonResponse({ jsonrpc: "2.0", id: 1, result: [buildUpdateLog("Clarification issued.")] });
        }
        if (body.method === "eth_call") {
          return jsonResponse({ jsonrpc: "2.0", id: 1, result: encodeQuestionDataResult(creator, ancillaryData) });
        }
      }

      if (target === "https://gamma-api.polymarket.com/markets/2261347") {
        return jsonResponse({
          id: "2261347",
          question: "Trump kiss by May 31?",
          slug: "trump-kiss-by-may-31"
        });
      }

      throw new Error(`Unexpected fetch: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPolymarketClarificationUpdates(
      {
        settingsJson: JSON.stringify({ rpcUrl, lastScannedBlock: 980 })
      } as Integration,
      new Date("2026-05-20T00:00:00.000Z")
    );

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].polymarketUrl).toBe("https://polymarket.com/market/trump-kiss-by-may-31");
    expect(JSON.parse(result.settingsJson ?? "{}")).toMatchObject({
      rpcUrl,
      lastScannedBlock: 1000,
      lastScanStartedBlock: 981,
      lastScanCompletedAt: "2026-05-20T00:00:00.000Z"
    });
  });

  it("keeps the first scan small enough for a Discord check response", async () => {
    const rpcUrl = "https://rpc.example";
    const logParams: Array<{ fromBlock?: string; toBlock?: string }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (url.toString() !== rpcUrl) {
        throw new Error(`Unexpected fetch: ${url.toString()}`);
      }

      const body = JSON.parse(String(init?.body)) as { method: string; params: Array<Record<string, string>> };
      if (body.method === "eth_blockNumber") {
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x2710" });
      }
      if (body.method === "eth_getLogs") {
        logParams.push(body.params[0]);
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: [] });
      }

      throw new Error(`Unexpected RPC method: ${body.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPolymarketClarificationUpdates(
      { settingsJson: JSON.stringify({ rpcUrl }) } as Integration,
      new Date("2026-05-21T00:00:00.000Z")
    );

    expect(logParams[0]).toMatchObject({ fromBlock: "0x2617", toBlock: "0x267a" });
    expect(logParams.at(-1)).toMatchObject({ fromBlock: "0x26df", toBlock: "0x2710" });
    expect(JSON.parse(result.settingsJson ?? "{}")).toMatchObject({
      rpcUrl,
      lastScannedBlock: 10000,
      lastScanStartedBlock: 9751
    });
  });

  it("skips mined clarification logs already alerted from the pending tx path", async () => {
    const rpcUrl = "https://rpc.example";
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (url.toString() !== rpcUrl) {
        throw new Error(`Unexpected fetch: ${url.toString()}`);
      }

      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === "eth_blockNumber") {
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x3e8" });
      }
      if (body.method === "eth_getLogs") {
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: [buildUpdateLog("Clarification issued.")] });
      }

      throw new Error(`Unexpected RPC method: ${body.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPolymarketClarificationUpdates(
      {
        settingsJson: JSON.stringify({
          rpcUrl,
          lastScannedBlock: 980,
          eventSeenPostIds: [`pending:${transactionHash}`]
        })
      } as Integration,
      new Date("2026-05-20T00:00:00.000Z")
    );

    expect(result.posts).toHaveLength(0);
  });

  it("splits eth_getLogs requests when an RPC rejects the block range", async () => {
    const rpcUrl = "https://rpc.example";
    const logParams: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (url.toString() !== rpcUrl) {
        throw new Error(`Unexpected fetch: ${url.toString()}`);
      }

      const body = JSON.parse(String(init?.body)) as { method: string; params: Array<Record<string, unknown>> };
      if (body.method === "eth_blockNumber") {
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x3e8" });
      }
      if (body.method === "eth_getLogs") {
        const params = body.params[0];
        logParams.push(params);
        if (params.fromBlock === "0x3d5" && params.toBlock === "0x3e8") {
          return jsonResponse({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "invalid block range params" } });
        }
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: [] });
      }

      throw new Error(`Unexpected RPC method: ${body.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPolymarketClarificationUpdates(
      {
        settingsJson: JSON.stringify({
          rpcUrl,
          lastScannedBlock: 980,
          maxScanBlocksPerRun: 20
        })
      } as Integration,
      new Date("2026-05-21T00:00:00.000Z")
    );

    expect(result.posts).toHaveLength(0);
    expect(logParams).toEqual([
      { address: "0x65070BE91477460D8A7AeEb94ef92fe056C2f2A7", fromBlock: "0x3d5", toBlock: "0x3e8", topics: [ancillaryDataUpdatedTopic] },
      { address: "0x65070BE91477460D8A7AeEb94ef92fe056C2f2A7", fromBlock: "0x3d5", toBlock: "0x3de", topics: [ancillaryDataUpdatedTopic] },
      { address: "0x65070BE91477460D8A7AeEb94ef92fe056C2f2A7", fromBlock: "0x3df", toBlock: "0x3e8", topics: [ancillaryDataUpdatedTopic] }
    ]);
    expect(JSON.parse(result.settingsJson ?? "{}")).toMatchObject({
      rpcUrl,
      lastScannedBlock: 1000,
      lastScanStartedBlock: 981
    });
  });

  it("falls back to another public HTTP RPC when the configured endpoint times out", async () => {
    const slowRpcUrl = "https://slow-rpc.example";
    const fallbackRpcUrl = defaultPolygonRpcUrls[0];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      if (target === slowRpcUrl) {
        throw new Error("The operation was aborted due to timeout");
      }
      if (target !== fallbackRpcUrl) {
        throw new Error(`Unexpected fetch: ${target}`);
      }

      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === "eth_blockNumber") {
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x3e8" });
      }
      if (body.method === "eth_getLogs") {
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: [] });
      }

      throw new Error(`Unexpected RPC method: ${body.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPolymarketClarificationUpdates(
      {
        settingsJson: JSON.stringify({ rpcUrl: slowRpcUrl, lastScannedBlock: 980 })
      } as Integration,
      new Date("2026-05-21T00:00:00.000Z")
    );

    expect(result.posts).toHaveLength(0);
    expect(result.checkFields).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Data source", value: `${fallbackRpcUrl} via eth_getLogs fallback` })])
    );
    expect(fetchMock).toHaveBeenCalledWith(
      slowRpcUrl,
      expect.objectContaining({ method: "POST", body: expect.stringContaining("eth_blockNumber") })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      fallbackRpcUrl,
      expect.objectContaining({ method: "POST", body: expect.stringContaining("eth_getLogs") })
    );
  });
});

function buildUpdateLog(updateText: string): PolygonLog {
  return {
    address: "0x65070be91477460d8a7aeeb94ef92fe056c2f2a7",
    topics: [ancillaryDataUpdatedTopic, questionId, encodeAddressTopic(creator)],
    data: encodeAbiBytes(updateText),
    blockNumber: "0x53218ef",
    transactionHash,
    logIndex: "0xa8",
    blockTimestamp: "0x6a0dbf9f"
  } as PolygonLog & { address: string };
}

function buildIntegration(): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "polymarket-clarifications",
    displayName: "UMA Clarifications",
    sourceUrl: "https://polygonscan.com/address/test",
    polymarketUrl: null,
    alertRoleId: null,
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: null,
    settingsJson: null,
    pollIntervalMinutes: 1,
    status: "active",
    lastValue: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    snapshotValue: null,
    snapshotCheckedAt: null,
    snapshotDate: null,
    createdAt: "2026-05-21T00:00:00.000Z",
    updatedAt: "2026-05-21T00:00:00.000Z"
  };
}

function buildPendingUpdateTransaction(updateText: string): PolygonPendingTransaction {
  return {
    hash: transactionHash,
    from: creator,
    to: polymarketBulletinBoardAddress.toLowerCase(),
    input: encodePostUpdateCalldata(questionId, updateText)
  };
}

function encodePostUpdateCalldata(updateQuestionId: string, updateText: string): string {
  return `${postUpdateSelector}${updateQuestionId.slice(2)}${word(2 * 32)}${encodeAbiBytesTail(updateText)}`;
}

function encodeQuestionDataResult(creatorAddress: string, ancillaryData: string): string {
  const tupleWords = [
    word(0),
    word(0),
    word(0),
    word(0),
    word(0),
    word(0),
    word(0),
    word(0),
    word(0),
    encodeAddressTopic("0x2791bca1f2de4661ed88a30c99a7a9449aa84174").slice(2),
    encodeAddressTopic(creatorAddress).slice(2),
    word(12 * 32)
  ].join("");
  const bytesTail = encodeAbiBytesTail(ancillaryData);
  return `0x${word(32)}${tupleWords}${bytesTail}`;
}

function encodeAbiBytes(text: string): string {
  return `0x${word(32)}${encodeAbiBytesTail(text)}`;
}

function encodeAbiBytesTail(text: string): string {
  const bytes = Buffer.from(text, "utf8").toString("hex");
  return `${word(bytes.length / 2)}${bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0")}`;
}

function encodeAddressTopic(address: string): string {
  return `0x${address.slice(2).padStart(64, "0")}`;
}

function word(value: number): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
