import type { Client } from "discord.js";
import type { BotDatabase } from "./database.js";
import {
  buildAlertEmbed,
  buildErrorEmbed,
  buildEventPostMessagePayload,
  buildMarketEndMissingEmbed,
  buildMarketEndReminderEmbed,
  buildSnapshotCapturedEmbed
} from "./embeds.js";
import {
  defaultRepeatedErrorNoticeWindowMs,
  formatErrorMessage,
  formatSchedulerNetworkError,
  getErrorNoticeDecision,
  isTransientNetworkError,
  type ErrorNoticeState
} from "./errorNotices.js";
import { getAdapter } from "./integrations/registry.js";
import type { EventMonitorPost, Integration, WebsiteAdapter } from "./integrations/types.js";
import { getDueMarketEndReminders, getStoredOrFetchPolymarketEndDate, type MarketEndReminder } from "./marketEnd.js";
import { resolveIntegrationPolymarketQueue } from "./polymarketQueue.js";
import { mergeSettingsJson, parseSettingsJson } from "./settingsJson.js";

export { formatSchedulerNetworkError, getErrorNoticeDecision } from "./errorNotices.js";

export type CheckResult = {
  integration: Integration;
  previousValue: string | null;
  previousCheckedAt: string | null;
  currentValue: string;
  changed: boolean;
};

export type SnapshotResult = {
  integration: Integration;
  snapshotDate: string;
  snapshotValue: string;
};

export type EventCheckResult = {
  integration: Integration;
  newPosts: EventMonitorPost[];
  strikeTerms: string[];
  latestSeenId: string | null;
  latestSeenUrl: string | null;
  checkTitle?: string;
  checkFields?: Array<{ name: string; value: string; inline?: boolean }>;
};

export type EventCheckOptions = {
  queueAlerts?: boolean;
  historicalCheck?: boolean;
};

const maxEventSeenPostIds = 100;
const schedulerErrorNoticeWindowMs = 10 * 60_000;
let schedulerErrorNotice: ErrorNoticeState | undefined;

export function buildAlertMessagePayload(result: CheckResult) {
  return {
    content: result.integration.alertRoleId ? `<@&${result.integration.alertRoleId}>` : undefined,
    embeds: [buildAlertEmbed(result)],
    allowedMentions: result.integration.alertRoleId ? { roles: [result.integration.alertRoleId] } : { parse: [] }
  };
}

export function buildSnapshotMessagePayload(result: SnapshotResult) {
  return {
    content: result.integration.alertRoleId ? `<@&${result.integration.alertRoleId}>` : undefined,
    embeds: [buildSnapshotCapturedEmbed(result)],
    allowedMentions: result.integration.alertRoleId ? { roles: [result.integration.alertRoleId] } : { parse: [] }
  };
}

export function buildMarketEndReminderMessagePayload(integration: Integration, reminder: MarketEndReminder) {
  return {
    content: integration.alertRoleId ? `<@&${integration.alertRoleId}>` : undefined,
    embeds: [buildMarketEndReminderEmbed(integration, reminder)],
    allowedMentions: integration.alertRoleId ? { roles: [integration.alertRoleId] } : { parse: [] }
  };
}

export function hasValueChanged(previousValue: string | null, currentValue: string): boolean {
  return previousValue !== null && previousValue !== currentValue;
}

export async function checkIntegration(database: BotDatabase, integration: Integration): Promise<CheckResult> {
  integration = activateQueuedPolymarket(database, integration);
  const adapter = getAdapter(integration.adapterId);
  if (adapter.refreshSettings) {
    const refreshedSettingsJson = await adapter.refreshSettings(integration);
    if (refreshedSettingsJson && refreshedSettingsJson !== integration.settingsJson) {
      integration = database.setSettingsJson(integration.id, refreshedSettingsJson);
      integration = activateQueuedPolymarket(database, integration);
    }
  }

  const adapterValue = await adapter.fetchCurrentValue(integration);
  const detectedAt = new Date();
  const previousValue = integration.lastValue;
  const previousCheckedAt = integration.lastCheckedAt;
  const changed =
    hasValueChanged(previousValue, adapterValue.value) &&
    (adapter.shouldAlertOnChange ? adapter.shouldAlertOnChange(previousValue, adapterValue.value) : true);
  const updatedIntegration = database.recordCheck(integration.id, adapterValue.value, adapterValue.observedAt, changed);
  if (changed) {
    database.recordUpdateLog({
      integrationId: updatedIntegration.id,
      adapterId: updatedIntegration.adapterId,
      kind: "value_change",
      title: "Value changed",
      summary: adapterValue.value,
      sourceAt: adapterValue.observedAt,
      detectedAt
    });
  }

  return {
    integration: updatedIntegration,
    previousValue,
    previousCheckedAt,
    currentValue: adapterValue.value,
    changed
  };
}

export async function checkEventIntegration(
  database: BotDatabase,
  integration: Integration,
  options: EventCheckOptions = {}
): Promise<EventCheckResult> {
  integration = activateQueuedPolymarket(database, integration);
  const adapter = getAdapter(integration.adapterId);
  if (!adapter.fetchEventUpdates) {
    throw new Error(`Adapter does not support event updates: ${adapter.id}`);
  }

  const refreshedSettingsJson = adapter.refreshSettings ? await adapter.refreshSettings(integration) : integration.settingsJson;
  const settingsIntegration =
    refreshedSettingsJson && refreshedSettingsJson !== integration.settingsJson
      ? database.setSettingsJson(integration.id, refreshedSettingsJson)
      : integration;
  const result = await adapter.fetchEventUpdates(settingsIntegration, { historicalCheck: options.historicalCheck });
  const activeIntegration =
    result.polymarketUrl && result.polymarketUrl !== settingsIntegration.polymarketUrl
      ? database.setPolymarketUrl(settingsIntegration.id, result.polymarketUrl)
      : settingsIntegration;
  const currentIntegration = database.getIntegrationById(activeIntegration.id);
  const latestSeenId = result.posts[0]?.id ?? currentIntegration.lastValue;
  const baseSettingsJson = mergeEventSeenPostIds(result.settingsJson ?? activeIntegration.settingsJson, currentIntegration.settingsJson);
  const eventSelection = selectNewEventPosts(result.posts, currentIntegration.lastValue, baseSettingsJson);
  const candidatePosts =
    options.historicalCheck
      ? [...result.posts].reverse()
      : currentIntegration.lastValue === null && adapter.shouldAlertOnEventPost
        ? result.posts.slice(0, 1)
        : eventSelection.newPosts;
  const enrichedNewPosts = adapter.enrichEventPost && !result.postsAreEnriched
    ? await enrichEventPosts(adapter, candidatePosts, result.strikeTerms)
    : candidatePosts;
  const alertPosts = adapter.shouldAlertOnEventPost
    ? enrichedNewPosts.filter((post) => adapter.shouldAlertOnEventPost!(post))
    : enrichedNewPosts;
  const freshAlertPosts = alertPosts.filter((post) => isEventPostFresh(adapter, post, result.observedAt));
  const newPosts = options.queueAlerts
    ? claimEventAlertPosts(database, activeIntegration.id, freshAlertPosts, result.observedAt)
    : freshAlertPosts;
  const eventSettingsJson = updateEventSeenPostIds(baseSettingsJson, eventSelection.nextSeenPostIds);
  const eventStateIntegration =
    eventSettingsJson !== activeIntegration.settingsJson
      ? database.setSettingsJson(activeIntegration.id, eventSettingsJson)
      : activeIntegration;
  const updatedIntegration = latestSeenId
    ? database.recordCheck(eventStateIntegration.id, latestSeenId, result.observedAt)
    : database.recordCheck(eventStateIntegration.id, "no-posts", result.observedAt);

  return {
    integration: updatedIntegration,
    newPosts,
    strikeTerms: result.strikeTerms,
    latestSeenId: latestSeenId ?? null,
    latestSeenUrl: result.posts[0]?.url ?? null,
    checkTitle: result.checkTitle,
    checkFields: result.checkFields
  };
}

function claimEventAlertPosts(
  database: BotDatabase,
  integrationId: number,
  posts: EventMonitorPost[],
  observedAt: Date
): EventMonitorPost[] {
  return posts.filter((post) => database.claimEventAlert(integrationId, post.id, post, observedAt));
}

function isEventPostFresh(adapter: WebsiteAdapter, post: EventMonitorPost, now: Date): boolean {
  if (!adapter.maxEventPostAgeMinutes) {
    return true;
  }

  return now.getTime() - post.postedAt.getTime() <= adapter.maxEventPostAgeMinutes * 60_000;
}

export function selectNewEventPosts(
  posts: EventMonitorPost[],
  lastValue: string | null,
  settingsJson: string | null
): { newPosts: EventMonitorPost[]; nextSeenPostIds: string[] } {
  const currentPostIds = posts.map((post) => post.id);
  const seenPostIds = getEventSeenPostIds(settingsJson);
  const seen = new Set(seenPostIds);
  const newPosts =
    lastValue === null
      ? []
      : seen.size > 0
        ? posts.filter((post) => !seen.has(post.id)).reverse()
        : getNewEventPostsByLastValue(posts, lastValue);

  return {
    newPosts,
    nextSeenPostIds: uniqueStrings([...currentPostIds, ...seenPostIds]).slice(0, maxEventSeenPostIds)
  };
}

function getNewEventPostsByLastValue(posts: EventMonitorPost[], lastValue: string): EventMonitorPost[] {
  const lastSeenIndex = posts.findIndex((post) => post.id === lastValue);
  return (lastSeenIndex === -1 ? posts.slice(0, 5) : posts.slice(0, lastSeenIndex)).reverse();
}

function getEventSeenPostIds(settingsJson: string | null): string[] {
  const settings = parseSettingsJson(settingsJson);
  return Array.isArray(settings.eventSeenPostIds) ? settings.eventSeenPostIds.filter(isNonEmptyString) : [];
}

function updateEventSeenPostIds(settingsJson: string | null, eventSeenPostIds: string[]): string {
  return JSON.stringify({
    ...parseSettingsJson(settingsJson),
    eventSeenPostIds: uniqueStrings(eventSeenPostIds).slice(0, maxEventSeenPostIds)
  });
}

function mergeEventSeenPostIds(primarySettingsJson: string | null, secondarySettingsJson: string | null): string | null {
  const primarySettings = parseSettingsJson(primarySettingsJson);
  const primarySeen = getEventSeenPostIds(primarySettingsJson);
  const secondarySeen = getEventSeenPostIds(secondarySettingsJson);
  const eventSeenPostIds = uniqueStrings([...primarySeen, ...secondarySeen]).slice(0, maxEventSeenPostIds);

  if (!eventSeenPostIds.length) {
    return primarySettingsJson;
  }

  return JSON.stringify({
    ...primarySettings,
    eventSeenPostIds
  });
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

async function enrichEventPosts(
  adapter: WebsiteAdapter,
  posts: EventMonitorPost[],
  strikeTerms: string[]
): Promise<EventMonitorPost[]> {
  const enrichedPosts: EventMonitorPost[] = [];
  for (const post of posts) {
    enrichedPosts.push(await adapter.enrichEventPost!(post, strikeTerms));
  }
  return enrichedPosts;
}

export async function captureDailySnapshot(
  database: BotDatabase,
  integration: Integration,
  snapshotDate: string
): Promise<SnapshotResult> {
  const adapter = getAdapter(integration.adapterId);
  if (!adapter.dailySnapshot) {
    throw new Error(`Adapter does not support daily snapshots: ${adapter.id}`);
  }

  const adapterValue = await adapter.fetchCurrentValue(integration);
  const detectedAt = new Date();
  const snapshotChanged = integration.snapshotValue !== null && integration.snapshotValue !== adapterValue.value;
  const updatedIntegration = database.recordSnapshot(integration.id, adapterValue.value, adapterValue.observedAt, snapshotDate);
  if (snapshotChanged) {
    database.recordUpdateLog({
      integrationId: updatedIntegration.id,
      adapterId: updatedIntegration.adapterId,
      kind: "daily_snapshot",
      dedupeKey: snapshotDate,
      title: "Daily snapshot changed",
      summary: adapterValue.value,
      sourceAt: adapterValue.observedAt,
      detectedAt
    });
  }
  return {
    integration: updatedIntegration,
    snapshotDate,
    snapshotValue: adapterValue.value
  };
}

export function getDueSnapshotDate(
  integration: Integration,
  adapter: WebsiteAdapter,
  now: Date = new Date()
): string | null {
  if (!adapter.dailySnapshot || integration.status !== "active") {
    return null;
  }

  const parts = getZonedDateTimeParts(now, adapter.dailySnapshot.timeZone);
  const isDue =
    parts.hour === adapter.dailySnapshot.hour &&
    parts.minute >= adapter.dailySnapshot.minute &&
    parts.minute < adapter.dailySnapshot.minute + adapter.dailySnapshot.windowMinutes;

  if (!isDue || integration.snapshotDate === parts.date) {
    return null;
  }

  return parts.date;
}

export class PollScheduler {
  private readonly timers = new Map<number, { timer: NodeJS.Timeout; pollIntervalMinutes: number }>();
  private readonly errorNotices = new Map<number, ErrorNoticeState>();
  private readonly snapshotRuns = new Set<number>();
  private snapshotTimer: NodeJS.Timeout | null = null;
  private marketEndReminderTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly client: Client,
    private readonly database: BotDatabase
  ) {}

  start(): void {
    this.refresh();
    setInterval(() => this.refresh(), 30_000).unref();
    this.snapshotTimer = setInterval(() => void this.runDueDailySnapshots().catch(logSchedulerError), 30_000);
    this.snapshotTimer.unref();
    void this.runDueDailySnapshots().catch(logSchedulerError);
    this.marketEndReminderTimer = setInterval(() => void this.runDueMarketEndReminders().catch(logSchedulerError), 60_000);
    this.marketEndReminderTimer.unref();
    void this.runDueMarketEndReminders().catch(logSchedulerError);
  }

  refresh(): void {
    const activeIntegrations = this.database.listActiveIntegrations();
    const activeIds = new Set(activeIntegrations.map((integration) => integration.id));

    for (const id of this.timers.keys()) {
      if (!activeIds.has(id)) {
        clearInterval(this.timers.get(id)!.timer);
        this.timers.delete(id);
      }
    }

    for (const integration of activeIntegrations) {
      const pollIntervalMinutes = getEffectivePollIntervalMinutes(integration);
      const existing = this.timers.get(integration.id);
      if (existing && existing.pollIntervalMinutes !== pollIntervalMinutes) {
        clearInterval(existing.timer);
        this.timers.delete(integration.id);
      }

      if (!this.timers.has(integration.id)) {
        this.schedule(integration, pollIntervalMinutes);
      }
    }
  }

  private schedule(integration: Integration, pollIntervalMinutes: number): void {
    const run = async () => {
      const latest = this.database.getIntegrationById(integration.id);
      if (latest.status !== "active") {
        return;
      }

      try {
        const adapter = getAdapter(latest.adapterId);
        if (adapter.fetchEventUpdates) {
          await this.sendDueEventAlerts(latest.id);
          const result = await checkEventIntegration(this.database, latest, { queueAlerts: true });
          for (const post of result.newPosts) {
            await this.sendClaimedEventPost(result.integration, post);
          }
        } else {
          const result = await checkIntegration(this.database, latest);
          if (result.changed) {
            await this.sendAlert(latest.channelId, result);
          }
        }
        this.errorNotices.delete(latest.id);
      } catch (error) {
        await this.sendErrorIfDue(latest.channelId, latest, error).catch(logSchedulerError);
      }
    };

    void run().catch(logSchedulerError);
    const timer = setInterval(() => void run().catch(logSchedulerError), pollIntervalMinutes * 60_000);
    timer.unref();
    this.timers.set(integration.id, { timer, pollIntervalMinutes });
  }

  private async sendAlert(channelId: string, result: CheckResult): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!isSendableChannel(channel)) {
      return;
    }

    await channel.send(buildAlertMessagePayload(result));
  }

  private async sendErrorIfDue(channelId: string, integration: Integration, error: unknown): Promise<void> {
    const adapter = getAdapter(integration.adapterId);
    const message = formatErrorMessage(error);
    const windowMs = (adapter.getErrorNoticeWindowMinutes?.(integration) ?? defaultRepeatedErrorNoticeWindowMs / 60_000) * 60_000;
    const decision = getErrorNoticeDecision(this.errorNotices.get(integration.id), message, Date.now(), windowMs);
    this.errorNotices.set(integration.id, decision.nextState);
    if (!decision.shouldSend) {
      return;
    }

    await this.sendErrorMessage(channelId, integration, decision.message);
  }

  private async sendError(channelId: string, integration: Integration, error: unknown): Promise<void> {
    await this.sendErrorMessage(channelId, integration, formatErrorMessage(error));
  }

  private async sendErrorMessage(channelId: string, integration: Integration, message: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!isSendableChannel(channel)) {
      return;
    }

    const sentMessage = await channel.send({ embeds: [buildErrorEmbed(integration, message)] });
    const sentMessageId = getDiscordMessageId(sentMessage);
    if (!sentMessageId) {
      return;
    }

    const previousMessageId = getLatestErrorMessageId(integration.settingsJson);
    const updatedSettingsJson = setLatestErrorMessageId(integration.settingsJson, sentMessageId);
    if (updatedSettingsJson !== integration.settingsJson) {
      this.database.setSettingsJson(integration.id, updatedSettingsJson);
    }

    if (previousMessageId && previousMessageId !== sentMessageId && isDeletableMessageChannel(channel)) {
      await channel.messages.delete(previousMessageId).catch(() => undefined);
    }
  }

  private async sendEventPost(channelId: string, integration: Integration, post: EventMonitorPost): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!isSendableChannel(channel)) {
      throw new Error(`Event alert channel is not sendable for ${integration.adapterId}: ${channelId}`);
    }

    await channel.send(buildEventPostMessagePayload(integration, post));
  }

  private async sendDueEventAlerts(integrationId: number): Promise<void> {
    for (const alert of this.database.claimPendingEventAlerts(integrationId)) {
      const integration = this.database.getIntegrationById(alert.integrationId);
      await this.sendClaimedEventPost(integration, alert.post);
    }
  }

  private async sendClaimedEventPost(integration: Integration, post: EventMonitorPost): Promise<void> {
    try {
      const adapter = getAdapter(integration.adapterId);
      if (!isEventPostFresh(adapter, post, new Date())) {
        this.database.markEventAlertSent(integration.id, post.id);
        return;
      }

      for (const channelId of this.resolveEventPostChannelIds(integration, post)) {
        await this.sendEventPost(channelId, integration, post);
      }
      this.database.markEventAlertSent(integration.id, post.id);
      this.recordEventAlertDelivered(integration.id, post);
    } catch (error) {
      this.database.markEventAlertPending(integration.id, post.id);
      throw error;
    }
  }

  private resolveEventPostChannelIds(integration: Integration, post: EventMonitorPost): string[] {
    const adapter = getAdapter(integration.adapterId);
    const channelIds = uniqueStrings(adapter.resolveEventPostChannelIds?.(integration, post) ?? []).filter(Boolean);
    return channelIds.length ? channelIds : [integration.channelId];
  }

  private recordEventAlertDelivered(integrationId: number, post: EventMonitorPost): void {
    const integration = this.database.getIntegrationById(integrationId);
    if (getEventSeenPostIds(integration.settingsJson).includes(post.id)) {
      return;
    }

    const settingsJson = updateEventSeenPostIds(integration.settingsJson, [post.id, ...getEventSeenPostIds(integration.settingsJson)]);
    const updated = this.database.setSettingsJson(integration.id, settingsJson);
    this.database.recordCheck(updated.id, post.id, post.postedAt);
  }

  private async runDueDailySnapshots(): Promise<void> {
    for (const integration of this.database.listActiveIntegrations()) {
      const adapter = getAdapter(integration.adapterId);
      const snapshotDate = getDueSnapshotDate(integration, adapter);
      if (!snapshotDate || this.snapshotRuns.has(integration.id)) {
        continue;
      }

      this.snapshotRuns.add(integration.id);
      try {
        const latest = this.database.getIntegrationById(integration.id);
        const latestSnapshotDate = getDueSnapshotDate(latest, adapter);
        if (!latestSnapshotDate) {
          continue;
        }

        const result = await captureDailySnapshot(this.database, latest, latestSnapshotDate);
        await this.sendSnapshot(latest.channelId, result);
        this.errorNotices.delete(latest.id);
      } catch (error) {
        await this.sendErrorIfDue(integration.channelId, integration, error).catch(logSchedulerError);
      } finally {
        this.snapshotRuns.delete(integration.id);
      }
    }
  }

  private async sendSnapshot(channelId: string, result: SnapshotResult): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!isSendableChannel(channel)) {
      return;
    }

    await channel.send(buildSnapshotMessagePayload(result));
  }

  private async runDueMarketEndReminders(now: Date = new Date()): Promise<void> {
    for (const integration of this.database.listActiveIntegrations()) {
      let activeIntegration = integration;
      try {
        activeIntegration = activateQueuedPolymarket(this.database, integration, now);
        if (!activeIntegration.polymarketUrl) {
          continue;
        }

        const marketEnd = await getStoredOrFetchPolymarketEndDate(this.database, activeIntegration, now);
        if (marketEnd.missingWarningDue) {
          await this.sendMarketEndMissingWarning(activeIntegration.channelId, activeIntegration);
          this.database.recordMarketEndMissingWarning(activeIntegration.id, activeIntegration.polymarketUrl, now);
          continue;
        }

        for (const reminder of await getDueMarketEndReminders(this.database, activeIntegration, now)) {
          if (this.database.hasMarketEndReminder(activeIntegration.id, activeIntegration.polymarketUrl, reminder.key)) {
            continue;
          }

          await this.sendMarketEndReminder(activeIntegration.channelId, activeIntegration, reminder);
          this.database.recordMarketEndReminder(activeIntegration.id, activeIntegration.polymarketUrl, reminder.key, now);
        }
      } catch (error) {
        logMarketEndLookupError(activeIntegration, error);
      }
    }
  }

  private async sendMarketEndReminder(
    channelId: string,
    integration: Integration,
    reminder: MarketEndReminder
  ): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!isSendableChannel(channel)) {
      return;
    }

    await channel.send(buildMarketEndReminderMessagePayload(integration, reminder));
  }

  private async sendMarketEndMissingWarning(channelId: string, integration: Integration): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!isSendableChannel(channel)) {
      return;
    }

    await channel.send({ embeds: [buildMarketEndMissingEmbed(integration)] });
  }
}

type SendableChannel = {
  send(content: unknown): Promise<unknown>;
};

type DeletableMessageChannel = SendableChannel & {
  messages: {
    delete(messageId: string): Promise<unknown>;
  };
};

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return Boolean(channel && typeof channel === "object" && "send" in channel && typeof channel.send === "function");
}

function isDeletableMessageChannel(channel: SendableChannel): channel is DeletableMessageChannel {
  const messages = "messages" in channel ? channel.messages : null;
  if (!messages || typeof messages !== "object") {
    return false;
  }

  return "delete" in messages && typeof messages.delete === "function";
}

function getDiscordMessageId(message: unknown): string | null {
  if (!message || typeof message !== "object" || !("id" in message)) {
    return null;
  }

  return typeof message.id === "string" ? message.id : null;
}

export function getLatestErrorMessageId(settingsJson: string | null): string | null {
  const settings = parseSettingsJson(settingsJson);
  return typeof settings.latestErrorMessageId === "string" ? settings.latestErrorMessageId : null;
}

export function setLatestErrorMessageId(settingsJson: string | null, messageId: string): string {
  return mergeSettingsJson(settingsJson, { latestErrorMessageId: messageId });
}

function activateQueuedPolymarket(database: BotDatabase, integration: Integration, now = new Date()): Integration {
  const queue = resolveIntegrationPolymarketQueue(integration, now);
  let updated = integration;
  if (queue.settingsJson && queue.settingsJson !== updated.settingsJson) {
    updated = database.setSettingsJson(updated.id, queue.settingsJson);
  }
  if (queue.activeUrl !== updated.polymarketUrl) {
    updated = database.setPolymarketUrl(updated.id, queue.activeUrl);
  }

  return updated;
}

export function getEffectivePollIntervalMinutes(integration: Integration, now: Date = new Date()): number {
  const adapter = getAdapter(integration.adapterId);
  return adapter.getPollIntervalMinutes?.(integration, now) ?? integration.pollIntervalMinutes;
}

export function getPollIntervalReason(integration: Integration, now: Date = new Date()): string {
  const adapter = getAdapter(integration.adapterId);
  return adapter.getPollIntervalReason?.(integration, now) ?? "Configured interval";
}

function logSchedulerError(error: unknown): void {
  if (!isTransientNetworkError(error)) {
    console.error("Poll scheduler error:", error);
    return;
  }

  const message = formatSchedulerNetworkError(error);
  const decision = getErrorNoticeDecision(schedulerErrorNotice, message, Date.now(), schedulerErrorNoticeWindowMs);
  schedulerErrorNotice = decision.nextState;
  if (decision.shouldSend) {
    console.error(`Poll scheduler error: ${decision.message}`);
  }
}

function logMarketEndLookupError(integration: Integration, error: unknown): void {
  console.error(`Market-end lookup failed for ${integration.adapterId}: ${formatErrorMessage(error)}`);
}

function getZonedDateTimeParts(date: Date, timeZone: string): { date: string; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}
