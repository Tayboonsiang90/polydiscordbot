import { MessageFlags, type ButtonInteraction } from "discord.js";
import { BotDatabase } from "./database.js";
import { buildEventPostDetailsEmbed, parseEventDetailsCustomId } from "./embeds.js";

export async function handleEventDetailsButton(
  interaction: ButtonInteraction,
  database: BotDatabase
): Promise<boolean> {
  const parsed = parseEventDetailsCustomId(interaction.customId);
  if (!parsed) {
    return false;
  }

  const alert = database.getEventAlert(parsed.integrationId, parsed.eventId);
  if (!alert?.post.hiddenFields?.length) {
    await interaction.reply({
      content: "Extra details are no longer available for this alert.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const integration = database.getIntegrationById(parsed.integrationId);
  await interaction.reply({
    embeds: [buildEventPostDetailsEmbed(integration, alert.post)],
    flags: MessageFlags.Ephemeral
  });
  return true;
}
