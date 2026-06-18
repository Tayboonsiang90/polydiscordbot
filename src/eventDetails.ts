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
import { enrichEventPostAddressProfiles } from "./addressLabels.js";
import { getAdapter } from "./integrations/registry.js";
import { syncUmaAddressLabels } from "./umaAddressLabels.js";
import {
  addressLabelModalNameInputId,
  buildAddressLabelModalCustomId,
  buildAddressLabelsEmbed,
  buildEventPostDetailsEmbed,
  buildEventPostMessagePayload,
  parseAddressLabelButtonCustomId,
  parseAddressLabelModalCustomId,
  parseEventDetailsCustomId,
  parseEventRefreshCustomId
} from "./embeds.js";
import type { EventMonitorPost } from "./integrations/types.js";

export async function handleEventDetailsButton(
  interaction: ButtonInteraction,
  database: BotDatabase
): Promise<boolean> {
  const addressLabel = parseAddressLabelButtonCustomId(interaction.customId);
  if (addressLabel) {
    await interaction.showModal(buildAddressLabelModal(addressLabel));
    return true;
  }

  const refresh = parseEventRefreshCustomId(interaction.customId);
  if (refresh) {
    await handleEventRefreshButton(interaction, database, refresh);
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

async function handleEventRefreshButton(
  interaction: ButtonInteraction,
  database: BotDatabase,
  parsed: { integrationId: number; eventId: string }
): Promise<void> {
  const alert = database.getEventAlert(parsed.integrationId, parsed.eventId);
  if (!alert) {
    await interaction.reply({
      content: "Stored alert data is no longer available for refresh.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const integration = database.getIntegrationById(parsed.integrationId);
  if (!supportsUmaAddressRefresh(integration.adapterId, alert.post)) {
    await interaction.reply({
      content: "This alert does not support refresh.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const refreshedPost = await enrichEventPostAddressProfiles(stripUmaAddressEnrichment(alert.post), {
    bypassProfileCache: true
  });
  database.updateEventAlertPost(integration.id, alert.eventId, refreshedPost);
  const payload = buildEventPostMessagePayload(integration, refreshedPost);
  await interaction.message.edit({
    content: payload.content ?? null,
    embeds: payload.embeds,
    components: payload.components,
    allowedMentions: { parse: [] }
  });
  await interaction.editReply("Refreshed UMA address data and updated this alert.");
}

function supportsUmaAddressRefresh(adapterId: string, post: EventMonitorPost): boolean {
  if (adapterId !== "polymarket-proposals" && adapterId !== "polymarket-disputes") {
    return false;
  }

  return Boolean(post.prioritySummary?.proposer || post.prioritySummary?.disputer);
}

function stripUmaAddressEnrichment(post: EventMonitorPost): EventMonitorPost {
  if (!post.prioritySummary) {
    return post;
  }

  const prioritySummary = { ...post.prioritySummary };
  delete prioritySummary.proposerProfile;
  delete prioritySummary.proposerAligned;
  delete prioritySummary.proposerHedge;
  delete prioritySummary.disputerProfile;
  delete prioritySummary.disputerAligned;
  delete prioritySummary.disputerHedge;

  return {
    ...post,
    prioritySummary
  };
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
