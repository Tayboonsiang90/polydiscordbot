import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction
} from "discord.js";
import { BotDatabase } from "./database.js";
import { getAdapter } from "./integrations/registry.js";
import { syncUmaAddressLabels } from "./umaAddressLabels.js";
import {
  addressLabelModalNameInputId,
  buildAddressLabelModalCustomId,
  buildAddressLabelsEmbed,
  buildEventPostDetailsEmbed,
  parseAddressLabelButtonCustomId,
  parseAddressLabelModalCustomId,
  parseEventDetailsCustomId
} from "./embeds.js";

export async function handleEventDetailsButton(
  interaction: ButtonInteraction,
  database: BotDatabase
): Promise<boolean> {
  const addressLabel = parseAddressLabelButtonCustomId(interaction.customId);
  if (addressLabel) {
    await interaction.showModal(buildAddressLabelModal(addressLabel));
    return true;
  }

  const parsed = parseEventDetailsCustomId(interaction.customId);
  if (!parsed) {
    return false;
  }

  const alert = database.getEventAlert(parsed.integrationId, parsed.eventId);
  if (!alert?.post.hiddenFields?.length) {
    await interaction.reply({
      content: "Extra details are no longer available for this alert.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const integration = database.getIntegrationById(parsed.integrationId);
  await interaction.reply({
    embeds: [buildEventPostDetailsEmbed(integration, alert.post)],
    flags: MessageFlags.Ephemeral
  });
  return true;
}

export async function handleEventDetailsModalSubmit(
  interaction: ModalSubmitInteraction,
  database: BotDatabase
): Promise<boolean> {
  const parsed = parseAddressLabelModalCustomId(interaction.customId);
  if (!parsed) {
    return false;
  }

  const nickname = interaction.fields.getTextInputValue(addressLabelModalNameInputId).trim();
  const integration = database.getIntegrationById(parsed.integrationId);
  const adapter = getAdapter(integration.adapterId);
  if (!adapter.updateAddressLabels) {
    await interaction.reply({
      content: "This alert does not support address labels.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const result = await adapter.updateAddressLabels(integration, "add", parsed.address, nickname);
  const updated =
    result.settingsJson !== integration.settingsJson
      ? database.setSettingsJson(integration.id, result.settingsJson)
      : integration;
  const syncedCount = await syncUmaAddressLabels(database, updated.guildId, updated.id, "add", parsed.address, nickname);

  await interaction.reply({
    embeds: [
      buildAddressLabelsEmbed(updated, {
        ...result,
        message: syncedCount > 1 ? `${result.message} Synced across ${syncedCount} UMA integrations.` : result.message
      })
    ],
    flags: MessageFlags.Ephemeral
  });
  return true;
}

function buildAddressLabelModal(parsed: { integrationId: number; role: "proposer" | "disputer"; address: string }): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildAddressLabelModalCustomId(parsed.integrationId, parsed.role, parsed.address))
    .setTitle(`Label ${parsed.role}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(addressLabelModalNameInputId)
          .setLabel("Nickname")
          .setPlaceholder("Example: Known whale")
          .setMinLength(1)
          .setMaxLength(80)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}
