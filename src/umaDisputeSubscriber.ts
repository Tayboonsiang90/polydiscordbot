import type { Client } from "discord.js";
import WebSocket, { type RawData } from "ws";
import type { BotConfig } from "./config.js";
import type { BotDatabase } from "./database.js";
import { buildEventPostMessagePayload } from "./embeds.js";
import {
  buildPolymarketDisputePostFromLog,
  disputePriceTopic,
  getPolymarketDisputeWsUrl,
  optimisticOracleAddresses,
  parsePolymarketDisputeSettings,
  polymarketUmaCtfAdapterAddressTopics
} from "./integrations/polymarketDisputes.js";
import { parseHexQuantity, type PolygonLog } from "./integrations/polymarketClarifications.js";

const adapterId = "polymarket-disputes";
const maxSeenEventIds = 100;
const reconnectDelayMs = 5_000;

type SubscriptionMessage = {
  method?: string;
  params?: {
    result?: PolygonLog & { removed?: boolean };
  };
  error?: { message?: string };
};

type SendableChannel = {
  send(content: unknown): Promise<unknown>;
};

export class UmaDisputeSubscriber {
  private websocket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
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
      console.error("UMA dispute WebSocket connect failed:", formatError(error));
      this.scheduleReconnect();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.websocket?.close();
    this.websocket = null;
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }

    const integration = this.database.getIntegrationByAdapter(this.config.discordGuildId, adapterId);
    const settings = parsePolymarketDisputeSettings(integration?.settingsJson ?? null);
    const wsUrl = getPolymarketDisputeWsUrl(settings);
    const websocket = new WebSocket(wsUrl);
    this.websocket = websocket;

    websocket.on("open", () => {
      let requestId = 1;
      for (const oracleAddress of optimisticOracleAddresses) {
        websocket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: requestId,
            method: "eth_subscribe",
            params: [
              "logs",
              {
                address: oracleAddress,
                topics: [disputePriceTopic, polymarketUmaCtfAdapterAddressTopics]
              }
            ]
          })
        );
        requestId += 1;
      }
      console.log(`UMA dispute WebSocket subscribed via ${wsUrl}`);
    });

    websocket.on("message", (data) => {
      void this.handleMessage(data).catch((error) => {
        console.error("UMA dispute WebSocket message failed:", formatError(error));
      });
    });

    websocket.on("error", (error) => {
      console.error(`UMA dispute WebSocket error from ${wsUrl}: ${formatError(error)}`);
    });

    websocket.on("close", () => {
      if (this.websocket === websocket) {
        this.websocket = null;
      }
      this.scheduleReconnect();
    });
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
        console.error("UMA dispute WebSocket reconnect failed:", formatError(error));
        this.scheduleReconnect();
      }
    }, reconnectDelayMs);
    this.reconnectTimer.unref();
  }

  private async handleMessage(data: unknown): Promise<void> {
    const message = parseSubscriptionMessage(data);
    if (message.error) {
      throw new Error(message.error.message ?? "Unknown WebSocket subscription error");
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

      const settings = parsePolymarketDisputeSettings(integration.settingsJson);
      const post = await buildPolymarketDisputePostFromLog(log);
      if (!post) {
        return;
      }

      const channel = await this.client.channels.fetch(integration.channelId);
      if (!isSendableChannel(channel)) {
        return;
      }

      await channel.send(buildEventPostMessagePayload(integration, post));
      const nextSettingsJson = JSON.stringify({
        ...settings,
        eventSeenPostIds: addSeenEventId(settings.eventSeenPostIds, post.id),
        lastScannedBlock: Math.max(settings.lastScannedBlock ?? 0, parseHexQuantity(log.blockNumber)),
        lastScanCompletedAt: new Date().toISOString()
      });
      this.database.setSettingsJson(integration.id, nextSettingsJson);
      this.database.recordCheck(integration.id, post.id, post.postedAt);
    } finally {
      this.inFlightLogIds.delete(logId);
    }
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
  const settings = parsePolymarketDisputeSettings(settingsJson);
  return Array.isArray(settings.eventSeenPostIds) && settings.eventSeenPostIds.includes(eventId);
}

function addSeenEventId(existing: string[] | undefined, eventId: string): string[] {
  return [eventId, ...(existing ?? []).filter((candidate) => candidate !== eventId)].slice(0, maxSeenEventIds);
}

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return Boolean(channel && typeof channel === "object" && "send" in channel && typeof channel.send === "function");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
