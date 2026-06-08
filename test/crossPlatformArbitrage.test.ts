import { afterEach, describe, expect, it } from "vitest";
import {
  calculatePlatformFee,
  configureCrossPlatformArbitrageWatch,
  evaluateArbitrage,
  prepareCrossPlatformArbitrageSetup,
  selectCrossPlatformArbitrageOutcome,
  selectCrossPlatformArbitrageSide
} from "../src/integrations/crossPlatformArbitrage.js";
import type { Integration } from "../src/integrations/types.js";

const originalFetch = globalThis.fetch;
const originalPredictApiKey = process.env.PREDICT_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalPredictApiKey === undefined) {
    delete process.env.PREDICT_API_KEY;
  } else {
    process.env.PREDICT_API_KEY = originalPredictApiKey;
  }
});

describe("cross-platform arbitrage", () => {
  it("calculates taker fees with platform-specific formulas", () => {
    expect(calculatePlatformFee({ platform: "polymarket", feesEnabled: true, rate: 0.04 }, 0.6, 10)).toBeCloseTo(0.096);
    expect(calculatePlatformFee({ platform: "predict", feeRateBps: 200 }, 0.6, 10)).toBeCloseTo(0.08);
    expect(
      calculatePlatformFee(
        {
          platform: "opinion",
          topicRate: 0.08,
          minFeeUsd: 0.5,
          userDiscount: 0,
          transactionDiscount: 0,
          referralDiscount: 0
        },
        0.6,
        10
      )
    ).toBeCloseTo(0.5);
  });

  it("finds a hedged package and reports executable steps after fees", () => {
    const opportunity = evaluateArbitrage(
      [
        {
          platform: "predict",
          url: "https://predict.fun/market/ipos-before-2027",
          title: "IPOs before 2027",
          label: "Discord",
          marketId: "predict-discord",
          feeModel: { platform: "predict", feeRateBps: 200 },
          books: {
            YES: {
              asks: [{ price: 0.42, size: 30 }],
              bids: [{ price: 0.4, size: 30 }]
            },
            NO: {
              asks: [{ price: 0.6, size: 30 }],
              bids: [{ price: 0.5, size: 30 }]
            }
          }
        },
        {
          platform: "polymarket",
          url: "https://polymarket.com/event/ipos-before-2027",
          title: "IPOs before 2027",
          label: "Discord",
          marketId: "polymarket-discord",
          feeModel: { platform: "polymarket", feesEnabled: true, rate: 0.04 },
          books: {
            YES: {
              asks: [{ price: 0.54, size: 30 }],
              bids: [{ price: 0.4, size: 30 }]
            },
            NO: {
              asks: [{ price: 0.52, size: 30 }],
              bids: [{ price: 0.5, size: 30 }]
            }
          }
        }
      ] as never,
      {
        outcome: "Discord",
        side: "BOTH",
        maxStakeUsd: 25,
        minNetEdgeBps: 10
      }
    );

    expect(opportunity?.kind).toBe("hedged-package");
    expect(opportunity?.netProfitUsd).toBeGreaterThan(1);
    expect(opportunity?.actions.map((action) => `${action.verb} ${action.side} ${action.platform}`)).toEqual([
      "BUY YES predict",
      "BUY NO polymarket"
    ]);
  });

  it("guides setup from shared outcomes to a stored watch", async () => {
    process.env.PREDICT_API_KEY = "test-key";
    globalThis.fetch = async (url, init) => {
      const textUrl = String(url);
      if (textUrl.startsWith("https://gamma-api.polymarket.com/events")) {
        return jsonResponse({
          title: "IPOs before 2027?",
          markets: [
            {
              id: "pm-discord",
              slug: "discord-ipo-before-2027",
              groupItemTitle: "Discord",
              active: true,
              closed: false,
              archived: false,
              clobTokenIds: JSON.stringify(["pm-discord-yes", "pm-discord-no"])
            },
            {
              id: "pm-openai",
              slug: "openai-ipo-before-2027",
              groupItemTitle: "OpenAI",
              active: true,
              closed: false,
              archived: false,
              clobTokenIds: JSON.stringify(["pm-openai-yes", "pm-openai-no"])
            }
          ]
        });
      }

      if (textUrl.startsWith("https://api.predict.fun/v1/search")) {
        expect(init?.headers).toMatchObject({ "x-api-key": "test-key" });
        return jsonResponse({
          data: {
            categories: [
              {
                slug: "ipos-before-2027",
                title: "IPOs before 2027",
                markets: [
                  { id: "predict-discord", slug: "discord-ipo-before-2027", title: "Discord IPO before 2027?" },
                  { id: "predict-openai", slug: "openai-ipo-before-2027", title: "OpenAI IPO before 2027?" }
                ]
              }
            ]
          }
        });
      }

      return jsonResponse({}, 404);
    };

    const setup = await prepareCrossPlatformArbitrageSetup(buildIntegration(), {
      urls: ["https://predict.fun/market/ipos-before-2027", "https://polymarket.com/event/ipos-before-2027"],
      maxStakeUsd: 50,
      minNetEdgeBps: 75
    });
    expect(setup.outcomes.map((outcome) => outcome.label)).toEqual(["Discord", "OpenAI"]);

    const withPending = buildIntegration(setup.settingsJson);
    const selected = selectCrossPlatformArbitrageOutcome(withPending, 0);
    expect(selected.selectedOutcome).toBe("Discord");

    const watched = selectCrossPlatformArbitrageSide(buildIntegration(selected.settingsJson), "YES");
    expect(watched.watch).toMatchObject({
      outcome: "Discord",
      side: "YES",
      maxStakeUsd: 50,
      minNetEdgeBps: 75
    });
  });

  it("configures a watch directly when the outcome exists on every platform", async () => {
    process.env.PREDICT_API_KEY = "test-key";
    globalThis.fetch = async (url) => {
      const textUrl = String(url);
      if (textUrl.startsWith("https://gamma-api.polymarket.com/events")) {
        return jsonResponse({
          title: "IPOs before 2027?",
          markets: [
            {
              id: "pm-discord",
              slug: "discord-ipo-before-2027",
              groupItemTitle: "Discord",
              active: true,
              closed: false,
              archived: false,
              clobTokenIds: JSON.stringify(["pm-discord-yes", "pm-discord-no"])
            }
          ]
        });
      }
      if (textUrl.startsWith("https://api.predict.fun/v1/search")) {
        return jsonResponse({
          data: {
            categories: [
              {
                slug: "ipos-before-2027",
                title: "IPOs before 2027",
                markets: [{ id: "predict-discord", slug: "discord-ipo-before-2027", title: "Discord IPO before 2027?" }]
              }
            ]
          }
        });
      }
      return jsonResponse({}, 404);
    };

    const result = await configureCrossPlatformArbitrageWatch(buildIntegration(), {
      urls: ["https://predict.fun/market/ipos-before-2027", "https://polymarket.com/event/ipos-before-2027"],
      outcome: "Discord",
      side: "BOTH",
      maxStakeUsd: 25,
      minNetEdgeBps: 50
    });

    expect(result.watch?.outcome).toBe("Discord");
    expect(JSON.parse(result.settingsJson)).toMatchObject({
      watch: {
        outcome: "Discord",
        side: "BOTH"
      }
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function buildIntegration(settingsJson: string | null = null): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "cross-platform-arbitrage",
    displayName: "Cross-Platform Arbitrage",
    sourceUrl: "https://polymarket.com",
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
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z"
  };
}
