import type { MessageReaction, PartialMessageReaction, PartialUser, User } from "discord.js";
import type { BotDatabase } from "./database.js";

type ReactionRoleAction = "add" | "remove";

export async function handleReactionRoleChange(
  database: BotDatabase,
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  action: ReactionRoleAction
): Promise<void> {
  if (user.bot) {
    return;
  }

  const fullReaction = reaction.partial ? await reaction.fetch() : reaction;
  const message = fullReaction.message.partial ? await fullReaction.message.fetch() : fullReaction.message;
  const emoji = fullReaction.emoji.name ?? fullReaction.emoji.toString();
  const integration = database.getIntegrationByRoleMessage(message.id, emoji);

  if (!integration?.alertRoleId || !message.guild) {
    return;
  }

  const member = await message.guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    return;
  }

  if (action === "add") {
    await member.roles.add(integration.alertRoleId, `Opted into ${integration.displayName} alerts`);
    return;
  }

  await member.roles.remove(integration.alertRoleId, `Opted out of ${integration.displayName} alerts`);
}
