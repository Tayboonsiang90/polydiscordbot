import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction, type TextChannel } from "discord.js";
import type { BotDatabase } from "./database.js";
import type { Guild } from "discord.js";
import type { Message } from "discord.js";
import {
  buildAddressLabelsEmbed,
  buildClearEmbed,
  buildClearErrorsEmbed,
  buildCheckEmbed,
  buildEventCheckEmbed,
  buildIntegrationSummaryEmbeds,
  buildIntervalUpdatedEmbed,
  buildLastEmbed,
  buildMarketEndManualUpdatedEmbed,
  buildPeriodUpdatedEmbed,
  buildPolymarketUpdatedEmbed,
  buildSnapshotStoredEmbed,
  buildStrikeSearchEmbed,
  buildStrikeTermsEmbed,
  buildTagBlocklistEmbed,
  buildTagFiltersEmbed,
  buildTagSearchEmbed,
  buildStatusEmbed
} from "./embeds.js";
import { getAdapter, getAdapterByCommandName, listAdapters } from "./integrations/registry.js";
import {
  getPolymarketProposalTagFilterByChannelId,
  getPolymarketProposalStoredTagFilter,
  getPolymarketProposalTagChannelName,
  getPolymarketProposalTagFiltersFromSettingsJson,
  setPolymarketProposalTagChannel,
  type ProposalTagFilterEntry
} from "./integrations/polymarketProposals.js";
import { parseTrumpTruthSettings, upsertTrumpTruthPolymarketMarket } from "./integrations/trumpTruth.js";
import type {
  AddressLabelAction,
  Integration,
  TagFilterAction,
  TagFilterEntry,
  TagFilterUpdateResult,
  WebsiteAdapter
} from "./integrations/types.js";
import { getStoredOrFetchPolymarketEndDate, parseManualEasternDateTime } from "./marketEnd.js";
import { upsertPolymarketQueueUrl } from "./polymarketQueue.js";
import { mergeSettingsJson } from "./settingsJson.js";
import {
  buildAlertMessagePayload,
  checkEventIntegration,
  checkIntegration,
  getEffectivePollIntervalMinutes,
  getPollIntervalReason,
  type CheckResult
} from "./poller.js";

const roleChannelName = "market-alert-roles";
const checkFailedTitleSuffix = " - Check failed";

export function buildAdapterCommands() {
  return listAdapters().map((adapter) => {
    const command = new SlashCommandBuilder()
      .setName(adapter.commandName)
      .setDescription(`Manage ${adapter.displayName}`)
      .addSubcommand((subcommand) => subcommand.setName("status").setDescription("Show monitor status"))
      .addSubcommand((subcommand) => subcommand.setName("check").setDescription("Fetch the current value now"))
      .addSubcommand((subcommand) => subcommand.setName("test").setDescription("Send a simulated value-change alert"))
      .addSubcommand((subcommand) => subcommand.setName("last").setDescription("Show the last stored value"))
      .addSubcommand((subcommand) => subcommand.setName("clear").setDescription("Clear messages from this monitor channel"))
      .addSubcommand((subcommand) =>
        subcommand
          .setName("polymarket")
          .setDescription("Attach a Polymarket market URL to this monitor")
          .addStringOption((option) =>
            option
              .setName("url")
              .setDescription("Polymarket market URL")
              .setRequired(true)
              .setMinLength(1)
              .setMaxLength(2048)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("interval")
          .setDescription("Change polling interval")
          .addIntegerOption((option) =>
            option
              .setName("minutes")
              .setDescription("Polling interval in minutes")
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(1440)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("enddate")
          .setDescription("Manually set the Polymarket market end time in ET")
          .addStringOption((option) =>
            option
              .setName("datetime")
              .setDescription("ET time, e.g. 2026-05-10 23:59 or 2026-05-10 11:59 PM")
              .setRequired(true)
              .setMinLength(16)
              .setMaxLength(32)
          )
      )
      .addSubcommand((subcommand) => subcommand.setName("pause").setDescription("Pause this monitor"))
      .addSubcommand((subcommand) => subcommand.setName("resume").setDescription("Resume this monitor"));

    if (adapter.supportsPeriod) {
      command.addSubcommand((subcommand) =>
        subcommand
          .setName("period")
          .setDescription("Set the monitored year and month")
          .addIntegerOption((option) =>
            option
              .setName("year")
              .setDescription("Year to monitor")
              .setRequired(true)
              .setMinValue(1904)
              .setMaxValue(2100)
          )
          .addIntegerOption((option) =>
            option
              .setName("month")
              .setDescription("Month to monitor")
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(12)
          )
      );
    }

    if (adapter.dailySnapshot) {
      command.addSubcommand((subcommand) =>
        subcommand.setName("snapshot").setDescription("Show the latest stored daily snapshot")
      );
    }

    if (adapter.supportsStrikes) {
      command.addSubcommand((subcommand) =>
        subcommand.setName("strikes").setDescription("Fetch, store, and show current Polymarket strike terms")
      );
    }

    if (adapter.searchStrikeTerm) {
      command.addSubcommand((subcommand) =>
        subcommand
          .setName("search")
          .setDescription("Search for a strike term inside the active market timeframe")
          .addStringOption((option) =>
            option
              .setName("term")
              .setDescription("Word or phrase to search")
              .setRequired(true)
              .setMinLength(1)
              .setMaxLength(80)
          )
      );
    }

    if (adapter.searchTags) {
      command.addSubcommand((subcommand) =>
        subcommand
          .setName("tagsearch")
          .setDescription("Search Polymarket tags for proposal filters")
          .addStringOption((option) =>
            option
              .setName("query")
              .setDescription("Tag id, slug, or text to search")
              .setRequired(true)
              .setMinLength(1)
              .setMaxLength(80)
          )
      );
    }

    if (adapter.updateTagFilters) {
      command.addSubcommand((subcommand) =>
        subcommand
          .setName("tags")
          .setDescription("Manage proposal alert tag filters")
          .addStringOption((option) =>
            option
              .setName("action")
              .setDescription("Tag filter action")
              .setRequired(true)
              .addChoices(
                { name: "add", value: "add" },
                { name: "remove", value: "remove" },
                { name: "list", value: "list" },
                { name: "clear", value: "clear" }
              )
          )
          .addStringOption((option) =>
            option
              .setName("tag")
              .setDescription("Tag id, slug, or label for add/remove")
              .setRequired(false)
              .setMinLength(1)
              .setMaxLength(120)
          )
      );
    }

    if (adapter.updateTagBlocklist) {
      command.addSubcommand((subcommand) =>
        subcommand
          .setName("tagblocks")
          .setDescription("Exclude market tags from one proposal tag channel")
          .addStringOption((option) =>
            option
              .setName("action")
              .setDescription("Blocklist action")
              .setRequired(true)
              .addChoices(
                { name: "add", value: "add" },
                { name: "remove", value: "remove" },
                { name: "list", value: "list" },
                { name: "clear", value: "clear" }
              )
          )
          .addStringOption((option) =>
            option
              .setName("blocked")
              .setDescription("Tag to exclude from this proposal channel")
              .setRequired(false)
              .setMinLength(1)
              .setMaxLength(120)
          )
          .addStringOption((option) =>
            option
              .setName("tag")
              .setDescription("Configured proposal tag; optional inside its tag channel")
              .setRequired(false)
              .setMinLength(1)
              .setMaxLength(120)
          )
      );
    }

    if (adapter.updateAddressLabels) {
      command.addSubcommand((subcommand) =>
        subcommand
          .setName("addresses")
          .setDescription("Label known EVM addresses in UMA alerts")
          .addStringOption((option) =>
            option
              .setName("action")
              .setDescription("Address label action")
              .setRequired(true)
              .addChoices(
                { name: "add", value: "add" },
                { name: "remove", value: "remove" },
                { name: "list", value: "list" },
                { name: "clear", value: "clear" }
              )
          )
          .addStringOption((option) =>
            option
              .setName("address")
              .setDescription("0x EVM address to label or remove")
              .setRequired(false)
              .setMinLength(42)
              .setMaxLength(42)
          )
          .addStringOption((option) =>
            option
              .setName("name")
              .setDescription("Name to show above this address")
              .setRequired(false)
              .setMinLength(1)
              .setMaxLength(80)
          )
      );
    }

    return command;
  });
}

export function buildBotCommands() {
  return [
    new SlashCommandBuilder()
      .setName("bot")
      .setDescription("Bot-level utility commands")
      .addSubcommand((subcommand) => subcommand.setName("summarize").setDescription("Summarize all integrations"))
      .addSubcommand((subcommand) =>
        subcommand
          .setName("clearerrors")
          .setDescription("Clean old bot Check failed messages from integration channels")
          .addBooleanOption((option) =>
            option
              .setName("keep-latest")
              .setDescription("Keep the newest Check failed message per channel. Defaults to true.")
              .setRequired(false)
          )
      )
      .addSubcommand((subcommand) => subcommand.setName("clearroles").setDescription("Clear the market alert role selector channel"))
  ];
}

export function isAdapterCommand(commandName: string): boolean {
  return listAdapters().some((adapter) => adapter.commandName === commandName);
}

export function isBotCommand(commandName: string): boolean {
  return commandName === "bot";
}

export async function handleBotCommand(interaction: ChatInputCommandInteraction, database: BotDatabase): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works inside the configured Discord server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "summarize") {
    await interaction.deferReply();
    const integrations = database.listIntegrations().filter((integration) => integration.guildId === interaction.guild!.id);
    const embeds = buildIntegrationSummaryEmbeds(await buildIntegrationSummaryRows(database, integrations));
    const [firstEmbed, ...remainingEmbeds] = embeds;
    await interaction.editReply({ embeds: [firstEmbed] });
    for (const embed of remainingEmbeds) {
      await interaction.followUp({ embeds: [embed] });
    }
    return;
  }

  if (subcommand === "clearerrors") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({ content: "You need Manage Messages permission to clear check-failed messages.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const keepLatest = interaction.options.getBoolean("keep-latest") ?? true;
    const summary = await clearOldCheckFailedMessages(interaction.guild, database, keepLatest);
    await interaction.editReply({ embeds: [buildClearErrorsEmbed(summary)] });
    return;
  }

  if (subcommand === "clearroles") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({ content: "You need Manage Messages permission to clear alert role messages.", flags: MessageFlags.Ephemeral });
      return;
    }

    const roleChannel = interaction.guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildText && channel.name === roleChannelName
    ) as TextChannel | undefined;
    if (!roleChannel) {
      await interaction.reply({ content: `Could not find #${roleChannelName}.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const botPermissions = roleChannel.permissionsFor(interaction.client.user);
    if (!botPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({ content: `I need Manage Messages permission in #${roleChannelName}.`, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const deletedCount = await clearTextChannel(roleChannel);
    await interaction.editReply(
      `Cleared ${deletedCount} message(s) from #${roleChannelName}. The bot will recreate the grouped alert-role selector shortly.`
    );
    return;
  }

  await interaction.reply({ content: "Unknown bot command.", flags: MessageFlags.Ephemeral });
}

export async function handleAdapterCommand(
  interaction: ChatInputCommandInteraction,
  database: BotDatabase
): Promise<void> {
  if (!interaction.guild || !interaction.channel) {
    await interaction.reply({ content: "This command only works inside the configured Discord server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const adapter = getAdapterByCommandName(interaction.commandName);
  let integration = database.getIntegrationByChannel(interaction.guild.id, interaction.channel.id);
  let proposalChannelTag: TagFilterEntry | null = null;

  if (!integration && adapter.id === "polymarket-proposals") {
    const baseIntegration = database.getIntegrationByAdapter(interaction.guild.id, adapter.id);
    proposalChannelTag = baseIntegration ? getPolymarketProposalTagFilterByChannelId(baseIntegration, interaction.channel.id) : null;
    if (baseIntegration && proposalChannelTag) {
      integration = baseIntegration;
    }
  }

  if (!integration || integration.adapterId !== adapter.id) {
    await interaction.reply({
      content: `Use this command in the ${adapter.displayName} channel.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (proposalChannelTag && subcommand !== "tagblocks" && subcommand !== "addresses") {
    await interaction.reply({
      content: `Use this command in #${adapter.defaultChannelName}. This tag channel only supports /${adapter.commandName} tagblocks and addresses.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (subcommand === "status") {
    await interaction.reply({ embeds: [buildStatusReplyEmbed(integration)] });
    return;
  }

  if (subcommand === "last") {
    await interaction.reply({ embeds: [buildLastEmbed(integration)] });
    return;
  }

  if (subcommand === "snapshot") {
    if (!adapter.dailySnapshot) {
      await interaction.reply({ content: "This integration does not support daily snapshots.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({ embeds: [buildSnapshotStoredEmbed(integration)] });
    return;
  }

  if (subcommand === "strikes") {
    if (!adapter.supportsStrikes) {
      await interaction.reply({ content: "This integration does not support strike terms.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();
    const refreshedSettingsJson = adapter.refreshSettings
      ? await adapter.refreshSettings(integration, { force: true })
      : integration.settingsJson;
    const updated =
      refreshedSettingsJson && refreshedSettingsJson !== integration.settingsJson
        ? database.setSettingsJson(integration.id, refreshedSettingsJson)
        : integration;
    const settings = adapter.getStrikeTerms?.(updated) ?? parseTrumpTruthSettings(updated.settingsJson);
    const activeUpdated =
      settings.parsedFromUrl && settings.parsedFromUrl !== updated.polymarketUrl
        ? database.setPolymarketUrl(updated.id, settings.parsedFromUrl)
        : updated;
    await interaction.editReply({
      embeds: [buildStrikeTermsEmbed(activeUpdated, settings.strikeTerms ?? [], settings.parsedFromUrl, settings.lastParsedAt)]
    });
    return;
  }

  if (subcommand === "search") {
    if (!adapter.searchStrikeTerm) {
      await interaction.reply({ content: "This integration does not support strike-term search.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();
    let updated = integration;
    const refreshedSettingsJson = adapter.refreshSettings ? await adapter.refreshSettings(updated) : updated.settingsJson;
    if (refreshedSettingsJson && refreshedSettingsJson !== updated.settingsJson) {
      updated = database.setSettingsJson(updated.id, refreshedSettingsJson);
    }

    const settings = adapter.getStrikeTerms?.(updated) ?? parseTrumpTruthSettings(updated.settingsJson);
    if (settings.parsedFromUrl && settings.parsedFromUrl !== updated.polymarketUrl) {
      updated = database.setPolymarketUrl(updated.id, settings.parsedFromUrl);
    }

    const result = await adapter.searchStrikeTerm(updated, interaction.options.getString("term", true));
    await interaction.editReply({ embeds: [buildStrikeSearchEmbed(updated, result)] });
    return;
  }

  if (subcommand === "tagsearch") {
    if (!adapter.searchTags) {
      await interaction.reply({ content: "This integration does not support tag search.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();
    const result = await adapter.searchTags(interaction.options.getString("query", true));
    await interaction.editReply({ embeds: [buildTagSearchEmbed(integration, result)] });
    return;
  }

  if (subcommand === "tags") {
    if (!adapter.updateTagFilters) {
      await interaction.reply({ content: "This integration does not support tag filters.", flags: MessageFlags.Ephemeral });
      return;
    }

    const action = interaction.options.getString("action", true) as TagFilterAction;
    const tagQuery = interaction.options.getString("tag")?.trim();
    if ((action === "add" || action === "remove") && !tagQuery) {
      await interaction.reply({ content: "`add` and `remove` need a tag id, slug, or label.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();
    let result = await adapter.updateTagFilters(integration, action, tagQuery);
    if (adapter.id === "polymarket-proposals") {
      result = await syncPolymarketProposalTagChannels(interaction.guild, integration, result);
    }

    const updated =
      result.settingsJson !== integration.settingsJson
        ? database.setSettingsJson(integration.id, result.settingsJson)
        : integration;
    await interaction.editReply({ embeds: [buildTagFiltersEmbed(updated, result)] });
    return;
  }

  if (subcommand === "tagblocks") {
    if (!adapter.updateTagBlocklist) {
      await interaction.reply({ content: "This integration does not support tag blocklists.", flags: MessageFlags.Ephemeral });
      return;
    }

    const action = interaction.options.getString("action", true) as TagFilterAction;
    const subscriptionTagQuery = interaction.options.getString("tag")?.trim() ?? proposalChannelTag?.slug;
    const blockedTagQuery = interaction.options.getString("blocked")?.trim();
    if (!subscriptionTagQuery) {
      await interaction.reply({
        content: "Run this in a proposal tag channel, or provide the configured proposal tag with `tag:`.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    if ((action === "add" || action === "remove") && !blockedTagQuery) {
      await interaction.reply({ content: "`add` and `remove` need a blocked tag id, slug, or label.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();
    const result = await adapter.updateTagBlocklist(integration, subscriptionTagQuery, action, blockedTagQuery);
    const updated =
      result.settingsJson !== integration.settingsJson
        ? database.setSettingsJson(integration.id, result.settingsJson)
        : integration;
    await interaction.editReply({ embeds: [buildTagBlocklistEmbed(updated, result)] });
    return;
  }

  if (subcommand === "addresses") {
    if (!adapter.updateAddressLabels) {
      await interaction.reply({ content: "This integration does not support address labels.", flags: MessageFlags.Ephemeral });
      return;
    }

    const action = interaction.options.getString("action", true) as AddressLabelAction;
    const addressQuery = interaction.options.getString("address")?.trim();
    const labelQuery = interaction.options.getString("name")?.trim();
    if ((action === "add" || action === "remove") && !addressQuery) {
      await interaction.reply({ content: "`add` and `remove` need an EVM address.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (action === "add" && !labelQuery) {
      await interaction.reply({ content: "`add` needs a name.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();
    const result = await adapter.updateAddressLabels(integration, action, addressQuery, labelQuery);
    const updated =
      result.settingsJson !== integration.settingsJson
        ? database.setSettingsJson(integration.id, result.settingsJson)
        : integration;
    const syncedCount =
      action === "list"
        ? 1
        : await syncUmaAddressLabels(database, interaction.guild.id, updated.id, action, addressQuery, labelQuery);
    await interaction.editReply({
      embeds: [
        buildAddressLabelsEmbed(updated, {
          ...result,
          message: syncedCount > 1 ? `${result.message} Synced across ${syncedCount} UMA integrations.` : result.message
        })
      ]
    });
    return;
  }

  if (subcommand === "test") {
    if (!("send" in interaction.channel) || typeof interaction.channel.send !== "function") {
      await interaction.reply({ content: "This command only works in a sendable text channel.", flags: MessageFlags.Ephemeral });
      return;
    }

    const result = buildSimulatedAlertResult(integration);
    await interaction.channel.send(buildAlertMessagePayload(result));
    await interaction.reply({ content: `Sent a simulated ${integration.displayName} value-change alert.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === "clear") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({ content: "You need Manage Messages permission to clear this channel.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: "This command only works in a text channel.", flags: MessageFlags.Ephemeral });
      return;
    }

    const botPermissions = interaction.channel.permissionsFor(interaction.client.user);
    if (!botPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({ content: "I need Manage Messages permission to clear this channel.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const deletedCount = await clearTextChannel(interaction.channel);
    await interaction.editReply({ embeds: [buildClearEmbed(integration, deletedCount)] });
    return;
  }

  if (subcommand === "polymarket") {
    const polymarketUrl = normalizePolymarketUrl(interaction.options.getString("url", true));
    if (!polymarketUrl) {
      await interaction.reply({ content: "Please provide a valid Polymarket URL.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (adapter.id === "trump-truth") {
      await interaction.deferReply();
      const settings = await upsertTrumpTruthPolymarketMarket(integration, polymarketUrl);
      let updated = database.setSettingsJson(integration.id, JSON.stringify(settings));
      if (settings.parsedFromUrl && settings.parsedFromUrl !== updated.polymarketUrl) {
        updated = database.setPolymarketUrl(updated.id, settings.parsedFromUrl);
      }

      await interaction.editReply({ embeds: [buildPolymarketUpdatedEmbed(updated)] });
      return;
    }

    const queue = upsertPolymarketQueueUrl(integration, polymarketUrl);
    let updated =
      queue.settingsJson && queue.settingsJson !== integration.settingsJson
        ? database.setSettingsJson(integration.id, queue.settingsJson)
        : integration;
    if (queue.activeUrl !== updated.polymarketUrl) {
      updated = database.setPolymarketUrl(updated.id, queue.activeUrl);
    }

    if (adapter.supportsStrikes && adapter.refreshSettings) {
      await interaction.deferReply();
      const refreshedSettingsJson = await adapter.refreshSettings(updated, { force: true });
      if (refreshedSettingsJson && refreshedSettingsJson !== updated.settingsJson) {
        updated = database.setSettingsJson(updated.id, refreshedSettingsJson);
      }
      const settings = adapter.getStrikeTerms?.(updated);
      if (settings?.parsedFromUrl && settings.parsedFromUrl !== updated.polymarketUrl) {
        updated = database.setPolymarketUrl(updated.id, settings.parsedFromUrl);
      }
      await interaction.editReply({ embeds: [buildPolymarketUpdatedEmbed(updated)] });
      return;
    }

    await interaction.reply({ embeds: [buildPolymarketUpdatedEmbed(updated)] });
    return;
  }

  if (subcommand === "interval") {
    const minutes = interaction.options.getInteger("minutes", true);
    const updated = database.setIntervalMinutes(integration.id, minutes);
    await interaction.reply({ embeds: [buildIntervalUpdatedEmbed(updated)] });
    return;
  }

  if (subcommand === "enddate") {
    if (!integration.polymarketUrl) {
      await interaction.reply({
        content: "Set a Polymarket URL first with this channel's `polymarket` command.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const endAt = parseManualEasternDateTime(interaction.options.getString("datetime", true));
    if (!endAt) {
      await interaction.reply({
        content: "Invalid ET datetime. Use `YYYY-MM-DD HH:mm`, for example `2026-05-10 23:59`.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    database.recordMarketEndMetadata(integration.id, integration.polymarketUrl, endAt, new Date());
    database.clearMarketEndReminders(integration.id, integration.polymarketUrl);
    await interaction.reply({ embeds: [buildMarketEndManualUpdatedEmbed(integration, endAt)] });
    return;
  }

  if (subcommand === "period") {
    if (!adapter.supportsPeriod) {
      await interaction.reply({ content: "This integration does not support period settings.", flags: MessageFlags.Ephemeral });
      return;
    }

    const year = interaction.options.getInteger("year", true);
    const month = interaction.options.getInteger("month", true);
    if (!isValidPeriod(year, month)) {
      await interaction.reply({ content: "Please provide a valid year and month.", flags: MessageFlags.Ephemeral });
      return;
    }

    const updated = database.setSettingsJson(integration.id, mergeSettingsJson(integration.settingsJson, { year, month }));
    await interaction.reply({ embeds: [buildPeriodUpdatedEmbed(updated, year, month)] });
    return;
  }

  if (subcommand === "pause") {
    const updated = database.setStatus(integration.id, "paused");
    await interaction.reply({ embeds: [buildStatusReplyEmbed(updated)] });
    return;
  }

  if (subcommand === "resume") {
    const updated = database.setStatus(integration.id, "active");
    await interaction.reply({ embeds: [buildStatusReplyEmbed(updated)] });
    return;
  }

  if (subcommand === "check") {
    await interaction.deferReply();
    await interaction.editReply(`Checking ${integration.displayName}...`);
    if (adapter.fetchEventUpdates) {
      const result = await checkEventIntegration(database, integration);
      await interaction.editReply({ content: "", embeds: [buildEventCheckEmbed(result)] });
    } else {
      const result = await checkIntegration(database, integration);
      await interaction.editReply({ content: "", embeds: [buildCheckEmbed(result)] });
    }
  }
}

export function describeAdapterCommand(adapter: WebsiteAdapter): string {
  return `/${adapter.commandName}`;
}

export function formatPolymarketLine(integration: Integration): string {
  return `Polymarket: ${integration.polymarketUrl ?? "not set"}`;
}

export function normalizePolymarketUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    if (hostname !== "polymarket.com" && hostname !== "www.polymarket.com") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function buildSimulatedAlertResult(integration: Integration): CheckResult {
  const currentValue = simulateNextValue(integration.lastValue);
  return {
    integration: {
      ...integration,
      lastValue: currentValue,
      lastCheckedAt: new Date().toISOString()
    },
    previousValue: integration.lastValue ?? "not checked yet",
    previousCheckedAt: integration.lastCheckedAt,
    currentValue,
    changed: true
  };
}

function buildStatusReplyEmbed(integration: Integration) {
  return buildStatusEmbed(integration, {
    effectiveIntervalMinutes: getEffectivePollIntervalMinutes(integration),
    reason: getPollIntervalReason(integration)
  });
}

async function syncPolymarketProposalTagChannels(
  guild: Guild,
  previousIntegration: Integration,
  result: TagFilterUpdateResult
): Promise<TagFilterUpdateResult> {
  let settingsJson = result.settingsJson;
  const notes: string[] = [];

  if (result.action === "remove" && result.changed && result.matchedTag) {
    const deleted = await deletePolymarketProposalTagChannel(guild, previousIntegration.settingsJson, result.matchedTag);
    if (deleted) {
      notes.push(deleted);
    }
  }

  if (result.action === "clear" && result.changed) {
    for (const tag of getPolymarketProposalTagFiltersFromSettingsJson(previousIntegration.settingsJson)) {
      const deleted = await deletePolymarketProposalTagChannel(guild, previousIntegration.settingsJson, tag);
      if (deleted) {
        notes.push(deleted);
      }
    }
  }

  if (result.action === "add" || result.action === "list") {
    for (const tag of getPolymarketProposalTagFiltersFromSettingsJson(settingsJson)) {
      const synced = await ensurePolymarketProposalTagChannel(guild, previousIntegration, settingsJson, tag);
      settingsJson = synced.settingsJson;
      if (synced.note) {
        notes.push(synced.note);
      }
    }
  }

  return {
    ...result,
    message: notes.length ? `${result.message}\n${notes.join("\n")}` : result.message,
    tagFilters: getPolymarketProposalTagFiltersFromSettingsJson(settingsJson),
    settingsJson
  };
}

async function ensurePolymarketProposalTagChannel(
  guild: Guild,
  integration: Integration,
  settingsJson: string,
  tag: TagFilterEntry
): Promise<{ settingsJson: string; note?: string }> {
  const stored: ProposalTagFilterEntry = getPolymarketProposalStoredTagFilter(settingsJson, tag) ?? tag;
  const channelName = getPolymarketProposalTagChannelName(tag);
  let channel = stored.channelId ? await fetchTextChannelById(guild, stored.channelId) : null;
  let note: string | undefined;

  if (channel && channel.name !== channelName) {
    channel = await channel.setName(channelName, `Sync UMA proposal channel for ${tag.label}`);
    note = `Renamed proposal channel to #${channel.name}.`;
  }

  if (!channel) {
    channel = findTextChannelByName(guild, channelName) ?? null;
    if (channel) {
      note = `Linked existing proposal channel #${channel.name}.`;
    }
  }

  if (!channel) {
    channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      topic: `UMA proposal alerts for Polymarket tag: ${tag.label} (${tag.slug})`,
      parent: getIntegrationChannelParentId(guild, integration)
    });
    note = `Created proposal channel #${channel.name}.`;
  }

  const nextSettingsJson =
    channel.id === stored.channelId && channel.name === stored.channelName
      ? settingsJson
      : setPolymarketProposalTagChannel(settingsJson, tag, channel.id, channel.name);
  return { settingsJson: nextSettingsJson, note };
}

async function deletePolymarketProposalTagChannel(
  guild: Guild,
  settingsJson: string | null,
  tag: TagFilterEntry
): Promise<string | null> {
  const stored: ProposalTagFilterEntry = getPolymarketProposalStoredTagFilter(settingsJson, tag) ?? tag;
  const expectedName = stored.channelName ?? getPolymarketProposalTagChannelName(tag);
  const channel =
    (stored.channelId ? await fetchTextChannelById(guild, stored.channelId) : null) ??
    findTextChannelByName(guild, expectedName);
  if (!channel) {
    return null;
  }

  await channel.delete(`Removed UMA proposal tag filter: ${tag.label}`);
  return `Deleted proposal channel #${channel.name}.`;
}

async function fetchTextChannelById(guild: Guild, channelId: string): Promise<TextChannel | null> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel?.type === ChannelType.GuildText ? channel : null;
}

function findTextChannelByName(guild: Guild, channelName: string): TextChannel | undefined {
  return guild.channels.cache.find((channel) => channel.type === ChannelType.GuildText && channel.name === channelName) as
    | TextChannel
    | undefined;
}

function getIntegrationChannelParentId(guild: Guild, integration: Integration): string | undefined {
  const channel = guild.channels.cache.get(integration.channelId);
  return channel?.type === ChannelType.GuildText ? channel.parentId ?? undefined : undefined;
}

async function syncUmaAddressLabels(
  database: BotDatabase,
  guildId: string,
  sourceIntegrationId: number,
  action: AddressLabelAction,
  addressQuery?: string,
  labelQuery?: string
): Promise<number> {
  let syncedCount = 1;
  for (const integration of database.listIntegrations()) {
    if (integration.guildId !== guildId || integration.id === sourceIntegrationId) {
      continue;
    }

    const adapter = getAdapter(integration.adapterId);
    if (!adapter.updateAddressLabels) {
      continue;
    }

    const result = await adapter.updateAddressLabels(integration, action, addressQuery, labelQuery);
    if (result.settingsJson !== integration.settingsJson) {
      database.setSettingsJson(integration.id, result.settingsJson);
    }
    syncedCount += 1;
  }

  return syncedCount;
}

export async function clearOldCheckFailedMessages(guild: Guild, database: BotDatabase, keepLatest = true) {
  const botUserId = guild.client.user?.id;
  const channelIds = [
    ...new Set(
      database
        .listIntegrations()
        .filter((integration) => integration.guildId === guild.id)
        .map((integration) => integration.channelId)
    )
  ];
  const summary = {
    scannedChannels: 0,
    deletedMessages: 0,
    keptMessages: 0,
    skippedChannels: 0,
    failedDeletes: 0,
    keepLatest
  };

  if (!botUserId) {
    summary.skippedChannels = channelIds.length;
    return summary;
  }

  for (const channelId of channelIds) {
    const channel = await fetchTextChannelById(guild, channelId);
    if (!channel) {
      summary.skippedChannels += 1;
      continue;
    }

    const botPermissions = channel.permissionsFor(guild.client.user);
    if (!botPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      summary.skippedChannels += 1;
      continue;
    }

    summary.scannedChannels += 1;
    let messages: Message[];
    try {
      messages = await fetchCheckFailedMessages(channel, botUserId);
    } catch {
      summary.skippedChannels += 1;
      continue;
    }

    const sortedMessages = messages.sort((left, right) => right.createdTimestamp - left.createdTimestamp);
    const keptMessageId = keepLatest ? sortedMessages[0]?.id : undefined;
    if (keptMessageId) {
      summary.keptMessages += 1;
    }

    for (const message of sortedMessages) {
      if (message.id === keptMessageId) {
        continue;
      }

      try {
        await message.delete();
        summary.deletedMessages += 1;
      } catch {
        summary.failedDeletes += 1;
      }
    }
  }

  return summary;
}

async function fetchCheckFailedMessages(channel: TextChannel, botUserId: string): Promise<Message[]> {
  const checkFailedMessages: Message[] = [];
  let before: string | undefined;

  while (true) {
    const messages = await channel.messages.fetch(before ? { limit: 100, before } : { limit: 100 });
    if (messages.size === 0) {
      return checkFailedMessages;
    }

    for (const message of messages.values()) {
      if (isBotCheckFailedMessage(message, botUserId)) {
        checkFailedMessages.push(message);
      }
    }

    const oldestMessage = messages.last();
    if (!oldestMessage || messages.size < 100) {
      return checkFailedMessages;
    }

    before = oldestMessage.id;
  }
}

function isBotCheckFailedMessage(message: Message, botUserId: string): boolean {
  return message.author.id === botUserId && message.embeds.some((embed) => embed.title?.endsWith(checkFailedTitleSuffix));
}

async function buildIntegrationSummaryRows(database: BotDatabase, integrations: Integration[]) {
  return Promise.all(integrations.map(async (integration) => {
    const adapter = getAdapter(integration.adapterId);
    const marketEnd = await getStoredOrFetchPolymarketEndDate(database, integration);
    return {
      commandName: adapter.commandName,
      displayName: integration.displayName,
      status: integration.status,
      sourceUrl: integration.sourceUrl,
      polymarketUrl: integration.polymarketUrl,
      marketEnd: formatMarketEnd(marketEnd.endAt),
      marketExpired: marketEnd.endAt ? marketEnd.endAt.getTime() <= Date.now() : false,
      baseIntervalMinutes: integration.pollIntervalMinutes,
      currentIntervalMinutes: getEffectivePollIntervalMinutes(integration)
    };
  }));
}

function formatMarketEnd(marketEnd: Date | null): string {
  return marketEnd ? `${formatEasternDateTime(marketEnd)} ET / ${marketEnd.toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false })} SGT` : "not available from Gamma";
}

function formatEasternDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function isValidPeriod(year: number, month: number): boolean {
  return Number.isInteger(year) && Number.isInteger(month) && year >= 1904 && year <= 2100 && month >= 1 && month <= 12;
}

function simulateNextValue(value: string | null): string {
  if (!value) {
    return "simulated-value";
  }

  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) {
    return String(numericValue + 1);
  }

  return `${value} (simulated update)`;
}

export async function clearTextChannel(channel: TextChannel): Promise<number> {
  let deletedCount = 0;

  while (true) {
    const messages = await channel.messages.fetch({ limit: 100 });
    if (messages.size === 0) {
      return deletedCount;
    }

    const recentCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const recentMessages = messages.filter((message) => message.createdTimestamp > recentCutoff);
    const oldMessages = messages.filter((message) => message.createdTimestamp <= recentCutoff);
    let deletedThisBatch = 0;

    if (recentMessages.size > 0) {
      const deletedMessages = await channel.bulkDelete(recentMessages, true);
      deletedCount += deletedMessages.size;
      deletedThisBatch += deletedMessages.size;
    }

    for (const message of oldMessages.values()) {
      try {
        await message.delete();
        deletedCount += 1;
        deletedThisBatch += 1;
      } catch {
        continue;
      }
    }

    if (deletedThisBatch === 0) {
      return deletedCount;
    }
  }
}

