import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { formatAddressWithLabel, getAddressLabelsFromSettingsJson } from "./addressLabels.js";
import type { IntegrationUpdateLog } from "./database.js";
import type { CheckResult, EventCheckResult, MarketRollover, SnapshotResult } from "./poller.js";
import type {
  AddressLabelImportIssue,
  AddressLabelUpdateResult,
  AddressPositionStatus,
  ArbitrageSetupResult,
  ArbitrageWatchResult,
  EventMonitorPost,
  Integration,
  ResolvableWatchlistEntry,
  ResolvableWatchlistUpdateResult,
  StrikeSearchResult,
  TagBlocklistUpdateResult,
  TagFilterEntry,
  TagFilterUpdateResult,
  TagSearchResult,
  ThresholdUpdateResult
} from "./integrations/types.js";
import type { MarketEndReminder } from "./marketEnd.js";
import { parseSettingsJson } from "./settingsJson.js";
import {
  formatEasternDateTime as formatSharedEasternDateTime,
  formatSingaporeDateTime,
  nowEasternDateTime,
  nowSingaporeDateTime
} from "./time.js";
import { getTurboPollingSettings } from "./turboPolling.js";

const successColor = 0x2ecc71;
const warningColor = 0xf1c40f;
const errorColor = 0xe74c3c;
const eventDetailsCustomIdPrefix = "event-details:";
const eventRefreshCustomIdPrefix = "event-refresh:";
const addressLabelButtonCustomIdPrefix = "address-label:";
const addressLabelModalCustomIdPrefix = "address-label-modal:";
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
export const addressLabelModalNameInputId = "address-label-name";
export type AddressLabelButtonRole = "proposer" | "disputer";

export type StatusPollingInfo = {
  effectiveIntervalMinutes?: number;
  effectiveIntervalMs?: number;
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

export type ErrorCleanupSummary = {
  scannedChannels: number;
  deletedMessages: number;
  keptMessages: number;
  skippedChannels: number;
  failedDeletes: number;
  keepLatest: boolean;
};

export type CheckAllChannelResult = {
  integration: Integration;
  ok: boolean;
  currentValue?: string;
  durationMs: number;
  completed: number;
  total: number;
  error?: string;
};

export function buildStatusEmbed(integration: Integration, pollingInfo: StatusPollingInfo = {}): EmbedBuilder {
  const effectiveIntervalMs = pollingInfo.effectiveIntervalMs ?? (pollingInfo.effectiveIntervalMinutes ?? integration.pollIntervalMinutes) * 60_000;
  const archiveFields = formatArchiveFields(integration);

  return baseEmbed(integration, "Monitor status")
    .addFields(
      { name: "Value", value: formatValue(integration.lastValue), inline: true },
      { name: "Status", value: archiveFields.length ? `${integration.status} (archived)` : integration.status, inline: true },
      { name: "Base interval", value: `${integration.pollIntervalMinutes} minute(s)`, inline: true },
      { name: "Current interval", value: formatIntervalMs(effectiveIntervalMs), inline: true },
      ...(pollingInfo.reason ? [{ name: "Polling mode", value: pollingInfo.reason, inline: false }] : []),
      ...formatTurboFields(integration),
      ...archiveFields,
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
              `Interval: ${formatIntervalSummaryFromMinutes(row.currentIntervalMinutes)} current / ${row.baseIntervalMinutes} min base`
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

export function buildUpdateLogsEmbed(integration: Integration, logs: IntegrationUpdateLog[]): EmbedBuilder {
  return baseEmbed(integration, "Update timing log")
    .addFields(
      { name: "Recent updates", value: formatUpdateLogEntries(logs), inline: false },
      { name: "SGT hour pattern", value: formatUpdateHourPattern(logs, "Asia/Singapore"), inline: true },
      { name: "ET hour pattern", value: formatUpdateHourPattern(logs, "America/New_York"), inline: true },
      {
        name: "Note",
        value: "This log starts from when update logging was deployed; older alerts are not backfilled.",
        inline: false
      },
      { name: "Links", value: formatLinks(integration), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildCheckEmbed(result: CheckResult): EmbedBuilder {
  const title = result.marketRollover ? "Market rollover" : result.changed ? "Value changed" : "Current value";
  const embed = baseEmbed(result.integration, title)
    .addFields(
      { name: "Current", value: formatValue(result.currentValue), inline: true },
      { name: "Current retrieved at", value: formatSingaporeDateTime(result.integration.lastCheckedAt), inline: false },
      { name: "Last stored", value: formatValue(result.previousValue), inline: true },
      { name: "Last retrieved at", value: formatSingaporeDateTime(result.previousCheckedAt), inline: false },
      ...(result.marketRollover
        ? [
            { name: "Previous Polymarket", value: result.marketRollover.previousPolymarketUrl ?? "not set", inline: false },
            { name: "Active Polymarket", value: result.marketRollover.currentPolymarketUrl ?? "not set", inline: false },
            { name: "Rollover handling", value: "Current source value was stored as the new baseline.", inline: false }
          ]
        : []),
      { name: "Links", value: formatLinks(result.integration), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });

  return embed;
}

export function buildCheckAllChannelEmbed(result: CheckAllChannelResult): EmbedBuilder {
  return baseEmbed(result.integration, result.ok ? "Smoke check passed" : "Smoke check failed")
    .setColor(result.ok ? successColor : errorColor)
    .addFields(
      {
        name: "Result",
        value: result.ok ? "Source fetch and parser returned successfully." : truncateEmbedValue(result.error ?? "unknown error"),
        inline: false
      },
      ...(result.ok ? [{ name: "Fetched value", value: formatValue(result.currentValue ?? null), inline: false }] : []),
      { name: "Queue progress", value: `${result.completed}/${result.total}`, inline: true },
      { name: "Duration", value: formatDurationMs(result.durationMs), inline: true },
      { name: "Mode", value: "Fetch-only smoke check; stored values were not updated and alert roles were not mentioned.", inline: false },
      { name: "Links", value: formatLinks(result.integration), inline: false }
    )
    .setFooter({ text: `Checked at ${nowSingaporeDateTime()}` });
}

export function buildEventCheckEmbed(result: EventCheckResult): EmbedBuilder {
  if (result.checkFields?.length) {
    return baseEmbed(result.integration, result.checkTitle ?? "Check complete")
      .addFields(
        ...result.checkFields.map((field) => ({
          name: field.name,
          value: truncateEmbedValue(field.value),
          inline: field.inline ?? false
        })),
        { name: "Checked at", value: formatSingaporeDateTime(result.integration.lastCheckedAt), inline: false }
      )
      .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
  }

  return baseEmbed(result.integration, "Event check complete")
    .addFields(
      { name: "New posts", value: String(result.newPosts.length), inline: true },
      { name: "Latest seen post", value: result.latestSeenId ?? "none", inline: true },
      { name: "Latest source", value: result.latestSeenUrl ?? "none", inline: false },
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

export function buildStrikeSearchEmbed(integration: Integration, result: StrikeSearchResult): EmbedBuilder {
  return baseEmbed(integration, "Strike search")
    .addFields(
      { name: "Term", value: result.term, inline: true },
      { name: "Matches", value: String(result.totalResults), inline: true },
      {
        name: "Timeframe",
        value: `${formatEasternDateTime(new Date(result.startAt))} ET to ${formatEasternDateTime(new Date(result.endAt))} ET`,
        inline: false
      },
      { name: "Results", value: formatStrikeSearchHits(result), inline: false },
      { name: "Search", value: result.searchUrl, inline: false },
      { name: "Links", value: formatLinks(integration), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildTagSearchEmbed(integration: Integration, result: TagSearchResult): EmbedBuilder {
  return baseEmbed(integration, "Tag search")
    .addFields(
      { name: "Query", value: result.query, inline: true },
      { name: "Matches", value: String(result.totalResults), inline: true },
      { name: "Results", value: formatTagSearchResults(result), inline: false },
      { name: "Source", value: result.sourceUrl, inline: false },
      { name: "Fetched at", value: formatSingaporeDateTime(result.fetchedAt), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildTagFiltersEmbed(integration: Integration, result: TagFilterUpdateResult): EmbedBuilder {
  return baseEmbed(integration, "Proposal tag filters")
    .addFields(
      { name: "Action", value: result.action, inline: true },
      { name: "Changed", value: result.changed ? "yes" : "no", inline: true },
      { name: "Result", value: result.message, inline: false },
      ...(result.matchedTag ? [{ name: "Matched tag", value: formatTagFilterEntry(result.matchedTag), inline: false }] : []),
      { name: "Current filters", value: formatTagFilterEntries(result.tagFilters), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildTagBlocklistEmbed(integration: Integration, result: TagBlocklistUpdateResult): EmbedBuilder {
  return baseEmbed(integration, "Proposal tag exclusions")
    .addFields(
      { name: "Action", value: result.action, inline: true },
      { name: "Changed", value: result.changed ? "yes" : "no", inline: true },
      { name: "Subscription tag", value: formatTagFilterEntry(result.subscriptionTag), inline: false },
      { name: "Result", value: result.message, inline: false },
      ...(result.blockedTag ? [{ name: "Blocked tag", value: formatTagFilterEntry(result.blockedTag), inline: false }] : []),
      { name: "Current exclusions", value: formatTagFilterEntries(result.blockedTags), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildResolvableWatchlistEmbed(integration: Integration, result: ResolvableWatchlistUpdateResult): EmbedBuilder {
  return baseEmbed(integration, "Resolvable watchlist")
    .addFields(
      { name: "Action", value: result.action, inline: true },
      { name: "Changed", value: result.changed ? "yes" : "no", inline: true },
      { name: "Result", value: truncateEmbedValue(result.message), inline: false },
      ...(result.matchedWatches?.length
        ? [{ name: "Matched market(s)", value: formatResolvableWatchEntries(result.matchedWatches), inline: false }]
        : []),
      { name: "Current watchlist", value: formatResolvableWatchEntries(result.watches), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildAddressLabelsEmbed(integration: Integration, result: AddressLabelUpdateResult): EmbedBuilder {
  const summaryFields = result.importSummary
    ? [
        { name: "Import summary", value: formatAddressImportSummary(result.importSummary), inline: false },
        ...(result.importSummary.invalidRows.length
          ? [{ name: "Invalid rows", value: formatAddressImportIssues(result.importSummary.invalidRows), inline: false }]
          : []),
        ...(result.importSummary.duplicateRows.length
          ? [{ name: "Duplicate rows", value: formatAddressImportIssues(result.importSummary.duplicateRows), inline: false }]
          : []),
        {
          name: result.importSummary.dryRun ? "Next step" : "Stored labels",
          value: result.importSummary.dryRun
            ? "Rerun with `dry-run:false` to apply these changes."
            : `${result.addressLabels.length} address label(s) configured.`,
          inline: false
        }
      ]
    : [
        ...(result.matchedLabel ? [{ name: "Address", value: formatAddressLabelEntry(result.matchedLabel), inline: false }] : []),
        { name: "Current labels", value: formatAddressLabelEntries(result.addressLabels), inline: false }
      ];

  return baseEmbed(integration, "Address labels")
    .addFields(
      { name: "Action", value: result.action, inline: true },
      { name: "Changed", value: result.changed ? "yes" : "no", inline: true },
      { name: "Result", value: result.message, inline: false },
      ...summaryFields
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildThresholdEmbed(integration: Integration, result: ThresholdUpdateResult): EmbedBuilder {
  return baseEmbed(integration, "Alert threshold")
    .addFields(
      { name: "Changed", value: result.changed ? "yes" : "no", inline: true },
      { name: result.thresholdLabel, value: result.thresholdValue, inline: true },
      { name: "Result", value: result.message, inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildArbitrageSetupEmbed(integration: Integration, result: ArbitrageSetupResult): EmbedBuilder {
  return baseEmbed(integration, "Arbitrage setup")
    .addFields(
      { name: "Result", value: truncateEmbedValue(result.message), inline: false },
      ...(result.selectedOutcome ? [{ name: "Selected outcome", value: result.selectedOutcome, inline: true }] : []),
      { name: "Shared outcomes", value: formatArbitrageOutcomes(result.outcomes), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function buildArbitrageWatchEmbed(integration: Integration, result: ArbitrageWatchResult): EmbedBuilder {
  const watch = result.watch;
  return baseEmbed(integration, "Arbitrage watch")
    .addFields(
      { name: "Result", value: truncateEmbedValue(result.message), inline: false },
      ...(watch
        ? [
            { name: "Outcome", value: watch.outcome, inline: true },
            { name: "Side", value: watch.side, inline: true },
            { name: "Amount cap", value: `$${formatNumber(watch.maxStakeUsd, 2)}`, inline: true },
            { name: "Minimum after-fee edge", value: `${formatNumber(watch.minNetEdgeBps / 100, 2)}%`, inline: true },
            { name: "URLs", value: truncateEmbedValue(watch.urls.join("\n")), inline: false }
          ]
        : [])
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

export function buildTurboUpdatedEmbed(integration: Integration): EmbedBuilder {
  const turbo = getTurboPollingSettings(integration.settingsJson);
  const embed = baseEmbed(integration, "Turbo polling updated")
    .addFields(
      { name: "Base interval", value: `${integration.pollIntervalMinutes} minute(s)`, inline: true },
      { name: "Links", value: formatLinks(integration), inline: false }
    )
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });

  if (!turbo) {
    return embed.addFields({ name: "Turbo", value: "off", inline: true });
  }

  return embed.addFields(
    { name: "Turbo", value: "on", inline: true },
    { name: "Turbo interval", value: `${turbo.intervalSeconds} second(s)`, inline: true },
    { name: "Turbo ends", value: formatSingaporeDateTime(turbo.until), inline: false }
  );
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

export function buildBotChannelClearEmbed(channelName: string, deletedCount: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(successColor)
    .setTitle("Channel cleared")
    .addFields(
      { name: "Channel", value: `#${channelName}`, inline: true },
      { name: "Deleted messages", value: String(deletedCount), inline: true }
    )
    .setFooter({ text: `Cleared at ${nowSingaporeDateTime()}` });
}

export function buildClearErrorsEmbed(summary: ErrorCleanupSummary): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(summary.failedDeletes || summary.skippedChannels ? warningColor : successColor)
    .setTitle("Check-failed message cleanup")
    .addFields(
      { name: "Deleted old errors", value: String(summary.deletedMessages), inline: true },
      { name: "Kept latest errors", value: String(summary.keptMessages), inline: true },
      { name: "Scanned channels", value: String(summary.scannedChannels), inline: true },
      { name: "Skipped channels", value: String(summary.skippedChannels), inline: true },
      { name: "Failed deletes", value: String(summary.failedDeletes), inline: true },
      { name: "Mode", value: summary.keepLatest ? "Kept the newest Check failed message per channel." : "Deleted all Check failed messages.", inline: false }
    )
    .setFooter({ text: `Cleaned at ${nowSingaporeDateTime()}` });
}

export function buildAlertEmbed(result: CheckResult): EmbedBuilder {
  return baseEmbed(result.integration, "Value changed")
    .setColor(successColor)
    .addFields(
      { name: "Previous", value: formatAlertValue(result.previousValue), inline: true },
      { name: "Current", value: formatAlertValue(result.currentValue), inline: true },
      { name: "Retrieved at", value: formatSingaporeDateTime(result.integration.lastCheckedAt), inline: false },
      { name: "Links", value: formatLinks(result.integration), inline: false }
    )
    .setFooter({ text: `Alert sent at ${nowEasternDateTime()}` });
}

export function buildEventPostEmbed(integration: Integration, post: EventMonitorPost): EmbedBuilder[] {
  const alertSentAt = new Date();
  const hasStrike = post.matchedTerms.length > 0;
  const hasImages = post.imageUrls.length > 0;
  const imageAttachmentNames = (post.imageAttachments ?? [])
    .filter((attachment) => attachment.displayAsImage !== false)
    .map((attachment) => attachment.name)
    .filter(Boolean);
  const title =
    post.alertTitle ??
    (hasStrike ? "TEXT STRIKE DETECTED" : hasImages ? "New post - review attached images manually" : "New post");
  const sourceLabel = post.sourceLabel ?? "Truth Social";
  const eventFields = [
    ...(hasStrike ? [{ name: "STRIKE HIT", value: formatMatchedStrikeTerms(post.matchedTerms), inline: false }] : []),
    ...formatPrioritySummaryFields(integration, post, alertSentAt),
    ...(post.summaryFields ?? []).map((field) => ({
      name: field.name,
      value: truncateEmbedValue(convertIsoTimestampsToEastern(field.value)),
      inline: field.inline ?? false
    })),
    ...(post.hideDefaultEventFields
      ? []
      : [
          { name: "Event type", value: post.type, inline: true },
          { name: "Posted at", value: formatSharedEasternDateTime(post.postedAt), inline: false },
          ...formatNotificationLatencyFields(post, alertSentAt),
          { name: sourceLabel, value: post.url, inline: false }
        ]),
    ...(post.fields ?? []).map((field) => ({
      name: field.name,
      value: truncateEmbedValue(convertIsoTimestampsToEastern(field.value)),
      inline: field.inline ?? false
    })),
    ...(post.matchedTerms.length ? [{ name: "Matched text terms", value: post.matchedTerms.join(", "), inline: false }] : []),
    ...(hasImages
      ? [
          {
            name: "Image review",
            value: hasImages && !hasStrike ? "No text strike detected - review attached images manually." : "Images attached.",
            inline: false
          }
        ]
      : []),
    ...(post.strikeTerms.length ? [{ name: "Strike list", value: formatStrikeTerms(post.strikeTerms), inline: false }] : []),
    ...(post.imageText ? [{ name: "Image text", value: formatAlertValue(post.imageText), inline: false }] : []),
    ...(post.hideTextField
      ? []
      : [{ name: post.textFieldName ?? "Post text", value: formatAlertValue(post.text || "(no text)"), inline: false }]),
    ...(post.hideLinksField
      ? []
      : [
          {
            name: "Links",
            value: formatEventLinks(integration, post),
            inline: false
          }
        ])
  ];
  const embeds = [
    baseEmbed(integration, title)
      .setColor(hasStrike ? errorColor : successColor)
      .addFields(eventFields)
      .setFooter({ text: `Alert sent at ${formatSharedEasternDateTime(alertSentAt)}` })
  ];

  if (imageAttachmentNames.length) {
    for (const attachmentName of imageAttachmentNames.slice(0, 3)) {
      embeds.push(
        new EmbedBuilder()
          .setColor(hasStrike ? errorColor : successColor)
          .setTitle("Highlighted image")
          .setImage(`attachment://${attachmentName}`)
      );
    }
  } else {
    for (const imageUrl of post.imageUrls.slice(0, 3)) {
      embeds.push(new EmbedBuilder().setColor(hasStrike ? errorColor : successColor).setTitle("Attached image").setImage(imageUrl));
    }
  }

  return embeds;
}

export function buildEventPostMessagePayload(integration: Integration, post: EventMonitorPost) {
  const content = formatEventPostMessageContent(integration, post);
  const mentionsAlertRole = Boolean(content && integration.alertRoleId && content.includes(`<@&${integration.alertRoleId}>`));
  return {
    content,
    embeds: buildEventPostEmbed(integration, post),
    files: (post.imageAttachments ?? []).map((attachment) => ({
      attachment: attachment.data,
      name: attachment.name,
      description: attachment.description
    })),
    components: buildEventPostComponents(integration, post),
    allowedMentions: mentionsAlertRole ? { roles: [integration.alertRoleId!] } : { parse: [] }
  };
}

export function buildEventPostDetailsEmbed(integration: Integration, post: EventMonitorPost): EmbedBuilder {
  const fields = [
    ...(post.hiddenFields ?? []).map((field) => ({
      name: field.name,
      value: truncateEmbedValue(field.value),
      inline: field.inline ?? false
    })),
    {
      name: "Links",
      value: formatEventLinks(integration, post),
      inline: false
    }
  ];

  return baseEmbed(integration, `${post.type} details`)
    .addFields(fields)
    .setFooter({ text: `Returned at ${nowSingaporeDateTime()}` });
}

export function parseEventDetailsCustomId(customId: string): { integrationId: number; eventId: string } | null {
  if (!customId.startsWith(eventDetailsCustomIdPrefix)) {
    return null;
  }

  const payload = customId.slice(eventDetailsCustomIdPrefix.length);
  const separatorIndex = payload.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === payload.length - 1) {
    return null;
  }

  const integrationId = Number(payload.slice(0, separatorIndex));
  const eventId = payload.slice(separatorIndex + 1);
  return Number.isSafeInteger(integrationId) && integrationId > 0 && eventId ? { integrationId, eventId } : null;
}

export function parseEventRefreshCustomId(customId: string): { integrationId: number; eventId: string } | null {
  if (!customId.startsWith(eventRefreshCustomIdPrefix)) {
    return null;
  }

  const payload = customId.slice(eventRefreshCustomIdPrefix.length);
  const separatorIndex = payload.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === payload.length - 1) {
    return null;
  }

  const integrationId = Number(payload.slice(0, separatorIndex));
  const eventId = payload.slice(separatorIndex + 1);
  return Number.isSafeInteger(integrationId) && integrationId > 0 && eventId ? { integrationId, eventId } : null;
}

export function parseAddressLabelButtonCustomId(
  customId: string
): { integrationId: number; role: AddressLabelButtonRole; address: string } | null {
  return parseAddressLabelCustomId(customId, addressLabelButtonCustomIdPrefix);
}

export function parseAddressLabelModalCustomId(
  customId: string
): { integrationId: number; role: AddressLabelButtonRole; address: string } | null {
  return parseAddressLabelCustomId(customId, addressLabelModalCustomIdPrefix);
}

export function buildAddressLabelModalCustomId(integrationId: number, role: AddressLabelButtonRole, address: string): string {
  return `${addressLabelModalCustomIdPrefix}${integrationId}:${role}:${address}`;
}

function formatPrioritySummaryFields(
  integration: Integration,
  post: EventMonitorPost,
  alertSentAt: Date
): Array<{ name: string; value: string; inline: boolean }> {
  const summary = post.prioritySummary;
  if (!summary) {
    return [];
  }

  const addressLabels = getAddressLabelsFromSettingsJson(integration.settingsJson);
  const proposerShares = formatActorShares(summary.proposerAligned, summary.proposerHedge);
  const disputerShares = formatActorShares(summary.disputerAligned, summary.disputerHedge);
  const isProposalSummary = post.type === "Polymarket UMA proposal";
  const postedAtLabel = isProposalSummary ? "Proposed at" : "Posted at";
  const expirationLabel = isProposalSummary ? "Dispute Window Ends" : "Proposal expiration";

  return [
    ...(summary.question
      ? [
          {
            name: "Question",
            value: formatPriorityValue(summary.question, summary.questionUrl, summary.betmoarUrl),
            inline: false
          }
        ]
      : []),
    ...(summary.proposedOutcome ? [{ name: "Proposed outcome", value: `**${summary.proposedOutcome}**`, inline: false }] : []),
    ...(summary.proposedSideLiquidity
      ? [{ name: "PENNY PICK LIQUIDITY", value: summary.proposedSideLiquidity, inline: false }]
      : []),
    ...(summary.proposedSideLiquidityCheck
      ? [{ name: "PENNY PICK CHECK", value: `**${summary.proposedSideLiquidityCheck}**`, inline: false }]
      : []),
    { name: postedAtLabel, value: formatSharedEasternDateTime(post.postedAt), inline: true },
    ...(summary.proposalExpirationAt
      ? [{ name: expirationLabel, value: formatSharedEasternDateTime(summary.proposalExpirationAt), inline: true }]
      : []),
    ...formatNotificationLatencyFields(post, alertSentAt),
    ...(summary.marketTags?.length
      ? [{ name: "Market tags", value: formatMarketTags(summary.marketTags, summary.matchedTags ?? []), inline: false }]
      : []),
    ...(summary.proposer
      ? [{ name: "Proposer", value: formatAddressWithLabel(summary.proposer, addressLabels, summary.proposerProfile), inline: false }]
      : []),
    ...(proposerShares ? [{ name: "Proposer shares", value: proposerShares, inline: false }] : []),
    ...(summary.disputer
      ? [{ name: "Disputer", value: formatAddressWithLabel(summary.disputer, addressLabels, summary.disputerProfile), inline: false }]
      : []),
    ...(disputerShares ? [{ name: "Disputer shares", value: disputerShares, inline: false }] : []),
    ...(summary.clarification ? [{ name: "Clarification", value: summary.clarification, inline: false }] : []),
    ...(summary.creator ? [{ name: "Creator", value: summary.creator, inline: false }] : [])
  ].map((field) => ({ ...field, value: truncateEmbedValue(field.value) }));
}

function formatNotificationLatencyFields(
  post: EventMonitorPost,
  alertSentAt: Date
): Array<{ name: string; value: string; inline: boolean }> {
  if (!shouldShowChainNotificationLatency(post)) {
    return [];
  }

  return [
    {
      name: "Notification latency",
      value: formatNotificationLatency(post.postedAt, alertSentAt),
      inline: true
    }
  ];
}

function shouldShowChainNotificationLatency(post: EventMonitorPost): boolean {
  return [
    "Polymarket clarification",
    "Polymarket UMA proposal",
    "Polymarket UMA dispute",
    "UMA vote commit",
    "UMA vote recommit",
    "UMA vote commits",
    "UMA vote commits/recommits",
    "UMA vote reveal",
    "UMA vote reveals"
  ].includes(post.type);
}

function formatNotificationLatency(blockchainTimestamp: Date, alertSentAt: Date): string {
  const seconds = Math.max(0, Math.round((alertSentAt.getTime() - blockchainTimestamp.getTime()) / 1_000));
  return `${seconds.toLocaleString("en-US")} ${seconds === 1 ? "second" : "seconds"} after block timestamp`;
}

export function buildSnapshotCapturedEmbed(result: SnapshotResult): EmbedBuilder {
  return baseEmbed(result.integration, "12:00 PM ET daily snapshot")
    .setColor(successColor)
    .addFields(
      { name: "Snapshot date", value: result.snapshotDate, inline: true },
      { name: "Retrieved at", value: formatSingaporeDateTime(result.integration.snapshotCheckedAt), inline: false },
      { name: "Snapshot value", value: formatAlertValue(result.snapshotValue), inline: false },
      { name: "Stored separately", value: "Regular interval checks cannot overwrite this daily snapshot.", inline: false },
      { name: "Links", value: formatLinks(result.integration), inline: false }
    )
    .setFooter({ text: `Snapshot alert sent at ${nowEasternDateTime()}` });
}

export function buildMarketEndReminderEmbed(integration: Integration, reminder: MarketEndReminder): EmbedBuilder {
  return baseEmbed(integration, "Polymarket end reminder")
    .setColor(warningColor)
    .addFields(
      { name: "Reminder", value: reminder.label, inline: false },
      { name: "Market ends", value: formatSharedEasternDateTime(reminder.endAt), inline: false },
      { name: "Action", value: "Update this integration's Polymarket URL if you are moving to the next market.", inline: false },
      { name: "Command", value: "Use `/monitor polymarket url:<new-polymarket-url>` in this monitor channel.", inline: false },
      { name: "Links", value: formatLinks(integration), inline: false }
    )
    .setFooter({ text: `Reminder sent at ${nowEasternDateTime()}` });
}

export function buildMarketRolloverEmbed(integration: Integration, rollover: MarketRollover): EmbedBuilder {
  return baseEmbed(integration, "Market rollover")
    .setColor(warningColor)
    .addFields(
      { name: "Previous Polymarket", value: rollover.previousPolymarketUrl ?? "not set", inline: false },
      { name: "Active Polymarket", value: rollover.currentPolymarketUrl ?? "not set", inline: false },
      {
        name: "Source value",
        value: "Stored as the new baseline for this market window; no value-change alert was sent for the rollover itself.",
        inline: false
      },
      { name: "Resolution", value: integration.sourceUrl, inline: false }
    )
    .setFooter({ text: `Rollover detected at ${nowEasternDateTime()}` });
}

export function buildMarketEndMissingEmbed(integration: Integration): EmbedBuilder {
  return baseEmbed(integration, "Polymarket end date missing")
    .setColor(warningColor)
    .addFields(
      { name: "Problem", value: "Polymarket Gamma API did not return an endDate for this market URL.", inline: false },
      { name: "Action", value: "Check the Polymarket URL, or manually set the ET end time with `/monitor enddate`.", inline: false },
      { name: "Example", value: "`/monitor enddate datetime:2026-05-10 23:59`", inline: false },
      { name: "Links", value: formatLinks(integration), inline: false }
    )
    .setFooter({ text: `Warning sent at ${nowEasternDateTime()}` });
}

export function buildErrorEmbed(integration: Integration, message: string): EmbedBuilder {
  return baseEmbed(integration, "Check failed")
    .setColor(errorColor)
    .addFields(
      { name: "Error", value: truncateEmbedValue(message), inline: false },
      ...formatOptionalPolymarketField(integration)
    )
    .setFooter({ text: `Failed at ${nowEasternDateTime()}` });
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
  description?: string;
};

export function buildGroupedRoleSelectorEmbed(
  entries: GroupedRoleSelectorEntry[],
  groupIndex: number,
  groupCount: number,
  baseTitle = "Market Alert Roles"
): EmbedBuilder {
  const title = groupCount > 1 ? `${baseTitle} ${groupIndex + 1}/${groupCount}` : baseTitle;
  return new EmbedBuilder()
    .setColor(successColor)
    .setTitle(title)
    .setDescription("React to receive alerts. Remove your reaction to opt out.")
    .addFields(
      entries.map((entry) => ({
        name: `${entry.emoji} ${entry.displayName}`,
        value: entry.description ?? `Role: <@&${entry.roleId}>\nCommand: \`/${entry.commandName}\``,
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

function buildEventPostComponents(integration: Integration, post: EventMonitorPost): ActionRowBuilder<ButtonBuilder>[] {
  return [
    buildEventSourceLinkRow(post.url, post.buttonLabel, [
      buildEventDetailsButton(integration, post),
      ...buildEventAddressLabelButtons(integration, post)
    ])
  ];
}

function buildEventSourceLinkRow(url: string, labelOverride?: string, extraButtons: Array<ButtonBuilder | null> = []): ActionRowBuilder<ButtonBuilder> {
  const label =
    labelOverride ??
    (url.includes("truthsocial.com") ? "Open Truth" : url.includes("polygonscan.com") ? "Open transaction" : "Open source");
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url)
  );
  for (const button of extraButtons) {
    if (button) {
      row.addComponents(button);
    }
  }

  return row;
}

function buildEventDetailsButton(integration: Integration, post: EventMonitorPost): ButtonBuilder | null {
  const isRefreshable = isRefreshableUmaAddressPost(integration, post);
  if (!post.hiddenFields?.length && !isRefreshable) {
    return null;
  }

  const customId = `${isRefreshable ? eventRefreshCustomIdPrefix : eventDetailsCustomIdPrefix}${integration.id}:${post.id}`;
  if (customId.length > 100) {
    return null;
  }

  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(isRefreshable ? "Refresh data" : "Show more")
    .setStyle(ButtonStyle.Secondary);
}

function isRefreshableUmaAddressPost(integration: Integration, post: EventMonitorPost): boolean {
  if (integration.adapterId !== "polymarket-proposals" && integration.adapterId !== "polymarket-disputes") {
    return false;
  }

  return Boolean(post.prioritySummary?.proposer || post.prioritySummary?.disputer);
}

function buildEventAddressLabelButtons(integration: Integration, post: EventMonitorPost): ButtonBuilder[] {
  const summary = post.prioritySummary;
  if (!summary) {
    return [];
  }

  const buttons: ButtonBuilder[] = [];
  const proposerButton = buildAddressLabelButton(integration, "proposer", summary.proposer);
  const disputerButton = buildAddressLabelButton(integration, "disputer", summary.disputer);
  if (proposerButton) {
    buttons.push(proposerButton);
  }
  if (disputerButton) {
    buttons.push(disputerButton);
  }

  return buttons;
}

function buildAddressLabelButton(integration: Integration, role: AddressLabelButtonRole, address?: string): ButtonBuilder | null {
  if (!addressPattern.test(address ?? "")) {
    return null;
  }

  const customId = `${addressLabelButtonCustomIdPrefix}${integration.id}:${role}:${address!.toLowerCase()}`;
  if (customId.length > 100) {
    return null;
  }

  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(role === "proposer" ? "Label proposer" : "Label disputer")
    .setStyle(ButtonStyle.Secondary);
}

function parseAddressLabelCustomId(
  customId: string,
  prefix: string
): { integrationId: number; role: AddressLabelButtonRole; address: string } | null {
  if (!customId.startsWith(prefix)) {
    return null;
  }

  const [integrationIdText, role, address] = customId.slice(prefix.length).split(":");
  const integrationId = Number(integrationIdText);
  if (
    !Number.isSafeInteger(integrationId) ||
    integrationId <= 0 ||
    (role !== "proposer" && role !== "disputer") ||
    !addressPattern.test(address)
  ) {
    return null;
  }

  return { integrationId, role, address: address.toLowerCase() };
}

function formatEventPostMessageContent(integration: Integration, post: EventMonitorPost): string | undefined {
  const roleMention = integration.alertRoleId ? `<@&${integration.alertRoleId}>` : undefined;
  if (post.mentionAlertRole === false) {
    return undefined;
  }

  if (!post.matchedTerms.length) {
    const title = post.alertTitle ?? "New post";
    if (integration.adapterId === "trump-truth" || integration.adapterId === "elon-x-strikes") {
      return `**${title}**`;
    }

    return roleMention ? `${roleMention}\n**${title}**` : `**${title}**`;
  }

  const strikeLine = `TEXT STRIKE DETECTED: ${post.matchedTerms.join(", ")}`;
  return roleMention ? `${roleMention}\n**${strikeLine}**` : `**${strikeLine}**`;
}

function formatMatchedStrikeTerms(matchedTerms: string[]): string {
  return `**${matchedTerms.join(", ")}**\n\`\`\`text\n${matchedTerms.join("\n")}\n\`\`\``;
}

function formatStrikeSearchHits(result: StrikeSearchResult): string {
  if (result.hits.length === 0) {
    return "No matching posts found in the active timeframe.";
  }

  const shownHits = result.hits.slice(0, 10);
  const lines = shownHits.map((hit, index) => {
    const snippet = hit.snippet ? ` - ${hit.snippet}` : "";
    return `${index + 1}. [${hit.postedAt}](${hit.url})${snippet}`;
  });
  const remaining = result.totalResults - shownHits.length;
  if (remaining > 0) {
    lines.push(`...and ${remaining} more result(s). Open the search link for the full list.`);
  }

  return truncateEmbedValue(lines.join("\n"));
}

function formatTagSearchResults(result: TagSearchResult): string {
  if (result.shownResults.length === 0) {
    return "No matching tags found.";
  }

  const lines = result.shownResults.map((tag, index) => `${index + 1}. ${formatTagFilterEntry(tag)}`);
  const remaining = result.totalResults - result.shownResults.length;
  if (remaining > 0) {
    lines.push(`...and ${remaining} more result(s). Refine the query to narrow the list.`);
  }

  return truncateEmbedValue(lines.join("\n"));
}

function formatTagFilterEntries(tags: TagFilterEntry[]): string {
  return tags.length ? truncateEmbedValue(tags.map(formatTagFilterEntry).join("\n")) : "none configured";
}

function formatTagFilterEntry(tag: TagFilterEntry): string {
  const id = tag.id ? `${tag.id} | ` : "";
  const channelName = "channelName" in tag && typeof tag.channelName === "string" ? ` | #${tag.channelName}` : "";
  const maybeTagWithExclusions = tag as TagFilterEntry & { excludedTags?: TagFilterEntry[] };
  const excludedTags =
    Array.isArray(maybeTagWithExclusions.excludedTags) && maybeTagWithExclusions.excludedTags.length
      ? ` | excludes ${maybeTagWithExclusions.excludedTags.map((blockedTag) => blockedTag.label ?? blockedTag.slug).join(", ")}`
      : "";
  return `${id}${tag.label} | ${tag.slug}${channelName}${excludedTags}`;
}

function formatResolvableWatchEntries(watches: ResolvableWatchlistEntry[]): string {
  if (watches.length === 0) {
    return "none configured";
  }

  return truncateEmbedValue(
    watches
      .slice(0, 10)
      .map((watch, index) => {
        const title = formatMarkdownLink(watch.question, watch.url);
        const status = watch.lastStatus ? `Status: ${watch.lastStatus}` : "Status: pending";
        const checked = watch.lastCheckedAt ? `Last checked: ${formatSingaporeDateTime(watch.lastCheckedAt)}` : "Last checked: not yet";
        const error = watch.lastError ? `\nLast error: ${truncateEmbedValue(watch.lastError, 180)}` : "";
        return `${index + 1}. ${title}\nQuestion ID: ${watch.questionId}\n${status}\n${checked}${error}`;
      })
      .join("\n\n"),
    1000
  );
}

function formatAddressLabelEntries(labels: Array<{ address: string; label: string }>): string {
  return labels.length ? truncateEmbedValue(labels.map(formatAddressLabelEntry).join("\n")) : "none configured";
}

function formatAddressLabelEntry(label: { address: string; label: string }): string {
  return `${label.label} | ${label.address}`;
}

function formatAddressImportSummary(summary: NonNullable<AddressLabelUpdateResult["importSummary"]>): string {
  return [
    `Rows read: ${summary.totalRows}`,
    `Valid rows: ${summary.validRows}`,
    `Unique labels: ${summary.uniqueLabels}`,
    `Added: ${summary.added}`,
    `Updated: ${summary.updated}`,
    `Unchanged: ${summary.unchanged}`,
    `Invalid rows: ${summary.invalidRows.length}`,
    `Duplicate rows: ${summary.duplicateRows.length}`
  ].join("\n");
}

function formatAddressImportIssues(issues: AddressLabelImportIssue[]): string {
  return truncateEmbedValue(
    issues
      .slice(0, 10)
      .map((issue) => {
        const duplicate = issue.previousLineNumber ? `; previous line ${issue.previousLineNumber}` : "";
        return `Line ${issue.lineNumber}: ${issue.reason}${duplicate} - ${issue.value}`;
      })
      .join("\n") + (issues.length > 10 ? `\n...and ${issues.length - 10} more` : "")
  );
}

function formatUpdateLogEntries(logs: IntegrationUpdateLog[]): string {
  if (logs.length === 0) {
    return "No updates logged yet.";
  }

  return truncateEmbedValue(
    logs
      .slice(0, 10)
      .map((log, index) => {
        const detected = `${formatSingaporeDateTime(log.detectedAt)} / ${formatEasternDateTime(new Date(log.detectedAt))} ET`;
        const source =
          log.sourceAt && log.sourceAt !== log.detectedAt
            ? `\nSource time: ${formatSingaporeDateTime(log.sourceAt)} / ${formatEasternDateTime(new Date(log.sourceAt))} ET`
            : "";
        const summary = log.summary ? `\n${truncateEmbedValue(log.summary, 180)}` : "";
        return `${index + 1}. ${detected}\n${log.title} (${formatUpdateLogKind(log.kind)})${source}${summary}`;
      })
      .join("\n\n"),
    1000
  );
}

function formatUpdateHourPattern(logs: IntegrationUpdateLog[], timeZone: string): string {
  if (logs.length === 0) {
    return "No data yet.";
  }

  const counts = new Map<string, number>();
  for (const log of logs) {
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23"
    }).format(new Date(log.detectedAt));
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([hour, count]) => `${hour}:00 - ${count}`)
    .join("\n");
}

function formatUpdateLogKind(kind: string): string {
  return kind.replace(/_/g, " ");
}

function formatPriorityValue(label: string, url?: string, betmoarUrl?: string): string {
  const question = url ? `**${formatMarkdownLink(label, url)}**` : `**${label}**`;
  return betmoarUrl ? `${question} · ${formatMarkdownLink("Betmoar", betmoarUrl)}` : question;
}

function formatMarkdownLink(label: string, url: string): string {
  return `[${label.replace(/\\/g, "\\\\").replace(/\]/g, "\\]")}](${url})`;
}

function formatMarketTags(marketTags: string[], matchedTags: string[]): string {
  const matched = new Set(matchedTags.map(normalizeTagText));
  return marketTags.map((tag) => (matched.has(normalizeTagText(tag)) ? `**${tag}**` : tag)).join(", ");
}

function formatActorShares(aligned?: AddressPositionStatus, hedge?: AddressPositionStatus): string | null {
  const lines = [
    aligned ? formatPositionStatus(aligned, "ALIGNED", "aligned shares") : "",
    hedge ? formatPositionStatus(hedge, "HEDGED", "hedge shares") : ""
  ].filter(Boolean);

  return lines.length ? `>>> ${lines.join("\n")}` : null;
}

function formatPositionStatus(status: AddressPositionStatus, label: string, missingLabel: string): string {
  if (status.error) {
    return `**${label} check unavailable:** ${status.error}`;
  }
  if (!status.hasPosition) {
    return `**${label}: no ${status.side} ${missingLabel} detected**`;
  }

  const lines = [
    `**${label}: HOLDS ${status.side}**`,
    status.size === undefined ? "" : `Size: **\`${formatShareQuantity(status.size)}\`**`,
    status.currentValue === undefined ? "" : `Current value: **\`${formatUsdValue(status.currentValue)}\`**`,
    status.avgPrice === undefined ? "" : `Avg price: **\`${formatSharePrice(status.avgPrice)}\`**`,
    status.curPrice === undefined ? "" : `Mark price: **\`${formatSharePrice(status.curPrice)}\`**`
  ].filter(Boolean);

  return lines.join("\n");
}

function normalizeTagText(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function formatLinks(integration: Integration): string {
  return [
    `Resolution: ${integration.sourceUrl}`,
    ...(integration.polymarketUrl ? [`Polymarket: ${integration.polymarketUrl}`] : [])
  ].join("\n");
}

function formatEventLinks(integration: Integration, post: EventMonitorPost): string {
  const polymarketUrl = post.polymarketUrl ?? integration.polymarketUrl;
  return [
    `Original: ${post.url}`,
    ...(polymarketUrl ? [`Polymarket: ${polymarketUrl}`] : [])
  ].join("\n");
}

function formatOptionalPolymarketField(integration: Integration): Array<{ name: string; value: string; inline: false }> {
  return integration.polymarketUrl ? [{ name: "Polymarket", value: integration.polymarketUrl, inline: false }] : [];
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

function formatIntervalMs(intervalMs: number): string {
  if (intervalMs % 60_000 === 0) {
    return `${intervalMs / 60_000} minute(s)`;
  }

  const seconds = intervalMs / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} second(s)`;
}

function formatIntervalSummaryFromMinutes(minutes: number): string {
  if (minutes < 1) {
    const seconds = minutes * 60;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} sec`;
  }

  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(2)} min`;
}

function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatAlertValue(value: string | null): string {
  return convertIsoTimestampsToEastern(formatValue(value));
}

function convertIsoTimestampsToEastern(value: string): string {
  return value.replace(
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:?\d{2})\b/g,
    (timestamp) => formatSharedEasternDateTime(timestamp)
  );
}

function formatArbitrageOutcomes(outcomes: ArbitrageSetupResult["outcomes"]): string {
  if (!outcomes.length) {
    return "none";
  }

  return truncateEmbedValue(
    outcomes
      .map((outcome, index) => {
        const platformLabels = outcome.platformLabels.length ? ` (${outcome.platformLabels.join(" / ")})` : "";
        return `${index + 1}. ${outcome.label}${platformLabels}`;
      })
      .join("\n")
  );
}

function formatShareQuantity(value: number): string {
  return `${formatNumber(value, 4)} shares`;
}

function formatSharePrice(value: number): string {
  return `$${formatNumber(value, value < 0.01 ? 4 : 3)}`;
}

function formatUsdValue(value: number): string {
  return `$${formatNumber(value, 2)}`;
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits
  }).format(value);
}

function formatStrikeTerms(strikeTerms: string[]): string {
  return strikeTerms.length ? truncateEmbedValue(strikeTerms.join(", ")) : "none parsed yet";
}

function formatSettingsFields(integration: Integration) {
  if (!integration.settingsJson) {
    return [];
  }

  const settings = parseSettingsJson(integration.settingsJson);
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  if (typeof settings.year === "number" && typeof settings.month === "number") {
    fields.push({ name: "Period", value: `${settings.year}-${String(settings.month).padStart(2, "0")}`, inline: true });
  }
  if (Array.isArray(settings.tagFilters)) {
    const tags = settings.tagFilters
      .map((tag) => (tag && typeof tag === "object" ? (tag as Partial<TagFilterEntry>) : null))
      .filter((tag): tag is Partial<TagFilterEntry> => Boolean(tag?.label || tag?.slug))
      .map((tag) => `${tag.label ?? tag.slug} (${tag.slug ?? "no slug"})`);
    fields.push({ name: "Proposal tag filters", value: tags.length ? truncateEmbedValue(tags.join("\n")) : "none configured", inline: false });
  }
  if (typeof settings.umaRevealThresholdWei === "string") {
    fields.push({
      name: "UMA reveal threshold",
      value: `${formatTokenUnits(settings.umaRevealThresholdWei, 18)} UMA`,
      inline: true
    });
  }
  if (typeof settings.umaCommitThresholdWei === "string") {
    fields.push({
      name: "UMA commit threshold",
      value: `${formatTokenUnits(settings.umaCommitThresholdWei, 18)} UMA`,
      inline: true
    });
  }

  return fields;
}

function formatArchiveFields(integration: Integration) {
  const settings = parseSettingsJson(integration.settingsJson);
  if (typeof settings.archivedAt !== "string") {
    return [];
  }

  return [
    { name: "Archived at", value: formatSingaporeDateTime(settings.archivedAt), inline: false },
    ...(typeof settings.archiveReason === "string" && settings.archiveReason.trim()
      ? [{ name: "Archive reason", value: truncateEmbedValue(settings.archiveReason.trim(), 500), inline: false }]
      : [])
  ];
}

function formatTurboFields(integration: Integration) {
  const turbo = getTurboPollingSettings(integration.settingsJson);
  if (!turbo) {
    return [];
  }

  return [
    { name: "Turbo interval", value: `${turbo.intervalSeconds} second(s)`, inline: true },
    { name: "Turbo ends", value: formatSingaporeDateTime(turbo.until), inline: false }
  ];
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

function formatTokenUnits(value: string, decimals: number): string {
  try {
    const units = BigInt(value);
    const scale = 10n ** BigInt(decimals);
    const whole = units / scale;
    const fractional = units % scale;
    if (fractional === 0n) {
      return whole.toLocaleString("en-US");
    }

    const fraction = fractional.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${whole.toLocaleString("en-US")}.${fraction.slice(0, 4)}`;
  } catch {
    return value;
  }
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks.length ? chunks : [[]];
}
