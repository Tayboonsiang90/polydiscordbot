import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { loadConfig } from "./config.js";
import { handleAdapterCommand, handleBotCommand, isAdapterCommand, isBotCommand } from "./commands.js";
import { BotDatabase } from "./database.js";
import { PollScheduler } from "./poller.js";
import { IntegrationProvisioner } from "./provisioner.js";
import { handleReactionRoleChange } from "./reactionRoles.js";

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

client.once(Events.ClientReady, (readyClient) => {
  try {
    console.log(`Logged in as ${readyClient.user.tag}`);
    provisioner = new IntegrationProvisioner(client, database, config);
    provisioner.start();
    new PollScheduler(client, database).start();
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
    const message = error instanceof Error ? error.message : String(error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(`Command failed: ${message}`);
    } else {
      await interaction.reply({ content: `Command failed: ${message}`, ephemeral: true });
    }
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
