import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeProposePriceLog,
  fetchPolymarketProposalUpdates,
  getPolymarketProposalTagChannelName,
  getPolymarketProposalTagFiltersFromSettingsJson,
  proposePriceTopic,
  resolvePolymarketProposalChannelIds,
  setPolymarketProposalTagChannel,
  searchPolymarketProposalTags,
  testOnlyPolymarketProposalHelpers,
  updatePolymarketProposalTagFilters,
  type PolymarketProposalEvent
} from "../src/integrations/polymarketProposals.js";
import {
  optimisticOracleV1Address,
  optimisticOracleV2Address,
  polymarketUmaCtfAdapterAddresses,
  polymarketUmaCtfAdapterAddressTopics
} from "../src/integrations/polymarketDisputes.js";
import type { PolygonLog } from "../src/integrations/polymarketClarifications.js";
import type { EventMonitorPost, Integration } from "../src/integrations/types.js";

const requester = polymarketUmaCtfAdapterAddresses[0];
const proposer = "0x1111111111111111111111111111111111111111";
const currency = "0x2222222222222222222222222222222222222222";
const transactionHash = "0x3333333333333333333333333333333333333333333333333333333333333333";
const ancillaryData = "q: title: Lakers win?, description: Rules. market_id: 2261347";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  testOnlyPolymarketProposalHelpers.resetTagCache();
});

describe("Polymarket proposal parsing", () => {
  it("decodes UMA ProposePrice logs and derives a question id", () => {
    const event = decodeProposePriceLog(buildProposalLog(1_000_000_000_000_000_000n));

    expect(event).toMatchObject<Partial<PolymarketProposalEvent>>({
      id: `${transactionHash}:0x5`,
      requester: requester.toLowerCase(),
      proposer,
      oracleAddress: optimisticOracleV2Address,
      identifier: "0x5945535f4f525f4e4f5f51554552590000000000000000000000000000000000",
      requestTimestamp: 1_777_777_777,
      ancillaryData,
      proposedOutcome: "YES (1)",
      expirationTimestamp: 1_777_781_377,
      currency,
      blockNumber: 87220096,
      logIndex: 5,
      transactionHash
    });
    expect(event?.questionId).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("ignores ProposePrice logs for non-Polymarket requesters", () => {
    const log = buildProposalLog(0n, "0x9999999999999999999999999999999999999999");

    expect(decodeProposePriceLog(log)).toBeNull();
  });
});

describe("fetchPolymarketProposalUpdates", () => {
  it("scans UMA proposal logs, enriches CLOB tags, and alerts only matching configured tags", async () => {
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
          expect(filter.topics).toEqual([proposePriceTopic, polymarketUmaCtfAdapterAddressTopics]);
          return jsonResponse({
            jsonrpc: "2.0",
            id: 1,
            result: filter.address === optimisticOracleV2Address ? [buildProposalLog(0n)] : []
          });
        }
      }

      if (target.startsWith("https://clob.polymarket.com/markets-by-question-id/")) {
        return jsonResponse({
          question: "Lakers win?",
          market_slug: "lakers-win",
          condition_id: "0xcondition",
          tags: ["Sports", "NBA"]
        });
      }

      throw new Error(`Unexpected fetch: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPolymarketProposalUpdates(
      {
        settingsJson: JSON.stringify({
          rpcUrl,
          lastScannedBlock: 980,
          tagFilters: [{ id: "1", label: "Sports", slug: "sports" }]
        })
      } as Integration,
      new Date("2026-05-21T00:00:00.000Z")
    );

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      type: "Polymarket UMA proposal",
      alertTitle: "Polymarket UMA proposal",
      textFieldName: "Proposal",
      polymarketUrl: "https://polymarket.com/market/lakers-win"
    });
    expect(result.posts[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Question", value: "Lakers win?" }),
        expect.objectContaining({ name: "Matched tags", value: "Sports" }),
        expect.objectContaining({ name: "Proposed outcome", value: "NO (0)" }),
        expect.objectContaining({ name: "Proposer", value: proposer })
      ])
    );
    expect(JSON.parse(result.settingsJson ?? "{}")).toMatchObject({
      rpcUrl,
      lastScannedBlock: 1000,
      lastScanStartedBlock: 981,
      lastScanCompletedAt: "2026-05-21T00:00:00.000Z",
      tagFilters: [{ id: "1", label: "Sports", slug: "sports" }]
    });
    expect(fetchMock).toHaveBeenCalledWith(
      rpcUrl,
      expect.objectContaining({ method: "POST", body: expect.stringContaining(optimisticOracleV1Address) })
    );
  });

  it("does not alert proposals when no tag filters are configured", async () => {
    const rpcUrl = "https://rpc.example";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const target = url.toString();
        if (target === rpcUrl) {
          const body = JSON.parse(String(init?.body)) as { method: string; params: Array<Record<string, unknown>> };
          if (body.method === "eth_blockNumber") {
            return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x3e8" });
          }
          if (body.method === "eth_getLogs") {
            return jsonResponse({
              jsonrpc: "2.0",
              id: 1,
              result: body.params[0].address === optimisticOracleV2Address ? [buildProposalLog(0n)] : []
            });
          }
        }

        throw new Error(`Unexpected fetch: ${target}`);
      })
    );

    const result = await fetchPolymarketProposalUpdates(
      { settingsJson: JSON.stringify({ rpcUrl, lastScannedBlock: 980 }) } as Integration,
      new Date("2026-05-21T00:00:00.000Z")
    );

    expect(result.posts).toHaveLength(0);
    expect(result.checkFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Configured proposal tags", value: expect.stringContaining("none") })
      ])
    );
  });
});

describe("proposal tag filters", () => {
  it("searches Polymarket Gamma tags locally after fetching pages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const target = url.toString();
        if (target === "https://gamma-api.polymarket.com/tags?limit=100&offset=0") {
          return jsonResponse([
            { id: "1", label: "Sports", slug: "sports" },
            { id: "21", label: "Crypto", slug: "crypto" }
          ]);
        }

        throw new Error(`Unexpected fetch: ${target}`);
      })
    );

    const result = await searchPolymarketProposalTags("sport");

    expect(result.totalResults).toBe(1);
    expect(result.shownResults).toEqual([{ id: "1", label: "Sports", slug: "sports" }]);
  });

  it("adds and removes proposal tag filters by Gamma slug", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const target = url.toString();
        if (target === "https://gamma-api.polymarket.com/tags/slug/sports") {
          return jsonResponse({ id: "1", label: "Sports", slug: "sports" });
        }

        throw new Error(`Unexpected fetch: ${target}`);
      })
    );

    const added = await updatePolymarketProposalTagFilters({ settingsJson: null } as Integration, "add", "sports");

    expect(added.changed).toBe(true);
    expect(added.tagFilters).toEqual([{ id: "1", label: "Sports", slug: "sports" }]);

    const removed = await updatePolymarketProposalTagFilters(
      { settingsJson: added.settingsJson } as Integration,
      "remove",
      "sports"
    );

    expect(removed.changed).toBe(true);
    expect(removed.tagFilters).toEqual([]);
  });

  it("builds stable Discord channel names for proposal tags", () => {
    expect(getPolymarketProposalTagChannelName({ id: "1", label: "Politics / Elections", slug: "politics-elections" })).toBe(
      "uma-proposals-politics-elections"
    );
  });

  it("stores proposal tag channel metadata in settings JSON", () => {
    const settingsJson = JSON.stringify({ tagFilters: [{ id: "1", label: "Sports", slug: "sports" }] });
    const updated = setPolymarketProposalTagChannel(settingsJson, { id: "1", label: "Sports", slug: "sports" }, "channel-1", "uma-proposals-sports");

    expect(getPolymarketProposalTagFiltersFromSettingsJson(updated)).toEqual([
      { id: "1", label: "Sports", slug: "sports", channelId: "channel-1", channelName: "uma-proposals-sports" }
    ]);
  });

  it("routes proposal posts to matching configured tag channels", () => {
    const integration = {
      settingsJson: JSON.stringify({
        tagFilters: [
          { id: "1", label: "Sports", slug: "sports", channelId: "sports-channel", channelName: "uma-proposals-sports" },
          { id: "2", label: "Crypto", slug: "crypto", channelId: "crypto-channel", channelName: "uma-proposals-crypto" }
        ]
      })
    } as Integration;
    const post = {
      fields: [{ name: "Matched tags", value: "Sports", inline: false }]
    } as EventMonitorPost;

    expect(resolvePolymarketProposalChannelIds(integration, post)).toEqual(["sports-channel"]);
  });
});

function buildProposalLog(proposedPrice: bigint, requesterAddress = requester): PolygonLog {
  return {
    address: optimisticOracleV2Address,
    topics: [proposePriceTopic, encodeAddressTopic(requesterAddress), encodeAddressTopic(proposer)],
    data: encodeProposePriceData(ancillaryData, proposedPrice),
    blockNumber: "0x532df80",
    transactionHash,
    logIndex: "0x5",
    blockTimestamp: "0x6a0dbf9f"
  } as PolygonLog & { address: string };
}

function encodeProposePriceData(text: string, proposedPrice: bigint): string {
  return `0x${[
    "5945535f4f525f4e4f5f51554552590000000000000000000000000000000000",
    word(1_777_777_777n),
    word(6n * 32n),
    signedWord(proposedPrice),
    word(1_777_781_377n),
    addressWord(currency),
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

function addressWord(address: string): string {
  return address.slice(2).toLowerCase().padStart(64, "0");
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
