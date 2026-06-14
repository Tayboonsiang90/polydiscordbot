import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BotDatabase } from "../src/database.js";
import type { EventMonitorPost } from "../src/integrations/types.js";

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

function createTestDatabase(): BotDatabase {
  tempDir = mkdtempSync(join(tmpdir(), "polybot-"));
  return new BotDatabase(join(tempDir, "bot.sqlite"));
}

describe("BotDatabase alert role metadata", () => {
  it("stores and finds integration alert role metadata", () => {
    const database = createTestDatabase();
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "channel",
      adapterId: "bonbast-usd-irr",
      displayName: "Bonbast USD/IRR",
      sourceUrl: "https://www.bonbast.com/graph/usd",
      pollIntervalMinutes: 5
    });

    const updated = database.setAlertRoleMetadata(integration.id, {
      alertRoleId: "role",
      roleMessageId: "message",
      roleChannelId: "role-channel",
      roleEmoji: "💱"
    });
    const found = database.getIntegrationByRoleMessage("message", "💱");

    expect(updated.alertRoleId).toBe("role");
    expect(updated.roleMessageId).toBe("message");
    expect(updated.roleChannelId).toBe("role-channel");
    expect(updated.roleEmoji).toBe("💱");
    expect(found?.id).toBe(integration.id);

    database.close();
  });

  it("stores integration settings JSON", () => {
    const database = createTestDatabase();
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "kma-channel",
      adapterId: "kma-seoul-precip",
      displayName: "KMA Seoul Precipitation",
      sourceUrl: "https://data.kma.go.kr/climate/RankState/selectRankStatisticsDivisionList.do",
      settingsJson: JSON.stringify({ year: 2026, month: 5 }),
      pollIntervalMinutes: 5
    });

    const updated = database.setSettingsJson(integration.id, JSON.stringify({ year: 2026, month: 6 }));

    expect(integration.settingsJson).toBe(JSON.stringify({ year: 2026, month: 5 }));
    expect(updated.settingsJson).toBe(JSON.stringify({ year: 2026, month: 6 }));

    database.close();
  });

  it("syncs adapter-owned integration metadata without changing runtime state", () => {
    const database = createTestDatabase();
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "uma-clarifications",
      adapterId: "polymarket-clarifications",
      displayName: "Polymarket Clarifications",
      sourceUrl: "https://old.example",
      settingsJson: JSON.stringify({ lastScannedBlock: 100 }),
      pollIntervalMinutes: 5
    });

    const updated = database.syncIntegrationMetadata(integration.id, {
      displayName: "UMA Clarifications",
      sourceUrl: "https://new.example"
    });

    expect(updated).toMatchObject({
      displayName: "UMA Clarifications",
      sourceUrl: "https://new.example",
      settingsJson: JSON.stringify({ lastScannedBlock: 100 }),
      pollIntervalMinutes: 5,
      lastValue: null
    });

    database.close();
  });

  it("stores daily snapshots separately from regular checks", () => {
    const database = createTestDatabase();
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "freeappstore",
      adapterId: "free-app-store",
      displayName: "Free App Store Top 5",
      sourceUrl: "https://apps.apple.com/us/charts/iphone",
      pollIntervalMinutes: 5
    });

    const checked = database.recordCheck(integration.id, "regular-value", new Date("2026-05-08T15:55:00.000Z"));
    const snapshotted = database.recordSnapshot(
      integration.id,
      "snapshot-value",
      new Date("2026-05-08T16:00:00.000Z"),
      "2026-05-08"
    );
    const checkedAgain = database.recordCheck(integration.id, "new-regular-value", new Date("2026-05-08T16:10:00.000Z"));

    expect(checked.snapshotValue).toBeNull();
    expect(snapshotted.lastValue).toBe("regular-value");
    expect(snapshotted.snapshotValue).toBe("snapshot-value");
    expect(snapshotted.snapshotDate).toBe("2026-05-08");
    expect(checkedAgain.lastValue).toBe("new-regular-value");
    expect(checkedAgain.snapshotValue).toBe("snapshot-value");

    database.close();
  });

  it("can keep lastChangedAt stable when adapter-specific comparison suppresses a change", () => {
    const database = createTestDatabase();
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "mrbeastviews",
      adapterId: "mrbeast-views",
      displayName: "MrBeast YouTube Views",
      sourceUrl: "https://www.youtube.com/@MrBeast/about",
      pollIntervalMinutes: 5
    });

    const first = database.recordCheck(integration.id, "Total views: 123B", new Date("2026-05-08T15:55:00.000Z"));
    const suppressed = database.recordCheck(
      first.id,
      "Total views: 123B\nNeeded by deadline: 10M/day",
      new Date("2026-05-08T16:00:00.000Z"),
      false
    );
    const changed = database.recordCheck(suppressed.id, "Total views: 124B", new Date("2026-05-08T17:00:00.000Z"), true);

    expect(first.lastChangedAt).toBeNull();
    expect(suppressed.lastCheckedAt).toBe("2026-05-08T16:00:00.000Z");
    expect(suppressed.lastChangedAt).toBeNull();
    expect(changed.lastChangedAt).toBe("2026-05-08T17:00:00.000Z");

    database.close();
  });

  it("stores update timing logs and deduplicates event updates", () => {
    const database = createTestDatabase();
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "bonbast",
      adapterId: "bonbast-usd-irr",
      displayName: "Bonbast USD/IRR",
      sourceUrl: "https://www.bonbast.com/graph/usd",
      pollIntervalMinutes: 5
    });
    const post = buildEventPost("event-1");

    database.recordUpdateLog({
      integrationId: integration.id,
      adapterId: integration.adapterId,
      kind: "value_change",
      title: "Value changed",
      summary: "181300",
      sourceAt: "2026-05-06T02:43:30.000Z",
      detectedAt: "2026-05-06T02:43:30.000Z"
    });
    expect(database.claimEventAlert(integration.id, post.id, post, new Date("2026-05-06T03:00:00.000Z"))).toBe(true);
    expect(database.claimEventAlert(integration.id, post.id, post, new Date("2026-05-06T03:01:00.000Z"))).toBe(false);

    expect(database.listUpdateLogs(integration.id)).toMatchObject([
      {
        kind: "event",
        dedupeKey: post.id,
        title: "Polymarket clarification",
        sourceAt: "2026-05-21T00:00:00.000Z",
        detectedAt: "2026-05-06T03:00:00.000Z"
      },
      {
        kind: "value_change",
        dedupeKey: null,
        title: "Value changed",
        summary: "181300",
        detectedAt: "2026-05-06T02:43:30.000Z"
      }
    ]);

    database.close();
  });

  it("deduplicates market end reminders by integration, URL, and reminder key", () => {
    const database = createTestDatabase();
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "channel",
      adapterId: "trump-truth",
      displayName: "Trump Truth Social",
      sourceUrl: "https://truthsocial.com/@realDonaldTrump",
      polymarketUrl: "https://polymarket.com/event/what-will-trump-post-this-week-may-4-may-10",
      pollIntervalMinutes: 5
    });

    expect(database.hasMarketEndReminder(integration.id, integration.polymarketUrl!, "12h")).toBe(false);
    database.recordMarketEndReminder(integration.id, integration.polymarketUrl!, "12h", new Date("2026-05-10T15:59:00.000Z"));
    database.recordMarketEndReminder(integration.id, integration.polymarketUrl!, "12h", new Date("2026-05-10T16:00:00.000Z"));

    expect(database.hasMarketEndReminder(integration.id, integration.polymarketUrl!, "12h")).toBe(true);
    expect(database.hasMarketEndReminder(integration.id, integration.polymarketUrl!, "1h")).toBe(false);

    database.clearMarketEndReminders(integration.id, integration.polymarketUrl!);
    expect(database.hasMarketEndReminder(integration.id, integration.polymarketUrl!, "12h")).toBe(false);

    database.close();
  });

  it("stores market end metadata and missing warnings", () => {
    const database = createTestDatabase();
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "channel",
      adapterId: "fred-ground-beef",
      displayName: "FRED Ground Beef Price",
      sourceUrl: "https://fred.stlouisfed.org/series/APU0000703112",
      polymarketUrl: "https://polymarket.com/event/will-ground-beef-hit-in-2026",
      pollIntervalMinutes: 5
    });

    database.recordMarketEndMetadata(
      integration.id,
      integration.polymarketUrl!,
      new Date("2026-12-31T00:00:00.000Z"),
      new Date("2026-05-08T00:00:00.000Z")
    );
    expect(database.getMarketEndMetadata(integration.id, integration.polymarketUrl!)).toMatchObject({
      endAt: "2026-12-31T00:00:00.000Z",
      missingWarnedAt: null
    });

    database.recordMarketEndMissingWarning(integration.id, integration.polymarketUrl!, new Date("2026-05-08T01:00:00.000Z"));
    expect(database.getMarketEndMetadata(integration.id, integration.polymarketUrl!)).toMatchObject({
      missingWarnedAt: "2026-05-08T01:00:00.000Z"
    });

    database.close();
  });

  it("claims event alerts once and retries pending deliveries", () => {
    const database = createTestDatabase();
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "uma-clarifications",
      adapterId: "polymarket-clarifications",
      displayName: "UMA Clarifications",
      sourceUrl: "https://polygonscan.com/address/0x65070BE91477460D8A7AeEb94ef92fe056C2f2A7",
      pollIntervalMinutes: 1
    });
    const post = buildEventPost("0xtx:0x1");

    expect(database.claimEventAlert(integration.id, post.id, post, new Date("2026-05-21T00:00:00.000Z"))).toBe(true);
    expect(database.claimEventAlert(integration.id, post.id, post, new Date("2026-05-21T00:00:01.000Z"))).toBe(false);
    expect(database.claimPendingEventAlerts(integration.id, new Date("2026-05-21T00:00:30.000Z"))).toEqual([]);

    database.markEventAlertPending(integration.id, post.id, new Date("2026-05-21T00:00:31.000Z"));
    const [pending] = database.claimPendingEventAlerts(integration.id, new Date("2026-05-21T00:00:32.000Z"));

    expect(pending?.eventId).toBe(post.id);
    expect(pending?.status).toBe("sending");
    expect(pending?.post.postedAt.toISOString()).toBe("2026-05-21T00:00:00.000Z");

    database.markEventAlertSent(integration.id, post.id, new Date("2026-05-21T00:00:33.000Z"));
    expect(database.claimPendingEventAlerts(integration.id, new Date("2026-05-21T00:10:00.000Z"))).toEqual([]);
    expect(
      database.updateEventAlertPost(
        integration.id,
        post.id,
        { ...post, text: "Clarification refreshed." },
        new Date("2026-05-21T00:00:34.000Z")
      )
    ).toBe(true);
    expect(database.getEventAlert(integration.id, post.id)).toMatchObject({
      eventId: post.id,
      status: "sent",
      sentAt: "2026-05-21T00:00:33.000Z",
      updatedAt: "2026-05-21T00:00:34.000Z",
      post: expect.objectContaining({ text: "Clarification refreshed." })
    });

    database.close();
  });
});

function buildEventPost(id: string): EventMonitorPost {
  return {
    id,
    type: "Polymarket clarification",
    alertTitle: "Polymarket clarification",
    sourceLabel: "On-chain tx",
    textFieldName: "Clarification",
    text: "Clarification issued.",
    qualifyingText: "Clarification issued.",
    postedAt: new Date("2026-05-21T00:00:00.000Z"),
    url: "https://polygonscan.com/tx/0xtx",
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

