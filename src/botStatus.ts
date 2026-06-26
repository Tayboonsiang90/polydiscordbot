import { ChannelType, EmbedBuilder, type Client, type Guild, type TextChannel } from "discord.js";
import type { BotConfig } from "./config.js";
import { formatSingaporeDateTime, nowSingaporeDateTime } from "./time.js";

const statusColor = {
  ok: 0x2ecc71,
  warning: 0xf1c40f,
  error: 0xe74c3c
} as const;

export type BotStatusLevel = keyof typeof statusColor;

export type BotStatusField = {
  name: string;
  value: string;
  inline?: boolean;
};

export async function sendBotStatusAlert(
  client: Client,
  config: BotConfig,
  level: BotStatusLevel,
  title: string,
  fields: BotStatusField[]
): Promise<void> {
  const guild = await client.guilds.fetch(config.discordGuildId);
  const channel = await findOrCreateBotStatusChannel(guild, config.botStatusChannelName);
  const embed = new EmbedBuilder()
    .setColor(statusColor[level])
    .setTitle(title)
    .addFields(fields.map((field) => ({ ...field, value: truncateFieldValue(field.value) })))
    .setFooter({ text: `Reported at ${nowSingaporeDateTime()}` });

  await channel.send({ embeds: [embed] });
}

export async function findOrCreateBotStatusChannel(guild: Guild, channelName: string): Promise<TextChannel> {
  await guild.channels.fetch();
  const existing = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.name === channelName
  );
  if (existing && existing.type === ChannelType.GuildText) {
    return existing;
  }

  return guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    topic: "Runtime health, restarts, and watchdog alerts for Guangdang Bot."
  });
}

export function buildStartupStatusFields(userTag: string, commit: string, pid: number, startedAt: string): BotStatusField[] {
  return [
    { name: "Bot", value: userTag, inline: true },
    { name: "Commit", value: commit, inline: true },
    { name: "PID", value: String(pid), inline: true },
    { name: "Started at", value: formatSingaporeDateTime(startedAt), inline: false }
  ];
}

export function buildRuntimeErrorStatusFields(error: unknown, commit: string, pid: number): BotStatusField[] {
  return [
    { name: "Error", value: formatErrorForStatus(error), inline: false },
    { name: "Commit", value: commit, inline: true },
    { name: "PID", value: String(pid), inline: true }
  ];
}

function formatErrorForStatus(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`;
  }
  return String(error);
}

function truncateFieldValue(value: string): string {
  return value.length <= 1_024 ? value : `${value.slice(0, 1_021)}...`;
}
