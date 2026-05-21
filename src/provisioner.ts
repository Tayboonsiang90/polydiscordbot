import { ChannelType, type Client, type Guild, type Message, type Role, type TextChannel } from "discord.js";
import type { BotConfig } from "./config.js";
import type { BotDatabase } from "./database.js";
import { buildGroupedRoleSelectorEmbed, buildSetupEmbed, type GroupedRoleSelectorEntry } from "./embeds.js";
import { listAdapters } from "./integrations/registry.js";
import type { Integration, WebsiteAdapter } from "./integrations/types.js";

const defaultRoleChannelName = "market-alert-roles";
const defaultRoleGroupTitle = "Market Alert Roles";
const networkRetryDelaysMs = [1_000, 3_000, 10_000];
const maxReactionsPerRoleMessage = 20;
const fallbackAlertRoleEmojis = ["\uD83D\uDD14", "\uD83D\uDCE3", "\u2705", "\u2B50", "\uD83D\uDCCC", "\uD83D\uDCAC"];

type AlertRoleEntry = GroupedRoleSelectorEntry & {
  integration: Integration;
  adapter: WebsiteAdapter;
  role: Role;
  roleChannelName: string;
  roleGroupTitle: string;
};

export class IntegrationProvisioner {
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly client: Client,
    private readonly database: BotDatabase,
    private readonly config: BotConfig
  ) {}

  start(): void {
    void this.provisionAll().catch(logProvisionerError);
    this.refreshTimer = setInterval(() => void this.provisionAll().catch(logProvisionerError), 60_000);
    this.refreshTimer.unref();
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async provisionAll(): Promise<void> {
    const guild = await this.client.guilds.fetch(this.config.discordGuildId);
    await guild.channels.fetch();
    await guild.roles.fetch();

    for (const adapter of listAdapters()) {
      try {
        await retryTransientDiscordNetworkError(() => this.provisionAdapter(guild, adapter));
      } catch (error) {
        console.error(`Provisioning failed for ${adapter.id}: ${formatProvisioningError(error)}`);
      }
    }

    await retryTransientDiscordNetworkError(() => this.provisionAlertRoleSelectors(guild));
  }

  private async provisionAdapter(guild: Guild, adapter: WebsiteAdapter): Promise<void> {
    const existingIntegration = this.database.getIntegrationByAdapter(guild.id, adapter.id);
    const existingChannel = existingIntegration
      ? await guild.channels.fetch(existingIntegration.channelId).catch(() => null)
      : null;
    const channelByName = findTextChannelByName(guild, adapter.defaultChannelName);
    const channel = asTextChannel(existingChannel) ?? channelByName ?? (await createIntegrationChannel(guild, adapter));

    if (existingIntegration) {
      const existingTextChannel = asTextChannel(existingChannel);
      if (existingTextChannel && shouldRenameLegacyChannel(existingTextChannel.name, adapter)) {
        await existingTextChannel.setName(adapter.defaultChannelName);
      }

      if (existingIntegration.channelId !== channel.id) {
        const updatedIntegration = this.database.updateIntegrationChannel(existingIntegration.id, channel.id);
        await findOrCreateRole(guild, updatedIntegration.alertRoleId, adapter.alertRoleName);
        return;
      }
      await findOrCreateRole(guild, existingIntegration.alertRoleId, adapter.alertRoleName);
      return;
    }

    const integration = this.database.createIntegration({
      guildId: guild.id,
      channelId: channel.id,
      adapterId: adapter.id,
      displayName: adapter.displayName,
      sourceUrl: adapter.sourceUrl,
      polymarketUrl: adapter.defaultPolymarketUrl ?? null,
      settingsJson: adapter.defaultSettings ? JSON.stringify(adapter.defaultSettings) : null,
      pollIntervalMinutes: this.config.defaultPollIntervalMinutes
    });

    await channel.send({ embeds: [buildSetupEmbed(integration, adapter.commandName)] });
    await findOrCreateRole(guild, integration.alertRoleId, adapter.alertRoleName);
  }

  private async provisionAlertRoleSelectors(guild: Guild): Promise<void> {
    const entries = await this.buildAlertRoleEntries(guild);
    const channelGroups = groupEntriesByRoleChannel(entries);

    for (const channelGroup of channelGroups) {
      const roleChannel = await findOrCreateRoleChannel(guild, channelGroup.channelName, channelGroup.title);
      const groups = groupAlertRoleEntries(channelGroup.entries);
      const activeMessageIds = new Set<string>();

      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index];
        const roleMessage = await findOrCreateGroupedRoleMessage(roleChannel, group, channelGroup.title);
        const reactedEntries = await syncGroupedRoleMessage(roleMessage, group, index, groups.length, channelGroup.title);
        activeMessageIds.add(roleMessage.id);

        for (const entry of reactedEntries) {
          this.database.setAlertRoleMetadata(entry.integration.id, {
            alertRoleId: entry.role.id,
            roleMessageId: roleMessage.id,
            roleChannelId: roleChannel.id,
            roleEmoji: entry.emoji
          });
        }
      }

      await cleanupStaleRoleMessages(roleChannel, this.client.user?.id ?? null, activeMessageIds, channelGroup.title);
    }
  }

  private async buildAlertRoleEntries(guild: Guild): Promise<AlertRoleEntry[]> {
    const entries: AlertRoleEntry[] = [];
    for (const adapter of listAdapters()) {
      const integration = this.database.getIntegrationByAdapter(guild.id, adapter.id);
      if (!integration) {
        continue;
      }

      const role = await findOrCreateRole(guild, integration.alertRoleId, adapter.alertRoleName);
      entries.push({
        integration,
        adapter,
        role,
        displayName: adapter.displayName,
        commandName: adapter.commandName,
        roleId: role.id,
        roleName: role.name,
        emoji: adapter.alertRoleEmoji,
        roleChannelName: adapter.alertRoleChannelName ?? defaultRoleChannelName,
        roleGroupTitle: adapter.alertRoleGroupTitle ?? defaultRoleGroupTitle
      });
    }
    return entries;
  }
}

function shouldRenameLegacyChannel(channelName: string, adapter: WebsiteAdapter): boolean {
  return Boolean(adapter.legacyChannelNames?.includes(channelName) && channelName !== adapter.defaultChannelName);
}

function findTextChannelByName(guild: Guild, channelName: string): TextChannel | null {
  const channel = guild.channels.cache.find(
    (candidate) => candidate.type === ChannelType.GuildText && candidate.name === channelName
  );
  return asTextChannel(channel);
}

function asTextChannel(channel: unknown): TextChannel | null {
  if (channel && typeof channel === "object" && "type" in channel && channel.type === ChannelType.GuildText) {
    return channel as TextChannel;
  }
  return null;
}

async function createIntegrationChannel(guild: Guild, adapter: WebsiteAdapter): Promise<TextChannel> {
  return guild.channels.create({
    name: adapter.defaultChannelName,
    type: ChannelType.GuildText,
    topic: `Polymarket resolution monitor: ${adapter.displayName} | ${adapter.sourceUrl}`
  });
}

async function findOrCreateRole(guild: Guild, roleId: string | null, roleName: string): Promise<Role> {
  const existingById = roleId ? await guild.roles.fetch(roleId).catch(() => null) : null;
  if (existingById) {
    if (existingById.name !== roleName) {
      await existingById.setName(roleName, "Synchronize integration alert role name");
    }
    return existingById;
  }

  const existingByName = guild.roles.cache.find((role) => role.name === roleName);
  if (existingByName) {
    return existingByName;
  }

  return guild.roles.create({
    name: roleName,
    mentionable: true,
    reason: "Create integration alert role"
  });
}

async function findOrCreateRoleChannel(guild: Guild, channelName: string, title: string): Promise<TextChannel> {
  const existing = findTextChannelByName(guild, channelName);
  if (existing) {
    return existing;
  }

  return guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    topic: `React to receive ${title.toLowerCase()}`
  });
}

async function findOrCreateGroupedRoleMessage(channel: TextChannel, entries: AlertRoleEntry[], title: string): Promise<Message> {
  const existingMessageIds = [...new Set(entries.map((entry) => entry.integration.roleMessageId).filter(Boolean))] as string[];
  for (const messageId of existingMessageIds) {
    const existing = await channel.messages.fetch(messageId).catch(() => null);
    if (existing && isGroupedRoleMessage(existing, title)) {
      return existing;
    }
  }

  return channel.send({ embeds: [buildGroupedRoleSelectorEmbed(entries, 0, 1, title)] });
}

async function syncGroupedRoleMessage(
  roleMessage: Message,
  entries: AlertRoleEntry[],
  groupIndex: number,
  groupCount: number,
  title: string
): Promise<AlertRoleEntry[]> {
  const reactedEntries = entries.map((entry) => ({ ...entry }));
  await removeObsoleteRoleReactions(roleMessage, reactedEntries);

  const usedEmojis = new Set<string>();
  for (const entry of reactedEntries) {
    entry.emoji = await reactWithFallbackEmoji(roleMessage, entry, usedEmojis);
    usedEmojis.add(entry.emoji);
  }

  await roleMessage.edit({ embeds: [buildGroupedRoleSelectorEmbed(reactedEntries, groupIndex, groupCount, title)] });
  return reactedEntries;
}

async function removeObsoleteRoleReactions(roleMessage: Message, entries: AlertRoleEntry[]): Promise<void> {
  const allowedEmojis = new Set(entries.map((entry) => entry.adapter.alertRoleEmoji));

  for (const reaction of roleMessage.reactions.cache.values()) {
    const emoji = reaction.emoji.name ?? reaction.emoji.toString();
    if (allowedEmojis.has(emoji)) {
      continue;
    }

    await reaction.remove().catch(() => undefined);
  }
}

async function reactWithFallbackEmoji(
  roleMessage: Message,
  entry: AlertRoleEntry,
  usedEmojis: Set<string>
): Promise<string> {
  const candidates = [entry.adapter.alertRoleEmoji, ...fallbackAlertRoleEmojis].filter((emoji) => !usedEmojis.has(emoji));
  for (const emoji of candidates) {
    if (hasReactionEmoji(roleMessage, emoji)) {
      return emoji;
    }

    try {
      await roleMessage.react(emoji);
      if (emoji !== entry.adapter.alertRoleEmoji) {
        console.error(`Invalid alertRoleEmoji for ${entry.adapter.id}: ${entry.adapter.alertRoleEmoji}. Falling back to ${emoji}.`);
      }
      return emoji;
    } catch (error) {
      if (!isUnknownEmojiError(error)) {
        throw error;
      }
    }
  }

  throw new Error(`No usable alert role emoji found for ${entry.adapter.id}`);
}

function hasReactionEmoji(roleMessage: Message, emoji: string): boolean {
  return roleMessage.reactions.cache.some((reaction) => (reaction.emoji.name ?? reaction.emoji.toString()) === emoji);
}

function groupAlertRoleEntries(entries: AlertRoleEntry[]): AlertRoleEntry[][] {
  const groups: AlertRoleEntry[][] = [];
  for (const entry of entries) {
    const group = groups.find(
      (candidate) =>
        candidate.length < maxReactionsPerRoleMessage && !candidate.some((existing) => existing.emoji === entry.emoji)
    );
    if (group) {
      group.push(entry);
      continue;
    }

    groups.push([entry]);
  }

  return groups;
}

function groupEntriesByRoleChannel(entries: AlertRoleEntry[]): Array<{ channelName: string; title: string; entries: AlertRoleEntry[] }> {
  const groups = new Map<string, { channelName: string; title: string; entries: AlertRoleEntry[] }>();
  for (const entry of entries) {
    const existing = groups.get(entry.roleChannelName);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }

    groups.set(entry.roleChannelName, {
      channelName: entry.roleChannelName,
      title: entry.roleGroupTitle,
      entries: [entry]
    });
  }

  return [...groups.values()];
}

async function cleanupStaleRoleMessages(
  channel: TextChannel,
  botUserId: string | null,
  activeMessageIds: Set<string>,
  title: string
): Promise<void> {
  if (!botUserId) {
    return;
  }

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) {
    return;
  }

  for (const message of messages.values()) {
    if (message.author.id !== botUserId || activeMessageIds.has(message.id)) {
      continue;
    }

    if (isLegacyRoleMessage(message) || isGroupedRoleMessage(message, title)) {
      await message.delete().catch(() => undefined);
    }
  }
}

function isLegacyRoleMessage(message: Message): boolean {
  return message.embeds.some((embed) => embed.title?.endsWith(" - Alert role"));
}

function isGroupedRoleMessage(message: Message, title: string): boolean {
  return message.embeds.some((embed) => embed.title?.startsWith(title));
}

function isUnknownEmojiError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === 10014);
}

function logProvisionerError(error: unknown): void {
  console.error(`Integration provisioning failed: ${formatProvisioningError(error)}`);
}

async function retryTransientDiscordNetworkError<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= networkRetryDelaysMs.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt === networkRetryDelaysMs.length) {
        throw error;
      }

      await delay(networkRetryDelaysMs[attempt]);
    }
  }

  throw lastError;
}

function isTransientNetworkError(error: unknown): boolean {
  const codes = collectErrorCodes(error);
  return codes.some((code) =>
    ["EACCES", "ECONNRESET", "ECONNABORTED", "EHOSTUNREACH", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code)
  );
}

function formatProvisioningError(error: unknown): string {
  if (isTransientNetworkError(error)) {
    const codes = [...new Set(collectErrorCodes(error))].join(", ");
    return `Discord network request failed (${codes || "network error"}). This is usually local firewall/VPN/DNS/network access to Discord/Cloudflare; provisioning will retry automatically.`;
  }

  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function collectErrorCodes(error: unknown): string[] {
  if (!error || typeof error !== "object") {
    return [];
  }

  const codes: string[] = [];
  const maybeCode = "code" in error ? error.code : undefined;
  if (typeof maybeCode === "string") {
    codes.push(maybeCode);
  }

  const maybeErrors = "errors" in error ? error.errors : undefined;
  if (Array.isArray(maybeErrors)) {
    for (const nestedError of maybeErrors) {
      codes.push(...collectErrorCodes(nestedError));
    }
  }

  return codes;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
