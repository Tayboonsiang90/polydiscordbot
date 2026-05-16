import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAdapterCommand } from "../src/commands.js";
import { BotDatabase } from "../src/database.js";

let tempDir: string | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

function createTestDatabase(): BotDatabase {
  tempDir = mkdtempSync(join(tmpdir(), "polybot-trumptruth-commands-"));
  return new BotDatabase(join(tempDir, "bot.sqlite"));
}

describe("Trump Truth commands", () => {
  it("appends weekly Polymarket URLs through the polymarket command", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            markets: [
              {
                question: 'Will Trump post "Trust" on Truth Social this week?',
                closed: false,
                outcomes: '["Yes","No"]',
                outcomePrices: '["0.4","0.6"]'
              }
            ]
          }
        ]
      })
    );
    const database = createTestDatabase();
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "channel",
      adapterId: "trump-truth",
      displayName: "Trump Truth Social",
      sourceUrl: "https://truthsocial.com/@realDonaldTrump",
      polymarketUrl: "https://polymarket.com/event/what-will-trump-post-this-week-may-4-may-10",
      settingsJson: JSON.stringify({
        markets: [
          {
            url: "https://polymarket.com/event/what-will-trump-post-this-week-may-4-may-10",
            slug: "what-will-trump-post-this-week-may-4-may-10",
            startAt: "2026-05-04T04:00:00.000Z",
            endAt: "2026-05-11T03:59:00.000Z",
            strikeTerms: ["King"],
            resolvedTerms: [],
            activeStrikeTerms: ["King"]
          }
        ]
      }),
      pollIntervalMinutes: 5
    });
    const interaction = {
      guild: { id: "guild" },
      channel: { id: "channel" },
      commandName: "trumptruth",
      options: {
        getSubcommand: () => "polymarket",
        getString: () => "https://polymarket.com/event/what-will-trump-post-this-week-may-11-may-17"
      },
      deferReply: vi.fn(),
      editReply: vi.fn()
    };

    await handleAdapterCommand(interaction as never, database);
    const updated = database.getIntegrationById(integration.id);
    const settings = JSON.parse(updated.settingsJson ?? "{}") as { markets?: Array<{ url?: string }> };

    expect(interaction.deferReply).toHaveBeenCalledOnce();
    expect(interaction.editReply).toHaveBeenCalledOnce();
    expect(settings.markets).toHaveLength(2);
    expect(settings.markets?.map((market) => market.url)).toEqual(
      expect.arrayContaining(["https://polymarket.com/event/what-will-trump-post-this-week-may-11-may-17"])
    );
    database.close();
  });
});
