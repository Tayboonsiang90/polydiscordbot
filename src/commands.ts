import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction, type TextChannel } from "discord.js";
import type { BotDatabase } from "./database.js";
import {
  buildClearEmbed,
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
  buildStatusEmbed
} from "./embeds.js";
import { getAdapter, getAdapterByCommandName, listAdapters } from "./integrations/registry.js";
import { parseTrumpTruthSettings, upsertTrumpTruthPolymarketMarket } from "./integrations/trumpTruth.js";
import type { Integration, WebsiteAdapter } from "./integrations/types.js";
import { getStoredOrFetchPolymarketEndDate, parseManualEasternDateTime } from "./marketEnd.js";
import { upsertPolymarketQueueUrl } from "./polymarketQueue.js";
import {
  buildAlertMessagePayload,
  checkEventIntegration,
  checkIntegration,
  getEffectivePollIntervalMinutes,
  getPollIntervalReason,
  type CheckResult
} from "./poller.js";

const roleChannelName = "market-alert-roles";

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

    return command;
  });
}

export function buildBotCommands() {
  return [
    new SlashCommandBuilder()
      .setName("bot")
      .setDescription("Bot-level utility commands")
      .addSubcommand((subcommand) => subcommand.setName("summarize").setDescription("Summarize all integrations"))
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
  const integration = database.getIntegrationByChannel(interaction.guild.id, interaction.channel.id);

  if (!integration || integration.adapterId !== adapter.id) {
    await interaction.reply({
      content: `Use this command in the ${adapter.displayName} channel.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

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
    const settings = adapter.getStrikeTerms?.(updated) ?? parseTrumpTruthSettings(updated.settingsJson);
    if (settings.parsedFromUrl && settings.parsedFromUrl !== updated.polymarketUrl) {
      updated = database.setPolymarketUrl(updated.id, settings.parsedFromUrl);
    }

    const result = await adapter.searchStrikeTerm(updated, interaction.options.getString("term", true));
    await interaction.editReply({ embeds: [buildStrikeSearchEmbed(updated, result)] });
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
    if (queue.activeUrl && queue.activeUrl !== updated.polymarketUrl) {
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

    const updated = database.setSettingsJson(integration.id, JSON.stringify({ year, month }));
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
    if (adapter.fetchEventUpdates) {
      const result = await checkEventIntegration(database, integration);
      await interaction.editReply({ embeds: [buildEventCheckEmbed(result)] });
    } else {
      const result = await checkIntegration(database, integration);
      await interaction.editReply({ embeds: [buildCheckEmbed(result)] });
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

