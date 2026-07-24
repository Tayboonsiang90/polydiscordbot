import { describe, expect, it, vi } from "vitest";
import { handleEventDetailsButton, handleEventDetailsModalSubmit } from "../src/eventDetails.js";
import { buildAddressLabelModalCustomId, buildEventStrikeIgnoreModalCustomId, eventStrikeIgnoreTermsInputId } from "../src/embeds.js";
import type { BotDatabase } from "../src/database.js";
import type { EventMonitorPost, Integration } from "../src/integrations/types.js";

const address = "0x1111111111111111111111111111111111111111";

describe("event details interactions", () => {
  it("rejects stale address label buttons for unloaded adapters without throwing", async () => {
    const database = buildDatabase("ika-departures");
    const interaction = {
      customId: `address-label:123:proposer:${address}`,
      reply: vi.fn(),
      showModal: vi.fn()
    };

    await expect(handleEventDetailsButton(interaction as never, database)).resolves.toBe(true);

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("adapter that is no longer loaded: ika-departures")
      })
    );
  });

  it("rejects stale address label modals for unloaded adapters without throwing", async () => {
    const database = buildDatabase("ika-departures");
    const interaction = {
      customId: buildAddressLabelModalCustomId(123, "proposer", address),
      fields: {
        getTextInputValue: vi.fn().mockReturnValue("Known proposer")
      },
      reply: vi.fn()
    };

    await expect(handleEventDetailsModalSubmit(interaction as never, database)).resolves.toBe(true);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("adapter that is no longer loaded: ika-departures")
      })
    );
  });

  it("opens a strike ignore modal from a Trump Truth strike alert", async () => {
    const database = buildStrikeIgnoreDatabase();
    const interaction = {
      customId: "event-strike-ignore:123:116936532955860241",
      reply: vi.fn(),
      showModal: vi.fn()
    };

    await expect(handleEventDetailsButton(interaction as never, database)).resolves.toBe(true);

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.showModal).toHaveBeenCalledOnce();
    expect(interaction.showModal.mock.calls[0]?.[0].toJSON()).toMatchObject({
      title: "Ignore false-positive strike"
    });
  });

  it("stores ignored Trump Truth strike terms and edits the original alert", async () => {
    const database = buildStrikeIgnoreDatabase();
    const edit = vi.fn();
    const interaction = {
      customId: buildEventStrikeIgnoreModalCustomId(123, "116936532955860241"),
      fields: {
        getTextInputValue: vi.fn((inputId: string) => inputId === eventStrikeIgnoreTermsInputId ? "AI" : "")
      },
      message: { edit },
      reply: vi.fn()
    };

    await expect(handleEventDetailsModalSubmit(interaction as never, database)).resolves.toBe(true);

    expect(database.setSettingsJson).toHaveBeenCalledWith(123, expect.stringContaining('"ignoredStrikeTerms":["AI"]'));
    expect(database.updateEventAlertPost).toHaveBeenCalledWith(
      123,
      "116936532955860241",
      expect.objectContaining({
        matchedTerms: [],
        strikeTerms: ["King"],
        alertTitle: "Trump Truth Social - New post"
      })
    );
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ allowedMentions: { parse: [] } }));
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Ignored false-positive strike term(s): AI.")
      })
    );
  });
});

function buildDatabase(adapterId: string): BotDatabase {
  return {
    getIntegrationById: vi.fn().mockReturnValue({
      id: 123,
      guildId: "guild",
      channelId: "channel",
      adapterId,
      displayName: "Stale Integration",
      sourceUrl: "https://example.com",
      polymarketUrl: null,
      settingsJson: null,
      pollIntervalMinutes: 60,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
  } as unknown as BotDatabase;
}

function buildStrikeIgnoreDatabase(): BotDatabase {
  const integration = buildTrumpTruthIntegration();
  const post = buildTrumpTruthPost();
  return {
    getIntegrationById: vi.fn().mockReturnValue(integration),
    getEventAlert: vi.fn().mockReturnValue({
      integrationId: integration.id,
      eventId: post.id,
      post
    }),
    setSettingsJson: vi.fn((_id: number, settingsJson: string) => ({ ...integration, settingsJson })),
    updateEventAlertPost: vi.fn()
  } as unknown as BotDatabase;
}

function buildTrumpTruthIntegration(): Integration {
  return {
    id: 123,
    guildId: "guild",
    channelId: "channel",
    adapterId: "trump-truth",
    displayName: "Trump Truth Social",
    sourceUrl: "https://truthsocial.com/@realDonaldTrump",
    polymarketUrl: "https://polymarket.com/event/what-will-trump-post-this-week-july-13-july-19-20260710174050678",
    alertRoleId: "role",
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: "📰",
    settingsJson: JSON.stringify({
      markets: [
        {
          url: "https://polymarket.com/event/what-will-trump-post-this-week-july-13-july-19-20260710174050678",
          slug: "what-will-trump-post-this-week-july-13-july-19-20260710174050678",
          startAt: "2026-07-13T04:00:00.000Z",
          endAt: "2100-01-01T00:00:00.000Z",
          strikeTerms: ["AI", "King"],
          resolvedTerms: [],
          activeStrikeTerms: ["AI", "King"]
        }
      ]
    }),
    pollIntervalMinutes: 5,
    status: "active",
    lastValue: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    snapshotValue: null,
    snapshotCheckedAt: null,
    snapshotDate: null,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z"
  };
}

function buildTrumpTruthPost(): EventMonitorPost {
  return {
    id: "116936532955860241",
    type: "Truth",
    alertTitle: "Trump Truth Social - TEXT STRIKE DETECTED",
    text: "Wait for AI and King",
    qualifyingText: "Wait for AI and King",
    postedAt: new Date("2026-07-17T17:38:00.000Z"),
    url: "https://truthsocial.com/@realDonaldTrump/116936532955860241",
    imageUrls: [],
    imageText: "",
    matchedTerms: ["AI"],
    strikeTerms: ["AI", "King"]
  };
}
