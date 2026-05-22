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
import { getAdapter } from "./integrations/registry.js";
import type { EventMonitorPost, Integration, WebsiteAdapter } from "./integrations/types.js";
import { getDueMarketEndReminders, getStoredOrFetchPolymarketEndDate, type MarketEndReminder } from "./marketEnd.js";
import { resolveIntegrationPolymarketQueue } from "./polymarketQueue.js";

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

const maxEventSeenPostIds = 100;
const schedulerErrorNoticeWindowMs = 10 * 60_000;
let schedulerErrorNotice: ErrorNoticeState | undefined;

export type ErrorNoticeState = {
  signature: string;
  sentAtMs: number;
  suppressedCount: number;
};

const repeatedErrorNoticeWindowMs = 30 * 60_000;

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

export function getErrorNoticeDecision(
  existing: ErrorNoticeState | undefined,
  message: string,
  nowMs: number,
  windowMs = repeatedErrorNoticeWindowMs
): { shouldSend: boolean; message: string; nextState: ErrorNoticeState } {
  if (!existing || existing.signature !== message) {
    return {
      shouldSend: true,
      message,
      nextState: { signature: message, sentAtMs: nowMs, suppressedCount: 0 }
    };
  }

  if (nowMs - existing.sentAtMs < windowMs) {
    return {
      shouldSend: false,
      message,
      nextState: { ...existing, suppressedCount: existing.suppressedCount + 1 }
    };
  }

  const suppressedSummary =
    existing.suppressedCount > 0
      ? `\n\nSuppressed ${existing.suppressedCount} repeated error(s) in the previous ${Math.round(windowMs / 60_000)} minute(s).`
      : "";

  return {
    shouldSend: true,
    message: `${message}${suppressedSummary}`,
    nextState: { signature: message, sentAtMs: nowMs, suppressedCount: 0 }
  };
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
  const previousValue = integration.lastValue;
  const previousCheckedAt = integration.lastCheckedAt;
  const changed =
    hasValueChanged(previousValue, adapterValue.value) &&
    (adapter.shouldAlertOnChange ? adapter.shouldAlertOnChange(previousValue, adapterValue.value) : true);
  const updatedIntegration = database.recordCheck(integration.id, adapterValue.value, adapterValue.observedAt);

  return {
    integration: updatedIntegration,
    previousValue,
    previousCheckedAt,
    currentValue: adapterValue.value,
    changed
  };
}

export async function checkEventIntegration(database: BotDatabase, integration: Integration): Promise<EventCheckResult> {
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
  const result = await adapter.fetchEventUpdates(settingsIntegration);
  const activeIntegration =
    result.polymarketUrl && result.polymarketUrl !== settingsIntegration.polymarketUrl
      ? database.setPolymarketUrl(settingsIntegration.id, result.polymarketUrl)
      : settingsIntegration;
  const currentIntegration = database.getIntegrationById(activeIntegration.id);
  const latestSeenId = result.posts[0]?.id ?? currentIntegration.lastValue;
  const baseSettingsJson = mergeEventSeenPostIds(result.settingsJson ?? activeIntegration.settingsJson, currentIntegration.settingsJson);
  const eventSelection = selectNewEventPosts(result.posts, currentIntegration.lastValue, baseSettingsJson);
  const candidatePosts =
    currentIntegration.lastValue === null && adapter.shouldAlertOnEventPost ? result.posts.slice(0, 1) : eventSelection.newPosts;
  const eventSettingsJson = updateEventSeenPostIds(baseSettingsJson, eventSelection.nextSeenPostIds);
  const eventStateIntegration =
    eventSettingsJson !== activeIntegration.settingsJson
      ? database.setSettingsJson(activeIntegration.id, eventSettingsJson)
      : activeIntegration;
  const enrichedNewPosts = adapter.enrichEventPost
    ? await enrichEventPosts(adapter, candidatePosts, result.strikeTerms)
    : candidatePosts;
  const alertPosts = adapter.shouldAlertOnEventPost
    ? enrichedNewPosts.filter((post) => adapter.shouldAlertOnEventPost!(post))
    : enrichedNewPosts;
  const updatedIntegration = latestSeenId
    ? database.recordCheck(eventStateIntegration.id, latestSeenId, result.observedAt)
    : database.recordCheck(eventStateIntegration.id, "no-posts", result.observedAt);

  return {
    integration: updatedIntegration,
    newPosts: alertPosts,
    strikeTerms: result.strikeTerms,
    latestSeenId: latestSeenId ?? null,
    latestSeenUrl: result.posts[0]?.url ?? null,
    checkTitle: result.checkTitle,
    checkFields: result.checkFields
  };
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
    eventSeenPostIds
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

function parseSettingsJson(settingsJson: string | null): Record<string, unknown> {
  if (!settingsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(settingsJson) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
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
  const updatedIntegration = database.recordSnapshot(integration.id, adapterValue.value, adapterValue.observedAt, snapshotDate);
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
          const result = await checkEventIntegration(this.database, latest);
          for (const post of result.newPosts) {
            await this.sendEventPost(latest.channelId, result.integration, post);
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
    const windowMs = (adapter.getErrorNoticeWindowMinutes?.(integration) ?? repeatedErrorNoticeWindowMs / 60_000) * 60_000;
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

    await channel.send({ embeds: [buildErrorEmbed(integration, message)] });
  }

  private async sendEventPost(channelId: string, integration: Integration, post: EventMonitorPost): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!isSendableChannel(channel)) {
      return;
    }

    await channel.send(buildEventPostMessagePayload(integration, post));
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
      } catch (error) {
        await this.sendError(integration.channelId, integration, error).catch(logSchedulerError);
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

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return Boolean(channel && typeof channel === "object" && "send" in channel && typeof channel.send === "function");
}

function activateQueuedPolymarket(database: BotDatabase, integration: Integration, now = new Date()): Integration {
  const queue = resolveIntegrationPolymarketQueue(integration, now);
  let updated = integration;
  if (queue.settingsJson && queue.settingsJson !== updated.settingsJson) {
    updated = database.setSettingsJson(updated.id, queue.settingsJson);
  }
  if (queue.activeUrl && queue.activeUrl !== updated.polymarketUrl) {
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

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatSchedulerNetworkError(error: unknown): string {
  const codes = [...new Set(collectErrorCodes(error))].join(", ");
  const codeText = codes ? ` (${codes})` : "";
  return `Discord/network send failed${codeText}: ${formatErrorMessage(error)}. This is usually Pi DNS/VPN/router access to Discord; scheduler will retry.`;
}

function isTransientNetworkError(error: unknown): boolean {
  const codes = collectErrorCodes(error);
  const message = formatErrorMessage(error).toLowerCase();
  return (
    codes.some((code) =>
      ["EAI_AGAIN", "ECONNRESET", "ECONNABORTED", "EHOSTUNREACH", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code)
    ) ||
    message.includes("eai_again") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("connection reset")
  );
}

function collectErrorCodes(error: unknown): string[] {
  if (!error || typeof error !== "object") {
    return [];
  }

  const codes: string[] = [];
  const maybeCode = "code" in error ? error.code : undefined;
  if (typeof maybeCode === "string") {
    codes.push(maybeCode);
  }

  const maybeCause = "cause" in error ? error.cause : undefined;
  codes.push(...collectErrorCodes(maybeCause));
  return codes;
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
