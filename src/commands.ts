import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction, type TextChannel } from "discord.js";
import { buildArbitrageOutcomeSelectRow } from "./arbitrageControls.js";
import { errorLogChannelName } from "./channels.js";
import type { BotDatabase } from "./database.js";
import { AttachmentBuilder, type Attachment } from "discord.js";
import type { Guild } from "discord.js";
import type { Message } from "discord.js";
import {
  buildAddressLabelsEmbed,
  buildArbitrageSetupEmbed,
  buildArbitrageWatchEmbed,
  buildBotChannelClearEmbed,
  buildClearErrorsEmbed,
  buildCheckEmbed,
  buildEventPostMessagePayload,
  buildEventCheckEmbed,
  buildIntegrationSummaryEmbeds,
  buildIntervalUpdatedEmbed,
  buildLastEmbed,
  buildMarketEndManualUpdatedEmbed,
  buildPeriodUpdatedEmbed,
  buildPolymarketUpdatedEmbed,
  buildResolvableWatchlistEmbed,
  buildSnapshotStoredEmbed,
  buildStrikeSearchEmbed,
  buildStrikeTermsEmbed,
  buildTagBlocklistEmbed,
  buildTagFiltersEmbed,
  buildTagSearchEmbed,
  buildThresholdEmbed,
  buildStatusEmbed,
  buildTurboUpdatedEmbed,
  buildUpdateLogsEmbed
} from "./embeds.js";
import { exportAddressLabelsCsv, getAddressLabelsFromSettingsJson } from "./addressLabels.js";
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
  AddressLabelUpdateOptions,
  ArbitrageSetupInput,
  ArbitrageWatchSide,
  Integration,
  ResolvableWatchlistAction,
  TagFilterAction,
  TagFilterEntry,
  TagFilterUpdateResult,
  WebsiteAdapter
} from "./integrations/types.js";
import { getStoredOrFetchPolymarketEndDate, parseManualEasternDateTime } from "./marketEnd.js";
import { upsertPolymarketQueueUrl } from "./polymarketQueue.js";
import { mergeSettingsJson, parseSettingsJson, stringifySettingsJson } from "./settingsJson.js";
import {
  checkEventIntegration,
  checkIntegration,
  getEffectivePollIntervalMs,
  getPollIntervalReason
} from "./poller.js";
import { syncUmaAddressLabels } from "./umaAddressLabels.js";
import {
  clearTurboPollingSettings,
  maxTurboDurationMinutes,
  maxTurboIntervalSeconds,
  minTurboIntervalSeconds,
  setTurboPollingSettings
} from "./turboPolling.js";

const roleChannelName = "market-alert-roles";
const checkFailedTitleSuffix = " - Check failed";
const maxAddressImportBytes = 256_000;
const addressImportDownloadTimeoutMs = 10_000;
const monitorCommandName = "monitor";
const perAdapterCommandAdapterIds = new Set([
  "polymarket-clarifications",
  "polymarket-disputes",
  "polymarket-proposals",
  "uma-vote-commits",
  "uma-vote-reveals",
  "uma-voting-committee"
]);

export function buildAdapterCommands() {
  return listSlashCommandAdapters().map((adapter) => buildAdapterCommand(adapter));
}

export function buildMonitorCommands() {
  return [
    buildAdapterCommand(getAdapter("bonbast-usd-irr"), {
      commandName: monitorCommandName,
      description: "Manage the monitor in this channel",
      includeAllSubcommands: true
    })
  ];
}

function buildAdapterCommand(
  adapter: WebsiteAdapter,
  options: { commandName?: string; description?: string; includeAllSubcommands?: boolean } = {}
) {
  const includeAllSubcommands = options.includeAllSubcommands ?? false;
  const command = new SlashCommandBuilder()
    .setName(options.commandName ?? adapter.commandName)
    .setDescription(options.description ?? `Manage ${adapter.displayName}`)
    .addSubcommand((subcommand) => subcommand.setName("status").setDescription("Show monitor status"))
    .addSubcommand((subcommand) => subcommand.setName("check").setDescription("Fetch the current value now"))
    .addSubcommand((subcommand) => subcommand.setName("last").setDescription("Show the last stored value"))
    .addSubcommand((subcommand) => subcommand.setName("updates").setDescription("Show recent source update timing logs"))
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
          .setName("turbo")
          .setDescription("Temporarily poll this monitor faster")
          .addIntegerOption((option) =>
            option
              .setName("seconds")
              .setDescription("Poll every N seconds. Use 0 to turn turbo off.")
              .setRequired(true)
              .setMinValue(0)
              .setMaxValue(maxTurboIntervalSeconds)
          )
          .addIntegerOption((option) =>
            option
              .setName("duration-minutes")
              .setDescription("How long turbo should run, in minutes")
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(maxTurboDurationMinutes)
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
    .addSubcommand((subcommand) =>
      subcommand
        .setName("archive")
        .setDescription("Pause and archive this monitor without deleting its code or data")
        .addStringOption((option) =>
          option
            .setName("reason")
            .setDescription("Optional note for why this monitor is archived")
            .setRequired(false)
            .setMinLength(1)
            .setMaxLength(200)
        )
    )
    .addSubcommand((subcommand) => subcommand.setName("resume").setDescription("Resume this monitor"));

    if (includeAllSubcommands || adapter.supportsPeriod) {
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

    if (includeAllSubcommands || adapter.dailySnapshot) {
      command.addSubcommand((subcommand) =>
        subcommand.setName("snapshot").setDescription("Show the latest stored daily snapshot")
      );
    }

    if (includeAllSubcommands || adapter.supportsStrikes) {
      command.addSubcommand((subcommand) =>
        subcommand.setName("strikes").setDescription("Fetch, store, and show current Polymarket strike terms")
      );
    }

    if (includeAllSubcommands || adapter.searchStrikeTerm) {
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

    if (includeAllSubcommands || adapter.searchTags) {
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

    if (includeAllSubcommands || adapter.updateTagFilters) {
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

    if (includeAllSubcommands || adapter.updateResolvableWatchlist) {
      command.addSubcommand((subcommand) =>
        subcommand
          .setName("watchlist")
          .setDescription("Manage Polymarket markets watched for ready-to-resolve")
          .addStringOption((option) =>
            option
              .setName("action")
              .setDescription("Watchlist action")
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
              .setName("market")
              .setDescription("Polymarket URL, market slug, or question ID for add/remove")
              .setRequired(false)
              .setMinLength(1)
              .setMaxLength(2048)
          )
      );
    }

    if (includeAllSubcommands || adapter.updateTagBlocklist) {
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

    if (includeAllSubcommands || adapter.updateAddressLabels) {
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
                { name: "clear", value: "clear" },
                { name: "import", value: "import" },
                { name: "export", value: "export" }
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
          .addAttachmentOption((option) =>
            option.setName("file").setDescription("CSV or text file for bulk import").setRequired(false)
          )
          .addBooleanOption((option) =>
            option.setName("dry-run").setDescription("Preview import without saving. Defaults to true.").setRequired(false)
          )
      );
    }

    if (includeAllSubcommands || adapter.updateThreshold) {
      command.addSubcommand((subcommand) =>
        subcommand
          .setName("threshold")
          .setDescription("Show or change this monitor's alert threshold")
          .addStringOption((option) =>
            option
              .setName("value")
              .setDescription("New threshold value, e.g. 100000, 250k, or 1.5m")
              .setRequired(false)
              .setMinLength(1)
              .setMaxLength(40)
          )
      );
    }

    if (includeAllSubcommands || adapter.prepareArbitrageSetup || adapter.configureArbitrageWatch) {
      command
        .addSubcommand((subcommand) =>
          subcommand
            .setName("setup")
            .setDescription("Start a guided cross-platform arbitrage watch setup")
            .addStringOption((option) =>
              option
                .setName("urls")
                .setDescription("Two or three platform URLs, separated by spaces or commas")
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(4096)
            )
            .addNumberOption((option) =>
              option
                .setName("amount")
                .setDescription("Maximum USD/USDT amount to evaluate. Defaults to 25.")
                .setRequired(false)
                .setMinValue(1)
            )
            .addNumberOption((option) =>
              option
                .setName("min-edge")
                .setDescription("Minimum after-fee edge percent, e.g. 0.5. Defaults to 0.5.")
                .setRequired(false)
                .setMinValue(0)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("watch")
            .setDescription("Configure an arbitrage watch directly")
            .addStringOption((option) =>
              option
                .setName("urls")
                .setDescription("Two or three platform URLs, separated by spaces or commas")
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(4096)
            )
            .addStringOption((option) =>
              option
                .setName("outcome")
                .setDescription("Shared outcome to monitor, e.g. Discord or OpenAI")
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(120)
            )
            .addStringOption((option) =>
              option
                .setName("side")
                .setDescription("Side to monitor")
                .setRequired(true)
                .addChoices(
                  { name: "YES", value: "YES" },
                  { name: "NO", value: "NO" },
                  { name: "BOTH", value: "BOTH" }
                )
            )
            .addNumberOption((option) =>
              option
                .setName("amount")
                .setDescription("Maximum USD/USDT amount to evaluate. Defaults to 25.")
                .setRequired(false)
                .setMinValue(1)
            )
            .addNumberOption((option) =>
              option
                .setName("min-edge")
                .setDescription("Minimum after-fee edge percent, e.g. 0.5. Defaults to 0.5.")
                .setRequired(false)
                .setMinValue(0)
            )
        )
        .addSubcommand((subcommand) => subcommand.setName("config").setDescription("Show the configured arbitrage watch"));
    }

    return command;
}

export function listSlashCommandAdapters(): WebsiteAdapter[] {
  return listAdapters().filter((adapter) => shouldRegisterAdapterCommand(adapter));
}

export function shouldRegisterAdapterCommand(adapter: WebsiteAdapter): boolean {
  return perAdapterCommandAdapterIds.has(adapter.id);
}

export function getAdapterCommandNameForDiscord(adapter: WebsiteAdapter): string {
  return shouldRegisterAdapterCommand(adapter) ? adapter.commandName : monitorCommandName;
}

export function buildBotCommands() {
  return [
    new SlashCommandBuilder()
      .setName("bot")
      .setDescription("Bot-level utility commands")
      .addSubcommand((subcommand) => subcommand.setName("summarize").setDescription("Summarize all integrations"))
      .addSubcommand((subcommand) => subcommand.setName("clear").setDescription("Clear messages from the current text channel"))
      .addSubcommand((subcommand) =>
        subcommand
          .setName("clearerrors")
          .setDescription("Clean old bot Check failed messages from error logs and monitor channels")
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
  return isMonitorCommand(commandName) || listAdapters().some((adapter) => adapter.commandName === commandName);
}

export function isMonitorCommand(commandName: string): boolean {
  return commandName === monitorCommandName;
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

  if (subcommand === "clear") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.editReply("You need Manage Messages permission to clear this channel.");
      return;
    }

    if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
      await interaction.editReply("This command only works in a text channel.");
      return;
    }

    const botPermissions = interaction.channel.permissionsFor(interaction.client.user);
    if (!botPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.editReply("I need Manage Messages permission to clear this channel.");
      return;
    }

    const deletedCount = await clearTextChannel(interaction.channel);
    await interaction.editReply({ embeds: [buildBotChannelClearEmbed(interaction.channel.name, deletedCount)] });
    return;
  }

  if (subcommand === "clearroles") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.editReply("You need Manage Messages permission to clear alert role messages.");
      return;
    }

    const roleChannel = interaction.guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildText && channel.name === roleChannelName
    ) as TextChannel | undefined;
    if (!roleChannel) {
      await interaction.editReply(`Could not find #${roleChannelName}.`);
      return;
    }

    const botPermissions = roleChannel.permissionsFor(interaction.client.user);
    if (!botPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.editReply(`I need Manage Messages permission in #${roleChannelName}.`);
      return;
    }

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

  const subcommand = interaction.options.getSubcommand();
  const checkCommandDeferred = subcommand === "check";
  if (checkCommandDeferred) {
    await interaction.deferReply();
  }

  let integration = database.getIntegrationByChannel(interaction.guild.id, interaction.channel.id);
  let proposalChannelTag: TagFilterEntry | null = null;
  const monitorCommand = isMonitorCommand(interaction.commandName);
  const adapter = monitorCommand ? (integration ? getAdapter(integration.adapterId) : null) : getAdapterByCommandName(interaction.commandName);

  if (!monitorCommand && adapter && !integration && adapter.id === "polymarket-proposals") {
    const baseIntegration = database.getIntegrationByAdapter(interaction.guild.id, adapter.id);
    proposalChannelTag = baseIntegration ? getPolymarketProposalTagFilterByChannelId(baseIntegration, interaction.channel.id) : null;
    if (baseIntegration && proposalChannelTag) {
      integration = baseIntegration;
    }
  }

  if (!integration || !adapter || (!monitorCommand && integration.adapterId !== adapter.id)) {
    const message = monitorCommand ? "Use `/monitor` in a monitor channel." : `Use this command in the ${adapter?.displayName ?? "matching monitor"} channel.`;
    if (checkCommandDeferred) {
      await interaction.editReply(message);
    } else {
      await interaction.reply({
        content: message,
        flags: MessageFlags.Ephemeral
      });
    }
    return;
  }

  if (proposalChannelTag && subcommand !== "tagblocks" && subcommand !== "addresses") {
    const message = `Use this command in #${adapter.defaultChannelName}. This tag channel only supports /${adapter.commandName} tagblocks and addresses.`;
    if (checkCommandDeferred) {
      await interaction.editReply(message);
    } else {
      await interaction.reply({
        content: message,
        flags: MessageFlags.Ephemeral
      });
    }
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

  if (subcommand === "updates") {
    await interaction.reply({ embeds: [buildUpdateLogsEmbed(integration, database.listUpdateLogs(integration.id, 30))] });
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

  if (subcommand === "watchlist") {
    if (!adapter.updateResolvableWatchlist) {
      await interaction.reply({ content: "This integration does not support a resolvable watchlist.", flags: MessageFlags.Ephemeral });
      return;
    }

    const action = interaction.options.getString("action", true) as ResolvableWatchlistAction;
    const marketQuery = interaction.options.getString("market")?.trim();
    if ((action === "add" || action === "remove") && !marketQuery) {
      await interaction.reply({
        content: "`add` and `remove` need a Polymarket URL, market slug, or question ID.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply();
    const result = await adapter.updateResolvableWatchlist(integration, action, marketQuery);
    const updated =
      result.settingsJson !== integration.settingsJson
        ? database.setSettingsJson(integration.id, result.settingsJson)
        : integration;
    await interaction.editReply({ embeds: [buildResolvableWatchlistEmbed(updated, result)] });
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
    if (action === "export") {
      const result = await adapter.updateAddressLabels(integration, action);
      const csv = exportAddressLabelsCsv(getAddressLabelsFromSettingsJson(integration.settingsJson));
      const attachment = new AttachmentBuilder(Buffer.from(csv, "utf8"), { name: "uma-address-labels.csv" });
      await interaction.reply({
        embeds: [buildAddressLabelsEmbed(integration, { ...result, message: `Exported ${result.addressLabels.length} address label(s).` })],
        files: [attachment],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    let updateOptions: AddressLabelUpdateOptions | undefined;
    if (action === "import") {
      const attachment = interaction.options.getAttachment("file");
      if (!attachment) {
        await interaction.reply({ content: "`import` needs a CSV or text file attachment.", flags: MessageFlags.Ephemeral });
        return;
      }

      const dryRun = interaction.options.getBoolean("dry-run") ?? true;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      updateOptions = {
        importText: await fetchAddressImportAttachmentText(attachment),
        dryRun
      };
      const result = await adapter.updateAddressLabels(integration, action, undefined, undefined, updateOptions);
      const updated =
        !dryRun && result.settingsJson !== integration.settingsJson
          ? database.setSettingsJson(integration.id, result.settingsJson)
          : integration;
      const syncedCount = dryRun
        ? 1
        : await syncUmaAddressLabels(database, interaction.guild.id, updated.id, action, undefined, undefined, updateOptions);
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

  if (subcommand === "threshold") {
    if (!adapter.updateThreshold) {
      await interaction.reply({ content: "This integration does not support alert thresholds.", flags: MessageFlags.Ephemeral });
      return;
    }

    const result = await adapter.updateThreshold(integration, interaction.options.getString("value")?.trim());
    const updated =
      result.settingsJson !== integration.settingsJson
        ? database.setSettingsJson(integration.id, result.settingsJson)
        : integration;
    await interaction.reply({ embeds: [buildThresholdEmbed(updated, result)] });
    return;
  }

  if (subcommand === "setup") {
    if (!adapter.prepareArbitrageSetup) {
      await interaction.reply({ content: "This integration does not support arbitrage setup.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();
    const result = await adapter.prepareArbitrageSetup(integration, readArbitrageSetupInput(interaction));
    const updated =
      result.settingsJson !== integration.settingsJson
        ? database.setSettingsJson(integration.id, result.settingsJson)
        : integration;
    await interaction.editReply({
      embeds: [buildArbitrageSetupEmbed(updated, result)],
      components: buildArbitrageOutcomeSelectRow(updated, result)
    });
    return;
  }

  if (subcommand === "watch") {
    if (!adapter.configureArbitrageWatch) {
      await interaction.reply({ content: "This integration does not support arbitrage watches.", flags: MessageFlags.Ephemeral });
      return;
    }

    const side = readArbitrageWatchSide(interaction.options.getString("side", true));
    await interaction.deferReply();
    const result = await adapter.configureArbitrageWatch(integration, {
      ...readArbitrageSetupInput(interaction),
      outcome: interaction.options.getString("outcome", true).trim(),
      side
    });
    const updated =
      result.settingsJson !== integration.settingsJson
        ? database.setSettingsJson(integration.id, result.settingsJson)
        : integration;
    await interaction.editReply({ embeds: [buildArbitrageWatchEmbed(updated, result)] });
    return;
  }

  if (subcommand === "config") {
    if (!adapter.getArbitrageWatch) {
      await interaction.reply({ content: "This integration does not support arbitrage watches.", flags: MessageFlags.Ephemeral });
      return;
    }

    const watch = adapter.getArbitrageWatch(integration);
    await interaction.reply({
      embeds: [
        buildArbitrageWatchEmbed(integration, {
          settingsJson: integration.settingsJson ?? "{}",
          message: watch ? "Current arbitrage watch." : "No arbitrage watch configured. Run `/monitor setup` or `/monitor watch` in this channel.",
          watch
        })
      ]
    });
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

    if (adapter.upsertPolymarketMarket) {
      await interaction.deferReply();
      const queue = await adapter.upsertPolymarketMarket(integration, polymarketUrl);
      let updated =
        queue.settingsJson && queue.settingsJson !== integration.settingsJson
          ? database.setSettingsJson(integration.id, queue.settingsJson)
          : integration;
      if (queue.activeUrl !== updated.polymarketUrl) {
        updated = database.setPolymarketUrl(updated.id, queue.activeUrl);
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

  if (subcommand === "turbo") {
    const seconds = interaction.options.getInteger("seconds", true);
    if (seconds === 0) {
      const updated = database.setSettingsJson(integration.id, clearTurboPollingSettings(integration.settingsJson));
      await interaction.reply({ embeds: [buildTurboUpdatedEmbed(updated)] });
      return;
    }

    if (seconds < minTurboIntervalSeconds) {
      await interaction.reply({
        content: `Turbo interval must be at least ${minTurboIntervalSeconds} seconds, or 0 to turn turbo off.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const durationMinutes = interaction.options.getInteger("duration-minutes");
    if (!durationMinutes) {
      await interaction.reply({
        content: "`duration-minutes` is required when turning turbo on.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const updated = database.setSettingsJson(
      integration.id,
      setTurboPollingSettings(integration.settingsJson, seconds, durationMinutes)
    );
    await interaction.reply({ embeds: [buildTurboUpdatedEmbed(updated)] });
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
    const updated = database.setSettingsJson(integration.id, clearArchiveSettings(integration.settingsJson));
    const paused = database.setStatus(updated.id, "paused");
    await interaction.reply({ embeds: [buildStatusReplyEmbed(paused)] });
    return;
  }

  if (subcommand === "archive") {
    const archived = database.setSettingsJson(
      integration.id,
      mergeSettingsJson(integration.settingsJson, {
        archivedAt: new Date().toISOString(),
        archiveReason: interaction.options.getString("reason")?.trim() || undefined
      })
    );
    const updated = database.setStatus(archived.id, "paused");
    await interaction.reply({ embeds: [buildStatusReplyEmbed(updated)] });
    return;
  }

  if (subcommand === "resume") {
    const unarchived = database.setSettingsJson(integration.id, clearArchiveSettings(integration.settingsJson));
    const updated = database.setStatus(unarchived.id, "active");
    await interaction.reply({ embeds: [buildStatusReplyEmbed(updated)] });
    return;
  }

  if (subcommand === "check") {
    await interaction.editReply(`Checking ${integration.displayName}...`);
    if (adapter.fetchEventUpdates) {
      const historicalCheck = adapter.manualCheckMode === "historical";
      const result = await checkEventIntegration(database, integration, { historicalCheck });
      await interaction.editReply({ content: "", embeds: [buildEventCheckEmbed(result)] });
      if (historicalCheck && result.newPosts.length > 0) {
        const noPingIntegration = { ...result.integration, alertRoleId: null };
        for (const post of result.newPosts.slice(0, 10)) {
          await interaction.followUp(buildEventPostMessagePayload(noPingIntegration, { ...post, mentionAlertRole: false }));
        }
      }
    } else {
      const result = await checkIntegration(database, integration);
      await interaction.editReply({ content: "", embeds: [buildCheckEmbed(result)] });
    }
    return;
  }

  await interaction.reply({
    content: subcommand === "clear" ? "Channel clearing moved to `/bot clear`." : "Unknown integration command.",
    flags: MessageFlags.Ephemeral
  });
}

export function describeAdapterCommand(adapter: WebsiteAdapter): string {
  return `/${getAdapterCommandNameForDiscord(adapter)}`;
}

export function formatPolymarketLine(integration: Integration): string {
  return `Polymarket: ${integration.polymarketUrl ?? "not set"}`;
}

function readArbitrageSetupInput(interaction: ChatInputCommandInteraction): ArbitrageSetupInput {
  const urls = interaction.options
    .getString("urls", true)
    .split(/[\s,]+/)
    .map((url) => url.trim())
    .filter(Boolean);
  const amount = interaction.options.getNumber("amount") ?? undefined;
  const minEdgePercent = interaction.options.getNumber("min-edge") ?? undefined;
  return {
    urls,
    maxStakeUsd: amount,
    minNetEdgeBps: minEdgePercent === undefined ? undefined : minEdgePercent * 100
  };
}

function clearArchiveSettings(settingsJson: string | null): string {
  const settings = { ...parseSettingsJson(settingsJson) };
  delete settings.archivedAt;
  delete settings.archiveReason;
  return stringifySettingsJson(settings);
}

function readArbitrageWatchSide(value: string): ArbitrageWatchSide {
  if (value === "YES" || value === "NO" || value === "BOTH") {
    return value;
  }
  throw new Error("Arbitrage side must be YES, NO, or BOTH.");
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

function buildStatusReplyEmbed(integration: Integration) {
  return buildStatusEmbed(integration, {
    effectiveIntervalMs: getEffectivePollIntervalMs(integration),
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

async function fetchAddressImportAttachmentText(attachment: Attachment): Promise<string> {
  if (attachment.size > maxAddressImportBytes) {
    throw new Error(`Import file is too large. Keep it under ${Math.floor(maxAddressImportBytes / 1024)} KB.`);
  }

  const response = await fetch(attachment.url, {
    headers: { "user-agent": "PolymarketResolutionMonitorBot/0.1" },
    signal: AbortSignal.timeout(addressImportDownloadTimeoutMs)
  });
  if (!response.ok) {
    throw new Error(`Could not download import file: HTTP ${response.status}`);
  }

  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxAddressImportBytes) {
    throw new Error(`Import file is too large. Keep it under ${Math.floor(maxAddressImportBytes / 1024)} KB.`);
  }
  return text;
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

export async function clearOldCheckFailedMessages(guild: Guild, database: BotDatabase, keepLatest = true) {
  const botUserId = guild.client.user?.id;
  const channelIds = [
    ...new Set(
      [
        ...database
          .listIntegrations()
          .filter((integration) => integration.guildId === guild.id)
          .map((integration) => integration.channelId),
        findTextChannelByName(guild, errorLogChannelName)?.id
      ].filter((channelId): channelId is string => typeof channelId === "string")
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
      commandName: getAdapterCommandNameForDiscord(adapter),
      displayName: integration.displayName,
      status: integration.status,
      sourceUrl: integration.sourceUrl,
      polymarketUrl: integration.polymarketUrl,
      marketEnd: formatMarketEnd(marketEnd.endAt),
      marketExpired: marketEnd.endAt ? marketEnd.endAt.getTime() <= Date.now() : false,
      baseIntervalMinutes: integration.pollIntervalMinutes,
      currentIntervalMinutes: getEffectivePollIntervalMs(integration) / 60_000
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

