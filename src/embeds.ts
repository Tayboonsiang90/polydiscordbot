import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import type { CheckResult, EventCheckResult, SnapshotResult } from "./poller.js";
import type { EventMonitorPost, Integration } from "./integrations/types.js";
import type { MarketEndReminder } from "./marketEnd.js";
import { formatSingaporeDateTime, nowSingaporeDateTime } from "./time.js";

const successColor = 0x2ecc71;
const warningColor = 0xf1c40f;
const errorColor = 0xe74c3c;

export type StatusPollingInfo = {
  effectiveIntervalMinutes?: number;
  reason?: string;
};

export type IntegrationSummaryRow = {
  commandName: string;
  displayName: string;
  status: string;
  sourceUrl: string;
  polymarketUrl: string | null;
  marketEnd: string;
  marketExpired: boolean;
  baseIntervalMinutes: number;
  currentIntervalMinutes: number;
};

export function buildStatusEmbed(integration: Integration, pollingInfo: StatusPollingInfo = {}): EmbedBuilder {
  const effectiveIntervalMinutes = pollingInfo.effectiveIntervalMinutes ?? integration.pollIntervalMinutes;

  return baseEmbed(integration, "Monitor status")
    .addFields(
      { name: "Value", value: formatValue(integration.lastValue), inline: true },
      { name: "Status", value: integration.status, inline: true },
      { name: "Base interval", value: `${integration.pollIntervalMinutes} minute(s)`, inline: true },
      { name: "Current interval", value: `${effectiveIntervalMinutes} minute(s)`, inline: true },
      ...(pollingInfo.reason ? [{ name: "Polling mode", value: pollingInfo.reason, inline: false }] : []),
      ...formatSettingsFields(integration),
      ...formatSnapshotFields(integration),
      { name: "Last checked", value: formatSingaporeDateTime(integration.lastCheckedAt), inline: false },
      { name: "Last changed", value: formatSingaporeDateTime(integration.lastChangedAt), inline: false },
      { name: "Links", value: formatLinks(integration), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildIntegrationSummaryEmbeds(rows: IntegrationSummaryRow[]): EmbedBuilder[] {
  const chunks = chunkRows(rows, 5);
  return chunks.map((chunk, index) =>
    new EmbedBuilder()
      .setColor(successColor)
      .setTitle(`Bot integration summary${chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : ""}`)
      .setDescription("Resolution source, Polymarket URL, parsed market end, and polling interval.")
      .addFields(
        chunk.map((row) => ({
          name: `/${row.commandName} · ${row.displayName} · ${row.status}`,
          value: truncateEmbedValue(
            [
              `Resolution: ${row.sourceUrl}`,
              `Polymarket: ${row.polymarketUrl ?? "not set"}`,
              `End: ${row.marketExpired ? "⚠️ EXPIRED - " : ""}${row.marketEnd}`,
              `Interval: ${row.currentIntervalMinutes} min current / ${row.baseIntervalMinutes} min base`
            ].join("\n"),
            800
          ),
          inline: false
        }))
      )
      .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` })
  );
}

export function buildSnapshotStoredEmbed(integration: Integration): EmbedBuilder {
  return baseEmbed(integration, "Stored daily snapshot")
    .addFields(
      { name: "Snapshot date", value: integration.snapshotDate ?? "not captured yet", inline: true },
      { name: "Captured at", value: formatSingaporeDateTime(integration.snapshotCheckedAt), inline: false },
      { name: "Snapshot value", value: formatValue(integration.snapshotValue), inline: false },
      { name: "Links", value: formatLinks(integration), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildLastEmbed(integration: Integration): EmbedBuilder {
  return baseEmbed(integration, "Last stored value")
    .addFields(
      { name: "Value", value: formatValue(integration.lastValue), inline: true },
      { name: "Retrieved at", value: formatSingaporeDateTime(integration.lastCheckedAt), inline: false },
      { name: "Links", value: formatLinks(integration), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildCheckEmbed(result: CheckResult): EmbedBuilder {
  const title = result.changed ? "Value changed" : "Current value";
  const embed = baseEmbed(result.integration, title)
    .addFields(
      { name: "Current", value: formatValue(result.currentValue), inline: true },
      { name: "Current retrieved at", value: formatSingaporeDateTime(result.integration.lastCheckedAt), inline: false },
      { name: "Last stored", value: formatValue(result.previousValue), inline: true },
      { name: "Last retrieved at", value: formatSingaporeDateTime(result.previousCheckedAt), inline: false },
      { name: "Links", value: formatLinks(result.integration), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });

  return embed;
}

export function buildEventCheckEmbed(result: EventCheckResult): EmbedBuilder {
  return baseEmbed(result.integration, "Event check complete")
    .addFields(
      { name: "New posts", value: String(result.newPosts.length), inline: true },
      { name: "Latest seen post", value: result.latestSeenId ?? "none", inline: true },
      { name: "Latest Truth", value: result.latestSeenUrl ?? "none", inline: false },
      { name: "Strike terms", value: formatStrikeTerms(result.strikeTerms), inline: false },
      { name: "Checked at", value: formatSingaporeDateTime(result.integration.lastCheckedAt), inline: false },
      { name: "Links", value: formatLinks(result.integration), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildStrikeTermsEmbed(integration: Integration, strikeTerms: string[], parsedFromUrl?: string, lastParsedAt?: string): EmbedBuilder {
  return baseEmbed(integration, "Strike terms")
    .addFields(
      { name: "Terms", value: formatStrikeTerms(strikeTerms), inline: false },
      { name: "Parsed from", value: parsedFromUrl ?? "not parsed yet", inline: false },
      { name: "Parsed at", value: formatSingaporeDateTime(lastParsedAt ?? null), inline: false },
      { name: "Links", value: formatLinks(integration), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildPolymarketUpdatedEmbed(integration: Integration): EmbedBuilder {
  return baseEmbed(integration, "Polymarket URL updated")
    .addFields(
      { name: "Polymarket", value: formatPolymarketLink(integration), inline: false },
      { name: "Updated at", value: formatSingaporeDateTime(integration.updatedAt), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildMarketEndManualUpdatedEmbed(integration: Integration, endAt: Date): EmbedBuilder {
  return baseEmbed(integration, "Market end manually set")
    .addFields(
      { name: "Market ends ET", value: formatEasternDateTime(endAt), inline: false },
      { name: "Market ends SGT", value: formatSingaporeDateTime(endAt), inline: false },
      { name: "Polymarket", value: formatPolymarketLink(integration), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildIntervalUpdatedEmbed(integration: Integration): EmbedBuilder {
  return baseEmbed(integration, "Polling interval updated")
    .addFields(
      { name: "Interval", value: `${integration.pollIntervalMinutes} minute(s)`, inline: true },
      { name: "Updated at", value: formatSingaporeDateTime(integration.updatedAt), inline: false },
      { name: "Links", value: formatLinks(integration), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildPeriodUpdatedEmbed(integration: Integration, year: number, month: number): EmbedBuilder {
  return baseEmbed(integration, "Period updated")
    .addFields(
      { name: "Period", value: `${year}-${String(month).padStart(2, "0")}`, inline: true },
      { name: "Updated at", value: formatSingaporeDateTime(integration.updatedAt), inline: false },
      { name: "Links", value: formatLinks(integration), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildClearEmbed(integration: Integration, deletedCount: number): EmbedBuilder {
  return baseEmbed(integration, "Channel cleared")
    .addFields(
      { name: "Deleted messages", value: String(deletedCount), inline: true },
      { name: "Links", value: formatLinks(integration), inline: false }
    )
    .setFooter({ text: `Cleared at ${nowSingaporeDateTime()}` });
}

export function buildAlertEmbed(result: CheckResult): EmbedBuilder {
  return baseEmbed(result.integration, "Value changed")
    .setColor(successColor)
    .addFields(
      { name: "Previous", value: formatValue(result.previousValue), inline: true },
      { name: "Current", value: formatValue(result.currentValue), inline: true },
      { name: "Retrieved at", value: formatSingaporeDateTime(result.integration.lastCheckedAt), inline: false },
      { name: "Links", value: formatLinks(result.integration), inline: false }
    )
    .setFooter({ text: `Alert sent at ${nowSingaporeDateTime()}` });
}

export function buildEventPostEmbed(integration: Integration, post: EventMonitorPost): EmbedBuilder[] {
  const hasStrike = post.matchedTerms.length > 0;
  const hasImages = post.imageUrls.length > 0;
  const title = hasStrike
    ? "TEXT STRIKE DETECTED"
    : hasImages
      ? "New post - review attached images manually"
      : "New post";
  const embeds = [
    baseEmbed(integration, title)
      .setColor(hasStrike ? errorColor : successColor)
      .addFields(
        ...(hasStrike
          ? [{ name: "STRIKE HIT", value: formatMatchedStrikeTerms(post.matchedTerms), inline: false }]
          : []),
        { name: "Post type", value: post.type, inline: true },
        { name: "Posted at", value: formatSingaporeDateTime(post.postedAt), inline: false },
        { name: "Truth Social", value: post.url, inline: false },
        { name: "Matched text terms", value: post.matchedTerms.length ? post.matchedTerms.join(", ") : "none", inline: false },
        {
          name: "Image review",
          value: hasImages && !hasStrike ? "No text strike detected — review attached images manually." : hasImages ? "Images attached." : "none",
          inline: false
        },
        { name: "Strike list", value: formatStrikeTerms(post.strikeTerms), inline: false },
        ...(post.imageText ? [{ name: "Image text", value: formatValue(post.imageText), inline: false }] : []),
        { name: "Post text", value: formatValue(post.text || "(no text)"), inline: false },
        { name: "Links", value: [`Original: ${post.url}`, `Polymarket: ${post.polymarketUrl ?? formatPolymarketValue(integration)}`].join("\n"), inline: false }
      )
      .setFooter({ text: `Alert sent at ${nowSingaporeDateTime()}` })
  ];

  for (const imageUrl of post.imageUrls.slice(0, 3)) {
    embeds.push(new EmbedBuilder().setColor(hasStrike ? errorColor : successColor).setTitle("Attached image").setImage(imageUrl));
  }

  return embeds;
}

export function buildEventPostMessagePayload(integration: Integration, post: EventMonitorPost) {
  return {
    content: formatEventPostMessageContent(integration, post),
    embeds: buildEventPostEmbed(integration, post),
    components: [buildTruthSocialLinkRow(post.url)],
    allowedMentions: integration.alertRoleId ? { roles: [integration.alertRoleId] } : { parse: [] }
  };
}

export function buildSnapshotCapturedEmbed(result: SnapshotResult): EmbedBuilder {
  return baseEmbed(result.integration, "12:00 PM ET daily snapshot")
    .setColor(successColor)
    .addFields(
      { name: "Snapshot date", value: result.snapshotDate, inline: true },
      { name: "Captured at", value: formatSingaporeDateTime(result.integration.snapshotCheckedAt), inline: false },
      { name: "Snapshot value", value: formatValue(result.snapshotValue), inline: false },
      { name: "Stored separately", value: "Regular interval checks cannot overwrite this daily snapshot.", inline: false },
      { name: "Links", value: formatLinks(result.integration), inline: false }
    )
    .setFooter({ text: `Snapshot alert sent at ${nowSingaporeDateTime()}` });
}

export function buildMarketEndReminderEmbed(integration: Integration, reminder: MarketEndReminder): EmbedBuilder {
  return baseEmbed(integration, "Polymarket end reminder")
    .setColor(warningColor)
    .addFields(
      { name: "Reminder", value: reminder.label, inline: false },
      { name: "Market ends ET", value: formatEasternDateTime(reminder.endAt), inline: false },
      { name: "Market ends SGT", value: formatSingaporeDateTime(reminder.endAt), inline: false },
      { name: "Market ends UTC", value: reminder.endAt.toISOString(), inline: false },
      { name: "Action", value: "Update this integration's Polymarket URL if you are moving to the next market.", inline: false },
      { name: "Command", value: "Use this channel's `/... polymarket url:<new-polymarket-url>` subcommand.", inline: false },
      { name: "Links", value: formatLinks(integration), inline: false }
    )
    .setFooter({ text: `Reminder sent at ${nowSingaporeDateTime()}` });
}

export function buildMarketEndMissingEmbed(integration: Integration): EmbedBuilder {
  return baseEmbed(integration, "Polymarket end date missing")
    .setColor(warningColor)
    .addFields(
      { name: "Problem", value: "Polymarket Gamma API did not return an endDate for this market URL.", inline: false },
      { name: "Action", value: "Check the Polymarket URL, or manually set the ET end time with this channel's `enddate` command.", inline: false },
      { name: "Example", value: "`/... enddate datetime:2026-05-10 23:59`", inline: false },
      { name: "Links", value: formatLinks(integration), inline: false }
    )
    .setFooter({ text: `Warning sent at ${nowSingaporeDateTime()}` });
}

export function buildErrorEmbed(integration: Integration, message: string): EmbedBuilder {
  return baseEmbed(integration, "Check failed")
    .setColor(errorColor)
    .addFields(
      { name: "Error", value: truncateEmbedValue(message), inline: false },
      { name: "Polymarket", value: formatPolymarketValue(integration), inline: false }
    )
    .setFooter({ text: `Failed at ${nowSingaporeDateTime()}` });
}

export function buildSetupEmbed(integration: Integration, commandName: string): EmbedBuilder {
  return baseEmbed(integration, "Monitor created")
    .addFields(
      { name: "Command", value: `/${commandName}`, inline: true },
      { name: "Interval", value: `${integration.pollIntervalMinutes} minute(s)`, inline: true },
      { name: "Links", value: formatLinks(integration), inline: false }
    )
    .setFooter({ text: `Created at ${formatSingaporeDateTime(integration.createdAt)}` });
}

export function buildRoleSelectorEmbed(integration: Integration, roleName: string, emoji: string): EmbedBuilder {
  return baseEmbed(integration, "Alert role")
    .addFields(
      { name: "Role", value: roleName, inline: true },
      { name: "Emoji", value: emoji, inline: true },
      { name: "Action", value: "React to receive alerts. Remove your reaction to opt out.", inline: false },
      { name: "Links", value: formatLinks(integration), inline: false }
    )
    .setFooter({ text: `Updated at ${nowSingaporeDateTime()}` });
}

export type GroupedRoleSelectorEntry = {
  displayName: string;
  commandName: string;
  roleId: string;
  roleName: string;
  emoji: string;
};

export function buildGroupedRoleSelectorEmbed(
  entries: GroupedRoleSelectorEntry[],
  groupIndex: number,
  groupCount: number
): EmbedBuilder {
  const title = groupCount > 1 ? `Market Alert Roles ${groupIndex + 1}/${groupCount}` : "Market Alert Roles";
  return new EmbedBuilder()
    .setColor(successColor)
    .setTitle(title)
    .setDescription("React to receive alerts. Remove your reaction to opt out.")
    .addFields(
      entries.map((entry) => ({
        name: `${entry.emoji} ${entry.displayName}`,
        value: `Role: <@&${entry.roleId}>\nCommand: \`/${entry.commandName}\``,
        inline: false
      }))
    )
    .setFooter({ text: `Updated at ${nowSingaporeDateTime()}` });
}

export function formatPolymarketLink(integration: Integration): string {
  return formatPolymarketValue(integration);
}

function baseEmbed(integration: Integration, title: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(integration.status === "paused" ? warningColor : successColor)
    .setTitle(`${integration.displayName} - ${title}`);
}

function buildTruthSocialLinkRow(url: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel("Open Truth").setStyle(ButtonStyle.Link).setURL(url)
  );
}

function formatEventPostMessageContent(integration: Integration, post: EventMonitorPost): string | undefined {
  const roleMention = integration.alertRoleId ? `<@&${integration.alertRoleId}>` : undefined;
  if (!post.matchedTerms.length) {
    return roleMention;
  }

  const strikeLine = `TEXT STRIKE DETECTED: ${post.matchedTerms.join(", ")}`;
  return roleMention ? `${roleMention}\n**${strikeLine}**` : `**${strikeLine}**`;
}

function formatMatchedStrikeTerms(matchedTerms: string[]): string {
  return `**${matchedTerms.join(", ")}**\n\`\`\`text\n${matchedTerms.join("\n")}\n\`\`\``;
}

function formatLinks(integration: Integration): string {
  return [`Resolution: ${integration.sourceUrl}`, `Polymarket: ${formatPolymarketValue(integration)}`].join("\n");
}

function formatPolymarketValue(integration: Integration): string {
  return integration.polymarketUrl ?? "not set";
}

function formatEasternDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatValue(value: string | null): string {
  return value ? truncateEmbedValue(value) : "not checked yet";
}

function formatStrikeTerms(strikeTerms: string[]): string {
  return strikeTerms.length ? truncateEmbedValue(strikeTerms.join(", ")) : "none parsed yet";
}

function formatSettingsFields(integration: Integration) {
  if (!integration.settingsJson) {
    return [];
  }

  try {
    const settings = JSON.parse(integration.settingsJson) as { year?: unknown; month?: unknown };
    if (typeof settings.year === "number" && typeof settings.month === "number") {
      return [{ name: "Period", value: `${settings.year}-${String(settings.month).padStart(2, "0")}`, inline: true }];
    }
  } catch {
    return [];
  }

  return [];
}

function formatSnapshotFields(integration: Integration) {
  if (!integration.snapshotDate && !integration.snapshotValue) {
    return [];
  }

  return [
    { name: "Daily snapshot date", value: integration.snapshotDate ?? "not captured yet", inline: true },
    { name: "Daily snapshot captured", value: formatSingaporeDateTime(integration.snapshotCheckedAt), inline: false }
  ];
}

function truncateEmbedValue(value: string, maxLength = 1000): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks.length ? chunks : [[]];
}
