import { afterEach, describe, expect, it, vi } from "vitest";
import { testOnlyAddressLabelHelpers } from "../src/addressLabels.js";
import { buildEventPostEmbed } from "../src/embeds.js";
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
  updatePolymarketProposalTagBlocklist,
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
  testOnlyAddressLabelHelpers.resetProfileCache();
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

      if (target.startsWith("https://gamma-api.polymarket.com/public-profile")) {
        const url = new URL(target);
        expect(url.searchParams.get("address")).toBe(proposer);
        return jsonResponse({ proxyWallet: proposer, displayUsernamePublic: true, name: "KnownProposer" });
      }

      if (target.startsWith("https://data-api.polymarket.com/trades")) {
        const url = new URL(target);
        expect(url.searchParams.get("user")).toBe(proposer);
        expect(url.searchParams.get("limit")).toBe("1");
        expect(url.searchParams.get("takerOnly")).toBe("false");
        return jsonResponse([{ proxyWallet: proposer, side: "BUY" }]);
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
    expect(result.posts[0].hiddenFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Matched tags", value: "Sports" }),
        expect.objectContaining({ name: "On-chain tx", value: `https://polygonscan.com/tx/${transactionHash}` })
      ])
    );
    expect(result.posts[0].prioritySummary).toMatchObject({
      question: "Lakers win?",
      questionUrl: "https://polymarket.com/market/lakers-win",
      betmoarUrl: "https://betmoar.fun/market/lakers-win",
      proposedOutcome: "NO (0)",
      marketTags: ["Sports", "NBA"],
      matchedTags: ["Sports"],
      proposer,
      proposerProfile: expect.objectContaining({
        address: proposer,
        profileUrl: "https://polymarket.com/@KnownProposer",
        profileName: "KnownProposer",
        hasTrades: true
      })
    });
    expect(result.posts[0].fields?.some((field) => field.name === "Currency") ?? false).toBe(false);
    expect(result.posts[0].hiddenFields?.some((field) => field.name === "Proposed outcome") ?? false).toBe(false);
    const embedFields = buildEventPostEmbed(
      buildIntegration(JSON.stringify({ addressLabels: [{ address: proposer, label: "Known Proposer" }] })),
      result.posts[0]
    )[0].data.fields ?? [];
    expect(embedFields.slice(0, 8).map((field) => field.name)).toEqual([
      "Question",
      "Proposed outcome",
      "Posted at (SGT)",
      "Proposal expiration (SGT)",
      "Posted at (ET)",
      "Proposal expiration (ET)",
      "Market tags",
      "Proposer"
    ]);
    expect(embedFields[0]).toEqual({
      name: "Question",
      value: "**[Lakers win?](https://polymarket.com/market/lakers-win)** · [Betmoar](https://betmoar.fun/market/lakers-win)",
      inline: false
    });
    expect(embedFields[1]).toEqual({ name: "Proposed outcome", value: "**NO (0)**", inline: false });
    expect(embedFields).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Market tags", value: "**Sports**, NBA" })]));
    expect(embedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Proposer",
          value: `Known Proposer ([Polymarket: KnownProposer](https://polymarket.com/@KnownProposer))\n${proposer}`
        })
      ])
    );
    expect(embedFields).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "Links" })]));
    expect(embedFields).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "On-chain tx" })]));
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

  it("marks proposal alerts when proposed-side shares are available on the CLOB book", async () => {
    const rpcUrl = "https://rpc.example";
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
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

      if (target.startsWith("https://clob.polymarket.com/markets-by-question-id/")) {
        return jsonResponse({
          question: "Lakers win?",
          market_slug: "lakers-win",
          condition_id: "0xcondition",
          tags: ["Sports", "NBA"],
          tokens: [
            { token_id: "yes-token", outcome: "Yes" },
            { token_id: "no-token", outcome: "No" }
          ]
        });
      }

      if (target.startsWith("https://clob.polymarket.com/book?")) {
        const bookUrl = new URL(target);
        expect(bookUrl.searchParams.get("token_id")).toBe("no-token");
        return jsonResponse({
          asks: [
            { price: "0.050", size: "100" },
            { price: "0.037", size: "12.5" }
          ],
          bids: []
        });
      }

      if (target.startsWith("https://gamma-api.polymarket.com/public-profile")) {
        return new Response("not found", { status: 404 });
      }

      if (target.startsWith("https://data-api.polymarket.com/trades")) {
        return jsonResponse([]);
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
    expect(result.posts[0].alertTitle).toBe("Polymarket UMA proposal - proposed-side shares available");
    expect(result.posts[0].text).toContain("Penny pick liquidity: NO SHARES AVAILABLE | Best ask: $0.037");
    expect(result.posts[0].prioritySummary).toMatchObject({
      proposedOutcome: "NO (0)",
      proposedSideLiquidity: ">>> **NO SHARES AVAILABLE**\nBest ask: **`$0.037`**\nAt best: **`12.5 shares`**\nTotal asks: **`112.5 shares`**"
    });
    expect(result.posts[0].hiddenFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Penny pick check", value: "CLOB orderbook checked: proposed-side asks found." })
      ])
    );

    const embedFields = buildEventPostEmbed(buildIntegration(), result.posts[0])[0].data.fields ?? [];
    expect(embedFields.slice(0, 3).map((field) => field.name)).toEqual([
      "Question",
      "Proposed outcome",
      "PENNY PICK LIQUIDITY"
    ]);
    expect(embedFields[2]).toEqual({
      name: "PENNY PICK LIQUIDITY",
      value: ">>> **NO SHARES AVAILABLE**\nBest ask: **`$0.037`**\nAt best: **`12.5 shares`**\nTotal asks: **`112.5 shares`**",
      inline: false
    });
  });

  it("checks whether the proposer holds opposite-side Polymarket shares", async () => {
    const rpcUrl = "https://rpc.example";
    const conditionId = `0x${"a".repeat(64)}`;
    const proxyWallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
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

      if (target.startsWith("https://clob.polymarket.com/markets-by-question-id/")) {
        return jsonResponse({
          question: "Lakers win?",
          market_slug: "lakers-win",
          condition_id: conditionId,
          tags: ["Sports", "NBA"]
        });
      }

      if (target.startsWith("https://gamma-api.polymarket.com/public-profile")) {
        return jsonResponse({ proxyWallet, displayUsernamePublic: true, name: "KnownProposer" });
      }

      if (target.startsWith("https://data-api.polymarket.com/trades")) {
        const tradesUrl = new URL(target);
        expect(tradesUrl.searchParams.get("user")).toBe(proxyWallet);
        return jsonResponse([{ proxyWallet, side: "BUY" }]);
      }

      if (target.startsWith("https://data-api.polymarket.com/positions")) {
        const positionsUrl = new URL(target);
        expect(positionsUrl.searchParams.get("user")).toBe(proxyWallet);
        expect(positionsUrl.searchParams.get("market")).toBe(conditionId);
        expect(positionsUrl.searchParams.get("sizeThreshold")).toBe("0");
        return jsonResponse([
          {
            conditionId,
            outcome: "Yes",
            size: "12.5",
            currentValue: "1.25",
            avgPrice: "0.02",
            curPrice: "0.1",
            title: "Lakers win?",
            slug: "lakers-win"
          }
        ]);
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

    expect(result.posts[0].prioritySummary).toMatchObject({
      conditionId,
      proposedOutcomeSide: "NO",
      proposerHedge: expect.objectContaining({
        address: proposer,
        profileWallet: proxyWallet,
        conditionId,
        oppositeOutcome: "YES",
        hasOppositePosition: true,
        size: 12.5,
        currentValue: 1.25,
        avgPrice: 0.02,
        curPrice: 0.1
      })
    });

    const embedFields = buildEventPostEmbed(buildIntegration(), result.posts[0])[0].data.fields ?? [];
    expect(embedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Proposer hedge",
          value: ">>> **HEDGED: HOLDS YES**\nSize: **`12.5 shares`**\nCurrent value: **`$1.25`**\nAvg price: **`$0.02`**\nMark price: **`$0.1`**"
        })
      ])
    );
  });

  it("does not mark liquidity when the proposed-side CLOB book is unavailable", async () => {
    const rpcUrl = "https://rpc.example";
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
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

      if (target.startsWith("https://clob.polymarket.com/markets-by-question-id/")) {
        return jsonResponse({
          question: "Trump declassifies new UFO files by May 31?",
          market_slug: "trump-declassifies-new-ufo-files-by-may-31-691",
          condition_id: "0xcondition",
          tags: ["Politics", "Aliens", "Trump", "Culture"],
          tokens: [
            { token_id: "yes-token", outcome: "Yes" },
            { token_id: "no-token", outcome: "No" }
          ]
        });
      }

      if (target.startsWith("https://clob.polymarket.com/book?")) {
        const bookUrl = new URL(target);
        expect(bookUrl.searchParams.get("token_id")).toBe("no-token");
        return new Response("upstream timeout", { status: 504 });
      }

      if (target.startsWith("https://gamma-api.polymarket.com/public-profile")) {
        return new Response("not found", { status: 404 });
      }

      if (target.startsWith("https://data-api.polymarket.com/trades")) {
        return jsonResponse([]);
      }

      throw new Error(`Unexpected fetch: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPolymarketProposalUpdates(
      {
        settingsJson: JSON.stringify({
          rpcUrl,
          lastScannedBlock: 980,
          tagFilters: [{ id: "2", label: "Politics", slug: "politics" }]
        })
      } as Integration,
      new Date("2026-06-01T04:16:00.000Z")
    );

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].alertTitle).toBe("Polymarket UMA proposal");
    expect(result.posts[0].prioritySummary).toMatchObject({
      proposedOutcome: "NO (0)"
    });
    expect(result.posts[0].prioritySummary?.proposedSideLiquidity).toBeUndefined();
    expect(result.posts[0].hiddenFields).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Penny pick check", value: "CLOB orderbook failed: HTTP 504" })])
    );
    const embedFields = buildEventPostEmbed(buildIntegration(), result.posts[0])[0].data.fields ?? [];
    expect(embedFields).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "PENNY PICK LIQUIDITY" })]));
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("https://gamma-api.polymarket.com/markets?"), expect.anything());
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

  it("does not alert a subscribed tag when the market also has that subscription's excluded tag", async () => {
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

        if (target.startsWith("https://clob.polymarket.com/markets-by-question-id/")) {
          return jsonResponse({
            question: "Trump mention?",
            market_slug: "trump-mention",
            condition_id: "0xcondition",
            tags: ["Politics", "Mentions"]
          });
        }

        throw new Error(`Unexpected fetch: ${target}`);
      })
    );

    const result = await fetchPolymarketProposalUpdates(
      {
        settingsJson: JSON.stringify({
          rpcUrl,
          lastScannedBlock: 980,
          tagFilters: [
            {
              id: "1",
              label: "Politics",
              slug: "politics",
              excludedTags: [{ id: "3", label: "Mentions", slug: "mentions" }]
            }
          ]
        })
      } as Integration,
      new Date("2026-05-21T00:00:00.000Z")
    );

    expect(result.posts).toHaveLength(0);
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

  it("stores per-subscription excluded proposal tags", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const target = url.toString();
        if (target === "https://gamma-api.polymarket.com/tags/slug/mentions") {
          return jsonResponse({ id: "3", label: "Mentions", slug: "mentions" });
        }

        throw new Error(`Unexpected fetch: ${target}`);
      })
    );

    const result = await updatePolymarketProposalTagBlocklist(
      {
        settingsJson: JSON.stringify({
          tagFilters: [{ id: "1", label: "Politics", slug: "politics", channelId: "politics-channel", channelName: "uma-proposals-politics" }]
        })
      } as Integration,
      "politics",
      "add",
      "mentions"
    );

    expect(result.changed).toBe(true);
    expect(result.blockedTags).toEqual([{ id: "3", label: "Mentions", slug: "mentions" }]);
    expect(getPolymarketProposalTagFiltersFromSettingsJson(result.settingsJson)).toEqual([
      {
        id: "1",
        label: "Politics",
        slug: "politics",
        channelId: "politics-channel",
        channelName: "uma-proposals-politics",
        excludedTags: [{ id: "3", label: "Mentions", slug: "mentions" }]
      }
    ]);
  });

  it("does not route a proposal to a tag channel when that subscription excludes another market tag", () => {
    const integration = {
      settingsJson: JSON.stringify({
        tagFilters: [
          {
            id: "1",
            label: "Politics",
            slug: "politics",
            channelId: "politics-channel",
            channelName: "uma-proposals-politics",
            excludedTags: [{ id: "3", label: "Mentions", slug: "mentions" }]
          },
          { id: "2", label: "Trump", slug: "trump", channelId: "trump-channel", channelName: "uma-proposals-trump" }
        ]
      })
    } as Integration;
    const post = {
      prioritySummary: {
        marketTags: ["Politics", "Mentions", "Trump"],
        matchedTags: ["Politics", "Trump"]
      },
      fields: []
    } as unknown as EventMonitorPost;

    expect(resolvePolymarketProposalChannelIds(integration, post)).toEqual(["trump-channel"]);
  });
});

function buildIntegration(settingsJson: string | null = null): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "polymarket-proposals",
    displayName: "UMA Proposal Alerts",
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
