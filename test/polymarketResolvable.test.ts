import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEventPostEmbed } from "../src/embeds.js";
import {
  fetchPolymarketResolvableUpdates,
  polymarketResolvableAdapter,
  resolvePolymarketUrlToResolvableWatches,
  updatePolymarketResolvableWatchlist
} from "../src/integrations/polymarketResolvable.js";
import { polymarketUmaCtfAdapterAddresses } from "../src/integrations/polymarketDisputes.js";
import type { Integration } from "../src/integrations/types.js";

const questionId = "0xb6fd5ea8c21f01471ad673950edd4a1645698946906abb27597e3f3de7bd70f1";
const conditionId = "0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be";
const marketUrl = "https://polymarket.com/market/new-rhianna-album-before-gta-vi-926";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Polymarket resolvable watchlist", () => {
  it("does not make RPC calls when the watchlist is empty", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPolymarketResolvableUpdates(
      {
        settingsJson: JSON.stringify({ watches: [] })
      } as Integration,
      new Date("2026-06-15T00:00:00.000Z")
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.posts).toHaveLength(0);
    expect(result.checkFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Watched markets", value: "0" }),
        expect.objectContaining({ name: "Polygon RPC calls", value: "0" })
      ])
    );
  });

  it("extracts questionID and conditionId from a Polymarket market URL through Gamma", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const target = url.toString();
      if (target === "https://gamma-api.polymarket.com/markets?slug=new-rhianna-album-before-gta-vi-926") {
        return jsonResponse([]);
      }
      if (target === "https://gamma-api.polymarket.com/markets?slug=new-rhianna-album-before-gta-vi-926&closed=true") {
        return jsonResponse([
          {
            question: "New Rihanna Album before GTA VI?",
            slug: "new-rhianna-album-before-gta-vi-926",
            questionID: questionId,
            conditionId
          }
        ]);
      }

      throw new Error(`Unexpected fetch: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const watches = await resolvePolymarketUrlToResolvableWatches(marketUrl, new Date("2026-06-15T00:00:00.000Z"));

    expect(watches).toEqual([
      expect.objectContaining({
        question: "New Rihanna Album before GTA VI?",
        url: marketUrl,
        questionId,
        conditionId,
        lastStatus: "pending"
      })
    ]);
  });

  it("adds, lists, and removes watched markets in settingsJson", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const target = url.toString();
        if (target.endsWith("&closed=true")) {
          return jsonResponse([
            {
              question: "New Rihanna Album before GTA VI?",
              slug: "new-rhianna-album-before-gta-vi-926",
              questionID: questionId
            }
          ]);
        }

        return jsonResponse([]);
      })
    );

    const add = await updatePolymarketResolvableWatchlist({ settingsJson: null } as Integration, "add", marketUrl);
    expect(add.changed).toBe(true);
    expect(add.watches).toHaveLength(1);

    const list = await updatePolymarketResolvableWatchlist({ settingsJson: add.settingsJson } as Integration, "list");
    expect(list.message).toBe("1 market(s) configured.");

    const remove = await updatePolymarketResolvableWatchlist(
      { settingsJson: add.settingsJson } as Integration,
      "remove",
      questionId
    );
    expect(remove.changed).toBe(true);
    expect(remove.watches).toHaveLength(0);
  });

  it("alerts and removes a watched market when ready(questionID) returns true", async () => {
    const rpcUrl = "https://rpc.example";
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = url.toString();
      if (target !== rpcUrl) {
        throw new Error(`Unexpected fetch: ${target}`);
      }

      const body = JSON.parse(String(init?.body)) as { method: string; params: Array<Record<string, string>> };
      expect(body.method).toBe("eth_call");
      const call = body.params[0];
      expect(call.data).toContain(questionId.slice(2));
      return jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: call.to === polymarketUmaCtfAdapterAddresses[1] ? boolWord(true) : boolWord(false)
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPolymarketResolvableUpdates(
      {
        settingsJson: JSON.stringify({
          rpcUrl,
          watches: [
            {
              question: "New Rihanna Album before GTA VI?",
              url: marketUrl,
              questionId,
              conditionId,
              addedAt: "2026-06-15T00:00:00.000Z",
              lastStatus: "pending"
            }
          ]
        })
      } as Integration,
      new Date("2026-06-15T01:00:00.000Z")
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      id: `resolvable:${questionId}`,
      type: "Polymarket resolvable",
      alertTitle: "Polymarket market ready to resolve",
      polymarketUrl: marketUrl
    });
    expect(JSON.parse(result.settingsJson ?? "{}").watches).toEqual([]);
  });

  it("formats the ready alert with the market question first", () => {
    const post = {
      id: `resolvable:${questionId}`,
      type: "Polymarket resolvable",
      alertTitle: "Polymarket market ready to resolve",
      sourceLabel: "UMA adapter",
      buttonLabel: "Open adapter",
      mentionAlertRole: true,
      text: "UMA CTF Adapter ready(questionID) returned true.",
      qualifyingText: "New Rihanna Album before GTA VI?",
      postedAt: new Date("2026-06-15T01:00:00.000Z"),
      url: `https://polygonscan.com/address/${polymarketUmaCtfAdapterAddresses[1]}#readContract`,
      polymarketUrl: marketUrl,
      prioritySummary: {
        question: "New Rihanna Album before GTA VI?",
        questionUrl: marketUrl,
        conditionId
      },
      hideDefaultEventFields: true,
      hideLinksField: true,
      hideTextField: true,
      fields: [{ name: "Status", value: "**READY TO RESOLVE**", inline: false }],
      hiddenFields: [{ name: "Question ID", value: questionId, inline: false }],
      imageUrls: [],
      imageText: "",
      matchedTerms: [],
      strikeTerms: []
    };

    const [embed] = buildEventPostEmbed(
      {
        adapterId: polymarketResolvableAdapter.id,
        displayName: polymarketResolvableAdapter.displayName,
        status: "active",
        settingsJson: null
      } as Integration,
      post
    );

    const fields = embed.toJSON().fields ?? [];
    expect(fields[0]).toMatchObject({ name: "Question", value: expect.stringContaining("New Rihanna Album before GTA VI?") });
    expect(fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Status", value: "**READY TO RESOLVE**" })]));
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" }
  });
}

function boolWord(value: boolean): string {
  return `0x${(value ? 1n : 0n).toString(16).padStart(64, "0")}`;
}
