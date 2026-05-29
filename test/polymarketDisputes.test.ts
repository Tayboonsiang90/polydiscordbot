import { describe, expect, it, vi, afterEach } from "vitest";
import { buildEventPostEmbed } from "../src/embeds.js";
import {
  buildFastPolymarketDisputePostFromLog,
  decodeDisputePriceLog,
  disputePriceTopic,
  fetchPolymarketDisputeUpdates,
  optimisticOracleV1Address,
  optimisticOracleV2Address,
  optimisticOracleV3Address,
  polymarketUmaCtfAdapterAddresses,
  polymarketUmaCtfAdapterAddressTopics,
  type PolymarketDisputeEvent
} from "../src/integrations/polymarketDisputes.js";
import type { Integration } from "../src/integrations/types.js";
import { polymarketBulletinBoardAddress, type PolygonLog } from "../src/integrations/polymarketClarifications.js";

const requester = polymarketUmaCtfAdapterAddresses[0];
const proposer = "0x1111111111111111111111111111111111111111";
const disputer = "0x2222222222222222222222222222222222222222";
const transactionHash = "0x3333333333333333333333333333333333333333333333333333333333333333";
const ancillaryData = "q: title: Trump kiss by May 31?, description: Rules. market_id: 2261347";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Polymarket dispute parsing", () => {
  it("decodes UMA DisputePrice logs and derives a question id", () => {
    const event = decodeDisputePriceLog(buildDisputeLog(1_000_000_000_000_000_000n));

    expect(event).toMatchObject<Partial<PolymarketDisputeEvent>>({
      id: `${transactionHash}:0x5`,
      requester: requester.toLowerCase(),
      proposer,
      disputer,
      oracleAddress: optimisticOracleV2Address,
      identifier: "0x5945535f4f525f4e4f5f51554552590000000000000000000000000000000000",
      requestTimestamp: 1_777_777_777,
      ancillaryData,
      proposedOutcome: "YES (1)",
      blockNumber: 87220096,
      logIndex: 5,
      transactionHash
    });
    expect(event?.questionId).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("ignores DisputePrice logs for non-Polymarket requesters", () => {
    const log = buildDisputeLog(0n, "0x9999999999999999999999999999999999999999");

    expect(decodeDisputePriceLog(log)).toBeNull();
  });

  it("decodes current oracle dispute logs using the bulletin board requester", () => {
    const event = decodeDisputePriceLog(buildDisputeLog(1_000_000_000_000_000_000n, polymarketBulletinBoardAddress, optimisticOracleV3Address));

    expect(event).toMatchObject({
      requester: polymarketBulletinBoardAddress.toLowerCase(),
      oracleAddress: optimisticOracleV3Address,
      proposedOutcome: "YES (1)"
    });
  });

  it("builds a fast alert post directly from a Polymarket dispute log", () => {
    const post = buildFastPolymarketDisputePostFromLog(buildDisputeLog(0n));

    expect(post).toMatchObject({
      id: `${transactionHash}:0x5`,
      type: "Polymarket UMA dispute",
      alertTitle: "Polymarket UMA dispute",
      url: `https://polygonscan.com/tx/${transactionHash}`
    });
    expect(post?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Question ID" }),
        expect.objectContaining({ name: "Block", value: "87220096" })
      ])
    );
    expect(post?.prioritySummary).toMatchObject({
      proposedOutcome: "NO (0)",
      proposer,
      disputer
    });
  });
});

describe("fetchPolymarketDisputeUpdates", () => {
  it("scans UMA dispute logs, enriches from CLOB by question id, and advances the cursor", async () => {
    const rpcUrl = "https://rpc.example";
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      if (target === rpcUrl) {
        const body = JSON.parse(String(init?.body)) as { method: string; params: Array<Record<string, unknown>> };
        if (body.method === "eth_blockNumber") {
          return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x3e8" });
        }
        if (body.method === "eth_getLogs") {
          const filter = body.params[0];
          expect(filter.topics).toEqual([disputePriceTopic, polymarketUmaCtfAdapterAddressTopics]);
          return jsonResponse({
            jsonrpc: "2.0",
            id: 1,
            result: filter.address === optimisticOracleV2Address ? [buildDisputeLog(0n)] : []
          });
        }
      }

      if (target.startsWith("https://clob.polymarket.com/markets-by-question-id/")) {
        return jsonResponse({
          question: "Trump kiss by May 31?",
          market_slug: "trump-kiss-by-may-31",
          condition_id: "0xcondition",
          tags: ["Politics", "Trump"]
        });
      }

      throw new Error(`Unexpected fetch: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPolymarketDisputeUpdates(
      {
        settingsJson: JSON.stringify({ rpcUrl, lastScannedBlock: 980 })
      } as Integration,
      new Date("2026-05-21T00:00:00.000Z")
    );

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      type: "Polymarket UMA dispute",
      alertTitle: "Polymarket UMA dispute",
      textFieldName: "Dispute",
      polymarketUrl: "https://polymarket.com/market/trump-kiss-by-may-31"
    });
    expect(result.posts[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "On-chain tx", value: `https://polygonscan.com/tx/${transactionHash}` }),
        expect.objectContaining({ name: "Condition ID", value: "0xcondition" }),
        expect.objectContaining({ name: "Question ID" })
      ])
    );
    expect(result.posts[0].prioritySummary).toMatchObject({
      question: "Trump kiss by May 31?",
      questionUrl: "https://polymarket.com/market/trump-kiss-by-may-31",
      proposedOutcome: "NO (0)",
      marketTags: ["Politics", "Trump"],
      proposer,
      disputer
    });
    const embedFields = buildEventPostEmbed(
      buildIntegration(
        JSON.stringify({
          addressLabels: [
            { address: proposer, label: "Known Proposer" },
            { address: disputer, label: "Known Disputer" }
          ]
        })
      ),
      result.posts[0]
    )[0].data.fields ?? [];
    expect(embedFields.slice(0, 8).map((field) => field.name)).toEqual([
      "Question",
      "Proposed outcome",
      "Posted at (SGT)",
      "Posted at (ET)",
      "Market tags",
      "Proposer",
      "Disputer",
      "Event type"
    ]);
    expect(embedFields[0]).toEqual({
      name: "Question",
      value: "**[Trump kiss by May 31?](https://polymarket.com/market/trump-kiss-by-may-31)**",
      inline: false
    });
    expect(embedFields[1]).toEqual({ name: "Proposed outcome", value: "**NO (0)**", inline: false });
    expect(embedFields).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Proposer", value: `Known Proposer\n${proposer}` })]));
    expect(embedFields).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Disputer", value: `Known Disputer\n${disputer}` })]));
    expect(embedFields).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "Links" })]));
    expect(JSON.parse(result.settingsJson ?? "{}")).toMatchObject({
      rpcUrl,
      lastScannedBlock: 1000,
      lastScanStartedBlock: 981,
      lastScanCompletedAt: "2026-05-21T00:00:00.000Z"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      rpcUrl,
      expect.objectContaining({ method: "POST", body: expect.stringContaining(optimisticOracleV1Address) })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      rpcUrl,
      expect.objectContaining({ method: "POST", body: expect.stringContaining(optimisticOracleV3Address) })
    );
  });
});

function buildIntegration(settingsJson: string | null = null): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "polymarket-disputes",
    displayName: "UMA Dispute Alerts",
    sourceUrl: "https://polygonscan.com/address/test",
    polymarketUrl: null,
    alertRoleId: null,
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
    createdAt: "2026-05-21T00:00:00.000Z",
    updatedAt: "2026-05-21T00:00:00.000Z"
  };
}

function buildDisputeLog(proposedPrice: bigint, requesterAddress = requester, oracleAddress = optimisticOracleV2Address): PolygonLog {
  return {
    address: oracleAddress,
    topics: [disputePriceTopic, encodeAddressTopic(requesterAddress), encodeAddressTopic(proposer), encodeAddressTopic(disputer)],
    data: encodeDisputePriceData(ancillaryData, proposedPrice),
    blockNumber: "0x532df80",
    transactionHash,
    logIndex: "0x5",
    blockTimestamp: "0x6a0dbf9f"
  } as PolygonLog & { address: string };
}

function encodeDisputePriceData(text: string, proposedPrice: bigint): string {
  return `0x${[
    "5945535f4f525f4e4f5f51554552590000000000000000000000000000000000",
    word(1_777_777_777n),
    word(4n * 32n),
    signedWord(proposedPrice),
    encodeAbiBytesTail(text)
  ].join("")}`;
}

function encodeAbiBytesTail(text: string): string {
  const bytes = Buffer.from(text, "utf8").toString("hex");
  return `${word(BigInt(bytes.length / 2))}${bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0")}`;
}

function encodeAddressTopic(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

function signedWord(value: bigint): string {
  return (value < 0n ? (1n << 256n) + value : value).toString(16).padStart(64, "0");
}

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
