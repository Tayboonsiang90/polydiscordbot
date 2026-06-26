import "dotenv/config";

export type BotConfig = {
  discordToken: string;
  discordClientId: string;
  discordGuildId: string;
  databasePath: string;
  defaultPollIntervalMinutes: number;
  heartbeatPath: string;
  heartbeatIntervalSeconds: number;
  botStatusChannelName: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): BotConfig {
  const defaultPollIntervalMinutes = Number(process.env.DEFAULT_POLL_INTERVAL_MINUTES ?? "5");
  if (!Number.isInteger(defaultPollIntervalMinutes) || defaultPollIntervalMinutes < 1) {
    throw new Error("DEFAULT_POLL_INTERVAL_MINUTES must be an integer >= 1");
  }

  const heartbeatIntervalSeconds = parsePositiveIntegerEnv("BOT_HEARTBEAT_INTERVAL_SECONDS", 30);

  return {
    discordToken: requiredEnv("DISCORD_TOKEN"),
    discordClientId: requiredEnv("DISCORD_CLIENT_ID"),
    discordGuildId: requiredEnv("DISCORD_GUILD_ID"),
    databasePath: process.env.DATABASE_PATH ?? "data/bot.sqlite",
    defaultPollIntervalMinutes,
    heartbeatPath: process.env.BOT_HEARTBEAT_PATH ?? ".health/bot-heartbeat.json",
    heartbeatIntervalSeconds,
    botStatusChannelName: process.env.BOT_STATUS_CHANNEL_NAME ?? "bot-status"
  };
}

function parsePositiveIntegerEnv(name: string, defaultValue: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be an integer >= 1`);
  }
  return value;
}
