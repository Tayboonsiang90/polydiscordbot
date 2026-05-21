import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ancillaryDataUpdatedTopic,
  decodeUmaCtfQuestionData,
  decodeUtf8AbiBytes,
  fetchPolymarketClarificationUpdates,
  normalizePolymarketClarificationLog,
  parsePolymarketAncillaryData,
  type PolygonLog
} from "../src/integrations/polymarketClarifications.js";
import type { Integration } from "../src/integrations/types.js";

const questionId = "0xa4c576609b4af948431f1ba84ee209a0e91e0ab722482f1e9810ea4337d26cdc";
const creator = "0x91430cad2d3975766499717fa0d66a78d814e5c5";
const transactionHash = "0xfd8e083f7ba43f100f5d662979bdd1a4d5726d626b1f2f47ddeb7bd3fe7fc988";

afterEach(() => {
  vi.restoreAllMocks();
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
      text: "We are aware of the dispute on this market.",
      url: `https://polygonscan.com/tx/${transactionHash}`,
      polymarketUrl: "https://polymarket.com/event/trump-kiss-by-may-31"
    });
    expect(post.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Question", value: "Trump kiss by May 31?" }),
        expect.objectContaining({ name: "Gamma market", value: "2261347" }),
        expect.objectContaining({ name: "Question ID", value: questionId }),
        expect.objectContaining({ name: "Creator", value: creator })
      ])
    );
    expect(post.postedAt.getTime()).toBe(Number.parseInt("6a0dbf9f", 16) * 1_000);
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
    expect(result.posts[0].polymarketUrl).toBe("https://polymarket.com/event/trump-kiss-by-may-31");
    expect(JSON.parse(result.settingsJson ?? "{}")).toMatchObject({
      rpcUrl,
      lastScannedBlock: 988,
      lastScanStartedBlock: 981,
      lastScanCompletedAt: "2026-05-20T00:00:00.000Z"
    });
  });

  it("keeps the first scan small enough for a Discord check response", async () => {
    const rpcUrl = "https://rpc.example";
    let logParams: { fromBlock?: string; toBlock?: string } | null = null;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (url.toString() !== rpcUrl) {
        throw new Error(`Unexpected fetch: ${url.toString()}`);
      }

      const body = JSON.parse(String(init?.body)) as { method: string; params: Array<Record<string, string>> };
      if (body.method === "eth_blockNumber") {
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x2710" });
      }
      if (body.method === "eth_getLogs") {
        logParams = body.params[0];
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: [] });
      }

      throw new Error(`Unexpected RPC method: ${body.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPolymarketClarificationUpdates(
      { settingsJson: JSON.stringify({ rpcUrl }) } as Integration,
      new Date("2026-05-21T00:00:00.000Z")
    );

    expect(logParams).toMatchObject({ fromBlock: "0x1f35", toBlock: "0x2704" });
    expect(JSON.parse(result.settingsJson ?? "{}")).toMatchObject({
      rpcUrl,
      lastScannedBlock: 9988,
      lastScanStartedBlock: 7989
    });
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
