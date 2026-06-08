import { execSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction
} from "discord.js";
import { handleArbitrageSelectMenu } from "./arbitrageInteractions.js";
import { loadConfig } from "./config.js";
import { handleAdapterCommand, handleBotCommand, isAdapterCommand, isBotCommand } from "./commands.js";
import { BotDatabase } from "./database.js";
import { handleEventDetailsButton, handleEventDetailsModalSubmit } from "./eventDetails.js";
import { PollScheduler } from "./poller.js";
import { IntegrationProvisioner } from "./provisioner.js";
import { handleReactionRoleChange } from "./reactionRoles.js";
import { UmaAlertSubscriber } from "./umaAlertSubscriber.js";
import { UmaDisputeSubscriber } from "./umaDisputeSubscriber.js";
import { UmaProposalSubscriber } from "./umaProposalSubscriber.js";

const heartbeatIntervalMs = 10 * 60 * 1000;
const heartbeatPath = process.env.BOT_HEARTBEAT_PATH ?? ".health/bot-heartbeat.json";
const startedAt = new Date().toISOString();
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
let umaDisputeSubscriber: UmaDisputeSubscriber | null = null;
let umaProposalSubscriber: UmaProposalSubscriber | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
const runtimeGitCommit = getRuntimeGitCommit();

client.once(Events.ClientReady, (readyClient) => {
  try {
    console.log(`Logged in as ${readyClient.user.tag} at ${new Date().toISOString()} (commit ${runtimeGitCommit}, pid ${process.pid})`);
    writeHeartbeat(readyClient.user.tag);
    provisioner = new IntegrationProvisioner(client, database, config);
    provisioner.start();
    new PollScheduler(client, database).start();
    try {
      umaAlertSubscriber = new UmaAlertSubscriber(client, database, config);
      umaAlertSubscriber.start();
    } catch (error) {
      console.error("UMA alert subscriber startup failed:", error);
    }
    try {
      umaDisputeSubscriber = new UmaDisputeSubscriber(client, database, config);
      umaDisputeSubscriber.start();
    } catch (error) {
      console.error("UMA dispute subscriber startup failed:", error);
    }
    try {
      umaProposalSubscriber = new UmaProposalSubscriber(client, database, config);
      umaProposalSubscriber.start();
    } catch (error) {
      console.error("UMA proposal subscriber startup failed:", error);
    }
    heartbeatTimer = setInterval(() => {
      writeHeartbeat(readyClient.user.tag);
      console.log(`Heartbeat: ${readyClient.user.tag} alive at ${new Date().toISOString()}`);
    }, heartbeatIntervalMs);
    heartbeatTimer.unref();
  } catch (error) {
    console.error("Bot startup failed:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    try {
      await handleEventDetailsButton(interaction, database);
    } catch (error) {
      await sendInteractionFailure(interaction, error);
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    try {
      await handleEventDetailsModalSubmit(interaction, database);
    } catch (error) {
      await sendInteractionFailure(interaction, error);
    }
    return;
  }

  if (interaction.isStringSelectMenu()) {
    try {
      await handleArbitrageSelectMenu(interaction, database);
    } catch (error) {
      await sendInteractionFailure(interaction, error);
    }
    return;
  }

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
    await sendInteractionFailure(interaction, error);
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
  umaDisputeSubscriber?.stop();
  umaProposalSubscriber?.stop();
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

async function sendInteractionFailure(
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction,
  error: unknown
): Promise<void> {
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

function getRuntimeGitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "unknown";
  }
}

function writeHeartbeat(userTag: string): void {
  const absolutePath = resolve(heartbeatPath);
  const tempPath = `${absolutePath}.${process.pid}.tmp`;
  const now = new Date();
  const payload = {
    status: "ready",
    userTag,
    commit: runtimeGitCommit,
    pid: process.pid,
    startedAt,
    heartbeatAt: now.toISOString(),
    uptimeSeconds: Math.round(process.uptime())
  };

  try {
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(tempPath, absolutePath);
  } catch (error) {
    console.error("Failed to write heartbeat file:", error);
  }
}
