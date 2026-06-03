import type { Client } from "discord.js";
import WebSocket, { type RawData } from "ws";
import type { BotConfig } from "./config.js";
import type { BotDatabase } from "./database.js";
import { buildEventPostMessagePayload } from "./embeds.js";
import {
  ancillaryDataUpdatedTopic,
  buildFastPolymarketClarificationPostFromLog,
  buildFastPolymarketPendingClarificationPostFromTransaction,
  buildPolymarketClarificationPostFromLog,
  buildPolymarketPendingClarificationPostFromTransaction,
  getPolymarketClarificationRpcUrls,
  getPolymarketClarificationWsUrl,
  hasSeenClarificationTx,
  parseHexQuantity,
  parsePolymarketClarificationSettings,
  polymarketBulletinBoardAddress,
  type PolygonLog,
  type PolygonPendingTransaction
} from "./integrations/polymarketClarifications.js";

const adapterId = "polymarket-clarifications";
const maxSeenEventIds = 100;
const reconnectDelayMs = 5_000;
const websocketPingIntervalMs = 30_000;

type SubscriptionMessage = {
  id?: number | string;
  method?: string;
  result?: string;
  params?: {
    result?: string | (PolygonLog & { removed?: boolean }) | PolygonPendingTransaction;
  };
  error?: { message?: string };
};

type SendableChannel = {
  send(content: unknown): Promise<unknown>;
};

type EditableMessage = {
  edit(content: unknown): Promise<unknown>;
};

export class UmaAlertSubscriber {
  private websocket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly inFlightLogIds = new Set<string>();
  private warnedHashOnlyPending = false;

  constructor(
    private readonly client: Client,
    private readonly database: BotDatabase,
    private readonly config: BotConfig
  ) {}

  start(): void {
    this.stopped = false;
    try {
      this.connect();
    } catch (error) {
      console.error("UMA alert WebSocket connect failed:", formatError(error));
      this.scheduleReconnect();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopKeepalive();
    this.websocket?.close();
    this.websocket = null;
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }

    const integration = this.database.getIntegrationByAdapter(this.config.discordGuildId, adapterId);
    const settings = parsePolymarketClarificationSettings(integration?.settingsJson ?? null);
    const wsUrl = getPolymarketClarificationWsUrl(settings);
    const websocket = new WebSocket(wsUrl);
    const connectedAtMs = Date.now();
    this.websocket = websocket;

    websocket.on("open", () => {
      this.startKeepalive(websocket);
      websocket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_subscribe",
          params: [
            "logs",
            {
              address: polymarketBulletinBoardAddress,
              topics: [ancillaryDataUpdatedTopic]
            }
          ]
        })
      );
      websocket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "eth_subscribe",
          params: buildPendingTransactionSubscriptionParams(wsUrl)
        })
      );
      console.log(`UMA alert WebSocket subscribe requested via ${wsUrl}`);
    });

    websocket.on("message", (data) => {
      void this.handleMessage(data).catch((error) => {
        console.error("UMA alert WebSocket message failed:", formatError(error));
      });
    });

    websocket.on("error", (error) => {
      console.error(`UMA alert WebSocket error from ${wsUrl}: ${formatError(error)}`);
    });

    websocket.on("close", (code, reason) => {
      this.stopKeepalive();
      if (this.websocket === websocket) {
        this.websocket = null;
      }
      if (!this.stopped) {
        console.warn(
          `UMA alert WebSocket closed after ${Math.round((Date.now() - connectedAtMs) / 1_000)}s ` +
            `(code ${code}${formatCloseReason(reason)}); reconnecting`
        );
      }
      this.scheduleReconnect();
    });
  }

  private startKeepalive(websocket: WebSocket): void {
    this.stopKeepalive();
    this.pingTimer = setInterval(() => {
      if (this.websocket !== websocket || websocket.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        websocket.ping();
      } catch (error) {
        console.error("UMA alert WebSocket ping failed:", formatError(error));
        websocket.terminate();
      }
    }, websocketPingIntervalMs);
    this.pingTimer.unref();
  }

  private stopKeepalive(): void {
    if (!this.pingTimer) {
      return;
    }

    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      try {
        this.connect();
      } catch (error) {
        console.error("UMA alert WebSocket reconnect failed:", formatError(error));
        this.scheduleReconnect();
      }
    }, reconnectDelayMs);
    this.reconnectTimer.unref();
  }

  private async handleMessage(data: unknown): Promise<void> {
    const message = parseSubscriptionMessage(data);
    if (message.error) {
      console.error(`UMA alert WebSocket subscription error: ${message.error.message ?? "unknown error"}`);
      this.websocket?.close();
      return;
    }

    if (message.result && message.id !== undefined) {
      console.log(`UMA alert WebSocket subscription confirmed: ${message.result}`);
      return;
    }

    const result = message.method === "eth_subscription" ? message.params?.result : undefined;
    if (!result) {
      return;
    }

    if (typeof result === "string") {
      if (!this.warnedHashOnlyPending) {
        this.warnedHashOnlyPending = true;
        console.warn("UMA alert pending tx subscription returned hashes only; mempool clarification alerts need full pending transactions.");
      }
      return;
    }

    if (isPendingTransaction(result)) {
      await this.handlePendingTransaction(result);
      return;
    }

    if (result.removed) {
      return;
    }

    await this.handleLog(result);
  }

  private async handleLog(log: PolygonLog): Promise<void> {
    const logId = `${log.transactionHash}:${log.logIndex}`;
    if (this.inFlightLogIds.has(logId)) {
      return;
    }

    this.inFlightLogIds.add(logId);
    try {
      const integration = this.database.getIntegrationByAdapter(this.config.discordGuildId, adapterId);
      if (!integration || hasSeenEventId(integration.settingsJson, logId) || integration.lastValue === logId) {
        return;
      }

      const settings = parsePolymarketClarificationSettings(integration.settingsJson);
      const post = buildFastPolymarketClarificationPostFromLog(log);
      if (!post) {
        return;
      }
      if (!this.database.claimEventAlert(integration.id, post.id, post)) {
        return;
      }

      const channel = await this.client.channels.fetch(integration.channelId);
      if (!isSendableChannel(channel)) {
        this.database.markEventAlertPending(integration.id, post.id);
        throw new Error(`UMA alert channel is not sendable: ${integration.channelId}`);
      }

      let sentMessage: unknown;
      try {
        sentMessage = await channel.send(buildEventPostMessagePayload(integration, post));
      } catch (error) {
        this.database.markEventAlertPending(integration.id, post.id);
        throw error;
      }
      this.database.markEventAlertSent(integration.id, post.id);
      this.recordDeliveredLog(integration.id, log, post);
      void this.enrichSentPost(sentMessage, integration.id, log, settings).catch((error) => {
        console.error("UMA alert enrichment edit failed:", formatError(error));
      });
    } finally {
      this.inFlightLogIds.delete(logId);
    }
  }

  private async handlePendingTransaction(transaction: PolygonPendingTransaction): Promise<void> {
    const pendingId = transaction.hash ? `pending:${transaction.hash.toLowerCase()}` : "";
    if (!pendingId || this.inFlightLogIds.has(pendingId)) {
      return;
    }

    this.inFlightLogIds.add(pendingId);
    try {
      const integration = this.database.getIntegrationByAdapter(this.config.discordGuildId, adapterId);
      if (
        !integration ||
        hasSeenEventId(integration.settingsJson, pendingId) ||
        integration.lastValue === pendingId
      ) {
        return;
      }

      const settings = parsePolymarketClarificationSettings(integration.settingsJson);
      const post = buildFastPolymarketPendingClarificationPostFromTransaction(transaction);
      if (!post) {
        return;
      }
      if (!this.database.claimEventAlert(integration.id, post.id, post)) {
        return;
      }

      const channel = await this.client.channels.fetch(integration.channelId);
      if (!isSendableChannel(channel)) {
        this.database.markEventAlertPending(integration.id, post.id);
        throw new Error(`UMA alert channel is not sendable: ${integration.channelId}`);
      }

      let sentMessage: unknown;
      try {
        sentMessage = await channel.send(buildEventPostMessagePayload(integration, post));
      } catch (error) {
        this.database.markEventAlertPending(integration.id, post.id);
        throw error;
      }
      this.database.markEventAlertSent(integration.id, post.id);
      this.recordDeliveredPendingTransaction(integration.id, transaction, post);
      void this.enrichSentPendingPost(sentMessage, integration.id, transaction, settings).catch((error) => {
        console.error("UMA alert pending enrichment edit failed:", formatError(error));
      });
    } finally {
      this.inFlightLogIds.delete(pendingId);
    }
  }

  private recordDeliveredLog(integrationId: number, log: PolygonLog, post: { id: string; postedAt: Date }): void {
    const integration = this.database.getIntegrationById(integrationId);
    const settings = parsePolymarketClarificationSettings(integration.settingsJson);
    const nextSettingsJson = JSON.stringify({
      ...settings,
      eventSeenPostIds: addSeenEventId(settings.eventSeenPostIds, post.id),
      lastScannedBlock: Math.max(settings.lastScannedBlock ?? 0, parseHexQuantity(log.blockNumber)),
      lastScanCompletedAt: new Date().toISOString()
    });
    this.database.setSettingsJson(integration.id, nextSettingsJson);
    this.database.recordCheck(integration.id, post.id, post.postedAt);
  }

  private recordDeliveredPendingTransaction(
    integrationId: number,
    transaction: PolygonPendingTransaction,
    post: { id: string; postedAt: Date }
  ): void {
    const integration = this.database.getIntegrationById(integrationId);
    const settings = parsePolymarketClarificationSettings(integration.settingsJson);
    const nextSettingsJson = JSON.stringify({
      ...settings,
      eventSeenPostIds: addSeenEventIds(settings.eventSeenPostIds, [post.id, transaction.hash.toLowerCase()]),
      lastScanCompletedAt: new Date().toISOString()
    });
    this.database.setSettingsJson(integration.id, nextSettingsJson);
    this.database.recordCheck(integration.id, post.id, post.postedAt);
  }

  private async enrichSentPost(
    sentMessage: unknown,
    integrationId: number,
    log: PolygonLog,
    settings: ReturnType<typeof parsePolymarketClarificationSettings>
  ): Promise<void> {
    if (!isEditableMessage(sentMessage)) {
      return;
    }

    const enrichedPost = await buildPolymarketClarificationPostFromLog(log, getPolymarketClarificationRpcUrls(settings));
    if (!enrichedPost) {
      return;
    }

    const integration = this.database.getIntegrationById(integrationId);
    const payload = buildEventPostMessagePayload(integration, enrichedPost);
    await sentMessage.edit({ embeds: payload.embeds, components: payload.components, allowedMentions: { parse: [] } });
  }

  private async enrichSentPendingPost(
    sentMessage: unknown,
    integrationId: number,
    transaction: PolygonPendingTransaction,
    settings: ReturnType<typeof parsePolymarketClarificationSettings>
  ): Promise<void> {
    if (!isEditableMessage(sentMessage)) {
      return;
    }

    const enrichedPost = await buildPolymarketPendingClarificationPostFromTransaction(
      transaction,
      getPolymarketClarificationRpcUrls(settings)
    );
    if (!enrichedPost) {
      return;
    }

    const integration = this.database.getIntegrationById(integrationId);
    const payload = buildEventPostMessagePayload(integration, enrichedPost);
    await sentMessage.edit({ embeds: payload.embeds, components: payload.components, allowedMentions: { parse: [] } });
  }
}

function parseSubscriptionMessage(data: RawData | unknown): SubscriptionMessage {
  const text = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : "";
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as SubscriptionMessage;
  } catch {
    return {};
  }
}

function hasSeenEventId(settingsJson: string | null, eventId: string): boolean {
  const settings = parsePolymarketClarificationSettings(settingsJson);
  if (!Array.isArray(settings.eventSeenPostIds)) {
    return false;
  }

  const transactionHash = eventId.startsWith("pending:")
    ? eventId.slice("pending:".length)
    : eventId.split(":")[0] ?? eventId;
  return (
    settings.eventSeenPostIds.some((candidate) => candidate.toLowerCase() === eventId.toLowerCase()) ||
    hasSeenClarificationTx(settings.eventSeenPostIds, transactionHash)
  );
}

function addSeenEventId(existing: string[] | undefined, eventId: string): string[] {
  return [eventId, ...(existing ?? []).filter((candidate) => candidate !== eventId)].slice(0, maxSeenEventIds);
}

function addSeenEventIds(existing: string[] | undefined, eventIds: string[]): string[] {
  return [
    ...eventIds,
    ...(existing ?? []).filter((candidate) => !eventIds.some((eventId) => eventId.toLowerCase() === candidate.toLowerCase()))
  ].slice(0, maxSeenEventIds);
}

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return Boolean(channel && typeof channel === "object" && "send" in channel && typeof channel.send === "function");
}

function isPendingTransaction(value: unknown): value is PolygonPendingTransaction {
  return Boolean(value && typeof value === "object" && "hash" in value && !("topics" in value));
}

function isEditableMessage(message: unknown): message is EditableMessage {
  return Boolean(message && typeof message === "object" && "edit" in message && typeof message.edit === "function");
}

export function buildPendingTransactionSubscriptionParams(wsUrl: string): unknown[] {
  if (isAlchemyWsUrl(wsUrl)) {
    return [
      "alchemy_pendingTransactions",
      {
        toAddress: [polymarketBulletinBoardAddress],
        hashesOnly: false
      }
    ];
  }

  return ["newPendingTransactions", true];
}

function isAlchemyWsUrl(wsUrl: string): boolean {
  try {
    const hostname = new URL(wsUrl).hostname.toLowerCase();
    return hostname.endsWith(".alchemy.com") || hostname.endsWith(".alchemyapi.io");
  } catch {
    return wsUrl.toLowerCase().includes("alchemy");
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatCloseReason(reason: Buffer): string {
  const text = reason.toString("utf8").trim();
  return text ? `, reason ${text}` : "";
}
