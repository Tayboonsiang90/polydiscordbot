import { MessageFlags, type StringSelectMenuInteraction } from "discord.js";
import {
  buildArbitrageSideSelectRow,
  parseArbitrageSelectCustomId,
  parseArbitrageWatchSide
} from "./arbitrageControls.js";
import type { BotDatabase } from "./database.js";
import { buildArbitrageSetupEmbed, buildArbitrageWatchEmbed } from "./embeds.js";
import { getAdapter } from "./integrations/registry.js";

export async function handleArbitrageSelectMenu(
  interaction: StringSelectMenuInteraction,
  database: BotDatabase
): Promise<boolean> {
  const parsed = parseArbitrageSelectCustomId(interaction.customId);
  if (!parsed) {
    return false;
  }

  const integration = database.getIntegrationById(parsed.integrationId);
  if (interaction.guildId && integration.guildId !== interaction.guildId) {
    await interaction.reply({
      content: "This arbitrage setup belongs to another server.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const adapter = getAdapter(integration.adapterId);
  const value = interaction.values[0];
  if (!value) {
    await interaction.reply({ content: "No selection was received.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (parsed.stage === "outcome") {
    if (!adapter.selectArbitrageOutcome) {
      await interaction.reply({ content: "This integration does not support arbitrage setup.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const result = adapter.selectArbitrageOutcome(integration, Number(value));
    const updated =
      result.settingsJson !== integration.settingsJson
        ? database.setSettingsJson(integration.id, result.settingsJson)
        : integration;
    await interaction.update({
      embeds: [buildArbitrageSetupEmbed(updated, result)],
      components: buildArbitrageSideSelectRow(updated)
    });
    return true;
  }

  if (!adapter.selectArbitrageSide) {
    await interaction.reply({ content: "This integration does not support arbitrage setup.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const side = parseArbitrageWatchSide(value);
  if (!side) {
    await interaction.reply({ content: "Choose YES, NO, or BOTH.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const result = adapter.selectArbitrageSide(integration, side);
  const updated =
    result.settingsJson !== integration.settingsJson
      ? database.setSettingsJson(integration.id, result.settingsJson)
      : integration;
  await interaction.update({
    embeds: [buildArbitrageWatchEmbed(updated, result)],
    components: []
  });
  return true;
}
