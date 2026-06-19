import { describe, expect, it, vi } from "vitest";
import { handleEventDetailsButton, handleEventDetailsModalSubmit } from "../src/eventDetails.js";
import { buildAddressLabelModalCustomId } from "../src/embeds.js";
import type { BotDatabase } from "../src/database.js";

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
