import { ChannelType, type Client, type Guild, type Role, type TextChannel } from "discord.js";
import type { BotConfig } from "./config.js";
import type { BotDatabase } from "./database.js";
import { buildRoleSelectorEmbed, buildSetupEmbed } from "./embeds.js";
import { listAdapters } from "./integrations/registry.js";
import type { Integration, WebsiteAdapter } from "./integrations/types.js";

const roleChannelName = "market-alert-roles";
const networkRetryDelaysMs = [1_000, 3_000, 10_000];

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
        await this.provisionAlertRole(guild, adapter, updatedIntegration);
        return;
      }
      await this.provisionAlertRole(guild, adapter, existingIntegration);
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
    await this.provisionAlertRole(guild, adapter, integration);
  }

  private async provisionAlertRole(guild: Guild, adapter: WebsiteAdapter, integration: Integration): Promise<void> {
    const role = await findOrCreateRole(guild, integration.alertRoleId, adapter.alertRoleName);
    const roleChannel = await findOrCreateRoleChannel(guild);
    const roleMessage = await findOrCreateRoleMessage(roleChannel, integration.roleMessageId, integration, adapter, role);

    await roleMessage.react(adapter.alertRoleEmoji);
    this.database.setAlertRoleMetadata(integration.id, {
      alertRoleId: role.id,
      roleMessageId: roleMessage.id,
      roleChannelId: roleChannel.id,
      roleEmoji: adapter.alertRoleEmoji
    });
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

async function findOrCreateRoleChannel(guild: Guild): Promise<TextChannel> {
  const existing = findTextChannelByName(guild, roleChannelName);
  if (existing) {
    return existing;
  }

  return guild.channels.create({
    name: roleChannelName,
    type: ChannelType.GuildText,
    topic: "React to receive market update alert roles"
  });
}

async function findOrCreateRoleMessage(
  channel: TextChannel,
  messageId: string | null,
  integration: Integration,
  adapter: WebsiteAdapter,
  role: Role
) {
  const existing = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;
  if (existing) {
    await existing.edit({ embeds: [buildRoleSelectorEmbed(integration, role.name, adapter.alertRoleEmoji)] });
    return existing;
  }

  return channel.send({ embeds: [buildRoleSelectorEmbed(integration, role.name, adapter.alertRoleEmoji)] });
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
