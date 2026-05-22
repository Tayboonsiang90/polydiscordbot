import { describe, expect, it } from "vitest";
import {
  parsePolymarketDateRangeWindow,
  resolveIntegrationPolymarketQueue,
  upsertPolymarketQueueUrl
} from "../src/polymarketQueue.js";
import type { Integration } from "../src/integrations/types.js";

const integration: Integration = {
  id: 1,
  guildId: "guild",
  channelId: "channel",
  adapterId: "tsa-passengers",
  displayName: "TSA Passenger Volumes",
  sourceUrl: "https://www.tsa.gov/travel/passenger-volumes",
  polymarketUrl: "https://polymarket.com/event/number-of-tsa-passengers-may-4-may-10",
  alertRoleId: null,
  roleMessageId: null,
  roleChannelId: null,
  roleEmoji: null,
  settingsJson: null,
  pollIntervalMinutes: 5,
  status: "active",
  lastValue: null,
  lastCheckedAt: null,
  lastChangedAt: null,
  snapshotValue: null,
  snapshotCheckedAt: null,
  snapshotDate: null,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z"
};

describe("Polymarket URL queue", () => {
  it("parses date range windows from weekly market slugs", () => {
    expect(
      parsePolymarketDateRangeWindow(
        "https://polymarket.com/event/number-of-tsa-passengers-may-4-may-10",
        new Date("2026-05-10T12:00:00.000Z")
      )
    ).toEqual({
      startAt: "2026-05-04T04:00:00.000Z",
      endAt: "2026-05-11T03:59:00.000Z"
    });

    expect(
      parsePolymarketDateRangeWindow(
        "https://polymarket.com/event/number-of-tsa-passengers-may-11-may-17",
        new Date("2026-05-11T12:00:00.000Z")
      )
    ).toEqual({
      startAt: "2026-05-11T04:00:00.000Z",
      endAt: "2026-05-18T03:59:00.000Z"
    });
  });

  it("keeps a future market queued without replacing the currently active market", () => {
    const queue = upsertPolymarketQueueUrl(
      integration,
      "https://polymarket.com/event/number-of-tsa-passengers-may-11-may-17",
      new Date("2026-05-10T12:00:00.000Z")
    );
    const settings = JSON.parse(queue.settingsJson ?? "{}") as { polymarketMarkets: unknown[] };

    expect(queue.activeUrl).toBe("https://polymarket.com/event/number-of-tsa-passengers-may-4-may-10");
    expect(settings.polymarketMarkets).toHaveLength(1);
  });

  it("activates the next queued market and prunes expired entries after rollover", () => {
    const first = upsertPolymarketQueueUrl(
      integration,
      "https://polymarket.com/event/number-of-tsa-passengers-may-4-may-10",
      new Date("2026-05-10T12:00:00.000Z")
    );
    const second = upsertPolymarketQueueUrl(
      { ...integration, settingsJson: first.settingsJson },
      "https://polymarket.com/event/number-of-tsa-passengers-may-11-may-17",
      new Date("2026-05-10T12:00:00.000Z")
    );
    const resolved = resolveIntegrationPolymarketQueue(
      { ...integration, settingsJson: second.settingsJson },
      new Date("2026-05-11T12:00:00.000Z")
    );
    const settings = JSON.parse(resolved.settingsJson ?? "{}") as { polymarketMarkets: unknown[] };

    expect(resolved.activeUrl).toBe("https://polymarket.com/event/number-of-tsa-passengers-may-11-may-17");
    expect(settings.polymarketMarkets).toHaveLength(1);
  });

  it("clears an expired dated current market when no queued market is active", () => {
    const first = upsertPolymarketQueueUrl(
      integration,
      "https://polymarket.com/event/number-of-tsa-passengers-may-4-may-10",
      new Date("2026-05-10T12:00:00.000Z")
    );
    const resolved = resolveIntegrationPolymarketQueue(
      { ...integration, settingsJson: first.settingsJson },
      new Date("2026-05-18T12:00:00.000Z")
    );
    const settings = JSON.parse(resolved.settingsJson ?? "{}") as { polymarketMarkets: unknown[] };

    expect(resolved.activeUrl).toBeNull();
    expect(settings.polymarketMarkets).toHaveLength(0);
  });
});
