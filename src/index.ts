import { Client, Events, GatewayIntentBits, MessageFlags, Partials, type ChatInputCommandInteraction } from "discord.js";
import { loadConfig } from "./config.js";
import { handleAdapterCommand, handleBotCommand, isAdapterCommand, isBotCommand } from "./commands.js";
import { BotDatabase } from "./database.js";
import { PollScheduler } from "./poller.js";
import { IntegrationProvisioner } from "./provisioner.js";
import { handleReactionRoleChange } from "./reactionRoles.js";
import { UmaAlertSubscriber } from "./umaAlertSubscriber.js";

const heartbeatIntervalMs = 10 * 60 * 1000;
const config = loadConfig();
const database = new BotDatabase(config.databasePath);
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User]
});
let provisioner: IntegrationProvisioner | null = null;
let umaAlertSubscriber: UmaAlertSubscriber | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

client.once(Events.ClientReady, (readyClient) => {
  try {
    console.log(`Logged in as ${readyClient.user.tag}`);
    provisioner = new IntegrationProvisioner(client, database, config);
    provisioner.start();
    new PollScheduler(client, database).start();
    umaAlertSubscriber = new UmaAlertSubscriber(client, database, config);
    umaAlertSubscriber.start();
    heartbeatTimer = setInterval(() => {
      console.log(`Heartbeat: ${readyClient.user.tag} alive at ${new Date().toISOString()}`);
    }, heartbeatIntervalMs);
    heartbeatTimer.unref();
  } catch (error) {
    console.error("Bot startup failed:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || (!isAdapterCommand(interaction.commandName) && !isBotCommand(interaction.commandName))) {
    return;
  }

  try {
    if (isBotCommand(interaction.commandName)) {
      await handleBotCommand(interaction, database);
    } else {
      await handleAdapterCommand(interaction, database);
    }
  } catch (error) {
    await sendCommandFailure(interaction, error);
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    await handleReactionRoleChange(database, reaction, user, "add");
  } catch (error) {
    console.error("Reaction role add failed:", error);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  try {
    await handleReactionRoleChange(database, reaction, user, "remove");
  } catch (error) {
    console.error("Reaction role remove failed:", error);
  }
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

process.setUncaughtExceptionCaptureCallback((error) => {
  console.error("Captured uncaught exception:", error);
});

process.on("SIGINT", () => {
  provisioner?.stop();
  umaAlertSubscriber?.stop();
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  database.close();
  client.destroy();
  process.exit(0);
});

try {
  await client.login(config.discordToken);
} catch (error) {
  console.error("Discord login failed:", error);
  database.close();
  process.exit(1);
}

async function sendCommandFailure(interaction: ChatInputCommandInteraction, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(`Command failed: ${message}`);
    } else {
      await interaction.reply({ content: `Command failed: ${message}`, flags: MessageFlags.Ephemeral });
    }
  } catch (replyError) {
    if (isUnknownInteractionError(replyError)) {
      console.warn(`Command failed after Discord interaction expired: ${message}`);
      return;
    }

    console.error("Failed to send command failure response:", replyError);
  }
}

function isUnknownInteractionError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === 10062);
}
