import type { Client } from "discord.js";
import WebSocket, { type RawData } from "ws";
import type { BotConfig } from "./config.js";
import type { BotDatabase } from "./database.js";
import { buildEventPostMessagePayload } from "./embeds.js";
import {
  ancillaryDataUpdatedTopic,
  buildFastPolymarketClarificationPostFromLog,
  buildPolymarketClarificationPostFromLog,
  getPolymarketClarificationRpcUrls,
  getPolymarketClarificationWsUrl,
  parseHexQuantity,
  parsePolymarketClarificationSettings,
  polymarketBulletinBoardAddress,
  type PolygonLog
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
    result?: PolygonLog & { removed?: boolean };
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

    const log = message.method === "eth_subscription" ? message.params?.result : undefined;
    if (!log || log.removed) {
      return;
    }

    await this.handleLog(log);
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
  return Array.isArray(settings.eventSeenPostIds) && settings.eventSeenPostIds.includes(eventId);
}

function addSeenEventId(existing: string[] | undefined, eventId: string): string[] {
  return [eventId, ...(existing ?? []).filter((candidate) => candidate !== eventId)].slice(0, maxSeenEventIds);
}

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return Boolean(channel && typeof channel === "object" && "send" in channel && typeof channel.send === "function");
}

function isEditableMessage(message: unknown): message is EditableMessage {
  return Boolean(message && typeof message === "object" && "edit" in message && typeof message.edit === "function");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatCloseReason(reason: Buffer): string {
  const text = reason.toString("utf8").trim();
  return text ? `, reason ${text}` : "";
}
