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
import { getAdapter, hasAdapter } from "./integrations/registry.js";
import { syncUmaAddressLabels } from "./umaAddressLabels.js";
import {
  addressLabelModalNameInputId,
  buildAddressLabelModalCustomId,
  buildAddressLabelsEmbed,
  buildEventPostDetailsEmbed,
  buildEventPostMessagePayload,
  buildEventStrikeIgnoreModalCustomId,
  eventStrikeIgnoreTermsInputId,
  parseAddressLabelButtonCustomId,
  parseAddressLabelModalCustomId,
  parseEventDetailsCustomId,
  parseEventRefreshCustomId,
  parseEventStrikeIgnoreButtonCustomId,
  parseEventStrikeIgnoreModalCustomId
} from "./embeds.js";
import type { EventMonitorPost } from "./integrations/types.js";
import { ignoreTrumpTruthStrikeTerms } from "./integrations/trumpTruth.js";

export async function handleEventDetailsButton(
  interaction: ButtonInteraction,
  database: BotDatabase
): Promise<boolean> {
  const strikeIgnore = parseEventStrikeIgnoreButtonCustomId(interaction.customId);
  if (strikeIgnore) {
    await handleStrikeIgnoreButton(interaction, database, strikeIgnore);
    return true;
  }

  const addressLabel = parseAddressLabelButtonCustomId(interaction.customId);
  if (addressLabel) {
    const labelSupport = getAddressLabelSupport(database, addressLabel.integrationId);
    if (!labelSupport.supported) {
      await interaction.reply({
        content: labelSupport.message,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

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
  const strikeIgnore = parseEventStrikeIgnoreModalCustomId(interaction.customId);
  if (strikeIgnore) {
    await handleStrikeIgnoreModalSubmit(interaction, database, strikeIgnore);
    return true;
  }

  const parsed = parseAddressLabelModalCustomId(interaction.customId);
  if (!parsed) {
    return false;
  }

  const nickname = interaction.fields.getTextInputValue(addressLabelModalNameInputId).trim();
  const integration = database.getIntegrationById(parsed.integrationId);
  if (!hasAdapter(integration.adapterId)) {
    await interaction.reply({
      content: `This old alert points to an adapter that is no longer loaded: ${integration.adapterId}. Use a newer UMA alert button instead.`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

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

async function handleStrikeIgnoreButton(
  interaction: ButtonInteraction,
  database: BotDatabase,
  parsed: { integrationId: number; eventId: string }
): Promise<void> {
  const support = getStrikeIgnoreSupport(database, parsed.integrationId);
  if (!support.supported) {
    await interaction.reply({ content: support.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const alert = database.getEventAlert(parsed.integrationId, parsed.eventId);
  if (!alert?.post.matchedTerms.length) {
    await interaction.reply({
      content: "This alert has no matched strike terms to ignore.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.showModal(buildStrikeIgnoreModal(parsed, alert.post.matchedTerms));
}

async function handleStrikeIgnoreModalSubmit(
  interaction: ModalSubmitInteraction,
  database: BotDatabase,
  parsed: { integrationId: number; eventId: string }
): Promise<void> {
  const support = getStrikeIgnoreSupport(database, parsed.integrationId);
  if (!support.supported) {
    await interaction.reply({ content: support.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const terms = parseStrikeIgnoreInput(interaction.fields.getTextInputValue(eventStrikeIgnoreTermsInputId));
  if (!terms.length) {
    await interaction.reply({ content: "No strike terms were provided.", flags: MessageFlags.Ephemeral });
    return;
  }

  const integration = database.getIntegrationById(parsed.integrationId);
  const result = ignoreTrumpTruthStrikeTerms(integration, terms);
  const updatedIntegration =
    result.settingsJson !== integration.settingsJson
      ? database.setSettingsJson(integration.id, result.settingsJson)
      : integration;

  const alert = database.getEventAlert(parsed.integrationId, parsed.eventId);
  if (alert) {
    const updatedPost = removeIgnoredTermsFromPost(alert.post, result.ignoredTerms);
    database.updateEventAlertPost(updatedIntegration.id, alert.eventId, updatedPost);
    const payload = buildEventPostMessagePayload(updatedIntegration, updatedPost);
    if (interaction.message) {
      await interaction.message.edit({
        content: payload.content ?? null,
        embeds: payload.embeds,
        components: payload.components,
        allowedMentions: { parse: [] }
      });
    }
  }

  await interaction.reply({
    content: [
      `Ignored false-positive strike term(s): ${result.ignoredTerms.join(", ")}.`,
      result.activeMarketUrl ? `Scope: ${result.activeMarketUrl}` : "Scope: active Trump Truth market.",
      "Future Trump Truth checks will not count these terms for this market."
    ].join("\n"),
    flags: MessageFlags.Ephemeral
  });
}

function getAddressLabelSupport(database: BotDatabase, integrationId: number): { supported: true } | { supported: false; message: string } {
  let integration;
  try {
    integration = database.getIntegrationById(integrationId);
  } catch {
    return { supported: false, message: "This old alert points to an integration row that no longer exists. Use a newer UMA alert button instead." };
  }

  if (!hasAdapter(integration.adapterId)) {
    return {
      supported: false,
      message: `This old alert points to an adapter that is no longer loaded: ${integration.adapterId}. Use a newer UMA alert button instead.`
    };
  }

  const adapter = getAdapter(integration.adapterId);
  return adapter.updateAddressLabels
    ? { supported: true }
    : { supported: false, message: "This alert does not support address labels." };
}

function getStrikeIgnoreSupport(database: BotDatabase, integrationId: number): { supported: true } | { supported: false; message: string } {
  let integration;
  try {
    integration = database.getIntegrationById(integrationId);
  } catch {
    return { supported: false, message: "This old alert points to an integration row that no longer exists. Use a newer alert button instead." };
  }

  return integration.adapterId === "trump-truth"
    ? { supported: true }
    : { supported: false, message: "This alert does not support strike false-positive ignores." };
}

function buildStrikeIgnoreModal(parsed: { integrationId: number; eventId: string }, matchedTerms: string[]): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildEventStrikeIgnoreModalCustomId(parsed.integrationId, parsed.eventId))
    .setTitle("Ignore false-positive strike")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(eventStrikeIgnoreTermsInputId)
          .setLabel("Terms to ignore for this market")
          .setPlaceholder("Example: AI, Wait for AI")
          .setValue(matchedTerms.join(", "))
          .setMinLength(1)
          .setMaxLength(300)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function parseStrikeIgnoreInput(value: string): string[] {
  return [...new Set(value.split(/[,;\n]/).map((term) => term.trim()).filter(Boolean))];
}

function removeIgnoredTermsFromPost(post: EventMonitorPost, ignoredTerms: string[]): EventMonitorPost {
  const ignored = new Set(ignoredTerms.map((term) => term.trim().toLowerCase()));
  const matchedTerms = post.matchedTerms.filter((term) => !ignored.has(term.trim().toLowerCase()));
  return {
    ...post,
    alertTitle: matchedTerms.length ? post.alertTitle : "Trump Truth Social - New post",
    matchedTerms,
    strikeTerms: post.strikeTerms.filter((term) => !ignored.has(term.trim().toLowerCase()))
  };
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
