import "dotenv/config";

export type BotConfig = {
  discordToken: string;
  discordClientId: string;
  discordGuildId: string;
  databasePath: string;
  defaultPollIntervalMinutes: number;
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

  return {
    discordToken: requiredEnv("DISCORD_TOKEN"),
    discordClientId: requiredEnv("DISCORD_CLIENT_ID"),
    discordGuildId: requiredEnv("DISCORD_GUILD_ID"),
    databasePath: process.env.DATABASE_PATH ?? "data/bot.sqlite",
    defaultPollIntervalMinutes
  };
}
