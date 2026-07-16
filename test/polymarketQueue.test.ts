import { describe, expect, it } from "vitest";
import {
  parsePolymarketMonthWindow,
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

  it("parses quarter windows from quarterly market slugs", () => {
    expect(
      parsePolymarketDateRangeWindow(
        "https://polymarket.com/event/how-many-tesla-deliveries-in-q2-2026",
        new Date("2026-05-29T00:00:00.000Z")
      )
    ).toEqual({
      startAt: "2026-04-01T04:00:00.000Z",
      endAt: "2026-07-01T03:59:00.000Z"
    });
  });

  it("parses single-date daily market slugs", () => {
    expect(
      parsePolymarketDateRangeWindow(
        "https://polymarket.com/event/what-will-be-said-on-the-next-all-in-podcast-may-29",
        new Date("2026-05-29T12:00:00.000Z")
      )
    ).toEqual({
      startAt: "2026-05-29T04:00:00.000Z",
      endAt: "2026-05-30T03:59:00.000Z"
    });

    expect(
      parsePolymarketDateRangeWindow(
        "https://polymarket.com/market/will-the-white-house-call-a-full-lid-by-630pm-on-june-20-20260612215749899",
        new Date("2026-06-13T12:00:00.000Z")
      )
    ).toEqual({
      startAt: "2026-06-20T04:00:00.000Z",
      endAt: "2026-06-21T03:59:00.000Z"
    });
  });

  it("parses week-of market slugs as seven-day ET windows", () => {
    expect(
      parsePolymarketDateRangeWindow(
        "https://polymarket.com/event/how-many-ships-transit-the-strait-of-hormuz-week-of-june-1",
        new Date("2026-06-03T12:00:00.000Z")
      )
    ).toEqual({
      startAt: "2026-06-01T04:00:00.000Z",
      endAt: "2026-06-08T03:59:00.000Z"
    });
  });

  it("parses month-only market slugs", () => {
    expect(
      parsePolymarketDateRangeWindow(
        "https://polymarket.com/event/precipitation-in-london-in-june",
        new Date("2026-05-29T12:00:00.000Z")
      )
    ).toEqual({
      startAt: "2026-06-01T04:00:00.000Z",
      endAt: "2026-07-01T03:59:00.000Z"
    });
    expect(
      parsePolymarketMonthWindow(
        "https://polymarket.com/event/precipitation-in-london-in-april-522",
        new Date("2026-05-29T12:00:00.000Z")
      )
    ).toMatchObject({ year: 2026, month: 4 });

    expect(
      parsePolymarketDateRangeWindow(
        "https://polymarket.com/event/will-gas-hit-by-end-of-july-20260630204747602",
        new Date("2026-07-16T12:00:00.000Z")
      )
    ).toEqual({
      startAt: "2026-07-01T04:00:00.000Z",
      endAt: "2026-08-01T03:59:00.000Z"
    });
    expect(
      parsePolymarketMonthWindow(
        "https://polymarket.com/event/will-gas-hit-by-end-of-july-20260630204747602",
        new Date("2026-07-16T12:00:00.000Z")
      )
    ).toMatchObject({ year: 2026, month: 7 });
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

  it("chooses the nearest-expiring active market when active windows overlap", () => {
    const resolved = resolveIntegrationPolymarketQueue(
      {
        ...integration,
        polymarketUrl: "https://polymarket.com/event/measles-cases-in-us-in-2026",
        settingsJson: JSON.stringify({
          polymarketMarkets: [
            {
              url: "https://polymarket.com/event/measles-cases-in-us-in-2026",
              slug: "measles-cases-in-us-in-2026",
              startAt: "2025-12-01T17:57:05.432Z",
              endAt: "2026-12-31T00:00:00.000Z",
              addedAt: "2026-07-11T00:00:00.000Z"
            },
            {
              url: "https://polymarket.com/event/measles-cases-in-uptspt-by-july-31-20260630182033696",
              slug: "measles-cases-in-uptspt-by-july-31-20260630182033696",
              startAt: "2026-07-01T05:43:50.874Z",
              endAt: "2026-07-31T23:59:00.000Z",
              addedAt: "2026-07-11T00:00:00.000Z"
            }
          ]
        })
      },
      new Date("2026-07-11T12:00:00.000Z")
    );

    expect(resolved.activeUrl).toBe("https://polymarket.com/event/measles-cases-in-uptspt-by-july-31-20260630182033696");
  });

  it("keeps an expired dated current market as fallback when no queued market is active", () => {
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

    expect(resolved.activeUrl).toBe("https://polymarket.com/event/number-of-tsa-passengers-may-4-may-10");
    expect(settings.polymarketMarkets).toHaveLength(0);
  });
});
